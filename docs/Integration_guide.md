# Color of Thought - Integration Guide

This guide is for integrating the Mandala wall feature into another website when prior chat memory/context may be unavailable.

## 1) Scope

Integrate these capabilities:

- `/wall` exhibition scene with modes, currently focused on `mandala`
- Supabase-backed live submissions + realtime updates
- Mandala physics:
  - rotating scaffold
  - calm dock behavior
  - chaotic meteor behavior
  - knock-off + re-dock cycle
- URL-based debug/tuning controls
- Animated gradient wall background behind transparent WebGL canvas

Out of scope for first pass: redesigning UI structure, changing database schema semantics, replacing physics model.

## 2) Source Modules To Port

Primary files:

- `web/src/pages/WallPage.tsx`
- `web/src/components/WallScene.tsx`
- `web/src/components/MandalaStage.tsx`
- `web/src/lib/mandalaScaffold.ts`
- `web/src/lib/wallPhysics.ts` (mode types + shared expectations)
- `web/src/App.css` (wall background + canvas wrapper styles)

Data/client support files (if not already present in target app):

- `web/src/lib/wallData.ts`
- `web/src/lib/supabaseBrowser.ts`
- `web/src/lib/env.ts`
- `web/src/lib/testWallData.ts` (for test mode)
- any shared types referenced by the above

## 3) Required Dependencies

Install/verify:

- `react`
- `react-router-dom`
- `three`
- `@react-three/fiber`
- `@react-three/drei`
- `@supabase/supabase-js`

If TypeScript project, ensure TS config supports JSX + module resolution used by the app.

## 4) Route Wiring

Add routes equivalent to:

- `/wall` -> `WallPage`
- `/upload` -> upload page
- `/qr` -> QR page

Keep URL search params preserved on `/wall` navigation.

## 5) Environment Contract

Expected public env vars:

- Supabase URL
- Supabase anon key
- default room id

Maintain existing env access pattern used by `getSupabasePublicConfig()` and `getSupabaseBrowserClient()`.

## 6) Wall Runtime Controls (URL params)

Support these query params on `/wall`:

- `mode=flow|orbit|wave|mandala|bands`
- `test=N`
- `storm=calm|turbulent|neutral|mixed`
- `explore=1|true|yes|on`
- `metFrac=N` (mandala meteor speed/frequency scaler)

These are required for validation and exhibition tuning without redeploy.

## 7) Critical Behavioral Invariants

### Mandala

- Scaffold rotates continuously.
- Docked calm blobs follow rotating dock targets.
- Calm blobs only rotate while docked.
- Knocked-off calm blobs drift, then claim new slot.
- Chaotic blobs remain world-space meteor agents.

### Bounds

- Calm/dock/overflow use tight spherical bound.
- Chaotic use ellipsoidal widescreen bound.

### Camera

- Non-explore default camera frames full meteor belt.
- Explore mode uses OrbitControls and disables auto-camera conflict.

### Background

- Three.js canvas is transparent (`alpha: true`).
- CSS animated gradient provides moving wall background behind canvas.

## 8) Acceptance Test Checklist

Run locally and verify:

1. `/wall?mode=mandala&test=15&storm=mixed&explore=1&metFrac=1.0`
   - rotating scaffold visible
   - calm blobs dock/rotate with scaffold
   - chaotic blobs drift as meteorites in wider belt

2. `/wall?mode=mandala&test=15&storm=turbulent&metFrac=1.5`
   - clearly faster chaotic pacing

3. `/wall?mode=mandala&test=15&storm=calm&metFrac=0.7`
   - calmer motion, fewer energetic disruptions

4. `/wall?mode=wave&test=30&storm=turbulent`
   - no regressions in other modes

5. Remove `test` param
   - realtime data path still functions with Supabase

## 9) Common Integration Pitfalls

- Canvas not transparent (background animation invisible)
- Missing search-param parsing for `metFrac`/`explore`
- Route-level CSS scope lost (wall styles not applied)
- Dock target rotation not passed to physics step
- Camera + OrbitControls both active simultaneously
- Supabase env names mismatched in target app
- stale local participant id handling removed accidentally

## 10) Suggested Integration Order (PR-friendly)

1. Base route + WallPage + basic scene render
2. Mandala scaffold + physics + mode wiring
3. URL controls + test mode + explore controls
4. Supabase realtime path
5. Gradient background + visual tuning
6. README/docs update + screenshots + test URLs

## 11) Handover Prompt For Fresh Agent

Use this prompt in the target repo:

> Read `README.md` and `docs/Integration_guide.md` first.  
> Implement the Mandala wall integration in phases: route -> scene -> mandala physics -> URL controls -> supabase realtime -> animated wall background.  
> Preserve behavioral invariants and validate using acceptance URLs in section 8.  
> Summarize deviations explicitly if any.

## 12) Done Definition

Integration is complete when:

- build passes
- lint passes
- acceptance URLs behave as expected
- no regressions in existing routes
- docs updated with any environment or route differences
