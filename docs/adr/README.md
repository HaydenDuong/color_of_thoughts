# Architecture Decision Records (ADR)

This folder stores short, durable records of high-impact technical/artistic decisions for the wall system.

Use ADRs to recover context quickly when chat memory is unavailable, onboarding a new teammate/agent, or integrating this feature into another codebase.

## How To Read

Start here, then open ADRs in order:

1. `0001-mandala-primary-mode.md`
2. `0002-chaotic-ellipsoid-bound.md`
3. `0003-rotating-dock-targets.md`
4. `0004-wall-gradient-motion-model.md`

Each ADR follows:

- **Context**: problem and constraints at decision time
- **Decision**: chosen approach
- **Consequences**: benefits, tradeoffs, and operational impact

## ADR Index

- `0001-mandala-primary-mode.md`  
  Mandala selected as the primary exhibition representation; other modes remain secondary/testing.

- `0002-chaotic-ellipsoid-bound.md`  
  Chaotic blobs use an ellipsoidal boundary to fill widescreen space while calm core stays spherical.

- `0003-rotating-dock-targets.md`  
  Docked calm blobs follow rotating scaffold targets (Option B), while loose/chaotic blobs remain world-space.

- `0004-wall-gradient-motion-model.md`  
  Wall background uses CSS CodePen-style moving gradient over transparent WebGL canvas for visible motion.

## Related Docs

- `../Integration_guide.md` - migration and implementation checklist for integrating into a new site.
- `../../README.md` - project-wide timeline and operational notes.
