# Color of Thoughts

Living spec for the project: goals, agreed features, and technical notes. Update this file as decisions change.

### Phase 1 prototype (`web/`)

- **Run locally:** `cd web` → `npm install` → `npm run dev` → open the URL Vite prints (usually `http://localhost:5173`).
- **Build:** `cd web` → `npm run build` (TypeScript check + production bundle).
- **What it does:** file picker → **dominant color** from a **center crop** of the downscaled image → **3D sphere** + **hex / RGB / uniformity** text (uniformity is a heuristic for later “try better lighting” hints).
- **Note:** color extraction runs **in the browser** for the fastest Phase 1 loop; the same math can move to a **Supabase Edge Function** later without changing the UI much.

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

- [ ] Stack locked (e.g. React + R3F + Supabase).
- [ ] Schema: `participants` / `submissions` or unified upsert table + RLS policies.
- [ ] Edge function or API for upload + color + confidence.
- [ ] Wall page: Realtime subscription + 3D scene test on exhibition hardware.
- [ ] Upload page: QR target URL, participant bootstrap, accessibility copy.
- [ ] Supervisor: GitHub repo + Supabase project access (or **migration** from personal → team when invites land).

---

## Document history

| Date | Notes |
|------|--------|
| 2026-04-10 | Initial README from agreed design discussion. |
| 2026-04-10 | Added migration plan (personal GitHub/Supabase → team). |
| 2026-04-10 | Phase 1 `web/` app: Vite + React + R3F, upload → dominant color → 3D sphere. |
