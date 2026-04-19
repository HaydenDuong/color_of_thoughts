import {
  bandsBehavior,
  flowBehavior,
  flowHomeY,
  normalizeTurbulence,
  orbitBehavior,
} from './turbulence'

/**
 * 2D physics for the exhibition wall.
 *
 * Target: 50–60 spheres, lightly damped elastic collisions, bounded by the
 * camera's visible rectangle at the sphere plane. O(N²) pairwise collision
 * is fine at this count (~1.2k pair checks per frame at 50 spheres).
 *
 * Three wall modes live side-by-side, each with its own `step*` function:
 *
 *   - **Flow** (default, `stepFlowPhysics`): soft vertical gradient pulls
 *     calm spheres toward the bottom and turbulent toward the top. Calm
 *     spheres steer along a slowly rotating "drift" heading for curvy
 *     graceful paths; turbulent spheres get periodic impulse kicks for
 *     jagged agitation. All spheres share the full tank.
 *
 *   - **Orbit** (`stepOrbitPhysics`): each sphere targets a concentric
 *     orbit around (0,0). Calm = wide, slow, stable. Turbulent = tight,
 *     fast, with radius wobble. A spring pulls spheres toward their orbit
 *     target so collisions knock them off briefly before they return.
 *
 *   - **Bands** (`stepBandsPhysics`, hidden via `/wall?mode=bands`): original
 *     3-layer layout, kept for comparison. Hard horizontal stripes per
 *     rating tier with a strong home-y spring.
 *
 * The engine is framework-agnostic: it mutates a plain array of
 * `PhysicsSphere` objects. `WallScene` owns the state (a ref-held Map keyed
 * by `participantId`) and calls the active step function from `useFrame`.
 *
 * Switching modes is state-preserving: the same `PhysicsSphere[]` is reused;
 * only the step function changes. Positions and velocities carry over and
 * the new mode's forces smoothly guide the ensemble into its new layout.
 */

export type PhysicsSphere = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  /** 1..5 — drives this sphere's speed/jitter/band/orbit characteristics. */
  turbulence: number
  /**
   * Simulation time at which the next flow-mode impulse kick fires for
   * turbulent spheres. Ignored in other modes. Populated on first step.
   */
  nextKickAt?: number
}

export type Bounds = {
  minX: number
  maxX: number
  minY: number
  maxY: number
}

export type PhysicsConfig = {
  /** Fraction of relative velocity kept after a collision (1 = perfectly elastic). */
  restitution: number
  /** Clamp dt so a tab-switch freeze doesn't teleport spheres on resume. */
  maxDt: number
  /** Apply the reduced-motion variant of the per-rating behavior tables. */
  reducedMotion: boolean
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  restitution: 0.98,
  maxDt: 1 / 30,
  reducedMotion: false,
}

export type WallMode = 'flow' | 'orbit' | 'bands' | 'wave'

// ---------------------------------------------------------------------------
// Shared helpers
// ---------------------------------------------------------------------------

function applyWallBounce(spheres: PhysicsSphere[], bounds: Bounds, restitution: number) {
  for (const s of spheres) {
    if (s.x - s.radius < bounds.minX) {
      s.x = bounds.minX + s.radius
      s.vx = Math.abs(s.vx) * restitution
    } else if (s.x + s.radius > bounds.maxX) {
      s.x = bounds.maxX - s.radius
      s.vx = -Math.abs(s.vx) * restitution
    }
    if (s.y - s.radius < bounds.minY) {
      s.y = bounds.minY + s.radius
      s.vy = Math.abs(s.vy) * restitution
    } else if (s.y + s.radius > bounds.maxY) {
      s.y = bounds.maxY - s.radius
      s.vy = -Math.abs(s.vy) * restitution
    }
  }
}

function applyPairCollisions(spheres: PhysicsSphere[], restitution: number) {
  const n = spheres.length
  for (let i = 0; i < n; i++) {
    const a = spheres[i]
    for (let j = i + 1; j < n; j++) {
      const b = spheres[j]
      const dx = b.x - a.x
      const dy = b.y - a.y
      const rSum = a.radius + b.radius
      const distSq = dx * dx + dy * dy
      if (distSq >= rSum * rSum || distSq < 1e-8) continue

      const dist = Math.sqrt(distSq)
      const nx = dx / dist
      const ny = dy / dist

      // Split the overlap evenly (equal mass).
      const overlap = (rSum - dist) * 0.5
      a.x -= nx * overlap
      a.y -= ny * overlap
      b.x += nx * overlap
      b.y += ny * overlap

      // Relative velocity projected on the collision normal (b - a)·n.
      // Negative means they're closing — only then do we exchange velocity.
      const vRel = (b.vx - a.vx) * nx + (b.vy - a.vy) * ny
      if (vRel >= 0) continue

      // Equal-mass 1D elastic impulse with coefficient of restitution.
      const impulse = (1 + restitution) * 0.5 * vRel
      a.vx += impulse * nx
      a.vy += impulse * ny
      b.vx -= impulse * nx
      b.vy -= impulse * ny
    }
  }
}

function clampSpeed(s: PhysicsSphere, maxSpeed: number) {
  const speed = Math.hypot(s.vx, s.vy)
  if (speed > maxSpeed) {
    const k = maxSpeed / speed
    s.vx *= k
    s.vy *= k
  }
}

// ---------------------------------------------------------------------------
// BANDS mode (original 3-layer layout — hidden via /wall?mode=bands)
// ---------------------------------------------------------------------------

/**
 * Hard 3-band vertical home for a given rating: rating 1-2 bottom band,
 * rating 3 middle (y=0), rating 4-5 top band.
 */
export function bandHomeY(rating: number, bounds: Bounds): number {
  const h = bounds.maxY - bounds.minY
  const bandH = h / 3
  const r = normalizeTurbulence(rating)
  if (r <= 2) return bounds.minY + bandH * 0.5
  if (r >= 4) return bounds.maxY - bandH * 0.5
  return 0
}

/**
 * Original per-band step with strong home-y spring. Kept for the
 * `/wall?mode=bands` comparison view.
 */
export function stepBandsPhysics(
  spheres: PhysicsSphere[],
  dt: number,
  bounds: Bounds,
  config: Partial<PhysicsConfig> = {},
): void {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config }
  const step = Math.min(dt, cfg.maxDt)
  if (step <= 0) return

  for (const s of spheres) {
    const b = bandsBehavior(s.turbulence, cfg.reducedMotion)

    if (b.jitterX > 0) s.vx += (Math.random() - 0.5) * b.jitterX
    if (b.jitterY > 0) s.vy += (Math.random() - 0.5) * b.jitterY

    if (b.homeK > 0) {
      const targetY = bandHomeY(s.turbulence, bounds)
      s.vy += b.homeK * (targetY - s.y) * step
    }

    if (b.yDamp > 0) {
      const k = Math.max(0, 1 - b.yDamp * step)
      s.vy *= k
    }

    clampSpeed(s, b.maxSpeed)

    s.x += s.vx * step
    s.y += s.vy * step
  }

  applyWallBounce(spheres, bounds, cfg.restitution)
  applyPairCollisions(spheres, cfg.restitution)
}

// ---------------------------------------------------------------------------
// FLOW mode (default — soft gradient + motion character per rating)
// ---------------------------------------------------------------------------

/**
 * Soft continuous gradient (rating 1 → bottom, 5 → top). Called by the
 * flow step; exposed for tests / debug overlays.
 */
function flowTargetY(rating: number, bounds: Bounds): number {
  return flowHomeY(rating, bounds.minY, bounds.maxY)
}

/**
 * Calm spheres get a slowly rotating "drift" heading derived deterministically
 * from their id + elapsed time, so two calm spheres never move identically
 * yet each traces a smooth curvy path. Velocity is steered toward this
 * target instead of snapping.
 */
function driftHeading(id: string, time: number): { ux: number; uy: number } {
  const a = hashUnit(id, 11) * Math.PI * 2
  const b = hashUnit(id, 12) * Math.PI * 2
  // Two incommensurate sinusoids → non-repeating drift direction.
  const theta =
    a +
    Math.sin(b + time * 0.27) * 1.2 +
    Math.cos(time * 0.17 + a * 0.5) * 0.8
  return { ux: Math.cos(theta), uy: Math.sin(theta) * 0.6 }
}

export function stepFlowPhysics(
  spheres: PhysicsSphere[],
  dt: number,
  bounds: Bounds,
  time: number,
  config: Partial<PhysicsConfig> = {},
): void {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config }
  const step = Math.min(dt, cfg.maxDt)
  if (step <= 0) return

  for (const s of spheres) {
    const b = flowBehavior(s.turbulence, cfg.reducedMotion)

    if (b.jitterX > 0) s.vx += (Math.random() - 0.5) * b.jitterX
    if (b.jitterY > 0) s.vy += (Math.random() - 0.5) * b.jitterY

    // Calm drift: steer velocity toward a slow-rotating target.
    if (b.driftSpeed > 0 && b.driftSteer > 0) {
      const { ux, uy } = driftHeading(s.id, time)
      const targetVx = ux * b.driftSpeed
      const targetVy = uy * b.driftSpeed
      const k = Math.min(1, b.driftSteer * step)
      s.vx += (targetVx - s.vx) * k
      s.vy += (targetVy - s.vy) * k
    }

    // Turbulent impulse kicks.
    if (b.kickStrength > 0 && Number.isFinite(b.kickMin)) {
      if (s.nextKickAt === undefined) {
        // First frame for this sphere in flow mode: schedule the first kick.
        s.nextKickAt = time + b.kickMin + hashUnit(s.id, 7) * (b.kickMax - b.kickMin)
      }
      if (time >= s.nextKickAt) {
        const angle = Math.random() * Math.PI * 2
        const mag = (0.5 + Math.random() * 0.5) * b.kickStrength
        s.vx += Math.cos(angle) * mag
        s.vy += Math.sin(angle) * mag
        s.nextKickAt = time + b.kickMin + Math.random() * (b.kickMax - b.kickMin)
      }
    } else if (s.nextKickAt !== undefined) {
      // Rating changed down to non-kicking; clear stale schedule.
      s.nextKickAt = undefined
    }

    // Weak soft-gradient home-y pull.
    if (b.homeK > 0) {
      const targetY = flowTargetY(s.turbulence, bounds)
      s.vy += b.homeK * (targetY - s.y) * step
    }

    clampSpeed(s, b.maxSpeed)

    s.x += s.vx * step
    s.y += s.vy * step
  }

  applyWallBounce(spheres, bounds, cfg.restitution)
  applyPairCollisions(spheres, cfg.restitution)
}

// ---------------------------------------------------------------------------
// ORBIT mode (concentric attractor field)
// ---------------------------------------------------------------------------

/**
 * Maximum orbit radius that keeps a sphere fully inside the tank.
 * Shared helper so the step function and seeded-init agree.
 */
function orbitMaxRadius(bounds: Bounds, sphereRadius: number): number {
  const halfW = Math.min(Math.abs(bounds.minX), Math.abs(bounds.maxX))
  const halfH = Math.min(Math.abs(bounds.minY), Math.abs(bounds.maxY))
  return Math.max(0.2, Math.min(halfW, halfH) - sphereRadius)
}

/**
 * Current (angle, radius) target for a sphere in orbit mode. Pure function
 * of id + turbulence + elapsed time so there's no state to persist across
 * frames or mode switches.
 */
function orbitTarget(
  s: PhysicsSphere,
  time: number,
  maxRadius: number,
  reducedMotion: boolean,
): { tx: number; ty: number } {
  const o = orbitBehavior(s.turbulence, reducedMotion)

  const basePhase = hashUnit(s.id, 21) * Math.PI * 2
  const dir = hashUnit(s.id, 22) < 0.5 ? -1 : 1
  const angle = basePhase + dir * o.angularVel * time

  const radiusBase = o.radiusFraction * maxRadius
  const wobblePhase = hashUnit(s.id, 23) * Math.PI * 2
  const radius = radiusBase * (1 + o.wobbleAmp * Math.sin(wobblePhase + time * o.wobbleFreq))

  return {
    tx: Math.cos(angle) * radius,
    ty: Math.sin(angle) * radius,
  }
}

export function stepOrbitPhysics(
  spheres: PhysicsSphere[],
  dt: number,
  bounds: Bounds,
  time: number,
  config: Partial<PhysicsConfig> = {},
): void {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config }
  const step = Math.min(dt, cfg.maxDt)
  if (step <= 0) return

  const sphereR = spheres[0]?.radius ?? 0.4
  const maxRadius = orbitMaxRadius(bounds, sphereR)

  for (const s of spheres) {
    const o = orbitBehavior(s.turbulence, cfg.reducedMotion)
    const { tx, ty } = orbitTarget(s, time, maxRadius, cfg.reducedMotion)

    // Spring toward target.
    s.vx += o.springK * (tx - s.x) * step
    s.vy += o.springK * (ty - s.y) * step

    // Damping so collisions settle.
    const d = Math.max(0, 1 - o.damping * step)
    s.vx *= d
    s.vy *= d

    clampSpeed(s, o.maxSpeed)

    s.x += s.vx * step
    s.y += s.vy * step
  }

  applyWallBounce(spheres, bounds, cfg.restitution)
  applyPairCollisions(spheres, cfg.restitution)
}

// ---------------------------------------------------------------------------
// Seeded initial state
// ---------------------------------------------------------------------------

/**
 * Deterministic hash of a string to [0, 1). `salt` lets us derive multiple
 * uncorrelated values from the same id (position x/y, heading, speed,
 * orbit phase, kick schedule).
 */
function hashUnit(seed: string, salt: number): number {
  let h = 2166136261 ^ (salt * 0x9e3779b9)
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

/**
 * Initial state for a freshly-arrived participant.
 *
 * Placement depends on the current mode so the sphere arrives in a sensible
 * spot for the visible simulation:
 *
 *   - `flow`  : X scattered across the tank; Y near the rating's
 *               soft-gradient home, with some spread.
 *   - `orbit` : positioned exactly on the rating's orbit target (for t=0).
 *   - `bands` : X across the tank; Y inside the rating's band stripe.
 *
 * Heading: random; speed small (drawn from `[speedMin, speedMax]`). Per-
 * mode forces take over from there.
 */
export function seededInitialState(
  id: string,
  bounds: Bounds,
  radius: number,
  turbulence: number,
  mode: WallMode = 'flow',
  speedMin = 0.1,
  speedMax = 0.2,
): PhysicsSphere {
  const u = hashUnit(id, 1)
  const v = hashUnit(id, 2)
  const a = hashUnit(id, 3)
  const s = hashUnit(id, 4)

  const rating = normalizeTurbulence(turbulence)
  const innerW = Math.max(0, bounds.maxX - bounds.minX - 2 * radius)
  const innerH = Math.max(0, bounds.maxY - bounds.minY - 2 * radius)

  let x: number
  let y: number

  if (mode === 'orbit') {
    const maxRadius = orbitMaxRadius(bounds, radius)
    const tmp: PhysicsSphere = {
      id, x: 0, y: 0, vx: 0, vy: 0, radius, turbulence: rating,
    }
    const { tx, ty } = orbitTarget(tmp, 0, maxRadius, false)
    x = tx
    y = ty
  } else if (mode === 'bands') {
    const totalH = bounds.maxY - bounds.minY
    const bandH = totalH / 3
    let yMin: number, yMax: number
    if (rating <= 2) {
      yMin = bounds.minY + radius
      yMax = bounds.minY + bandH - radius
    } else if (rating >= 4) {
      yMin = bounds.maxY - bandH + radius
      yMax = bounds.maxY - radius
    } else {
      yMin = bounds.minY + bandH + radius
      yMax = bounds.maxY - bandH - radius
    }
    if (yMax < yMin) {
      const mid = (bounds.minY + bounds.maxY) / 2
      yMin = mid
      yMax = mid
    }
    x = bounds.minX + radius + u * innerW
    y = yMin + v * (yMax - yMin)
  } else {
    // flow: soft gradient centered on home-y with ±15% tank-height spread.
    const homeY = flowHomeY(rating, bounds.minY, bounds.maxY)
    const spread = innerH * 0.15
    const yRaw = homeY + (v - 0.5) * 2 * spread
    const yMin = bounds.minY + radius
    const yMax = bounds.maxY - radius
    y = Math.max(yMin, Math.min(yMax, yRaw))
    x = bounds.minX + radius + u * innerW
  }

  const angle = a * Math.PI * 2
  const speed = speedMin + s * (speedMax - speedMin)

  return {
    id,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
    turbulence: rating,
  }
}
