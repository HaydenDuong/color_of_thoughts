# ADR 0003: Docked Calm Blobs Track Rotating Scaffold

- Status: Accepted
- Date: 2026-04-26

## Context

The Fibonacci scaffold rotates continuously.  
Before this decision, calm/docked blobs springed to static world-space dock positions, causing the scaffold to rotate "under" calm blobs instead of calm blobs feeling attached to the rotating shell.

Requirement from user/supervisor:

- calm cover should rotate with the mandala,
- but knocked-loose calm blobs should temporarily drift independently.

## Decision

Apply Option B behavior:

- keep all user blobs in world-space physics,
- pass scaffold Y-rotation into `stepMandalaPhysics`,
- rotate dock target positions by the same angle before spring force,
- only docked calm blobs follow rotating targets,
- loose calm blobs (`dockIdx = null`) and chaotic blobs remain independent.

Also include tangential-velocity feed-forward so docked blobs move with rotating slots instead of visibly lagging.

## Consequences

Positive:

- calm layer visually "rides" the rotating mandala,
- knock-off events are clearer (attached -> detached -> reattached),
- avoids coordinate-system complexity of parenting all user blobs under scaffold transform.

Tradeoffs:

- slightly more complex docking force model,
- requires passing rotation state from stage/render loop into physics step.
