# Supabase (Color of Thoughts)

## Apply the initial migration

### Option A — SQL Editor (fastest)

1. Open [Supabase Dashboard](https://supabase.com/dashboard) → your project → **SQL Editor**.
2. Paste the full contents of `migrations/20260411120000_initial_schema.sql`.
3. Click **Run**.

If the last lines fail with “already exists” on `ALTER PUBLICATION`, the tables/policies may already be applied; enable **Realtime** manually for `submissions` and `participants` under **Database → Replication**.

### Option B — Supabase CLI

From the repo root (with CLI logged in and project linked):

```bash
supabase db push
```

## After migrating

- **Table Editor:** confirm `rooms`, `participants`, `submissions` exist.
- **Rooms:** you should see one row with slug `default` and id `00000000-0000-4000-8000-000000000001`.
- **Test insert (optional):** insert a `participants` row with that `room_id`, then a `submissions` row with that `participant_id`.

## Security note

RLS policies allow **anon** read/write on these tables for kiosk-style prototyping. **Tighten** (rate limits, Edge Functions, signed uploads) before exposing to untrusted internet.
