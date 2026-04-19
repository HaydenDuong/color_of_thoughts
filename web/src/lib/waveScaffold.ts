import type { WallEntry } from './wallData'

/**
 * Wave-mode scaffold + animation primitives.
 *
 * **Coordinate system (important):** the sea is a horizontal surface in the
 * **X–Z plane**. Each scaffold cell has a fixed (x, z) position; the wave
 * function drives **Y** (up/down). Rows run from `zNear` (closest to the
 * camera) to `zFar` (deepest into the screen) so the grid reads as a real
 * horizon line under the tilted wave-mode camera.
 *
 * The wave is a Tessendorf-style ocean approximation: a sum of overlapping
 * sinusoidal travelling waves.
 *
 *     y(x, z, t) = globalAmplitude * Σ_i amp_i * sin(kx_i*x*freqScale +
 *                                                   kz_i*z*freqScale +
 *                                                   ω_i*t*speed + φ_i)
 *
 * The four octaves below use mutually-incommensurate angles + frequencies
 * so the result never looks repeating.
 *
 * Wave params (amplitude, frequency, speed) are derived from the room's
 * "storm factor" — `(turbCount - calmCount) / (turbCount + calmCount)`.
 * Calm rooms get gentle slow swells; turbulent rooms get fast tall chop.
 *
 * One-shot **ripples** are added on top: each new upload broadcasts a
 * damped circular wave from its assigned cell that travels outward and
 * decays over ~2.5s. Ripple amplitude scales with the uploader's
 * turbulence rating so a turbulent-5 arrival makes a noticeable splash
 * while a calm-1 arrival barely whispers.
 */

// ---------------------------------------------------------------------------
// Grid layout
// ---------------------------------------------------------------------------

export const WAVE_GRID_COLS = 12
export const WAVE_GRID_ROWS = 8
export const WAVE_SCAFFOLD_COUNT = WAVE_GRID_COLS * WAVE_GRID_ROWS // 96

export type ScaffoldCell = {
  /** 0..WAVE_SCAFFOLD_COUNT-1, row-major. Stable across renders. */
  index: number
  /** Column 0..COLS-1 (left → right along world X). */
  col: number
  /** Row 0..ROWS-1 (near → far along world -Z; row 0 = closest to camera). */
  row: number
  /** Resting world-space (x, z). y is animated by the wave function. */
  x: number
  z: number
}

/**
 * Floor extents for the sea surface in world space. The grid is laid out
 * across [xMin, xMax] in X and recedes from `zNear` (closest, largest Z)
 * to `zFar` (deepest, smallest Z) — so for our right-handed camera looking
 * down -Z, `zNear > zFar`.
 */
export type WaveLayout = {
  xMin: number
  xMax: number
  zNear: number
  zFar: number
}

/**
 * Build a default sea layout from the camera's perspective parameters.
 * The X width is sized to the visible frustum at the wave's resting plane
 * (Y=0, Z=0) so the side-most cells stay just inside the picture edge,
 * and Z extends from a small near plane (in front of origin) out into
 * negative Z (away from camera) so the horizon recedes into the distance.
 */
export function defaultWaveLayout(
  cameraFov: number,
  aspect: number,
  cameraZ: number,
): WaveLayout {
  const halfH = Math.tan((cameraFov * Math.PI) / 360) * cameraZ
  const halfW = halfH * Math.max(aspect, 0.0001)
  return {
    xMin: -halfW + 0.4,
    xMax: halfW - 0.4,
    zNear: 1.5,   // close-to-camera row sits just behind origin
    zFar: -4.5,   // far row recedes well past origin
  }
}

/**
 * Compute the scaffold grid for the given sea layout. Cells are inset by
 * `sphereRadius` so blobs at the rest height (Y=0) fit cleanly within the
 * sea bounds and don't clip neighbours.
 */
export function generateScaffoldGrid(
  layout: WaveLayout,
  sphereRadius: number,
): ScaffoldCell[] {
  const innerW = Math.max(0, layout.xMax - layout.xMin - 2 * sphereRadius)
  const innerD = Math.max(0, layout.zNear - layout.zFar - 2 * sphereRadius)
  const dx = WAVE_GRID_COLS > 1 ? innerW / (WAVE_GRID_COLS - 1) : 0
  const dz = WAVE_GRID_ROWS > 1 ? innerD / (WAVE_GRID_ROWS - 1) : 0
  const x0 = layout.xMin + sphereRadius
  // Row 0 is the NEAREST row (largest Z), so we step in the -Z direction.
  const z0 = layout.zNear - sphereRadius

  const cells: ScaffoldCell[] = []
  for (let row = 0; row < WAVE_GRID_ROWS; row++) {
    for (let col = 0; col < WAVE_GRID_COLS; col++) {
      cells.push({
        index: row * WAVE_GRID_COLS + col,
        col,
        row,
        x: x0 + col * dx,
        z: z0 - row * dz,
      })
    }
  }
  return cells
}

// ---------------------------------------------------------------------------
// Wave function (summed sines)
// ---------------------------------------------------------------------------

export type WaveParams = {
  /** Overall vertical scale of the wave (world units, Y axis). */
  globalAmplitude: number
  /** Multiplies the spatial frequency of every octave. */
  frequencyScale: number
  /** Multiplies the time evolution rate of every octave. */
  speed: number
  /** Optional sharpening that turns smooth sines into peaked crests (0..1). */
  choppiness: number
}

// Octave design — tuned so the **low-frequency octaves dominate the
// silhouette** (~88% of the energy) and the high-frequency octaves are
// just texture riding on top (~12%). Earlier tuning had the four octaves
// at similar amplitudes, which meant the high-freq detail (k_eff ~ 2.6
// at storm-end) overwhelmed the dominant swell — adjacent blobs ended
// up ~104° apart in phase and the result looked like 60 individual
// pogo-sticks instead of a coherent wave surface.
//
// Octave 0 is the dominant X-marching swell (long crest line parallel
// to Z, wave moves left↔right). Base kx tuned so at storm-end (~1.6
// freqScale) we see ~2 full swells across the visible X width while
// adjacent cells stay only ~60° apart in phase (smooth gradient, not
// scrambled). Octave 1 is a secondary Z-marching swell (long crest line
// parallel to X, wave moves toward/away from camera). Octaves 2 and 3
// are small high-freq diagonal detail — sea texture, not silhouette.
const OCTAVES = [
  { kx:  1.10, kz:  0.10, omega: 0.85, amp: 1.50, phase: 0.0 },
  { kx:  0.05, kz:  0.85, omega: 0.75, amp: 1.00, phase: 1.7 },
  { kx:  1.45, kz:  0.50, omega: 1.20, amp: 0.18, phase: 3.1 },
  { kx: -0.65, kz:  1.20, omega: 1.05, amp: 0.15, phase: 4.6 },
] as const

const OCTAVE_WEIGHT_SUM = OCTAVES.reduce((s, o) => s + o.amp, 0)

/**
 * Evaluate the global wave height (Y) at world position (x, z) at time t.
 * The result is normalized so that `globalAmplitude=1` produces peaks of
 * roughly ±1 world unit.
 */
export function waveHeight(x: number, z: number, t: number, p: WaveParams): number {
  let y = 0
  for (const o of OCTAVES) {
    const phase =
      o.kx * x * p.frequencyScale +
      o.kz * z * p.frequencyScale +
      o.omega * t * p.speed +
      o.phase
    let s = Math.sin(phase)
    if (p.choppiness > 0) {
      // Sharpening: bias the sine toward its sign — peaks get pointier,
      // troughs flatten. Classic ocean-shader trick. Lerp by `choppiness`
      // so we can scale the effect with storm. Stronger coefficient (3.0)
      // so the storm-end actually reads as peaked crests instead of softer
      // sines; at chop=1 the exponent collapses to 0.25, pushing |s|→1.
      const sharp = Math.sign(s) * Math.pow(Math.abs(s), 1 / (1 + 3.0 * p.choppiness))
      s = s * (1 - p.choppiness) + sharp * p.choppiness
    }
    y += o.amp * s
  }
  return (y / OCTAVE_WEIGHT_SUM) * p.globalAmplitude
}

/**
 * **Neutral** ambient swell: what the wall does when nobody has uploaded
 * yet OR when only rating-3 users are present (storm factor undefined).
 *
 * Tuned to sit decisively *between* calm and turbulent so the three states
 * look obviously distinct: calm is almost glassy (~0.04 amp, near-flat
 * sea), neutral is a clearly visible rolling sea (~0.22 amp), turbulent is
 * a wild chop (~0.95 amp + sharpened crests). Earlier values had neutral
 * (0.10 amp) only marginally above calm (0.06), which is why the two
 * states looked nearly identical.
 */
export function defaultWaveParams(): WaveParams {
  return { globalAmplitude: 0.22, frequencyScale: 0.70, speed: 0.50, choppiness: 0 }
}

/**
 * Map the room's storm factor to wave params. `storm` is in [-1, +1]:
 *   -1 = all calm     → almost-glassy, one giant slow swell
 *    0 = balanced     → moderate rolling sea (mid-energy)
 *   +1 = all turbulent → modest-height surface vibrating *fast* —
 *                        each blob bobs up and down rapidly as the
 *                        wave races through. Reads as agitated /
 *                        shivering sea, not "blobs popping up".
 *
 * **Storm energy is encoded primarily as TEMPORAL frequency, not
 * spatial amplitude.** Earlier tuning made turbulent waves very tall
 * (amp 0.95) which pushed adjacent blobs to wildly different heights —
 * the eye read that as individual blobs popping/jumping rather than as
 * a coherent agitated sea. Real ocean chop is the opposite: modest
 * height variation, but the surface vibrates fast (a boat in a storm
 * gets jiggled rapidly, not lifted 5m up). So at the storm end we cap
 * amplitude at 0.45, lower freqMax to keep neighbours synced, and
 * crank speedMax to 3.0 — that's the dial that makes turbulent feel
 * truly turbulent.
 *
 * Reduced-motion users get amplitude/speed/choppiness compressed.
 */
export function computeWaveParams(
  entries: WallEntry[],
  reducedMotion = false,
): WaveParams {
  let calm = 0
  let turb = 0
  for (const e of entries) {
    if (e.turbulence <= 2) calm++
    else if (e.turbulence >= 4) turb++
  }
  const polar = calm + turb
  if (polar === 0) {
    const ambient = defaultWaveParams()
    if (reducedMotion) {
      ambient.globalAmplitude *= 0.5
      ambient.speed *= 0.5
    }
    return ambient
  }

  const storm = (turb - calm) / polar // -1..+1
  const t = (storm + 1) / 2 // 0..1

  // Amplitude grows ~11× calm→turbulent (height range stays modest at
  // turbulent end so the surface stays coherent — no popcorn).
  // Frequency grows ~4× calm→turbulent (kept low enough that adjacent
  // cells still ride the wave together).
  // Speed grows ~17× calm→turbulent — this is the dominant "storm"
  // dial. Each blob personally bobs up/down ~2.5× faster at storm-end
  // than the previous tuning, which is what makes the sea read as
  // agitated/vibrating instead of just tall.
  const ampMin = 0.04,  ampMax = 0.65
  const freqMin = 0.28, freqMax = 1.20
  const speedMin = 0.18, speedMax = 6.50
  // Choppiness ramp: 0 below 30% storm (so calm + balanced stay smooth),
  // 0.6 at full turbulence — gentler than before because amplitude is
  // also lower; over-sharpening tiny waves looks weird.
  const chopT0 = 0.30
  const choppiness = Math.max(0, (t - chopT0) / (1 - chopT0)) * 0.6

  const params: WaveParams = {
    globalAmplitude: ampMin + t * (ampMax - ampMin),
    frequencyScale:  freqMin + t * (freqMax - freqMin),
    speed:           speedMin + t * (speedMax - speedMin),
    choppiness,
  }

  if (reducedMotion) {
    params.globalAmplitude *= 0.5
    params.speed *= 0.5
    params.choppiness *= 0.5
  }
  return params
}

// ---------------------------------------------------------------------------
// Ripples (one-shot circular wave from a new upload's cell)
// ---------------------------------------------------------------------------

export type Ripple = {
  /** Origin world-space (x, z) — the cell the uploader was assigned. */
  originX: number
  originZ: number
  /** Wall-clock time (seconds) when the ripple was spawned. */
  startTime: number
  /** Peak height in world units (Y); scales with uploader's turbulence rating. */
  amplitude: number
}

export const RIPPLE_DURATION = 2.5
const RIPPLE_SPEED = 1.6
const RIPPLE_WAVELENGTH = 0.7
const RIPPLE_TIME_DECAY = 1.0
const RIPPLE_DISTANCE_DECAY = 0.45

/**
 * Evaluate a single ripple's contribution to the height at (x, z, t).
 * Returns 0 once the ripple has expired so callers can prune them safely.
 */
export function rippleHeight(x: number, z: number, t: number, r: Ripple): number {
  const elapsed = t - r.startTime
  if (elapsed < 0 || elapsed > RIPPLE_DURATION) return 0

  const dx = x - r.originX
  const dz = z - r.originZ
  const dist = Math.sqrt(dx * dx + dz * dz)

  const timeDecay = Math.exp(-elapsed * RIPPLE_TIME_DECAY) * (1 - elapsed / RIPPLE_DURATION)
  const distDecay = Math.exp(-dist * RIPPLE_DISTANCE_DECAY)
  const phase = (dist - elapsed * RIPPLE_SPEED) * (Math.PI * 2 / RIPPLE_WAVELENGTH)

  return r.amplitude * timeDecay * distDecay * Math.sin(phase)
}

/**
 * Map a turbulence rating (1..5) to the peak ripple amplitude.
 * Calm-1 = 0.08, neutral-3 = 0.39, turbulent-5 = 0.70 world units.
 *
 * Range widened (was 0.10..0.45) so a turbulent uploader makes a
 * visible cannonball-style splash, consistent with the stormier
 * ambient swell at the turbulent end.
 */
export function rippleAmplitudeFor(turbulence: number): number {
  const t = Math.max(1, Math.min(5, turbulence))
  return 0.08 + ((t - 1) / 4) * 0.62
}

// ---------------------------------------------------------------------------
// Cell assignment for user blobs (hash + linear probe)
// ---------------------------------------------------------------------------

function hashUnit(seed: string, salt: number): number {
  let h = 2166136261 ^ (salt * 0x9e3779b9)
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

/**
 * Initial preferred cell index for a given participant id. Two participants
 * may collide — the caller resolves with linear probing across the full
 * grid so every active user occupies a unique cell.
 */
export function preferredCellIndex(participantId: string): number {
  return Math.floor(hashUnit(participantId, 31) * WAVE_SCAFFOLD_COUNT) % WAVE_SCAFFOLD_COUNT
}

/**
 * Resolve `entries` to stable per-participant cell indices, reusing prior
 * assignments where possible and probing forward to break collisions.
 *
 * Caller passes in the previous assignment Map; we mutate it (add new ids,
 * remove gone ids) and return it for convenience. Two-way maps are kept in
 * sync so the caller can also ask "which user is on cell N?" cheaply.
 *
 * If `entries.length > WAVE_SCAFFOLD_COUNT`, the overflow ids stay
 * un-assigned (return value of -1 in `assignments`); the caller should
 * skip rendering them. We don't expect this to happen at the project's
 * realistic scale (50–60 users on a 96-cell grid).
 */
export type CellAssignmentMaps = {
  /** participantId → cellIndex (or -1 if unassigned due to overflow). */
  byParticipant: Map<string, number>
  /** cellIndex → participantId (only set for assigned cells). */
  byCell: Map<number, string>
}

export function reconcileCellAssignments(
  entries: ReadonlyArray<{ participantId: string }>,
  prev: CellAssignmentMaps,
): CellAssignmentMaps {
  const wanted = new Set(entries.map((e) => e.participantId))

  // 1. Drop assignments for participants no longer present.
  for (const id of Array.from(prev.byParticipant.keys())) {
    if (!wanted.has(id)) {
      const cell = prev.byParticipant.get(id)
      prev.byParticipant.delete(id)
      if (cell !== undefined && cell >= 0 && prev.byCell.get(cell) === id) {
        prev.byCell.delete(cell)
      }
    }
  }

  // 2. Assign cells for new participants via linear probe.
  for (const e of entries) {
    if (prev.byParticipant.has(e.participantId)) continue
    const start = preferredCellIndex(e.participantId)
    let assigned = -1
    for (let step = 0; step < WAVE_SCAFFOLD_COUNT; step++) {
      const idx = (start + step) % WAVE_SCAFFOLD_COUNT
      if (!prev.byCell.has(idx)) {
        assigned = idx
        break
      }
    }
    prev.byParticipant.set(e.participantId, assigned)
    if (assigned >= 0) {
      prev.byCell.set(assigned, e.participantId)
    }
  }

  return prev
}
