import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import {
  DEFAULT_PHYSICS_CONFIG,
  seededInitialState,
  stepBandsPhysics,
  stepFlowPhysics,
  stepOrbitPhysics,
  type Bounds,
  type PhysicsSphere,
  type WallMode,
} from '../lib/wallPhysics'

/**
 * Exhibition wall scene.
 *
 * Each participant gets a sphere that moves with 2D physics. Three wall
 * modes are available (selected by parent via `mode` prop):
 *
 *   - `flow`  (default) : soft vertical gradient + per-rating motion character.
 *   - `orbit`           : concentric orbits around the canvas center.
 *   - `bands`           : hidden 3-layer comparison mode (URL: ?mode=bands).
 *
 * Switching modes is state-preserving — the same `PhysicsSphere` objects
 * carry over; only the step function changes and each mode's forces guide
 * the ensemble into its new layout over a second or two.
 *
 * The whole scene also rotates gently toward the mouse (Codrops-style
 * parallax); with no mouse on the exhibition machine it stays still.
 */

const SPHERE_RADIUS = 0.4
const SPHERE_SCALE = 0.32
const CAMERA_Z = 5.8
const CAMERA_FOV = 45

/** Inset the physics tank slightly so spheres bounce visibly inside the frame. */
const WALL_PAD = 0.15

/**
 * Dynamic sphere sizing: a global `scaleFactor` ∈ [SCALE_MIN, SCALE_MAX]
 * multiplies both the visual mesh scale and the physics collision radius so
 * the wall stays visually breathable as the crowd grows.
 *
 *   scaleTarget = clamp(sqrt(REF_COUNT / count), SCALE_MIN, SCALE_MAX)
 *
 * REF_COUNT = the "comfortable" count (~20 blobs ≈ 1× size). Below that
 * spheres grow up to 1.2×; above it they shrink down to 0.6× at around 80
 * spheres. The factor is exponentially smoothed with `SCALE_TAU` seconds
 * so joins/leaves ripple through the ensemble instead of snapping.
 */
const SCALE_REF_COUNT = 20
const SCALE_MIN = 0.6
const SCALE_MAX = 1.2
const SCALE_TAU = 0.2

function computeScaleTarget(count: number): number {
  if (count <= 0) return SCALE_MAX
  const raw = Math.sqrt(SCALE_REF_COUNT / count)
  return Math.max(SCALE_MIN, Math.min(SCALE_MAX, raw))
}

export type WallSceneProps = {
  entries: WallEntry[]
  /** Which physics mode drives motion. Defaults to `flow`. */
  mode?: WallMode
  className?: string
}

export function WallScene({ entries, mode = 'flow', className }: WallSceneProps) {
  return (
    <div className={className} role="img" aria-label="Exhibition wall of color spheres">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, CAMERA_Z], fov: CAMERA_FOV }}
        // Height lives in CSS (`.wall-canvas-wrap canvas`) so exhibition /
        // projector setups can override it without touching this component.
        style={{ width: '100%', touchAction: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#F5EFE6']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 8, 10]} intensity={0.9} color="#fff6e8" />
        <directionalLight position={[-5, -3, -4]} intensity={0.3} color="#dfe6ff" />
        <PhysicsGroup entries={entries} mode={mode} />
      </Canvas>
    </div>
  )
}

type PhysicsGroupProps = {
  entries: WallEntry[]
  mode: WallMode
}

/**
 * Owns the physics state (a Map keyed by participantId, held in a ref) and
 * drives one `useFrame` loop that:
 *   1. Steps the active mode's physics (with elapsed time for flow/orbit).
 *   2. Writes each sphere's world position onto its mesh ref.
 *   3. Applies a lerped mouse-parallax rotation to the parent group.
 *
 * Reconciliation with `entries` happens synchronously at render time so new
 * spheres have initial state before their mesh mounts.
 *
 * Mode is tracked via a ref so `useFrame` always reads the current value
 * without rebuilding the callback (which would briefly halt motion).
 */
function PhysicsGroup({ entries, mode }: PhysicsGroupProps) {
  const { size, camera } = useThree()
  const reducedMotion = usePrefersReducedMotion()

  const statesRef = useRef<Map<string, PhysicsSphere>>(new Map())
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const groupRef = useRef<THREE.Group>(null)

  /**
   * Global scale factor, exponentially smoothed toward `scaleTarget` in
   * `useFrame`. Applied every frame to (a) each sphere's collision radius
   * and (b) each mesh's visual scale so physics stays consistent with
   * what you see. Kept in a ref (not state) to avoid re-renders on every
   * frame of the lerp.
   */
  const scaleFactorRef = useRef(1)
  const scaleTarget = useMemo(() => computeScaleTarget(entries.length), [entries.length])

  const modeRef = useRef<WallMode>(mode)
  useEffect(() => {
    // On mode change, clear any flow-only per-sphere state so the new mode
    // starts clean. Positions + velocities carry over for a smooth handoff.
    if (modeRef.current !== mode) {
      for (const s of statesRef.current.values()) {
        s.nextKickAt = undefined
      }
      modeRef.current = mode
    }
  }, [mode])

  /**
   * Physics tank = what's visible at z=0 with this perspective camera,
   * inset by WALL_PAD so bounces read as bounces rather than off-screen.
   * Recomputed when the canvas resizes.
   */
  const bounds = useMemo<Bounds>(() => {
    const persp = camera as THREE.PerspectiveCamera
    const halfH = Math.tan((persp.fov * Math.PI) / 360) * CAMERA_Z
    const aspect = size.height > 0 ? size.width / size.height : 1
    const halfW = halfH * aspect
    return {
      minX: -halfW + WALL_PAD,
      maxX: halfW - WALL_PAD,
      minY: -halfH + WALL_PAD,
      maxY: halfH - WALL_PAD,
    }
  }, [size.width, size.height, camera])

  /**
   * Reconcile the entries list with our state Map. Done at render time so
   * the mesh renders can read initial positions synchronously.
   *  - New ids → `seededInitialState` for the current mode.
   *  - Disappeared ids → removed from state + mesh refs.
   *  - Existing ids whose rating changed (re-upload with new turbulence) →
   *    just update the stored `turbulence`; position/velocity carry over so
   *    there is no visual teleport.
   */
  {
    const states = statesRef.current
    const wanted = new Set(entries.map((e) => e.participantId))
    for (const id of Array.from(states.keys())) {
      if (!wanted.has(id)) {
        states.delete(id)
        meshesRef.current.delete(id)
      }
    }
    // Initial spawns use the lerp target (not the current lerped value) so
    // a new blob lands at a position that respects the final crowd-size,
    // not the 1-frame snapshot.
    const spawnRadius = SPHERE_RADIUS * scaleTarget
    for (const e of entries) {
      const existing = states.get(e.participantId)
      if (!existing) {
        states.set(
          e.participantId,
          seededInitialState(
            e.participantId,
            bounds,
            spawnRadius,
            e.turbulence,
            mode,
          ),
        )
      } else if (existing.turbulence !== e.turbulence) {
        existing.turbulence = e.turbulence
      }
    }
  }

  // Mouse parallax: track [-1, 1] on each axis, lerp current toward target.
  const parallax = useRef({ tx: 0, ty: 0, cx: 0, cy: 0 })
  useEffect(() => {
    const onMove = (e: MouseEvent) => {
      parallax.current.tx = (e.clientX / window.innerWidth) * 2 - 1
      parallax.current.ty = -(e.clientY / window.innerHeight) * 2 + 1
    }
    window.addEventListener('mousemove', onMove)
    return () => window.removeEventListener('mousemove', onMove)
  }, [])

  // Tank-level physics config. Per-sphere behavior comes from the
  // turbulence rating inside each step function; we just forward reducedMotion.
  const physicsConfig = useMemo(
    () => ({ ...DEFAULT_PHYSICS_CONFIG, reducedMotion }),
    [reducedMotion],
  )

  useFrame((state, dt) => {
    const list = Array.from(statesRef.current.values())
    const t = state.clock.elapsedTime
    const currentMode = modeRef.current

    // Exponential smoothing toward scaleTarget (framerate-independent).
    const alpha = 1 - Math.exp(-Math.max(0, dt) / SCALE_TAU)
    scaleFactorRef.current += (scaleTarget - scaleFactorRef.current) * alpha
    const sf = scaleFactorRef.current
    const radiusNow = SPHERE_RADIUS * sf
    const visualScale = SPHERE_SCALE * sf

    // Keep each sphere's collision radius in sync with the visual scale so
    // shrinking the crowd doesn't leave "ghost" collision auras behind.
    for (const s of list) s.radius = radiusNow

    if (currentMode === 'orbit') {
      stepOrbitPhysics(list, dt, bounds, t, physicsConfig)
    } else if (currentMode === 'bands') {
      stepBandsPhysics(list, dt, bounds, physicsConfig)
    } else {
      stepFlowPhysics(list, dt, bounds, t, physicsConfig)
    }

    for (const s of list) {
      const mesh = meshesRef.current.get(s.id)
      if (mesh) {
        mesh.position.set(s.x, s.y, 0)
        mesh.scale.setScalar(visualScale)
      }
    }

    const p = parallax.current
    // ~3% lerp: eases over ~1s toward mouse target. Matches Codrops feel.
    p.cx += (p.tx - p.cx) * 0.03
    p.cy += (p.ty - p.cy) * 0.03
    if (groupRef.current) {
      const amp = reducedMotion ? 0.05 : 0.18
      groupRef.current.rotation.y = p.cx * amp
      groupRef.current.rotation.x = p.cy * amp
    }
  })

  return (
    <group ref={groupRef}>
      {entries.map((e) => {
        const state = statesRef.current.get(e.participantId)
        const initPos: [number, number, number] = state ? [state.x, state.y, 0] : [0, 0, 0]
        return (
          <WallSphereMesh
            key={e.participantId}
            entry={e}
            initialPosition={initPos}
            meshesRef={meshesRef}
          />
        )
      })}
    </group>
  )
}

type WallSphereMeshProps = {
  entry: WallEntry
  initialPosition: [number, number, number]
  meshesRef: React.MutableRefObject<Map<string, THREE.Mesh>>
}

/**
 * Registers its mesh in the shared `meshesRef` Map on mount and removes it
 * on unmount. Using a `useEffect` (rather than a function ref) keeps the
 * registration stable across re-renders — earlier versions re-created the
 * ref callback every render, which caused harmless but noisy
 * attach/detach cycles on every realtime refetch.
 */
function WallSphereMesh({ entry, initialPosition, meshesRef }: WallSphereMeshProps) {
  const localMeshRef = useRef<THREE.Mesh | null>(null)
  const hasPalette = entry.palette && entry.palette.length >= 2
  const fallback = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

  useEffect(() => {
    const mesh = localMeshRef.current
    if (!mesh) return
    const map = meshesRef.current
    map.set(entry.participantId, mesh)
    return () => {
      map.delete(entry.participantId)
    }
  }, [entry.participantId, meshesRef])

  return (
    <mesh
      ref={localMeshRef}
      position={initialPosition}
      scale={SPHERE_SCALE}
    >
      {/* Unit Icosahedron — even triangulation so the shader's latitude
          twist reads cleanly. Lower detail than the preview since wall
          spheres are small on screen. Actual size comes from `scale`. */}
      <icosahedronGeometry args={[1, 24]} />
      {hasPalette ? (
        <PaletteSphereMaterial
          palette={entry.palette}
          seed={entry.participantId}
          turbulence={entry.turbulence}
          animate
        />
      ) : (
        <meshPhysicalMaterial
          color={fallback}
          roughness={0.4}
          metalness={0.0}
          clearcoat={0.3}
          clearcoatRoughness={0.3}
        />
      )}
    </mesh>
  )
}
