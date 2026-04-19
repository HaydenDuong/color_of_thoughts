import { useEffect, useMemo, useRef } from 'react'
import { useFrame } from '@react-three/fiber'
import * as THREE from 'three'
import type { WallEntry } from '../lib/wallData'
import { PaletteSphereMaterial } from './PaletteSphereMaterial'
import { DEFAULT_SCAFFOLD_PALETTE } from '../lib/aggregatePalette'
import { usePrefersReducedMotion } from '../lib/usePrefersReducedMotion'
import {
  computeWaveParams,
  defaultWaveLayout,
  generateScaffoldGrid,
  reconcileCellAssignments,
  rippleAmplitudeFor,
  rippleHeight,
  waveHeight,
  WAVE_SCAFFOLD_COUNT,
  type CellAssignmentMaps,
  type Ripple,
  type ScaffoldCell,
} from '../lib/waveScaffold'
import { TURBULENCE_DEFAULT } from '../lib/turbulence'

/**
 * Wave-mode stage.
 *
 * Architecture (the "scaffold + agents" pattern):
 *   - Scaffold: a fixed 12×8 grid of 96 **deep-navy** blobs that always
 *     render. They form the sea surface; their dark, low-contrast palette
 *     is what makes the multicolor user blobs read as "the room arriving
 *     in the ocean" instead of just disappearing into another wall of
 *     blobs.
 *   - Agents: the user blobs. Each is hashed to a unique scaffold cell;
 *     their multicolor PaletteSphereMaterial replaces the scaffold blob at
 *     that cell, so every uploader literally "takes a seat at the table".
 *
 * **Coordinate system:** the sea is in the world **X–Z plane** (Y is up).
 * Each cell has a fixed (x, z); the wave function output drives Y. The
 * wave-mode camera (handled by CameraRig in WallScene) lifts above the
 * surface and pitches downward so the rows recede into a real horizon
 * line — bird's-eye onto a horizontal sea, not a wall of blobs.
 *
 *     y = waveHeight(x, z, t) + Σ ripple_i(x, z, t)
 *
 * Each new upload also enqueues a one-shot circular ripple that radiates
 * outward from its cell — calm-1 arrivals barely whisper, turbulent-5
 * arrivals make a real splash. Ripples self-prune after RIPPLE_DURATION.
 */

const SCAFFOLD_RADIUS = 0.36
const SCAFFOLD_VISUAL_SCALE = 0.30
const USER_VISUAL_SCALE = 0.34

export type WaveStageProps = {
  entries: WallEntry[]
  /** Canvas width in CSS px (drives layout aspect → grid extents). */
  width: number
  /** Canvas height in CSS px. */
  height: number
  /** Camera distance and FOV — must match WallScene's settings so the
   *  default sea layout fits the visible frustum. */
  cameraZ: number
  cameraFov: number
}

export function WaveStage({ entries, width, height, cameraZ, cameraFov }: WaveStageProps) {
  const reducedMotion = usePrefersReducedMotion()

  const layout = useMemo(() => {
    const aspect = height > 0 ? width / height : 1.6
    return defaultWaveLayout(cameraFov, aspect, cameraZ)
  }, [width, height, cameraZ, cameraFov])

  const scaffold = useMemo<ScaffoldCell[]>(
    () => generateScaffoldGrid(layout, SCAFFOLD_RADIUS),
    [layout],
  )

  // Wave parameters depend on the room's storm factor; recomputed only
  // when entries change (and reducedMotion toggles).
  const waveParams = useMemo(
    () => computeWaveParams(entries, reducedMotion),
    [entries, reducedMotion],
  )

  // Cell assignment lives in a ref so it survives re-renders. We reconcile
  // synchronously at render time so user meshes know which cell they own
  // before the first useFrame tick.
  const assignRef = useRef<CellAssignmentMaps>({
    byParticipant: new Map(),
    byCell: new Map(),
  })
  reconcileCellAssignments(entries, assignRef.current)

  // Ripple queue: prune-on-step. New entries trigger a fresh ripple in the
  // effect below.
  const ripplesRef = useRef<Ripple[]>([])
  const seenIdsRef = useRef<Set<string>>(new Set())
  const wallClockRef = useRef(0)

  useEffect(() => {
    const seen = seenIdsRef.current
    const newcomers: WallEntry[] = []
    const now = wallClockRef.current
    for (const e of entries) {
      if (!seen.has(e.participantId)) {
        seen.add(e.participantId)
        newcomers.push(e)
      }
    }
    // Prune ids no longer present so a re-upload after disconnect would
    // ripple again (unusual at our project scale; correctness still matters).
    for (const id of Array.from(seen)) {
      if (!entries.find((e) => e.participantId === id)) seen.delete(id)
    }

    // Skip ripples on the very first paint — otherwise loading 30 test blobs
    // would explode into 30 simultaneous splashes.
    const isFirstPaint = ripplesRef.current.length === 0 && now === 0
    if (isFirstPaint) return

    for (const e of newcomers) {
      const cellIdx = assignRef.current.byParticipant.get(e.participantId)
      if (cellIdx === undefined || cellIdx < 0) continue
      const cell = scaffold[cellIdx]
      if (!cell) continue
      ripplesRef.current.push({
        originX: cell.x,
        originZ: cell.z,
        startTime: now,
        amplitude: rippleAmplitudeFor(e.turbulence) * (reducedMotion ? 0.5 : 1),
      })
    }
  }, [entries, scaffold, reducedMotion])

  // Mesh refs keyed by cell index (scaffold) and participant id (users).
  const scaffoldMeshes = useRef<Array<THREE.Mesh | null>>(
    new Array(WAVE_SCAFFOLD_COUNT).fill(null),
  )
  const userMeshes = useRef<Map<string, THREE.Mesh>>(new Map())

  useFrame((_, dt) => {
    wallClockRef.current += dt
    const t = wallClockRef.current

    // Prune expired ripples (cheap O(n)).
    if (ripplesRef.current.length > 0) {
      ripplesRef.current = ripplesRef.current.filter((r) => t - r.startTime <= 2.5)
    }

    const heightAt = (x: number, z: number) => {
      let y = waveHeight(x, z, t, waveParams)
      for (const r of ripplesRef.current) y += rippleHeight(x, z, t, r)
      return y
    }

    // Drive scaffold blobs. Cells occupied by a user blob are hidden so the
    // user's multicolor blob "takes the seat" without a visual stack.
    for (let i = 0; i < WAVE_SCAFFOLD_COUNT; i++) {
      const mesh = scaffoldMeshes.current[i]
      if (!mesh) continue
      const cell = scaffold[i]
      if (!cell) continue
      const occupied = assignRef.current.byCell.has(i)
      mesh.visible = !occupied
      if (!occupied) {
        mesh.position.set(cell.x, heightAt(cell.x, cell.z), cell.z)
      }
    }

    // Drive user blobs at their assigned cells.
    for (const [id, cellIdx] of assignRef.current.byParticipant.entries()) {
      if (cellIdx < 0) continue
      const cell = scaffold[cellIdx]
      const mesh = userMeshes.current.get(id)
      if (!cell || !mesh) continue
      mesh.position.set(cell.x, heightAt(cell.x, cell.z), cell.z)
    }
  })

  return (
    <group>
      {scaffold.map((cell) => (
        <ScaffoldBlob
          key={`scaffold-${cell.index}`}
          cell={cell}
          meshesRef={scaffoldMeshes}
        />
      ))}
      {entries.map((e) => {
        const cellIdx = assignRef.current.byParticipant.get(e.participantId) ?? -1
        if (cellIdx < 0) return null
        const cell = scaffold[cellIdx]
        if (!cell) return null
        return (
          <UserBlobOnWave
            key={e.participantId}
            entry={e}
            cell={cell}
            meshesRef={userMeshes}
          />
        )
      })}
    </group>
  )
}

type ScaffoldBlobProps = {
  cell: ScaffoldCell
  meshesRef: React.MutableRefObject<Array<THREE.Mesh | null>>
}

function ScaffoldBlob({ cell, meshesRef }: ScaffoldBlobProps) {
  const localRef = useRef<THREE.Mesh | null>(null)
  useEffect(() => {
    const mesh = localRef.current
    meshesRef.current[cell.index] = mesh
    return () => {
      if (meshesRef.current[cell.index] === mesh) {
        meshesRef.current[cell.index] = null
      }
    }
  }, [cell.index, meshesRef])

  return (
    <mesh
      ref={localRef}
      position={[cell.x, 0, cell.z]}
      scale={SCAFFOLD_VISUAL_SCALE}
    >
      {/* Lower-detail icosahedron — scaffold blobs are smaller on screen and
          we have 96 of them, so we save vertices vs the user blobs (24). */}
      <icosahedronGeometry args={[1, 8]} />
      <PaletteSphereMaterial
        palette={DEFAULT_SCAFFOLD_PALETTE}
        seed={`scaffold-${cell.index}`}
        turbulence={TURBULENCE_DEFAULT}
        animate
      />
    </mesh>
  )
}

type UserBlobProps = {
  entry: WallEntry
  cell: ScaffoldCell
  meshesRef: React.MutableRefObject<Map<string, THREE.Mesh>>
}

function UserBlobOnWave({ entry, cell, meshesRef }: UserBlobProps) {
  const localRef = useRef<THREE.Mesh | null>(null)
  const hasPalette = entry.palette && entry.palette.length >= 2
  const fallback = `rgb(${entry.r}, ${entry.g}, ${entry.b})`

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
    <mesh
      ref={localRef}
      position={[cell.x, 0, cell.z]}
      scale={USER_VISUAL_SCALE}
    >
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
