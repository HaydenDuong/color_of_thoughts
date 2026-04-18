-- 20260418130000_add_turbulence.sql
--
-- Adds a 1..5 "turbulence" rating to each submission. The rating drives both
-- the blob's per-sphere shader multipliers (speed / churn / amp) and the
-- wall's per-sphere physics (band Y, speed cap, jitter), so this column
-- must be populated and clamped to 1..5. Existing rows get the midpoint
-- (3 = "Mixed") so the wall does not change layout abruptly after deploy.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS turbulence SMALLINT NOT NULL DEFAULT 3
    CHECK (turbulence BETWEEN 1 AND 5);

COMMENT ON COLUMN public.submissions.turbulence IS
  '1 = very calm, 5 = very turbulent. Drives shader breathing + wall band.';
