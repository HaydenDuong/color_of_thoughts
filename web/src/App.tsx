import { useCallback, useId, useState } from 'react'
import { SiteNav } from './components/SiteNav'
import { ColorSphere } from './components/ColorSphere'
import {
  TurbulenceSelector,
  type TurbulenceRating,
} from './components/TurbulenceSelector'
import {
  extractDominantColor,
  loadImageFromFile,
  type DominantColorResult,
} from './lib/colorFromImage'
import { getSupabasePublicConfig } from './lib/env'
import { getSupabaseBrowserClient } from './lib/supabaseBrowser'
import { ensureParticipantAndUpsertSubmission } from './lib/syncSubmission'
import { TURBULENCE_DEFAULT } from './lib/turbulence'
import './App.css'

/**
 * Commit lifecycle for a single preview session:
 *   idle   — photo uploaded, selector live, nothing written yet
 *   saving — user hit "Send to wall", upsert in flight
 *   saved  — row written, sphere is now on the wall
 *   error  — upsert failed
 *   local  — Supabase not configured (preview-only build)
 */
type CommitState =
  | { kind: 'idle' }
  | { kind: 'saving' }
  | { kind: 'saved'; displayName: string; participantId: string }
  | { kind: 'error'; message: string }
  | { kind: 'local' }

/**
 * Phase 1 upload page.
 *
 * New explicit-commit flow (so participants see their rating take effect
 * before it is saved):
 *   1. User picks an image → we extract palette + primary color and render
 *      the blob locally. Nothing hits Supabase yet.
 *   2. A turbulence selector lets them pick 1..5. As they tap, the blob's
 *      breathing/churning shader uniforms update live (via
 *      `PaletteSphereMaterial`'s `useEffect`, not a new material instance).
 *   3. "Send to wall" commits palette + primary + turbulence via
 *      `ensureParticipantAndUpsertSubmission`; only now does the wall see it.
 *   4. "Retake photo" resets everything so they can try a different sheet.
 */
export function App() {
  const inputId = useId()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<DominantColorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [turbulence, setTurbulence] =
    useState<TurbulenceRating>(TURBULENCE_DEFAULT)
  const [commitState, setCommitState] = useState<CommitState>({ kind: 'idle' })

  const hasSupabase = Boolean(
    getSupabasePublicConfig() && getSupabaseBrowserClient(),
  )

  const resetAll = useCallback(() => {
    if (previewUrl) URL.revokeObjectURL(previewUrl)
    setPreviewUrl(null)
    setResult(null)
    setError(null)
    setTurbulence(TURBULENCE_DEFAULT)
    setCommitState({ kind: 'idle' })
  }, [previewUrl])

  const onFile = useCallback(
    async (fileList: FileList | null) => {
      const file = fileList?.[0]
      if (!file || !file.type.startsWith('image/')) {
        setError('Please choose an image file.')
        setResult(null)
        setCommitState({ kind: 'idle' })
        return
      }

      setBusy(true)
      setError(null)
      setResult(null)
      setCommitState({ kind: 'idle' })
      // Rating resets whenever a new photo is chosen so people don't carry
      // a stale "Turbulent" from a previous attempt onto a new drawing.
      setTurbulence(TURBULENCE_DEFAULT)

      if (previewUrl) URL.revokeObjectURL(previewUrl)
      const nextPreview = URL.createObjectURL(file)
      setPreviewUrl(nextPreview)

      try {
        const img = await loadImageFromFile(file)
        const out = extractDominantColor(img)
        setResult(out)
      } catch (e) {
        const message = e instanceof Error ? e.message : 'Something went wrong'
        setError(message)
      } finally {
        setBusy(false)
      }
    },
    [previewUrl],
  )

  const onSend = useCallback(async () => {
    if (!result) return

    const cfg = getSupabasePublicConfig()
    const supabase = getSupabaseBrowserClient()
    if (!cfg || !supabase) {
      setCommitState({ kind: 'local' })
      return
    }

    setCommitState({ kind: 'saving' })
    try {
      const participant = await ensureParticipantAndUpsertSubmission(
        supabase,
        cfg.roomId,
        result,
        turbulence,
      )
      setCommitState({
        kind: 'saved',
        displayName: participant.displayName,
        participantId: participant.id,
      })
    } catch (e) {
      const message =
        e instanceof Error ? e.message : 'Could not save to Supabase.'
      setCommitState({ kind: 'error', message })
    }
  }, [result, turbulence])

  const cssRgb = result
    ? `rgb(${result.r}, ${result.g}, ${result.b})`
    : undefined
  const textureSeed =
    commitState.kind === 'saved' ? commitState.participantId : undefined

  const sending = commitState.kind === 'saving'
  const sent = commitState.kind === 'saved'
  // After a successful send the selector locks so the saved rating matches
  // what is on the wall. Re-upload clears everything and unlocks again.
  const selectorDisabled = sending || sent

  return (
    <div className="app">
      <SiteNav />
      <header className="header">
        <h1>Color of Thoughts</h1>
        <p className="lede">
          Phase 1: upload a photo of your drawing — we extract its palette and
          render a 3D sphere that reflects the composition of colors. Pick how
          turbulent your day feels; when you tap Send the sphere joins the
          exhibition wall.
        </p>
      </header>

      <section className="panel" aria-labelledby={inputId}>
        <label className="file-label" htmlFor={inputId}>
          Choose image
        </label>
        <input
          id={inputId}
          className="file-input"
          type="file"
          accept="image/*"
          disabled={busy || sending}
          onChange={(e) => void onFile(e.target.files)}
        />
        {busy && <p className="status">Processing…</p>}
        {error && (
          <p className="error" role="alert">
            {error}
          </p>
        )}
      </section>

      <div className="layout">
        <div className="column">
          {previewUrl && (
            <figure className="preview-wrap">
              <img
                src={previewUrl}
                alt="Your uploaded photo preview"
                className="preview-img"
              />
              <figcaption>Uploaded image (preview)</figcaption>
            </figure>
          )}
        </div>

        <div className="column">
          {result && (
            <>
              <ColorSphere
                color={cssRgb!}
                palette={result.palette}
                textureSeed={textureSeed}
                turbulence={turbulence}
                className="sphere-wrap"
              />

              {result.palette.length > 0 && (
                <div className="palette-row" aria-label="Extracted palette">
                  {result.palette.map((p, idx) => (
                    <div
                      key={`${p.hex}-${idx}`}
                      className="palette-chip"
                      style={{
                        backgroundColor: p.hex,
                        flexGrow: Math.max(0.35, p.weight),
                      }}
                      title={`${p.hex} · ${(p.weight * 100).toFixed(1)}%`}
                    >
                      <span className="palette-chip-label">
                        {(p.weight * 100).toFixed(0)}%
                      </span>
                    </div>
                  ))}
                </div>
              )}

              <div className="turbulence-block">
                <p className="turbulence-q">
                  How turbulent is your day?
                  <span className="turbulence-sub">
                    calm → turbulent · hover a face for its label
                  </span>
                </p>
                <TurbulenceSelector
                  value={turbulence}
                  onChange={setTurbulence}
                  disabled={selectorDisabled}
                />
              </div>

              <div className="actions-row">
                <button
                  type="button"
                  className="btn btn-primary"
                  onClick={() => void onSend()}
                  disabled={sending || sent || !hasSupabase}
                >
                  {sending
                    ? 'Sending…'
                    : sent
                      ? 'Sent'
                      : 'Send to wall'}
                </button>
                <button
                  type="button"
                  className="btn btn-secondary"
                  onClick={resetAll}
                  disabled={sending}
                >
                  Retake photo
                </button>
              </div>

              <div className="meta" aria-live="polite">
                <p className="hex">
                  <span className="meta-label">Primary hex (accessibility):</span>{' '}
                  <strong>{result.hex}</strong>
                </p>
                <p className="rgb">
                  <span className="meta-label">Primary RGB:</span>{' '}
                  {result.r}, {result.g}, {result.b}
                </p>
                <p className="uniformity">
                  <span className="meta-label">Palette size:</span>{' '}
                  {result.palette.length} color
                  {result.palette.length === 1 ? '' : 's'} &middot;{' '}
                  <span className="meta-label">uniformity:</span>{' '}
                  {result.uniformityScore.toFixed(2)}
                </p>

                {!hasSupabase && commitState.kind === 'idle' && (
                  <p className="sync sync-local">
                    <strong>Local preview only.</strong> Add{' '}
                    <code>VITE_SUPABASE_URL</code>,{' '}
                    <code>VITE_SUPABASE_ANON_KEY</code>, and{' '}
                    <code>VITE_DEFAULT_ROOM_ID</code> to{' '}
                    <code>web/.env.local</code> (see{' '}
                    <code>.env.example</code>) to enable sending to the wall.
                  </p>
                )}
                {commitState.kind === 'local' && (
                  <p className="sync sync-local">
                    <strong>Supabase is not configured.</strong> Nothing was
                    saved; configure env vars and try again.
                  </p>
                )}
                {commitState.kind === 'saving' && (
                  <p className="sync sync-saving">Saving to Supabase…</p>
                )}
                {commitState.kind === 'saved' && (
                  <p className="sync sync-saved">
                    <strong>Sent.</strong> You appear as{' '}
                    <strong>{commitState.displayName}</strong>. Re-upload
                    replaces your sphere (one per device in this room).
                  </p>
                )}
                {commitState.kind === 'error' && (
                  <p className="sync sync-error" role="status">
                    <strong>Save failed.</strong> {commitState.message}
                  </p>
                )}

                <p className="hint">
                  The sphere's surface shows a blurred composition of your
                  image's colors, weighted by how much of the picture each
                  color covers. Near-white paper is filtered before
                  extraction. Your turbulence rating drives the blob's
                  breathing and where it sits on the wall.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
