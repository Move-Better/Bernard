import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import { Mic, Square, Loader2, RotateCcw, ArrowRight, Sparkles, Lock, ChevronLeft, Star, HelpCircle, Lightbulb } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * DemoExperience — the no-login public demo (/demo/try).
 *
 * Lives OUTSIDE the auth gate (sibling of /privacy, /onboard in App.jsx's outer
 * <Routes>), so a prospect can experience the core loop with zero signup.
 *
 * Flow: pick a topic → record (≤90s) → see your transcript → sign-up CTA.
 *
 * Phase B1: record → transcribe → show transcript. Nothing is persisted.
 * Phase B2 will slot generation (streaming blog + social atoms) in after transcript.
 *
 * iOS note: getUserMedia runs inside the tap handler (user gesture, required on iOS).
 * Mime falls back to audio/mp4 for Safari.
 */

const MAX_SECONDS = 90

// Three interview archetypes — maps to the 3 core content types NarrateRx produces:
// patient story (blog/email), FAQ (social + Google Q&A), thought leadership (opinion post).
const TOPICS = [
  {
    id: 'story',
    Icon: Star,
    label: 'A patient win',
    question: 'Tell me about a patient who finally got the relief they were looking for.',
    hint: 'A recent case, an outcome that surprised you, or someone whose life changed.',
    color: 'text-amber-500',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    hoverBorder: 'hover:border-amber-400 dark:hover:border-amber-600',
  },
  {
    id: 'faq',
    Icon: HelpCircle,
    label: 'Your most-asked question',
    question: "What's the question almost every new patient asks you — and what do you tell them?",
    hint: 'The thing you explain so often you could say it in your sleep.',
    color: 'text-blue-500',
    bg: 'bg-blue-50 dark:bg-blue-950/30',
    border: 'border-blue-200 dark:border-blue-800',
    hoverBorder: 'hover:border-blue-400 dark:hover:border-blue-600',
  },
  {
    id: 'insight',
    Icon: Lightbulb,
    label: 'Something patients get wrong',
    question: "What's one thing you wish every patient understood before their first visit?",
    hint: 'A common misconception, a fear you ease, or a mindset shift that changes outcomes.',
    color: 'text-primary',
    bg: 'bg-primary/5',
    border: 'border-primary/20',
    hoverBorder: 'hover:border-primary/50',
  },
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
  return ''
}

function formatTime(sec) {
  const s = Math.max(0, Math.floor(sec))
  const mm = Math.floor(s / 60)
  const ss = (s % 60).toString().padStart(2, '0')
  return `${mm}:${ss}`
}

export default function DemoExperience() {
  useDocumentTitle('Try NarrateRx — talk for a minute, no login')

  // state machine: picking | requesting | recording | transcribing | done
  const [phase, setPhase] = useState('picking')
  const [topicId, setTopicId] = useState(null)
  const [elapsed, setElapsed] = useState(0)
  const [transcript, setTranscript] = useState('')
  const [error, setError] = useState('')

  const recorderRef = useRef(null)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const mimeRef = useRef('')

  const topic = TOPICS.find((t) => t.id === topicId) || null

  // Stop the mic + clear the timer on unmount.
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

  const transcribe = useCallback(async (blob, mime) => {
    setPhase('transcribing')
    try {
      // eslint-disable-next-line narraterx/no-raw-api-fetch -- public unauthenticated demo endpoint; raw binary audio body, no Bearer token, apiFetch doesn't apply.
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
        setPhase('recording') // back to recording state so they see the error in context
        setPhase('picking')
        return
      }
      const data = await res.json()
      const text = (data?.transcript || '').trim()
      if (!text) {
        setError("We didn't catch any speech — try recording again somewhere quieter.")
        setPhase('picking')
        return
      }
      setTranscript(text)
      setPhase('done')
    } catch {
      setError('Something went wrong reaching the demo. Check your connection and try again.')
      setPhase('picking')
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
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio. Try Safari or Chrome on a phone or laptop.")
      return
    }
    setPhase('requesting')
    try {
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
          setPhase('picking')
          return
        }
        transcribe(blob, type)
      }
      rec.onerror = () => {
        setError('Recording stopped unexpectedly — try again.')
        stopRecording()
        setPhase('picking')
      }

      rec.start(1000)
      startTimeRef.current = Date.now()
      setElapsed(0)
      setPhase('recording')
      timerRef.current = setInterval(() => {
        const secs = (Date.now() - startTimeRef.current) / 1000
        setElapsed(secs)
        if (secs >= MAX_SECONDS) stopRecording()
      }, 200)
    } catch (e) {
      const denied = e?.name === 'NotAllowedError' || e?.name === 'SecurityError'
      setError(
        denied
          ? 'We need microphone access to hear you. Allow the mic and tap record again.'
          : "We couldn't start the microphone. Check it's connected and try again."
      )
      stopTracks()
      setPhase('picking')
    }
  }, [stopTracks, stopRecording, transcribe])

  const reset = useCallback(() => {
    setTranscript('')
    setError('')
    setElapsed(0)
    setTopicId(null)
    setPhase('picking')
  }, [])

  const goBack = useCallback(() => {
    if (timerRef.current) clearInterval(timerRef.current)
    stopTracks()
    setError('')
    setElapsed(0)
    setPhase('picking')
  }, [stopTracks])

  const recording = phase === 'recording'
  const requesting = phase === 'requesting'
  const transcribing = phase === 'transcribing'
  const done = phase === 'done'
  const picking = phase === 'picking'
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

      <main className="flex-1 flex flex-col items-center justify-center px-5 py-10 sm:py-14">
        <div className="w-full max-w-xl">

          {/* ── Topic picker ─────────────────────────────────────────────── */}
          {picking && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
                  Pick a question. <em className="not-italic text-primary">Answer it out loud.</em>
                </h1>
                <p className="mt-3 text-base text-muted-foreground text-balance">
                  Talk for up to a minute — in your own words. We&apos;ll capture it
                  exactly as you said it.
                </p>
              </div>

              <div className="flex flex-col gap-3">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTopicId(t.id); startRecording() }}
                    className={cn(
                      'w-full text-left rounded-2xl border-2 p-5 sm:p-6 transition-all duration-150 focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
                      t.bg, t.border, t.hoverBorder,
                      'hover:shadow-sm active:scale-[0.99]'
                    )}
                  >
                    <div className="flex items-start gap-4">
                      <div className={cn('mt-0.5 shrink-0', t.color)}>
                        <t.Icon className="h-5 w-5" />
                      </div>
                      <div className="min-w-0">
                        <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
                          {t.label}
                        </div>
                        <p className="text-base font-medium text-foreground leading-snug">
                          {t.question}
                        </p>
                        <p className="mt-1.5 text-sm text-muted-foreground">
                          {t.hint}
                        </p>
                      </div>
                      <div className="ml-auto pl-2 shrink-0 flex items-center self-center">
                        <div className={cn('h-9 w-9 rounded-full flex items-center justify-center', t.bg, t.border, 'border')}>
                          <Mic className={cn('h-4 w-4', t.color)} />
                        </div>
                      </div>
                    </div>
                  </button>
                ))}
              </div>

              {error && (
                <div className="mt-5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
                  {error}
                </div>
              )}

              <p className="mt-6 text-center text-xs text-muted-foreground">
                Nothing is saved. Your recording is transcribed and discarded — this is just a taste.
              </p>
            </>
          )}

          {/* ── Recording / requesting / transcribing ─────────────────────── */}
          {(requesting || recording || transcribing) && topic && (
            <>
              {/* Question being answered */}
              <div className={cn('rounded-2xl border-2 p-5 sm:p-6 mb-6', topic.bg, topic.border)}>
                <div className="flex items-center gap-2 mb-2">
                  <topic.Icon className={cn('h-4 w-4', topic.color)} />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">
                    {topic.label}
                  </span>
                </div>
                <p className="text-base font-medium text-foreground leading-snug">
                  {topic.question}
                </p>
              </div>

              {/* Mic */}
              <div className="rounded-2xl border border-border bg-card shadow-sm p-8 sm:p-10 flex flex-col items-center">
                <button
                  type="button"
                  onClick={recording ? stopRecording : undefined}
                  disabled={requesting || transcribing}
                  aria-label={recording ? 'Stop recording' : 'Recording…'}
                  className={cn(
                    'h-28 w-28 rounded-full flex items-center justify-center transition shadow-sm focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60',
                    recording
                      ? 'bg-destructive text-destructive-foreground animate-pulse cursor-pointer'
                      : 'bg-primary text-primary-foreground cursor-default'
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

                <div className="mt-5 text-center" aria-live="polite">
                  {recording ? (
                    <>
                      <div className="text-3xl font-mono tabular-nums">{formatTime(elapsed)}</div>
                      <div className="mt-1 text-xs text-muted-foreground tabular-nums">
                        {formatTime(remaining)} left · tap to stop early
                      </div>
                    </>
                  ) : transcribing ? (
                    <div className="text-sm font-medium">Listening back to what you said…</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Waiting for the microphone…</div>
                  )}
                </div>

                {recording && (
                  <div className="mt-4 w-full max-w-xs h-1 rounded-full bg-muted overflow-hidden">
                    <div
                      className="h-full bg-destructive transition-[width] duration-200 ease-linear"
                      style={{ width: `${Math.min(100, (elapsed / MAX_SECONDS) * 100)}%` }}
                    />
                  </div>
                )}
              </div>

              {!transcribing && (
                <button
                  type="button"
                  onClick={goBack}
                  className="mt-5 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mx-auto"
                >
                  <ChevronLeft className="h-4 w-4" />
                  Pick a different question
                </button>
              )}
            </>
          )}

          {/* ── Result: transcript ───────────────────────────────────────── */}
          {done && topic && (
            <div>
              {/* The question they answered */}
              <div className={cn('rounded-xl border p-4 mb-5 flex items-start gap-3', topic.bg, topic.border)}>
                <topic.Icon className={cn('h-4 w-4 mt-0.5 shrink-0', topic.color)} />
                <p className="text-sm text-muted-foreground leading-snug">{topic.question}</p>
              </div>

              <div className="flex items-center gap-2 text-sm font-medium text-primary mb-3">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Your answer, captured word for word
              </div>
              <div className="rounded-2xl border border-border bg-card shadow-sm p-6 sm:p-8">
                <p className="text-base leading-relaxed whitespace-pre-wrap text-foreground">
                  {transcript}
                </p>
              </div>
              <p className="mt-4 text-sm text-muted-foreground text-balance">
                That&apos;s your raw material. NarrateRx turns transcripts like this into
                ready-to-post blogs, social posts, and newsletters — always in your voice,
                never a robot&apos;s.
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
                  Try another question
                </Button>
              </div>
            </div>
          )}

          {/* Error (non-picking states) */}
          {error && !picking && (
            <div className="mt-5 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
              {error}
            </div>
          )}
        </div>
      </main>
    </div>
  )
}
