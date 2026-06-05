// One-time onboarding interview the founder runs after the signup wizard
// creates the workspace. P2 deliverable: text-only chat using the
// getOnboardingInterviewSystemPrompt prompt. P2b adds the full voice loop
// (mic + TTS + iOS gesture priming) so the page is the proof-of-concept
// for how NarrateRx actually works.
//
// Founder-only — gated by the API route's requireRole(['admin']) check.
// Workspace-scoped via workspaceContext on the server.

import { useEffect, useRef, useState, useCallback, useMemo } from 'react'
import { useNavigate, useSearchParams } from 'react-router-dom'
import { useUser } from '@clerk/react'
import {
  Loader2, Send, CheckCircle2, AlertCircle, Sparkles, FlaskConical,
  Mic, MicOff, Volume2, RefreshCw, Keyboard,
  Clock, PauseCircle, MessagesSquare, Lightbulb, Coffee,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Textarea } from '@/components/ui/textarea'
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card'
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
// Matches the value used in InterviewSession.
const RESTART_CAP = 30

// End-of-turn phrases — matched at the end of a final transcript so the user
// can say "done" / "that's all" instead of tapping the mic. Lifted from
// InterviewSession; the same vocabulary works for any voice interview.
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
// won't recover on retry; everything else (gateway→Anthropic upstream blips
// surfaced as "A network error occurred", 5xx, timeouts, generic fetch aborts)
// is transient and safe to re-run the turn for.
function isTransientStreamError(e) {
  const status = e?.status
  if (status === 401 || status === 403 || status === 429) return false
  if (typeof status === 'number' && status >= 400 && status < 500) return false
  return true
}

// Detect and strip the completion marker from a streaming assistant message.
function detectComplete(raw) {
  if (!raw.includes(COMPLETE_TOKEN)) return { text: raw, complete: false }
  const cleaned = raw.replace(new RegExp(`\\s*${COMPLETE_TOKEN}\\s*`, 'g'), '').trim()
  return { text: cleaned, complete: true }
}

export default function OnboardingInterview() {
  useDocumentTitle('Onboarding interview')
  const navigate = useNavigate()
  const workspace = useWorkspace()
  const { user } = useUser()
  const { role } = useUserRole()

  // ── Existing interview state ─────────────────────────────────────────────
  const [interview, setInterview] = useState(null)
  const [messages, setMessages] = useState([])
  const [streaming, setStreaming] = useState(false)
  const [streamingText, setStreamingText] = useState('')
  const [completed, setCompleted] = useState(false)
  const [error, setError] = useState(null)
  const [loading, setLoading] = useState(true)
  const [synthesisStatus, setSynthesisStatus] = useState('idle')
  const [synthesisError, setSynthesisError] = useState(null)
  const [synthesisCounts, setSynthesisCounts] = useState(null)
  const [synthesisResult, setSynthesisResult] = useState(null)

  // ── Voice state (new in P2b) ─────────────────────────────────────────────
  // SpeechRecognition feature detection. iOS Safari → false, falls back to
  // typed-answer textarea automatically.
  const hasSpeechRecognition = useMemo(() => (
    typeof window !== 'undefined' &&
    !!(window.SpeechRecognition || window.webkitSpeechRecognition)
  ), [])

  // micCheckPassed gates the chat UI behind the pre-interview audio test
  // (mic permission + TTS speaker check). Only required on a fresh interview;
  // resumed interviews skip it (the user already passed it once).
  const [micCheckPassed, setMicCheckPassed] = useState(false)
  // primerSeen gates the "what to expect" primer that runs before MicCheck on
  // a fresh interview. Like MicCheck, resumed/completed interviews skip it —
  // the founder has already read it once.
  const [primerSeen, setPrimerSeen] = useState(false)
  const [isListening, setIsListening] = useState(false)
  const [isSpeaking, setIsSpeaking] = useState(false)
  const [transcript, setTranscript] = useState('')
  const [typedAnswer, setTypedAnswer] = useState('')
  const [audioInterrupted, setAudioInterrupted] = useState(false)

  // Voice refs — all the SpeechRecognition machinery for keeping the mic
  // open through thinking pauses. See InterviewSession startListening for
  // the canonical comments.
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

  // Bootstrap seed-once guard. Distinct from the kickoff guard below: this
  // is for the GET-or-POST interview row, which must only fire once even on
  // tab refocus / refetch.
  const seededRef = useRef(false)
  // Kickoff guard — prevents the first-message effect from retrying on error.
  const kickedOffRef = useRef(false)
  // Last assistant turn's input, so the inline "Try again" button can re-run it
  // in place after a transient stream failure (no full page reload).
  const lastTurnRef = useRef(null)
  const scrollRef = useRef(null)
  const founderName = (user?.fullName || user?.firstName || '').trim() || 'there'

  // Dry-run mode — append ?dryRun=1 to the URL. Synthesis runs end-to-end
  // but no writes happen. Used during P5 prompt tuning.
  const [searchParams] = useSearchParams()
  const dryRun = useMemo(() => {
    const v = searchParams.get('dryRun')
    return v === '1' || v === 'true'
  }, [searchParams])

  // Keep messagesRef in sync — handleRestoreAudio reads it inside a non-
  // React callback to find the last assistant message.
  useEffect(() => { messagesRef.current = messages }, [messages])

  // Lazy-create the TTS player. Reusing one instance means iOS gesture
  // priming sticks across all utterances (per the shared-audio-element
  // memory). Don't ever new Audio() per utterance.
  const getTts = useCallback(() => {
    if (!ttsRef.current) ttsRef.current = createTtsPlayer()
    return ttsRef.current
  }, [])

  // ── Bootstrap — fetch existing or create new interview row ───────────────
  useEffect(() => {
    if (!workspace?.id || !user?.id || seededRef.current) return
    // Set synchronously before any await so concurrent effect firings (caused
    // by Clerk re-rendering user/founderName during session hydration) don't
    // both pass the seededRef guard and race to POST a second interview row.
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
          // Resumed/completed interviews skip the primer + MicCheck — they've
          // already gone through the chat once.
          setPrimerSeen(true)
          setMicCheckPassed(true)
        }
        if (row?.status === 'synthesized' && !dryRun) {
          setSynthesisStatus('already')
        }
        // Resumed in-progress interviews also skip MicCheck — the user
        // passed it on their first session and we want to drop them back
        // into the conversation without a re-test.
        if (Array.isArray(row?.messages) && row.messages.length > 0) {
          setPrimerSeen(true)
          setMicCheckPassed(true)
        }
      } catch (e) {
        if (!cancelled) {
          // Reset the guard on failure so a full page reload can retry.
          // We don't reset on cancel (unmount) — the effect already fired.
          seededRef.current = false
          setError(e?.message || 'Failed to start interview')
        }
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()

    return () => { cancelled = true }
  }, [workspace?.id, user?.id, founderName, dryRun])

  // Auto-scroll to the latest message.
  useEffect(() => {
    if (!scrollRef.current) return
    scrollRef.current.scrollTo({ top: scrollRef.current.scrollHeight, behavior: 'smooth' })
  }, [messages, streamingText])

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

  // ── Audio failure subscription ───────────────────────────────────────────
  // Fires on iOS route change, BT disconnect, audio session interruption.
  // We surface a "Restore audio" button instead of letting the interview
  // silently fail to play.
  useEffect(() => {
    const unsubscribe = onAudioPlaybackFailure(() => setAudioInterrupted(true))
    return unsubscribe
  }, [])

  // ── TTS: speak the assistant turn ────────────────────────────────────────
  const speak = useCallback((text) => {
    if (!text) return
    setIsSpeaking(true)
    getTts().speak(text, {
      onStart: () => setIsSpeaking(true),
      onEnd: () => {
        setIsSpeaking(false)
        // Flag to the auto-listen effect that the next render should fire
        // startListening. Effect-based dispatch avoids racing the React
        // state batcher between setIsSpeaking and the effect re-eval.
        autoListenRef.current = true
      },
      onError: () => setIsSpeaking(false),
    })
  }, [getTts])

  // Re-prime + replay the last assistant message after an audio interruption.
  // Must run inside a user gesture (the click on the restore button).
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
    // Remember the turn so the inline "Try again" button can re-run it in place
    // (without a full page reload) after a transient failure.
    lastTurnRef.current = { currentMessages, isFirstMessage }
    setStreaming(true)
    setStreamingText('')
    setError(null)

    const systemPrompt = getOnboardingInterviewSystemPrompt(workspace, founderName, { isFirstMessage })

    // Claude API / Vercel AI Gateway require >=1 message — system-only
    // requests return AI_InvalidPromptError. Silent starter pattern.
    const streamInput = currentMessages.length === 0
      ? [{ role: 'user', content: 'Please begin the onboarding interview.' }]
      : currentMessages

    // The gateway→Anthropic upstream occasionally blips mid-stream — the AI SDK
    // surfaces it as an error part that our /api/stream handler writes into the
    // (already-200) SSE body, and the client throws "A network error occurred".
    // That is NOT the user's network. A single transient blip should never end
    // the interview, so auto-retry the whole turn a couple of times before
    // surfacing the error. Auth/rate-limit errors (4xx) are not retried.
    let buffer = ''
    const MAX_ATTEMPTS = 3
    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      buffer = ''
      try {
        for await (const delta of streamMessage(streamInput, systemPrompt, { model: 'claude-sonnet-4-6', maxOutputTokens: 1024 })) {
          buffer += delta
          const { text } = detectComplete(buffer)
          setStreamingText(text)
        }
        break // success
      } catch (e) {
        const status = e?.status
        const retriable = isTransientStreamError(e)
        if (retriable && attempt < MAX_ATTEMPTS) {
          // Exponential-ish backoff: 600ms, 1500ms. Reset the partial buffer.
          setStreamingText('')
          await new Promise((r) => { setTimeout(r, attempt === 1 ? 600 : 1500) })
          continue
        }
        setStreaming(false)
        setStreamingText('')
        setError(
          retriable
            ? 'The interviewer lost connection for a moment. Tap "Try again" to continue — your answers are saved.'
            : (e?.message || 'Stream failed'),
        )
        // 4xx auth errors won't recover on retry; surface the raw message.
        if (status === 401 || status === 403) setError(e?.message || 'Session expired — reload to continue.')
        return
      }
    }

    const { text, complete: hasCompleteMarker } = detectComplete(buffer)
    const finalText = text.trim()
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
      // Speak the assistant's message after persistence so the audio doesn't
      // start before the message is durable.
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

  // ── SpeechRecognition: start / stop ──────────────────────────────────────
  // Plain function (not useCallback) — startListening is recursive via
  // maybeAutoResume, and React Compiler's manual-memoization lint can't
  // verify that. Same pattern as InterviewSession.jsx.
  function startListening({ preserveTranscript = false } = {}) {
    const SR = window.SpeechRecognition || window.webkitSpeechRecognition
    if (!SR) return  // iOS Safari → typed-answer fallback handles input
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

    // Schedule a silent restart so the user can keep their turn through a
    // thinking pause. Returns true if scheduled, false if we've hit the
    // cap or the user is no longer mid-answer.
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
      // iOS Chrome 'aborted' usually means TTS still holds the audio session.
      // Retry once with a longer delay.
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

  // ── submitUserText — shared path for voice (auto on listen-end) + typed ──
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

  // ── Finish — explicit "I'm done" button override ─────────────────────────
  // Bernard only emits INTERVIEW_COMPLETE when the founder signals done in
  // their answer. The button gives a deterministic exit when the founder
  // feels they've covered enough — important UX for the external-tenant
  // proof-of-concept where "say 'I'm done' to the voice agent" is fragile.
  //
  // Gated below MIN_TURNS_TO_FINISH so users don't end on turn 2 by accident.
  // Synthesis quality on too-short transcripts is bad; the gate is a soft
  // guardrail. We use TURN_PAIRS (assistant + user = 1 pair) for the count.
  const MIN_TURNS_TO_FINISH = 6
  const userTurnCount = messages.filter((m) => m.role === 'user').length
  const canFinish = userTurnCount >= MIN_TURNS_TO_FINISH
  const finishHelper = canFinish
    ? null
    : `Keep going — Finish unlocks after ${MIN_TURNS_TO_FINISH - userTurnCount} more answer${MIN_TURNS_TO_FINISH - userTurnCount === 1 ? '' : 's'}.`

  const handleFinish = useCallback(async () => {
    if (completed || streaming || !canFinish) return
    // Cancel any in-flight TTS / mic so we don't fight the synthesis flow.
    try { ttsRef.current?.cancel() } catch { /* ignore */ }
    try { window.speechSynthesis?.cancel() } catch { /* ignore */ }
    userAnswerActiveRef.current = false
    clearTimeout(restartTimerRef.current)
    try { recognitionRef.current?.stop() } catch { /* ignore */ }

    setIsSpeaking(false)
    setIsListening(false)
    setCompleted(true)
    // Persist the existing transcript with status='completed'. The synthesis
    // effect fires off `completed`, so this single PATCH triggers the rest.
    await persist(messages, 'completed')
  }, [completed, streaming, canFinish, messages, persist])

  // ── Pause — "save and finish later" ──────────────────────────────────────
  // Every answered turn is already PATCHed to the server (see persist), so the
  // transcript is durable the moment Bernard replies. Pause just cleanly stops
  // the audio/mic and sends the founder home; returning to this page reloads
  // the saved messages and drops them straight back into the conversation
  // (the bootstrap skips primer + MicCheck once messages exist). We re-persist
  // first as a belt-and-suspenders flush.
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
    // startListening is a stable scope-level function; listing it would
    // re-fire the effect needlessly on every render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [hasSpeechRecognition, isSpeaking, streaming, completed])

  // Auto-submit when isListening flips false with captured text.
  useEffect(() => {
    if (isListening) return
    if (!transcriptRef.current.trim()) return
    submitUserText(transcriptRef.current)
    // submitUserText is a stable scope-level helper (useCallback with a
    // stable transitive dep chain). Listing it would churn this effect.
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

  // Stop any in-flight TTS / mic on unmount.
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
      <div className="px-4 py-12 flex items-center justify-center">
        <Loader2 className="h-6 w-6 animate-spin text-muted-foreground" />
      </div>
    )
  }

  if (error && messages.length === 0) {
    return (
      <div className="px-4 py-12">
        <Card>
          <CardContent className="pt-6 text-center space-y-3">
            <AlertCircle className="h-8 w-8 mx-auto text-destructive" />
            <p className="text-sm">{error}</p>
            <Button onClick={() => window.location.reload()}>Try again</Button>
          </CardContent>
        </Card>
      </div>
    )
  }

  // Primer gate — "what to expect" before the audio test. Sets the founder up
  // for thought-provoking questions, the open-ended pace, and the fact they
  // can pause and return. Fresh interviews only; resumed sessions skip it.
  if (!primerSeen) {
    return (
      <InterviewPrimer
        workspace={workspace}
        onContinue={() => setPrimerSeen(true)}
      />
    )
  }

  // MicCheck gate — pre-interview audio test. Only required for a fresh
  // interview (no messages yet, not completed). Resumed sessions skip it.
  if (!micCheckPassed) {
    return <MicCheck onContinue={() => setMicCheckPassed(true)} />
  }

  // ── Main UI ──────────────────────────────────────────────────────────────

  return (
    <div className="px-4 py-6 flex flex-col" style={{ minHeight: 'calc(100vh - 4rem)' }}>
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
      <Card className="mb-4">
        <CardHeader className="pb-3">
          <CardTitle className="flex items-center gap-2 text-base">
            <Sparkles className="h-4 w-4 text-primary" />
            Tell NarrateRx about {workspace?.display_name || 'your practice'}
          </CardTitle>
          <p className="text-sm text-muted-foreground">
            Take all the time you need — there&rsquo;s no clock, and you can pause and come back. Once we have your voice, every piece NarrateRx generates from here on will sound like you — not a template.
          </p>
        </CardHeader>
      </Card>

      <div
        ref={scrollRef}
        className="flex-1 overflow-y-auto space-y-4 pb-4 px-1"
        style={{ minHeight: '300px' }}
      >
        {messages.map((m, i) => (
          <MessageBubble key={i} role={m.role} content={m.content} />
        ))}
        {streaming && streamingText && (
          <MessageBubble role="assistant" content={streamingText} streaming />
        )}
        {streaming && !streamingText && (
          <div className="flex items-center gap-2 text-sm text-muted-foreground pl-1">
            <Loader2 className="h-4 w-4 animate-spin" />
            <span>{workspace?.interviewer_name || 'Bernard'} is thinking…</span>
          </div>
        )}
      </div>

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
          {/* Audio-interrupted recovery banner — iOS BT/CarPlay routing changes
              fire this; the click is the user gesture we need to re-prime. */}
          {audioInterrupted && (
            <button
              type="button"
              onClick={handleRestoreAudio}
              className="mb-3 w-full rounded-xl border border-amber-300 bg-amber-50 px-4 py-3 text-left hover:bg-amber-100 active:bg-amber-100 transition-colors focus:outline-none focus-visible:ring-2 focus-visible:ring-amber-400"
            >
              <div className="flex items-center gap-3">
                <Volume2 className="h-5 w-5 text-amber-700 shrink-0" aria-hidden="true" />
                <div className="flex-1 min-w-0">
                  <p className="text-sm font-medium text-amber-900">Audio interrupted</p>
                  <p className="text-xs text-amber-800">
                    Tap to restore audio and replay the last question. Often happens when headphones or CarPlay change connection.
                  </p>
                </div>
                <RefreshCw className="h-4 w-4 text-amber-700 shrink-0" aria-hidden="true" />
              </div>
            </button>
          )}

          {error && (
            <div className="mb-2 flex items-center gap-3">
              <p className="text-sm text-destructive flex items-center gap-2 flex-1 min-w-0">
                <AlertCircle className="h-4 w-4 shrink-0" /> {error}
              </p>
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
          )}

          {/* Progress strip — gives the founder a sense of how far they've
              come and a deterministic exit (Finish) instead of needing to
              say "I'm done" to Bernard. Important for the external-tenant
              proof-of-concept; "talk to a voice agent to end" is fragile UX. */}
          <div className="flex items-center justify-between gap-3 mb-2 px-1">
            <p className="text-xs text-muted-foreground">
              {userTurnCount === 0
                ? 'Answer naturally — take your time, and pause whenever you need to.'
                : <>Turn {userTurnCount} · {finishHelper || 'Finish whenever you feel you’ve covered enough.'}</>}
            </p>
            <div className="flex items-center gap-2 shrink-0">
              <Button
                size="sm"
                variant="ghost"
                onClick={handlePause}
                disabled={streaming || completed}
                title="Save your progress and come back later — nothing is lost"
                aria-label="Pause and finish later"
                className="gap-1.5 text-muted-foreground"
              >
                <PauseCircle className="h-3.5 w-3.5" />
                Pause
              </Button>
              <Button
                size="sm"
                variant="outline"
                onClick={handleFinish}
                disabled={!canFinish || streaming || completed}
                title={canFinish ? 'End the interview and synthesize your voice' : finishHelper || undefined}
                aria-label={canFinish ? 'Finish interview' : finishHelper || 'Finish interview'}
                className="gap-1.5 shrink-0"
              >
                <Sparkles className="h-3.5 w-3.5" />
                Finish
              </Button>
            </div>
          </div>

          {/* Bottom dock — mic for SpeechRecognition browsers, textarea for
              iOS Safari et al. Same visual surface either way. */}
          {hasSpeechRecognition ? (
            <div className="border-t pt-4 flex flex-col items-center gap-3">
              {transcript && (
                <div
                  aria-live="polite"
                  aria-label="Transcript"
                  className="w-full rounded-xl bg-muted px-4 py-3 text-sm text-foreground/80 italic min-h-[44px]"
                >
                  &quot;{transcript}&quot;
                </div>
              )}
              <p
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground h-4"
              >
                {streaming ? '' : isSpeaking ? (
                  <span className="flex items-center gap-1.5">
                    <Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…
                  </span>
                ) : isListening ? (
                  <span className="flex items-center gap-1.5 text-red-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-red-500 animate-pulse" aria-hidden="true" /> Listening — take your time. Say &quot;done&quot; or tap mic to send.
                  </span>
                ) : 'Tap to speak'}
              </p>
              <button
                onClick={isListening ? stopListening : () => startListening()}
                disabled={streaming || isSpeaking}
                aria-label={isListening ? 'Stop recording' : 'Start recording'}
                aria-pressed={isListening}
                className={`h-16 w-16 rounded-full flex items-center justify-center transition-all shadow-lg focus:outline-none focus-visible:ring-2 focus-visible:ring-primary
                  ${isListening
                    ? 'bg-red-500 text-white scale-110'
                    : 'bg-primary text-primary-foreground hover:opacity-90 active:scale-95'
                  } disabled:opacity-30 disabled:cursor-not-allowed disabled:scale-100`}
              >
                {isListening
                  ? <MicOff className="h-6 w-6" aria-hidden="true" />
                  : <Mic className="h-6 w-6" aria-hidden="true" />
                }
              </button>
            </div>
          ) : (
            <div className="border-t pt-4 flex flex-col gap-2">
              <p
                role="status"
                aria-live="polite"
                className="text-xs text-muted-foreground h-4 flex items-center gap-1.5"
              >
                {streaming ? '' : isSpeaking ? (
                  <><Volume2 className="h-3 w-3 animate-pulse" aria-hidden="true" /> Speaking…</>
                ) : (
                  <><Keyboard className="h-3 w-3" aria-hidden="true" /> Type your answer — voice input isn&rsquo;t supported in this browser</>
                )}
              </p>
              <div className="flex items-end gap-2">
                <Textarea
                  value={typedAnswer}
                  onChange={(e) => setTypedAnswer(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                      e.preventDefault()
                      if (!streaming && !isSpeaking && typedAnswer.trim()) {
                        submitUserText(typedAnswer)
                      }
                    }
                  }}
                  placeholder="Type your answer… (⌘/Ctrl + Enter to send)"
                  rows={3}
                  disabled={streaming || isSpeaking}
                  className="resize-none"
                />
                <Button
                  onClick={() => submitUserText(typedAnswer)}
                  disabled={streaming || isSpeaking || !typedAnswer.trim()}
                  size="icon"
                  className="h-10 w-10 shrink-0"
                  aria-label="Send"
                >
                  {streaming ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
                </Button>
              </div>
            </div>
          )}
        </>
      )}
    </div>
  )
}

// ── Pre-interview primer ─────────────────────────────────────────────────
// Sets the founder up before the audio test: what this is, that the questions
// go deep, that pauses and thinking are normal (and a good sign), and that
// they can stop and come back. Copy is written to be spoken as well as read —
// the interviewer (Bernard) opens on similar ground.
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
          A real conversation with {interviewer} about {practice} — this is how NarrateRx learns your voice.
        </p>
      </div>

      <div className="space-y-3">
        <PrimerCard
          icon={<MessagesSquare className="h-4 w-4 text-primary" />}
          title="It’s a conversation, not a form"
          body={`${interviewer} will ask about your practice, your patients, and why you do this work. Just talk the way you would with a colleague — there are no wrong answers, and nothing is published from this.`}
        />
        <PrimerCard
          icon={<Lightbulb className="h-4 w-4 text-primary" />}
          title="Some questions go deep"
          body="A few of these are genuinely thought-provoking — the kind you may not have put into words before. Most people find their first interview surprisingly striking. If a question stops you in your tracks, that’s exactly the point."
        />
        <PrimerCard
          icon={<Coffee className="h-4 w-4 text-primary" />}
          title="Pausing and thinking is welcome"
          body="Long pauses are normal and good. Take a breath, think it through, sit with it. There’s no timer running and no rush — the best answers usually come after a moment of reflection."
        />
        <PrimerCard
          icon={<Clock className="h-4 w-4 text-primary" />}
          title="There’s no clock"
          body="It can take as little as five minutes, but in real life most people go longer — and that’s a sign it’s working. You can stop anytime with Pause and pick up right where you left off."
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

function MessageBubble({ role, content, streaming = false }) {
  const isUser = role === 'user'
  return (
    <div className={`flex ${isUser ? 'justify-end' : 'justify-start'}`}>
      <div
        className={`max-w-[85%] rounded-2xl px-4 py-2.5 text-sm leading-relaxed whitespace-pre-wrap ${
          isUser
            ? 'bg-primary text-primary-foreground'
            : 'bg-muted text-foreground'
        }`}
      >
        {content}
        {streaming && <span className="inline-block w-1.5 h-4 ml-0.5 align-middle bg-current opacity-50 animate-pulse" />}
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
                : 'About a minute. We’re reading your transcript and writing your workspace’s voice guidance, patient archetype, topic queue, and phrase bank. Hang tight.'}
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

  // success or already-synthesized
  const isFresh = status === 'success'
  const headline = dryRun
    ? 'Dry-run synthesis complete — nothing was written.'
    : isFresh
      ? 'Done — your workspace now sounds like you.'
      : 'Onboarding interview complete.'
  const subhead = dryRun
    ? 'Review the JSON below. Tune the synthesis prompt if anything looks off, then remove ?dryRun=1 from the URL to run for real.'
    : isFresh
      ? 'From here on, content NarrateRx generates uses the voice, audience, and topic queue from your interview.'
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
