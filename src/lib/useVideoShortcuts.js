// useVideoShortcuts — standard video-editor keyboard transport for the Reel
// editor. Mirrors useUndoRedoShortcut: a window-level keydown listener that
// bails while the user is typing in a field and never fires when a modifier
// (⌘/Ctrl/Alt) is held, so it stays out of the way of native input editing and
// the ⌘Z undo/redo shortcut.
//
//   Space / K        play or pause
//   ← / ,            step back one frame
//   → / .            step forward one frame
//   Shift+← / J      jump back 1s
//   Shift+→ / L      jump forward 1s
//   Home             jump to clip start
//   End              jump to clip end

import { useEffect } from 'react'

export function useVideoShortcuts({ togglePlay, stepFrame, seekBy, toStart, toEnd, disabled = false } = {}) {
  useEffect(() => {
    if (disabled) return
    function handler(e) {
      if (e.metaKey || e.ctrlKey || e.altKey) return
      const tag = e.target?.tagName
      if (tag === 'INPUT' || tag === 'TEXTAREA' || e.target?.isContentEditable) return
      switch (e.key) {
        case ' ':
        case 'Spacebar': // legacy key name
        case 'k': case 'K':
          e.preventDefault(); togglePlay?.(); break
        case 'ArrowLeft':
          e.preventDefault(); e.shiftKey ? seekBy?.(-1) : stepFrame?.(-1); break
        case 'ArrowRight':
          e.preventDefault(); e.shiftKey ? seekBy?.(1) : stepFrame?.(1); break
        case ',':
          e.preventDefault(); stepFrame?.(-1); break
        case '.':
          e.preventDefault(); stepFrame?.(1); break
        case 'j': case 'J':
          e.preventDefault(); seekBy?.(-1); break
        case 'l': case 'L':
          e.preventDefault(); seekBy?.(1); break
        case 'Home':
          e.preventDefault(); toStart?.(); break
        case 'End':
          e.preventDefault(); toEnd?.(); break
        default: break
      }
    }
    window.addEventListener('keydown', handler)
    return () => window.removeEventListener('keydown', handler)
  }, [togglePlay, stepFrame, seekBy, toStart, toEnd, disabled])
}
