import { useCallback, useEffect, useMemo, useState } from 'react'
import { useSearchParams } from 'react-router-dom'
import { SiteNav } from '../components/SiteNav'
import { WallScene } from '../components/WallScene'
import { getSupabasePublicConfig } from '../lib/env'
import { getSupabaseBrowserClient } from '../lib/supabaseBrowser'
import { fetchWallSubmissions, type WallEntry } from '../lib/wallData'
import { generateTestEntries, type StormBias } from '../lib/testWallData'
import type { WallMode } from '../lib/wallPhysics'
import '../App.css'

/**
 * Exhibition view: all submission colors for the default room, live via Realtime.
 *
 * URL params:
 *   - `mode=flow|orbit|wave|mandala|bands` — wall mode (see WallScene).
 *       Default `flow`.
 *       - `flow`    : freeform 2D physics on a soft vertical gradient.
 *       - `orbit`   : concentric orbits around the center.
 *       - `wave`    : 12×8 sea scaffold; users take cells, ride a
 *                     Tessendorf ocean. Calm/turbulent ratio + speed drive
 *                     how agitated the surface feels.
 *       - `mandala` : 80-blob Fibonacci inner scaffold (rotating slowly);
 *                     calm user blobs dock to an outer shell, turbulent
 *                     user blobs roam and knock dockers loose.
 *       - `bands`   : hidden 3-layer comparison (URL-only).
 *   - `test=N`         — **dev only**: skip Supabase and render `N` (1..200,
 *                        default 30) synthesized blobs with deterministic
 *                        random palettes + ratings. Never writes to the DB.
 *                        Navigate to `/wall` to return to live data.
 *   - `storm=BIAS`     — **dev only** (no effect without `test`): forces the
 *                        rating distribution. `calm` (1–2 only), `turbulent`
 *                        (4–5 only), `neutral` (3 only), or `mixed` (random,
 *                        the default). Useful for verifying wave behavior at
 *                        each end of the storm spectrum without needing 30
 *                        real uploads.
 *   - `explore=1`      — replaces the auto-positioning camera with mouse
 *                        OrbitControls so you can drag-to-orbit, scroll-to-
 *                        zoom, and right-drag to pan. Disables the parallax
 *                        + wave camera rig while on. Off by default so the
 *                        exhibition projector stays hands-off.
 *   - `metFrac=N`      — **mandala only** live tuning knob for chaotic-blob
 *                        (meteor) speed + kick frequency. Scales `chaoticImpulse`
 *                        by ×N and impulse intervals by ÷N (so trajectory shape
 *                        is preserved, only playback speed changes). Default
 *                        `1.0` ships the contemplative psych-exhibition vibe
 *                        (~6 s cross-stage). `1.5` ≈ cinematic. `2.0+` ≈
 *                        energetic demo. `0.5` ≈ near-meditation. Clamped to
 *                        [0.3, 3.0]. Use to scrub speed live at the venue
 *                        without a redeploy.
 *
 * The mode and explore toggles write to the URL so refresh + side-by-side
 * tabs both work.
 */

const VISIBLE_MODES: ReadonlyArray<{ key: WallMode; label: string; hint: string }> = [
  { key: 'flow', label: 'Flow', hint: 'Calm flows low, turbulent drifts high' },
  { key: 'orbit', label: 'Orbit', hint: 'Concentric orbits around the center' },
  { key: 'wave', label: 'Wave', hint: 'Sea scaffold; calm/turbulent ratio drives swell' },
  { key: 'mandala', label: 'Mandala', hint: 'Calm docks on the outer shell; turbulent knocks them loose' },
]

const TEST_DEFAULT_COUNT = 30
const TEST_MAX_COUNT = 200

function parseMode(raw: string | null): WallMode {
  if (
    raw === 'orbit' ||
    raw === 'flow' ||
    raw === 'bands' ||
    raw === 'wave' ||
    raw === 'mandala'
  ) {
    return raw
  }
  return 'flow'
}

function parseTestCount(raw: string | null): number | null {
  if (raw === null) return null
  if (raw === '') return TEST_DEFAULT_COUNT
  const n = Number.parseInt(raw, 10)
  if (!Number.isFinite(n) || n < 1) return TEST_DEFAULT_COUNT
  return Math.min(TEST_MAX_COUNT, n)
}

function parseStorm(raw: string | null): StormBias {
  if (raw === 'calm' || raw === 'turbulent' || raw === 'neutral') return raw
  return 'mixed'
}

/** `?explore=1`, `?explore=true`, `?explore` (empty value) all turn it on. */
function parseExplore(raw: string | null): boolean {
  if (raw === null) return false
  const v = raw.trim().toLowerCase()
  return v === '' || v === '1' || v === 'true' || v === 'yes' || v === 'on'
}

export function WallPage() {
  const [entries, setEntries] = useState<WallEntry[]>([])
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [searchParams, setSearchParams] = useSearchParams()

  const mode = useMemo(() => parseMode(searchParams.get('mode')), [searchParams])
  const testCount = useMemo(() => parseTestCount(searchParams.get('test')), [searchParams])
  const stormBias = useMemo(() => parseStorm(searchParams.get('storm')), [searchParams])
  const explore = useMemo(() => parseExplore(searchParams.get('explore')), [searchParams])
  const isTestMode = testCount !== null

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

  const toggleExplore = useCallback(() => {
    setSearchParams(
      (prev) => {
        const p = new URLSearchParams(prev)
        if (parseExplore(p.get('explore'))) p.delete('explore')
        else p.set('explore', '1')
        return p
      },
      { replace: true },
    )
  }, [setSearchParams])

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

  // Live-data path: only runs when NOT in test mode.
  useEffect(() => {
    if (isTestMode) return
    void load()
  }, [load, isTestMode])

  useEffect(() => {
    if (isTestMode) return
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
  }, [load, isTestMode])

  // Test-data path: synthesize deterministically. Count or bias change → regen.
  useEffect(() => {
    if (!isTestMode) return
    setError(null)
    setEntries(generateTestEntries(testCount ?? TEST_DEFAULT_COUNT, 1337, stormBias))
    setLoading(false)
  }, [isTestMode, testCount, stormBias])

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
            <button
              type="button"
              className={`segmented-opt wall-explore-toggle${explore ? ' is-active' : ''}`}
              aria-pressed={explore}
              onClick={toggleExplore}
              title="Drag to orbit · scroll to zoom · right-drag to pan"
            >
              {explore ? 'Explore: on' : 'Explore'}
            </button>
            {isTestMode && (
              <span className="wall-mode-note" aria-live="polite">
                Test mode: <strong>{entries.length}</strong> synthesized blobs
                {stormBias !== 'mixed' && (
                  <>
                    {' '}· storm: <strong>{stormBias}</strong>
                  </>
                )}{' '}
                (no DB). Remove <code>?test=</code> to return to live data.
              </span>
            )}
            {mode === 'bands' && !isTestMode && (
              <span className="wall-mode-note" aria-live="polite">
                Comparison mode: <strong>Bands</strong> (URL-only). Use buttons to switch back.
              </span>
            )}
          </div>
          <WallScene
            entries={entries}
            mode={mode}
            explore={explore}
            className="wall-canvas-wrap"
          />
          <section className="wall-list" aria-label="Participants on wall">
            <h2 className="wall-list-title">
              On the wall ({entries.length}){isTestMode ? ' — test mode' : ''}
            </h2>
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
