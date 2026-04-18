import type { TurbulenceRating } from '../components/TurbulenceSelector'

/**
 * Canonical mapping between the 1–5 "how turbulent is your day?" rating and
 * all the downstream behaviors it controls.
 *
 * Three independent effects are derived from the same rating:
 *
 * 1. **Shader multipliers** — scale the blob's breathing/churning uniforms
 *    (`uSpeed`, `uNoiseStrength`, `uAmp`, `uBreathAmp`) relative to our
 *    defaults, which correspond to rating 3 (every mult = 1.0). Calm blobs
 *    barely move; turbulent blobs visibly seethe.
 *
 * 2. **Physics behaviors** — there are THREE wall modes, each with its own
 *    tuning table:
 *      - `bandsBehavior`  : original hard-band layout (kept as a hidden
 *                           comparison mode via `/wall?mode=bands`).
 *      - `flowBehavior`   : soft vertical gradient + per-rating motion
 *                           character (Perlin-ish drift for calm,
 *                           impulse kicks for turbulent).
 *      - `orbitBehavior`  : attractor / concentric orbits around the
 *                           canvas center (calm = wide slow, turbulent =
 *                           tight fast chaotic).
 *
 * Keeping everything in one file means the selector, the shader, and the
 * three wall modes never drift out of sync.
 */

export const TURBULENCE_DEFAULT: TurbulenceRating = 3

// ---------------------------------------------------------------------------
// Shader multipliers
// ---------------------------------------------------------------------------

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

const SHADER_TABLE: Record<TurbulenceRating, ShaderMultipliers> = {
  1: { speed: 0.35, strength: 0.5,  amp: 0.5,  breath: 0.4 },
  2: { speed: 0.6,  strength: 0.75, amp: 0.75, breath: 0.7 },
  3: { speed: 1.0,  strength: 1.0,  amp: 1.0,  breath: 1.0 },
  4: { speed: 1.4,  strength: 1.25, amp: 1.2,  breath: 1.3 },
  5: { speed: 1.9,  strength: 1.5,  amp: 1.4,  breath: 1.6 },
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

// ---------------------------------------------------------------------------
// Bands physics (original 3-layer mode, kept for comparison)
// ---------------------------------------------------------------------------

export type BandsBehavior = {
  /** Hard cap on velocity magnitude for this sphere. */
  maxSpeed: number
  /** Per-step horizontal jitter amplitude. */
  jitterX: number
  /** Per-step vertical jitter amplitude (kept low for calm = horizontal flow). */
  jitterY: number
  /** Spring constant pulling the sphere toward its band's homeY. */
  homeK: number
  /** Extra vertical velocity damping per second. */
  yDamp: number
  /** -1 bottom band (calm), 0 middle (mixed), +1 top (turbulent). */
  band: -1 | 0 | 1
}

const BANDS_TABLE: Record<TurbulenceRating, BandsBehavior> = {
  1: { maxSpeed: 0.6, jitterX: 0.0030, jitterY: 0.0005, homeK: 1.2, yDamp: 1.6, band: -1 },
  2: { maxSpeed: 1.0, jitterX: 0.0035, jitterY: 0.0015, homeK: 0.8, yDamp: 0.8, band: -1 },
  3: { maxSpeed: 1.6, jitterX: 0.0040, jitterY: 0.0040, homeK: 0.4, yDamp: 0.1, band:  0 },
  4: { maxSpeed: 2.4, jitterX: 0.0070, jitterY: 0.0070, homeK: 0.8, yDamp: 0.2, band: +1 },
  5: { maxSpeed: 3.2, jitterX: 0.0120, jitterY: 0.0120, homeK: 1.2, yDamp: 0.3, band: +1 },
}

export function bandsBehavior(rating: number, reducedMotion = false): BandsBehavior {
  const r = normalizeTurbulence(rating)
  const base = BANDS_TABLE[r]
  if (!reducedMotion) return base
  return {
    ...base,
    maxSpeed: Math.min(base.maxSpeed, 1.0),
    jitterX: base.jitterX * 0.4,
    jitterY: base.jitterY * 0.4,
  }
}

// ---------------------------------------------------------------------------
// Flow physics (default mode — soft gradient + distinctive motion character)
// ---------------------------------------------------------------------------

export type FlowBehavior = {
  maxSpeed: number
  /** Ambient x jitter, applied every step. Kept near-zero for calm. */
  jitterX: number
  /** Ambient y jitter. */
  jitterY: number
  /**
   * Weak spring toward the sphere's gradient home-y. An order of magnitude
   * smaller than bands-mode so spheres freely cross the gradient.
   */
  homeK: number
  /**
   * Calm spheres (ratings 1–2) steer velocity toward a slowly rotating
   * "drift" heading derived from their id + time, yielding curvy graceful
   * paths instead of linear billiard tracks. `driftSpeed` = target speed;
   * `driftSteer` = lerp rate per second (0 disables drift).
   */
  driftSpeed: number
  driftSteer: number
  /**
   * Turbulent spheres (ratings 4–5) receive periodic impulse kicks on top
   * of standard jitter, producing jagged agitated motion. `kickMin..Max` is
   * the Poisson-like random interval between kicks in seconds;
   * `kickStrength` is the peak velocity delta per kick.
   */
  kickMin: number
  kickMax: number
  kickStrength: number
}

const FLOW_TABLE: Record<TurbulenceRating, FlowBehavior> = {
  1: {
    maxSpeed: 0.8, jitterX: 0.0010, jitterY: 0.0003, homeK: 0.25, driftSpeed: 0.35, driftSteer: 1.4,
    kickMin: Infinity, kickMax: Infinity, kickStrength: 0,
  },
  2: {
    maxSpeed: 1.1, jitterX: 0.0015, jitterY: 0.0008, homeK: 0.20, driftSpeed: 0.55, driftSteer: 1.2,
    kickMin: Infinity, kickMax: Infinity, kickStrength: 0,
  },
  3: {
    maxSpeed: 1.6, jitterX: 0.0040, jitterY: 0.0040, homeK: 0.12, driftSpeed: 0, driftSteer: 0,
    kickMin: Infinity, kickMax: Infinity, kickStrength: 0,
  },
  4: {
    maxSpeed: 2.4, jitterX: 0.0060, jitterY: 0.0060, homeK: 0.18, driftSpeed: 0, driftSteer: 0,
    kickMin: 0.9, kickMax: 1.9, kickStrength: 0.55,
  },
  5: {
    maxSpeed: 3.2, jitterX: 0.0100, jitterY: 0.0100, homeK: 0.25, driftSpeed: 0, driftSteer: 0,
    kickMin: 0.4, kickMax: 1.0, kickStrength: 0.9,
  },
}

export function flowBehavior(rating: number, reducedMotion = false): FlowBehavior {
  const r = normalizeTurbulence(rating)
  const base = FLOW_TABLE[r]
  if (!reducedMotion) return base
  return {
    ...base,
    maxSpeed: Math.min(base.maxSpeed, 1.0),
    jitterX: base.jitterX * 0.4,
    jitterY: base.jitterY * 0.4,
    kickStrength: base.kickStrength * 0.4,
    driftSpeed: base.driftSpeed * 0.5,
  }
}

/**
 * Continuous soft-gradient home-y for flow mode:
 * rating 1 → bottom, rating 3 → center, rating 5 → top. Linear so the
 * ensemble perceives a gradient without ever looking like hard bands.
 */
export function flowHomeY(rating: number, minY: number, maxY: number): number {
  const r = normalizeTurbulence(rating)
  const t = (r - 1) / 4
  return minY + t * (maxY - minY)
}

// ---------------------------------------------------------------------------
// Orbit physics (attractor mode)
// ---------------------------------------------------------------------------

export type OrbitBehavior = {
  /** Fraction of `maxRadius` — larger = wider, more stately orbit. */
  radiusFraction: number
  /** Angular velocity in rad/s. Calm = slow, turbulent = fast. */
  angularVel: number
  /** Oscillation amplitude on the radius over time (fraction of base radius). */
  wobbleAmp: number
  /** Oscillation frequency for radius wobble (rad/s). */
  wobbleFreq: number
  /** Spring constant pulling sphere toward its (angle, radius) target. */
  springK: number
  /** Velocity damping per second so collisions settle back onto the orbit. */
  damping: number
  /** Hard velocity cap to prevent runaway at high spring strength. */
  maxSpeed: number
}

const ORBIT_TABLE: Record<TurbulenceRating, OrbitBehavior> = {
  1: { radiusFraction: 0.85, angularVel: 0.10, wobbleAmp: 0.02, wobbleFreq: 0.20, springK: 2.5, damping: 1.2, maxSpeed: 1.5 },
  2: { radiusFraction: 0.70, angularVel: 0.18, wobbleAmp: 0.05, wobbleFreq: 0.35, springK: 3.0, damping: 1.3, maxSpeed: 2.0 },
  3: { radiusFraction: 0.55, angularVel: 0.30, wobbleAmp: 0.08, wobbleFreq: 0.55, springK: 3.5, damping: 1.5, maxSpeed: 2.6 },
  4: { radiusFraction: 0.40, angularVel: 0.55, wobbleAmp: 0.18, wobbleFreq: 0.95, springK: 4.0, damping: 1.6, maxSpeed: 3.6 },
  5: { radiusFraction: 0.28, angularVel: 0.90, wobbleAmp: 0.30, wobbleFreq: 1.80, springK: 4.5, damping: 1.8, maxSpeed: 4.8 },
}

export function orbitBehavior(rating: number, reducedMotion = false): OrbitBehavior {
  const r = normalizeTurbulence(rating)
  const base = ORBIT_TABLE[r]
  if (!reducedMotion) return base
  // Halve angular velocity and shrink wobble for reduced-motion viewers.
  return {
    ...base,
    angularVel: base.angularVel * 0.5,
    wobbleAmp: base.wobbleAmp * 0.4,
    wobbleFreq: base.wobbleFreq * 0.6,
    maxSpeed: Math.min(base.maxSpeed, 1.5),
  }
}

// ---------------------------------------------------------------------------
// Shared utilities
// ---------------------------------------------------------------------------

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
