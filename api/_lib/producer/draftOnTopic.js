// draftOnTopic — the Standing Producer's `ad_hoc_drafts` lane (F20).
//
// The ONE lane a human triggers on demand: they type an open topic into the box
// on /producer ("draft something about winter running injuries") and pick a
// channel. This handler grounds that topic in a REAL interview, drafts one piece
// for the chosen platform via the shared draftAtom core, and lands it as
// status='draft' on /week — the exact same human-gated path the interactive draft
// route and pre-draft use. NEVER approves, schedules, or publishes.
//
// GROUNDED-ONLY (the moat): if no interview covers the topic, it does NOT
// fabricate an ungrounded piece — it escalates honestly (records a
// 'draft_request_unmet' action the "Needs you" strip surfaces as "record a quick
// interview?"). Mirrors authorAnswers' "skip when there's no coverage" posture.
//
// Reuses draftAtom + buildGbpLocationVariants so an ad-hoc piece is byte-for-byte
// what the interactive route / pre-draft would have produced — plus a
// voice_audit.ad_hoc marker (JSONB, no schema change). Called by agent-tick per
// claimed 'draft_on_topic' inbox item, inside the daily AI-call budget.

import { draftAtom, buildGbpLocationVariants } from './draftAtom.js'
import { recordAgentAction } from '../agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Platforms the box offers. draftAtom (via getAtomSystemPrompt) has a prompt for
// each of these; any other platform has no atom prompt and would throw. Keep in
// sync with the client dropdown AND the request route's allowlist.
const SUPPORTED_PLATFORMS = new Set(['instagram', 'facebook', 'linkedin', 'gbp'])

// getAtomSystemPrompt's `angle` param is NOT free text — it's a fixed per-platform
// content-style key (atomPrompts.js's `instructions` object; e.g. instagram has
// hook/quick_win/clinical_insight/cta). The prompt's SUBJECT comes from
// `interview.topic`, not `angle`. An ad-hoc request has no planned angle (unlike a
// content_plan_atoms row, which the strategist assigns one), so pick one sensible
// default per platform — "lead with the most interesting/surprising thing from the
// conversation" is the best general-purpose framing for an open-ended human ask.
const DEFAULT_ANGLE = {
  instagram: 'hook',
  facebook:  'educational',
  linkedin:  'clinical_perspective',
  gbp:       'local_authority',
}

// Background/lib reads; workspace_id is always supplied by the caller's ws and
// every query below is scoped by it. (require-workspace-scope only lints _routes.)
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(15_000),
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

// Pull the most specific keyword from the requested topic (longest word ≥4 chars),
// the same heuristic authorAnswers.pickClinician uses — a generic short word
// ('pain', 'back') would falsely match interviews the topic isn't really about,
// producing an off-topic "grounded" draft. Longest-word bias favours specificity.
function topicKeyword(topic) {
  const words = String(topic || '').toLowerCase().match(/[a-z]{4,}/g) || []
  return words.sort((a, b) => b.length - a.length)[0] || null
}

// Find the interview to ground this topic in: the most recent interview with a
// real transcript + a clinician whose topic contains the keyword. Returns the
// interview row (draftAtom's required shape) or null → the caller escalates.
async function findGroundingInterview({ wsId, topic }) {
  const kw = topicKeyword(topic)
  if (!kw) return null
  // Same SELECT predraftWeek uses so draftAtom has every field it reads.
  const sel = 'id,outputs,topic,tone,voice_mode,staff_id,location_id,created_at,messages,audience,story_type'
  const r = await sb(
    `interviews?workspace_id=eq.${wsId}&topic=ilike.*${encodeURIComponent(kw)}*&staff_id=not.is.null` +
    `&select=${sel}&order=created_at.desc&limit=10`,
  )
  if (!r.ok) return null
  const rows = (await r.json().catch(() => [])) || []
  // Require a non-empty transcript — draftAtom throws on an empty messages array.
  return rows.find((iv) => Array.isArray(iv.messages) && iv.messages.length > 0) || null
}

/**
 * Draft one piece for a human-typed topic + chosen platform. Returns a status the
 * agent-tick dispatch loop maps to a terminal inbox outcome:
 *   'drafted'   — a content_items draft landed on /week            (→ inbox 'done')
 *   'escalated' — no grounding interview; surfaced to the human    (→ inbox 'done')
 *   'skipped'   — bad input / unsupported platform                 (→ inbox 'skipped')
 * The "no coverage" case never throws (it's the expected miss). A genuine mid-draft
 * failure DOES throw, so the tick's attempt-cap/retry logic handles it and finalizes
 * the item as 'failed' after MAX_ATTEMPTS — same posture as the revise lane.
 *
 * @param {object} a
 * @param {object} a.ws            workspace row (needs id, producer_config, name/slug,
 *                                 brand_guidelines, audience_options, story_type_options)
 * @param {string} a.topic         the human's free-text topic
 * @param {string} a.platform      chosen channel (instagram|facebook|linkedin|gbp)
 * @param {string|null} [a.requestedBy]  clerk user id of the requester (ledger only)
 * @param {string} [a.inboxItemId]
 */
export async function draftOnTopic({ ws, topic, platform, requestedBy, inboxItemId }) {
  const cleanTopic = String(topic || '').trim()
  if (!cleanTopic) return { status: 'skipped', reason: 'empty_topic' }
  if (!SUPPORTED_PLATFORMS.has(platform)) return { status: 'skipped', reason: `unsupported_platform:${platform}` }

  const interview = await findGroundingInterview({ wsId: ws.id, topic: cleanTopic })
  if (!interview) {
    // Grounded-only: no interview covers this → escalate honestly, never fabricate.
    // `model` is omitted ON PURPOSE — no LLM call was spent, so this must NOT count
    // against the daily AI-call cap (todaysAiCalls counts only model-set actions).
    await recordAgentAction({
      workspaceId:    ws.id,
      producerConfig: ws.producer_config,
      kind:           'draft_request_unmet',
      title:          `Nothing from the team on “${cleanTopic.slice(0, 60)}” yet — record a quick interview?`,
      detail:         { requested_topic: cleanTopic, platform, requested_by: requestedBy || null, reason: 'no_grounding_interview' },
      inboxItemId,
    })
    return { status: 'escalated', reason: 'no_grounding_interview' }
  }

  const wsFilter = `workspace_id=eq.${ws.id}`
  // Synthesize an atom: the chosen platform + a sensible default angle (see
  // DEFAULT_ANGLE above — angle is a fixed style key, not the human's topic text),
  // grounded in the interview we matched. NO content_plan_atoms row is created —
  // this is an ad-hoc piece, not a planned slot — so atom.id stays null and the
  // ledger records no atom_id.
  const atom = { id: null, platform, angle: DEFAULT_ANGLE[platform], interview_id: interview.id }

  let insertedContentPieceId = null
  try {
    // Generation + voice-judge core (shared with the interactive route + pre-draft).
    const {
      caption, slides, voiceScore, voiceAudit, voiceAttempts, staffName, aiMessages, gbpContext,
    } = await draftAtom({ ws, atom, interview })

    // status='draft' + scheduled_at null — an ad-hoc draft is NEVER auto-approved or
    // scheduled; a human approves it on /week. The ad_hoc marker rides in voice_audit
    // (JSONB, no schema change) so /week + the feed can read it as a requested piece.
    const adHocAudit = voiceAudit ? { ...voiceAudit, ad_hoc: true } : { ad_hoc: true }
    const itemPayload = {
      workspace_id:        ws.id,
      interview_id:        interview.id,
      staff_id:            interview.staff_id,
      staff_name:          staffName,
      // The piece's label is what the human typed (that's what /week shows); it
      // shares the matched keyword with the grounding interview, so it's honest.
      topic:               cleanTopic,
      platform,
      content:             caption,
      ai_original_content: caption,
      slides,
      overlay_text:        null,
      status:              'draft',
      media_urls:          [],
      location_id:         interview.location_id ?? null,
      ...(voiceScore ? { voice_fidelity_score: Math.round(voiceScore.overall * 10) } : {}),
      voice_audit:         adHocAudit,
    }
    const itemRes = await sb('content_items', { method: 'POST', body: JSON.stringify(itemPayload) })
    if (!itemRes.ok) {
      const body = await itemRes.text().catch(() => '')
      throw new Error(`Could not create content item: ${body.slice(0, 200)}`)
    }
    const itemRows = await itemRes.json()
    const contentPiece = itemRows[0]
    insertedContentPieceId = contentPiece.id

    // GBP per-location variants (no-op unless the atom is GBP + locations exist).
    if (platform === 'gbp') {
      const overrides = await buildGbpLocationVariants({ ws, atom, interview, staffName, aiMessages, gbpContext })
      if (Object.keys(overrides).length > 0) {
        await sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({ location_overrides: overrides, updated_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        }).catch((e) => console.warn('[draftOnTopic] gbp overrides patch failed:', e?.message))
      }
    }

    // Workday ledger. Same 'draft_created' kind the interactive route + pre-draft
    // record; detail.ad_hoc marks it a human request, and the title says so plainly.
    const draftScore = voiceScore ? Math.round(voiceScore.overall * 10) : null
    await recordAgentAction({
      workspaceId:    ws.id,
      producerConfig: ws.producer_config,
      kind:           'draft_created',
      title:          `Drafted “${cleanTopic.slice(0, 60)}” for ${platform}${draftScore !== null ? ` — voice ${draftScore}/100` : ''} — you asked for this one`,
      detail:         {
        platform, requested_topic: cleanTopic, angle: atom.angle, score: draftScore, attempts: voiceAttempts,
        ad_hoc: true, requested_by: requestedBy || null, gate: voiceAudit?.gate ?? null,
        grounded_in_interview_id: interview.id, grounded_in_topic: interview.topic || null,
      },
      contentItemId:  contentPiece.id,
      interviewId:    interview.id,
      model:          'anthropic/claude-sonnet-4-6', // counts as 1 AI call against the daily cap
    })

    return { status: 'drafted', contentItemId: contentPiece.id, score: draftScore }
  } catch (e) {
    // Orphan cleanup: delete any inserted content_item before rethrowing, so the
    // tick's retry can't leave a half-written piece behind. (No atom to reset —
    // ad-hoc requests create no content_plan_atoms row.)
    if (insertedContentPieceId) {
      await sb(`content_items?id=eq.${insertedContentPieceId}&${wsFilter}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      }).catch((err) => console.error('[draftOnTopic] cleanup delete failed', insertedContentPieceId, err?.message))
    }
    console.error('[draftOnTopic] draft failed', ws.id, e?.message)
    throw e // let agent-tick's attempt-cap/retry finalize it (→ 'failed' after MAX_ATTEMPTS)
  }
}

// Exported for reuse/testing.
export { SUPPORTED_PLATFORMS, DEFAULT_ANGLE, topicKeyword }
