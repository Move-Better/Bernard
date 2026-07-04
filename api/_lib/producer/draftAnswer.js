// draftAnswer — grounded generation of a public patient-library answer in the
// owning clinician's voice. The Q&A sibling of draftAtom: same per-staff_id
// grounding (voice notes + phrases + topic-scoped practice memory), different
// output (a "why here, why you" answer_lead + markdown body).
//
// Used for (a) the "ask Bernard to revise" loop — re-draft an existing answer
// against the clinician's change note — and (b) drafting NEW answers for the
// public library. Output is always human-gated (lands as needs_review); nothing
// here publishes.

import { generateText } from 'ai'
import { buildTopicScopedHistoryBlock } from '../practiceMemory.js'

const MODEL = 'anthropic/claude-sonnet-4-6'
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

const SYSTEM = `You draft public patient-facing answers for the Move Better answer library — short, straight answers to what patients Google, each carrying a specific clinician's name as their own words. Move Better is a movement-based chiropractic + rehab practice (Portland OR & Vancouver WA).

THE FRAME that makes these answers different (use it in every one): a symptom is rarely a generic "what causes X." The interesting, differentiated question is "why YOURS, and why THERE" — of all the places a problem could show up, why this person, this spot, this side. Two people with the same scan, job, or sport can have completely different reasons; the reason is individual to how a person loads and moves, and it's found by watching them move in person. Lead with that reframe.

VOICE: write as THIS clinician, in first-person-plural ("we"), warm, plain, confident, no jargon, no marketing gloss. Ground everything in the clinician's own prior thinking provided below — do NOT invent clinical claims, studies, techniques, or specifics they haven't expressed. If the grounding is thin, stay high-level and defer specifics to an in-person look.

NON-NEGOTIABLE SAFETY: this is public medical-adjacent content. Never diagnose the reader or tell them what they have — speak in patterns ("this often points toward…", "a pattern we see…"). No treatment prescriptions or dosing. Close by pointing toward a first visit as the way to learn what's going on for THEM. For genuinely urgent presentations (progressive numbness/weakness, bladder/bowel changes, severe/worsening pain) note that those warrant prompt in-person care.

OUTPUT FORMAT — return EXACTLY this, no preamble:
[LEAD]
<the direct answer: 40–70 words, leading with the why-yours/why-there reframe. This is the snippet AI search will quote — make it self-contained and quotable.>
[BODY]
<the fuller answer in markdown: 2–4 short sections with '## ' headings, in the clinician's voice, grounded in their reasoning, landing on "the only way to know yours is to be seen.">`

function buildUserPrompt({ question, condition, staffName, voiceNotes, voicePhrases, historyBlock, existing, reviseNote }) {
  const parts = []
  parts.push(`Draft the Move Better answer to this patient question, as ${staffName}:`)
  parts.push(`\nQUESTION: ${question}`)
  if (condition) parts.push(`TOPIC: ${condition}`)
  if (voiceNotes) parts.push(`\n${staffName.toUpperCase()}'S VOICE (write like this):\n${voiceNotes}`)
  if (voicePhrases?.length) parts.push(`\nCHARACTERISTIC PHRASES: ${voicePhrases.join(' · ')}`)
  if (historyBlock) parts.push(`\n${historyBlock}`)
  if (existing && reviseNote) {
    parts.push(`\nThis answer already exists and ${staffName} asked you to revise it. Keep everything that works; apply the change.`)
    parts.push(`CURRENT LEAD: ${existing.answer_lead || ''}`)
    parts.push(`CURRENT BODY:\n${existing.body || ''}`)
    parts.push(`\nTHE REQUESTED CHANGE: ${reviseNote}`)
  }
  return parts.join('\n')
}

function parseOutput(text) {
  const raw = String(text || '')
  const leadMatch = raw.match(/\[LEAD\]\s*([\s\S]*?)\s*\[BODY\]/i)
  const bodyMatch = raw.match(/\[BODY\]\s*([\s\S]*)$/i)
  const answer_lead = leadMatch ? leadMatch[1].trim() : ''
  const body = bodyMatch ? bodyMatch[1].trim() : ''
  return { answer_lead, body }
}

/**
 * Draft (or re-draft) an answer in a clinician's voice, grounded in their
 * practice memory. Returns { answer_lead, body, staffName } or null on failure.
 *
 * @param {object}  args
 * @param {object}  args.ws            resolved workspace ({ id, ... })
 * @param {string}  args.staffId       owning clinician staff.id
 * @param {string}  args.question      the patient question
 * @param {string} [args.condition]    topic label
 * @param {object} [args.existing]     current { answer_lead, body } (for a revise)
 * @param {string} [args.reviseNote]   the clinician's change request (for a revise)
 */
export async function draftAnswer({ ws, staffId, question, condition, existing, reviseNote }) {
  if (!ws?.id || !staffId || !question) return null
  const wsFilter = `workspace_id=eq.${ws.id}`

  const [clinRes, phrasesRes] = await Promise.all([
    sb(`staff?id=eq.${staffId}&${wsFilter}&select=name,voice_notes`),
    sb(
      `staff_voice_phrases?staff_id=eq.${staffId}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`,
    ),
  ])
  const clinRows = clinRes.ok ? await clinRes.json() : []
  const phraseRows = phrasesRes.ok ? await phrasesRes.json() : []
  const staffName = clinRows[0]?.name || 'this clinician'
  const voiceNotes = clinRows[0]?.voice_notes || ''
  const voicePhrases = phraseRows.map((p) => p.phrase).filter(Boolean)

  const historyBlock = await buildTopicScopedHistoryBlock({
    topic: `${question} ${condition || ''}`.trim(),
    workspaceId: ws.id,
    staffId,
    k: 6,
  })

  const userPrompt = buildUserPrompt({
    question, condition, staffName, voiceNotes, voicePhrases, historyBlock, existing, reviseNote,
  })

  const { text } = await generateText({
    model: MODEL,
    instructions: SYSTEM,
    messages: [{ role: 'user', content: userPrompt }],
    maxOutputTokens: 1400,
  })

  const { answer_lead, body } = parseOutput(text)
  if (!answer_lead || !body) {
    console.error('[draftAnswer] unparseable output for question:', question?.slice(0, 60))
    return null
  }
  return { answer_lead, body, staffName }
}
