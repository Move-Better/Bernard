// useInterviewAudioCapture — MediaRecorder hook for interview voice capture.
//
// Records the clinician's microphone during a NarrateRx interview session.
// The captured audio is uploaded to Vercel Blob at completion and stored on
// interviews.audio_recording_url for later ElevenLabs voice clone re-training.
//
// Crash-safety (P3 "bulletproof capture"): each MediaRecorder chunk is persisted
// to IndexedDB the instant it arrives (audioCaptureDb), a screen wake lock keeps
// iOS slower to background the tab, and the recorder is flushed on
// visibilitychange/pagehide — so an iPhone that backgrounds or kills the tab
// mid-interview doesn't silently lose the voice-clone take. A take that never
// finished uploading is a recoverable "orphan": recoverOrphanedAudio() re-uploads
// it the next time the same interview is opened. The re-upload is silent (no
// recovery card) because this audio is a background training asset, not
// user-facing content — the interview transcript is protected separately
// (localStorage mirror + session_state flush in InterviewSession). Mirrors the
// VoiceMemo lane shipped in #1200.
//
// Design constraints:
//   - NEVER breaks the interview if capture fails — all errors are swallowed
//     silently (logged to console only). The interview is the primary product.
//   - Records only the mic stream — NOT TTS/ElevenLabs playback. The training
//     corpus must be the clinician's own voice, nothing else.
//   - No-op on browsers without getUserMedia (e.g., HTTPS not met) or when
//     the user declines mic permission (permission was already granted for
//     Web Speech, so this should always be available).
//   - Fire-and-forget upload — stopAndUpload() resolves as soon as the upload
//     is dispatched; the interview can navigate away without waiting.
//
// Usage:
//   const { startCapture, stopAndUpload, recoverOrphanedAudio, isCapturing } = useInterviewAudioCapture()
//
//   // Recover an orphaned take from a prior killed session for this interview:
//   useEffect(() => { recoverOrphanedAudio(interviewId) }, [interviewId])
//
//   // Start after mic check passes (tag the take with the interview id):
//   useEffect(() => { if (micCheckPassed) startCapture(interviewId) }, [micCheckPassed])
//
//   // Upload before navigating away on completion:
//   await stopAndUpload(interviewId)  // non-blocking — returns immediately after dispatch

import { useRef, useState, useCallback, useEffect } from 'react'
import { upload } from '@vercel/blob/client'
import {
  createSession,
  appendChunk,
  patchSession,
  deleteSession,
  assembleBlob,
  listRecoverable,
} from '@/lib/audioCaptureDb'

const AUDIO_UPLOAD_URL = '/api/interviews/audio'

// Minimum threshold: skip uploads under ~30 seconds of audio to avoid polluting
// the training set with aborted sessions. At 64kbps that's roughly 240KB; we use
// 200KB as a conservative floor. Applied to both the live upload and recovery.
const MIN_UPLOAD_BYTES = 200_000

function uid() {
  if (typeof crypto !== 'undefined' && crypto.randomUUID) return crypto.randomUUID()
  return `iv-${Date.now()}-${Math.floor(Math.random() * 1e9)}`
}

// Prefer Opus/WebM (best compression for speech, widely supported).
// Fall back gracefully on Safari which uses MP4/AAC.
function bestMimeType() {
  const candidates = [
    'audio/webm;codecs=opus',
    'audio/webm',
    'audio/ogg;codecs=opus',
    'audio/mp4',
  ]
  for (const t of candidates) {
    if (typeof MediaRecorder !== 'undefined' && MediaRecorder.isTypeSupported(t)) return t
  }
  return ''   // let the browser pick
}

function extFromMime(mime) {
  if (mime.includes('ogg'))  return 'ogg'
  if (mime.includes('mp4'))  return 'mp4'
  return 'webm'
}

// Auth header for the @vercel/blob/client token handshake. /api/interviews/audio
// authenticates via requireRole, which is BEARER-ONLY (it does not read the Clerk
// session cookie), and upload()'s handshake POST carries no Authorization header
// by default — so without this every voice-clone upload 401s ("Unauthorized" →
// "Failed to retrieve the client token") and the take orphans. Every other upload
// caller (brandKitLib, media, seminar) passes this; the interview-audio path had
// been omitting it since it was written. Returns undefined if no session so the
// shape still matches brandKitLib's pattern.
async function authUploadHeaders() {
  try {
    const token = await window.Clerk?.session?.getToken?.()
    return token ? { Authorization: `Bearer ${token}` } : undefined
  } catch {
    return undefined
  }
}

// Explicit audio contentType for the upload. @vercel/blob/client upload() infers
// contentType from the pathname EXTENSION, not the Blob's type — and `.webm` maps
// to `video/webm`, which /api/interviews/audio rejects (its allowlist is audio-only).
// Without this, the upload is typed video/webm and 400s ("Content type mismatch")
// — for the completion path too, not just recovery. Returns a value guaranteed to
// be in the endpoint's ALLOWED_AUDIO_MIME list.
function audioContentType(mime) {
  const m = (mime || '').toLowerCase()
  if (m.includes('mp4'))  return 'audio/mp4'
  if (m.includes('ogg'))  return 'audio/ogg'
  if (m.includes('mpeg') || m.includes('mp3')) return 'audio/mpeg'
  return 'audio/webm'
}

export function useInterviewAudioCapture() {
  const recorderRef   = useRef(null)
  const chunksRef     = useRef([])
  const streamRef     = useRef(null)
  const mimeTypeRef   = useRef('')
  const uploadedRef   = useRef(false)   // guard: only upload once per session
  const sessionIdRef  = useRef(null)    // IndexedDB crash-safe session id
  const wakeLockRef   = useRef(null)    // screen wake sentinel held while capturing
  const [isCapturing, setIsCapturing] = useState(false)

  // ── Wake lock — keep the screen on while recording so iOS is slower to
  // background/suspend the tab. The lock auto-releases when the tab hides; we
  // re-arm it on return (see the visibility handler below). Non-fatal everywhere.
  const acquireWakeLock = useCallback(async () => {
    try {
      if (typeof navigator !== 'undefined' && 'wakeLock' in navigator) {
        wakeLockRef.current = await navigator.wakeLock.request('screen')
      }
    } catch { /* non-fatal — screen may sleep; chunks still persist to IDB */ }
  }, [])

  const releaseWakeLock = useCallback(() => {
    try { wakeLockRef.current?.release?.() } catch { /* ignore */ }
    wakeLockRef.current = null
  }, [])

  // ── Flush-on-hide. iOS fires visibilitychange/pagehide before suspending a
  // backgrounded tab. requestData() forces a final ondataavailable synchronously,
  // so the last few seconds land in IndexedDB even if the tab never wakes again.
  // Registered once; no-ops unless a recording is live. Re-arms the wake lock on
  // return (it auto-releases on hide).
  useEffect(() => {
    function flushChunk() {
      const rec = recorderRef.current
      if (rec && rec.state === 'recording') {
        try { rec.requestData() } catch { /* ignore */ }
      }
    }
    function onVisibility() {
      if (document.visibilityState === 'hidden') {
        flushChunk()
      } else if (recorderRef.current?.state === 'recording') {
        acquireWakeLock()
      }
    }
    document.addEventListener('visibilitychange', onVisibility)
    window.addEventListener('pagehide', flushChunk)
    return () => {
      document.removeEventListener('visibilitychange', onVisibility)
      window.removeEventListener('pagehide', flushChunk)
    }
  }, [acquireWakeLock])

  // ── Unmount cleanup. A Pause/navigate-away unmounts InterviewSession without
  // calling stopAndUpload: flush the tail to IDB, release the wake lock, and stop
  // the mic so the recording indicator clears. Any persisted chunks survive as a
  // recoverable orphan, re-uploaded on the next visit via recoverOrphanedAudio.
  useEffect(() => {
    return () => {
      // Only flush if still recording — requestData() throws InvalidStateError
      // on an inactive recorder, which the normal completion path (stopAndUpload)
      // has already stopped by the time this unmount fires.
      const rec = recorderRef.current
      if (rec && rec.state === 'recording') {
        try { rec.requestData() } catch { /* ignore */ }
      }
      releaseWakeLock()
      try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    }
  }, [releaseWakeLock])

  const startCapture = useCallback(async (interviewId = null) => {
    // No-op if already capturing, or in a non-browser environment.
    if (recorderRef.current) return
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) return

    try {
      // Re-use permission already granted by Web Speech API — same mic source.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const mimeType = bestMimeType()
      mimeTypeRef.current = mimeType

      const recorder = new MediaRecorder(stream, mimeType ? { mimeType } : undefined)
      recorderRef.current = recorder
      chunksRef.current   = []

      // Crash-safe session: persist each chunk to IndexedDB so a killed tab
      // doesn't lose the voice-clone take. Tagged with interviewId so a recovered
      // orphan knows which interview to re-upload to. Non-fatal — interview is primary.
      const sessionId = uid()
      sessionIdRef.current = sessionId
      uploadedRef.current = false
      createSession({
        id: sessionId,
        source: 'interview',
        mimeType: mimeType || 'audio/webm',
        filename: `interview-${sessionId}.${extFromMime(mimeType || 'audio/webm')}`,
        interviewId,
      }).catch((e) => console.warn('[audioCapture] createSession failed (non-fatal):', e?.message))

      recorder.ondataavailable = (e) => {
        if (e.data?.size > 0) {
          chunksRef.current.push(e.data)
          appendChunk(sessionId, e.data).catch(() => {})
        }
      }

      recorder.onerror = (e) => {
        console.warn('[audioCapture] MediaRecorder error:', e?.error?.message)
      }

      // 4-second slices (matching the VoiceMemo lane) so a hard kill that never
      // fires visibilitychange loses at most the last few seconds. The flush-on-hide
      // handler above covers the ordinary iOS-background case immediately.
      recorder.start(4000)
      acquireWakeLock()
      setIsCapturing(true)
    } catch (e) {
      // Permission denied, NotFoundError, or any other getUserMedia failure.
      // Log and continue — the interview must not be affected.
      console.warn('[audioCapture] startCapture failed (non-fatal):', e?.message)
    }
  }, [acquireWakeLock])

  const stopAndUpload = useCallback(async (interviewId) => {
    const recorder = recorderRef.current
    if (!recorder || uploadedRef.current) return
    if (!interviewId) return

    uploadedRef.current = true   // prevent double-upload on StrictMode double-fire
    const sessionId = sessionIdRef.current

    return new Promise((resolve) => {
      recorder.onstop = async () => {
        // Stop mic track so the browser recording indicator clears immediately.
        streamRef.current?.getTracks().forEach((t) => t.stop())
        releaseWakeLock()
        setIsCapturing(false)

        const chunks = chunksRef.current
        if (chunks.length === 0) {
          if (sessionId) deleteSession(sessionId).catch(() => {})
          resolve(); return
        }

        const mime = mimeTypeRef.current || 'audio/webm'
        const blob = new Blob(chunks, { type: mime })

        // Skip uploads below the floor to avoid polluting the training set.
        if (blob.size < MIN_UPLOAD_BYTES) {
          console.info(`[audioCapture] interview too short (${blob.size} bytes) — skipping upload`)
          if (sessionId) deleteSession(sessionId).catch(() => {})
          resolve()
          return
        }

        const ext      = extFromMime(mime)
        const pathname = `interviews/audio/${interviewId}.${ext}`

        // Fire the upload; don't block the caller on completion.
        resolve()

        try {
          await upload(pathname, blob, {
            access:          'public',
            handleUploadUrl: AUDIO_UPLOAD_URL,
            clientPayload:   JSON.stringify({ interviewId }),
            contentType:     audioContentType(mime),
            headers:         await authUploadHeaders(),
          })
          console.info(`[audioCapture] uploaded: ${pathname}`)
          if (sessionId) deleteSession(sessionId).catch(() => {})
        } catch (e) {
          console.warn('[audioCapture] upload failed (non-fatal):', e?.message)
          // Leave the session in IDB (marked failed) so the audio isn't lost —
          // recoverOrphanedAudio re-uploads it next time the interview is opened.
          if (sessionId) patchSession(sessionId, { status: 'failed', interviewId }).catch(() => {})
        }
      }

      if (recorder.state !== 'inactive') {
        recorder.stop()
      } else {
        // Already stopped somehow — fire onstop manually.
        recorder.onstop()
      }
    })
  }, [releaseWakeLock])

  // Re-upload an interview-audio take that was persisted to IndexedDB but never
  // finished uploading (the tab was killed/backgrounded mid-interview, or the
  // completion upload failed). Silent + fire-and-forget, matching the rest of this
  // hook — the audio is a background voice-clone asset, not user-facing content, so
  // there's no recovery card. Only touches takes tagged with THIS interview id, and
  // never the current live session.
  const recoverOrphanedAudio = useCallback(async (interviewId) => {
    if (!interviewId) return
    let rows = []
    try {
      rows = await listRecoverable('interview')
    } catch { return }
    const orphans = rows.filter(
      (s) => s.interviewId === interviewId && s.id !== sessionIdRef.current,
    )
    for (const s of orphans) {
      try {
        const blob = await assembleBlob(s.id)
        if (!blob || blob.size < MIN_UPLOAD_BYTES) {
          // Empty or too-short to be useful — drop it so it doesn't linger.
          await deleteSession(s.id).catch(() => {})
          continue
        }
        // Deliberately do NOT flip status to 'uploading' here: 'uploading' is not
        // in the listRecoverable() filter, so a tab-kill mid-recovery would strand
        // the take in a status that never reappears. Leaving the prior status
        // ('recording' | 'stopped' | 'failed' — all recoverable) means a killed
        // recovery is simply retried on the next visit.
        const ext      = extFromMime(s.mimeType || blob.type || 'audio/webm')
        const pathname = `interviews/audio/${interviewId}.${ext}`
        await upload(pathname, blob, {
          access:          'public',
          handleUploadUrl: AUDIO_UPLOAD_URL,
          clientPayload:   JSON.stringify({ interviewId }),
          contentType:     audioContentType(s.mimeType || blob.type),
          headers:         await authUploadHeaders(),
        })
        await deleteSession(s.id).catch(() => {})
        console.info(`[audioCapture] recovered + re-uploaded orphaned take for interview ${interviewId}`)
      } catch (e) {
        console.warn('[audioCapture] orphan recovery failed (non-fatal):', e?.message)
        await patchSession(s.id, { status: 'failed', interviewId }).catch(() => {})
      }
    }
  }, [])

  return { startCapture, stopAndUpload, recoverOrphanedAudio, isCapturing }
}
