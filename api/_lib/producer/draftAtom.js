// draftAtom — the reusable generation+judge core of the per-atom draft path.
//
// Extracted from api/_routes/content-plan/draft.js (Standing Producer P3) so BOTH
// the interactive HTTP route AND the pre-draft handler (predraftWeek.js, driven by
// agent-tick) share ONE implementation of "ground an atom, generate its caption,
// voice-judge it, compute the gate." This function is BEHAVIOR-IDENTICAL to what
// draft.js did inline — the prompt construction, model ids, and generateText
// params are byte-for-byte what the route used (proven by the fixture-diff harness
// in .claude/, see the P3 handoff notes).
//
// Deliberately request-agnostic and DB-agnostic:
//   • takes an already-fetched workspace (`ws`) + atom + interview (the caller owns
//     auth, the atom claim, and reading these rows),
//   • does NOT touch req/res, does NOT insert/patch content_items, does NOT record
//     an agent action, does NOT run GBP location variants.
// The caller (route or pre-draft lib) does the DB writes. To let the route keep
// its existing GBP per-location variant loop unchanged, draftAtom also returns the
// resolved grounding pieces in `gbpContext` — the exact locals the loop reads.
//
// PURE-ISH: the only side effects are the model calls (via the AI Gateway) and the
// best-effort concept/RAG retrieval reads. Never writes tenant data.

import { generateText } from 'ai'
import { getAtomSystemPrompt } from '../atomPrompts.js'
import { hasPublishedBlogArticle } from '../blogLinkStatus.js'
import { getContextBlock } from '../conceptRetrieval.js'
import { resolveOwnHistoryBlock, buildRagQuery } from '../practiceMemory.js'
import {
  loadCurrentTentpole,
  getTentpolePromptContext,
  resolveCampaignSubjectLocation,
  buildTentpoleGbpLocationBlock,
} from '../tentpoleCampaignContext.js'
import { extractProvenanceBlock } from '../../../src/lib/provenance.js'
import { buildFidelityPrompt, parseFidelity } from '../captionFidelityRubric.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Background/lib reads; workspace_id is always supplied by the caller's atom/ws and
// every query below is scoped by it. (require-workspace-scope only lints _routes.)
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

// The judge grades faithfulness against what the clinician ACTUALLY said, so it
// must see (nearly) the WHOLE transcript — real interviews run 14–20k chars of
// clinician turns; the old 2500-char slice showed the judge ~13% of the reference.
// 24k bounds the worst-case seminar transcript.
const TRANSCRIPT_MAX = 24_000
// The faithfulness-v2 rubric is calibrated for SHORT captions (GATE=6.5 is bimodal
// there); on long-form it clusters faithful pieces below the gate. So the HARD gate
// (hold + flag) applies only to short captions; longer pieces get a soft,
// non-blocking score.
const HARD_GATE_MAX_CHARS = 600
const GATE = 6.5

/**
 * Ground + generate + judge one atom's caption. Behavior-identical to draft.js's
 * inline core; does NO DB writes.
 *
 * @param {object} a
 * @param {object} a.ws         workspace row (needs id, name/slug, brand_guidelines,
 *                              audience_options, story_type_options)
 * @param {object} a.atom       content_plan_atoms row (needs id, platform, angle,
 *                              interview_id)
 * @param {object} a.interview  interviews row (needs topic, tone, voice_mode,
 *                              staff_id, location_id, messages, audience,
 *                              story_type, outputs)
 * @returns {Promise<{
 *   caption: string,
 *   slides: object[]|null,
 *   voiceScore: {overall:number, breakdown:object}|null,
 *   voiceAudit: object|null,          // { ...breakdown, attempts, gate } — null when unscored
 *   voiceAttempts: number,
 *   gate: 'passed'|'held'|'soft',
 *   staffName: string,
 *   model: string,
 *   aiMessages: object[],             // the exact messages the route reuses for GBP variants
 *   gbpContext: {                     // resolved grounding for the route's GBP loop
 *     staffName, voiceNotes, voicePhrases, conceptBlock, audienceLabel,
 *     storyTypeLabel, activeCampaign, campaignContext, gbpSubjectLocation,
 *     ownHistoryBlock,
 *   },
 * }>}
 * @throws on missing transcript, empty AI output, or no prompt for the platform —
 *         the caller decides whether that's fatal (route → 500 + cleanup) or a
 *         skip (pre-draft → skip this atom, keep going).
 */
export async function draftAtom({ ws, atom, interview }) {
  const wsFilter = `workspace_id=eq.${ws.id}`

  const blogPost = interview.outputs?.blogPost || null

  const turns = Array.isArray(interview.messages) ? interview.messages : []
  if (!turns.length) throw new Error('Interview transcript missing — cannot generate atom')

  // Fetch clinician name + voice substrate
  let staffName = ''
  let voiceNotes    = ''
  let voicePhrases  = []
  const [clinRes, phrasesRes] = await Promise.all([
    sb(`staff?id=eq.${interview.staff_id}&${wsFilter}&select=name,voice_notes`),
    sb(
      `staff_voice_phrases?staff_id=eq.${interview.staff_id}&${wsFilter}` +
      `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`,
    ),
  ])
  if (clinRes.ok) {
    const clinRows = await clinRes.json()
    staffName = clinRows[0]?.name ?? ''
    voiceNotes    = clinRows[0]?.voice_notes ?? ''
  }
  if (phrasesRes.ok) {
    voicePhrases = await phrasesRes.json()
  }

  // Augment with learned practice knowledge from the concept graph (non-blocking).
  const conceptBlock = await getContextBlock({ workspaceId: ws.id, topic: interview.topic })

  // Resolve audience + story_type keys to display labels for prompt injection.
  const audienceLabel = interview.audience
    ? (Array.isArray(ws.audience_options) ? ws.audience_options.find(s => s.key === interview.audience) : null)?.label ?? interview.audience
    : null
  const storyTypeLabel = interview.story_type
    ? (Array.isArray(ws.story_type_options) ? ws.story_type_options.find(s => s.key === interview.story_type) : null)?.label ?? interview.story_type
    : null

  // Active tentpole campaign flows into derivative content only.
  const activeCampaign = await loadCurrentTentpole(ws.id, interview.staff_id || null)
  const campaignContext = await getTentpolePromptContext(activeCampaign, ws)

  // A2 — GBP cross-promo. Resolve the active campaign's subject location ONCE
  // so the caller's per-listing GBP loop can tailor each listing without an N+1.
  const gbpSubjectLocation = await resolveCampaignSubjectLocation(activeCampaign, ws)

  // Phase 5 Feature 2 — this clinician's prior thinking block, shared across the
  // canonical atom call AND any per-location GBP variant calls the caller runs.
  const ownHistoryBlock = interview.staff_id
    ? await resolveOwnHistoryBlock({
        workspaceId:        ws.id,
        staffId:        interview.staff_id,
        excludeInterviewId: interview.id,
        query:              buildRagQuery(interview),
      })
    : ''

  // Ground the "link in bio" article claim in reality — see blogLinkStatus.js.
  const hasPublishedArticle = await hasPublishedBlogArticle(sb, ws.id, interview.id)

  // Build the focused atom prompt
  const systemPrompt = getAtomSystemPrompt(
    ws,
    staffName,
    interview.topic,
    atom.platform,
    atom.angle,
    interview.voice_mode || 'practice',
    interview.tone || 'smart',
    voiceNotes,
    (ws.brand_guidelines || '') + conceptBlock,
    voicePhrases,
    audienceLabel,
    storyTypeLabel,
    campaignContext,
    ownHistoryBlock,
    hasPublishedArticle,
  )
  if (!systemPrompt) throw new Error(`No prompt defined for ${atom.platform}/${atom.angle}`)

  // Replay the interview as the original conversation, then ask for the atom.
  const editorialBlock = blogPost
    ? `\n\nHere is the editorial summary that has already been written on this topic:\n\n` +
      `<editorial-summary>\n${blogPost}\n</editorial-summary>\n\nUse it only for thematic alignment — pull voice, examples, and specifics from our conversation above.`
    : ''
  const aiMessages = [
    ...turns.map((m) => ({ role: m.role, content: m.content })),
    {
      role: 'user',
      content:
        `Now write the ${atom.platform} piece (angle: ${atom.angle}) per the instructions in the system prompt. ` +
        `Pull voice, examples, and specifics from our conversation above — that is the source of truth.` +
        editorialBlock,
    },
  ]

  // Call the AI — first attempt
  const { text: rawText1 } = await generateText({
    model: 'anthropic/claude-sonnet-4-6',
    instructions: systemPrompt,
    messages: aiMessages,
    maxOutputTokens: 1000,
  })

  if (!rawText1?.trim()) throw new Error('AI returned empty content')

  // Voice-judge gate: score the draft against the interview transcript + voice
  // profile. If below threshold, try once more with the red_flag as coaching.
  const HAIKU = 'anthropic/claude-haiku-4-5'
  const clinicianSaid = turns
    .filter((t) => t.role === 'user')
    .map((t) => t.content)
    .join('\n\n')
    .slice(0, TRANSCRIPT_MAX)
  const caption1 = extractProvenanceBlock(rawText1.trim()).content.split('---SLIDES---')[0].trim()

  let rawText      = rawText1
  let voiceScore   = null
  let voiceAttempts = 1

  try {
    const ep1 = buildFidelityPrompt({
      topic: interview.topic, caption: caption1,
      transcript: clinicianSaid, phrases: voicePhrases,
      staffName, workspaceName: ws.name || ws.slug || 'practice',
    })
    const { text: evalRaw1 } = await generateText({
      model: HAIKU, instructions: ep1.instructions,
      messages: [{ role: 'user', content: ep1.user }],
      maxOutputTokens: 240,
    })
    voiceScore = parseFidelity(evalRaw1, {
      model: HAIKU, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[draftAtom] voice-judge eval-1 failed:', e.message)
  }

  if (voiceScore && voiceScore.overall < GATE) {
    const redFlag = voiceScore.breakdown?.red_flag || 'voice drift from transcript'
    try {
      const { text: rawText2 } = await generateText({
        model: 'anthropic/claude-sonnet-4-6',
        instructions: systemPrompt,
        messages: [
          ...aiMessages,
          { role: 'assistant', content: rawText1.trim() },
          {
            role: 'user',
            content: `That draft was flagged: "${redFlag}". Please rewrite it, staying much closer to the actual words and speaking style from our conversation. Don't smooth or professionalize — capture what was actually said.`,
          },
        ],
        maxOutputTokens: 1000,
      })
      if (rawText2?.trim()) {
        voiceAttempts = 2
        rawText = rawText2
        const caption2 = extractProvenanceBlock(rawText2.trim()).content.split('---SLIDES---')[0].trim()
        const ep2 = buildFidelityPrompt({
          topic: interview.topic, caption: caption2,
          transcript: clinicianSaid, phrases: voicePhrases,
          staffName, workspaceName: ws.name || ws.slug || 'practice',
        })
        const { text: evalRaw2 } = await generateText({
          model: HAIKU, instructions: ep2.instructions,
          messages: [{ role: 'user', content: ep2.user }],
          maxOutputTokens: 240,
        })
        const score2 = parseFidelity(evalRaw2, {
          model: HAIKU, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(),
        })
        if (score2) voiceScore = score2
      }
    } catch (e) {
      console.warn('[draftAtom] voice-judge regen failed:', e.message)
      rawText = rawText1  // keep first attempt on regen failure
    }
  }

  // Split slides block from caption on the final rawText. Instagram prompts append
  // a ---SLIDES--- JSON section; other platforms don't. Also strip the
  // <PROVENANCE> trailer — it's metadata, not body copy.
  const [captionRaw, slidesRaw] = extractProvenanceBlock(rawText.trim()).content.split('---SLIDES---')
  const caption = captionRaw.trim()

  let slides = null
  if (slidesRaw) {
    try {
      const jsonStr = slidesRaw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed) && parsed.length > 0) {
        slides = parsed
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({
            photo_idx: null,
            template: typeof s.template === 'string' ? s.template : 'custom',
            blocks: Array.isArray(s.blocks)
              ? s.blocks
                  .filter((b) => b && typeof b === 'object' && typeof b.text === 'string' && b.text.trim() !== '')
                  .map((b) => ({
                    role: typeof b.role === 'string' ? b.role : 'body',
                    text: b.text.trim(),
                    position: b.position ?? 'center',
                  }))
              : [],
          }))
          .filter((s, idx) => idx === 0 || s.blocks.length > 0 || s.template === 'demonstration')
        if (slides.length === 0) slides = null
      }
    } catch (e) {
      console.warn('[draftAtom] Failed to parse ---SLIDES--- JSON:', e.message)
      slides = null
    }
  }

  // Compute the gate tier + the voice_audit payload (behavior-identical to draft.js).
  //   'passed' — at/above GATE (or unscored).
  //   'held'   — SHORT caption below GATE → a real drift flag.
  //   'soft'   — long-form below GATE → informational only.
  let gate = 'passed'
  let voiceAudit = null
  if (voiceScore) {
    if (voiceScore.overall < GATE) gate = caption.length <= HARD_GATE_MAX_CHARS ? 'held' : 'soft'
    voiceAudit = { ...voiceScore.breakdown, attempts: voiceAttempts, gate }
  }

  return {
    caption,
    slides,
    voiceScore,
    voiceAudit,
    voiceAttempts,
    gate,
    staffName,
    model: 'anthropic/claude-sonnet-4-6',
    aiMessages,
    gbpContext: {
      staffName,
      voiceNotes,
      voicePhrases,
      conceptBlock,
      audienceLabel,
      storyTypeLabel,
      activeCampaign,
      campaignContext,
      gbpSubjectLocation,
      ownHistoryBlock,
    },
  }
}

/**
 * For a GBP atom, generate a per-location caption variant for every active
 * workspace_location with a gbp_location_id. Extracted verbatim from draft.js so
 * the interactive route AND the pre-draft path fan out GBP listings identically.
 * Returns the `location_overrides` object ({ [locationId]: {content, location_name,
 * generated_at} }) — the caller PATCHes it onto the content_item (no DB write here).
 * Returns {} when the atom isn't GBP or there are no configured locations.
 * Failures per-location are non-blocking (canonical caption is kept).
 *
 * @param {object} a
 * @param {object} a.ws
 * @param {object} a.atom        needs platform, angle
 * @param {object} a.interview   needs topic, voice_mode, tone
 * @param {string} a.staffName
 * @param {object[]} a.aiMessages  the exact messages draftAtom used
 * @param {object} a.gbpContext    from draftAtom's return
 * @returns {Promise<Record<string, {content:string, location_name:string, generated_at:string}>>}
 */
export async function buildGbpLocationVariants({ ws, atom, interview, staffName, aiMessages, gbpContext }) {
  if (atom.platform !== 'gbp') return {}
  const {
    voiceNotes, voicePhrases, conceptBlock, audienceLabel, storyTypeLabel,
    activeCampaign, campaignContext, gbpSubjectLocation, ownHistoryBlock,
  } = gbpContext || {}

  const locsRes = await sb(
    `workspace_locations?workspace_id=eq.${ws.id}&status=eq.active&gbp_location_id=not.is.null` +
    `&select=id,label,city,location_keyword`,
  )
  const locations = locsRes.ok ? ((await locsRes.json()) ?? []) : []
  if (!locations.length) return {}

  const variantEntries = await Promise.all(
    locations.map(async (loc) => {
      try {
        const locWs = { ...ws, location_keyword: loc.location_keyword ?? loc.city }
        // A2 — tailor the campaign focus block for THIS listing when the active
        // campaign promotes a location: the subject's own listing gets "we're
        // here" copy, every other listing cross-promotes the sister clinic.
        const locCampaignContext = gbpSubjectLocation
          ? buildTentpoleGbpLocationBlock({
              campaign: activeCampaign,
              workspace: ws,
              publishingLocation: loc,
              subjectLocation: gbpSubjectLocation,
            })
          : campaignContext
        const locPrompt = getAtomSystemPrompt(
          locWs,
          staffName,
          interview.topic,
          'gbp',
          atom.angle,
          interview.voice_mode || 'practice',
          interview.tone || 'smart',
          voiceNotes,
          (ws.brand_guidelines || '') + conceptBlock,
          voicePhrases,
          audienceLabel,
          storyTypeLabel,
          locCampaignContext,
          ownHistoryBlock,
        )
        if (!locPrompt) return null
        const { text: locText } = await generateText({
          model: 'anthropic/claude-sonnet-4-6',
          instructions: locPrompt,
          messages: aiMessages,
          maxOutputTokens: 1000,
        })
        if (!locText?.trim()) return null
        return [loc.id, {
          content:       extractProvenanceBlock(locText.trim()).content,
          location_name: loc.label ?? loc.city,
          generated_at:  new Date().toISOString(),
        }]
      } catch (locErr) {
        console.error('[draftAtom] location variant failed', loc.id, locErr.message)
        return null
      }
    }),
  )
  return Object.fromEntries(variantEntries.filter(Boolean))
}

export { GATE, TRANSCRIPT_MAX, HARD_GATE_MAX_CHARS }
