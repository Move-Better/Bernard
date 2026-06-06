import { useEffect, useRef } from 'react'

/**
 * Keep the device screen awake while `active` is true.
 *
 * Uses the Screen Wake Lock API (navigator.wakeLock). The browser
 * automatically releases the lock when the tab is hidden (e.g. the user
 * switches apps), so we re-acquire it on `visibilitychange` whenever the
 * caller still wants the screen held. Degrades silently on browsers that
 * don't support the API (older Safari, Firefox) — those users keep their
 * normal sleep behavior, which is no worse than before.
 *
 * @param {boolean} active - request the lock while true; release while false.
 */
export function useWakeLock(active) {
  const sentinelRef = useRef(null)

  useEffect(() => {
    if (!active) return
    if (typeof navigator === 'undefined' || !('wakeLock' in navigator)) return

    let cancelled = false

    const acquire = async () => {
      // Only meaningful when the document is visible — the API rejects otherwise.
      if (document.visibilityState !== 'visible') return
      if (sentinelRef.current) return
      try {
        const sentinel = await navigator.wakeLock.request('screen')
        if (cancelled) {
          sentinel.release().catch(() => {})
          return
        }
        sentinelRef.current = sentinel
        // The lock can be dropped by the system; clear our ref so the
        // visibility handler can re-acquire it.
        sentinel.addEventListener('release', () => {
          if (sentinelRef.current === sentinel) sentinelRef.current = null
        })
      } catch {
        // NotAllowedError etc. — nothing to do, screen just behaves normally.
      }
    }

    const onVisibility = () => {
      if (document.visibilityState === 'visible') acquire()
    }

    acquire()
    document.addEventListener('visibilitychange', onVisibility)

    return () => {
      cancelled = true
      document.removeEventListener('visibilitychange', onVisibility)
      const sentinel = sentinelRef.current
      sentinelRef.current = null
      if (sentinel) sentinel.release().catch(() => {})
    }
  }, [active])
}

export default useWakeLock
