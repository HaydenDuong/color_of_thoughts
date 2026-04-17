/**
 * 2D physics for the exhibition wall.
 *
 * Target: 50–60 spheres, lightly damped elastic collisions, bounded by the
 * camera's visible rectangle at the sphere plane. O(N²) pairwise collision
 * is fine at this count (~1.2k pair checks per frame at 50 spheres).
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
  /** Per-step random velocity nudge (keeps the wall alive at restitution < 1). */
  ambientJitter: number
  /** Hard cap on speed so nothing tunnels through a wall. */
  maxSpeed: number
  /** Clamp dt so a tab-switch freeze doesn't teleport spheres on resume. */
  maxDt: number
}

export const DEFAULT_PHYSICS_CONFIG: PhysicsConfig = {
  restitution: 0.98,
  ambientJitter: 0.004,
  maxSpeed: 2.2,
  maxDt: 1 / 30,
}

/**
 * One integration step:
 *   1. Apply ambient jitter, clamp speed, integrate position.
 *   2. Bounce off each wall (clamp position inside, flip + damp velocity).
 *   3. Resolve every pair that overlaps: split the overlap, exchange the
 *      normal component of velocity (equal-mass 1D elastic, scaled by
 *      (1 + restitution) / 2).
 *
 * Mutates the array in place.
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

  const jitterScale = cfg.ambientJitter

  for (const s of spheres) {
    if (jitterScale > 0) {
      s.vx += (Math.random() - 0.5) * jitterScale
      s.vy += (Math.random() - 0.5) * jitterScale
    }

    const speed = Math.hypot(s.vx, s.vy)
    if (speed > cfg.maxSpeed) {
      const k = cfg.maxSpeed / speed
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
 * Initial state for a freshly-arrived participant:
 *   - Position: scattered inside the inset bounds (not on top of a wall).
 *   - Velocity: random heading; speed drawn from `[speedMin, speedMax]`.
 *
 * Collision resolution handles overlaps on the next step if two new spheres
 * happen to spawn on top of each other.
 */
export function seededInitialState(
  id: string,
  bounds: Bounds,
  radius: number,
  speedMin = 0.1,
  speedMax = 0.15,
): PhysicsSphere {
  const u = hashUnit(id, 1)
  const v = hashUnit(id, 2)
  const a = hashUnit(id, 3)
  const s = hashUnit(id, 4)

  const innerW = Math.max(0, bounds.maxX - bounds.minX - 2 * radius)
  const innerH = Math.max(0, bounds.maxY - bounds.minY - 2 * radius)
  const x = bounds.minX + radius + u * innerW
  const y = bounds.minY + radius + v * innerH

  const angle = a * Math.PI * 2
  const speed = speedMin + s * (speedMax - speedMin)

  return {
    id,
    x,
    y,
    vx: Math.cos(angle) * speed,
    vy: Math.sin(angle) * speed,
    radius,
  }
}
