import type { TurbulenceRating } from '../components/TurbulenceSelector'

/**
 * Canonical mapping between the 1–5 "how turbulent is your day?" rating and
 * all the downstream behaviors it controls.
 *
 * Two orthogonal effects are derived from the same rating:
 *
 * 1. **Shader multipliers** — scale the blob's breathing/churning uniforms
 *    (`uSpeed`, `uNoiseStrength`, `uAmp`, `uBreathAmp`) relative to our
 *    existing defaults, which correspond to rating 3 (every mult = 1.0).
 *    Calm blobs barely move; turbulent blobs visibly seethe.
 *
 * 2. **Physics behavior** — per-sphere `maxSpeed`, horizontal/vertical
 *    ambient jitter, a vertical band spring (`homeK`) that tries to keep the
 *    sphere in its emotional band, and an optional vertical damping
 *    (`yDamp`) so calm spheres flow mostly horizontally.
 *
 * Keeping both in one place means the selector, the shader, and the wall
 * physics never drift out of sync.
 */

export const TURBULENCE_DEFAULT: TurbulenceRating = 3

export type ShaderMultipliers = {
  /** `uSpeed` multiplier — how fast the noise evolves over time. */
  speed: number
  /** `uNoiseStrength` multiplier — how far each vertex is displaced. */
  strength: number
  /** `uAmp` multiplier — how aggressively the latitude twist cuts grooves. */
  amp: number
  /** `uBreathAmp` multiplier — how much the whole sphere inhales/exhales. */
  breath: number
}

export type PhysicsBehavior = {
  /** Hard cap on velocity magnitude for this sphere. */
  maxSpeed: number
  /** Per-step horizontal jitter amplitude. */
  jitterX: number
  /** Per-step vertical jitter amplitude (kept low for calm = horizontal flow). */
  jitterY: number
  /** Spring constant pulling the sphere toward its emotional band's homeY. */
  homeK: number
  /** Extra vertical velocity damping per second (calm = damped to near-horizontal). */
  yDamp: number
  /** -1 bottom band (calm), 0 middle (mixed), +1 top (turbulent). */
  band: -1 | 0 | 1
}

const SHADER_TABLE: Record<TurbulenceRating, ShaderMultipliers> = {
  1: { speed: 0.35, strength: 0.5,  amp: 0.5,  breath: 0.4 },
  2: { speed: 0.6,  strength: 0.75, amp: 0.75, breath: 0.7 },
  3: { speed: 1.0,  strength: 1.0,  amp: 1.0,  breath: 1.0 },
  4: { speed: 1.4,  strength: 1.25, amp: 1.2,  breath: 1.3 },
  5: { speed: 1.9,  strength: 1.5,  amp: 1.4,  breath: 1.6 },
}

const PHYSICS_TABLE: Record<TurbulenceRating, PhysicsBehavior> = {
  1: { maxSpeed: 0.6, jitterX: 0.0030, jitterY: 0.0005, homeK: 1.2, yDamp: 1.6, band: -1 },
  2: { maxSpeed: 1.0, jitterX: 0.0035, jitterY: 0.0015, homeK: 0.8, yDamp: 0.8, band: -1 },
  3: { maxSpeed: 1.6, jitterX: 0.0040, jitterY: 0.0040, homeK: 0.4, yDamp: 0.1, band:  0 },
  4: { maxSpeed: 2.4, jitterX: 0.0070, jitterY: 0.0070, homeK: 0.8, yDamp: 0.2, band: +1 },
  5: { maxSpeed: 3.2, jitterX: 0.0120, jitterY: 0.0120, homeK: 1.2, yDamp: 0.3, band: +1 },
}

/**
 * Reduced-motion users get a gentler variant: shader multipliers are
 * compressed ~±20% around 1.0.
 *
 * Accepts any `number` so wall-side code (which stores `turbulence: number`
 * on each physics sphere to avoid importing UI types) can call this without
 * casting; out-of-range values fall back to the middle rating.
 */
export function shaderMultipliers(
  rating: number,
  reducedMotion = false,
): ShaderMultipliers {
  const r = normalizeTurbulence(rating)
  if (reducedMotion) {
    const m = 1 + (r - 3) * 0.1
    return { speed: m, strength: m, amp: m, breath: m }
  }
  return SHADER_TABLE[r]
}

/**
 * Physics behavior for a given rating. See notes on `shaderMultipliers`
 * re: accepting `number` rather than the branded `TurbulenceRating` —
 * same reasoning applies (physics layer stays UI-type-free).
 */
export function physicsBehavior(
  rating: number,
  reducedMotion = false,
): PhysicsBehavior {
  const r = normalizeTurbulence(rating)
  const base = PHYSICS_TABLE[r]
  if (!reducedMotion) return base
  return {
    ...base,
    maxSpeed: Math.min(base.maxSpeed, 1.0),
    jitterX: base.jitterX * 0.4,
    jitterY: base.jitterY * 0.4,
  }
}

/**
 * Clamp a possibly-loose number (from DB / user input) into a valid rating.
 * Defaults to the middle if the value is missing or out of range.
 */
export function normalizeTurbulence(v: unknown): TurbulenceRating {
  if (typeof v !== 'number' || !Number.isFinite(v)) return TURBULENCE_DEFAULT
  const rounded = Math.round(v)
  if (rounded < 1 || rounded > 5) return TURBULENCE_DEFAULT
  return rounded as TurbulenceRating
}
