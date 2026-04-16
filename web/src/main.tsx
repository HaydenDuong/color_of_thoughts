import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { AppRouter } from './router'
import './index.css'

/**
 * StrictMode double-invokes certain lifecycles in dev to surface side effects—
 * harmless here; production build behaves normally.
 */
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <AppRouter />
  </StrictMode>,
)
