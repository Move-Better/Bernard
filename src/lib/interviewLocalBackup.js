// Per-interview localStorage backups, shared by the chat interview
// (InterviewSession) and the Live Interview (PhoneCall) so both write the SAME
// key + format — one source of truth. Duplicating the shape across two files is
// exactly how the copies silently diverge (see the project's "single import" rule).
//
// Two backups per interview:
//   messages — the committed Q&A turns. The DB PATCH can fail silently (network
//     blip, expired Clerk token, iOS WebKit dropping the request on background) and
//     the only other safety net is in-memory React state. On resume, if local has
//     MORE turns than the server, the caller restores from local and pushes it back
//     up. PhoneCall mirrors here too, so a killed Live Interview's turns survive and
//     resume in InterviewSession (same key → InterviewSession's restore picks them up).
//   draft — the in-flight, not-yet-submitted answer (what the user is typing). Lost
//     on a tab-kill before Send; restored into the answer box on resume so a
//     half-written answer survives.

function messagesKey(interviewId) {
  return `narraterx:interview:${interviewId}:messages`
}

function draftKey(interviewId) {
  return `narraterx:interview:${interviewId}:draft`
}

// ── Committed messages ──────────────────────────────────────────────────────

export function loadLocalMessages(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return null
  try {
    const raw = window.localStorage.getItem(messagesKey(interviewId))
    if (!raw) return null
    const parsed = JSON.parse(raw)
    if (!Array.isArray(parsed?.messages)) return null
    return parsed
  } catch {
    return null
  }
}

export function saveLocalMessages(interviewId, messages) {
  if (typeof window === 'undefined' || !interviewId) return
  try {
    window.localStorage.setItem(messagesKey(interviewId), JSON.stringify({
      messages,
      savedAt: new Date().toISOString(),
    }))
  } catch {
    // Quota or private-mode failure — non-fatal
  }
}

export function clearLocalMessages(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return
  try { window.localStorage.removeItem(messagesKey(interviewId)) } catch { /* ignore */ }
}

// ── In-flight (not-yet-submitted) answer draft ──────────────────────────────

export function loadDraft(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return ''
  try { return window.localStorage.getItem(draftKey(interviewId)) || '' } catch { return '' }
}

export function saveDraft(interviewId, text) {
  if (typeof window === 'undefined' || !interviewId) return
  try {
    if (text) window.localStorage.setItem(draftKey(interviewId), text)
    else window.localStorage.removeItem(draftKey(interviewId)) // empty draft = nothing to recover
  } catch {
    // Quota or private-mode failure — non-fatal
  }
}

export function clearDraft(interviewId) {
  if (typeof window === 'undefined' || !interviewId) return
  try { window.localStorage.removeItem(draftKey(interviewId)) } catch { /* ignore */ }
}
