# ADR 0001: Mandala As Primary Exhibition Mode

- Status: Accepted
- Date: 2026-04-26

## Context

The wall supports multiple visual representations (`flow`, `orbit`, `wave`, `mandala`, hidden `bands`).  
Supervisor/user feedback converged on Mandala as the strongest representation for the psychology exhibition because it expresses:

- structure/order (calm docking behavior),
- disruption/impermanence (chaotic meteor behavior),
- ongoing process instead of completion (knock-off + re-dock cycle).

The exhibition needs a mode that is both conceptually meaningful and visually legible at projection scale.

## Decision

Use `mandala` as the primary exhibition mode while keeping other modes available for testing/comparison.

`WallPage` mode controls continue to expose multiple modes, but operational focus, tuning, and validation are centered on Mandala.

## Consequences

Positive:

- Clear artistic/narrative focus for demonstrations and supervisor reviews.
- Engineering tuning effort targets one mode deeply (motion, camera, bounds, pacing, background).
- Integration into other sites can be scoped around a primary mode first.

Tradeoffs:

- Additional modes receive less tuning depth unless explicitly revisited.
- Documentation must clearly mark Mandala as primary and others as secondary.
