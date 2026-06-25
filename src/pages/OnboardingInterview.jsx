// One-time onboarding interview the founder runs after the signup wizard
// creates the workspace. P2 deliverable: text-only chat using the
// getOnboardingInterviewSystemPrompt prompt. P2b adds the full voice loop
// (mic + TTS + iOS gesture priming) so the page is the proof-of-concept
// for how Bernard actually works.
//
// Founder-only — gated by the API route's requireRole(['admin']) check.
// Workspace-scoped via workspaceContext on the server.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useWakeLock } from '../hooks/useWakeLock'
import {
  Loader2, Send, CheckCircle2, AlertCircle, Sparkles, FlaskConical,
  Mic, MicOff, Volume2, RefreshCw, Keyboard,
  Clock, PauseCircle, MessagesSquare, Lightbulb, Coffee,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent } from '@/components/ui/card'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { useUserRole } from '@/lib/useUserRole'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import { apiFetch } from '@/lib/api'
import { streamMessage } from '@/lib/claude'
import { getOnboardingInterviewSystemPrompt } from '@/lib/prompts'
import MicCheck from '@/components/MicCheck'
import { createTtsPlayer, primeAudioPlayback, onAudioPlaybackFailure } from '@/lib/tts'

const COMPLETE_TOKEN = 'INTERVIEW_COMPLETE'

// Cap consecutive silent SpeechRecognition auto-resumes within a single user
// turn. Without a cap, a stuck mic can spin forever (especially on iOS).
const RESTART_CAP = 30

// End-of-turn phrases — matched at the end of a final transcript so the user
// can say "done" / "that's all" instead of tapping the mic.
const STOP_PHRASES = [
  "that's all",
  "that's it",
  "i'm done",
  "i am done",
  "send it",
  "send that",
  "submit",
  "done",
]

// The five interview areas used for the stage progress rail.
const STAGE_NAMES = ['Origin', 'Who you serve', 'Philosophy', 'Voice & tone', 'Topic seeds']

function detectAndStripStopPhrase(transcript) {
  const normalized = transcript.trimEnd().toLowerCase()
  for (const phrase of STOP_PHRASES) {
    if (normalized.endsWith(phrase)) {
      const stripped = transcript.trimEnd()
      const cleaned = stripped.slice(0, stripped.length - phrase.length).trimEnd()
      return cleaned.length > 0 ? cleaned : ''
    }
  }
  return null
}

// Is a stream failure worth auto-retrying? Auth (401/403) and rate-limit (429)
// won't recover on retry; everything else (gateway blips, 5xx, timeouts) is
// transient and safe to re-run the turn for.
function isTransientStreamError(e) {
  const status = e?.status
  if (status === 401 || status === 403 || status === 429) return false
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  // 529 = AI gateway overloaded (transient); other 5xx may include structural errors
  // (invalid model, quota hard-stop) but we can't distinguish without parsing the body.
  // Retry once is acceptable for structural errors — the 3-retry max is the real cap.
  return true
}

// Detect and strip the completion marker from a streaming assistant message.
function detectComplete(raw) {
  if (!raw.includes(COMPLETE_TOKEN)) return { text: raw, complete: false }
  const cleaned = raw.replace(new RegExp(`\\s*${COMPLETE_TOKEN}\\s*`, 'g'), '').trim()
  return { text: cleaned, complete: true }
}

// Detect and strip the [STAGE:n] UI signal Bernard emits at the start of each
// response. Strips before display/speech; drives the 5-stage progress rail.
function detectStageTag(raw) {
  const match = raw.match(/\[STAGE:([1-5])\]/)
  if (!match) return { text: raw, stage: null }
  const stage = parseInt(match[1], 10)
  const cleaned = raw.replace(/\[STAGE:[1-5]\]\s*/g, '')
  return { text: cleaned, stage }
}

export default function OnboardingInterview() {
  useDocumentTitle('Onboarding interview')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const { user } = useUser()
  const { role } = useUserRole()

  // ── Interview state ──────────────────────────────────────────────────────
  const [interview, setInterview] = useState(null)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [completed, setCompleted] = useState(false)
  // Keep the screen awake while the onboarding interview is live.
  useWakeLock(!completed)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [synthesisStatus, setSynthesisStatus] = useState('idle')
  const [synthesisError, setSynthesisError] = useState(null)
  const [synthesisCounts, setSynthesisCounts] = useState(null)
  const [synthesisResult, setSynthesisResult] = useState(null)

  // currentStage (1–5) tracks which interview area Bernard is in.
  // Driven by [STAGE:n] tokens emitted by the model; stripped before display.
  const [currentStage, setCurrentStage] = useState(1)

  // retryCount re-triggers the bootstrap effect for in-place error recovery.
  const [retryCount, setRetryCount] = useState(0)

  // ── Voice state ──────────────────────────────────────────────────────────
  const hasSpeechRecognition = useMemo(() => (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  ), [])

  // primerSeen gates the "what to expect" screen before MicCheck. Fresh only.
  const [micCheckPassed, setMicCheckPassed] = useState(false)
  const [primerSeen, setPrimerSeen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [typedAnswer, setTypedAnswer] = useState('')
  const [audioInterrupted, setAudioInterrupted] = useState(false)

  // Voice refs — SpeechRecognition machinery
  const ttsRef = useRef(null)
  const recognitionRef = useRef(null)
  const userAnswerActiveRef = useRef(false)
  const restartCountRef = useRef(0)
  const restartTimerRef = useRef(null)
  const finalTranscriptRef = useRef('')
  const transcriptRef = useRef('')
  const autoListenAbortRetryRef = useRef(0)
  const autoListenRef = useRef(false)
  const messagesRef = useRef([])

  // Waveform visualization refs — parallel getUserMedia stream for mic level.
  // SpeechRecognition doesn't expose audio data; second stream is viz-only.
  const waveformRef = useRef(null)
  const analyserRef = useRef(null)
  const animFrameRef = useRef(null)
  const vizStreamRef = useRef(null)
  const vizCtxRef = useRef(null)

  // Bootstrap seed-once guard — prevents duplicate POST on concurrent renders.
  const seededRef = useRef(false)
  // Kickoff guard — prevents the first-message effect from retrying on error.
  const kickedOffRef = useRef(false)
  // Last assistant turn input — lets the inline "Try again" re-run the turn.
  const lastTurnRef = useRef(null)

  const founderName = (user?.fullName || user?.firstName || '').trim() || 'there'

  // Dry-run mode — append ?dryRun=1 to the URL.
  const [searchParams] = useSearchParams()
  const dryRun = useMemo(() => {
    const v = searchParams.get('dryRun')
    return v === '1' || v === 'true'
  }, [searchParams])

  useEffect(() => { messagesRef.current = messages }, [messages])

  // Lazy-create the TTS player. Reusing one instance keeps iOS gesture priming.
  const getTts = useCallback(() => {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }, [])

  // ── Bootstrap — fetch existing or create new interview row ───────────────
  // retryCount included so in-place retry re-triggers without page reload.
  useEffect(() => {
    if (!workspace?.id || !user?.id || seededRef.current) return
    seededRef.current = true

    let cancelled = false
    ;(async () => {
      try {
        let row = await apiFetch('/api/onboarding/interview')
        if (!row) {
          row = await apiFetch('/api/onboarding/interview', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ founderName }),
          })
        }
        if (cancelled) return
        setInterview(row)
        setMessages(Array.isArray(row?.messages) ? row.messages : [])
        if (row?.status === 'completed' || row?.status === 'synthesized') {
          setCompleted(true)
          setPrimerSeen(true)
          setMicCheckPassed(true)
        }
        if (row?.status === 'synthesized' && !dryRun) {
          setSynthesisStatus('already')
        }
        if (Array.isArray(row?.messages) && row.messages.length > 0) {
          setPrimerSeen(true)
          setMicCheckPassed(true)
        }
      } catch (e) {
        if (!cancelled) {
          seededRef.current = false
          setError(e?.message || 'Failed to start interview')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [workspace?.id, user?.id, founderName, dryRun, retryCount])

  // ── Audio failure subscription ───────────────────────────────────────────
  useEffect(() => {
    const unsubscribe = onAudioPlaybackFailure(() => setAudioInterrupted(true))
    return unsubscribe
  }, [])

  // ── Persist messages + status to the server ──────────────────────────────
  const interviewId = interview?.id
  const persist = useCallback(async (next, statusUpdate) => {
    if (!interviewId) return
    try {
      const patch = { messages: next }
      if (statusUpdate) {
        patch.status = statusUpdate
        if (statusUpdate === 'completed') patch.completedAt = new Date().toISOString()
      }
      await apiFetch(`/api/onboarding/interview?id=${encodeURIComponent(interviewId)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(patch),
      })
    } catch (e) {
      console.error('[OnboardingInterview] persist failed', e)
    }
  }, [interviewId])

  // ── TTS: speak the assistant turn ────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!text) return
    setIsSpeaking(true)
    getTts().speak(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false)
        autoListenRef.current = true
      },
      onError: () => setIsSpeaking(false),
    })
  }, [getTts])

  // Re-prime + replay the last assistant message after an audio interruption.
  const handleRestoreAudio = useCallback(() => {
    primeAudioPlayback()
    setAudioInterrupted(false)
    const lastAssistant = [...messagesRef.current].reverse().find((m) => m.role === 'assistant')
    if (lastAssistant && !completed) {
      speak(lastAssistant.content)
    }
  }, [completed, speak])

  // ── Stream the next assistant turn ───────────────────────────────────────
  const runAssistantTurn = useCallback(async (currentMessages, { isFirstMessage }) => {
    if (!workspace) return
    lastTurnRef.current = { currentMessages, isFirstMessage }
    setStreaming(true)
    setStreamingText('')
    setError(null)

    const systemPrompt = getOnboardingInterviewSystemPrompt(workspace, founderName, { isFirstMessage })

    const streamInput = currentMessages.length === 0
      ? [{ role: 'user', content: 'Please begin the onboarding interview.' }]
      : currentMessages

    // Auto-retry transient blips up to 3 times before surfacing to the user.
    let buffer = ''
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      buffer = ''
      try {
        for await (const delta of streamMessage(streamInput, systemPrompt, { model: 'claude-sonnet-4-6', maxOutputTokens: 1024 })) {
          buffer += delta
          const { text: noComplete } = detectComplete(buffer)
          const { text, stage } = detectStageTag(noComplete)
          if (stage) setCurrentStage(stage)
          setStreamingText(text)
        }
        break // success
      } catch (e) {
        const retriable = isTransientStreamError(e)
        if (retriable && attempt < MAX_ATTEMPTS) {
          setStreamingText('')
          await new Promise((r) => { setTimeout(r, attempt === 1 ? 600 : 1500) })
          continue
        }
        setStreaming(false)
        setStreamingText('')
        setError(
          retriable
            ? 'The interviewer lost connection for a moment. Tap "Try again" — your answers are saved.'
            : (e?.message || 'Stream failed'),
        )
        if (e?.status === 401 || e?.status === 403) setError(e?.message || 'Session expired — reload to continue.')
        return
      }
    }

    const { text: noComplete, complete: hasCompleteMarker } = detectComplete(buffer)
    const { text: withoutStage, stage: finalStage } = detectStageTag(noComplete)
    if (finalStage) setCurrentStage(finalStage)
    const finalText = withoutStage.trim()

    if (!finalText) {
      setStreaming(false)
      setStreamingText('')
      setError('Empty response from interviewer — try again.')
      return
    }

    const nextMessages = [...currentMessages, { role: 'assistant', content: finalText }]
    setMessages(nextMessages)
    setStreamingText('')
    setStreaming(false)

    if (hasCompleteMarker) {
      setCompleted(true)
      await persist(nextMessages, 'completed')
    } else {
      await persist(nextMessages)
      speak(finalText)
    }
  }, [workspace, founderName, persist, speak])

  // ── Kickoff once mic check has passed + interview row loaded ─────────────
  useEffect(() => {
    if (loading || completed || streaming || !interview || !micCheckPassed) return
    if (messages.length > 0) return
    if (kickedOffRef.current) return
    kickedOffRef.current = true
    runAssistantTurn([], { isFirstMessage: true })
  }, [loading, completed, streaming, interview, micCheckPassed, messages.length, runAssistantTurn])

  // ── Waveform visualization via Web Audio ─────────────────────────────────
  // Parallel getUserMedia stream for level data. Falls back to sine idle
  // breathing so the waveform is always visibly moving, never "glitched."
  useEffect(() => {
    if (!hasSpeechRecognition || !isListening) {
      cancelAnimationFrame(animFrameRef.current)
      if (vizStreamRef.current) {
        vizStreamRef.current.getTracks().forEach(t => t.stop())
        vizStreamRef.current = null
      }
      if (vizCtxRef.current) {
        vizCtxRef.current.close().catch(() => {})
        vizCtxRef.current = null
      }
      analyserRef.current = null
      if (waveformRef.current) {
        Array.from(waveformRef.current.children).forEach(bar => {
          bar.style.transform = ''
        })
      }
      return
    }

    let rafId
    function draw() {
      rafId = requestAnimationFrame(draw)
      animFrameRef.current = rafId
      const bars = waveformRef.current ? Array.from(waveformRef.current.children) : []
      if (!bars.length) return
      if (analyserRef.current) {
        const data = new Uint8Array(analyserRef.current.frequencyBinCount)
        analyserRef.current.getByteFrequencyData(data)
        bars.forEach((bar, i) => {
          const idx = Math.floor((i / bars.length) * data.length)
          const val = data[idx] / 255
          bar.style.transform = `scaleY(${Math.max(0.12, val * 0.9 + 0.08)})`
        })
      } else {
        // Sine idle breathing — visible and alive during silence
        const t = Date.now() / 1000
        bars.forEach((bar, i) => {
          const s = 0.14 + 0.28 * (0.5 + 0.5 * Math.sin(t * 1.3 + i * 0.48))
          bar.style.transform = `scaleY(${s})`
        })
      }
    }
    draw()

    let active = true
    ;(async () => {
      try {
        const stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false })
        if (!active) { stream.getTracks().forEach(t => t.stop()); return }
        vizStreamRef.current = stream
        const ctx = new AudioContext()
        vizCtxRef.current = ctx
        const source = ctx.createMediaStreamSource(stream)
        const analyser = ctx.createAnalyser()
        analyser.fftSize = 64
        source.connect(analyser)
        analyserRef.current = analyser
      } catch {
        // getUserMedia denied — sine idle continues
      }
    })()

    return () => {
      active = false
      cancelAnimationFrame(rafId)
    }
  }, [hasSpeechRecognition, isListening])

  // ── SpeechRecognition: start / stop ──────────────────────────────────────
  function startListening({ preserveTranscript = false } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return
    if (isListening) return

    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    setIsSpeaking(false)

    if (!preserveTranscript) {
      setTranscript('')
      transcriptRef.current = ''
      finalTranscriptRef.current = ''
      restartCountRef.current = 0
      userAnswerActiveRef.current = true
    }

    const recognition = new SR()
    recognition.continuous = true
    recognition.interimResults = true
    recognition.lang = 'en-US'

    recognition.onresult = (event) => {
      let gotFinal = false
      for (let i = event.resultIndex; i < event.results.length; i++) {
        if (event.results[i].isFinal) {
          finalTranscriptRef.current += event.results[i][0].transcript + ' '
          gotFinal = true
        }
      }
      const interim = event.results[event.results.length - 1].isFinal
        ? ''
        : event.results[event.results.length - 1][0].transcript
      const display = (finalTranscriptRef.current + interim).trim()
      setTranscript(display)
      transcriptRef.current = finalTranscriptRef.current.trim()

      if (gotFinal) {
        const cleaned = detectAndStripStopPhrase(finalTranscriptRef.current)
        if (cleaned !== null) {
          userAnswerActiveRef.current = false
          clearTimeout(restartTimerRef.current)
          finalTranscriptRef.current = cleaned
          transcriptRef.current = cleaned.trim()
          setTranscript(cleaned.trim())
          recognitionRef.current?.stop()
        }
      }
    }

    function maybeAutoResume(delayMs) {
      if (!userAnswerActiveRef.current) return false
      if (completed || streaming) return false
      if (restartCountRef.current >= RESTART_CAP) {
        userAnswerActiveRef.current = false
        return false
      }
      restartCountRef.current += 1
      clearTimeout(restartTimerRef.current)
      restartTimerRef.current = setTimeout(() => {
        if (userAnswerActiveRef.current && !completed) {
          startListening({ preserveTranscript: true })
        }
      }, delayMs)
      return true
    }

    recognition.onend = () => {
      if (maybeAutoResume(200)) return
      setIsListening(false)
    }

    recognition.onerror = (e) => {
      if (e.error === 'no-speech') {
        if (maybeAutoResume(200)) return
        setIsListening(false)
        return
      }
      if (e.error === 'aborted') {
        setIsListening(false)
        if (autoListenAbortRetryRef.current < 1 && !completed && !streaming && !isSpeaking) {
          autoListenAbortRetryRef.current += 1
          setTimeout(() => {
            if (!completed && !isListening) startListening()
          }, 1500)
        }
        return
      }
      if (e.error === 'not-allowed' || e.error === 'service-not-allowed') {
        userAnswerActiveRef.current = false
        setIsListening(false)
        setError('Microphone permission was denied. You can type your answer instead.')
        return
      }
      userAnswerActiveRef.current = false
      setIsListening(false)
      setError(`Microphone trouble (${e.error}). Tap mic to retry or type your answer instead.`)
    }

    recognitionRef.current = recognition
    try {
      recognition.start()
      setIsListening(true)
      autoListenAbortRetryRef.current = 0
    } catch {
      setIsListening(false)
    }
  }

  function stopListening() {
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    recognitionRef.current?.stop()
  }

  // ── submitUserText — shared path for voice + typed ──────────────────────
  const submitUserText = useCallback(async (rawText) => {
    const text = (rawText || '').trim()
    if (!text || streaming || completed) return

    setTranscript('')
    transcriptRef.current = ''
    setTypedAnswer('')

    const next = [...messages, { role: 'user', content: text }]
    setMessages(next)
    await runAssistantTurn(next, { isFirstMessage: false })
  }, [streaming, completed, messages, runAssistantTurn])

  // ── Finish — explicit "I'm done" button ──────────────────────────────────
  const MIN_TURNS_TO_FINISH = 6
  const userTurnCount = messages.filter((m) => m.role === 'user').length
  const canFinish = userTurnCount >= MIN_TURNS_TO_FINISH
  const finishHelper = canFinish
    ? null
    : `${MIN_TURNS_TO_FINISH - userTurnCount} more answer${MIN_TURNS_TO_FINISH - userTurnCount === 1 ? '' : 's'} to unlock Finish`

  const handleFinish = useCallback(async () => {
    if (completed || streaming || !canFinish) return
    try { ttsRef.current?.cancel() } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognitionRef.current?.stop() } catch { /* ignore */ }

    setIsSpeaking(false)
    setIsListening(false)
    setCompleted(true)
    await persist(messages, 'completed')
  }, [completed, streaming, canFinish, messages, persist])

  // ── Pause — save progress and come back later ────────────────────────────
  const handlePause = useCallback(async () => {
    try { ttsRef.current?.cancel() } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
    setIsSpeaking(false)
    setIsListening(false)
    if (messages.length > 0) await persist(messages)
    navigate('/')
  }, [messages, persist, navigate])

  // Auto-listen after TTS playback ends — 700ms gives iOS time to release
  // the audio session before the mic engine tries to claim it.
  useEffect(() => {
    if (!hasSpeechRecognition) return
    if (!isSpeaking && autoListenRef.current && !streaming && !completed) {
      autoListenRef.current = false
      const timer = setTimeout(() => startListening(), 700)
      return () => clearTimeout(timer)
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSpeechRecognition, isSpeaking, streaming, completed])

  // Auto-submit when isListening flips false with captured text.
  useEffect(() => {
    if (isListening) return
    if (!transcriptRef.current.trim()) return
    submitUserText(transcriptRef.current)
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [isListening])

  // ── Synthesis ────────────────────────────────────────────────────────────
  const runSynthesis = useCallback(async () => {
    if (!interviewId) return
    setSynthesisStatus('running')
    setSynthesisError(null)
    setSynthesisResult(null)
    try {
      const result = await apiFetch('/api/onboarding/synthesize', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ id: interviewId, founderName, dryRun }),
      })
      setSynthesisCounts(result?.counts || null)
      if (dryRun && result?.synthesisResult) {
        setSynthesisResult(result.synthesisResult)
      }
      setSynthesisStatus('success')
    } catch (e) {
      console.error('[OnboardingInterview] synthesis failed', e)
      setSynthesisError(e?.message || 'Synthesis failed')
      setSynthesisStatus('error')
    }
  }, [interviewId, founderName, dryRun])

  useEffect(() => {
    if (!completed || !interviewId) return
    if (synthesisStatus !== 'idle') return
    runSynthesis()
  }, [completed, interviewId, synthesisStatus, runSynthesis])

  // Stop TTS / mic on unmount.
  useEffect(() => () => {
    ttsRef.current?.cancel()
    window.speechSynthesis?.cancel()
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognitionRef.current?.stop() } catch { /* ignore */ }
  }, [])

  // ── Render guards ────────────────────────────────────────────────────────

  if (role && role !== 'admin') {
    return (
      <div className="px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-2">
            <AlertCircle className="h-8 w-8 mx-auto text-muted-foreground" />
            <p className="text-sm text-muted-foreground">
              The onboarding interview is only available to workspace admins.
            </p>
            <Button variant="outline" onClick={() => navigate('/')}>Back to Home</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  if (loading) {
    return (
      <div className="px-4 py-12 flex items-center justify-center" role="status">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading…</span>
      </div>
    )
  }

  // In-place error recovery — no window.location.reload().
  if (error && messages.length === 0) {
    return (
      <div className="px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm">{error}</p>
            <Button onClick={() => {
              setError(null)
              setLoading(true)
              seededRef.current = false
              setRetryCount(c => c + 1)
            }}>
              Try again
            </Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Primer gate — "what to expect" before the audio test. Fresh interviews only.
  if (!primerSeen) {
    return <InterviewPrimer workspace={workspace} onContinue={() => setPrimerSeen(true)} />
  }

  // MicCheck gate — pre-interview audio test. Resumed sessions skip it.
  if (!micCheckPassed) {
    return <MicCheck onContinue={() => setMicCheckPassed(true)} />
  }

  // ── Derived display values ────────────────────────────────────────────────
  const lastAssistantIdx = messages.reduce((acc, m, i) => m.role === 'assistant' ? i : acc, -1)
  const currentQuestion = lastAssistantIdx >= 0 ? messages[lastAssistantIdx].content : null
  const priorMessages = messages.filter((_, i) => i !== lastAssistantIdx)
  const userAnswerCount = messages.filter(m => m.role === 'user').length
  const interviewerName = workspace?.interviewer_name || 'Bernard'
  const focusText = streaming ? (streamingText || null) : currentQuestion

  // ── Main UI ──────────────────────────────────────────────────────────────
  return (
    <div className="px-4 py-5 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
      {dryRun && (
        <div className="mb-3 rounded-lg border border-warning/40 bg-warning/10 px-3 py-2 flex items-center gap-2 text-sm">
          <FlaskConical className="h-4 w-4 text-warning shrink-0" />
          <span>
            <span className="font-semibold">Dry-run mode.</span>{' '}
            Synthesis will run end-to-end and show you the JSON output, but{' '}
            <span className="font-medium">nothing will be written</span> to your
            workspace, voice phrases, or interview status. Remove
            {' '}<code className="font-mono text-xs">?dryRun=1</code>{' '}from the URL to run for real.
          </span>
        </div>
      )}

      {completed ? (
        <SynthesisStateCard
          status={synthesisStatus}
          error={synthesisError}
          counts={synthesisCounts}
          result={synthesisResult}
          dryRun={dryRun}
          onRetry={runSynthesis}
          onHome={() => navigate('/')}
        />
      ) : (
        <>
          {/* ── 5-stage progress rail ──────────────────────────────────── */}
          <div className="mb-4">
            <div className="flex items-center justify-between mb-2.5">
              <h1 className="text-sm font-semibold flex items-center gap-1.5">
                <Sparkles className="h-4 w-4 text-primary" />
                Tell Bernard about {workspace?.display_name || 'your practice'}
              </h1>
              <span className="text-xs text-muted-foreground">~15 min</span>
            </div>
            <div className="flex items-end gap-1.5">
              {STAGE_NAMES.map((name, i) => {
                const n = i + 1
                const done = n < currentStage
                const active = n === currentStage
                return (
                  <div key={n} className="flex-1 flex flex-col items-center gap-1 min-w-0">
                    <div
                      className="h-1.5 w-full rounded-full"
                      style={{
                        background: done
                          ? 'hsl(var(--primary))'
                          : active
                          ? 'linear-gradient(90deg, hsl(var(--primary)) 60%, hsl(var(--muted)) 60%)'
                          : 'hsl(var(--muted))',
                      }}
                    />
                    <span
                      className={`text-3xs truncate w-full text-center ${
                        active ? 'text-primary font-medium' : 'text-muted-foreground'
                      }`}
                    >
                      {name}
                    </span>
                  </div>
                )
              })}
            </div>
            <p className="mt-1.5 text-xs text-muted-foreground">
              <span className="font-medium text-primary">
                Stage {currentStage} of 5 · {STAGE_NAMES[currentStage - 1]}
              </span>
              {userAnswerCount > 0 && ` — ${userAnswerCount} answer${userAnswerCount === 1 ? '' : 's'} so far`}
            </p>
          </div>

          {/* ── Collapsible: conversation so far ──────────────────────── */}
          {priorMessages.length > 0 && (
            <details className="mb-3 rounded-xl border border-border bg-card text-sm">
              <summary className="cursor-pointer select-none px-4 py-2.5 font-medium text-muted-foreground flex items-center gap-2 list-none [&::-webkit-details-marker]:hidden">
                <RefreshCw className="h-3.5 w-3.5 shrink-0" />
                Conversation so far ({userAnswerCount} answer{userAnswerCount === 1 ? '' : 's'}) — tap to review
              </summary>
              <div className="px-4 pb-3 pt-1 space-y-2 max-h-56 overflow-y-auto">
                {priorMessages.map((m, i) => (
                  <div key={i}>
                    <span className={`font-medium ${m.role === 'user' ? 'text-primary' : 'text-muted-foreground'}`}>
                      {m.role === 'user' ? 'You' : interviewerName}:
                    </span>{' '}
                    <span className={`line-clamp-2 ${m.role === 'user' ? 'text-foreground' : 'text-muted-foreground'}`}>
                      {m.content}
                    </span>
                  </div>
                ))}
              </div>
            </details>
          )}

          {/* ── Focused current question card ──────────────────────────── */}
          <div className="flex-1 flex flex-col justify-center py-3">
            <div className="rounded-2xl border border-border bg-card shadow-sm px-6 py-7">
              {/* Turn tag */}
              <div className="flex justify-center mb-4">
                {streaming && !streamingText ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    {interviewerName} is thinking…
                  </span>
                ) : (streaming && streamingText) || isSpeaking ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-info/10 text-info">
                    <Volume2 className="h-3.5 w-3.5" />
                    {interviewerName} is asking
                  </span>
                ) : isListening ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground">
                    <Mic className="h-3.5 w-3.5" />
                    Your turn
                  </span>
                ) : focusText ? (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-accent text-accent-foreground">
                    <Mic className="h-3.5 w-3.5" />
                    Tap mic to answer
                  </span>
                ) : (
                  <span className="inline-flex items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium bg-muted text-muted-foreground">
                    <Loader2 className="h-3.5 w-3.5 animate-spin" />
                    Starting…
                  </span>
                )}
              </div>

              {/* Question text */}
              {streaming && !streamingText ? (
                <div className="flex justify-center py-4">
                  <div className="flex items-center gap-1.5">
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '0.2s' }} />
                    <span className="h-2 w-2 rounded-full bg-muted-foreground/40 animate-pulse" style={{ animationDelay: '0.4s' }} />
                  </div>
                </div>
              ) : (
                <p className="text-lg leading-relaxed font-medium text-center text-foreground">
                  {focusText || (messages.length === 0 ? 'Starting your interview…' : '')}
                  {streaming && streamingText && (
                    <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-primary animate-pulse" />
                  )}
                </p>
              )}

              {/* Live transcript builds inside the card as the user speaks */}
              {isListening && transcript && (
                <div
                  aria-live="polite"
                  className="mt-5 rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80 italic min-h-[48px]"
                >
                  &ldquo;{transcript}&rdquo;
                  <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-primary/60 animate-pulse" />
                </div>
              )}
            </div>
          </div>

          {/* ── Audio interrupted banner ─────────────────────────────── */}
          {audioInterrupted && (
            <button
              type="button"
              onClick={handleRestoreAudio}
              className="mb-3 w-full rounded-xl border border-warning/40 bg-warning/10 px-4 py-3 text-left hover:bg-warning/20 active:bg-warning/20 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-warning/60"
            >
              <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5 text-warning shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-warning">Audio interrupted</p>
                  <p className="text-xs text-warning/80">
                    Tap to restore audio and replay the last question. Often happens when headphones or CarPlay change connection.
                  </p>
                </div>
                <RefreshCw className="h-4 w-4 text-warning shrink-0" aria-hidden="true" />
              </div>
            </button>
          )}

          {/* ── In-place error (no reload) ──────────────────────────── */}
          {error && (
            <div
              className="mb-3 rounded-xl border px-4 py-3"
              style={{ borderColor: 'hsl(var(--destructive) / 0.35)', background: 'hsl(var(--destructive) / 0.06)' }}
            >
              <div className="flex items-start gap-3">
                <AlertCircle className="h-5 w-5 shrink-0 text-destructive mt-0.5" />
                <div className="flex-1 text-sm min-w-0">
                  <p className="font-medium">That didn&apos;t go through.</p>
                  <p className="text-xs text-muted-foreground mt-0.5">{error}</p>
                </div>
                {lastTurnRef.current && !streaming && (
                  <Button
                    size="sm"
                    variant="outline"
                    className="shrink-0"
                    onClick={() => {
                      const t = lastTurnRef.current
                      if (t) runAssistantTurn(t.currentMessages, { isFirstMessage: t.isFirstMessage })
                    }}
                  >
                    <RefreshCw className="h-3.5 w-3.5 mr-1.5" /> Try again
                  </Button>
                )}
              </div>
            </div>
          )}

          {/* ── Permanent mic dock ────────────────────────────────────── */}
          {hasSpeechRecognition ? (
            <VoiceDock
              streaming={streaming}
              isSpeaking={isSpeaking}
              isListening={isListening}
              transcript={transcript}
              canFinish={canFinish}
              finishHelper={finishHelper}
              interviewerName={interviewerName}
              waveformRef={waveformRef}
              onMicClick={() => isListening ? stopListening() : startListening()}
              onFinish={handleFinish}
              onPause={handlePause}
            />
          ) : (
            <TypedDock
              typedAnswer={typedAnswer}
              streaming={streaming}
              isSpeaking={isSpeaking}
              onChange={setTypedAnswer}
              onSubmit={() => submitUserText(typedAnswer)}
              onKeyDown={(e) => {
                if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                  e.preventDefault()
                  if (!streaming && !isSpeaking && typedAnswer.trim()) submitUserText(typedAnswer)
                }
              }}
              canFinish={canFinish}
              finishHelper={finishHelper}
              onFinish={handleFinish}
            />
          )}
        </>
      )}
    </div>
  )
}

// ── VoiceDock — permanent mic dock for SpeechRecognition browsers ─────────────
function VoiceDock({
  streaming, isSpeaking, isListening, transcript,
  canFinish, finishHelper, interviewerName,
  waveformRef, onMicClick, onFinish, onPause,
}) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg px-4 py-4">
      {/* Status line — always shows current state */}
      <div className="flex items-center justify-center gap-2 mb-3 min-h-[20px]" role="status" aria-live="polite">
        {streaming ? (
          <>
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-primary">
              {interviewerName} is thinking…
            </span>
          </>
        ) : isSpeaking ? (
          <>
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-primary">
              {interviewerName} is speaking — listen, then it&apos;s your turn
            </span>
          </>
        ) : isListening ? (
          <>
            <span className="h-2 w-2 rounded-full bg-destructive animate-pulse shrink-0" aria-hidden="true" />
            <span className="text-sm font-medium text-destructive">
              {transcript
                ? 'Listening — say "done" or tap mic to send'
                : 'Still listening — take your time, no rush'}
            </span>
          </>
        ) : (
          <span className="text-sm text-muted-foreground">Tap to speak your answer</span>
        )}
      </div>

      <div className="flex items-center justify-between gap-3">
        {/* Finish (left) */}
        <button
          onClick={onFinish}
          disabled={!canFinish}
          title={canFinish ? 'Finish the interview' : finishHelper || undefined}
          className="flex flex-col items-center gap-0.5 text-muted-foreground disabled:opacity-30 w-16 group"
          aria-label={canFinish ? 'Finish interview' : finishHelper || 'Finish interview'}
        >
          <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center group-enabled:group-hover:bg-muted transition-colors">
            <Sparkles className="h-4 w-4" />
          </span>
          <span className="text-3xs">Finish</span>
        </button>

        {/* Center: waveform + mic */}
        <div className="relative flex items-center justify-center" style={{ width: 160, height: 88 }}>
          {/* Waveform bars — RAF drives transforms, opacity tracks isListening */}
          <div
            ref={waveformRef}
            className={`absolute inset-0 flex items-center justify-center gap-[3px] transition-opacity duration-300 pointer-events-none ${
              isListening ? 'opacity-100' : 'opacity-0'
            }`}
            aria-hidden="true"
            style={{ color: 'hsl(var(--destructive))' }}
          >
            {Array.from({ length: 13 }, (_, i) => (
              <span
                key={i}
                className="bg-current rounded-full"
                style={{
                  width: '3px',
                  height: `${14 + Math.round(Math.abs(Math.sin(i * 1.3)) * 28)}px`,
                  transformOrigin: 'center',
                  transform: 'scaleY(0.25)',
                  willChange: 'transform',
                }}
              />
            ))}
          </div>

          {/* Mic ring + button */}
          <div className="relative flex items-center justify-center h-[72px] w-[72px]">
            {isListening && (
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: 'hsl(var(--destructive) / 0.22)', animationDuration: '1.6s' }}
                aria-hidden="true"
              />
            )}
            {isSpeaking && (
              <span
                className="absolute inset-0 rounded-full animate-ping"
                style={{ background: 'hsl(var(--info) / 0.22)', animationDuration: '1.8s' }}
                aria-hidden="true"
              />
            )}
            {streaming && (
              <div
                className="absolute rounded-full animate-spin pointer-events-none"
                style={{
                  inset: -4,
                  background: 'conic-gradient(from 0deg, hsl(var(--primary)) 0%, transparent 55%)',
                  WebkitMask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
                  mask: 'radial-gradient(farthest-side, transparent calc(100% - 4px), #000 calc(100% - 4px))',
                }}
                aria-hidden="true"
              />
            )}
            <button
              onClick={onMicClick}
              disabled={streaming || isSpeaking}
              aria-label={isListening ? 'Stop recording' : 'Start recording'}
              aria-pressed={isListening}
              className="relative h-[72px] w-[72px] rounded-full flex items-center justify-center text-white shadow-lg transition-all focus:outline-none focus-visible:ring-2 focus-visible:ring-ring disabled:opacity-40 disabled:cursor-not-allowed active:scale-95"
              style={{
                background: isListening
                  ? 'hsl(var(--destructive))'
                  : isSpeaking
                  ? 'hsl(var(--info))'
                  : streaming
                  ? 'hsl(var(--muted))'
                  : 'hsl(var(--primary))',
              }}
            >
              {isListening ? (
                <MicOff className="h-7 w-7" aria-hidden="true" />
              ) : isSpeaking ? (
                <Volume2 className="h-7 w-7" aria-hidden="true" />
              ) : streaming ? (
                <Sparkles className="h-7 w-7 text-muted-foreground" aria-hidden="true" />
              ) : (
                <Mic className="h-7 w-7" aria-hidden="true" />
              )}
            </button>
          </div>
        </div>

        {/* Pause (right) */}
        <button
          onClick={onPause}
          className="flex flex-col items-center gap-0.5 text-muted-foreground w-16 group"
          aria-label="Save progress and finish later"
          title="Save your progress and come back later"
        >
          <span className="h-10 w-10 rounded-full border border-border flex items-center justify-center group-hover:bg-muted transition-colors">
            <PauseCircle className="h-4 w-4" />
          </span>
          <span className="text-3xs">Pause</span>
        </button>
      </div>
    </div>
  )
}

// ── TypedDock — fallback for iOS Safari (no SpeechRecognition) ───────────────
function TypedDock({ typedAnswer, streaming, isSpeaking, onChange, onSubmit, onKeyDown, canFinish, finishHelper, onFinish }) {
  return (
    <div className="rounded-2xl border border-border bg-card shadow-lg px-4 py-4">
      <div className="flex items-center justify-center gap-2 mb-3 min-h-[20px]" role="status" aria-live="polite">
        {streaming ? (
          <>
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            <span className="text-sm font-medium text-primary">Thinking…</span>
          </>
        ) : isSpeaking ? (
          <>
            <span className="h-2 w-2 rounded-full bg-primary animate-pulse" aria-hidden="true" />
            <span className="text-sm font-medium text-primary">Speaking…</span>
          </>
        ) : (
          <>
            <Keyboard className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-sm text-muted-foreground">Type your answer — voice input isn&apos;t available in this browser</span>
          </>
        )}
      </div>
      <div className="flex items-end gap-2">
        <Textarea
          value={typedAnswer}
          onChange={(e) => onChange(e.target.value)}
          onKeyDown={onKeyDown}
          placeholder="Type your answer… (⌘/Ctrl + Enter to send)"
          rows={3}
          disabled={streaming || isSpeaking}
          className="resize-none"
        />
        <div className="flex flex-col gap-1.5 shrink-0">
          <Button
            onClick={onSubmit}
            disabled={streaming || isSpeaking || !typedAnswer.trim()}
            size="icon"
            className="h-10 w-10"
            aria-label="Send"
          >
            {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
          </Button>
          <Button
            variant="outline"
            size="icon"
            onClick={onFinish}
            disabled={!canFinish || streaming}
            title={canFinish ? 'Finish interview' : finishHelper || undefined}
            className="h-10 w-10"
            aria-label={canFinish ? 'Finish interview' : finishHelper || 'Finish interview'}
          >
            <Sparkles className="h-4 w-4" />
          </Button>
        </div>
      </div>
    </div>
  )
}

// ── Pre-interview primer ──────────────────────────────────────────────────────
function InterviewPrimer({ workspace, onContinue }) {
  const interviewer = workspace?.interviewer_name || 'Bernard'
  const practice = workspace?.display_name || 'your practice'
  return (
    <div className="px-4 py-8 max-w-xl mx-auto">
      <div className="space-y-1 mb-6">
        <h1 className="text-2xl font-bold tracking-tight flex items-center gap-2">
          <Sparkles className="h-5 w-5 text-primary" />
          Before we begin
        </h1>
        <p className="text-muted-foreground text-sm">
          A real conversation with {interviewer} about {practice} — this is how Bernard learns your voice.
        </p>
      </div>

      <div className="space-y-3">
        <PrimerCard
          icon={<MessagesSquare className="h-4 w-4 text-primary" />}
          title="It's a conversation, not a form"
          body={`${interviewer} will ask about your practice, your patients, and why you do this work. Just talk the way you would with a colleague — there are no wrong answers, and nothing is published from this.`}
        />
        <PrimerCard
          icon={<Lightbulb className="h-4 w-4 text-primary" />}
          title="Some questions go deep"
          body="A few of these are genuinely thought-provoking — the kind you may not have put into words before. Most people find their first interview surprisingly striking. If a question stops you in your tracks, that's exactly the point."
        />
        <PrimerCard
          icon={<Coffee className="h-4 w-4 text-primary" />}
          title="Pausing and thinking is welcome"
          body="Long pauses are normal and good. Take a breath, think it through, sit with it. There's no timer running and no rush — the best answers usually come after a moment of reflection."
        />
        <PrimerCard
          icon={<Clock className="h-4 w-4 text-primary" />}
          title="There's no clock"
          body="It can take as little as five minutes, but in real life most people go longer — and that's a sign it's working. You can stop anytime with Pause and pick up right where you left off."
        />
      </div>

      <Button onClick={onContinue} size="lg" className="w-full mt-6 gap-2">
        <Mic className="h-4 w-4" />
        I&rsquo;m ready — let&rsquo;s set up audio
      </Button>
      <p className="text-xs text-muted-foreground text-center mt-3">
        Next we&rsquo;ll do a quick microphone and speaker check.
      </p>
    </div>
  )
}

function PrimerCard({ icon, title, body }) {
  return (
    <div className="flex gap-4 rounded-xl border bg-card p-4">
      <div className="h-9 w-9 rounded-full bg-primary/10 flex items-center justify-center shrink-0 mt-0.5">
        {icon}
      </div>
      <div>
        <p className="font-semibold text-sm mb-1">{title}</p>
        <p className="text-sm text-muted-foreground leading-relaxed">{body}</p>
      </div>
    </div>
  )
}

function SynthesisStateCard({ status, error, counts, result, dryRun, onRetry, onHome }) {
  if (status === 'running') {
    return (
      <Card className="border-primary/40 bg-primary/5">
        <CardContent className="pt-6 text-center space-y-3">
          <Loader2 className="h-8 w-8 mx-auto animate-spin text-primary" />
          <div className="space-y-1">
            <p className="font-medium">
              {dryRun ? 'Running dry-run synthesis…' : 'Interview complete — synthesizing your voice…'}
            </p>
            <p className="text-sm text-muted-foreground">
              {dryRun
                ? 'About a minute. The model is producing the synthesis JSON; nothing will be written.'
                : "About a minute. We're reading your transcript and writing your workspace's voice guidance, patient archetype, topic queue, and phrase bank. Hang tight."}
            </p>
          </div>
        </CardContent>
      </Card>
    )
  }

  if (status === 'error') {
    return (
      <Card className="border-destructive/40 bg-destructive/5">
        <CardContent className="pt-6 text-center space-y-3">
          <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
          <div className="space-y-1">
            <p className="font-medium">Synthesis failed.</p>
            <p className="text-sm text-muted-foreground">
              Your transcript is safe — we just couldn&apos;t process it on this attempt. Most failures are transient (rate limit, gateway hiccup); retrying usually works.
            </p>
            {error && <p className="text-xs text-destructive/80 font-mono">{error}</p>}
          </div>
          <div className="flex gap-2 justify-center">
            <Button variant="outline" onClick={onHome}>Back to Home</Button>
            <Button onClick={onRetry}>Try again</Button>
          </div>
        </CardContent>
      </Card>
    )
  }

  const isFresh = status === 'success'
  const headline = dryRun
    ? 'Dry-run synthesis complete — nothing was written.'
    : isFresh
      ? 'Done — your workspace now sounds like you.'
      : 'Onboarding interview complete.'
  const subhead = dryRun
    ? 'Review the JSON below. Tune the synthesis prompt if anything looks off, then remove ?dryRun=1 from the URL to run for real.'
    : isFresh
      ? 'From here on, content Bernard generates uses the voice, audience, and topic queue from your interview.'
      : 'Your workspace voice was already synthesized. Visit Settings → Voice to review or refine.'
  const verb = dryRun ? 'Would write' : 'Wrote'
  return (
    <Card className={dryRun ? 'border-warning/40 bg-warning/5' : 'border-success/40 bg-success/5'}>
      <CardContent className="pt-6 text-center space-y-3">
        {dryRun
          ? <FlaskConical className="h-8 w-8 mx-auto text-warning" />
          : <CheckCircle2 className="h-8 w-8 mx-auto text-success" />}
        <div className="space-y-1">
          <p className="font-medium">{headline}</p>
          <p className="text-sm text-muted-foreground">{subhead}</p>
          {counts && (
            <p className="text-xs text-muted-foreground pt-1">
              {verb} {counts.voice_phrases} phrase{counts.voice_phrases === 1 ? '' : 's'},
              {' '}{counts.topics} topic seed{counts.topics === 1 ? '' : 's'},
              {' '}{counts.pain_points} prior-provider note{counts.pain_points === 1 ? '' : 's'}
              {counts.has_prototype ? ', and a patient archetype' : ''}.
            </p>
          )}
        </div>
        {dryRun && result && (
          <details className="text-left rounded-md border bg-background p-3 mt-2">
            <summary className="cursor-pointer text-xs font-medium uppercase tracking-wide text-muted-foreground">
              Synthesis result (JSON)
            </summary>
            <pre className="mt-3 max-h-[500px] overflow-auto text-xs leading-relaxed whitespace-pre-wrap font-mono">
              {JSON.stringify(result, null, 2)}
            </pre>
          </details>
        )}
        <div className="flex gap-2 justify-center">
          {dryRun && (
            <Button variant="outline" onClick={onRetry}>Run again</Button>
          )}
          <Button onClick={onHome}>Back to Home</Button>
        </div>
      </CardContent>
    </Card>
  )
}
