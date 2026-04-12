import { useCallback, useId, useState } from 'react'
import { ColorSphere } from './components/ColorSphere'
import {
  extractDominantColor,
  loadImageFromFile,
  type DominantColorResult,
} from './lib/colorFromImage'
import { getSupabasePublicConfig } from './lib/env'
import { getSupabaseBrowserClient } from './lib/supabaseBrowser'
import { ensureParticipantAndUpsertSubmission } from './lib/syncSubmission'
import './App.css'

type SyncState =
  | { kind: 'idle' }
  | { kind: 'local' }
  | { kind: 'saving' }
  | { kind: 'saved'; displayName: string }
  | { kind: 'error'; message: string }

/**
 * Phase 1: image → dominant color → 3D sphere + optional Supabase persistence
 * (`participants` + `submissions` upsert for the default room).
 */
export function App() {
  const inputId = useId()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<DominantColorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)
  const [syncState, setSyncState] = useState<SyncState>({ kind: 'idle' })

  const onFile = useCallback(async (fileList: FileList | null) => {
    const file = fileList?.[0]
    if (!file || !file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      setResult(null)
      setSyncState({ kind: 'idle' })
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)
    setSyncState({ kind: 'idle' })

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
    const nextPreview = URL.createObjectURL(file)
    setPreviewUrl(nextPreview)

    try {
      const img = await loadImageFromFile(file)
      const out = extractDominantColor(img)
      setResult(out)

      const cfg = getSupabasePublicConfig()
      const supabase = getSupabaseBrowserClient()

      if (!cfg || !supabase) {
        setSyncState({ kind: 'local' })
        return
      }

      setSyncState({ kind: 'saving' })
      try {
        const participant = await ensureParticipantAndUpsertSubmission(
          supabase,
          cfg.roomId,
          out,
        )
        setSyncState({
          kind: 'saved',
          displayName: participant.displayName,
        })
      } catch (syncErr) {
        const msg =
          syncErr instanceof Error
            ? syncErr.message
            : 'Could not save to Supabase.'
        setSyncState({ kind: 'error', message: msg })
      }
    } catch (e) {
      const message = e instanceof Error ? e.message : 'Something went wrong'
      setError(message)
      setSyncState({ kind: 'idle' })
    } finally {
      setBusy(false)
    }
  }, [previewUrl])

  const cssRgb = result
    ? `rgb(${result.r}, ${result.g}, ${result.b})`
    : undefined

  return (
    <div className="app">
      <header className="header">
        <h1>Color of Thoughts</h1>
        <p className="lede">
          Phase 1: upload a photo of colored paper—we sample the middle of the image and show the
          averaged color on a 3D sphere. Your color can be saved to Supabase for the exhibition
          wall (same anonymous name on this device until you clear site data).
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
          disabled={busy}
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
              <ColorSphere color={cssRgb!} className="sphere-wrap" />
              <div className="meta" aria-live="polite">
                <p className="hex">
                  <span className="meta-label">Hex (accessibility):</span>{' '}
                  <strong>{result.hex}</strong>
                </p>
                <p className="rgb">
                  <span className="meta-label">RGB:</span>{' '}
                  {result.r}, {result.g}, {result.b}
                </p>
                <p className="uniformity">
                  <span className="meta-label">Uniformity (0–1, heuristic):</span>{' '}
                  {result.uniformityScore.toFixed(2)}
                </p>

                {syncState.kind === 'local' && (
                  <p className="sync sync-local">
                    <strong>Local preview only.</strong> Add{' '}
                    <code>VITE_SUPABASE_URL</code>, <code>VITE_SUPABASE_ANON_KEY</code>, and{' '}
                    <code>VITE_DEFAULT_ROOM_ID</code> to <code>web/.env.local</code> (see{' '}
                    <code>.env.example</code>) to save your color to the database.
                  </p>
                )}
                {syncState.kind === 'saving' && (
                  <p className="sync sync-saving">Saving to Supabase…</p>
                )}
                {syncState.kind === 'saved' && (
                  <p className="sync sync-saved">
                    <strong>Saved.</strong> You appear as <strong>{syncState.displayName}</strong>.
                    Re-upload updates your row (one sphere per device in this room).
                  </p>
                )}
                {syncState.kind === 'error' && (
                  <p className="sync sync-error" role="status">
                    <strong>Save failed.</strong> {syncState.message}
                  </p>
                )}

                <p className="hint">
                  Lower uniformity often means shadows or mixed colors in the crop—try even
                  lighting or fill the frame with paper.
                </p>
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  )
}
