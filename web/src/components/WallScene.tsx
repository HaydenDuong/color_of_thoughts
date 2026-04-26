import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import { OrbitControls } from '@react-three/drei'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import { WaveStage } from './WaveStage'
import { MandalaStage } from './MandalaStage'
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
 * Two top-level rendering paths, switched on `mode`:
 *
 *   - **Physics modes** (`flow`, `orbit`, `bands`): each participant gets a
 *     freeform sphere that moves with 2D physics inside the tank.
 *       - `flow`  (default) : soft vertical gradient + per-rating character.
 *       - `orbit`           : concentric orbits around the canvas center.
 *       - `bands`           : hidden 3-layer comparison mode (?mode=bands).
 *
 *   - **Scaffold modes** (`wave`, `mandala`): a fixed set of scaffold blobs
 *     anchors the scene; user blobs relate to that scaffold in mode-specific
 *     ways.
 *       - `wave`    : 12×8 grid in the X–Z plane; users take cells; surface
 *                     function + ripples drive Y.
 *       - `mandala` : 80-blob Fibonacci inner sphere (rotates slowly); user
 *                     blobs have full 3-D physics — calm dock to an outer
 *                     shell, turbulent roam and knock dockers off.
 *
 * Switching between physics modes is state-preserving (sphere objects carry
 * over). Switching INTO or OUT of a scaffold mode tears down the other
 * subtree, which is intentional: the geometries and per-blob assignments
 * are fundamentally different.
 *
 * The whole physics scene rotates gently toward the mouse (Codrops-style
 * parallax); on the exhibition machine with no mouse it stays still. The
 * CameraRig handles mode-specific framing — wave mode tilts the camera 18°
 * for a horizon-line read on the sea.
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
  /**
   * When true, swap the auto camera (CameraRig + parallax) for mouse
   * OrbitControls so a developer / supervisor can drag-orbit, scroll-zoom,
   * and right-drag-pan the scene to inspect it from any angle. Off by
   * default so the exhibition projector keeps its hands-off framing.
   */
  explore?: boolean
  className?: string
}

export function WallScene({ entries, mode = 'flow', explore = false, className }: WallSceneProps) {
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
        {explore ? <ExploreControls mode={mode} /> : <CameraRig mode={mode} />}
        {mode === 'wave' ? (
          <WaveStageHost entries={entries} />
        ) : mode === 'mandala' ? (
          <MandalaStage entries={entries} />
        ) : (
          <PhysicsGroup entries={entries} mode={mode} disableParallax={explore} />
        )}
      </Canvas>
    </div>
  )
}

/**
 * Mouse-driven camera for "explore mode". One-line drei drop:
 *   - drag           → orbit around the target
 *   - scroll         → dolly in/out
 *   - right-drag     → pan the target
 *   - touch (mobile) → 1-finger orbit, 2-finger pan + pinch zoom
 *
 * Polar angle is clamped just shy of straight-down/straight-up so the user
 * can look top-down ("from above" — your specific ask) without flipping
 * past vertical, which is disorienting and reverses the controls.
 *
 * Initial target moves with the mode so explore mode boots into a sensible
 * framing for whatever's on screen (sea-floor center for wave; origin for
 * physics modes). Once the user drags, drei tracks their target locally.
 */
function ExploreControls({ mode }: { mode: WallMode }) {
  const target = useMemo<[number, number, number]>(
    () => (mode === 'wave' ? [0, 0, -1.5] : [0, 0, 0]),
    [mode],
  )
  return (
    <OrbitControls
      makeDefault
      enableDamping
      dampingFactor={0.08}
      target={target}
      minDistance={2}
      maxDistance={20}
      minPolarAngle={0.05}
      maxPolarAngle={Math.PI - 0.05}
    />
  )
}

/**
 * Smoothly lerps the camera position + look-at toward the per-mode target.
 *
 * Wave mode treats the world as a horizontal sea: the grid lives in the
 * X–Z plane (Y is up). The camera lifts to ~2.6 units above the surface
 * and points at a target in front of and below it (`(0, 0, -1.5)`), which
 * gives roughly a 19° downward pitch — enough to make the back rows of
 * the grid recede into a real horizon line near the upper third of the
 * frame, instead of stacking behind the front rows. A subtle ±2° sway is
 * layered on so the camera feels like it's drifting on a buoy.
 *
 * Physics modes keep the camera level facing the tank head-on at the
 * original (0, 0, 5.8) — the same framing every previous version used.
 */
const CAMERA_LERP_TAU = 0.6
const WAVE_CAMERA_Y = 2.6
const WAVE_CAMERA_Z = 5.6
const WAVE_LOOKAT_Y = 0.0
const WAVE_LOOKAT_Z = -1.5
/**
 * Mandala uses a widescreen-shaped ellipsoidal meteor belt with semi-
 * axes (X=13, Y=6, Z=9 u). Camera distance chosen so the horizontal
 * viewport at the mandala's depth (z=0) covers ~±13 u (matching the
 * ellipsoid's wide axis), with FOV 50° + canvas aspect ~2.2:1. That
 * way meteors flying out to the X bounds appear at the canvas edges
 * instead of clipping off-screen.
 *
 * The exhibition setup uses `?explore=1` so OrbitControls
 * (`maxDistance=20`) handles the actual day-of framing; this constant
 * just makes the default non-Explore view (URL share, screenshot,
 * debug) frame the meteor belt comfortably.
 */
const MANDALA_CAMERA_Z = 12.0

function CameraRig({ mode }: { mode: WallMode }) {
  const { camera } = useThree()
  const lookAt = useRef(new THREE.Vector3(0, 0, 0))

  useFrame((state, dt) => {
    const wave = mode === 'wave'
    const mandala = mode === 'mandala'
    const targetY = wave ? WAVE_CAMERA_Y : 0
    const targetZ = wave ? WAVE_CAMERA_Z : mandala ? MANDALA_CAMERA_Z : CAMERA_Z
    const targetLookY = wave ? WAVE_LOOKAT_Y : 0
    const targetLookZ = wave ? WAVE_LOOKAT_Z : 0

    const alpha = 1 - Math.exp(-Math.max(0, dt) / CAMERA_LERP_TAU)
    camera.position.y += (targetY - camera.position.y) * alpha
    camera.position.z += (targetZ - camera.position.z) * alpha
    lookAt.current.y += (targetLookY - lookAt.current.y) * alpha
    lookAt.current.z += (targetLookZ - lookAt.current.z) * alpha

    if (wave) {
      // ±2° sway over a slow ~24s period. The position and look-at use
      // out-of-phase sines so the motion reads as floating on a buoy
      // rather than a stiff pendulum.
      const t = state.clock.elapsedTime
      const swayDeg = 2
      const swayRad = (swayDeg * Math.PI) / 180
      camera.position.x = Math.sin(t * 0.13) * 0.18
      lookAt.current.x = camera.position.x + Math.sin(t * 0.13 + 0.6) * swayRad
    } else {
      camera.position.x += (0 - camera.position.x) * alpha
      lookAt.current.x += (0 - lookAt.current.x) * alpha
    }

    camera.lookAt(lookAt.current)
  })

  return null
}

/**
 * Wraps WaveStage with the canvas size + camera info it needs to lay out
 * its scaffold grid. We forward `useThree().size` and the constants used
 * by the perspective camera so the grid spacing matches the visible tank.
 */
function WaveStageHost({ entries }: { entries: WallEntry[] }) {
  const { size } = useThree()
  return (
    <WaveStage
      entries={entries}
      width={size.width}
      height={size.height}
      cameraZ={CAMERA_Z}
      cameraFov={CAMERA_FOV}
    />
  )
}

type PhysicsGroupProps = {
  entries: WallEntry[]
  mode: WallMode
  /** Skip the parallax `useFrame` rotation when explore mode owns the camera. */
  disableParallax?: boolean
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
function PhysicsGroup({ entries, mode, disableParallax = false }: PhysicsGroupProps) {
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

    if (!disableParallax) {
      const p = parallax.current
      // ~3% lerp: eases over ~1s toward mouse target. Matches Codrops feel.
      p.cx += (p.tx - p.cx) * 0.03
      p.cy += (p.ty - p.cy) * 0.03
      if (groupRef.current) {
        const amp = reducedMotion ? 0.05 : 0.18
        groupRef.current.rotation.y = p.cx * amp
        groupRef.current.rotation.x = p.cy * amp
      }
    } else if (groupRef.current) {
      // Reset any accumulated parallax tilt so the group sits flat for
      // OrbitControls (otherwise the user's first drag inherits a stale
      // rotation and the scene reads as off-axis).
      groupRef.current.rotation.x = 0
      groupRef.current.rotation.y = 0
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
