import { physicsBehavior, normalizeTurbulence } from './turbulence'

/**
 * 2D physics for the exhibition wall.
 *
 * Target: 50–60 spheres, lightly damped elastic collisions, bounded by the
 * camera's visible rectangle at the sphere plane. O(N²) pairwise collision
 * is fine at this count (~1.2k pair checks per frame at 50 spheres).
 *
 * Turbulence-aware (added v2):
 *   - Each sphere carries a `turbulence` rating (1..5). Per-sphere maxSpeed,
 *     ambient jitter (separate X/Y), vertical-home spring and vertical
 *     damping are looked up from `lib/turbulence.ts`.
 *   - The tank is split into three equal horizontal bands. Calm spheres
 *     (1-2) live in the bottom band and are strongly damped vertically so
 *     they flow mostly horizontally. Turbulent spheres (4-5) live up top
 *     with big jitter. Mixed (3) float freely in the middle band.
 *   - Collisions still apply tank-wide (a bouncy sphere can visit other
 *     bands) and the spring pulls it back home once the impulse ebbs.
 *
 * The engine is framework-agnostic: it mutates a plain array of
 * `PhysicsSphere` objects. `WallScene` owns the state (a ref-held Map keyed
 * by `participantId`) and calls `stepPhysics` from its `useFrame` loop.
 *
 * Why ambient jitter: with restitution < 1, energy dissipates on every
 * collision. Without a trickle of energy in, the wall would slowly settle
 * into clumps. A tiny random nudge per step keeps motion alive indefinitely
 * without feeling "shaken".
 */

export type PhysicsSphere = {
  id: string
  x: number
  y: number
  vx: number
  vy: number
  radius: number
  /** 1..5 — drives this sphere's speed/jitter/band. */
  turbulence: number
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
  /** Apply the reduced-motion variant of the per-rating behavior table. */
  reducedMotion: boolean
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  restitution: 0.98,
  maxDt: 1 / 30,
  reducedMotion: false,
}

/**
 * Vertical home (target Y) for a given rating inside `bounds`.
 *
 *   rating 1-2  → bottom band center
 *   rating 3    → middle (tank center, visually strongest for the default)
 *   rating 4-5  → top band center
 *
 * Recomputed per frame so canvas resize flows through without state surgery.
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
 * One integration step. Mutates `spheres` in place.
 *
 * Order (per sphere):
 *   1. Apply per-turbulence ambient jitter (separate X / Y amplitudes).
 *   2. Apply home-band spring: `vy += homeK * (homeY - y) * dt`.
 *   3. Apply vertical damping: `vy *= max(0, 1 - yDamp * dt)` so calm
 *      spheres decay to mostly-horizontal motion and don't drift up.
 *   4. Cap speed to the rating's `maxSpeed`.
 *   5. Integrate position.
 *   6. Wall bounce (clamp + flip + global restitution).
 *   7. Pairwise elastic collisions (equal mass, global restitution).
 */
export function stepPhysics(
  spheres: PhysicsSphere[],
  dt: number,
  bounds: Bounds,
  config: Partial<PhysicsConfig> = {},
): void {
  const cfg = { ...DEFAULT_PHYSICS_CONFIG, ...config }
  const step = Math.min(dt, cfg.maxDt)
  if (step <= 0) return

  for (const s of spheres) {
    const b = physicsBehavior(s.turbulence, cfg.reducedMotion)

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

    const speed = Math.hypot(s.vx, s.vy)
    if (speed > b.maxSpeed) {
      const k = b.maxSpeed / speed
      s.vx *= k
      s.vy *= k
    }

    s.x += s.vx * step
    s.y += s.vy * step
  }

  for (const s of spheres) {
    if (s.x - s.radius < bounds.minX) {
      s.x = bounds.minX + s.radius
      s.vx = Math.abs(s.vx) * cfg.restitution
    } else if (s.x + s.radius > bounds.maxX) {
      s.x = bounds.maxX - s.radius
      s.vx = -Math.abs(s.vx) * cfg.restitution
    }
    if (s.y - s.radius < bounds.minY) {
      s.y = bounds.minY + s.radius
      s.vy = Math.abs(s.vy) * cfg.restitution
    } else if (s.y + s.radius > bounds.maxY) {
      s.y = bounds.maxY - s.radius
      s.vy = -Math.abs(s.vy) * cfg.restitution
    }
  }

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
      const impulse = (1 + cfg.restitution) * 0.5 * vRel
      a.vx += impulse * nx
      a.vy += impulse * ny
      b.vx -= impulse * nx
      b.vy -= impulse * ny
    }
  }
}

/**
 * Deterministic hash of a string to [0, 1). `salt` lets us derive multiple
 * uncorrelated values from the same id (position x/y, heading, speed).
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
 * X is scattered across the full inset bounds; Y is scattered only within
 * the rating's home band (so new spheres arrive already sitting in the
 * correct emotional stripe and the spring doesn't have to yank them there).
 * Heading is random; speed is drawn from `[speedMin, speedMax]` and is
 * later clamped by the rating's `maxSpeed` on the first step.
 */
export function seededInitialState(
  id: string,
  bounds: Bounds,
  radius: number,
  turbulence: number,
  speedMin = 0.1,
  speedMax = 0.2,
): PhysicsSphere {
  const u = hashUnit(id, 1)
  const v = hashUnit(id, 2)
  const a = hashUnit(id, 3)
  const s = hashUnit(id, 4)

  const rating = normalizeTurbulence(turbulence)
  const totalH = bounds.maxY - bounds.minY
  const bandH = totalH / 3

  // Band range on Y, inset by radius so the sphere does not clip the divider.
  let yMin: number
  let yMax: number
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
    // Tank too short for bands — collapse to center.
    const mid = (bounds.minY + bounds.maxY) / 2
    yMin = mid
    yMax = mid
  }

  const innerW = Math.max(0, bounds.maxX - bounds.minX - 2 * radius)
  const x = bounds.minX + radius + u * innerW
  const y = yMin + v * (yMax - yMin)

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
