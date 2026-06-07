import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Mic, Square, Loader2, RotateCcw, ArrowRight, Sparkles, Lock } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * DemoExperience — the no-login public demo (/demo).
 *
 * Lives OUTSIDE the auth gate (sibling of /privacy, /onboard in App.jsx's outer
 * <Routes>), so a prospect on narraterx.ai can experience the core loop with zero
 * signup. Scope + rationale: .claude/scope-no-login-demo.md.
 *
 * Phase B1 (this file): record up to 90s → POST the audio to /api/demo/transcribe
 *   → show the transcript in the visitor's own words. Nothing is persisted.
 * Phase B2 will slot a "turn this into drafts" generation step in after the
 *   transcript (streaming blog + social atoms from /api/demo/generate).
 *
 * Positioning guardrail (project memory): NarrateRx amplifies the clinician's
 * REAL voice — it is a librarian, not a ghostwriter. Copy here never says "AI
 * writes your content"; the hero of the demo is *their* words, captured exactly.
 *
 * iOS capture notes: getUserMedia is invoked inside the tap handler (a user
 * gesture, required on iOS), and the MediaRecorder mime falls back to audio/mp4
 * (Safari's only supported type). There is no audio *playback* in B1, so the
 * TTS audio-unlock dance (project memory) isn't needed until B3's talk-back.
 */

const MAX_SECONDS = 90

// Anti-blank-mic nudge: rotate concrete things a clinician could say, so the
// visitor is never staring at a silent mic wondering what to talk about.
const PROMPTS = [
  'Tell me about a patient who finally got relief this week.',
  "What's a question every new patient asks you?",
  'Explain something you wish more people understood about back pain.',
  "Describe a treatment patients are nervous about — but shouldn't be.",
  'What did you take away from your last seminar or course?',
  'Walk me through how you explain a first visit to someone new.',
]

const PREFERRED_MIME_TYPES = [
  'audio/webm;codecs=opus',
  'audio/webm',
  'audio/mp4',
  'audio/mpeg',
]

function pickMimeType() {
  if (typeof MediaRecorder === 'undefined') return null
  for (const t of PREFERRED_MIME_TYPES) {
    if (MediaRecorder.isTypeSupported(t)) return t
  }
  return '' // let the browser pick
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export default function DemoExperience() {
  useDocumentTitle('Try NarrateRx — talk for a minute, no login')

  // state machine: idle | requesting | recording | transcribing | done
  const [state, setState] = useState('idle')
  const [elapsed, setElapsed] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')
  const [promptIdx, setPromptIdx] = useState(0)

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const mimeRef = useRef('')

  // Rotate the suggestion prompt while idle. Pauses once the user is recording
  // or reviewing — at that point they don't need the nudge.
  useEffect(() => {
    if (state !== 'idle') return
    const id = setInterval(() => {
      setPromptIdx((i) => (i + 1) % PROMPTS.length)
    }, 3800)
    return () => clearInterval(id)
  }, [state])

  // Stop the mic + clear the timer on unmount so the recording indicator clears.
  useEffect(() => {
    return () => {
      if (timerRef.current) clearInterval(timerRef.current)
      try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    }
  }, [])

  const stopTracks = useCallback(() => {
    try { streamRef.current?.getTracks().forEach((t) => t.stop()) } catch { /* ignore */ }
    streamRef.current = null
  }, [])

  // Send the captured audio to the public transcribe endpoint. No auth, no
  // workspace — this is a deliberately public marketing surface.
  const transcribe = useCallback(async (blob, mime) => {
    setState('transcribing')
    try {
      // eslint-disable-next-line narraterx/no-raw-api-fetch -- public, unauthenticated demo endpoint; sends a raw binary audio body (no Bearer token, no JSON wrapper), so apiFetch doesn't apply.
      const res = await fetch('/api/demo/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': mime || blob.type || 'audio/webm' },
        body: blob,
      })
      if (!res.ok) {
        let msg = "We couldn't transcribe that — give it another try."
        if (res.status === 429) {
          msg = "You've hit the demo limit for now — give it a minute and try again."
        } else {
          const data = await res.json().catch(() => null)
          if (data?.message) msg = data.message
        }
        setError(msg)
        setState('idle')
        return
      }
      const data = await res.json()
      const text = (data?.transcript || '').trim()
      if (!text) {
        setError("We didn't catch any speech — try recording again somewhere quieter.")
        setState('idle')
        return
      }
      setTranscript(text)
      setState('done')
    } catch {
      setError('Something went wrong reaching the demo. Check your connection and try again.')
      setState('idle')
    }
  }, [])

  const stopRecording = useCallback(() => {
    if (timerRef.current) {
      clearInterval(timerRef.current)
      timerRef.current = null
    }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') {
      rec.stop() // fires onstop → transcribe
    }
  }, [])

  const startRecording = useCallback(async () => {
    setError('')
    setTranscript('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio. Try Safari or Chrome on a phone or laptop.")
      return
    }
    setState('requesting')
    try {
      // getUserMedia must run inside the tap gesture on iOS — it does (this is the
      // click handler). Permission may already be granted from a prior visit.
      const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
      streamRef.current = stream

      const mime = pickMimeType()
      mimeRef.current = mime || 'audio/webm'
      const rec = new MediaRecorder(stream, mime ? { mimeType: mime } : undefined)
      recorderRef.current = rec
      chunksRef.current = []

      rec.ondataavailable = (e) => {
        if (e.data && e.data.size > 0) chunksRef.current.push(e.data)
      }
      rec.onstop = () => {
        stopTracks()
        const type = rec.mimeType || mimeRef.current || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (!blob.size) {
          setError("That recording came through empty — try again.")
          setState('idle')
          return
        }
        transcribe(blob, type)
      }
      rec.onerror = () => {
        setError('Recording stopped unexpectedly — try again.')
        stopRecording()
        setState('idle')
      }

      // 1s timeslices so chunks accumulate steadily (and a backgrounded tab loses
      // at most a second of audio).
      rec.start(1000)
      startTimeRef.current = Date.now()
      setElapsed(0)
      setState('recording')
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(secs)
        if (secs >= MAX_SECONDS) stopRecording() // hard cap — auto-stop at 90s
      }, 200)
    } catch (e) {
      // Permission denied / NotFoundError / etc.
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      setError(
        denied
          ? 'We need microphone access to hear you. Allow the mic and tap record again.'
          : "We couldn't start the microphone. Check it's connected and try again."
      )
      stopTracks()
      setState('idle')
    }
  }, [stopTracks, stopRecording, transcribe])

  const reset = useCallback(() => {
    setTranscript('')
    setError('')
    setElapsed(0)
    setState('idle')
  }, [])

  const recording = state === 'recording'
  const requesting = state === 'requesting'
  const transcribing = state === 'transcribing'
  const done = state === 'done'
  const remaining = Math.max(0, MAX_SECONDS - elapsed)

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      {/* Top bar */}
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-border/60">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-lg">
          <span>Narrate<span className="text-primary">Rx</span></span>
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          No login needed
        </span>
      </header>

      {/* Main */}
      <main className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:py-14">
        <div className="w-full max-w-xl">
          {!done && (
            <div className="text-center mb-8 sm:mb-10">
              <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
                Talk for a minute. In your own words.
              </h1>
              <p className="mt-3 text-base text-muted-foreground text-balance">
                Tell us about a patient win, a question you always get, or something you
                wish more people understood. We&apos;ll capture it exactly as you said it —
                the raw material for content in <span className="text-foreground font-medium">your</span> voice.
              </p>
            </div>
          )}

          {/* ── Capture card ─────────────────────────────────────────────── */}
          {!done && (
            <div className="rounded-2xl border border-border bg-card shadow-sm p-8 sm:p-10 flex flex-col items-center">
              <button
                type="button"
                onClick={recording ? stopRecording : startRecording}
                disabled={requesting || transcribing}
                aria-label={recording ? 'Stop recording' : 'Start recording'}
                className={cn(
                  'h-28 w-28 rounded-full flex items-center justify-center transition shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60',
                  recording
                    ? 'bg-destructive text-destructive-foreground animate-pulse'
                    : 'bg-primary text-primary-foreground hover:bg-primary/90'
                )}
              >
                {requesting || transcribing ? (
                  <Loader2 className="h-10 w-10 animate-spin" />
                ) : recording ? (
                  <Square className="h-9 w-9" fill="currentColor" />
                ) : (
                  <Mic className="h-10 w-10" />
                )}
              </button>

              {/* Timer / status */}
              <div className="mt-5 text-center" aria-live="polite">
                {recording ? (
                  <>
                    <div className="text-3xl font-mono tabular-nums">{formatTime(elapsed)}</div>
                    <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                      {formatTime(remaining)} left · tap to stop
                    </div>
                  </>
                ) : transcribing ? (
                  <div className="text-sm font-medium">Listening back to what you said…</div>
                ) : requesting ? (
                  <div className="text-sm text-muted-foreground">Waiting for the microphone…</div>
                ) : (
                  <div className="text-sm text-muted-foreground">Tap to start recording</div>
                )}
              </div>

              {/* Recording progress bar */}
              {recording && (
                <div className="mt-4 w-full max-w-xs h-1 rounded-full bg-muted overflow-hidden">
                  <div
                    className="h-full bg-destructive transition-[width] duration-200 ease-linear"
                    style={{ width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%` }}
                  />
                </div>
              )}

              {/* Rotating prompt nudge (idle only) */}
              {state === 'idle' && (
                <div className="mt-6 h-12 flex items-center justify-center text-center px-2">
                  <p key={promptIdx} className="text-sm text-muted-foreground transition-opacity">
                    <span className="text-muted-foreground/70">Not sure what to say? Try: </span>
                    <span className="text-foreground">“{PROMPTS[promptIdx]}”</span>
                  </p>
                </div>
              )}
            </div>
          )}

          {/* ── Result: transcript ───────────────────────────────────────── */}
          {done && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary mb-3">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Here&apos;s what you said
              </div>
              <div className="rounded-2xl border border-border bg-card shadow-sm p-6 sm:p-8">
                <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground">
                  {transcript}
                </p>
              </div>
              <p className="mt-4 text-sm text-muted-foreground text-balance">
                That&apos;s your raw material — captured word-for-word. NarrateRx turns
                transcripts like this into ready-to-post blogs, social posts, and
                newsletters, always in your voice (never a robot&apos;s).
              </p>

              <div className="mt-6 flex flex-col sm:flex-row gap-3">
                <Button asChild className="flex-1">
                  <Link to="/onboard">
                    See what NarrateRx can do
                    <ArrowRight className="ml-1.5 h-4 w-4" />
                  </Link>
                </Button>
                <Button variant="outline" onClick={reset} className="flex-1 sm:flex-none">
                  <RotateCcw className="mr-1.5 h-4 w-4" />
                  Record again
                </Button>
              </div>
            </div>
          )}

          {/* Error */}
          {error && (
            <div className="mt-5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
              {error}
            </div>
          )}

          {/* Reassurance footer */}
          {!done && (
            <p className="mt-6 text-center text-xs text-muted-foreground">
              Nothing is saved. Your recording is transcribed and discarded — this is just a taste.
            </p>
          )}
        </div>
      </main>
    </div>
  )
}
