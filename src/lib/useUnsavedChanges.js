// useUnsavedChanges — warn the user before they lose in-progress edits to a
// tab close, refresh, back/forward navigation, or typed-URL change.
//
// Wired to the standard `beforeunload` event. Modern browsers show their
// native "Leave site?" prompt whenever the handler sets `event.returnValue`
// during a navigation/close attempt. Per spec, the actual message is
// browser-controlled (not customizable) — we just opt in to the prompt by
// returning a string.
//
// In-app Link clicks are NOT intercepted here. React Router 6.x's data
// router exposes useBlocker for that, but we use the JSX <BrowserRouter>
// throughout the app. Switching is a follow-up; the beforeunload guard
// catches the catastrophic cases (close, refresh, typed URL, back button)
// which is where most actual data loss happens.
//
// Usage:
//   const dirty = form.name !== initialForm.name || ...
//   useUnsavedChanges(dirty)

import { useEffect } from 'react'

export function useUnsavedChanges(isDirty) {
  useEffect(() => {
    if (!isDirty) return
    function handler(e) {
      // Spec: cancel the event + set returnValue to opt into the native prompt.
      // The string content is ignored by every modern browser, but Chrome still
      // requires a truthy returnValue to actually fire the dialog.
      e.preventDefault()
      e.returnValue = ''
      return ''
    }
    window.addEventListener('beforeunload', handler)
    return () => window.removeEventListener('beforeunload', handler)
  }, [isDirty])
}
