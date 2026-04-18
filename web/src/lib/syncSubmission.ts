import type { DominantColorResult } from './colorFromImage'
import { generateAnonymousLabel } from './anonymousLabel'
import {
  loadStoredParticipant,
  saveStoredParticipant,
  clearStoredParticipant,
  type StoredParticipant,
} from './participantSession'
import type { SupabaseClient } from '@supabase/supabase-js'
import type { TurbulenceRating } from '../components/TurbulenceSelector'

async function createParticipant(
  supabase: SupabaseClient,
  roomId: string,
): Promise<StoredParticipant> {
  const id = crypto.randomUUID()
  const displayName = generateAnonymousLabel()

  const { error } = await supabase.from('participants').insert({
    id,
    room_id: roomId,
    display_name: displayName,
    is_anonymous: true,
  })

  if (error) throw new Error(error.message)

  const participant = { id, displayName }
  saveStoredParticipant(roomId, participant)
  return participant
}

async function upsertSubmission(
  supabase: SupabaseClient,
  participant: StoredParticipant,
  color: DominantColorResult,
  turbulence: TurbulenceRating,
): Promise<void> {
  const { error } = await supabase.from('submissions').upsert(
    {
      participant_id: participant.id,
      r: color.r,
      g: color.g,
      b: color.b,
      hex: color.hex,
      uniformity_score: color.uniformityScore,
      palette: color.palette,
      turbulence,
    },
    { onConflict: 'participant_id' },
  )

  if (error) throw new Error(error.message)
}

/**
 * Ensures a `participants` row exists (creates on first visit for this browser+room),
 * then upserts `submissions` so re-upload updates the same row (one orb per user).
 *
 * Handles "stale localStorage" gracefully: if the stored participant_id no longer
 * exists in the DB (e.g. after a database reset), the RLS/FK error on upsert is caught,
 * the stale identity is cleared, a fresh participant is created, and the upsert is retried.
 * The user gets a new anonymous name — transparent to them.
 */
export async function ensureParticipantAndUpsertSubmission(
  supabase: SupabaseClient,
  roomId: string,
  color: DominantColorResult,
  turbulence: TurbulenceRating,
): Promise<StoredParticipant> {
  let participant = loadStoredParticipant(roomId)

  if (!participant) {
    participant = await createParticipant(supabase, roomId)
  }

  try {
    await upsertSubmission(supabase, participant, color, turbulence)
    return participant
  } catch {
    // Stale participant_id (DB was reset, row deleted, etc.) — rebuild identity and retry once.
    clearStoredParticipant(roomId)
    participant = await createParticipant(supabase, roomId)
    await upsertSubmission(supabase, participant, color, turbulence)
    return participant
  }
}
