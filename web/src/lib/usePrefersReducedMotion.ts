import { useEffect, useState } from 'react'

/**
 * Tracks the OS-level "reduce motion" preference.
 * Used to slow down color cycles and flatten vertex displacement for users
 * with vestibular or photosensitivity concerns.
 *
 * SSR-safe: defaults to false when `window` isn't available.
 */
export function usePrefersReducedMotion(): boolean {
  const [reduced, setReduced] = useState(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return false
    return window.matchMedia('(prefers-reduced-motion: reduce)').matches
  })

  useEffect(() => {
    if (typeof window === 'undefined' || !window.matchMedia) return
    const mq = window.matchMedia('(prefers-reduced-motion: reduce)')
    const handler = (e: MediaQueryListEvent) => setReduced(e.matches)
    mq.addEventListener('change', handler)
    return () => mq.removeEventListener('change', handler)
  }, [])

  return reduced
}
