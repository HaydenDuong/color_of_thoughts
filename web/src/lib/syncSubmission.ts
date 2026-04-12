import type { DominantColorResult } from './colorFromImage'
import { generateAnonymousLabel } from './anonymousLabel'
import {
  loadStoredParticipant,
  saveStoredParticipant,
  type StoredParticipant,
} from './participantSession'
import type { SupabaseClient } from '@supabase/supabase-js'

/**
 * Ensures a `participants` row exists (creates on first visit for this browser+room),
 * then upserts `submissions` so re-upload updates the same row (one orb per user).
 */
export async function ensureParticipantAndUpsertSubmission(
  supabase: SupabaseClient,
  roomId: string,
  color: DominantColorResult,
): Promise<StoredParticipant> {
  let participant = loadStoredParticipant(roomId)

  if (!participant) {
    const id = crypto.randomUUID()
    const displayName = generateAnonymousLabel()

    const { error: insertErr } = await supabase.from('participants').insert({
      id,
      room_id: roomId,
      display_name: displayName,
      is_anonymous: true,
    })

    if (insertErr) {
      throw new Error(insertErr.message)
    }

    participant = { id, displayName }
    saveStoredParticipant(roomId, participant)
  }

  const { error: upsertErr } = await supabase.from('submissions').upsert(
    {
      participant_id: participant.id,
      r: color.r,
      g: color.g,
      b: color.b,
      hex: color.hex,
      uniformity_score: color.uniformityScore,
    },
    { onConflict: 'participant_id' },
  )

  if (upsertErr) {
    throw new Error(upsertErr.message)
  }

  return participant
}
