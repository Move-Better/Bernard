import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  Mic, Square, Loader2, RotateCcw, ArrowRight, Sparkles,
  Lock, ChevronLeft, Star, HelpCircle, Lightbulb, MessageCircle,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * DemoExperience — the no-login public demo (/demo/try).
 *
 * Flow:
 *   1. Pick one of 3 topic cards (patient story / FAQ / insight)
 *   2. Record your answer (≤90s)
 *   3. Bernard (AI host) asks a follow-up question
 *   4. Record your follow-up answer (≤90s)
 *   5. Optionally one more follow-up (max 2 Bernard questions = 3 recordings total)
 *   6. See all transcripts + sign-up CTA
 *
 * Nothing is persisted. Audio lives in memory only for the request duration.
 *
 * iOS: getUserMedia is called inside the tap handler (user gesture, required).
 * Mime falls back to audio/mp4 for Safari.
 */

const MAX_SECONDS = 90
const MAX_ROUNDS = 3 // 1 opener + 2 Bernard follow-ups

// Three interview archetypes — maps to the 3 core content types Bernard produces:
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

function ProgressDots({ completed }) {
  return (
    <div className="flex items-center justify-center gap-2 mb-6">
      {Array.from({ length: MAX_ROUNDS }).map((_, i) => (
        <div
          key={i}
          className={cn(
            'h-2 rounded-full transition-all duration-300',
            i < completed ? 'w-6 bg-primary'
              : i === completed ? 'w-4 bg-primary/30'
              : 'w-2 bg-muted'
          )}
        />
      ))}
    </div>
  )
}

export default function DemoExperience() {
  useDocumentTitle('Try Bernard — talk for a minute, no login')

  // phase: picking | requesting | recording | transcribing | bernard | ready | done
  const [phase, setPhase] = useState('picking')
  const [topicId, setTopicId] = useState(null)
  // round: 0 = answering the opening question, 1+ = answering Bernard's follow-ups
  const [round, setRound] = useState(0)
  const [transcripts, setTranscripts] = useState([]) // one string per completed round
  // Each Bernard question stored so results panel can show them
  const [bernardQuestions, setBernardQuestions] = useState([]) // questions Bernard asked
  const [currentBernardQ, setCurrentBernardQ] = useState('') // question being shown now
  const [elapsed, setElapsed] = useState(0)
  const [error, setError] = useState('')

  const recorderRef = useRef(null)
  const recorderErrorRef = useRef(false)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const mimeRef = useRef('')

  const topic = TOPICS.find((t) => t.id === topicId) || null
  const currentQuestion = round === 0 ? topic?.question : currentBernardQ

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

  // After transcription: ask Bernard for a follow-up or finish.
  const afterTranscript = useCallback(async (newTranscripts, currentTopicId) => {
    const nextRound = newTranscripts.length
    if (nextRound >= MAX_ROUNDS) {
      setPhase('done')
      return
    }

    setPhase('bernard')
    try {
      // eslint-disable-next-line bernard/no-raw-api-fetch -- public unauthenticated demo endpoint; no Bearer token, apiFetch doesn't apply.
      const res = await fetch('/api/demo/followup', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ topicId: currentTopicId, transcripts: newTranscripts }),
      })
      if (!res.ok) { setPhase('done'); return }
      const data = await res.json()
      const q = (data?.question || '').trim()
      if (!q) { setPhase('done'); return }
      setBernardQuestions((prev) => [...prev, q])
      setCurrentBernardQ(q)
      setRound(nextRound)
      setPhase('ready')
    } catch {
      setPhase('done')
    }
  }, [])

  const transcribeBlob = useCallback(async (blob, mime, currentTranscripts, currentTopicId) => {
    setPhase('transcribing')
    try {
      // eslint-disable-next-line bernard/no-raw-api-fetch -- public unauthenticated demo endpoint; raw binary audio body, no Bearer token, apiFetch doesn't apply.
      const res = await fetch('/api/demo/transcribe', {
        method: 'POST',
        headers: { 'Content-Type': mime || blob.type || 'audio/webm' },
        body: blob,
      })
      if (!res.ok) {
        let msg = "We couldn't transcribe that — give it another try."
        if (res.status === 429) msg = "You've hit the demo limit — try again in a minute."
        else { const d = await res.json().catch(() => null); if (d?.message) msg = d.message }
        setError(msg)
        setPhase(currentTranscripts.length === 0 ? 'picking' : 'done')
        return
      }
      const data = await res.json()
      const text = (data?.transcript || '').trim()
      if (!text) {
        setError("We didn't catch any speech — try somewhere quieter.")
        setPhase(currentTranscripts.length === 0 ? 'picking' : 'done')
        return
      }
      const newTranscripts = [...currentTranscripts, text]
      setTranscripts(newTranscripts)
      await afterTranscript(newTranscripts, currentTopicId)
    } catch {
      setError('Something went wrong. Check your connection and try again.')
      setPhase(currentTranscripts.length === 0 ? 'picking' : 'done')
    }
  }, [afterTranscript])

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const startRecording = useCallback(async (currentTranscripts, currentTopicId) => {
    setError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio. Try Safari or Chrome.")
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
      recorderErrorRef.current = false
      chunksRef.current = []

      rec.ondataavailable = (e) => { if (e.data?.size > 0) chunksRef.current.push(e.data) }
      rec.onstop = () => {
        stopTracks()
        if (recorderErrorRef.current) return
        const type = rec.mimeType || mimeRef.current || 'audio/webm'
        const blob = new Blob(chunksRef.current, { type })
        if (!blob.size) {
          setError("That recording came through empty — try again.")
          setPhase(currentTranscripts.length === 0 ? 'picking' : 'ready')
          return
        }
        transcribeBlob(blob, type, currentTranscripts, currentTopicId)
      }
      rec.onerror = () => {
        recorderErrorRef.current = true
        setError('Recording stopped unexpectedly — try again.')
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        const r = recorderRef.current
        if (r && r.state !== 'inactive') r.stop()
        setPhase(currentTranscripts.length === 0 ? 'picking' : 'ready')
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
      setError(denied
        ? 'Allow microphone access and tap record again.'
        : "Couldn't start the microphone — check it's connected.")
      stopTracks()
      setPhase(currentTranscripts.length === 0 ? 'picking' : 'ready')
    }
  }, [stopTracks, stopRecording, transcribeBlob])

  const reset = useCallback(() => {
    setTranscripts([])
    setBernardQuestions([])
    setCurrentBernardQ('')
    setError('')
    setElapsed(0)
    setRound(0)
    setTopicId(null)
    setPhase('picking')
  }, [])

  const goBack = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const rec = recorderRef.current
    if (rec) {
      rec.onstop = null
      if (rec.state !== 'inactive') rec.stop()
    }
    stopTracks()
    reset()
  }, [stopTracks, reset])

  const remaining = Math.max(0, MAX_SECONDS - elapsed)
  const recording = phase === 'recording'
  const requesting = phase === 'requesting'
  const transcribing = phase === 'transcribing'
  const bernardThinking = phase === 'bernard'
  const ready = phase === 'ready'
  const done = phase === 'done'
  const picking = phase === 'picking'

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
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

          {/* ── Topic picker ─────────────────────────────────────────── */}
          {picking && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
                  Pick a question. <em className="not-italic text-primary">Answer it out loud.</em>
                </h1>
                <p className="mt-3 text-base text-muted-foreground text-balance">
                  Talk for up to a minute. Bernard will ask a couple of follow-ups —
                  just like a real Bernard interview.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {TOPICS.map((t) => (
                  <button
                    key={t.id}
                    type="button"
                    onClick={() => { setTopicId(t.id); startRecording([], t.id) }}
                    className={cn(
                      'w-full text-left rounded-2xl border-2 p-5 sm:p-6 transition-all duration-150',
                      'focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
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
                        <p className="mt-1.5 text-sm text-muted-foreground">{t.hint}</p>
                      </div>
                      <div className="ml-auto pl-2 shrink-0 flex items-center self-center">
                        <div className={cn('h-9 w-9 rounded-full flex items-center justify-center border', t.bg, t.border)}>
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
                Nothing is saved. Your recording is transcribed and discarded.
              </p>
            </>
          )}

          {/* ── Recording / requesting / transcribing / bernard thinking ── */}
          {(requesting || recording || transcribing || bernardThinking) && topic && (
            <>
              <ProgressDots completed={transcripts.length} />
              {/* Current question */}
              <div className={cn('rounded-2xl border-2 p-5 sm:p-6 mb-6', topic.bg, topic.border)}>
                {round > 0 ? (
                  <div className="flex items-center gap-1.5 mb-2">
                    <MessageCircle className="h-3.5 w-3.5 text-muted-foreground" />
                    <span className="text-xs font-medium text-muted-foreground">Bernard asks</span>
                  </div>
                ) : (
                  <div className="flex items-center gap-2 mb-2">
                    <topic.Icon className={cn('h-4 w-4', topic.color)} />
                    <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{topic.label}</span>
                  </div>
                )}
                <p className="text-base font-medium text-foreground leading-snug">{currentQuestion}</p>
              </div>

              {/* Mic */}
              <div className="rounded-2xl border border-border bg-card shadow-sm p-8 sm:p-10 flex flex-col items-center">
                <button
                  type="button"
                  onClick={recording ? stopRecording : undefined}
                  disabled={requesting || transcribing || bernardThinking}
                  aria-label={recording ? 'Stop recording' : 'Recording…'}
                  className={cn(
                    'h-28 w-28 rounded-full flex items-center justify-center transition shadow-sm',
                    'focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30 disabled:opacity-60',
                    recording
                      ? 'bg-destructive text-destructive-foreground animate-pulse cursor-pointer'
                      : 'bg-primary text-primary-foreground cursor-default'
                  )}
                >
                  {requesting || transcribing || bernardThinking ? (
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
                    <div className="text-sm font-medium">Transcribing your answer…</div>
                  ) : bernardThinking ? (
                    <div className="text-sm text-muted-foreground">Bernard is thinking…</div>
                  ) : (
                    <div className="text-sm text-muted-foreground">Waiting for microphone…</div>
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

              {!transcribing && !bernardThinking && (
                <button
                  type="button"
                  onClick={transcripts.length > 0 ? () => setPhase('done') : goBack}
                  className="mt-5 flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mx-auto"
                >
                  <ChevronLeft className="h-4 w-4" />
                  {transcripts.length > 0 ? 'Skip to results' : 'Pick a different question'}
                </button>
              )}
            </>
          )}

          {/* ── Bernard's question — ready to record the answer ─────────── */}
          {ready && topic && (
            <>
              <ProgressDots completed={transcripts.length} />

              <div className="rounded-2xl border-2 border-border bg-card shadow-sm p-6 sm:p-8 mb-6">
                <div className="flex items-center gap-2.5 mb-4">
                  <div className="h-8 w-8 rounded-full bg-primary/10 flex items-center justify-center shrink-0">
                    <MessageCircle className="h-4 w-4 text-primary" />
                  </div>
                  <span className="text-sm font-semibold text-foreground">Bernard asks</span>
                </div>
                <p className="text-lg font-medium text-foreground leading-snug">
                  {currentBernardQ}
                </p>
              </div>

              {error && (
                <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
                  {error}
                </div>
              )}

              <div className="flex flex-col sm:flex-row gap-3">
                <Button className="flex-1" onClick={() => startRecording(transcripts, topicId)}>
                  <Mic className="mr-2 h-4 w-4" />
                  Answer Bernard
                </Button>
                <Button variant="outline" onClick={() => setPhase('done')} className="sm:flex-none">
                  See results
                </Button>
              </div>
            </>
          )}

          {/* ── Results ──────────────────────────────────────────────── */}
          {done && topic && (
            <div>
              <div className="flex items-center gap-2 text-sm font-medium text-primary mb-4">
                <Sparkles className="h-4 w-4" aria-hidden="true" />
                Your interview — captured word for word
              </div>

              <div className="flex flex-col gap-3 mb-6">
                {transcripts.map((text, i) => {
                  const isBernard = i > 0
                  const bq = bernardQuestions[i - 1]
                  return (
                    <div key={i} className="rounded-2xl border border-border bg-card shadow-sm overflow-hidden">
                      <div className={cn(
                        'px-5 py-3 border-b border-border/60 flex items-start gap-2',
                        i === 0 ? topic.bg : 'bg-muted/40'
                      )}>
                        {isBernard ? (
                          <>
                            <MessageCircle className="h-3.5 w-3.5 text-muted-foreground mt-0.5 shrink-0" />
                            <span className="text-xs text-muted-foreground leading-relaxed">{bq}</span>
                          </>
                        ) : (
                          <>
                            <topic.Icon className={cn('h-3.5 w-3.5 mt-0.5 shrink-0', topic.color)} />
                            <span className="text-xs text-muted-foreground leading-relaxed">{topic.question}</span>
                          </>
                        )}
                      </div>
                      <div className="px-5 py-4">
                        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{text}</p>
                      </div>
                    </div>
                  )
                })}
              </div>

              <p className="text-sm text-muted-foreground text-balance mb-6">
                {transcripts.length > 1
                  ? `${transcripts.length} answers, captured word for word. `
                  : 'Captured word for word. '}
                Bernard turns interviews like this into ready-to-post blogs, social posts,
                and newsletters — always in your voice.
              </p>

              <div className="flex flex-col sm:flex-row gap-3">
                <Button asChild className="flex-1">
                  <Link to="/onboard">
                    See what Bernard can do
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

        </div>
      </main>
    </div>
  )
}
