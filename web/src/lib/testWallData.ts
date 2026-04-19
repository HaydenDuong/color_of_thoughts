import type { PaletteColor } from './colorFromImage'
import type { WallEntry } from './wallData'
import { normalizeTurbulence } from './turbulence'

/**
 * Deterministic synthesized wall data for dev / QA.
 *
 * Activated via `/wall?test=N` (see `WallPage`). Never touches Supabase —
 * entries are generated client-side from a seeded RNG so the same `?test=30`
 * URL always yields the exact same 30 blobs on every refresh.
 *
 * Not included in any production code path; invoking `generateTestEntries`
 * outside `WallPage.test` mode is a no-op as far as the DB is concerned.
 */

// ---------------------------------------------------------------------------
// Mulberry32 PRNG — 32-bit seed, tiny and deterministic.
// ---------------------------------------------------------------------------

function mulberry32(seed: number): () => number {
  let s = seed >>> 0
  return () => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

// ---------------------------------------------------------------------------
// Color helpers
// ---------------------------------------------------------------------------

function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const i = Math.floor(h * 6)
  const f = h * 6 - i
  const p = v * (1 - s)
  const q = v * (1 - f * s)
  const t = v * (1 - (1 - f) * s)
  let r = 0, g = 0, b = 0
  switch (i % 6) {
    case 0: r = v; g = t; b = p; break
    case 1: r = q; g = v; b = p; break
    case 2: r = p; g = v; b = t; break
    case 3: r = p; g = q; b = v; break
    case 4: r = t; g = p; b = v; break
    case 5: r = v; g = p; b = q; break
  }
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)]
}

function toHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

// ---------------------------------------------------------------------------
// Palette generator
// ---------------------------------------------------------------------------

/**
 * Crayon-style palette: pick a random base hue per entry, then sample
 * 5–8 related colors by spreading around that hue with varied saturation
 * and value so the blob gets real color contrast (not monochrome).
 * Weights are randomized then normalized and sorted descending.
 */
function generatePalette(rng: () => number): PaletteColor[] {
  const size = 5 + Math.floor(rng() * 4) // 5..8
  const baseHue = rng()
  const hueSpread = 0.25 + rng() * 0.45 // dominant family vs rainbow mix

  const raw: Array<{ r: number; g: number; b: number; weight: number }> = []
  let weightSum = 0
  for (let i = 0; i < size; i++) {
    const hue = (baseHue + (rng() - 0.5) * hueSpread + 1) % 1
    const sat = 0.45 + rng() * 0.5
    const val = 0.55 + rng() * 0.45
    const [r, g, b] = hsvToRgb(hue, sat, val)
    const w = 0.1 + rng() * 0.9
    weightSum += w
    raw.push({ r, g, b, weight: w })
  }

  return raw
    .map((c) => ({ ...c, weight: c.weight / weightSum, hex: toHex(c.r, c.g, c.b) }))
    .sort((a, b) => b.weight - a.weight)
}

// ---------------------------------------------------------------------------
// Public API
// ---------------------------------------------------------------------------

/**
 * Forces the turbulence-rating distribution of synthesized entries. Use this
 * to put the wave (or any rating-driven mode) into a known emotional state
 * for QA without needing 30 real uploads. Storm factor in the wave is
 * `(turb − calm) / (turb + calm)`, so:
 *
 *   - `'calm'`      — every entry rated 1 or 2 (storm = -1 → gentle swells).
 *   - `'turbulent'` — every entry rated 4 or 5 (storm = +1 → tall fast chop).
 *   - `'neutral'`   — every entry rated 3 (storm undefined → ambient swell,
 *                     useful for verifying the no-polar-users path).
 *   - `'mixed'`     — uniform random 1..5 (the original behavior; default).
 */
export type StormBias = 'calm' | 'turbulent' | 'mixed' | 'neutral'

function pickRating(rng: () => number, bias: StormBias): number {
  switch (bias) {
    case 'calm':      return 1 + Math.floor(rng() * 2)        // 1..2
    case 'turbulent': return 4 + Math.floor(rng() * 2)        // 4..5
    case 'neutral':   return 3
    case 'mixed':
    default:          return 1 + Math.floor(rng() * 5)        // 1..5
  }
}

/**
 * Build `n` synthesized wall entries. `seed` controls the full set, so the
 * same `(n, seed, bias)` triple is perfectly reproducible. Clamped to 1..200
 * so a stray `?test=100000` URL can't melt the renderer.
 *
 * `bias` lets the URL force a calm- or turbulent-dominant room (see
 * `StormBias`); default `'mixed'` matches the original random distribution.
 */
export function generateTestEntries(
  n: number,
  seed = 1337,
  bias: StormBias = 'mixed',
): WallEntry[] {
  const count = Math.max(1, Math.min(200, Math.round(n)))
  const rng = mulberry32(seed)

  const entries: WallEntry[] = []
  for (let i = 0; i < count; i++) {
    const palette = generatePalette(rng)
    const primary = palette[0]
    const rating = normalizeTurbulence(pickRating(rng, bias))
    entries.push({
      participantId: `test-${seed}-${bias}-${i}`,
      displayName: `Test #${i + 1}`,
      r: primary.r,
      g: primary.g,
      b: primary.b,
      hex: primary.hex,
      palette,
      turbulence: rating,
    })
  }
  return entries
}
