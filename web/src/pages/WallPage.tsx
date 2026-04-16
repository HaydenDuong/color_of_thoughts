import { useCallback, useEffect, useState } from 'react'
import { SiteNav } from '../components/SiteNav'
import { WallScene } from '../components/WallScene'
import { getSupabasePublicConfig } from '../lib/env'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'
import { fetchWallSubmissions, type WallEntry } from '../lib/wallData'
import '../App.css'

/**
 * Exhibition view: all submission colors for the default room, live via Realtime.
 */
export function WallPage() {
  const [entries, setEntries] = useState<WallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)

  const load = useCallback(async () => {
    const cfg = getSupabasePublicConfig()
    const supabase = getSupabaseBrowserClient()
    if (!cfg || !supabase) {
      setError('Configure Supabase in web/.env.local (URL, anon key, default room id).')
      setEntries([])
      setLoading(false)
      return
    }
    setError(null)
    try {
      const data = await fetchWallSubmissions(supabase, cfg.roomId)
      setEntries(data)
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to load wall')
      setEntries([])
    } finally {
      setLoading(false)
    }
  }, [])

  useEffect(() => {
    void load()
  }, [load])

  useEffect(() => {
    const supabase = getSupabaseBrowserClient()
    if (!supabase) return

    const channel = supabase
      .channel('wall-submissions')
      .on(
        'postgres_changes',
        { event: '*', schema: 'public', table: 'submissions' },
        () => {
          void load()
        },
      )
      .subscribe()

    return () => {
      void supabase.removeChannel(channel)
    }
  }, [load])

  return (
    <div className="app wall-page">
      <SiteNav />
      <header className="header">
        <h1>Exhibition wall</h1>
        <p className="lede">
          Live colors from everyone in this room. New uploads and updates appear automatically
          (Realtime on <code>submissions</code>).
        </p>
      </header>

      {loading && <p className="status">Loading spheres…</p>}
      {error && (
        <p className="error" role="alert">
          {error}
        </p>
      )}

      {!loading && !error && entries.length === 0 && (
        <p className="wall-empty">
          No submissions yet. Open <strong>Upload</strong> and add a photo, or scan the{' '}
          <strong>QR</strong> page from a phone.
        </p>
      )}

      {entries.length > 0 && (
        <>
          <WallScene entries={entries} className="wall-canvas-wrap" />
          <section className="wall-list" aria-label="Participants on wall">
            <h2 className="wall-list-title">On the wall ({entries.length})</h2>
            <ul className="wall-list-ul">
              {entries.map((e) => (
                <li key={e.participantId}>
                  <span className="wall-swatch" style={{ backgroundColor: e.hex }} aria-hidden />
                  <span className="wall-name">{e.displayName}</span>
                  <span className="wall-hex">{e.hex}</span>
                </li>
              ))}
            </ul>
          </section>
        </>
      )}
    </div>
  )
}
