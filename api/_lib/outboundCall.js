// F1 — "Bernard picks up the phone" (outbound call). Server-side core.
//
// An outbound call has NO browser, so the two things the browser does today
// for the in-app voice interview must happen server-side:
//   1. Assemble the interview system prompt (the browser builds it in
//      InterviewSession.jsx / PhoneCall.jsx from ~11 fetched inputs).
//   2. Generate `outputs` (the blog post) from the finished transcript
//      (the browser does this in handleGenerateContent()).
//
// We REUSE the exact same PURE prompt builders the browser uses
// (src/lib/prompts.js, src/lib/interviewTactics.js) so the phone call behaves
// identically to the tap-to-call interview — same voice, same generation. This
// module never talks to a telephony provider; that lives in twilioSip.js. It
// only assembles text and turns a transcript into outputs.
//
// v1 scope (Q, 2026-07-10): one clinician, manual trigger, ultra-light
// standing-consent opener. Full RAG grounding (concept/agreement/gap blocks,
// own-history, campaign goal) is intentionally deferred to a fast-follow — the
// load-bearing personalization for v1 is the earned register (style ledger) +
// the "what I already shipped this week" opener.

import { generateText } from 'ai'
import {
  getInterviewSystemPrompt,
  getBlogPostSystemPrompt,
  buildVerbatimBlock,
} from '../../src/lib/prompts.js'
import { buildStyleMemoryBlock } from '../../src/lib/interviewTactics.js'
import { extractProvenanceBlock } from '../../src/lib/provenance.js'
import { mondayOf } from './strategist.js'

// Matches the model InterviewSession.jsx uses for blog generation, so the
// phone-call draft is the same quality as an in-app interview draft.
const BLOG_MODEL = 'anthropic/claude-opus-4-7'

/**
 * Read the pieces Bernard has already published for this workspace THIS WEEK,
 * so the call can open by referencing them ("here are the 3 things I already
 * made and shipped this week"). Reads the append-only `agent_actions` ledger
 * (kind='published'), windowed to the current Monday. Best-effort: returns []
 * on any failure so a call is never blocked by this read.
 *
 * @param {Function} sb   - Supabase REST helper (path, init) => Response
 * @param {string}   wsId - workspace UUID
 * @returns {Promise<string[]>} titles of pieces published this week, newest first
 */
export async function readShippedThisWeek(sb, wsId) {
  if (!sb || !wsId) return []
  const monday = mondayOf(new Date().toISOString())
  try {
    const r = await sb(
      `agent_actions?workspace_id=eq.${wsId}&kind=eq.published` +
        `&created_at=gte.${encodeURIComponent(monday)}` +
        `&select=title,created_at&order=created_at.desc&limit=10`,
    )
    if (!r.ok) return []
    const rows = await r.json().catch(() => [])
    return (Array.isArray(rows) ? rows : [])
      .map((x) => (typeof x?.title === 'string' ? x.title.trim() : ''))
      .filter(Boolean)
  } catch {
    return []
  }
}

/**
 * The opening directive appended to the interview system prompt. This is what
 * makes the call feel like a disclosed colleague checking in rather than a
 * robocall. Q chose the ULTRA-LIGHT / standing-consent register (2026-07-10):
 * minimal preamble, assumes the clinician has already opted into these calls.
 *
 * Bernard (OpenAI Realtime, create_response:true) generates the first turn
 * autonomously from this directive — it is guidance, NOT a script to read
 * verbatim.
 *
 * @param {object} p
 * @param {string} p.firstName       - clinician's first name
 * @param {object} [p.styleMemory]   - staff.interview_style_memory
 * @param {string[]} [p.shippedTitles] - pieces published this week
 * @returns {string}
 */
export function buildOpeningDirective({ firstName, styleMemory, shippedTitles = [] } = {}) {
  const who = firstName || 'them'
  const peer = styleMemory && typeof styleMemory === 'object' && styleMemory.registerCeiling === 'peer'

  const lines = [
    'OPENING — THIS IS AN OUTBOUND PHONE CALL YOU PLACED.',
    `You called ${who} for your standing weekly check-in. They have already opted into these calls, so do NOT ask permission or over-explain who you are.`,
    'Open in your own words (never read a script): a quick warm hello by first name, "Bernard here for your weekly", confirm they\'ve got about five minutes, mention you\'re recording as always, then go straight into what they saw or worked on this week. Keep the whole preamble to one or two sentences — the conversation is the point, not the intro.',
  ]
  if (peer) {
    lines.push('You know this clinician well and they go deep — open at peer level, skip the warm-up.')
  }
  if (shippedTitles.length) {
    const list = shippedTitles.slice(0, 3).map((t) => `"${t}"`).join(', ')
    lines.push(
      `Context you can reference naturally if it helps the opener land: this week you've already made and shipped ${shippedTitles.length} piece${shippedTitles.length === 1 ? '' : 's'} for them${list ? ` (e.g. ${list})` : ''}. This is the payoff of last week's call — a light "your last call already turned into X" is a good hook, but don't belabor it.`,
    )
  }
  lines.push('If they say now is not a good time, acknowledge warmly, tell them you\'ll catch them another time, and end the call — do not push.')
  return `\n\n${lines.join('\n')}\n`
}

/**
 * Assemble the full system prompt for the outbound weekly call. Reuses the
 * SAME getInterviewSystemPrompt the browser interview uses, plus the earned
 * register from the style ledger, plus the outbound opening directive. Pure —
 * no network — so it is trivially node-harness verifiable against real data.
 *
 * @param {object} p
 * @param {object} p.workspace       - resolved workspace row (voice/tone config, etc.)
 * @param {object} p.staff           - staff row: { name, staff_type, interview_style_memory }
 * @param {string} p.topic           - the week's topic / condition ("this week" is fine)
 * @param {string[]} [p.shippedTitles]
 * @param {Array}  [p.pastInterviews] - cross-clinician perspectives (default [])
 * @returns {string} the OpenAI Realtime `instructions` for the call
 */
export function assembleCallSystemPrompt({ workspace, staff, topic, shippedTitles = [], pastInterviews = [] }) {
  const staffName = staff?.name || 'the clinician'
  const firstName = staffName.split(/\s+/)[0]
  const styleMemory = staff?.interview_style_memory ?? null

  const styleMemoryBlock = buildStyleMemoryBlock({ staffName, styleMemory })
  const base = getInterviewSystemPrompt(
    workspace,
    staffName,
    topic || 'what they saw this week',
    pastInterviews,
    null, // prototypeId — not used for the open-ended weekly call
    {
      isFirstMessage: true,
      tone: staff?.default_tone || 'smart',
      styleMemoryBlock,
      staffType: staff?.staff_type,
    },
  )
  const opening = buildOpeningDirective({ firstName, styleMemory, shippedTitles })
  return base + opening
}

/**
 * Browserless transcript → outputs. Replicates the generation half of
 * InterviewSession.jsx handleGenerateContent() server-side: build the blog
 * system prompt with the same pure builder, ask the model to write the post
 * from the transcript, strip the provenance trailer, and return the outputs
 * object ready to PATCH onto the interview row (which fires the existing
 * content_items / atoms / enrichment cascade in api/_routes/db/interviews.js).
 *
 * @param {object} p
 * @param {object} p.workspace
 * @param {object} p.staff          - { name, default_tone, default_voice_mode, voice_notes }
 * @param {string} p.topic
 * @param {Array}  p.messages       - transcript turns [{ role:'user'|'assistant', content }]
 * @param {object} [p.verbatimFlags]
 * @param {string} [p.ownHistoryBlock]
 * @returns {Promise<{ blogPost: string, generatedAt: string }>}
 */
export async function generateOutputsFromTranscript({ workspace, staff, topic, messages, verbatimFlags = null, ownHistoryBlock = '' }) {
  if (!process.env.AI_GATEWAY_API_KEY) {
    throw new Error('AI_GATEWAY_API_KEY is not set')
  }
  const turns = (Array.isArray(messages) ? messages : [])
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant') && typeof m.content === 'string' && m.content.trim())
    .map((m) => ({ role: m.role, content: m.content }))
  if (!turns.length) throw new Error('No transcript turns to generate from')

  const staffName = staff?.name || 'the clinician'
  const voiceMode = staff?.default_voice_mode === 'personal' ? 'personal' : 'practice'

  const systemPrompt =
    getBlogPostSystemPrompt(
      workspace,
      staffName,
      topic || 'this week',
      staff?.default_tone || 'smart',
      voiceMode,
      null, // prototypeId
      staff?.voice_notes || '',
      [], // voicePhrases — deferred for v1 (the completion cascade still learns them)
      null, // audienceSlot
      null, // storyTypeSlot
      null, // lengthPreset
      ownHistoryBlock,
    ) + buildVerbatimBlock(verbatimFlags)

  const genMessages = [
    ...turns,
    { role: 'user', content: 'Please write the blog post now based on our interview.' },
  ]

  const { text } = await generateText({
    model: BLOG_MODEL,
    instructions: systemPrompt,
    messages: genMessages,
    maxOutputTokens: 4096,
  })

  const { content: generated } = extractProvenanceBlock(text || '')
  if (!generated.trim()) throw new Error('No content returned from generation')

  return { blogPost: generated, generatedAt: new Date().toISOString() }
}
