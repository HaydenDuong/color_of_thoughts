import type { SupabaseClient } from '@supabase/supabase-js'

/** One sphere on the exhibition wall (joined from submissions + participants). */
export type WallEntry = {
  participantId: string
  displayName: string
  r: number
  g: number
  b: number
  hex: string
}

type ParticipantEmbed = {
  display_name: string
  room_id: string
}

type SubmissionJoinRow = {
  participant_id: string
  r: number
  g: number
  b: number
  hex: string
  /** PostgREST may return object or single-element array depending on client inference */
  participants: ParticipantEmbed | ParticipantEmbed[]
}

function embedParticipant(p: ParticipantEmbed | ParticipantEmbed[]): ParticipantEmbed {
  return Array.isArray(p) ? p[0]! : p
}

/**
 * Loads all submissions whose participant belongs to `roomId`.
 * `!inner` keeps the join strict so other rooms never leak onto this wall.
 */
export async function fetchWallSubmissions(
  supabase: SupabaseClient,
  roomId: string,
): Promise<WallEntry[]> {
  const { data, error } = await supabase
    .from('submissions')
    .select(
      `
      participant_id,
      r,
      g,
      b,
      hex,
      participants!inner ( display_name, room_id )
    `,
    )
    .eq('participants.room_id', roomId)

  if (error) {
    throw new Error(error.message)
  }

  const rows = data as unknown as SubmissionJoinRow[] | null
  return (rows ?? []).map((row) => {
    const p = embedParticipant(row.participants)
    return {
      participantId: row.participant_id,
      displayName: p.display_name,
      r: row.r,
      g: row.g,
      b: row.b,
      hex: row.hex,
    }
  })
}
