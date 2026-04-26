import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import { useSearchParams } from 'react-router-dom'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import { DEFAULT_SCAFFOLD_PALETTE } from '../lib/aggregatePalette'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import { TURBULENCE_DEFAULT } from '../lib/turbulence'
import {
  DEFAULT_MANDALA_CONFIG,
  MANDALA_DOCK_COUNT,
  MANDALA_INNER_RADIUS,
  MANDALA_OUTER_RADIUS,
  MANDALA_SCAFFOLD_COUNT,
  MANDALA_SCAFFOLD_OMEGA,
  generateFibonacciSphere,
  reconcileMandalaBlobs,
  stepMandalaPhysics,
  type MandalaBlob,
  type MandalaDockOccupancy,
  type MandalaPoint,
} from '../lib/mandalaScaffold'

/**
 * Mandala-mode stage.
 *
 * Architecture (same "scaffold + agents" shape as WaveStage):
 *   - **Scaffold:** a Fibonacci sphere of MANDALA_SCAFFOLD_COUNT (80)
 *     deep-navy blobs at radius MANDALA_INNER_RADIUS (1.6), wrapped in
 *     a group that rotates slowly around the Y axis (~24 s per rev).
 *     They're immovable visual obstacles — user blobs bounce off them
 *     via the inner-sphere collision in `stepMandalaPhysics`.
 *   - **Agents:** user blobs with full 3-D motion. Each blob is
 *     assigned a role at spawn (dock / chaotic) by `computeMandalaRole`:
 *       - dock blobs spring toward an assigned dock slot on the outer
 *         shell (MANDALA_OUTER_RADIUS ≈ 2.32) and hold position;
 *       - chaotic blobs get random impulses + a weak outward push and
 *         wander the shell space, knocking docked blobs off their slots.
 *
 *   The scaffold lives inside a rotating `<group>`, but user blobs do
 *   not (they're in world-space). That way the mandala pattern
 *   rotates as a single piece while user blobs drift / bounce
 *   independently.
 */

const SCAFFOLD_VISUAL_SCALE = 0.26
const USER_VISUAL_SCALE = 0.34

export type MandalaStageProps = {
  entries: WallEntry[]
}

/**
 * Live tuning knob for the meteor (chaotic-blob) speed/pacing. Read
 * once from the URL (`?metFrac=N`) at mount and used to scale
 * `chaoticImpulse` (×) and the impulse intervals (÷). Kept proportional
 * so the "kick energy : drift time" ratio stays constant — the
 * trajectories look the same shape, the whole movie just plays back
 * faster or slower.
 *
 *   metFrac = 1.0  → ship default (psych-exhibition vibe, ~6 s
 *                    cross-stage time)
 *   metFrac = 1.5  → moderately faster (the previous "cinematic"
 *                    tuning, ~4 s cross-stage)
 *   metFrac = 2.0+ → energetic demo mode (close to the original
 *                    full-send build)
 *   metFrac = 0.5  → near-meditation; meteors crawl
 *
 * Clamped to [0.3, 3.0] so a typo can't freeze or explode the scene.
 */
function parseMetFrac(raw: string | null): number {
  if (!raw) return 1.0
  const n = Number(raw)
  if (!Number.isFinite(n)) return 1.0
  return Math.max(0.3, Math.min(3.0, n))
}

export function MandalaStage({ entries }: MandalaStageProps) {
  const reducedMotion = usePrefersReducedMotion()
  const [searchParams] = useSearchParams()
  const metFrac = useMemo(
    () => parseMetFrac(searchParams.get('metFrac')),
    [searchParams],
  )

  // Scaffold + dock positions are pure functions of constants, so memo
  // once per mount.
  const scaffold = useMemo<MandalaPoint[]>(
    () => generateFibonacciSphere(MANDALA_SCAFFOLD_COUNT, MANDALA_INNER_RADIUS),
    [],
  )
  const dockPositions = useMemo<MandalaPoint[]>(
    () => generateFibonacciSphere(MANDALA_DOCK_COUNT, MANDALA_OUTER_RADIUS),
    [],
  )

  // Blob state + dock occupancy live in refs so they survive re-renders.
  const statesRef = useRef<Map<string, MandalaBlob>>(new Map())
  const occupancyRef = useRef<MandalaDockOccupancy>(new Map())

  // First-paint guard: we want pre-existing entries on page load to
  // appear *already seated* on the mandala, not to all fly in from
  // outside simultaneously (which would look like a meteor shower).
  // After the first render we flip the flag so subsequent newcomers
  // (real-time uploads) do animate their arrival.
  const firstPaintRef = useRef(true)

  // Reconcile synchronously so the user-blob meshes render from
  // up-to-date positions.
  reconcileMandalaBlobs(
    entries,
    statesRef.current,
    occupancyRef.current,
    dockPositions,
    { animateArrival: !firstPaintRef.current },
  )

  useEffect(() => {
    // After the initial render commits, any future reconcile runs should
    // treat newcomers as animated arrivals.
    firstPaintRef.current = false
  }, [])

  const userMeshesRef = useRef<Map<string, THREE.Mesh>>(new Map())
  const scaffoldGroupRef = useRef<THREE.Group>(null)

  const config = useMemo(
    () => ({
      ...DEFAULT_MANDALA_CONFIG,
      reducedMotion,
      // Scale meteor energy + pacing inversely so the ratio is preserved
      // — higher metFrac = harder + more frequent kicks.
      chaoticImpulse: DEFAULT_MANDALA_CONFIG.chaoticImpulse * metFrac,
      chaoticMinInterval: DEFAULT_MANDALA_CONFIG.chaoticMinInterval / metFrac,
      chaoticMaxInterval: DEFAULT_MANDALA_CONFIG.chaoticMaxInterval / metFrac,
    }),
    [reducedMotion, metFrac],
  )

  // Local simulation clock — separated from the R3F clock so `now` values
  // passed into physics are monotonically-increasing from the stage's
  // mount, not from the Canvas's global elapsedTime.
  const clockRef = useRef(0)

  useFrame((_, dt) => {
    clockRef.current += dt
    const now = clockRef.current

    // Rotate scaffold group around Y. Reduced-motion → half speed.
    if (scaffoldGroupRef.current) {
      scaffoldGroupRef.current.rotation.y +=
        MANDALA_SCAFFOLD_OMEGA * dt * (reducedMotion ? 0.5 : 1)
    }

    // Step user-blob physics, then sync meshes.
    const list = Array.from(statesRef.current.values())
    stepMandalaPhysics(list, dockPositions, occupancyRef.current, dt, now, config)

    for (const b of list) {
      const mesh = userMeshesRef.current.get(b.id)
      if (mesh) mesh.position.set(b.x, b.y, b.z)
    }
  })

  return (
    <group>
      {/* Scaffold — rotates as a single piece. */}
      <group ref={scaffoldGroupRef}>
        {scaffold.map((pt) => (
          <mesh
            key={`scaffold-${pt.index}`}
            position={[pt.x, pt.y, pt.z]}
            scale={SCAFFOLD_VISUAL_SCALE}
          >
            {/* Low-detail icosahedron — scaffold blobs are small on
                screen and we have 80 of them. */}
            <icosahedronGeometry args={[1, 8]} />
            <PaletteSphereMaterial
              palette={DEFAULT_SCAFFOLD_PALETTE}
              seed={`mandala-scaffold-${pt.index}`}
              turbulence={TURBULENCE_DEFAULT}
              animate
            />
          </mesh>
        ))}
      </group>

      {/* User blobs — live in world-space, don't rotate with scaffold. */}
      {entries.map((e) => {
        const state = statesRef.current.get(e.participantId)
        const initPos: [number, number, number] = state
          ? [state.x, state.y, state.z]
          : [0, 0, 0]
        return (
          <MandalaUserBlob
            key={e.participantId}
            entry={e}
            initialPosition={initPos}
            meshesRef={userMeshesRef}
          />
        )
      })}
    </group>
  )
}

type MandalaUserBlobProps = {
  entry: WallEntry
  initialPosition: [number, number, number]
  meshesRef: React.MutableRefObject<Map<string, THREE.Mesh>>
}

function MandalaUserBlob({ entry, initialPosition, meshesRef }: MandalaUserBlobProps) {
  const localRef = useRef<THREE.Mesh | null>(null)
  const hasPalette = entry.palette && entry.palette.length >= 2
  const fallback = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

  // Stable mount/unmount registration — matches the WaveStage /
  // WallScene pattern so realtime refetches don't churn refs.
  useEffect(() => {
    const mesh = localRef.current
    if (!mesh) return
    const map = meshesRef.current
    map.set(entry.participantId, mesh)
    return () => {
      map.delete(entry.participantId)
    }
  }, [entry.participantId, meshesRef])

  return (
    <mesh ref={localRef} position={initialPosition} scale={USER_VISUAL_SCALE}>
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
