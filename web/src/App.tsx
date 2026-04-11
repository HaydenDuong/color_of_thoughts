import { useCallback, useId, useState } from 'react'
import { ColorSphere } from './components/ColorSphere'
import {
  extractDominantColor,
  loadImageFromFile,
  type DominantColorResult,
} from './lib/colorFromImage'
import './App.css'

/**
 * Phase 1 screen: pick an image → compute dominant color → show 3D sphere + text.
 * No backend yet; same extraction can move to an Edge Function later unchanged at the API boundary.
 */
export function App() {
  const inputId = useId()
  const [previewUrl, setPreviewUrl] = useState<string | null>(null)
  const [result, setResult] = useState<DominantColorResult | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState(false)

  const onFile = useCallback(async (fileList: FileList | null) => {
    const file = fileList?.[0]
    if (!file || !file.type.startsWith('image/')) {
      setError('Please choose an image file.')
      setResult(null)
      return
    }

    setBusy(true)
    setError(null)
    setResult(null)

    if (previewUrl) {
      URL.revokeObjectURL(previewUrl)
    }
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
          averaged color on a 3D sphere. Analysis comes later.
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
