// useUndoHistory — generic session-only undo/redo over a serializable snapshot.
//
// Point it at a derived "draft" object (e.g. { slides, themeId, aspect }) and a
// setter that can restore that shape wholesale. It watches for changes to the
// snapshot, coalesces rapid edits (e.g. keystrokes) into a single history
// entry after `debounceMs` of quiet, and exposes undo()/redo().
//
// History is in-memory only (resets on unmount/reload) — this is standard
// editor behavior (Google Docs, Figma) and avoids needing persisted storage
// for a rarely-invoked edge case.
//
// snapshot must be a plain JSON-serializable value; equality is checked via
// JSON.stringify, matching the dirty-check idiom already used in SlideEditor.
//
// The actual history stacks live in refs (they don't need to trigger renders
// on their own); canUndo/canRedo are mirrored into state so render can read
// them safely (React Compiler forbids reading ref.current during render).

import { useCallback, useEffect, useRef, useState } from 'react'

const MAX_HISTORY = 100

export function useUndoHistory(snapshot, restore, { debounceMs = 500, enabled = true } = {}) {
  const json = JSON.stringify(snapshot)
  const pastRef = useRef([])
  const futureRef = useRef([])
  const lastCommittedRef = useRef(json)
  const pendingRef = useRef(null)
  const applyingRef = useRef(false)
  const timerRef = useRef(null)
  const wasEnabledRef = useRef(enabled)
  const [counts, setCounts] = useState({ past: 0, future: 0 })

  useEffect(() => {
    // While disabled (e.g. draft still hydrating from server/localStorage),
    // track the latest snapshot as the baseline but don't record history —
    // otherwise the hydration jump itself becomes a spurious undo step.
    if (!enabled) {
      lastCommittedRef.current = json
      wasEnabledRef.current = false
      return
    }
    if (!wasEnabledRef.current) {
      // Just turned on — the current value is the fresh baseline, not a change.
      wasEnabledRef.current = true
      lastCommittedRef.current = json
      return
    }
    if (applyingRef.current) {
      applyingRef.current = false
      lastCommittedRef.current = json
      return
    }
    if (json === lastCommittedRef.current) return

    if (pendingRef.current === null) pendingRef.current = lastCommittedRef.current
    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(() => {
      const prior = pendingRef.current
      pendingRef.current = null
      if (prior === null || prior === json) return
      pastRef.current = [...pastRef.current, prior].slice(-MAX_HISTORY)
      futureRef.current = []
      lastCommittedRef.current = json
      setCounts({ past: pastRef.current.length, future: futureRef.current.length })
    }, debounceMs)

    return () => clearTimeout(timerRef.current)
  }, [json, debounceMs, enabled])

  const undo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    const prior = pendingRef.current !== null ? pendingRef.current : lastCommittedRef.current
    if (pastRef.current.length === 0) return
    const previous = pastRef.current[pastRef.current.length - 1]
    pastRef.current = pastRef.current.slice(0, -1)
    futureRef.current = [prior, ...futureRef.current]
    pendingRef.current = null
    applyingRef.current = true
    lastCommittedRef.current = previous
    setCounts({ past: pastRef.current.length, future: futureRef.current.length })
    restore(JSON.parse(previous))
  }, [restore])

  const redo = useCallback(() => {
    if (timerRef.current) clearTimeout(timerRef.current)
    if (futureRef.current.length === 0) return
    const next = futureRef.current[0]
    futureRef.current = futureRef.current.slice(1)
    pastRef.current = [...pastRef.current, lastCommittedRef.current]
    pendingRef.current = null
    applyingRef.current = true
    lastCommittedRef.current = next
    setCounts({ past: pastRef.current.length, future: futureRef.current.length })
    restore(JSON.parse(next))
  }, [restore])

  return {
    undo,
    redo,
    canUndo: counts.past > 0,
    canRedo: counts.future > 0,
  }
}
