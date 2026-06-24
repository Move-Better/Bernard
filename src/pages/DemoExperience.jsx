import { useState, useRef, useEffect, useCallback } from 'react'
import { Link } from 'react-router-dom'
import {
  ArrowRight, RotateCcw, Sparkles, Lock, ChevronLeft,
  Star, HelpCircle, Lightbulb, Globe, Instagram, Linkedin,
  Mic, Square, Loader2,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { cn } from '@/lib/utils'
import { useDocumentTitle } from '@/lib/useDocumentTitle'

/**
 * DemoExperience — the no-login public demo (/demo/try).
 *
 * Phase 2: sample-first + voice. Flow:
 *   1. Pick one of 3 topic cards
 *   2. Answer via type (textarea) or speak (MediaRecorder → Whisper)
 *      — voice: record → transcribe → auto-generate
 *      — text:  type/paste → "Watch it write"
 *   3. Blog + Instagram + GBP stream in live
 *   4. Done screen with /onboard CTA
 *
 * Nothing is persisted. Scope: .claude/scope-no-login-demo.md
 */

const MAX_SECONDS = 90

const TOPICS = [
  {
    id: 'story',
    Icon: Star,
    label: 'A patient win',
    question: 'Tell me about a patient who finally got the relief they were looking for.',
    hint: 'A recent case, an outcome that surprised you, or someone whose life changed.',
    placeholder: 'e.g. "I had a patient last week who\'d been dealing with sciatica for two years…"',
    color: 'text-amber-600',
    bg: 'bg-amber-50 dark:bg-amber-950/30',
    border: 'border-amber-200 dark:border-amber-800',
    hoverBorder: 'hover:border-amber-400 dark:hover:border-amber-600',
    selectedBorder: 'border-amber-400 dark:border-amber-600',
  },
  {
    id: 'faq',
    Icon: HelpCircle,
    label: 'Your most-asked question',
    question: "What's the question almost every new patient asks you — and what do you tell them?",
    hint: 'The thing you explain so often you could say it in your sleep.',
    placeholder: 'e.g. "Patients always ask whether they need an MRI first. I tell them…"',
    color: 'text-primary',
    bg: 'bg-primary/5 dark:bg-primary/10',
    border: 'border-primary/20 dark:border-primary/30',
    hoverBorder: 'hover:border-primary/40 dark:hover:border-primary/50',
    selectedBorder: 'border-primary/50 dark:border-primary/60',
  },
  {
    id: 'insight',
    Icon: Lightbulb,
    label: 'Something patients get wrong',
    question: "What's one thing you wish every patient understood before their first visit?",
    hint: 'A common misconception, a fear you ease, or a mindset shift that changes outcomes.',
    placeholder: 'e.g. "Most people think rest is the answer. The research says the opposite…"',
    color: 'text-primary',
    bg: 'bg-primary/5 dark:bg-primary/10',
    border: 'border-primary/20 dark:border-primary/30',
    hoverBorder: 'hover:border-primary/40 dark:hover:border-primary/50',
    selectedBorder: 'border-primary/50 dark:border-primary/60',
  },
]

const OUTPUT_SECTIONS = [
  { key: 'blog', label: 'Blog post', Icon: Globe, desc: 'Educational blog, ~200 words' },
  { key: 'instagram', label: 'Instagram caption', Icon: Instagram, desc: 'Caption + hashtags' },
  { key: 'gbp', label: 'Google Business post', Icon: Linkedin, desc: 'Local search visibility' },
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

function parseSections(raw) {
  const result = { blog: null, instagram: null, gbp: null }
  for (const name of ['BLOG', 'INSTAGRAM', 'GBP']) {
    const startTag = `[${name}]`
    const endTag = `[/${name}]`
    const startIdx = raw.indexOf(startTag)
    if (startIdx === -1) continue
    const contentStart = startIdx + startTag.length
    const endIdx = raw.indexOf(endTag, contentStart)
    const content = endIdx === -1
      ? raw.slice(contentStart).trimStart()
      : raw.slice(contentStart, endIdx).trimStart()
    result[name.toLowerCase()] = content
  }
  return result
}

// Module-level sub-components (ESLint static-components rule).

function TopicCard({ topic, onClick }) {
  return (
    <button
      type="button"
      onClick={() => onClick(topic)}
      className={cn(
        'w-full text-left rounded-2xl border-2 p-5 sm:p-6 transition-all duration-150',
        'focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30',
        topic.bg, topic.border, topic.hoverBorder,
        'hover:shadow-sm active:scale-[0.99]'
      )}
    >
      <div className="flex items-start gap-4">
        <div className={cn('mt-0.5 shrink-0', topic.color)}>
          <topic.Icon className="h-5 w-5" />
        </div>
        <div className="min-w-0">
          <div className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-1">
            {topic.label}
          </div>
          <p className="text-base font-medium text-foreground leading-snug">{topic.question}</p>
          <p className="mt-1.5 text-sm text-muted-foreground">{topic.hint}</p>
        </div>
      </div>
    </button>
  )
}

function SectionCard({ section, content, isStreaming }) {
  const isEmpty = content === null
  const hasContent = content !== null && content.length > 0

  return (
    <div className={cn(
      'rounded-2xl border border-border bg-card shadow-sm overflow-hidden transition-opacity duration-300',
      isEmpty && 'opacity-40'
    )}>
      <div className="flex items-center gap-2 px-5 py-3 border-b border-border/60 bg-muted/30">
        <section.Icon className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
        <span className="text-xs font-semibold text-foreground">{section.label}</span>
        <span className="text-xs text-muted-foreground ml-auto">{section.desc}</span>
        {isStreaming && hasContent && (
          <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse ml-1 shrink-0" aria-hidden="true" />
        )}
      </div>
      <div className="px-5 py-4 min-h-[80px]">
        {hasContent ? (
          <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{content}</p>
        ) : (
          <div className="flex items-center gap-2 text-sm text-muted-foreground">
            {isEmpty ? <span>Waiting…</span> : (
              <>
                <span className="h-1.5 w-1.5 rounded-full bg-primary animate-pulse" aria-hidden="true" />
                <span>Writing…</span>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

export default function DemoExperience() {
  useDocumentTitle('Try Bernard — see your words become content')

  // Top-level phase: picking | composing | generating | done
  const [phase, setPhase] = useState('picking')
  const [topicId, setTopicId] = useState(null)
  const [inputMode, setInputMode] = useState('voice') // 'voice' | 'type'
  const [userText, setUserText] = useState('')
  const [rawStream, setRawStream] = useState('')
  const [error, setError] = useState('')

  // Voice recording sub-state: idle | requesting | recording | transcribing
  const [voicePhase, setVoicePhase] = useState('idle')
  const [elapsed, setElapsed] = useState(0)

  const abortRef = useRef(null)
  const recorderRef = useRef(null)
  const recorderErrorRef = useRef(false)
  const chunksRef = useRef([])
  const streamRef = useRef(null)
  const timerRef = useRef(null)
  const startTimeRef = useRef(0)
  const mimeRef = useRef('')

  const topic = TOPICS.find((t) => t.id === topicId) || null
  const sections = parseSections(rawStream)

  // Stop mic tracks and clear the timer on unmount / reset.
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

  // ── Generation ──────────────────────────────────────────────────────────────

  const runGeneration = useCallback(async (text, tId) => {
    setPhase('generating')
    setRawStream('')
    setError('')

    const ctrl = new AbortController()
    abortRef.current = ctrl

    try {
      // eslint-disable-next-line bernard/no-raw-api-fetch -- public unauthenticated demo endpoint; no Bearer token.
      const res = await fetch('/api/demo/generate', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ text, topicId: tId }),
        signal: ctrl.signal,
      })

      if (!res.ok) {
        let msg = 'Generation failed — please try again.'
        if (res.status === 429) msg = "You've hit the demo limit. Try again in a minute."
        else { const d = await res.json().catch(() => null); if (d?.message) msg = d.message }
        setError(msg)
        setPhase('composing')
        return
      }

      const reader = res.body.getReader()
      const decoder = new TextDecoder()
      let buf = ''
      let accumulated = ''

      while (true) {
        const { done, value } = await reader.read()
        if (done) break
        buf += decoder.decode(value, { stream: true })
        const lines = buf.split('\n')
        buf = lines.pop()
        for (const line of lines) {
          if (!line.startsWith('data: ')) continue
          const data = line.slice(6).trim()
          if (data === '[DONE]') break
          let parsed
          try { parsed = JSON.parse(data) } catch { continue }
          if (parsed.type === 'content_block_delta' && parsed.delta?.text) {
            accumulated += parsed.delta.text
            setRawStream(accumulated)
          } else if (parsed.type === 'error') {
            setError(parsed.error?.message || 'Generation failed.')
            break
          }
        }
      }

      setPhase('done')
    } catch (e) {
      if (e?.name === 'AbortError') return
      setError('Something went wrong. Check your connection and try again.')
      setPhase('composing')
    }
  }, [])

  // ── Voice recording ─────────────────────────────────────────────────────────

  const stopRecording = useCallback(() => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const rec = recorderRef.current
    if (rec && rec.state !== 'inactive') rec.stop()
  }, [])

  const transcribeBlob = useCallback(async (blob, mime, currentTopicId) => {
    setVoicePhase('transcribing')
    try {
      // eslint-disable-next-line bernard/no-raw-api-fetch -- public unauthenticated demo endpoint; raw binary audio body.
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
        setVoicePhase('idle')
        return
      }
      const data = await res.json()
      const text = (data?.transcript || '').trim()
      if (!text) {
        setError("We didn't catch any speech — try somewhere quieter.")
        setVoicePhase('idle')
        return
      }
      // Populate textarea (user can see what was heard) then auto-generate.
      setUserText(text)
      setVoicePhase('idle')
      runGeneration(text, currentTopicId)
    } catch {
      setError('Something went wrong. Check your connection and try again.')
      setVoicePhase('idle')
    }
  }, [runGeneration])

  const startRecording = useCallback(async (currentTopicId) => {
    setError('')
    if (typeof navigator === 'undefined' || !navigator.mediaDevices?.getUserMedia) {
      setError("This browser can't record audio. Try Safari or Chrome.")
      return
    }
    setVoicePhase('requesting')
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
          setVoicePhase('idle')
          return
        }
        transcribeBlob(blob, type, currentTopicId)
      }
      rec.onerror = () => {
        recorderErrorRef.current = true
        setError('Recording stopped unexpectedly — try again.')
        if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
        const r = recorderRef.current
        if (r && r.state !== 'inactive') r.stop()
        setVoicePhase('idle')
      }

      rec.start(1000)
      startTimeRef.current = Date.now()
      setElapsed(0)
      setVoicePhase('recording')
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
      setVoicePhase('idle')
    }
  }, [stopTracks, stopRecording, transcribeBlob])

  // ── Navigation ──────────────────────────────────────────────────────────────

  const handleTopicClick = useCallback((t) => {
    setTopicId(t.id)
    setUserText('')
    setError('')
    setVoicePhase('idle')
    setElapsed(0)
    setPhase('composing')
  }, [])

  const reset = useCallback(() => {
    abortRef.current?.abort()
    abortRef.current = null
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
    const rec = recorderRef.current
    if (rec) { rec.onstop = null; if (rec.state !== 'inactive') rec.stop() }
    stopTracks()
    setPhase('picking')
    setTopicId(null)
    setInputMode('voice')
    setUserText('')
    setRawStream('')
    setError('')
    setVoicePhase('idle')
    setElapsed(0)
  }, [stopTracks])

  const handleGenerate = useCallback(() => {
    if (!topic) return
    runGeneration(userText.trim() || topic.question, topicId)
  }, [topic, topicId, userText, runGeneration])

  const handleSwitchMode = useCallback((mode) => {
    // Stop any active recording when switching away from voice.
    if (mode !== 'voice' && (voicePhase === 'recording' || voicePhase === 'requesting')) {
      if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null }
      const rec = recorderRef.current
      if (rec) { rec.onstop = null; if (rec.state !== 'inactive') rec.stop() }
      stopTracks()
      setVoicePhase('idle')
    }
    setError('')
    setInputMode(mode)
  }, [voicePhase, stopTracks])

  const generating = phase === 'generating'
  const done = phase === 'done'
  const remaining = Math.max(0, MAX_SECONDS - elapsed)
  const busy = voicePhase === 'requesting' || voicePhase === 'recording' || voicePhase === 'transcribing'

  return (
    <div className="min-h-screen bg-background text-foreground flex flex-col">
      <header className="flex items-center justify-between px-5 sm:px-8 py-4 border-b border-border/60">
        <Link to="/" className="flex items-center gap-2 font-semibold tracking-tight text-lg">
          <span className="text-foreground">Bernard</span>
        </Link>
        <span className="inline-flex items-center gap-1.5 rounded-full bg-muted px-3 py-1 text-xs font-medium text-muted-foreground">
          <Lock className="h-3 w-3" aria-hidden="true" />
          No login needed
        </span>
      </header>

      <main className="flex-1 flex flex-col items-center justify-start px-5 py-10 sm:py-14">
        <div className="w-full max-w-xl">

          {/* ── Topic picker ─────────────────────────────────────── */}
          {phase === 'picking' && (
            <>
              <div className="text-center mb-8">
                <h1 className="text-3xl sm:text-4xl font-semibold tracking-tight text-balance">
                  Pick a question.<br />
                  <em className="not-italic text-primary">Watch Bernard write.</em>
                </h1>
                <p className="mt-3 text-base text-muted-foreground text-balance">
                  Speak your answer out loud — or type it. Bernard turns it into
                  a blog post, Instagram caption, and Google Business post.
                </p>
              </div>
              <div className="flex flex-col gap-3">
                {TOPICS.map((t) => (
                  <TopicCard key={t.id} topic={t} onClick={handleTopicClick} />
                ))}
              </div>
              <p className="mt-6 text-center text-xs text-muted-foreground">
                Nothing is saved. Your recording or text is used only for this generation.
              </p>
            </>
          )}

          {/* ── Compose ──────────────────────────────────────────── */}
          {phase === 'composing' && topic && (
            <>
              <button
                type="button"
                onClick={reset}
                className="flex items-center gap-1 text-sm text-muted-foreground hover:text-foreground transition mb-6"
              >
                <ChevronLeft className="h-4 w-4" />
                Pick a different question
              </button>

              {/* Topic callout */}
              <div className={cn('rounded-2xl border-2 p-5 mb-5', topic.bg, topic.selectedBorder)}>
                <div className="flex items-center gap-2 mb-2">
                  <topic.Icon className={cn('h-4 w-4', topic.color)} aria-hidden="true" />
                  <span className="text-xs font-semibold uppercase tracking-wider text-muted-foreground">{topic.label}</span>
                </div>
                <p className="text-base font-medium text-foreground leading-snug">{topic.question}</p>
              </div>

              {/* Input mode tabs */}
              <div className="flex rounded-xl border border-border overflow-hidden mb-5">
                <button
                  type="button"
                  onClick={() => handleSwitchMode('voice')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition',
                    inputMode === 'voice'
                      ? 'bg-card text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  )}
                >
                  <Mic className="h-3.5 w-3.5" aria-hidden="true" />
                  Speak
                </button>
                <button
                  type="button"
                  onClick={() => handleSwitchMode('type')}
                  className={cn(
                    'flex-1 flex items-center justify-center gap-1.5 py-2.5 text-sm font-medium transition border-l border-border',
                    inputMode === 'type'
                      ? 'bg-card text-foreground'
                      : 'text-muted-foreground hover:text-foreground hover:bg-muted/30'
                  )}
                >
                  Type
                </button>
              </div>

              {/* ── Voice input ── */}
              {inputMode === 'voice' && (
                <div className="mb-5 rounded-2xl border border-border bg-card shadow-sm p-8 flex flex-col items-center text-center min-h-[200px] justify-center">

                  {voicePhase === 'idle' && (
                    <>
                      <button
                        type="button"
                        onClick={() => startRecording(topicId)}
                        className={cn(
                          'h-20 w-20 rounded-full border-2 border-primary/30 bg-primary/10 flex items-center justify-center mb-4',
                          'hover:bg-primary/20 hover:border-primary/50 active:scale-95 transition-all duration-150',
                          'focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/30'
                        )}
                        aria-label="Start recording"
                      >
                        <Mic className="h-8 w-8 text-primary" aria-hidden="true" />
                      </button>
                      <p className="text-sm font-medium text-foreground">Tap to speak your answer</p>
                      <p className="mt-1 text-xs text-muted-foreground">Up to 90 seconds</p>
                    </>
                  )}

                  {voicePhase === 'requesting' && (
                    <>
                      <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" aria-hidden="true" />
                      <p className="text-sm font-medium text-foreground">Opening your microphone…</p>
                      <p className="mt-1 text-xs text-muted-foreground">Allow access when prompted</p>
                    </>
                  )}

                  {voicePhase === 'recording' && (
                    <>
                      <div className="relative mb-4">
                        {/* Outer pulse ring */}
                        <div className="absolute inset-0 rounded-full bg-destructive/20 animate-ping" />
                        <button
                          type="button"
                          onClick={stopRecording}
                          className={cn(
                            'relative h-20 w-20 rounded-full border-2 border-destructive/60 bg-destructive/15 flex items-center justify-center',
                            'hover:bg-destructive/25 active:scale-95 transition-all duration-150',
                            'focus:outline-none focus-visible:ring-4 focus-visible:ring-destructive/30'
                          )}
                          aria-label="Stop recording"
                        >
                          <Square className="h-7 w-7 text-destructive fill-destructive" aria-hidden="true" />
                        </button>
                      </div>
                      <p className="text-sm font-semibold text-foreground tabular-nums">{formatTime(elapsed)}</p>
                      <p className="mt-0.5 text-xs text-muted-foreground">
                        Tap to stop · {formatTime(remaining)} remaining
                      </p>
                    </>
                  )}

                  {voicePhase === 'transcribing' && (
                    <>
                      <Loader2 className="h-10 w-10 text-primary animate-spin mb-4" aria-hidden="true" />
                      <p className="text-sm font-medium text-foreground">Transcribing your answer…</p>
                      <p className="mt-1 text-xs text-muted-foreground">Then Bernard writes — no click needed</p>
                    </>
                  )}
                </div>
              )}

              {/* ── Text input ── */}
              {inputMode === 'type' && (
                <div className="mb-5">
                  <label htmlFor="user-answer" className="block text-sm font-medium text-foreground mb-2">
                    Your answer <span className="text-muted-foreground font-normal">(optional — type or paste, or leave blank)</span>
                  </label>
                  <textarea
                    id="user-answer"
                    value={userText}
                    onChange={(e) => setUserText(e.target.value)}
                    placeholder={topic.placeholder}
                    rows={5}
                    maxLength={2000}
                    className="w-full rounded-xl border border-border bg-card px-4 py-3 text-sm text-foreground placeholder:text-muted-foreground focus:outline-none focus:ring-2 focus:ring-primary/30 resize-none"
                  />
                  {userText.length > 1800 && (
                    <p className="mt-1 text-xs text-muted-foreground text-right">{userText.length}/2000</p>
                  )}
                </div>
              )}

              {error && (
                <div className="mb-4 text-sm text-destructive bg-destructive/10 border border-destructive/20 rounded-lg p-3 text-center">
                  {error}
                </div>
              )}

              {/* Generate button shown only in text mode (voice auto-generates after transcription) */}
              {inputMode === 'type' && (
                <>
                  <Button className="w-full" size="lg" onClick={handleGenerate} disabled={busy}>
                    <Sparkles className="mr-2 h-4 w-4" aria-hidden="true" />
                    Watch it write
                  </Button>
                  <p className="mt-3 text-center text-xs text-muted-foreground">
                    Generates a blog post, Instagram caption, and Google Business post — in seconds.
                  </p>
                </>
              )}
            </>
          )}

          {/* ── Generating + Done ─────────────────────────────────── */}
          {(generating || done) && topic && (
            <>
              <div className="flex items-center justify-between mb-6">
                <div className="flex items-center gap-2 text-sm font-medium text-primary">
                  <Sparkles className="h-4 w-4" aria-hidden="true" />
                  {done ? 'Your content is ready' : 'Bernard is writing…'}
                </div>
                {done && (
                  <button
                    type="button"
                    onClick={reset}
                    className="flex items-center gap-1 text-xs text-muted-foreground hover:text-foreground transition"
                  >
                    <RotateCcw className="h-3.5 w-3.5" />
                    Try another
                  </button>
                )}
              </div>

              <div className={cn('rounded-xl border p-4 mb-6 flex items-start gap-3', topic.bg, topic.border)}>
                <topic.Icon className={cn('h-4 w-4 mt-0.5 shrink-0', topic.color)} aria-hidden="true" />
                <div>
                  <p className="text-xs font-semibold uppercase tracking-wider text-muted-foreground mb-0.5">{topic.label}</p>
                  <p className="text-sm text-foreground leading-relaxed">
                    {userText.trim() || topic.question}
                  </p>
                </div>
              </div>

              <div className="flex flex-col gap-4 mb-6">
                {OUTPUT_SECTIONS.map((sec) => (
                  <SectionCard
                    key={sec.key}
                    section={sec}
                    content={sections[sec.key]}
                    isStreaming={generating}
                  />
                ))}
              </div>

              {done && (
                <>
                  <p className="text-sm text-muted-foreground text-balance mb-6">
                    Bernard turns your words into ready-to-publish content — blog, social, and local search —
                    always in your voice, every time.
                  </p>
                  <div className="flex flex-col sm:flex-row gap-3">
                    <Button asChild className="flex-1" size="lg">
                      <Link to="/onboard">
                        Claim your spot
                        <ArrowRight className="ml-1.5 h-4 w-4" />
                      </Link>
                    </Button>
                    <Button variant="outline" onClick={reset} className="flex-1 sm:flex-none">
                      <RotateCcw className="mr-1.5 h-4 w-4" />
                      Try another
                    </Button>
                  </div>
                </>
              )}
            </>
          )}

        </div>
      </main>
    </div>
  )
}
