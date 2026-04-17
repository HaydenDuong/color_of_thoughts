# Color of Thoughts

Living spec for the project: goals, agreed features, and technical notes. Update this file as decisions change.

### Phase 1 prototype (`web/`)

- **Run locally:** `cd web` → `npm install` → `npm run dev` → open the URL Vite prints (usually `http://localhost:5173`).
- **Build:** `cd web` → `npm run build` (TypeScript check + production bundle).
- **What it does:** file picker → **k-means palette** (up to 8 colors, near-white pixels filtered) + averaged **primary color** from a **center crop** of the downscaled image → **twisted, grooved blob** where the surface bumps show the image's top 5 palette colors as **bands** (crayon-record look) → **swatch row** of the full palette + **hex / RGB / palette / uniformity** text.
- **Note:** color extraction runs **in the browser** for the fastest Phase 1 loop; the same math can move to a **Supabase Edge Function** later without changing the UI much.
- **Wall motion (`/wall`):** every sphere moves with simple 2D billiard physics — elastic collisions between spheres and against the camera's visible rectangle, ~0.7–1.3 units/sec per sphere, 98% restitution, tiny ambient jitter so motion never dies. Initial position and velocity are seeded from `participant_id` so no two spheres spawn identically. The whole group also parallaxes toward the mouse (Codrops-style); on the exhibition machine with no mouse input it simply sits still.
- **Visual:** cream background (`#F5EFE6`) on all 3D canvases. The sphere is a plain `THREE.ShaderMaterial` (no PBR lighting — bands come from color-is-a-function-of-noise, not from light direction) on an `IcosahedronGeometry` base. Approach ported from [Codrops — Creative WebGL Blobs, demo 3 "Insomnia"](https://github.com/codrops/WebGLBlobs) (MIT, by Mario Carrillo) with the 2-tone procedural `cosPalette` swapped for a weighted lookup into the user's extracted palette:
  - **Vertex shader** — Perlin-noise displacement along each vertex's normal, then `rotateY(pos, sin(uv.y * uFreq + t) * uAmp)` for the latitude-dependent twist that carves visible grooves, plus a gentle breathing scale.
  - **Fragment shader** — `t = fract(vUv.y * 1.35 + vDistort / strength * 0.45 + uPhase + uTime * 0.03)`; soft circular-window palette lookup so each color's visible share is proportional to its weight and adjacent colors crossfade cleanly. Tiny-weight floor guarantees 5% colors still appear.
  - **Per-sphere phase** — hashed from `participant_id` so 50 wall spheres read as distinct variations of the same event palette.
  - **Accessibility** — respects OS `prefers-reduced-motion`: slower speed, smaller twist, flatter breathing.

#### Progress (current)

- **Source:** latest work is on the **personal GitHub** repo (push after Supabase wiring).
- **Validated:** same browser **re-upload updates** the same `submissions` row; **new session** (e.g. incognito) creates a **new** `participants` + `submissions` row and a new anonymous display name.
- **Routes:** **`/`** upload · **`/wall`** live multi-sphere wall (Realtime refetch on `submissions`) · **`/qr`** QR code to the same origin’s upload URL (for the big screen).
- **Still Phase 1:** optional **deploy** (so QR uses a public URL), optional **Edge** extraction, **highlight “your” sphere** on phone vs neutral wall.

### Database (Supabase)

- **Schema file:** `supabase/migrations/20260411120000_initial_schema.sql` — `rooms`, `participants`, `submissions` (one color row per participant, upsert on re-upload), RLS for anon, seed room `default`, Realtime publication for wall updates.
- **Add-on migration:** `supabase/migrations/20260416120000_add_palette.sql` — adds a `palette JSONB` column to `submissions` (array of `{r,g,b,hex,weight}` ordered by weight desc) for the cloud-texture sphere.
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
