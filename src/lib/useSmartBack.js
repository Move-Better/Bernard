import { useCallback } from 'react'
import { useNavigate } from 'react-router-dom'

/**
 * Returns a back handler that follows real in-app history when it exists
 * (so "Back" returns to whatever page actually led here — a campaign, a
 * staff profile, Home, wherever) and falls back to `fallbackTo` only when
 * there's no history to go back to (a direct link, a fresh tab, a page
 * refresh). Generalizes the pattern InterviewSession.jsx used for its own
 * back button.
 *
 * `window.history.state?.idx` is set by React Router's history stack; idx=0
 * means this is the first entry (no real "back" target within the app).
 *
 * @param {string|(() => string)} fallbackTo - route to use when there's no
 *   history to go back to. Pass a function to compute it lazily (e.g. from
 *   the current pathname) rather than a value that could go stale.
 */
export function useSmartBack(fallbackTo) {
  const navigate = useNavigate()
  return useCallback(() => {
    if (window.history.state?.idx > 0) {
      navigate(-1)
    } else {
      navigate(typeof fallbackTo === 'function' ? fallbackTo() : fallbackTo)
    }
  }, [navigate, fallbackTo])
}
