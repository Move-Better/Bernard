// Story builder — the load-bearing piece of the IA refactor.
//
// A "story" anchors on an `interviews` row with `content_items` rolled
// up. Three Stories views (Cards / Pipeline / Calendar) and the Story
// Detail page all consume this same shape. Get this wrong here and
// every consumer has to rewrite. Get it right and the consumers stay
// thin.
//
// This file is pure — no fetching, no React, no clock. The hooks that
// drive it (useStories / useStory) land in PR 2 alongside queryKeys.
//
// See .claude/plans/2026-05-13-ia-refactor.md §3 for the canonical
// data-shape contract.

/**
 * Derive the high-level pipeline stage of a story.
 *
 * Rules (first match wins):
 *   1. interview.status !== 'completed'                          → 'capture'
 *   2. pieces is empty                                           → 'drafting'
 *   3. any piece published AND none scheduled/in_review          → 'published'
 *   4. any piece scheduled                                       → 'scheduled'
 *   5. any piece in_review                                       → 'review'
 *   6. otherwise                                                 → 'drafting'
 *
 * @param {{status?: string}} interview
 * @param {Array<{status?: string}>} pieces
 * @returns {'capture'|'drafting'|'review'|'scheduled'|'published'}
 */
export function deriveStoryStage(interview, pieces) {
  if (!interview || interview.status !== 'completed') return 'capture'
  const list = Array.isArray(pieces) ? pieces : []
  if (list.length === 0) return 'drafting'

  let hasPublished = false
  let hasScheduled = false
  let hasInReview = false
  for (const p of list) {
    if (p?.status === 'published') hasPublished = true
    else if (p?.status === 'scheduled') hasScheduled = true
    else if (p?.status === 'in_review') hasInReview = true
  }

  if (hasPublished && !hasScheduled && !hasInReview) return 'published'
  if (hasScheduled) return 'scheduled'
  if (hasInReview) return 'review'
  return 'drafting'
}

/**
 * Derive the bank-era DISPLAY stage of a story (Moments IA, decisions.md
 * 2026-07-27). Display-layer only — `story_stage` (deriveStoryStage above)
 * stays the machine the quick-filter pills and Overview lenses key on.
 *
 *   captured  — nothing banked from this story yet (incl. still-processing)
 *   processed — moments banked, but nothing has come of them yet
 *   yielding  — the story has produced something: a moment was drawn into a
 *               planned piece (≥1 use), or a piece made it past review
 *               (approved / scheduled / published). A story is never "done" —
 *               it yields.
 *
 * @param {{ moments_count?: number, moment_uses?: number, pieces?: Array }} story
 * @returns {'captured'|'processed'|'yielding'}
 */
export function deriveBankStage(story) {
  const pieces = Array.isArray(story?.pieces) ? story.pieces : []
  const uses = story?.moment_uses ?? 0
  const yielded =
    uses > 0 ||
    pieces.some(
      (p) =>
        p?.status === 'published' ||
        p?.status === 'approved' ||
        p?.status === 'scheduled' ||
        !!p?.published_at,
    )
  if (yielded) return 'yielding'
  if ((story?.moments_count ?? 0) > 0) return 'processed'
  return 'captured'
}

function fmtShortDay(iso) {
  if (!iso) return ''
  const d = new Date(iso)
  if (Number.isNaN(d.getTime())) return ''
  return d.toLocaleDateString('en-US', { month: 'short', day: 'numeric' })
}

/**
 * The Yield cell for the Stories table (mockup §03 shapes, verified against
 * the real rows the mockup drew: uses beat published beat blog-ready):
 *
 *   "7 moments · blog ready · no uses yet"
 *   "12 moments · 1 use · last Jul 28"
 *   "13 moments · 4 pieces published"
 *
 * @param {{ status?: string, moments_count?: number, moment_uses?: number,
 *           moment_last_used_at?: string|null, pieces?: Array }} story
 * @returns {{ processing: boolean, moments: number, detail: string }}
 */
export function yieldSummary(story) {
  const pieces = Array.isArray(story?.pieces) ? story.pieces : []
  const moments = story?.moments_count ?? 0
  if (story?.status !== 'completed' && moments === 0) {
    return { processing: true, moments: 0, detail: '' }
  }
  const uses = story?.moment_uses ?? 0
  const published = pieces.filter((p) => p?.status === 'published' || !!p?.published_at).length
  const blogReady = pieces.some((p) => p?.platform === 'blog' && p?.status === 'approved')
  const ready = pieces.filter((p) => p?.status === 'approved' || p?.status === 'scheduled').length

  let detail
  if (uses > 0) {
    const last = fmtShortDay(story?.moment_last_used_at)
    detail = `${uses} ${uses === 1 ? 'use' : 'uses'}${last ? ` · last ${last}` : ''}`
  } else if (published > 0) {
    detail = `${published} ${published === 1 ? 'piece' : 'pieces'} published`
  } else if (blogReady) {
    detail = 'blog ready · no uses yet'
  } else if (ready > 0) {
    detail = `${ready} ready · no uses yet`
  } else if (moments > 0) {
    detail = 'no uses yet'
  } else {
    detail = 'no moments yet'
  }
  return { processing: false, moments, detail }
}

/**
 * Summarize a content_items row down to the fields the Stories views
 * actually care about. Keeps the on-the-wire object lean and prevents
 * accidental coupling to fields that change shape (e.g. `content` JSON,
 * `media_urls`).
 */
function summarizePiece(row) {
  return {
    id: row.id,
    platform: row.platform,
    status: row.status,
    scheduled_at: row.scheduled_at ?? null,
    published_at: row.published_at ?? null,
    updated_at: row.updated_at,
    provenance: row.provenance ?? null,
    voice_fidelity_score: row.voice_fidelity_score ?? null,
    voice_audit: row.voice_audit ?? null,
    performed_well: row.performed_well ?? false,
  }
}

const PIECE_STATUS_BUCKETS = ['draft', 'in_review', 'approved', 'scheduled', 'published', 'failed', 'rejected']

function emptyStatusBuckets() {
  return { draft: 0, in_review: 0, approved: 0, scheduled: 0, published: 0, failed: 0, rejected: 0 }
}

function maxTimestamp(values) {
  let max = null
  for (const v of values) {
    if (!v) continue
    if (max === null || v > max) max = v
  }
  return max
}

/**
 * Join staff-with-nested-interviews and content_items into a flat
 * list of Story objects.
 *
 * @param {Array} staff  — output of /api/db/staff (with `interviews[]`)
 * @param {Array} contentItems — output of /api/db/content (workspace-scoped)
 * @returns {Array<Story>}
 *
 * Defense-in-depth: any content_item whose workspace_id doesn't match
 * its parent interview's workspace_id is dropped and logged. Both
 * upstream endpoints already enforce workspace_id filtering — this is a
 * belt-and-suspenders guard, not the primary defense.
 */
export function buildStories(staff, contentItems) {
  const staffList = Array.isArray(staff) ? staff : []
  const itemList = Array.isArray(contentItems) ? contentItems : []

  // Index content_items by interview_id.
  const piecesByInterview = new Map()
  for (const item of itemList) {
    if (!item || !item.interview_id) continue
    const arr = piecesByInterview.get(item.interview_id)
    if (arr) arr.push(item)
    else piecesByInterview.set(item.interview_id, [item])
  }

  const stories = []
  for (const staffMember of staffList) {
    if (!staffMember) continue
    const interviews = Array.isArray(staffMember.interviews) ? staffMember.interviews : []
    for (const interview of interviews) {
      if (!interview || !interview.id) continue

      const allCandidates = piecesByInterview.get(interview.id) || []
      const matched = []
      for (const piece of allCandidates) {
        // Defense in depth: drop cross-workspace rows. Only applies
        // when both rows actually carry workspace_id (some callers
        // omit it from the select clause — we don't synthesize a
        // mismatch in that case).
        if (
          interview.workspace_id &&
          piece.workspace_id &&
          interview.workspace_id !== piece.workspace_id
        ) {

          console.warn(
            '[buildStories] dropping content_item with mismatched workspace_id',
            { item_id: piece.id, interview_id: interview.id },
          )
          continue
        }
        matched.push(piece)
      }

      const pieces = matched.map(summarizePiece)
      const piecesByStatus = emptyStatusBuckets()
      for (const p of pieces) {
        if (PIECE_STATUS_BUCKETS.includes(p.status)) {
          piecesByStatus[p.status] += 1
        }
      }

      const scheduledTimes = pieces
        .map((p) => p.scheduled_at)
        .filter((t) => !!t)
        .sort()
      const nextScheduledAt = scheduledTimes.length > 0 ? scheduledTimes[0] : null

      const pieceUpdates = pieces.map((p) => p.updated_at).filter(Boolean)
      const lastActivityAt = maxTimestamp([interview.updated_at, ...pieceUpdates])

      // Best verbatim quote for Themes contrasting-views display.
      // pull_quote_candidates is an array of { text, score } objects stored
      // by /api/interviews/pull-quotes when the interview completes.
      const pqc = Array.isArray(interview.pull_quote_candidates) ? interview.pull_quote_candidates : []
      const verbatim_snippet = pqc.length > 0
        ? (pqc[0].text || pqc[0].quote || null)
        : null

      stories.push({
        id: interview.id,
        workspace_id: interview.workspace_id || staffMember.workspace_id || null,
        staff_id: staffMember.id,
        staff_name: staffMember.name,
        staff_preferred_length: staffMember.preferred_length ?? null,
        topic: interview.topic,
        status: interview.status,
        capture_mode: interview.capture_mode || 'interview',
        owner_id: interview.owner_id ?? null,
        owner_email: interview.owner_email ?? null,
        location_id: interview.location_id ?? null,
        prototype_id: interview.prototype_id ?? null,
        campaign_id: interview.campaign_id ?? null,
        campaign_name: interview.campaign?.name ?? null,
        created_at: interview.created_at,
        updated_at: interview.updated_at,
        has_outputs: !!interview.outputs && Object.keys(interview.outputs).length > 0,
        verbatim_snippet,
        pieces,
        pieces_count: pieces.length,
        pieces_by_status: piecesByStatus,
        // Per-interview moment-bank aggregates — attached server-side by
        // /api/db/staff?view=card in one workspace-wide query (no N+1).
        // Absent on older cached payloads → 0/null, which degrades to the
        // pre-bank display (captured/processed never over-claims yield).
        moments_count: interview.moment_count ?? 0,
        moment_uses: interview.moment_uses ?? 0,
        moment_last_used_at: interview.moment_last_used_at ?? null,
        story_stage: deriveStoryStage(interview, pieces),
        next_scheduled_at: nextScheduledAt,
        last_activity_at: lastActivityAt || interview.updated_at || interview.created_at,
      })
    }
  }

  return stories
}
