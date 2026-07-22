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
import { clampToCap, platformCap } from '../socialLengthTargets.js'

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

// Fabrication signal from the voice judge (captionFidelityRubric emits
// invented_claims). Kept separate from the numeric `overall` so a piece with
// invented specifics but good voice can't average into a passing score — the
// exact way fabricated patient histories used to ship.
const isFabricated = (score) =>
  Array.isArray(score?.breakdown?.invented_claims) && score.breakdown.invented_claims.length > 0

// Sibling-caption dedup. One interview fans out into up to ~11 atoms across 4-5
// platforms over several weeks, and each atom used to be drafted in total
// isolation against the SAME transcript — so every generation independently
// picked the transcript's single most vivid moment. Measured on the movebetter
// workspace (45d window, 71 captions): one clinician quote appeared near-verbatim
// in 4 captions, one anecdote in 7, another in 5. The voice judge can't catch it
// either — none of its four dimensions measure novelty, and `said_fidelity`
// actively REWARDS reusing the most quotable line.
//
// Note `resolveOwnHistoryBlock` already guards the cross-interview case (it passes
// excludeInterviewId), which is exactly why the WITHIN-interview case had no guard
// at all. This is that missing half.
const SIBLING_MAX      = 8   // most recent N siblings; ~8 × 320 ≈ 2.5k prompt chars
const SIBLING_EXCERPT  = 320 // enough to identify the anecdote/quote, not the whole post

/**
 * Build the MOMENTS ALREADY USED block: excerpts of captions already drafted from
 * THIS interview, so the model steers to an unused part of the conversation.
 *
 * Best-effort — returns '' on any failure. Never throws: a dedup miss degrades
 * output quality, but a throw here would fail the whole draft.
 *
 * @param {object} a
 * @param {string} a.workspaceId
 * @param {string} a.interviewId
 * @param {string=} a.excludeContentPieceId  this atom's own prior draft (re-draft case)
 * @returns {Promise<string>}
 */
async function resolveSiblingCaptionsBlock({ workspaceId, interviewId, excludeContentPieceId }) {
  try {
    if (!workspaceId || !interviewId) return ''
    // Rejected pieces are excluded: their moment was never used publicly, so it's
    // still fair game — and a rejected draft is often rejected BECAUSE it was a
    // weak treatment of a moment worth revisiting.
    const res = await sb(
      `content_items?workspace_id=eq.${workspaceId}&interview_id=eq.${interviewId}` +
      `&content=not.is.null&status=not.in.(rejected)` +
      `&select=id,platform,content&order=created_at.desc&limit=${SIBLING_MAX + 1}`,
    )
    if (!res.ok) {
      console.error(`[draftAtom] sibling caption fetch failed: ${res.status}`)
      return ''
    }
    const rows = (await res.json())
      .filter((r) => r.id !== excludeContentPieceId)
      .filter((r) => typeof r.content === 'string' && r.content.trim().length > 40)
      .slice(0, SIBLING_MAX)
    if (!rows.length) return ''

    const list = rows
      .map((r, i) => {
        const excerpt = r.content.trim().replace(/\s+/g, ' ').slice(0, SIBLING_EXCERPT)
        return `${i + 1}. [${r.platform}] "${excerpt}${r.content.trim().length > SIBLING_EXCERPT ? '…' : ''}"`
      })
      .join('\n')

    return `

MOMENTS ALREADY USED — ${rows.length} other post${rows.length === 1 ? ' has' : 's have'} already been written from this SAME conversation. Each excerpt below is a moment, quote, story, or opening line that is already queued or published:

${list}

Do NOT build this piece around any of the moments above. Do not reuse their central anecdote, their hero quote, or their opening framing — a reader who follows more than one of our channels will see these back to back. Go find a DIFFERENT part of the conversation to build on.

If the conversation genuinely contains only ONE usable story, you may still touch it — but enter from a different angle, lead with a different line, and do not repeat the same quote verbatim. Never invent new material to avoid an overlap: staying faithful to what was actually said outranks novelty.`
  } catch (e) {
    console.error(`[draftAtom] resolveSiblingCaptionsBlock threw: ${e?.message}`)
    return ''
  }
}

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

  // Captions already written from THIS interview, so this atom picks an unused
  // moment instead of re-mining the transcript's single most vivid story.
  const siblingBlock = await resolveSiblingCaptionsBlock({
    workspaceId:           ws.id,
    interviewId:           interview.id,
    excludeContentPieceId: atom.content_piece_id || null,
  })

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
    siblingBlock,
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
      maxOutputTokens: 500,
    })
    voiceScore = parseFidelity(evalRaw1, {
      model: HAIKU, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(),
    })
  } catch (e) {
    console.warn('[draftAtom] voice-judge eval-1 failed:', e.message)
  }

  if (voiceScore && (voiceScore.overall < GATE || isFabricated(voiceScore))) {
    const invented = isFabricated(voiceScore) ? voiceScore.breakdown.invented_claims : []
    const redFlag = invented.length
      ? `You invented details that were NOT in our conversation: ${invented.join('; ')}. Remove them entirely — use only what was actually said.`
      : (voiceScore.breakdown?.red_flag || 'voice drift from transcript')
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
          maxOutputTokens: 500,
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
    const fabricated = isFabricated(voiceScore)
    // Fabrication ALWAYS holds for review — any length, any overall score. Invented
    // specifics must never wash out into a passing average (the pre-P2 bug where a
    // fabricated-but-well-voiced atom scored 7.25 and shipped).
    if (fabricated) gate = 'held'
    else if (voiceScore.overall < GATE) gate = caption.length <= HARD_GATE_MAX_CHARS ? 'held' : 'soft'
    voiceAudit = { ...voiceScore.breakdown, attempts: voiceAttempts, gate }
    // Make the invented specifics the visible hold reason on /week (week-summary
    // maps voice_audit.red_flag → voiceFlag), overriding whatever the judge picked
    // as "biggest issue" — for a held-on-fabrication piece, the invention IS it.
    if (fabricated) {
      voiceAudit.red_flag = `Invented details not in the interview: ${voiceScore.breakdown.invented_claims.join('; ')}`
    }
  }

  // Hard guardrail: never return a caption over the platform's character ceiling.
  // The length prompt (socialLengthTargets.lengthLine) asks the model to stay
  // under the cap, but that's a soft instruction it can overshoot — GBP's 1500
  // cap in particular was landing over-limit and the only enforcement was a
  // blind mid-sentence slice at publish time. Clamp here (sentence-aware) so the
  // stored caption the editor shows is always within cap. Applied AFTER the voice
  // judge so fidelity is scored on the full generated text, not the clamped copy.
  const cappedCaption = clampToCap(caption, platformCap(atom.platform))

  return {
    caption: cappedCaption,
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
      siblingBlock,
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
    activeCampaign, campaignContext, gbpSubjectLocation, ownHistoryBlock, siblingBlock,
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
          // hasPublishedArticle was never passed here (defaulted false); pass it
          // explicitly so adding siblingBlock after it can't change that behavior.
          false,
          siblingBlock,
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
          // GBP-only path — clamp each per-location variant to the 1500 cap too.
          content:       clampToCap(extractProvenanceBlock(locText.trim()).content, platformCap('gbp')),
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
