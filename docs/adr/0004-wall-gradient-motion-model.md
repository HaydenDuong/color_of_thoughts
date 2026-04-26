# ADR 0004: CSS CodePen-Style Gradient Motion For Wall Background

- Status: Accepted
- Date: 2026-04-26

## Context

Wall background moved from static cream to animated gradient.  
Initial aurora implementation used subtle radial drifts; visually it often appeared "still" behind active 3D content.

User preference shifted to the motion style of CodePen `P1N2O/pyBNzX`: clearly visible flow of the whole gradient field.

Requirements:

- obvious movement at projection distance,
- preserve readability of 3D blobs/mandala,
- avoid adding heavy Three.js shader complexity for background.

## Decision

Use CSS-driven moving gradient as primary motion model:

- transparent WebGL canvas (`gl.alpha = true`, no solid WebGL background clear),
- `::before` large `linear-gradient(-45deg, ...)` with oversized `background-size` and animated `background-position`,
- `::after` subtle texture/veil layer for softness,
- keep `prefers-reduced-motion` handling (disable animation).

## Consequences

Positive:

- clearly visible background movement,
- lightweight implementation (no extra WebGL scene complexity),
- easy to retune colors/speed in CSS.

Tradeoffs:

- background animation remains 2D (screen-space) rather than physically integrated 3D environment,
- can still distract if saturation/speed are overtuned; needs exhibition-specific calibration.
