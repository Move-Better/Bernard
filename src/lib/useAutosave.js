// useAutosave — debounced background save of a snapshot, replacing a manual
// Save button with an "All changes saved" / "Saving…" / "Couldn't save" status.
//
// Pass the current draft snapshot (JSON-serializable) and an async save
// function. Changes are debounced (default 1200ms of quiet) before saving.
// A change made while a save is in flight re-queues once that save settles,
// so rapid edits never get dropped mid-request.
//
// Returns { status } where status is 'idle' | 'saving' | 'saved' | 'error'.
// 'idle' means "nothing to save yet" (initial mount, or already saved with
// no pending changes) — render that as "All changes saved" once the first
// save has completed at least once (see `hasSavedOnce`).

import { useEffect, useRef, useState } from 'react'

export function useAutosave(snapshot, save, { debounceMs = 1200, enabled = true } = {}) {
  const json = JSON.stringify(snapshot)
  const savedJsonRef = useRef(json)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const timerRef = useRef(null)
  const saveRef = useRef(save)
  const runSaveRef = useRef(null)
  const jsonRef = useRef(json)
  const [status, setStatus] = useState('idle')
  const [hasSavedOnce, setHasSavedOnce] = useState(false)

  // Refs mirroring render-time values must be written in an effect, not during
  // render (React Compiler forbids mutating refs while rendering).
  useEffect(() => {
    saveRef.current = save
    jsonRef.current = json
  })

  useEffect(() => {
    savedJsonRef.current = json
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  // On true unmount with a pending debounce (user navigated away mid-edit),
  // flush immediately rather than dropping the last change — there's no
  // manual Save button left to catch it. Separate from the debounce effect
  // below so this only fires on unmount, not on every keystroke re-run.
  useEffect(() => () => {
    if (jsonRef.current !== savedJsonRef.current && runSaveRef.current) runSaveRef.current()
  }, [])

  useEffect(() => {
    if (!enabled) return
    if (json === savedJsonRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(runSave, debounceMs)
    runSaveRef.current = runSave
    return () => clearTimeout(timerRef.current)

    async function runSave() {
      if (inFlightRef.current) {
        queuedRef.current = true
        return
      }
      const toSave = json
      inFlightRef.current = true
      setStatus('saving')
      try {
        await saveRef.current(JSON.parse(toSave))
        savedJsonRef.current = toSave
        setStatus('saved')
        setHasSavedOnce(true)
      } catch (e) {
        console.error('[useAutosave] save failed:', e?.message)
        setStatus('error')
      } finally {
        inFlightRef.current = false
        if (queuedRef.current) {
          queuedRef.current = false
          runSave()
        }
      }
    }
  }, [json, debounceMs, enabled])

  return { status: hasSavedOnce && status === 'idle' ? 'saved' : status }
}
