-- Color of Thoughts — initial schema (Phase 1)
-- Apply via Supabase SQL Editor (paste full file) or: supabase db push (CLI linked to project)

-- ---------------------------------------------------------------------------
-- Extensions
-- ---------------------------------------------------------------------------
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

-- ---------------------------------------------------------------------------
-- rooms: one row per exhibition / shared QR session (add more later if needed)
-- ---------------------------------------------------------------------------
CREATE TABLE public.rooms (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  slug TEXT NOT NULL UNIQUE,
  label TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- participants: one row per person per room (client holds participant UUID in localStorage)
-- ---------------------------------------------------------------------------
CREATE TABLE public.participants (
  id UUID PRIMARY KEY,
  room_id UUID NOT NULL REFERENCES public.rooms (id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  is_anonymous BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_participants_room ON public.participants (room_id);

-- ---------------------------------------------------------------------------
-- submissions: one active color sample per participant (re-upload updates this row)
-- ---------------------------------------------------------------------------
CREATE TABLE public.submissions (
  participant_id UUID PRIMARY KEY REFERENCES public.participants (id) ON DELETE CASCADE,
  r SMALLINT NOT NULL CHECK (r >= 0 AND r <= 255),
  g SMALLINT NOT NULL CHECK (g >= 0 AND g <= 255),
  b SMALLINT NOT NULL CHECK (b >= 0 AND b <= 255),
  hex TEXT NOT NULL CHECK (hex ~ '^#[0-9A-Fa-f]{6}$'),
  uniformity_score DOUBLE PRECISION NOT NULL CHECK (uniformity_score >= 0 AND uniformity_score <= 1),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- ---------------------------------------------------------------------------
-- Keep updated_at fresh on upsert
-- ---------------------------------------------------------------------------
CREATE OR REPLACE FUNCTION public.set_submissions_updated_at()
RETURNS TRIGGER
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at := now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER trg_submissions_updated_at
  BEFORE UPDATE ON public.submissions
  FOR EACH ROW
  EXECUTE FUNCTION public.set_submissions_updated_at();

-- ---------------------------------------------------------------------------
-- Seed: default room (stable id for Vite env DEFAULT_ROOM_ID)
-- ---------------------------------------------------------------------------
INSERT INTO public.rooms (id, slug, label)
VALUES (
  '00000000-0000-4000-8000-000000000001'::uuid,
  'default',
  'Default exhibition room'
)
ON CONFLICT (slug) DO NOTHING;

-- ---------------------------------------------------------------------------
-- Row Level Security (prototype: open read/write for anon — tighten before public internet)
-- ---------------------------------------------------------------------------
ALTER TABLE public.rooms ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.participants ENABLE ROW LEVEL SECURITY;
ALTER TABLE public.submissions ENABLE ROW LEVEL SECURITY;

-- Rooms: read-only from clients (rows created via migrations / dashboard)
CREATE POLICY "rooms_select_anon"
  ON public.rooms
  FOR SELECT
  TO anon, authenticated
  USING (true);

-- Participants: insert with valid room; read for wall
CREATE POLICY "participants_select_anon"
  ON public.participants
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "participants_insert_anon"
  ON public.participants
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.rooms r WHERE r.id = room_id)
  );

-- Submissions: upsert color for an existing participant only
CREATE POLICY "submissions_select_anon"
  ON public.submissions
  FOR SELECT
  TO anon, authenticated
  USING (true);

CREATE POLICY "submissions_insert_anon"
  ON public.submissions
  FOR INSERT
  TO anon, authenticated
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.participants p WHERE p.id = participant_id)
  );

CREATE POLICY "submissions_update_anon"
  ON public.submissions
  FOR UPDATE
  TO anon, authenticated
  USING (
    EXISTS (SELECT 1 FROM public.participants p WHERE p.id = participant_id)
  )
  WITH CHECK (
    EXISTS (SELECT 1 FROM public.participants p WHERE p.id = participant_id)
  );

-- ---------------------------------------------------------------------------
-- Realtime: exhibition wall subscribes to these tables (enable in Dashboard if this fails)
-- ---------------------------------------------------------------------------
ALTER PUBLICATION supabase_realtime ADD TABLE public.submissions;
ALTER PUBLICATION supabase_realtime ADD TABLE public.participants;
