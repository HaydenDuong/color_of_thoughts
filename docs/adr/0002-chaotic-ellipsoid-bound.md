# ADR 0002: Chaotic Blobs Use Ellipsoidal Bound

- Status: Accepted
- Date: 2026-04-26

## Context

Chaotic blobs originally used a spherical outer boundary. On a widescreen wall canvas, this left large unused side regions and made motion feel constrained near the center.  
User observed an "invisible square/barrier" feel due to mismatch between symmetric spherical space and asymmetric viewport.

Requirements:

- broader horizontal traversal,
- preserve smooth, natural bounces,
- keep calm mandala core visually circular and stable.

## Decision

Use a role-split boundary model:

- calm/dock/overflow blobs keep spherical bound (`MANDALA_BOUNDING_RADIUS`),
- chaotic blobs use axis-aligned ellipsoid bound (`MANDALA_CHAOTIC_BOUND_X/Y/Z`).

Physics containment uses `(x/aX)^2 + (y/aY)^2 + (z/aZ)^2 <= 1` with velocity reflection along ellipsoid surface normal.

## Consequences

Positive:

- better use of horizontal projection area,
- meteor trajectories read as long wide arcs instead of central pinball,
- smooth curved-wall reflections (better than flat box-wall aesthetic).

Tradeoffs:

- more complex collision math than spherical bound,
- camera framing must be adjusted to include full ellipsoid extent.

Notes:

- Calm shell remains spherical, preserving the "ordered center vs chaotic halo" metaphor.
