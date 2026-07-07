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

export function useAutosave(snapshot, save, { debounceMs = 1200, enabled = true, resetKey } = {}) {
  const json = JSON.stringify(snapshot)
  const savedJsonRef = useRef(json)
  const inFlightRef = useRef(false)
  const queuedRef = useRef(false)
  const timerRef = useRef(null)
  const saveRef = useRef(save)
  const runSaveRef = useRef(null)
  const jsonRef = useRef(json)
  const resetKeyRef = useRef(resetKey)
  const [status, setStatus] = useState('idle')
  const [hasSavedOnce, setHasSavedOnce] = useState(false)

  // Callers that reuse one hook instance across different entities (e.g. a
  // page component that doesn't remount per clip/piece id) must pass a
  // `resetKey` (the entity id). Without this, switching entities would make
  // the new entity's snapshot look like an unsaved change relative to the
  // OLD entity's baseline, firing a spurious autosave on simple navigation.
  // Runs before the effects below so the new baseline is in place before
  // they compare against it.
  useEffect(() => {
    if (resetKeyRef.current === resetKey) return
    resetKeyRef.current = resetKey
    if (timerRef.current) clearTimeout(timerRef.current)
    savedJsonRef.current = json
    jsonRef.current = json
    queuedRef.current = false
    setStatus('idle')
    setHasSavedOnce(false)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resetKey])

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
    // runSave is (re)defined and runSaveRef kept live on EVERY run of this
    // effect, including when `enabled` is false — otherwise toggling enabled
    // off mid-edit pins runSaveRef to a stale pre-disable closure, and the
    // unmount-flush effect above fires it with a stale `enabled`, plus a
    // `toSave` closed over an old `json` instead of the true latest value
    // (which is why `toSave` reads from `jsonRef.current`, not `json`).
    async function runSave() {
      if (inFlightRef.current) {
        queuedRef.current = true
        return
      }
      if (!enabled) return
      const toSave = jsonRef.current
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
    runSaveRef.current = runSave

    if (!enabled) return
    if (json === savedJsonRef.current) return

    if (timerRef.current) clearTimeout(timerRef.current)
    timerRef.current = setTimeout(runSave, debounceMs)
    return () => clearTimeout(timerRef.current)
  }, [json, debounceMs, enabled])

  return { status: hasSavedOnce && status === 'idle' ? 'saved' : status }
}
