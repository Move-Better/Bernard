// The Standing Producer's pre-draft agent (Phase 3).
//
// Inverts the on-demand draft posture: instead of a caption existing only when a
// human clicks Draft, the producer drafts the UPCOMING week's planned-but-undrafted
// slots ahead of Monday — fully grounded, voice-judged, gate-filtered — so Monday's
// /week is a review session, not a workbench.
//
// A "planned slot needing a draft" = a content_plan_atoms row for the upcoming
// week (plan_week = next Monday) that is scheduled (scheduled_at set), still
// `status='pending'`, has NO content_piece_id yet, and is linked to an interview
// (interview_id) — the draft path's hard requirement. Atoms already drafted by a
// human (or a prior tick) are filtered out; the pending→drafting optimistic claim
// makes a concurrent human Draft click and this loop mutually exclusive (the same
// concurrency defense draft.js uses).
//
// Reuses draftAtom + buildGbpLocationVariants so a pre-drafted piece is byte-for-
// byte what the interactive /api/content-plan/draft route would have produced —
// PLUS a voice_audit.predrafted marker (JSONB, no schema change).
//
// SACRED INVARIANTS: only ever writes status='draft'. NEVER approves, schedules,
// or publishes. Best-effort agent-action ledger writes never block. Called by
// agent-tick per enabled workspace with the `pre_draft_week` lane on; caps the
// number drafted per invocation so a big week drains over several ticks.

import { mondayOf } from '../strategist.js'
import { draftAtom, buildGbpLocationVariants } from './draftAtom.js'
import { recordAgentAction } from '../agentActions.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
// Default per-invocation drafting cap: a 6-slot week drains over ~3 ticks,
// smoothing model spend and the tick's 300s budget. Overridable per call.
const DEFAULT_PREDRAFT_CAP = 2

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

/**
 * Draft one atom end-to-end into a content_items row (status='draft'). Mirrors the
 * DB-write sequence of api/_routes/content-plan/draft.js exactly: claim → interview
 * fetch → draftAtom → content_item insert → voice PATCH → GBP variants → mark atom
 * drafted → ledger; with the same orphan-cleanup on failure. Returns a result
 * object; never throws (the caller keeps going to the next atom).
 *
 * @param {object} a
 * @param {object} a.ws     workspace row (needs id, producer_config, name/slug,
 *                          brand_guidelines, audience_options, story_type_options)
 * @param {object} a.atom   content_plan_atoms row (needs id, platform, angle,
 *                          interview_id)
 * @returns {Promise<{status:'drafted'|'skipped'|'failed', reason?:string,
 *                     contentItemId?:string, score?:number}>}
 */
async function predraftOneAtom({ ws, atom }) {
  const wsFilter = `workspace_id=eq.${ws.id}`

  if (!atom.interview_id) return { status: 'skipped', reason: 'no_interview' }

  // Optimistically claim the atom: pending→drafting guarded on status=eq.pending,
  // so a human Draft click racing this loop wins/loses atomically (draft.js:79).
  const claimRes = await sb(`content_plan_atoms?id=eq.${atom.id}&${wsFilter}&status=eq.pending`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'drafting', updated_at: new Date().toISOString() }),
  })
  if (!claimRes.ok) return { status: 'skipped', reason: 'claim_failed' }
  const claimRows = await claimRes.json().catch(() => [])
  if (!Array.isArray(claimRows) || !claimRows.length) {
    // Lost the race (human drafted it, or another tick claimed it) — no-op.
    return { status: 'skipped', reason: 'already_claimed' }
  }

  let insertedContentPieceId = null
  try {
    // Fetch the interview (same SELECT the route uses so draftAtom has every field).
    const ivRes = await sb(
      `interviews?id=eq.${atom.interview_id}&${wsFilter}` +
      `&select=outputs,topic,tone,voice_mode,staff_id,location_id,created_at,messages,audience,story_type`
    )
    if (!ivRes.ok) throw new Error('Could not fetch interview')
    const ivRows = await ivRes.json()
    if (!ivRows.length) throw new Error('Interview not found')
    const interview = ivRows[0]

    // Generation + voice-judge core (shared with the interactive route).
    const {
      caption, slides, voiceScore, voiceAudit, voiceAttempts, staffName, aiMessages, gbpContext,
    } = await draftAtom({ ws, atom, interview })

    // Create the content_item. status='draft' + scheduled_at null — a pre-draft is
    // NEVER auto-approved/scheduled; a human approves it on /week. The predrafted
    // marker rides in voice_audit (JSONB, no schema change) for /week + analytics.
    const predraftedAudit = voiceAudit
      ? { ...voiceAudit, predrafted: true }
      : { predrafted: true }
    const itemPayload = {
      workspace_id:   ws.id,
      interview_id:   atom.interview_id,
      staff_id:   interview.staff_id,
      staff_name: staffName,
      topic:          interview.topic,
      platform:       atom.platform,
      content:        caption,
      ai_original_content: caption,
      slides,
      overlay_text:   null,
      status:         'draft',
      media_urls:     [],
      location_id:    interview.location_id ?? null,
      // Persist the voice score up front (the route PATCHes it post-insert via
      // waitUntil; here we set it inline since we're already off the hot path).
      ...(voiceScore ? { voice_fidelity_score: Math.round(voiceScore.overall * 10) } : {}),
      voice_audit:    predraftedAudit,
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
    if (atom.platform === 'gbp') {
      const overrides = await buildGbpLocationVariants({ ws, atom, interview, staffName, aiMessages, gbpContext })
      if (Object.keys(overrides).length > 0) {
        await sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({ location_overrides: overrides, updated_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        }).catch((e) => console.warn('[predraftWeek] gbp overrides patch failed:', e?.message))
      }
    }

    // Mark the atom drafted + bind the content piece (guarded on the workspace).
    const updatedAtomRes = await sb(`content_plan_atoms?id=eq.${atom.id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:           'drafted',
        content_piece_id: contentPiece.id,
        updated_at:       new Date().toISOString(),
      }),
    })
    if (!updatedAtomRes.ok) throw new Error(`atom status update failed: ${updatedAtomRes.status}`)
    const updatedAtomRows = await updatedAtomRes.json()
    if (!updatedAtomRows.length) throw new Error('atom status update matched 0 rows — concurrent modification')

    // Workday ledger. Same kind ('draft_created') the interactive route records;
    // detail carries predrafted:true so the feed can read as a proactive standup.
    const draftScore = voiceScore ? Math.round(voiceScore.overall * 10) : null
    await recordAgentAction({
      workspaceId:    ws.id,
      producerConfig: ws.producer_config,
      kind:           'draft_created',
      title:          `Pre-drafted "${interview.topic || 'a piece'}" for ${atom.platform}${draftScore !== null ? ` — voice ${draftScore}/100` : ''}`,
      detail:         { platform: atom.platform, angle: atom.angle, score: draftScore, attempts: voiceAttempts, predrafted: true, gate: voiceAudit?.gate ?? null },
      contentItemId:  contentPiece.id,
      atomId:         atom.id,
      interviewId:    interview.id,
      model:          'anthropic/claude-sonnet-4-6',
    })

    return { status: 'drafted', contentItemId: contentPiece.id, score: draftScore }
  } catch (e) {
    // Orphan cleanup, exactly as the route: delete any inserted content_item before
    // resetting the atom; only reset to pending if the cleanup succeeded (a failed
    // delete would let a retry insert a SECOND orphan — leave the atom non-pending).
    let cleanupFailed = false
    if (insertedContentPieceId) {
      const deleteRes = await sb(`content_items?id=eq.${insertedContentPieceId}&${wsFilter}`, {
        method: 'DELETE', headers: { Prefer: 'return=minimal' },
      })
      if (!deleteRes.ok) {
        cleanupFailed = true
        console.error('[predraftWeek] cleanup delete failed', insertedContentPieceId, deleteRes.status)
      }
    }
    if (!cleanupFailed) {
      await sb(`content_plan_atoms?id=eq.${atom.id}&${wsFilter}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      }).catch(() => {})
    }
    console.error('[predraftWeek] atom draft failed', atom.id, e?.message)
    return { status: 'failed', reason: (e?.message || 'error').slice(0, 200) }
  }
}

/**
 * Pre-draft up to `cap` of the UPCOMING week's planned-but-undrafted slots for a
 * workspace. The caller (agent-tick) is responsible for gating on
 * laneEnabled(config, 'pre_draft_week') and the daily spend cap BEFORE calling;
 * this function does the slot discovery + drafting.
 *
 * @param {object} a
 * @param {object} a.ws     workspace row (must include id + producer_config)
 * @param {number} [a.cap]  max atoms to draft this invocation (default 2)
 * @returns {Promise<{ weekMonday:string, candidates:number, drafted:number,
 *                     skipped:number, failed:number, results:object[] }>}
 */
export async function predraftWeek({ ws, cap = DEFAULT_PREDRAFT_CAP }) {
  const wsFilter = `workspace_id=eq.${ws.id}`
  // Upcoming week = the Monday one week ahead of the current week's Monday.
  const nextMonday = mondayOf(new Date(Date.now() + WEEK_MS).toISOString())

  // Planned-but-undrafted slots for the upcoming week: scheduled (has a slot on the
  // calendar), still pending, not yet bound to a content piece, and linked to an
  // interview (draftAtom's requirement). Oldest scheduled_at first so the earliest
  // slots fill first. content_piece_id=is.null belt-and-suspenders alongside
  // status=eq.pending (a drafted atom is status='drafted' AND has a piece id).
  const slotsRes = await sb(
    `content_plan_atoms?${wsFilter}&plan_week=eq.${nextMonday}` +
    `&scheduled_at=not.is.null&status=eq.pending&content_piece_id=is.null&interview_id=not.is.null` +
    `&select=id,platform,angle,interview_id,scheduled_at&order=scheduled_at.asc&limit=25`
  )
  if (!slotsRes.ok) {
    console.error('[predraftWeek] slot fetch failed', slotsRes.status)
    return { weekMonday: nextMonday, candidates: 0, drafted: 0, skipped: 0, failed: 0, results: [] }
  }
  const slots = (await slotsRes.json().catch(() => [])) || []

  const result = { weekMonday: nextMonday, candidates: slots.length, drafted: 0, skipped: 0, failed: 0, results: [] }
  // Draft sequentially up to the cap (one model chain at a time keeps us well
  // inside the tick budget and avoids a burst of parallel gateway calls).
  for (const atom of slots) {
    if (result.drafted >= cap) break
    const r = await predraftOneAtom({ ws, atom })
    result.results.push({ atomId: atom.id, ...r })
    if (r.status === 'drafted') result.drafted++
    else if (r.status === 'failed') result.failed++
    else result.skipped++
  }
  return result
}

// Exported for reuse/testing.
export { predraftOneAtom, DEFAULT_PREDRAFT_CAP }
