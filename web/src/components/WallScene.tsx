import { useEffect, useMemo, useRef } from 'react'
import { Canvas, useFrame, useThree } from '@react-three/fiber'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import {
  DEFAULT_PHYSICS_CONFIG,
  seededInitialState,
  stepPhysics,
  type Bounds,
  type PhysicsSphere,
} from '../lib/wallPhysics'

/**
 * Exhibition wall scene.
 *
 * Each participant gets a sphere that moves with simple 2D billiard physics:
 * the camera's visible rectangle at the sphere plane is the tank, spheres
 * bounce off the walls and off each other with light damping, and a small
 * ambient jitter keeps motion alive indefinitely.
 *
 * The whole scene also rotates gently toward the mouse (Codrops-style
 * parallax) for a subtle "alive" feel; with no mouse on the exhibition
 * machine it simply stays still.
 */

const SPHERE_RADIUS = 0.4
const SPHERE_SCALE = 0.32
const CAMERA_Z = 5.8
const CAMERA_FOV = 45

/** Inset the physics tank slightly so spheres bounce visibly inside the frame. */
const WALL_PAD = 0.15

export type WallSceneProps = {
  entries: WallEntry[]
  className?: string
}

export function WallScene({ entries, className }: WallSceneProps) {
  return (
    <div className={className} role="img" aria-label="Exhibition wall of color spheres">
      <Canvas
        dpr={[1, 1.5]}
        camera={{ position: [0, 0, CAMERA_Z], fov: CAMERA_FOV }}
        style={{ width: '100%', height: 'min(72vh, 640px)', touchAction: 'none' }}
        gl={{ antialias: true, alpha: false }}
      >
        <color attach="background" args={['#F5EFE6']} />
        <ambientLight intensity={0.75} />
        <directionalLight position={[6, 8, 10]} intensity={0.9} color="#fff6e8" />
        <directionalLight position={[-5, -3, -4]} intensity={0.3} color="#dfe6ff" />
        <PhysicsGroup entries={entries} />
      </Canvas>
    </div>
  )
}

type PhysicsGroupProps = {
  entries: WallEntry[]
}

/**
 * Owns the physics state (a Map keyed by participantId, held in a ref) and
 * drives one `useFrame` loop that:
 *   1. Steps the physics.
 *   2. Writes each sphere's world position onto its mesh ref.
 *   3. Applies a lerped mouse-parallax rotation to the parent group.
 *
 * Reconciliation with `entries` happens synchronously at render time so new
 * spheres have initial state before their mesh mounts.
 */
function PhysicsGroup({ entries }: PhysicsGroupProps) {
  const { size, camera } = useThree()
  const reducedMotion = usePrefersReducedMotion()

  const statesRef = useRef<Map<string, PhysicsSphere>>(new Map())
  const meshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const groupRef = useRef<THREE.Group>(null)

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
   * - New ids → `seededInitialState`.
   * - Disappeared ids → removed from state + mesh refs.
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
    for (const e of entries) {
      if (!states.has(e.participantId)) {
        states.set(
          e.participantId,
          seededInitialState(e.participantId, bounds, SPHERE_RADIUS),
        )
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

  // Tuned physics config. Reduced-motion users get a slower, calmer tank.
  const physicsConfig = useMemo(
    () =>
      reducedMotion
        ? {
            ...DEFAULT_PHYSICS_CONFIG,
            ambientJitter: 0.0015,
            maxSpeed: 0.8,
          }
        : DEFAULT_PHYSICS_CONFIG,
    [reducedMotion],
  )

  useFrame((_state, dt) => {
    const list = Array.from(statesRef.current.values())
    stepPhysics(list, dt, bounds, physicsConfig)

    for (const s of list) {
      const mesh = meshesRef.current.get(s.id)
      if (mesh) mesh.position.set(s.x, s.y, 0)
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
            registerMesh={(mesh) => {
              if (mesh) meshesRef.current.set(e.participantId, mesh)
              else meshesRef.current.delete(e.participantId)
            }}
          />
        )
      })}
    </group>
  )
}

type WallSphereMeshProps = {
  entry: WallEntry
  initialPosition: [number, number, number]
  registerMesh: (mesh: THREE.Mesh | null) => void
}

function WallSphereMesh({ entry, initialPosition, registerMesh }: WallSphereMeshProps) {
  const hasPalette = entry.palette && entry.palette.length >= 2
  const fallback = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

  return (
    <mesh
      ref={registerMesh}
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
