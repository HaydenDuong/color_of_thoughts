import type { PaletteColor } from './colorFromImage'
import type { WallEntry } from './wallData'

/**
 * Wave-mode color logic.
 *
 * v1 design (Option A): the **scaffold sea is always deep navy**, by intent
 * — the room's mood comes through via the wave's *motion* (amplitude /
 * speed / choppiness from the storm factor) and via the user blobs popping
 * out against the navy. Earlier drafts blended a calm/turbulent collective
 * palette into the scaffold itself; that ended up looking like 96 colorful
 * blobs in a grid (no contrast, no "sea" reading), so we reverted.
 *
 * `derivePalette` is kept exported because it's still useful for future
 * features (e.g. tinting ripples with the uploader's dominant color, or a
 * subtle scaffold tint as a v2 polish).
 */

const TOP_K_PER_USER = 3
const OUTPUT_SIZE = 5

/**
 * The deep-navy palette every scaffold blob renders with. Multi-tone so
 * the existing band-shader still reads as "ocean depth" instead of a flat
 * mute color, but well within the navy family so user blobs stay clearly
 * distinct on top.
 */
export const DEFAULT_SCAFFOLD_PALETTE: PaletteColor[] = [
  { r: 26,  g: 41,  b: 87,  hex: '#1A2957', weight: 0.45 },
  { r: 38,  g: 56,  b: 110, hex: '#26386E', weight: 0.25 },
  { r: 58,  g: 78,  b: 138, hex: '#3A4E8A', weight: 0.15 },
  { r: 16,  g: 27,  b: 64,  hex: '#101B40', weight: 0.10 },
  { r: 76,  g: 99,  b: 165, hex: '#4C63A5', weight: 0.05 },
]

function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
  return `#${h(r)}${h(g)}${h(b)}`
}

/**
 * Pool the given users' top colors into a single weighted list and return
 * the top `OUTPUT_SIZE` as a normalized palette. Returns `null` if no users
 * are provided so the caller can fall back to the default.
 *
 * Algorithm:
 *   1. From each user, take their top-3 palette colors.
 *   2. Weight each by `userWeight * colorWeight` where `userWeight = 1/N`
 *      (every user contributes equally).
 *   3. Sort pooled colors by weight desc, take top OUTPUT_SIZE, normalize.
 *
 * Limitations we accept: no deduplication (5 reds will stay 5 reds — the
 * room IS red), no k-means clustering. Good enough at our scale; revisit
 * if v2 ever uses this for visible scaffold tinting.
 */
export function derivePalette(entries: WallEntry[]): PaletteColor[] | null {
  if (entries.length === 0) return null

  const userWeight = 1 / entries.length
  const pool: Array<{ r: number; g: number; b: number; weight: number }> = []

  for (const entry of entries) {
    if (!entry.palette || entry.palette.length === 0) continue
    const top = entry.palette.slice(0, TOP_K_PER_USER)
    for (const c of top) {
      pool.push({
        r: c.r,
        g: c.g,
        b: c.b,
        weight: userWeight * Math.max(0, c.weight),
      })
    }
  }

  if (pool.length === 0) return null

  pool.sort((a, b) => b.weight - a.weight)
  const top = pool.slice(0, OUTPUT_SIZE)
  const sum = top.reduce((s, c) => s + c.weight, 0) || 1

  return top.map((c) => ({
    r: c.r,
    g: c.g,
    b: c.b,
    hex: rgbToHex(c.r, c.g, c.b),
    weight: c.weight / sum,
  }))
}
