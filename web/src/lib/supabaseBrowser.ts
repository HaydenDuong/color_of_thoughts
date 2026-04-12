import { createClient, type SupabaseClient } from '@supabase/supabase-js'
import { getSupabasePublicConfig } from './env'

/** Single browser client — anon key is safe to expose; RLS enforces access. */
let cached: SupabaseClient | null = null

export function getSupabaseBrowserClient(): SupabaseClient | null {
  const cfg = getSupabasePublicConfig()
  if (!cfg) return null
  if (!cached) {
    cached = createClient(cfg.url, cfg.anonKey)
  }
  return cached
}
