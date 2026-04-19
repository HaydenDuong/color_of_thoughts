# Color of Thoughts

Living spec for the project: goals, agreed features, and technical notes. Update this file as decisions change.

### Phase 1 prototype (`web/`)

- **Run locally:** `cd web` → `npm install` → `npm run dev` → open the URL Vite prints (usually `http://localhost:5173`).
- **Build:** `cd web` → `npm run build` (TypeScript check + production bundle).
- **What it does:** file picker → **k-means palette** (up to 8 colors, near-white pixels filtered) + averaged **primary color** from a **center crop** of the downscaled image → **twisted, grooved blob** where the surface bumps show every palette color as **bands** (dominant colors get wider bands, crayon-record look) → **swatch row** of the full palette + **turbulence selector (1..5 animated faces, live preview)** + explicit **"Send to wall"** button → **hex / RGB / palette / uniformity** text.
- **Upload flow (explicit commit):** upload → preview blob renders locally (nothing saved yet) → participant picks a turbulence rating and watches the blob breathe calmer or churn harder in real time → tap **Send to wall** to commit palette + primary color + rating to Supabase, or **Retake photo** to start over without a database write.
- **Note:** color extraction runs **in the browser** for the fastest Phase 1 loop; the same math can move to a **Supabase Edge Function** later without changing the UI much.
- **Wall motion (`/wall`):** the wall has **two architectures** of mode, toggled with a pill switch in the top-right; the choice is mirrored into the URL (`?mode=...`) so two tabs can show different modes side-by-side and a refresh keeps the current view.
  - **Physics modes** — every sphere is a freeform 2D billiard agent: elastic collisions between spheres and against the camera's visible rectangle, 98% restitution, all-elastic pairwise impulses. Three flavors:
    - **Flow** (default, `?mode=flow`) — soft vertical gradient instead of hard bands: rating 1 settles near the bottom, rating 5 near the top, with a weak spring that lets spheres freely cross the gradient. Each rating brings its own **motion character**: calm 1–2 steer along a slowly rotating "drift" heading (curvy graceful paths, no jitter), mixed 3 use the original billiard + jitter, turbulent 4–5 receive periodic **impulse kicks** on top of jitter (jagged agitation). Collisions stay active tank-wide so the ensemble still reads as a single flock.
    - **Orbit** (`?mode=orbit`) — concentric attractor field. Every sphere targets a circular orbit around the canvas center: calm 1 wide and slow (~85% tank radius), turbulent 5 tight and fast with pronounced radius wobble. A soft spring pulls each sphere toward its orbit target so collisions knock it off for a beat before it returns, producing a planetarium-like dance.
    - **Bands** (hidden, `?mode=bands`) — the original 3-layer layout (calm bottom / mixed middle / turbulent top) with a strong home-y spring, kept for comparison / supervisor demos. No UI button; reach it via the URL only.
    - Switching between physics modes is **state-preserving**: the same `PhysicsSphere[]` is reused, only the step function swaps. Positions and velocities carry over and the new mode's forces guide the ensemble into its new layout over ~1–2 s with no teleport. The whole group also parallaxes toward the mouse (Codrops-style); on the exhibition machine with no mouse input it sits still.
  - **Scaffold modes** — a fixed structure of "scaffold" blobs renders a coherent surface, and each user takes a unique cell on that structure. There is no freeform physics here; positions are wholly determined by the surface function plus per-arrival ripples. See **Wave** below; **Mandala** is next on the same architecture.
    - **Wave** (`?mode=wave`) — a 12×8 grid of 96 **deep-navy "scaffold" blobs** forms a horizontal sea surface in the **X–Z plane** (Y is up); rows recede from `zNear ≈ +1.5` (closest to camera) to `zFar ≈ -4.5` (deepest). User blobs are hashed to unique cells (linear probing on collisions) and replace the scaffold blob at their cell, so each uploader literally takes a seat at the table. Every blob's Y position comes from a 4-octave **Tessendorf-style summed-sines** wave function whose amplitude, frequency, speed, and choppiness are driven by the room's **storm factor** = `(turb − calm) / (turb + calm)` — all-calm rooms get gentle slow swells, all-turbulent rooms get tall fast chop with peaked crests. **Scaffold is always deep navy by intent** (the original collective-palette experiment is in `derivePalette`/`DEFAULT_SCAFFOLD_PALETTE` for future use); the room's mood reads through wave *motion* + the contrast of multicolor user blobs popping against the navy sea, not through scaffold tint. Each new upload also fires a one-shot **circular ripple** from its cell — ~2.5 s lifetime, amplitude scales with the uploader's turbulence rating (calm-1 whispers, turbulent-5 splashes). Camera lifts to Y=2.6 and looks at (0, 0, -1.5) for a ~19° downward pitch (so back rows recede into a horizon line near the upper third), with a slow ±2° sway. Scaffold uses `IcosahedronGeometry(1, 8)` (lower detail than user blobs, since 96 of them).
- **Visual:** cream background (`#F5EFE6`) on all 3D canvases. The sphere is a plain `THREE.ShaderMaterial` (no PBR lighting — bands come from color-is-a-function-of-noise, not from light direction) on an `IcosahedronGeometry` base. Approach ported from [Codrops — Creative WebGL Blobs, demo 3 "Insomnia"](https://github.com/codrops/WebGLBlobs) (MIT, by Mario Carrillo) with the 2-tone procedural `cosPalette` swapped for a weighted lookup into the user's extracted palette:
  - **Vertex shader** — Perlin-noise displacement along each vertex's normal, then `rotateY(pos, sin(uv.y * uFreq + t) * uAmp)` for the latitude-dependent twist that carves visible grooves, plus a gentle breathing scale.
  - **Fragment shader** — `t = fract(vUv.y * 1.35 + vDistort / strength * 0.45 + uPhase + uTime * 0.03)`; soft circular-window palette lookup so each color's visible share is proportional to its weight and adjacent colors crossfade cleanly. Tiny-weight floor guarantees 5% colors still appear.
  - **Per-sphere phase** — hashed from `participant_id` so 50 wall spheres read as distinct variations of the same event palette.
  - **Turbulence multipliers** — the 1..5 rating scales `uSpeed`, `uNoiseStrength`, `uAmp`, and `uBreathAmp` relative to the rating-3 defaults (calm = ×0.35–0.5, turbulent = ×1.5–1.9). Live preview updates these uniforms in place (no material rebuild) so tapping faces on `/upload` animates continuously.
  - **Accessibility** — respects OS `prefers-reduced-motion`: slower speed, smaller twist, flatter breathing, and compressed turbulence range.

#### Progress (current)

- **Source:** latest work is on the **personal GitHub** repo (push after Supabase wiring).
- **Validated:** same browser **re-upload updates** the same `submissions` row; **new session** (e.g. incognito) creates a **new** `participants` + `submissions` row and a new anonymous display name.
- **Routes:** **`/`** upload · **`/wall`** live multi-sphere wall (Realtime refetch on `submissions`) · **`/qr`** QR code to the same origin’s upload URL (for the big screen).
- **Still Phase 1:** optional **deploy** (so QR uses a public URL), optional **Edge** extraction, **highlight “your” sphere** on phone vs neutral wall.

#### Wall canvas sizing

- **Canvas height** is set in `.wall-canvas-wrap` (`App.css`) to `min(82vh, 1080px)` so the tank fills most of the viewport on laptops and up to a roomier 1080-pixel max on large monitors. The physics tank auto-recomputes from canvas size, so the bigger the canvas, the more room spheres get — no code changes needed.
- **Wall page layout** (`.wall-page.app`) widens to `1600px` on the `/wall` route only; the header / list / toolbar stay capped at `960px` for readable line lengths while the canvas breaks out wider.
- **Dynamic sphere sizing:** `WallScene` computes a single `scaleFactor = clamp(sqrt(20 / count), 0.6, 1.2)`, exponentially smoothed with τ=0.2s, and applies it **every frame** to both the mesh `scale` and each sphere's physics-collision `radius`. With ≤20 spheres the wall looks big and airy (up to 1.2×); by ~60 spheres everything has shrunk to ~0.58× so the wall stays breathable. The smoothing makes arrivals/departures ripple through the ensemble instead of snapping.
- **Lever C — fullscreen "Present" button (deferred until projector setup):** CSS already lets the canvas grow; the remaining step is a button on `/wall` that calls `element.requestFullscreen()` (via the Fullscreen API) on the canvas wrapper. Keyboard shortcut candidate: `F`. When implementing, also add a translucent "Exit fullscreen" hint, hide `SiteNav` + header + list in the `:fullscreen` state, and restore them on exit. No backend work required — pure CSS + one event handler.

#### Dev mode (`/wall?test=N`)

- Append `?test=N` (1–200, default **30**) to `/wall` to render deterministic **synthesized** blobs with random palettes + ratings. Supabase is **not** queried and **no rows are written**. Navigate back to `/wall` (without the param) to return to live data.
- Seed is fixed (`1337`), so the same `?test=30` URL always produces the exact same 30 blobs. Combine with `&mode=orbit`/`&mode=flow`/`&mode=wave` to stress-test any motion mode.
- **`&storm=BIAS`** (no effect without `?test=`) forces the rating distribution so you can see each end of the storm spectrum without needing 30 real uploads:
  - `storm=calm` — every entry rated 1 or 2 → wave shows gentle slow swells.
  - `storm=turbulent` — every entry rated 4 or 5 → wave shows tall fast chop with peaked crests.
  - `storm=neutral` — every entry rated 3 → ambient swell (the no-polar-users path).
  - `storm=mixed` (default) — uniform random 1..5.
  - Example: `/wall?test=60&mode=wave&storm=turbulent` for a stormy sea, `/wall?test=60&mode=wave&storm=calm` for a calm one.
- **`&explore=1`** swaps the auto camera for mouse OrbitControls so you can drag-orbit, scroll-zoom, and right-drag-pan the scene from any angle (including straight-down "from above"). Touch devices get 1-finger orbit + 2-finger pan/pinch. The `Explore` toggle in the toolbar writes the same URL flag, so refresh keeps the explore state. Off by default so the exhibition projector stays hands-off; turning it on suppresses the wave camera rig and physics-mode mouse parallax to avoid both controllers fighting over the camera.
- Useful for: verifying Flow/Orbit/Wave layouts at crowd scale, eyeballing the dynamic-sizing ripple, comparing storm states for a screenshot, and inspecting the wave from any angle.

### Database (Supabase)

- **Schema file:** `supabase/migrations/20260411120000_initial_schema.sql` — `rooms`, `participants`, `submissions` (one color row per participant, upsert on re-upload), RLS for anon, seed room `default`, Realtime publication for wall updates.
- **Add-on migration:** `supabase/migrations/20260416120000_add_palette.sql` — adds a `palette JSONB` column to `submissions` (array of `{r,g,b,hex,weight}` ordered by weight desc) for the cloud-texture sphere.
- **Add-on migration:** `supabase/migrations/20260418130000_add_turbulence.sql` — adds a `turbulence SMALLINT NOT NULL DEFAULT 3 CHECK (turbulence BETWEEN 1 AND 5)` column to `submissions`; drives both the blob's breathing and the wall band layout.
- **Apply:** paste each SQL file in order in the Supabase **SQL Editor** and run, or use the Supabase CLI (`supabase db push`). Step-by-step: `supabase/README.md`.
- **Env:** copy `web/.env.example` → `web/.env.local` and set `VITE_SUPABASE_URL`, `VITE_SUPABASE_ANON_KEY`, and `VITE_DEFAULT_ROOM_ID` (**must match** the `rooms.id` row in your project, often the seeded default).
- **App wiring:** after upload, the client **creates a `participants` row** once per browser+room (anonymous label + localStorage), then **upserts `submissions`** so repeat uploads update the same color row.
- **Realtime (wall):** migration adds `submissions` to `supabase_realtime`. If live updates do not fire, confirm **Database → Publications / Replication** in the dashboard includes **`submissions`**.

---

## Objective

- **Web application** where users upload a **photo of a colored piece of paper** from their device.
- **Dominant color** is derived from the image (center crop / ignore edges). **Prototype:** client-side in `web/`; **later:** server-side (Edge Function) for consistent processing and privacy options.
- Color is shown on the frontend as a **3D sphere** (e.g. Three.js or React Three Fiber), not only a flat 2D circle. Prefer shared geometry, simple materials, and gentle motion so ~50 spheres stay performant on the **exhibition machine** (test on real hardware / projector).
- **Phase 2 (analysis):** explore links to mood or affect using stored color metrics. **Do not** treat “darker = sad, lighter = excited” as universal truth—frame as exploratory and culturally limited. Phase 1 priority: **end-to-end concept that works** (upload → color → wall).

---

## Core UX

| Area | Decision |
|------|----------|
| **QR code** | **One shared session** per exhibition: single QR opens upload URL for the current room/event. |
| **Wall vs phone** | **Main screen:** all spheres shown in a “normal” style. **User’s device:** after processing, **highlight** their sphere (by server-returned id), not by guessing from similar colors. |
| **Layout & motion** | Spheres placed with **random but stable** feel (e.g. hash `participant_id` → position + **slow drift**). Avoid pure re-random on every reload if possible; optional minimum separation so ~50 objects do not stack. |
| **Re-uploads** | **One active sphere per user per event:** new upload **updates** the same participant’s entry (with a short **pulse/flash** on update). Optional later: append-only **history** table for analysis while display stays one row per participant. |

---

## Identity: name vs anonymous

- User may **show a chosen name** or **anonymous** display (Facebook-style random label, e.g. “Quiet Maple”).
- **Anonymous label must stay the same for that person for that exhibition:** stored in **Supabase** (not regenerated on refresh).
- **Pattern:** On first visit to the room’s upload flow, client gets or creates a **`participant_id`** (UUID), stored in **localStorage** (keyed by room). Server creates/returns **`display_name`** once; subsequent requests use **`participant_id`** to retrieve the same row.
- **Scope:** New device / cleared storage → new participant → new anonymous name unless you add login or magic links later.

---

## Scale & environments

- Target: handle on the order of **~50 concurrent participants**.
- **Phones use their own networks** (cellular / personal Wi‑Fi): less reliance on venue Wi‑Fi; still need **HTTPS**, **upload size limits**, **client downscale** + **server resize** before sampling, **timeouts/retries**, and **rate limits** per participant to avoid double-taps.
- **Exhibition display** should use a **stable connection** (wired or reliable Wi‑Fi); Realtime updates subscribe from there.

---

## Technical direction (high level)

- **Color extraction:** **Server-side** (e.g. Supabase Edge Function or API): resize image, sample/crop paper region, compute dominant color. Optionally **delete image** after extraction for privacy and storage (phase 1 default unless study requires retention).
- **Realtime wall:** e.g. **Supabase Realtime** on submissions for the room so the big screen updates without heavy polling.
- **3D fallback (optional):** If WebGL unavailable, fall back to a 2D gradient circle with the same color.

### Data to persist (recommended)

- **RGB** for rendering; also **LAB or HSL** (and components) for **phase 2** analysis—lightness is more meaningful than raw RGB for “dark vs light” hypotheses.
- **Confidence / uniformity score** on the crop (e.g. variance of pixels): use for gentle phone messaging (“Try more even lighting”); optional filter for analysis later.

### Event / room identifier

- **Single exhibition:** a fixed **`room_id`** (or one event row) in config may be enough—**short event code in the QR is optional** if you will not run multiple rooms or rehearsal vs live separation. Add a code later if you need test vs prod walls or resets without redeploy.

---

## Accessibility

- On the **phone** (and optionally as a small wall caption): **text** confirming identity (“You appear as …”), **color summary** (e.g. hex or simple name), and short confirmation (“Your color is on the wall”). Do not rely on color alone for meaning.

---

## Privacy & ops

- Photos may include fingers, faces, or background: **instruct users** to fill frame with paper; **crop** aggressively server-side.
- **GitHub / Supabase access:** coordinate with supervisor (invites, org ownership, secrets, who pays for Supabase).
- **Secrets:** never commit API keys; document env vars for local vs deployed wall.
- **Starting solo:** you can use **your own GitHub repo and Supabase project** first and migrate to the team later—see **Migration plan** below.

---

## Migration plan (personal → team)

You do **not** need to block on supervisor invites to make progress. Treat your personal repo and Supabase as **dev / staging**; move to org resources when access is ready.

### Before you build (low effort, high payoff)

1. **Confirm policy when you can:** some labs want work in their GitHub org from day one—ask once; if “personal first then transfer” is fine, proceed.
2. **Version the schema:** use Supabase CLI **`migrations/`** (or checked-in SQL) so the team project can be recreated with the same tables, RLS, and functions.
3. **Single config surface:** `SUPABASE_URL`, anon key, and service role (server/Edge only) live in **environment variables**—never hardcode project refs across the codebase.
4. **RLS from the start:** design policies as if the database were shared; avoids “open for dev, panic before prod.”

### What migrates easily

| Asset | Approach |
|--------|----------|
| **Git history** | Push to a new `origin`, or **transfer** the repo into the org (if GitHub/org settings allow). |
| **Database** | Run the **same migrations** on the new Supabase project; usually **no need** to copy personal dev data. |
| **App code** | Unchanged; swap env vars to point at the team project. |

### When switching Supabase projects

1. Create the **team** Supabase project (or get credentials from supervisor).
2. Apply **migrations** in order; redeploy **Edge Functions** if any.
3. Update **Auth** settings: **Site URL** and **redirect URLs** for the final exhibition / deploy domain.
4. Update **hosting / CI** env vars (`SUPABASE_URL`, keys). Deploy wall + upload app against the new project.
5. **Rotate:** stop using personal keys in production; revoke or leave personal project for your own experiments only.

### Optional: GitHub

- Add the org repo as a **second remote** and push, or make **transfer** the canonical home once the org accepts it.

### After migration

- [ ] Team Supabase is the only target for production deploys.
- [ ] README / deploy docs list the correct env var names (not old personal URLs).
- [ ] Old personal **service_role** keys are not in CI or shared docs.

---

## Phase 2 (reminder)

- Mood or affect analysis using stored metrics; careful wording in any public-facing copy.
- Optional **`submission_history`** for research while UI keeps one active orb per participant.

---

## Open checklist (fill in as you go)

- [x] Stack locked: **React + Vite + R3F + Supabase JS** (`web/`).
- [x] **Supabase migration applied** (`20260411120000_initial_schema.sql` via SQL Editor or CLI) — see `supabase/README.md`.
- [x] **`web/.env.local`** + **`@supabase/supabase-js`**: upload flow inserts/upserts `participants` + `submissions` for the default room.
- [x] Schema + RLS in Supabase (`rooms`, `participants`, `submissions`).
- [x] **Personal GitHub:** current code pushed (team org / migration later).
- [ ] Edge function or API for upload + color + confidence.
- [x] **Wall** page (`/wall`): Realtime-driven refetch + multi-sphere 3D scene + text list.
- [x] **QR** page (`/qr`): encodes current origin + base path → upload (`/`).
- [ ] Upload flow: **public** URL via deploy so phones off-LAN can scan the same QR.
- [ ] Deploy frontend (e.g. Vercel / Netlify) with `VITE_*` env vars.
- [ ] Supervisor: GitHub repo + Supabase project access (or **migration** from personal → team when invites land).

---

## Document history

| Date | Notes |
|------|--------|
| 2026-04-10 | Initial README from agreed design discussion. |
| 2026-04-10 | Added migration plan (personal GitHub/Supabase → team). |
| 2026-04-10 | Phase 1 `web/` app: Vite + React + R3F, upload → dominant color → 3D sphere. |
| 2026-04-11 | Supabase initial migration + `web/.env.example` + `supabase/README.md` (apply schema today). |
| 2026-04-12 | Wired `web/` to Supabase: anonymous participant + submission upsert after color extraction. |
| 2026-04-12 | README progress: validated re-upload vs new session; GitHub push noted; checklist updated (wall/QR/deploy still open). |
| 2026-04-16 | Wall (`/wall`), QR (`/qr`), React Router, `react-router-dom` + `qrcode.react`. |
| 2026-04-16 | Palette pipeline (k-means, 8 colors, near-white filter) + cloud-texture sphere; cream (`#F5EFE6`) canvas backgrounds on `/` and `/wall`; `submissions.palette` JSONB column. |
| 2026-04-16 | Swap cloud-texture sphere → **GLSL marble shader** (domain-warped Perlin noise over top-5 palette colors, `three-custom-shader-material` + `MeshPhysicalMaterial` iridescence/clearcoat). Retired `paletteTexture.ts`. |
| 2026-04-16 | **Breathing blob**: spatial color blending → **temporal color cycling** (dwell ∝ weight, soft crossfades, per-sphere phase offset) + **vertex displacement with recomputed normals** in the vertex shader. Added `usePrefersReducedMotion` hook (slower cycle + flatter displacement when reduce-motion is on). Wall meshes switched to unit-sphere geometry + `scale` so the displacement math is consistent at every size. |
| 2026-04-16 | **Insomnia-style blob**: temporal cycling did not match the banded look the supervisor was after. Ported Codrops WebGLBlobs demo 3 pipeline — plain `ShaderMaterial`, latitude-twist via `rotateY(sin(uv.y * uFreq + t) * uAmp)`, color = palette-lookup of `vDistort`. Replaced their 2-tone procedural `cosPalette` with a weighted lookup into the user's extracted palette so the visible bands are the image's own crayon colors. Geometry switched to `IcosahedronGeometry` (even triangles, no pole pinching when twisted). Removed `three-custom-shader-material` / PBR wrappers — bands rely on unlit color. |
| 2026-04-16 | **Wall physics**: supervisor asked for spheres that move faster and collide with each other + the walls. Added `web/src/lib/wallPhysics.ts` — 2D billiard engine (position integration, wall bounce with damping, O(N²) pair-collision with equal-mass elastic impulse, ambient jitter to prevent energy decay). Rewired `WallScene` around a single `useFrame` loop that steps physics + syncs mesh positions. Camera frustum at z=0 is the tank; each sphere's initial position and velocity are seeded from its `participant_id` hash. Added mouse-parallax scene rotation (Codrops-style) and capped DPR at 1.5 for perf. Removed `OrbitControls` on the wall (physics + parallax already provide motion) and retired the now-unused `placement.ts`. Reduced-motion users get a calmer tank (lower max speed and jitter). |
| 2026-04-18 | **All palette colors in the blob**: bumped `MAX_COLORS` from 5 → 8 (matches `PALETTE_SIZE` k-means) so every extracted color — including low-weight ones — gets a visible band, while weighted-window lookup still gives dominant colors proportionally more show time. Tightened `softness` 0.10 → 0.07 so neighbors stay readable at the denser packing. |
| 2026-04-18 | **Turbulence rating (1..5)**: supervisor asked for motion to reflect emotion. Added `TurbulenceSelector` (5 animated SVG-face radios in a cream Uiverse-style pill, left-to-right order = happy/Calm → angry/Turbulent; Aaron Iker shake/tear/flash animations preserved, MIT). Added `lib/turbulence.ts` as a single source of truth mapping the rating to shader multipliers (`uSpeed`, `uNoiseStrength`, `uAmp`, `uBreathAmp`) and physics behaviors (`maxSpeed`, `jitterX`, `jitterY`, `homeK`, `yDamp`, band). `PaletteSphereMaterial` now accepts `turbulence` and mutates uniforms in place via `useEffect` — the live preview never rebuilds the material, so animation keeps running as the user taps faces. `wallPhysics` rewritten to per-sphere behavior: three horizontal bands (calm bottom / mixed middle / turbulent top) with a soft home-spring so cross-band collisions still look natural, plus stronger vertical damping for calm spheres so they flow almost horizontally. Migration `20260418130000_add_turbulence.sql` adds the column with a 1..5 CHECK constraint, default 3. |
| 2026-04-18 | **Explicit-commit upload flow**: `/upload` no longer auto-syncs on file pick. New order: upload → local preview + palette + turbulence selector (live blob update) → **Send to wall** button writes to Supabase, or **Retake photo** resets state without touching the DB. Sync UI only surfaces after the user commits. `ensureParticipantAndUpsertSubmission` now takes a `turbulence` argument; `WallEntry` + `fetchWallSubmissions` pull the column through with defensive `normalizeTurbulence`. |
| 2026-04-18 | **Multi-mode wall + dev mode + dynamic sizing**: split `wallPhysics.stepPhysics` into `stepFlowPhysics` / `stepOrbitPhysics` / `stepBandsPhysics`; added a Flow/Orbit pill switch on `/wall` (URL-mirrored via `?mode=`). `WallScene` now applies a global `scaleFactor = clamp(sqrt(20 / count), 0.6, 1.2)` (exponentially smoothed, τ=0.2s) every frame to both the visual mesh `scale` and each sphere's collision `radius`, so the wall stays breathable as the crowd grows. Canvas height widened (`min(82vh, 1080px)`) and `/wall` page max-width raised to 1600px. Added `/wall?test=N` (1–200, default 30) for deterministic synthetic blobs that bypass Supabase entirely. Lever C (fullscreen "Present" button) documented but deferred. |
| 2026-04-18 | **Wave scaffold mode**: introduced the "scaffold + agents" architecture. Added `lib/aggregatePalette.ts` (`DEFAULT_SCAFFOLD_PALETTE` deep-navy + a `derivePalette` helper kept for future use), `lib/waveScaffold.ts` (12×8 grid, 4-octave Tessendorf-like summed-sines wave function with storm-driven amplitude/frequency/speed/choppiness, one-shot ripple primitive scaled by uploader turbulence, hash + linear-probe cell assignment), and `components/WaveStage.tsx` (96 scaffold blobs + N user blobs sharing wave-driven Y; user blobs hide the scaffold blob at their assigned cell). `WallScene` now dispatches between `<PhysicsGroup>` and `<WaveStage>` on the `mode` prop, and a new `CameraRig` lerps the camera between the level physics framing and the lifted wave framing with subtle ±2° sway. `PaletteSphereMaterial` rebuilt to **mutate `uColors` / `uWeights` in place** when the palette prop changes (paletteKey moved out of the material identity), keeping the door open for the v2 colored-scaffold experiments without recompiling shaders or freezing animations. Mandala mode is the next planned scaffold (slowly-rotating Fibonacci-sphere navy core; calm users lock onto outer shell; turbulent users knock them loose). |
| 2026-04-18 | **Wave v2 — orientation fix + Option A scaffold**: first wave build placed the grid in X–Y with wave height as Z, which under the tilted camera read as a wall of stacked blobs (no horizon). Switched the grid to the **X–Z plane with Y as wave height** — `ScaffoldCell` now has `{x, z}`, `Ripple` uses `{originX, originZ}`, `waveHeight(x, z, t, p)` driving Y, and `defaultWaveLayout(fov, aspect, cameraZ)` sizes a sea floor that fits the visible frustum (`zNear=+1.5`, `zFar=-4.5`). Camera lifts to Y=2.6 looking at (0, 0, -1.5) so back rows recede into a real horizon line in the upper third of the frame. **Scaffold simplified to always deep navy** (Option A) — the calm/turbulent collective-palette blending was visually indistinguishable from user blobs and lost the "navy sea + colorful arrivals" reading entirely; `computeWaveColorState`/`lerpPalettes` removed, but `derivePalette` + `DEFAULT_SCAFFOLD_PALETTE` stay exported for future v2 polish. |
| 2026-04-18 | **Wave tuning — wider storm spread**: testing with `?storm=` showed `calm` and `neutral` looked nearly identical (default amp 0.10 vs calm-end 0.06 — practically the same flat sea) and `turbulent` didn't read as actually stormy (amp 0.45, freq 1.05, chop 0.6). Pushed the spread: calm-end is now almost-glassy (`amp 0.04`, `freq 0.28`, `speed 0.18`), neutral default is a clearly-rolling sea (`amp 0.22`, `freq 0.70`, `speed 0.50`), and turbulent-end is a wild chop (`amp 0.95`, `freq 2.40`, `speed 1.50`, `chop 1.0` with sharpening coefficient 1.5 → 3.0 so crests actually peak). Choppiness ramp moved past 30 % storm so calm/neutral stay smooth-sined. `rippleAmplitudeFor` widened (0.10..0.45 → 0.08..0.70) so a turbulent uploader also makes a visibly bigger splash. |
| 2026-04-18 | **Storm bias + Explore camera**: added `?storm=calm\|turbulent\|neutral\|mixed` (alongside `?test=N`) so dev/QA can force a calm- or turbulent-dominant room without needing 30 real uploads — `generateTestEntries` now takes a `StormBias` parameter and clamps each rating into the requested band. Added `?explore=1` (and a matching `Explore` toolbar toggle that writes the same URL flag) which swaps the auto-positioning camera for `<OrbitControls>` from drei: drag-orbit, scroll-zoom, right-drag-pan, polar-clamped just shy of straight-down/up so the user can look "from above" without flipping past vertical. Initial OrbitControls target is mode-aware (sea-floor center for wave, origin for physics modes). Both `CameraRig` and the physics `useFrame` parallax block are suppressed when explore is on so the two controllers don't fight over the camera; the parallax accumulator is also reset to zero on the way out so the next physics-mode session doesn't inherit a stale group rotation. |
