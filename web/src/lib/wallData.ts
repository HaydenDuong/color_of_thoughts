import type { SupabaseClient } from '@supabase/supabase-js'
import type { PaletteColor } from './colorFromImage'

/** One sphere on the exhibition wall (joined from submissions + participants). */
export type WallEntry = {
  participantId: string
  displayName: string
  r: number
  g: number
  b: number
  hex: string
  palette: PaletteColor[]
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
  palette: unknown
  /** PostgREST may return object or single-element array depending on client inference */
  participants: ParticipantEmbed | ParticipantEmbed[]
}

function embedParticipant(p: ParticipantEmbed | ParticipantEmbed[]): ParticipantEmbed {
  return Array.isArray(p) ? p[0]! : p
}

/** Defensive parse: JSONB can be null or unexpected shape if a row was hand-edited. */
function parsePalette(raw: unknown): PaletteColor[] {
  if (!Array.isArray(raw)) return []
  const out: PaletteColor[] = []
  for (const item of raw) {
    if (
      item &&
      typeof item === 'object' &&
      typeof (item as PaletteColor).r === 'number' &&
      typeof (item as PaletteColor).g === 'number' &&
      typeof (item as PaletteColor).b === 'number' &&
      typeof (item as PaletteColor).hex === 'string' &&
      typeof (item as PaletteColor).weight === 'number'
    ) {
      out.push(item as PaletteColor)
    }
  }
  return out
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
      palette,
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
      palette: parsePalette(row.palette),
    }
  })
}
