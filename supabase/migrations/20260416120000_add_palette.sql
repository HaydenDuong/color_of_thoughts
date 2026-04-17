-- Color of Thoughts — phase 1.1: store the full palette alongside the primary color.
-- `palette` is an array of { r, g, b, hex, weight } objects (weight ∈ [0,1], sums to ~1).
-- Kept as JSONB for flexibility; existing r/g/b/hex columns are untouched.

ALTER TABLE public.submissions
  ADD COLUMN IF NOT EXISTS palette JSONB;

COMMENT ON COLUMN public.submissions.palette IS
  'Extracted color palette: array of {r,g,b,hex,weight} ordered by weight desc.';
