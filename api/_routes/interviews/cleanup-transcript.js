// POST /api/interviews/cleanup-transcript  { interviewId: string }
//
// Cleans up the raw Web Speech transcript on an interview. The cleanup pass
// removes filler words, fixes obvious mis-transcriptions of medical terms,
// and reflows run-ons — but does NOT paraphrase, summarize, or change the
// meaning of any utterance. The original messages stay on `messages`; the
// cleaned version writes to `cleaned_messages`. The editor can always
// toggle back to the original to verify nothing substantive was changed.
//
// Hard guarantee: returned arrays preserve the same length AND same role
// sequence as the input. If the model returns a different shape, the
// cleanup is dropped and the original wins — better to ship the raw
// transcript than to silently mutate the roles or drop turns.
// maxDuration: 60s + maxTokens: 4000 (the previous values) silently
// truncated cleanup output on 23-25 message interviews. Audit on 2026-05-18
// found 4 of 5 completed interviews missing cleaned_messages because the
// JSON response exceeded 4000 tokens and the length-match guard then
// rejected the result. Bumping to the current Vercel default (300s) +
// 16000 tokens gives plenty of headroom for any realistic interview length
// — a fully-loaded 25-message transcript runs ~6000 output tokens.
export const config = { runtime: 'nodejs', maxDuration: 300 }

import { generateText } from 'ai'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { resolveGlossary } from '../../../src/lib/medicalGlossary.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

// Cleanup level determines how aggressively the model rewrites. The role
// sequence + turn count must always be preserved (the guard below drops the
// cleanup if they're not), but the per-turn rewrite varies:
//   verbatim — only fix obvious mis-transcriptions; KEEP filler words and pauses.
//   balanced — also remove filler words, lightly reflow run-ons. (default)
//   polished — also tighten rambling, merge clearly fragmented thoughts.
function buildPrompt(messages, terms, fillers, level = 'balanced') {
  const numbered = messages
    .map((m, i) => `[${i}] (${m.role}) ${m.content || ''}`)
    .join('\n\n')

  const doListByLevel = {
    verbatim: [
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Capitalize sentence starts and proper nouns where appropriate.',
      'Stay close to the speaker\'s exact words — keep filler words, false starts, and pauses intact.',
    ],
    balanced: [
      `Remove filler words used as filler (not as substantive vocabulary): ${fillers.join(', ')}.`,
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Lightly re-flow run-ons (add a period or comma where the speaker clearly paused but the recognizer didn\'t capture it). Capitalize where appropriate.',
    ],
    polished: [
      `Remove filler words used as filler (not as substantive vocabulary): ${fillers.join(', ')}.`,
      `Fix obvious mis-transcriptions of medical / movement-therapy terms, preferring these spellings when context clearly matches: ${terms.join(', ')}.`,
      'Re-flow run-ons and merge clearly fragmented sentences within a single turn so the prose reads cleanly. Tighten rambling while keeping every fact the speaker provided.',
      'Capitalize and punctuate as needed.',
    ],
  }
  const doList = (doListByLevel[level] || doListByLevel.balanced).map((line) => `- ${line}`).join('\n')

  return `You are cleaning up a raw interview transcript captured by the Web Speech API. Your job is mechanical, not editorial.

Cleanup level: ${level}

DO:
${doList}

DO NOT:
- Paraphrase, summarize, or compress meaning.
- Drop, merge, or add messages — the output array MUST have the same number of entries in the same order, with the same role on each entry.
- Change meaning, add interpretation, or invent details that weren't said. If you are unsure whether a word is filler or substantive, keep it.
- Translate or modernize vocabulary.

Transcript (numbered, with role tags):
"""
${numbered}
"""

Return ONLY a JSON array of objects, one per input message, in the same order:
[
  { "role": "user" | "assistant", "content": "<cleaned content>" },
  ...
]
The array length and roles must exactly match the input.`
}

function parseCleaned(text) {
  const start = text.indexOf('[')
  const end = text.lastIndexOf(']')
  if (start === -1 || end === -1 || end <= start) return null
  try {
    const arr = JSON.parse(text.slice(start, end + 1))
    if (!Array.isArray(arr)) return null
    return arr
  } catch {
    return null
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)
  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)
  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'ai', ws.id))) return
  const wsFilter = `workspace_id=eq.${ws.id}`

  const { interviewId } = req.body || {}
  if (!interviewId) return err(res, 'Missing interviewId')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(interviewId)) return err(res, 'Invalid interviewId', 400)

  const ivRes = await sb(`interviews?id=eq.${interviewId}&${wsFilter}&select=id,messages,cleanup_level`)
  if (!ivRes.ok) return err(res, 'Database error', 500)
  const ivRows = await ivRes.json()
  const iv = ivRows[0]
  if (!iv) return err(res, 'Interview not found', 404)

  const messages = Array.isArray(iv.messages) ? iv.messages : []
  if (messages.length === 0) return err(res, 'Transcript is empty', 422)

  const totalChars = messages.reduce((n, m) => n + (m.content?.length || 0), 0)
  if (totalChars < 80) return err(res, 'Transcript is too short for cleanup', 422)

  const { terms, fillers } = resolveGlossary(ws.transcript_glossary)
  const cleanupLevel = iv.cleanup_level || 'balanced'
  const prompt = buildPrompt(messages, terms, fillers, cleanupLevel)

  let text
  try {
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      instructions: prompt,
      messages: [{ role: 'user', content: 'Clean the transcript now.' }],
      // Sonnet 4.6 max output is 64k. 16k gives headroom for a fully-loaded
      // 25-message interview (~6k output tokens) plus JSON wrapping. The
      // previous 4k limit silently truncated the JSON array on big
      // transcripts, which then failed the length-match guard and dropped
      // the cleanup entirely.
      maxOutputTokens: 16000,
    })
    text = result.text
  } catch (e) {
    console.error('[interviews/cleanup-transcript] AI call failed:', e?.message)
    return err(res, 'AI cleanup failed', 500)
  }

  const parsed = parseCleaned(text || '')
  if (!parsed) {
    console.error('[interviews/cleanup-transcript] unparseable model output')
    return err(res, 'Cleanup produced invalid output — try again', 422)
  }

  // Length + role-sequence guard. If the model dropped, merged, or re-ordered
  // turns, we refuse to save and the editor sees the raw transcript only.
  if (parsed.length !== messages.length) {
    console.error(`[interviews/cleanup-transcript] length mismatch: got ${parsed.length}, expected ${messages.length}`)
    return err(res, 'Cleanup changed the message count — try again', 422)
  }
  for (let i = 0; i < messages.length; i++) {
    if (parsed[i]?.role !== messages[i].role) {
      console.error(`[interviews/cleanup-transcript] role mismatch at ${i}`)
      return err(res, 'Cleanup changed message roles — try again', 422)
    }
  }

  const cleaned = parsed.map((m, i) => ({
    role: messages[i].role,
    content: String(m.content || '').trim(),
  }))

  const upd = await sb(`interviews?id=eq.${interviewId}&${wsFilter}`, {
    method: 'PATCH',
    body: JSON.stringify({ cleaned_messages: cleaned }),
  })
  if (!upd.ok) {
    const body = await upd.text().catch(() => '')
    console.error(`[interviews/cleanup-transcript] save failed — supabase ${upd.status}: ${body.slice(0, 300)}`)
    return err(res, 'Database error', 500)
  }

  return ok(res, { cleaned_messages: cleaned })
}
