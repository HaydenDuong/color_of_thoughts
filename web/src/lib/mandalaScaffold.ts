import type { WallEntry } from './wallData'

/**
 * Mandala-mode scaffold + agents.
 *
 * **Concept.** A slowly-rotating Fibonacci sphere of deep-navy scaffold
 * blobs sits at the center of the scene; an invisible outer shell at
 * 1.45× the inner radius hosts dock slots where user blobs try to lock
 * on. User behaviour depends on turbulence rating:
 *
 *   - 1–2 (calm)       → role=`dock`: gentle spring toward an assigned
 *                         dock slot on the outer shell. Holds position
 *                         when undisturbed. The "laying still" blobs.
 *   - 4–5 (turbulent)  → role=`chaotic`: random 3-D impulses, weak
 *                         outward push. Never docks. Collides with and
 *                         knocks dock-role blobs off their slots.
 *   - 3 (neutral)      → role picked once at spawn by deterministic
 *                         hash; half commit to dock, half to chaotic.
 *                         Stable for the life of the blob (user's call:
 *                         "pick once at spawn").
 *
 * **Philosophy.** The mandala is never meant to complete. When a dock
 * blob is hit by another blob, it releases its slot, drifts during a
 * ~0.8 s grace period, then tries to claim a *new* free slot (not
 * necessarily the old one — user's call). No stickiness, no teleports.
 * Sometimes it goes back to its old spot, sometimes it reshuffles. Let
 * it be imperfect.
 *
 * **Coordinate system.** Full 3-D. (0, 0, 0) is the mandala centre, Y
 * up. The scaffold group rotates around the world Y axis at ~24 s per
 * revolution; user blobs live in world space (don't rotate with the
 * scaffold).
 */

// ---------------------------------------------------------------------------
// Scene constants
// ---------------------------------------------------------------------------

/** How many blobs compose the inner scaffold sphere. User-chosen — 80
 *  reads as a clear sphere-shape on our inner radius without overlapping
 *  or feeling solid (~0.59-unit neighbour spacing at INNER_RADIUS=1.6). */
export const MANDALA_SCAFFOLD_COUNT = 80

/** How many dock slots exist on the outer shell. Slightly under the
 *  project's realistic 50-user ceiling so late joiners *can* occasionally
 *  find all slots full — which is fine, and reinforces the "mandala in
 *  progress" reading (see `hoverOutsideShell` fallback below). */
export const MANDALA_DOCK_COUNT = 50

export const MANDALA_INNER_RADIUS = 1.6
export const MANDALA_OUTER_RADIUS = MANDALA_INNER_RADIUS * 1.45 // ≈ 2.32

/** Outer bounding sphere for **dock / calm / overflow** blobs — they
 *  bounce back when they hit it so the mandala silhouette stays tight
 *  and crisp (which is what reads as "order" on a projection screen).
 *  Must be ≥ MANDALA_OUTER_RADIUS + a few blob radii. */
export const MANDALA_BOUNDING_RADIUS = 3.5

/** Axis-aligned **ellipsoid** bound for chaotic blobs (`(x/aX)² +
 *  (y/aY)² + (z/aZ)² ≤ 1`). Chosen wider than tall to match the
 *  widescreen exhibition canvas — a sphere bound left big empty bands
 *  of cream on the left and right sides because radius is symmetric
 *  in every direction but the viewport isn't. Ellipsoid lets meteors
 *  sweep the full canvas width without overshooting top/bottom into
 *  off-screen space.
 *
 *  Semi-axes (X=13, Y=6, Z=9) sized to the camera's viewing frustum
 *  at `MANDALA_CAMERA_Z = 12`: horizontal viewport extent there is
 *  roughly ±13 u (fov 50°, aspect ~2.2:1), vertical ±6 u, depth ±9 u
 *  giving meteors room to pass in front of and behind the mandala
 *  for parallax variety.
 *
 *  Steady-state distribution argument from the previous spherical
 *  bound still holds — random-walking blobs in a bounded volume are
 *  distributed roughly uniformly by volume, and the outer shell of
 *  any convex region holds the bulk of the volume, so meteors
 *  naturally spend most time near the periphery without needing a
 *  centrifugal force (which would re-introduce "satellite orbit"
 *  feel).
 *
 *  Calm/dock/overflow blobs keep the spherical `MANDALA_BOUNDING_RADIUS`
 *  bound — the mandala's central structure stays visually circular,
 *  only the surrounding meteor belt is widescreen-shaped. */
export const MANDALA_CHAOTIC_BOUND_X = 13.0
export const MANDALA_CHAOTIC_BOUND_Y = 6.0
export const MANDALA_CHAOTIC_BOUND_Z = 9.0

/** Animated-arrival spawn distance for **dockers** — multiple of
 *  `MANDALA_INNER_RADIUS`. Dockers spawn just outside the dock shell
 *  and dive straight in toward their slot. Kept small (4.48 u) so the
 *  arrival reads as "settling into place" not "flying in from afar". */
export const MANDALA_DOCK_SPAWN_RADIUS_X = 2.8

/** Animated-arrival spawn inset for **chaotic** blobs — fraction of
 *  the ellipsoid axes. 0.85 places spawn just inside the outer surface
 *  so meteors enter from "deep space" along their hashed direction.
 *  At 0.85 of (13, 6, 9) a horizontally-spawning meteor appears near
 *  the canvas edge (X ≈ 11 u), reading as "appearing from off-screen
 *  to your left/right". */
export const MANDALA_CHAOTIC_SPAWN_INSET = 0.85

/** Scaffold Y-axis rotation rate (rad/sec). 2π/24 ≈ 0.262 gives ~24 s
 *  per revolution — visible but meditative, not a beyblade. */
export const MANDALA_SCAFFOLD_OMEGA = (Math.PI * 2) / 24

// ---------------------------------------------------------------------------
// Fibonacci sphere generator
// ---------------------------------------------------------------------------

export type MandalaPoint = {
  /** Index in generation order — stable across re-renders for keying. */
  index: number
  x: number
  y: number
  z: number
}

/**
 * Place `count` points on a sphere of given radius using the classic
 * Fibonacci-sphere formula: points lie on a spiral with golden-angle
 * rotation between consecutive samples, which gives near-uniform
 * spacing without the pole pinching of a lat/long grid.
 */
export function generateFibonacciSphere(count: number, radius: number): MandalaPoint[] {
  const pts: MandalaPoint[] = []
  if (count <= 0) return pts

  const phi = Math.PI * (3 - Math.sqrt(5)) // ≈ 2.3999 rad (golden angle)
  const denom = count > 1 ? count - 1 : 1

  for (let i = 0; i < count; i++) {
    const yRel = count === 1 ? 0 : 1 - (i / denom) * 2 // −1..+1
    const ringR = Math.sqrt(Math.max(0, 1 - yRel * yRel))
    const theta = phi * i
    pts.push({
      index: i,
      x: Math.cos(theta) * ringR * radius,
      y: yRel * radius,
      z: Math.sin(theta) * ringR * radius,
    })
  }
  return pts
}

// ---------------------------------------------------------------------------
// Role + dock assignment
// ---------------------------------------------------------------------------

export type MandalaRole = 'dock' | 'chaotic'

function hashUnit(seed: string, salt: number): number {
  let h = 2166136261 ^ (salt * 0x9e3779b9)
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i)
    h = Math.imul(h, 16777619)
  }
  return ((h >>> 0) % 1_000_000) / 1_000_000
}

/**
 * Pick role from turbulence + participantId. Called ONCE at spawn; the
 * blob's role is then stable for its lifetime (mid-3 users who change
 * turbulence later don't have their blob flip — their role was picked
 * that day).
 */
export function computeMandalaRole(turbulence: number, participantId: string): MandalaRole {
  const t = Math.max(1, Math.min(5, turbulence))
  if (t <= 2) return 'dock'
  if (t >= 4) return 'chaotic'
  return hashUnit(participantId, 42) < 0.5 ? 'dock' : 'chaotic'
}

/** Preferred dock index for a participant. Collisions resolved by
 *  linear-probing forward in `claimDock`. */
export function preferredDockIndex(participantId: string): number {
  return Math.floor(hashUnit(participantId, 77) * MANDALA_DOCK_COUNT) % MANDALA_DOCK_COUNT
}

export type MandalaDockOccupancy = Map<number, string>

/** Claim the first free dock slot at-or-after the preferred index.
 *  Returns null if every slot is taken. */
export function claimDock(
  participantId: string,
  occupancy: MandalaDockOccupancy,
): number | null {
  const start = preferredDockIndex(participantId)
  for (let step = 0; step < MANDALA_DOCK_COUNT; step++) {
    const idx = (start + step) % MANDALA_DOCK_COUNT
    if (!occupancy.has(idx)) {
      occupancy.set(idx, participantId)
      return idx
    }
  }
  return null
}

export function releaseDock(
  idx: number,
  participantId: string,
  occupancy: MandalaDockOccupancy,
): void {
  if (occupancy.get(idx) === participantId) occupancy.delete(idx)
}

// ---------------------------------------------------------------------------
// Per-blob physics state + config
// ---------------------------------------------------------------------------

export type MandalaBlob = {
  id: string
  x: number; y: number; z: number
  vx: number; vy: number; vz: number
  role: MandalaRole
  /** Current dock slot (0..DOCK_COUNT−1) or null when roaming / stunned. */
  dockIdx: number | null
  /** World-clock time at which grace period ends. Role=dock only. */
  graceUntil: number
  /** Next scheduled chaotic impulse time. Role=chaotic only. */
  nextImpulseAt: number
  /** Turbulence rating — reflects re-uploads; drives *visual* only (role
   *  was committed at spawn per user's ask, so this doesn't change motion). */
  turbulence: number
}

export type MandalaConfig = {
  /** Spring constant pulling dock blobs toward their assigned slot (N/m-ish). */
  dockSpring: number
  /** Velocity-proportional damping on dock blobs (keeps spring from oscillating). */
  dockDamping: number
  /** Per-second velocity damping for **dock** blobs + grace-period drifters.
   *  exp(−k·dt) per frame. Stops dockers from oscillating around their slot.
   *
   *  Chaotic blobs use `chaoticDamping` (much lower) instead — see below. */
  globalDamping: number
  /** Per-second velocity damping for **chaotic** blobs. Intentionally much
   *  lower than `globalDamping` (~1/4) so each impulse produces a long
   *  coasting trajectory instead of decaying in half a second — that's
   *  what makes the motion read as "meteorite streaks" across the mandala
   *  instead of "satellites hovering in one area". */
  chaoticDamping: number
  /** Grace period after a dock blob is hit — drifts free before retrying dock. */
  graceDuration: number
  /** Peak magnitude of a single random impulse applied to chaotic blobs. */
  chaoticImpulse: number
  /** Interval between chaotic impulses (uniform random in [min, max]).
   *  Longer intervals (fewer, bigger kicks) produce more distinct streak
   *  trajectories — each impulse gets to play out before the next arrives. */
  chaoticMinInterval: number
  chaoticMaxInterval: number
  /** Weak radial outward force on chaotic blobs so they bias toward the
   *  periphery instead of pile-up near the inner scaffold. Kept small so
   *  blobs still cross the mandala diagonally rather than orbiting a
   *  fixed radius. */
  chaoticCentrifugal: number
  /** Energy retention after a bounce (1 = perfectly elastic). */
  restitution: number
  /** Clamp dt so a tab-switch freeze doesn't teleport blobs on resume. */
  maxDt: number
  /** Collision radius for pair + boundary physics. */
  blobRadius: number
  /** When true, reduce impulse magnitudes + scaffold rotation. */
  reducedMotion: boolean
}

export const DEFAULT_MANDALA_CONFIG: MandalaConfig = {
  dockSpring: 5.0,
  dockDamping: 0.65,
  globalDamping: 0.60,
  // Chaotic damping intentionally ~7.5× lower than the docker damping
  // so an impulse of 1.8 u/s produces a multi-second gliding trajectory
  // (τ ≈ 12.5 s — meteors barely lose energy as they coast). Combined
  // with the widened ellipsoidal `MANDALA_CHAOTIC_BOUND_{X,Y,Z}` playground and longer
  // intervals between kicks, this gives the contemplative "drifting
  // sailor" pacing tuned for the psychology-exhibition vibe — audience
  // has time to lock onto a single meteor and follow its arc all the
  // way across the mandala (~6 s cross-stage time).
  chaoticDamping: 0.08,
  graceDuration: 0.8,
  // Slow / contemplative tuning. Multiply / divide via the `?metFrac=N`
  // URL knob in `MandalaStage` to scrub speed live at the venue (1.0 =
  // ship as-is, 2.0 ≈ "energetic demo mode", 0.5 ≈ "almost meditation
  // app"). Keep impulse + intervals proportional via that knob so the
  // ratio of "kick energy : drift time" stays constant.
  chaoticImpulse: 1.8,
  chaoticMinInterval: 2.00,
  chaoticMaxInterval: 4.00,
  // Zero centrifugal: impulses are fully directionally uniform, so
  // chaotic blobs are just as likely to dive *through* the mandala
  // (bouncing off scaffold on the way) as to streak around its outside.
  chaoticCentrifugal: 0.0,
  restitution: 0.92,
  maxDt: 1 / 30,
  blobRadius: 0.34,
  reducedMotion: false,
}

// ---------------------------------------------------------------------------
// Spawn + reconcile
// ---------------------------------------------------------------------------

export type SeedOptions = {
  /** When true, spawn outside the outer shell with inward velocity so the
   *  blob visibly flies in. When false, spawn at rest at its dock (or a
   *  stable roam position for chaotic). Used for the first-paint case so
   *  30 existing entries don't all fly in simultaneously on page load. */
  animateArrival: boolean
}

/**
 * Build the initial physics state for a newcomer. Arrival animation is
 * opt-in because at mount the list of entries is usually pre-existing
 * (we don't want 30 simultaneous "flying in" spawns on page load).
 */
export function seededMandalaBlob(
  entry: WallEntry,
  dockPositions: MandalaPoint[],
  occupancy: MandalaDockOccupancy,
  options: SeedOptions = { animateArrival: true },
): MandalaBlob {
  const role = computeMandalaRole(entry.turbulence, entry.participantId)
  const dockIdx = role === 'dock' ? claimDock(entry.participantId, occupancy) : null

  if (!options.animateArrival) {
    // Rest spawn — used on initial page load so pre-existing entries
    // appear already seated.
    let x = 0, y = 0, z = 0
    if (role === 'dock' && dockIdx !== null) {
      const p = dockPositions[dockIdx]
      x = p.x; y = p.y; z = p.z
    } else if (role === 'dock') {
      // Dock-overflow (no slot available): hover just outside the dock
      // shell waiting for a slot to free up.
      const dir = directionFromHash(entry.participantId, 23)
      const r = MANDALA_INNER_RADIUS + 0.35 + hashUnit(entry.participantId, 29) * 0.5
      x = dir.x * r; y = dir.y * r; z = dir.z * r
    } else {
      // Chaotic roamer: scatter across the outer half of the
      // ellipsoidal meteor belt so first-paint pre-existing entries
      // don't all bunch up next to the scaffold and so they fill the
      // widescreen canvas horizontally. `t = 0.5..0.95` of the
      // ellipsoid axes places the blob between half and near-edge of
      // the playground in its hashed direction.
      const dir = directionFromHash(entry.participantId, 23)
      const t = 0.5 + hashUnit(entry.participantId, 29) * 0.45
      x = dir.x * t * MANDALA_CHAOTIC_BOUND_X
      y = dir.y * t * MANDALA_CHAOTIC_BOUND_Y
      z = dir.z * t * MANDALA_CHAOTIC_BOUND_Z
    }
    return {
      id: entry.participantId,
      x, y, z, vx: 0, vy: 0, vz: 0,
      role, dockIdx,
      graceUntil: 0,
      nextImpulseAt: 0,
      turbulence: entry.turbulence,
    }
  }

  // Animated arrival. Direction is biased toward the dock target for
  // dockers and random for chaotic. Initial velocity points inward so
  // the blob visibly flies in. Spawn position is role-dependent:
  //   - Dockers spawn at a fixed radius just outside the dock shell
  //     (~4.5 u) and dive straight toward their slot.
  //   - Chaotic blobs spawn near the *surface* of the ellipsoidal
  //     meteor belt — solving t for `(t·dir.x/aX)² + (t·dir.y/aY)² +
  //     (t·dir.z/aZ)² = 1` with a `0.85` inset puts the spawn just
  //     inside the bound along the hashed direction, so meteors enter
  //     from the wide horizontal edges of the canvas (when the hash
  //     points along ±X) rather than popping up next to the scaffold.
  let dir: { x: number; y: number; z: number }
  if (role === 'dock' && dockIdx !== null) {
    const p = dockPositions[dockIdx]
    const d = Math.hypot(p.x, p.y, p.z) || 1
    dir = { x: p.x / d, y: p.y / d, z: p.z / d }
  } else {
    dir = directionFromHash(entry.participantId, role === 'dock' ? 23 : 13)
  }

  let px: number, py: number, pz: number
  if (role === 'chaotic') {
    const ax = MANDALA_CHAOTIC_BOUND_X * MANDALA_CHAOTIC_SPAWN_INSET
    const ay = MANDALA_CHAOTIC_BOUND_Y * MANDALA_CHAOTIC_SPAWN_INSET
    const az = MANDALA_CHAOTIC_BOUND_Z * MANDALA_CHAOTIC_SPAWN_INSET
    const denom = Math.sqrt(
      (dir.x / ax) * (dir.x / ax) +
      (dir.y / ay) * (dir.y / ay) +
      (dir.z / az) * (dir.z / az),
    ) || 1
    const t = 1 / denom
    px = dir.x * t
    py = dir.y * t
    pz = dir.z * t
  } else {
    const spawnDist = MANDALA_INNER_RADIUS * MANDALA_DOCK_SPAWN_RADIUS_X
    px = dir.x * spawnDist
    py = dir.y * spawnDist
    pz = dir.z * spawnDist
  }

  // Inward velocity + tangent noise so the arrival isn't a perfectly
  // radial meteor. Chaotic blobs come in livelier.
  const speed = role === 'dock' ? 1.2 : 1.8
  const tangent = perpendicular(dir)
  const side = hashUnit(entry.participantId, 17) * 2 - 1
  const vx = -dir.x * speed + tangent.x * side * 0.4
  const vy = -dir.y * speed + tangent.y * side * 0.4
  const vz = -dir.z * speed + tangent.z * side * 0.4

  return {
    id: entry.participantId,
    x: px, y: py, z: pz,
    vx, vy, vz,
    role, dockIdx,
    graceUntil: 0,
    nextImpulseAt: 0,
    turbulence: entry.turbulence,
  }
}

/**
 * Sync the blob state Map with the entries list. New ids → spawn. Gone
 * ids → release their dock slot and remove. Existing ids → update the
 * turbulence rating (visual only; role is committed at spawn).
 *
 * Mutates `states` and `occupancy` in place.
 */
export function reconcileMandalaBlobs(
  entries: ReadonlyArray<WallEntry>,
  states: Map<string, MandalaBlob>,
  occupancy: MandalaDockOccupancy,
  dockPositions: MandalaPoint[],
  options: SeedOptions = { animateArrival: true },
): void {
  const wanted = new Set(entries.map((e) => e.participantId))

  // Drop gone participants (and free their dock slots).
  for (const id of Array.from(states.keys())) {
    if (!wanted.has(id)) {
      const s = states.get(id)
      if (s?.dockIdx != null) releaseDock(s.dockIdx, id, occupancy)
      states.delete(id)
    }
  }

  // Add newcomers; refresh turbulence for returning ones.
  for (const e of entries) {
    const existing = states.get(e.participantId)
    if (existing) {
      existing.turbulence = e.turbulence
      continue
    }
    states.set(e.participantId, seededMandalaBlob(e, dockPositions, occupancy, options))
  }
}

// ---------------------------------------------------------------------------
// Per-frame physics step
// ---------------------------------------------------------------------------

/**
 * Integrate all user blobs by `dt` seconds. Side-effects: mutates blob
 * positions + velocities, and may claim/release dock slots in
 * `occupancy` as blobs get knocked off and re-dock. Scaffold blobs are
 * treated as an immovable sphere (no state passed in).
 */
export function stepMandalaPhysics(
  blobs: MandalaBlob[],
  dockPositions: MandalaPoint[],
  occupancy: MandalaDockOccupancy,
  dt: number,
  now: number,
  cfg: MandalaConfig,
  scaffoldRotationY = 0,
): void {
  const step = Math.min(dt, cfg.maxDt)
  if (step <= 0) return

  const blobR = cfg.blobRadius
  const innerBoundary = MANDALA_INNER_RADIUS + blobR
  // Outer bounds differ by role and *shape*: calm/docker/overflow
  // blobs use a sphere (tight circular silhouette = ordered mandala),
  // chaotic blobs use a widescreen-shaped ellipsoid (wide horizontal
  // meteor belt that fills the canvas). See the docstrings on
  // `MANDALA_BOUNDING_RADIUS` and `MANDALA_CHAOTIC_BOUND_{X,Y,Z}`.
  const outerBoundaryCalm = MANDALA_BOUNDING_RADIUS - blobR
  // Effective ellipsoid axes shrunk by blob radius so the visual
  // bounce happens when the blob *surface* hits the wall, not its
  // center. This is a slight over-shrink (true normal-direction
  // inset is non-uniform on an ellipsoid), but the error is < 1% of
  // the axis length and invisible in practice.
  const ellipsoidAxX = MANDALA_CHAOTIC_BOUND_X - blobR
  const ellipsoidAxY = MANDALA_CHAOTIC_BOUND_Y - blobR
  const ellipsoidAxZ = MANDALA_CHAOTIC_BOUND_Z - blobR

  // 1. Per-blob forces + integrate.
  for (const b of blobs) {
    const outOfGrace = now >= b.graceUntil

    if (b.role === 'dock') {
      if (b.dockIdx == null && outOfGrace) {
        // Try to re-dock. `claimDock` linear-probes from preferred index
        // — may end up with the same slot the blob just released if no
        // newcomer took it in the 0.8 s grace, or a different one if
        // someone did. Either outcome is fine per user's call.
        b.dockIdx = claimDock(b.id, occupancy)
      }
      if (b.dockIdx != null && outOfGrace) {
        // Spring toward the *rotating* dock slot. User blobs stay in
        // world-space physics so meteors can collide with them normally,
        // but dock targets are rotated with the scaffold. This makes
        // docked calm blobs feel attached to the mandala surface; once
        // knocked loose (`dockIdx = null`) they stop rotating and drift
        // independently until they claim a new rotating slot.
        const p = dockPositions[b.dockIdx]
        const c = Math.cos(scaffoldRotationY)
        const s = Math.sin(scaffoldRotationY)
        const targetX = p.x * c + p.z * s
        const targetZ = -p.x * s + p.z * c
        // Feed-forward the target's tangential velocity as it rotates.
        // Without this, docked blobs are always damping toward zero
        // world-space velocity and visibly trail their slot. Damping
        // relative to the slot velocity makes calm blobs ride the
        // rotating mandala surface instead of merely chasing it.
        const omega = MANDALA_SCAFFOLD_OMEGA * (cfg.reducedMotion ? 0.5 : 1)
        const targetVx = omega * targetZ
        const targetVz = -omega * targetX
        b.vx +=
          (targetX - b.x) * cfg.dockSpring * step -
          (b.vx - targetVx) * cfg.dockDamping * step
        b.vy +=
          (p.y - b.y) * cfg.dockSpring * step -
          b.vy * cfg.dockDamping * step
        b.vz +=
          (targetZ - b.z) * cfg.dockSpring * step -
          (b.vz - targetVz) * cfg.dockDamping * step
      } else if (b.dockIdx == null) {
        // Dock overflow (all slots full) OR still in grace — drift
        // gently toward the outer shell in the blob's current direction
        // so it hovers "waiting" near the mandala's perimeter rather
        // than sinking to the centre.
        const d = Math.hypot(b.x, b.y, b.z)
        if (d > 1e-4) {
          const targetR = MANDALA_OUTER_RADIUS
          const nx = b.x / d, ny = b.y / d, nz = b.z / d
          const hoverK = 0.8
          b.vx += (nx * targetR - b.x) * hoverK * step
          b.vy += (ny * targetR - b.y) * hoverK * step
          b.vz += (nz * targetR - b.z) * hoverK * step
        }
      }
    }

    if (b.role === 'chaotic') {
      if (now >= b.nextImpulseAt) {
        const d = randomUnitVec3()
        const mag = (cfg.reducedMotion ? 0.5 : 1) * cfg.chaoticImpulse
        b.vx += d.x * mag
        b.vy += d.y * mag
        b.vz += d.z * mag
        b.nextImpulseAt =
          now + cfg.chaoticMinInterval +
          Math.random() * (cfg.chaoticMaxInterval - cfg.chaoticMinInterval)
      }
      // Weak outward push so they roam the periphery, not the centre.
      const d = Math.hypot(b.x, b.y, b.z)
      if (d > 1e-4) {
        const k = cfg.chaoticCentrifugal
        b.vx += (b.x / d) * k * step
        b.vy += (b.y / d) * k * step
        b.vz += (b.z / d) * k * step
      }
    }

    // Per-role damping. Chaotic blobs use `chaoticDamping` (much lower)
    // so their post-impulse velocity persists long enough to produce a
    // visible streak; dockers and grace-period drifters use
    // `globalDamping` so they don't oscillate around their slot. Both
    // are framerate-independent: v *= exp(−k·dt).
    const dampRate = b.role === 'chaotic' ? cfg.chaoticDamping : cfg.globalDamping
    const damp = Math.exp(-dampRate * step)
    b.vx *= damp; b.vy *= damp; b.vz *= damp

    // Integrate position.
    b.x += b.vx * step
    b.y += b.vy * step
    b.z += b.vz * step
  }

  // 2. Inner-sphere collision — scaffold is an immovable sphere.
  for (const b of blobs) {
    const d = Math.hypot(b.x, b.y, b.z)
    if (d < innerBoundary && d > 1e-6) {
      const nx = b.x / d, ny = b.y / d, nz = b.z / d
      b.x = nx * innerBoundary
      b.y = ny * innerBoundary
      b.z = nz * innerBoundary
      const vDotN = b.vx * nx + b.vy * ny + b.vz * nz
      if (vDotN < 0) {
        const r = cfg.restitution
        b.vx -= (1 + r) * vDotN * nx
        b.vy -= (1 + r) * vDotN * ny
        b.vz -= (1 + r) * vDotN * nz
      }
    }
  }

  // 3. Outer bound — keeps runaway blobs on-screen. Calm/dock/overflow
  //    blobs use a sphere (tight circular silhouette so the mandala
  //    structure stays visually crisp). Chaotic blobs use a widescreen-
  //    shaped ellipsoid so meteors fill the canvas left-to-right
  //    without overshooting top/bottom into off-screen territory.
  for (const b of blobs) {
    if (b.role === 'chaotic') {
      // Ellipsoid containment: blob is outside iff
      //   (x/aX)² + (y/aY)² + (z/aZ)² > 1
      const sx = b.x / ellipsoidAxX
      const sy = b.y / ellipsoidAxY
      const sz = b.z / ellipsoidAxZ
      const s2 = sx * sx + sy * sy + sz * sz
      if (s2 > 1 && s2 > 1e-12) {
        // Project back onto surface along the radial direction from
        // origin (not the true closest-point on the ellipsoid — that
        // requires iterative root-finding — but visually identical
        // for blobs that aren't sliding along the wall).
        const s = Math.sqrt(s2)
        b.x /= s; b.y /= s; b.z /= s

        // Surface normal of (x/aX)² + (y/aY)² + (z/aZ)² = 1 is
        // proportional to ∇F = (2x/aX², 2y/aY², 2z/aZ²). Normalize
        // before reflecting so the impulse stays in standard form.
        let nx = b.x / (ellipsoidAxX * ellipsoidAxX)
        let ny = b.y / (ellipsoidAxY * ellipsoidAxY)
        let nz = b.z / (ellipsoidAxZ * ellipsoidAxZ)
        const nLen = Math.sqrt(nx * nx + ny * ny + nz * nz) || 1
        nx /= nLen; ny /= nLen; nz /= nLen

        const vDotN = b.vx * nx + b.vy * ny + b.vz * nz
        if (vDotN > 0) {
          const r = cfg.restitution
          b.vx -= (1 + r) * vDotN * nx
          b.vy -= (1 + r) * vDotN * ny
          b.vz -= (1 + r) * vDotN * nz
        }
      }
    } else {
      // Sphere bound for calm/dock/overflow blobs.
      const d = Math.hypot(b.x, b.y, b.z)
      if (d > outerBoundaryCalm && d > 1e-6) {
        const nx = b.x / d, ny = b.y / d, nz = b.z / d
        b.x = nx * outerBoundaryCalm
        b.y = ny * outerBoundaryCalm
        b.z = nz * outerBoundaryCalm
        const vDotN = b.vx * nx + b.vy * ny + b.vz * nz
        if (vDotN > 0) {
          const r = cfg.restitution
          b.vx -= (1 + r) * vDotN * nx
          b.vy -= (1 + r) * vDotN * ny
          b.vz -= (1 + r) * vDotN * nz
        }
      }
    }
  }

  // 4. Pair collisions between user blobs (equal-mass elastic, O(N²)).
  const n = blobs.length
  const minDist = 2 * blobR
  const minDist2 = minDist * minDist
  for (let i = 0; i < n; i++) {
    const a = blobs[i]
    for (let j = i + 1; j < n; j++) {
      const c = blobs[j]
      const dx = c.x - a.x
      const dy = c.y - a.y
      const dz = c.z - a.z
      const d2 = dx * dx + dy * dy + dz * dz
      if (d2 >= minDist2 || d2 < 1e-12) continue

      const d = Math.sqrt(d2)
      const nx = dx / d, ny = dy / d, nz = dz / d
      // Resolve overlap by splitting the penetration 50/50.
      const overlap = (minDist - d) * 0.5
      a.x -= nx * overlap; a.y -= ny * overlap; a.z -= nz * overlap
      c.x += nx * overlap; c.y += ny * overlap; c.z += nz * overlap

      // Elastic impulse (equal mass).
      const vrx = c.vx - a.vx
      const vry = c.vy - a.vy
      const vrz = c.vz - a.vz
      const vDotN = vrx * nx + vry * ny + vrz * nz
      if (vDotN < 0) {
        const jImp = -(1 + cfg.restitution) * vDotN * 0.5
        a.vx -= jImp * nx; a.vy -= jImp * ny; a.vz -= jImp * nz
        c.vx += jImp * nx; c.vy += jImp * ny; c.vz += jImp * nz
      }

      // If either blob was a docked dock-blob, knock it off. It releases
      // its slot, enters the grace period, and will try to claim a *new*
      // free slot after grace expires (per user's call — might end up
      // back where it started if nobody else took the slot in 0.8 s, or
      // in a new spot if someone did).
      if (a.role === 'dock' && a.dockIdx != null) {
        releaseDock(a.dockIdx, a.id, occupancy)
        a.dockIdx = null
        a.graceUntil = now + cfg.graceDuration
      }
      if (c.role === 'dock' && c.dockIdx != null) {
        releaseDock(c.dockIdx, c.id, occupancy)
        c.dockIdx = null
        c.graceUntil = now + cfg.graceDuration
      }
    }
  }
}

// ---------------------------------------------------------------------------
// Small vector helpers
// ---------------------------------------------------------------------------

/** Uniform random point on the unit sphere (Marsaglia's method). */
function randomUnitVec3(): { x: number; y: number; z: number } {
  // Rejection-sample a point in the unit disc, project to sphere.
  let x = 0, y = 0, s = 2
  while (s >= 1) {
    x = Math.random() * 2 - 1
    y = Math.random() * 2 - 1
    s = x * x + y * y
  }
  const f = 2 * Math.sqrt(1 - s)
  return { x: x * f, y: y * f, z: 1 - 2 * s }
}

/** Deterministic unit direction from a seed — same seed always yields
 *  same direction. Used for stable spawn placement of chaotic blobs. */
function directionFromHash(
  seed: string,
  salt: number,
): { x: number; y: number; z: number } {
  const u = hashUnit(seed, salt)
  const v = hashUnit(seed, salt + 1)
  const theta = u * Math.PI * 2
  const z = v * 2 - 1
  const r = Math.sqrt(Math.max(0, 1 - z * z))
  return { x: Math.cos(theta) * r, y: z, z: Math.sin(theta) * r }
}

/** A unit vector perpendicular to `v`. Used to add tangential noise to
 *  spawn velocity so arrivals aren't perfectly radial. */
function perpendicular(v: { x: number; y: number; z: number }): { x: number; y: number; z: number } {
  // Cross with whichever world axis isn't too parallel to v.
  const alt = Math.abs(v.x) < 0.9 ? { x: 1, y: 0, z: 0 } : { x: 0, y: 1, z: 0 }
  const px = v.y * alt.z - v.z * alt.y
  const py = v.z * alt.x - v.x * alt.z
  const pz = v.x * alt.y - v.y * alt.x
  const d = Math.hypot(px, py, pz) || 1
  return { x: px / d, y: py / d, z: pz / d }
}
