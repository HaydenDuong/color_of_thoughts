import { useEffect, useMemo, useState } from 'react'
import { QRCodeSVG } from 'qrcode.react'
import { SiteNav } from '../components/SiteNav'
import '../App.css'

/**
 * Large QR for the exhibition screen: opens the upload URL on the same origin
 * (works on localhost and after deploy once BASE_URL / origin match).
 */
export function QrPage() {
  const [uploadUrl, setUploadUrl] = useState('')

  useEffect(() => {
    const pathBase = import.meta.env.BASE_URL.replace(/\/$/, '') || ''
    setUploadUrl(`${window.location.origin}${pathBase}/`)
  }, [])

  const title = useMemo(
    () => 'Scan to upload your paper color',
    [],
  )

  return (
    <div className="app qr-page">
      <SiteNav />
      <header className="header">
        <h1>Upload QR</h1>
        <p className="lede">
          Show this page on the big screen. Guests scan the code and land on the{' '}
          <strong>Upload</strong> page for this deployment.
        </p>
      </header>

      <div className="qr-panel">
        {uploadUrl ? (
          <>
            <div className="qr-code-box">
              <QRCodeSVG
                value={uploadUrl}
                size={280}
                level="M"
                includeMargin
                bgColor="#ffffff"
                fgColor="#0c0c12"
              />
            </div>
            <p className="qr-caption">{title}</p>
            <p className="qr-url">
              <span className="meta-label">URL:</span>{' '}
              <code className="qr-url-code">{uploadUrl}</code>
            </p>
          </>
        ) : (
          <p className="status">Preparing QR…</p>
        )}
      </div>
    </div>
  )
}
