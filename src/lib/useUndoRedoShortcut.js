// useUndoRedoShortcut — binds ⌘Z/Ctrl+Z (undo) and ⌘⇧Z/Ctrl+Y (redo) while the
// component is mounted. Mirrors useSaveShortcut's platform-detection approach.

import { useEffect } from 'react'

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad/.test(navigator.platform)

export function useUndoRedoShortcut(onUndo, onRedo, { disabled = false } = {}) {
  useEffect(() => {
    if (disabled) return
    function handler(e) {
      const modifier = IS_MAC ? e.metaKey : e.ctrlKey
      if (!modifier || e.altKey) return
      const tag = e.target?.tagName
      const isEditable = tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable
      if ((e.key === 'z' || e.key === 'Z') && !e.shiftKey) {
        if (isEditable) return // let native input undo handle its own field
        e.preventDefault()
        onUndo?.()
      } else if ((e.key === 'z' || e.key === 'Z') && e.shiftKey) {
        if (isEditable) return
        e.preventDefault()
        onRedo?.()
      } else if (!IS_MAC && (e.key === 'y' || e.key === 'Y')) {
        if (isEditable) return
        e.preventDefault()
        onRedo?.()
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [onUndo, onRedo, disabled])
}
