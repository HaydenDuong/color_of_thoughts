import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SiteNav } from '../components/SiteNav'
import { WallScene } from '../components/WallScene'
import { getSupabasePublicConfig } from '../lib/env'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'
import { fetchWallSubmissions, type WallEntry } from '../lib/wallData'
import type { WallMode } from '../lib/wallPhysics'
import '../App.css'

/**
 * Exhibition view: all submission colors for the default room, live via Realtime.
 *
 * Supports three physics modes selectable via `?mode=` in the URL:
 *   - `flow` (default)  : soft vertical gradient + per-rating motion character.
 *   - `orbit`           : concentric attractor orbits around the canvas center.
 *   - `bands`           : hidden 3-layer comparison view (no UI toggle).
 *
 * The Flow/Orbit toggle in the top-right writes to the URL so a tab opened
 * to `/wall?mode=orbit` stays on orbit mode across refresh, and two tabs can
 * show the two modes side-by-side.
 */

const VISIBLE_MODES: ReadonlyArray<{ key: WallMode; label: string; hint: string }> = [
  { key: 'flow', label: 'Flow', hint: 'Calm flows low, turbulent drifts high' },
  { key: 'orbit', label: 'Orbit', hint: 'Concentric orbits around the center' },
]

function parseMode(raw: string | null): WallMode {
  if (raw === 'orbit' || raw === 'flow' || raw === 'bands') return raw
  return 'flow'
}

export function WallPage() {
  const [entries, setEntries] = useState<WallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const mode = useMemo(() => parseMode(searchParams.get('mode')), [searchParams])

  const setMode = useCallback(
    (next: WallMode) => {
      setSearchParams(
        (prev) => {
          const p = new URLSearchParams(prev)
          if (next === 'flow') p.delete('mode')
          else p.set('mode', next)
          return p
        },
        { replace: true },
      )
    },
    [setSearchParams],
  )

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
          <div
            className="wall-mode-toolbar"
            role="toolbar"
            aria-label="Wall motion mode"
          >
            <div className="segmented" role="radiogroup" aria-label="Wall mode">
              {VISIBLE_MODES.map((m) => {
                const active = mode === m.key
                return (
                  <button
                    key={m.key}
                    type="button"
                    role="radio"
                    aria-checked={active}
                    className={`segmented-opt${active ? ' is-active' : ''}`}
                    onClick={() => setMode(m.key)}
                    title={m.hint}
                  >
                    {m.label}
                  </button>
                )
              })}
            </div>
            {mode === 'bands' && (
              <span className="wall-mode-note" aria-live="polite">
                Comparison mode: <strong>Bands</strong> (URL-only). Use buttons to switch back.
              </span>
            )}
          </div>
          <WallScene entries={entries} mode={mode} className="wall-canvas-wrap" />
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
