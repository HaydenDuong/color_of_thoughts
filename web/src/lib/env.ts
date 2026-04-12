/**
 * Reads Vite public env vars for Supabase + default room.
 * Returns null if anything is missing so the UI can still run in pure local mode.
 */

export type SupabasePublicConfig = {
  url: string
  anonKey: string
  /** Must match `public.rooms.id` for this exhibition */
  roomId: string
}

/** Loose UUID string check for `VITE_DEFAULT_ROOM_ID` */
const UUID_RE =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

export function getSupabasePublicConfig(): SupabasePublicConfig | null {
  const url = import.meta.env.VITE_SUPABASE_URL?.trim()
  const anonKey = import.meta.env.VITE_SUPABASE_ANON_KEY?.trim()
  const roomId = import.meta.env.VITE_DEFAULT_ROOM_ID?.trim()

  if (!url || !anonKey || !roomId) {
    return null
  }
  if (!UUID_RE.test(roomId)) {
    console.warn(
      '[env] VITE_DEFAULT_ROOM_ID does not look like a UUID — check .env.local',
    )
    return null
  }
  return { url, anonKey, roomId }
}

export function isSupabaseConfigured(): boolean {
  return getSupabasePublicConfig() !== null
}
