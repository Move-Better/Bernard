// GET /api/producer/checkpoints
//
// ProducerHome's mission-control feed (2026-07-29 planning session; see
// .claude/decisions.md same date, .claude/mockups/producer-home.html for the
// signed-off spec). Aggregates EVERY human approval/review checkpoint in the
// content pipeline — there are 17 of them, and until this endpoint, only 5
// had any aggregate surface at all (producer/needs-you.js).
//
// The central product decision this endpoint encodes (Q, 2026-07-29): a
// producer is not a clinician. Checkpoints that require clinical judgment —
// words approval ("is this true to me?"), the answer-library review queue,
// and practice-memory supersessions — are the CLINICIAN's work, scoped per
// staff_id. The producer never gets a CTA for these; they only see who is
// blocking what, as a nudge line, never an action line.
//
// Ranking (deterministic, no ML/LLM — cheap and explainable):
//   Tier 1 — broken:            publish failures, escalated captions
//   Tier 2 — blocking & aging:  post approvals with items past SLA
//   Tier 3 — flow:              checkpoints that unlock publishing on approval
//   Tier 4 — library:           checkpoints that feed inventory, not publishing
// Zero-count checkpoints never enter `queue`; they still appear (muted) in
// `ledger` so "quiet" reads differently than "invisible" — replacing the
// never-mounted ProducerOnboarding tour as how a producer learns the full
// checkpoint map.
//
// Node runtime + Express-style (req, res). Read-only.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A post is "stale" once it's waited this long for approval — the same
// signal week-summary.js's stale slice and the 2026-07-29 planning session's
// prod probe both used (9 of 33 movebetter posts were >14d at spec time).
const STALE_APPROVAL_MS = 14 * 24 * 60 * 60 * 1000
const FAILURE_WINDOW_MS = 7 * 24 * 60 * 60 * 1000

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Exact count via PostgREST's Range/Content-Range response, without pulling
// rows — cheap for a workspace-scoped table at this project's scale.
async function exactCount(path) {
  const sep = path.includes('?') ? '&' : '?'
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${path}${sep}select=id`, {
    signal: AbortSignal.timeout(10_000),
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      Prefer: 'count=exact',
      Range: '0-0',
    },
  })
  if (!r.ok) { console.error('[producer/checkpoints] count failed:', path, r.status); return 0 }
  const cr = r.headers.get('content-range') || ''
  const total = Number(cr.split('/')[1])
  return Number.isFinite(total) ? total : 0
}

async function jsonRows(path) {
  const r = await sb(path)
  if (!r.ok) { console.error('[producer/checkpoints] fetch failed:', path, r.status); return [] }
  return (await r.json().catch(() => [])) || []
}

// ── Producer-owned checkpoints (operational — no clinical judgment) ────────

async function postApprovals(wsId) {
  // platform=blog is excluded here — a blog draft in review is the named
  // clinician's own checkpoint (see clinicianCheckpoints), never the
  // producer's, regardless of whether blog_review_enabled is set for anyone.
  const rows = await jsonRows(
    `content_items?workspace_id=eq.${wsId}&status=in.(draft,in_review)&platform=neq.blog` +
    `&select=id,platform,topic,created_at&order=created_at.asc&limit=500`,
  )
  const now = Date.now()
  const stale = rows.filter((r) => now - (Date.parse(r.created_at || '') || now) > STALE_APPROVAL_MS)
  return { count: rows.length, staleCount: stale.length }
}

// Approved but never committed to a slot — the stall nothing surfaced.
//
// postApprovals above covers draft/in_review ("say go"). Once a producer says
// go, approving is supposed to schedule the post in the same motion ("there is
// no second step"). When that second step silently doesn't happen the row
// lands on `approved` with no scheduled_at and no checkpoint anywhere claims
// it: not this route, and not Your week, which plans forward.
//
// Found 2026-08-11 — an Instagram post approved 2026-06-01 had sat 72 days,
// and all 8 approved rows on movebetter had scheduled_at null. The weekly
// sweep now archives these after a week, so without this card the only thing
// a producer would ever learn is that their approved posts quietly vanished.
// Surfacing beats silent archival: this is the week they can still act.
//
// Blog IS included here, unlike postApprovals and unlike the sweep's own blog
// exclusion. Both of those are about not destroying / not misrouting a
// clinician's in-review piece. An APPROVED blog post is past review and
// waiting on someone to publish it, which is operational work — and it is
// exactly the case the sweep deliberately won't clean up, so a human has to.
async function approvedUnscheduled(wsId) {
  const rows = await jsonRows(
    `content_items?workspace_id=eq.${wsId}&status=eq.approved&scheduled_at=is.null` +
    `&select=id,platform,approved_at&order=approved_at.asc&limit=500`,
  )
  const now = Date.now()
  const stale = rows.filter((r) => now - (Date.parse(r.approved_at || '') || now) > STALE_APPROVAL_MS)
  return { count: rows.length, staleCount: stale.length, firstId: rows[0]?.id || null }
}

async function videoPackagesComplete(wsId) {
  return exactCount(`story_packages?workspace_id=eq.${wsId}&status=eq.complete`)
}

async function clipsProposed(wsId) {
  return exactCount(`video_segments?workspace_id=eq.${wsId}&status=eq.proposed`)
}

async function publishFailures7d(wsId) {
  const since = new Date(Date.now() - FAILURE_WINDOW_MS).toISOString()
  const failures = await jsonRows(
    `agent_actions?workspace_id=eq.${wsId}&kind=eq.publish_failed&created_at=gte.${since}` +
    `&select=id,content_item_id,created_at&order=created_at.desc&limit=200`,
  )
  if (!failures.length) return { count: 0, firstItemId: null }
  const oks = await jsonRows(
    `agent_actions?workspace_id=eq.${wsId}&kind=eq.published&created_at=gte.${since}` +
    `&select=content_item_id,created_at&limit=200`,
  )
  const latestOk = new Map()
  for (const o of oks) {
    if (!o.content_item_id) continue
    const t = Date.parse(o.created_at || '') || 0
    if (t > (latestOk.get(o.content_item_id) || 0)) latestOk.set(o.content_item_id, t)
  }
  const unresolved = failures.filter((f) => {
    if (!f.content_item_id) return true
    const failedAt = Date.parse(f.created_at || '') || 0
    return (latestOk.get(f.content_item_id) || 0) < failedAt
  })
  // Return the first failed item's id alongside the count so a single failure
  // can deep-link to the post itself. The card used to send every case to
  // /settings/integrations — a guess at the cause, and the wrong page whenever
  // the failure wasn't a dead connection (a rejected format, an oversized
  // media set). Home's attention queue already linked to /publish/:id; this
  // brings the producer surface up to the same standard.
  return { count: unresolved.length, firstItemId: unresolved.find((f) => f.content_item_id)?.content_item_id || null }
}

async function escalatedCaptions(wsId) {
  return exactCount(`content_items?workspace_id=eq.${wsId}&status=eq.draft&voice_audit->>escalated=eq.true`)
}

async function consentPending(wsId) {
  return exactCount(`media_assets?workspace_id=eq.${wsId}&consent_status=eq.pending`)
}

// ── P2: pipeline / channel health ───────────────────────────────────────────
// Days since the platform's last publish vs. its cadence target — same idle
// math validated against prod at spec time (blog 43d, gbp 15d, ig/fb/li ≤1d).
const DAY_MS = 24 * 60 * 60 * 1000

async function channelHealth(wsId, ws) {
  const rows = await jsonRows(
    `content_items?workspace_id=eq.${wsId}&status=eq.published&published_at=not.is.null` +
    `&select=platform,published_at&order=published_at.desc&limit=2000`,
  )
  const lastByPlatform = new Map()
  for (const r of rows) {
    if (!r.platform || lastByPlatform.has(r.platform)) continue
    lastByPlatform.set(r.platform, r.published_at)
  }
  const channels = ws?.cadence_policy?.channels || {}
  const platforms = new Set([...lastByPlatform.keys(), ...Object.keys(channels).filter((p) => channels[p]?.enabled)])

  const now = Date.now()
  return [...platforms].map((platform) => {
    const last = lastByPlatform.get(platform) || null
    const daysIdle = last ? Math.floor((now - (Date.parse(last) || now)) / DAY_MS) : null
    const target = Number(channels[platform]?.target_per_week) || 0
    // Rough idle bar from the weekly target: >2x the implied gap = stalled,
    // >1x = lagging. A platform with no cadence target just reports days idle.
    const expectedGapDays = target > 0 ? 7 / target : 7
    let status = 'ok'
    if (daysIdle == null) status = 'unknown'
    else if (daysIdle > expectedGapDays * 2) status = 'stalled'
    else if (daysIdle > expectedGapDays) status = 'lagging'
    return { platform, daysIdle, status, targetPerWeek: target || null }
  }).sort((a, b) => (b.daysIdle ?? -1) - (a.daysIdle ?? -1))
}

// ── Clinician-owned checkpoints (clinical judgment — scoped per staff) ─────

async function byStaff(wsId, table, filter) {
  const rows = await jsonRows(
    `${table}?workspace_id=eq.${wsId}&${filter}&select=staff_id&limit=1000`,
  )
  const counts = new Map()
  for (const r of rows) {
    if (!r.staff_id) continue
    counts.set(r.staff_id, (counts.get(r.staff_id) || 0) + 1)
  }
  return counts
}

async function staffNames(wsId, ids) {
  if (!ids.length) return new Map()
  const rows = await jsonRows(
    `staff?workspace_id=eq.${wsId}&id=in.(${ids.join(',')})&select=id,name&limit=1000`,
  )
  return new Map(rows.map((r) => [r.id, r.name || 'A clinician']))
}

// excludeStaffId: the CALLER's own staff row, when they have one. An
// owner who is also a practicing clinician (Q, 2026-07-29 — "I am literally
// both a clinician and a producer") sees their own answers/words/blog/memory
// checkpoints in the clinician section of their combined home, not duplicated
// here as a self-referential "waiting on your clinicians: Dr. Q" line — see
// .claude/decisions.md same date, "once, in the clinician section."
async function clinicianCheckpoints(wsId, excludeStaffId = null) {
  const [wordsCounts, answerCounts, blogCounts, superCounts] = await Promise.all([
    byStaff(wsId, 'interviews', 'status=eq.completed&summary_text=not.is.null&words_approved_at=is.null'),
    byStaff(wsId, 'answers', 'status=in.(needs_review,changes_requested)'),
    byStaff(wsId, 'content_items', 'status=eq.in_review&platform=eq.blog'),
    byStaff(wsId, 'practice_memory_supersessions', 'status=eq.pending'),
  ])

  if (excludeStaffId) {
    for (const m of [wordsCounts, answerCounts, blogCounts, superCounts]) m.delete(excludeStaffId)
  }

  const allStaffIds = new Set([
    ...wordsCounts.keys(), ...answerCounts.keys(), ...blogCounts.keys(), ...superCounts.keys(),
  ])
  const names = await staffNames(wsId, [...allStaffIds])

  const perStaff = [...allStaffIds].map((staffId) => ({
    staffId,
    name: names.get(staffId) || 'A clinician',
    wordsApprovals: wordsCounts.get(staffId) || 0,
    answersToReview: answerCounts.get(staffId) || 0,
    blogDrafts: blogCounts.get(staffId) || 0,
    supersessions: superCounts.get(staffId) || 0,
  })).filter((s) => s.wordsApprovals + s.answersToReview + s.blogDrafts + s.supersessions > 0)
    .sort((a, b) => (b.answersToReview + b.wordsApprovals + b.blogDrafts + b.supersessions)
                   - (a.answersToReview + a.wordsApprovals + a.blogDrafts + a.supersessions))

  const totals = {
    words_pending: [...wordsCounts.values()].reduce((s, n) => s + n, 0),
    answers_needs_review: [...answerCounts.values()].reduce((s, n) => s + n, 0),
    blog_review: [...blogCounts.values()].reduce((s, n) => s + n, 0),
    supersessions_pending: [...superCounts.values()].reduce((s, n) => s + n, 0),
  }

  return { perStaff, totals }
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })

  if (!(await enforceLimit(req, res, 'producer-checkpoints', ws.id))) return

  const clerkUserId = auth.userId || auth.user?.id || null
  let callerStaffId = null
  if (clerkUserId) {
    const selfRes = await sb(`staff?workspace_id=eq.${ws.id}&user_id=eq.${encodeURIComponent(clerkUserId)}&select=id&limit=1`)
    const selfRows = selfRes.ok ? await selfRes.json().catch(() => []) : []
    callerStaffId = selfRows[0]?.id || null
  }

  let posts, stalled, packages, clips, failures, escalated, consent, clinician, health
  try {
    [posts, stalled, packages, clips, failures, escalated, consent, clinician, health] = await Promise.all([
      postApprovals(ws.id),
      approvedUnscheduled(ws.id),
      videoPackagesComplete(ws.id),
      clipsProposed(ws.id),
      publishFailures7d(ws.id),
      escalatedCaptions(ws.id),
      consentPending(ws.id),
      clinicianCheckpoints(ws.id, callerStaffId),
      channelHealth(ws.id, ws),
    ])
  } catch (e) {
    console.error('[producer/checkpoints] aggregate failed:', e?.message)
    return res.status(500).json({ error: 'checkpoints_fetch_failed' })
  }

  // Is a check-in due? NULL last_checkin_at means never — in which case it
  // becomes due once there is enough published work to review, not on a timer
  // from a date nobody set.
  const CHECKIN_INTERVAL_D = 30
  const CHECKIN_MIN_PUBLISHED = 10
  const checkin = await (async () => {
    const publishedCount = await exactCount(
      `content_items?workspace_id=eq.${ws.id}&status=eq.published` +
      `&published_at=gte.${encodeURIComponent(new Date(Date.now() - CHECKIN_INTERVAL_D * 86400_000).toISOString())}`,
    )
    const published = publishedCount ?? 0
    const last = ws.last_checkin_at ? new Date(ws.last_checkin_at).getTime() : null
    const daysSince = last == null ? null : Math.floor((Date.now() - last) / 86400_000)
    return {
      everDone: last != null,
      daysSince,
      published,
      // Enough to review AND (never done OR the interval has elapsed).
      due: published >= CHECKIN_MIN_PUBLISHED && (last == null || daysSince >= CHECKIN_INTERVAL_D),
    }
  })()

  const queue = []

  // Tier 1 — broken.
  if (failures.count > 0) {
    queue.push({
      type: 'publish_failed', tier: 1,
      title: `Fix ${failures.count} failed publish${failures.count === 1 ? '' : 'es'}`,
      why: 'A post didn’t go out. It stays here until you reconnect the channel or retry.',
      gate: 'You are the checkpoint — this post is stuck until you act.',
      count: failures.count,
      // One click to the post that failed when there is a single one; the
      // pre-filtered list otherwise. Only fall back to the integrations page
      // when no failure carries an item id at all.
      ctaHref: failures.count === 1 && failures.firstItemId
        ? `/publish/${failures.firstItemId}`
        : (failures.firstItemId ? '/stories?status=failed' : '/settings/integrations'),
      ctaLabel: failures.count === 1 && failures.firstItemId ? 'Open the post →' : 'Review failures →',
    })
  }
  if (escalated > 0) {
    queue.push({
      type: 'escalated_caption', tier: 1,
      title: `Rewrite ${escalated} caption${escalated === 1 ? '' : 's'} Bernard couldn’t fix`,
      why: 'The automatic voice-repair pass couldn’t lift this one — it needs a human rewrite.',
      gate: 'You are the checkpoint — it stays held until you rewrite it.',
      count: escalated, ctaHref: '/week', ctaLabel: 'Open on Your week →',
    })
  }

  // Tier 2/3 — the main approval flow, amber when anything is stale.
  if (posts.count > 0) {
    queue.push({
      type: 'post_approvals', tier: posts.staleCount > 0 ? 2 : 3,
      title: `Approve this week’s posts — ${posts.count} waiting${posts.staleCount ? `, ${posts.staleCount} for over two weeks` : ''}`,
      why: 'Instagram, Facebook and Google Business posts sit here until you say go. Approving schedules them automatically — there is no second step.',
      gate: 'You are the checkpoint — nothing publishes until you approve it.',
      count: posts.count, staleCount: posts.staleCount,
      ctaHref: '/week', ctaLabel: 'Review on Your week →',
    })
  }
  // Approved but never scheduled. Sits directly after post_approvals because
  // it is the next beat of the same flow — you said go, and it didn't go.
  // Amber once anything has been stalled past the stale window, since the
  // weekly sweep will archive it and the producer loses the chance to act.
  if (stalled.count > 0) {
    queue.push({
      type: 'approved_unscheduled', tier: stalled.staleCount > 0 ? 2 : 3,
      title: `${stalled.count} approved post${stalled.count === 1 ? '' : 's'} never went out`,
      why: stalled.staleCount > 0
        ? 'You approved these, but they were never scheduled, so nothing published. The oldest have been waiting over two weeks and the weekly cleanup will archive them.'
        : 'You approved these, but they were never scheduled, so nothing published. They need a slot or a re-approve.',
      gate: 'You are the checkpoint — approved is not published.',
      count: stalled.count, staleCount: stalled.staleCount,
      // One click to the post itself when there's a single one, exactly like
      // the failed-publish row; the pre-filtered list otherwise.
      ctaHref: stalled.count === 1 && stalled.firstId
        ? `/publish/${stalled.firstId}`
        : '/stories?status=approved',
      ctaLabel: stalled.count === 1 ? 'Open the post →' : 'Review approved →',
    })
  }
  if (packages > 0) {
    queue.push({
      type: 'video_packages_complete', tier: 3,
      title: `Approve ${packages} finished video package${packages === 1 ? '' : 's'}`,
      why: 'A cut, captioned video is ready. Approving turns it into posts for each platform.',
      gate: 'You are the checkpoint — the video can’t become posts until you approve the package.',
      count: packages, ctaHref: '/moments', ctaLabel: 'Open Moments →',
    })
  }

  // Tier 4 — library-feeding. Ranked last regardless of size; nothing is
  // blocked behind these, so a big number here must not outrank a small
  // blocking one above it.
  if (clips > 0) {
    queue.push({
      type: 'clips_proposed', tier: 4,
      title: `Clip review backlog — ${clips} proposed cut${clips === 1 ? '' : 's'}`,
      why: 'Keep-or-discard decisions that stock the reel library. Nothing is blocked, but the pile only grows.',
      gate: 'You are the checkpoint — unkept clips never reach the library.',
      count: clips, ctaHref: '/moments?tab=video', ctaLabel: 'Review clips →',
    })
  }
  if (consent > 0) {
    queue.push({
      type: 'consent_pending', tier: 4,
      title: `${consent} clip${consent === 1 ? '' : 's'} waiting on patient consent`,
      why: 'Footage can’t be used in a reel or post until consent is recorded.',
      gate: 'You are the checkpoint — unconsented footage stays out of every export.',
      count: consent, ctaHref: '/library', ctaLabel: 'Open Library →',
    })
  }

  // Tier 3 — the periodic check-in. A checkpoint rather than a permanent card
  // (Q, 2026-07-30): ProducerHome answers "what do I need to do", and a DUE
  // check-in is exactly that, while a data card that is always there is not.
  //
  // Deliberately gated on having something worth reviewing. A clinic with three
  // published posts does not need a trend review, and a checkpoint that appears
  // before it can say anything useful teaches people to skip the queue.
  if (checkin.due) {
    queue.push({
      type: 'learning_checkin', tier: 3,
      title: checkin.everDone
        ? 'Review how Bernard is doing'
        : 'First check-in — is Bernard sounding like you?',
      why: checkin.everDone
        ? `It has been ${checkin.daysSince} days. Look at what published and whether the numbers are going the right way.`
        : 'Bernard has published enough now to be worth a look — the numbers, and whether the posts still sound like the clinic.',
      gate: 'Nothing is blocked by this — it is how Bernard learns whether to keep going as it is.',
      count: checkin.published,
      ctaHref: '/analytics#checkin', ctaLabel: 'Open the check-in →',
    })
  }

  queue.sort((a, b) => a.tier - b.tier)

  // Honest headline numbers (Q, 2026-08-11).
  //
  // The page used to say "You're the gate for N things today" where N was
  // queue.length — the number of CARDS. One of those cards routinely holds 157
  // proposed clips, so the producer headline understated the real workload by
  // an order of magnitude while looking like the calmer number, sitting next
  // to Home's card which counts individual items. The two read as
  // contradictory when they were simply measuring different units.
  //
  // `decisions` is items, not cards — but a naive sum over `count` would be
  // dishonest the other way, because learning_checkin's count is how many
  // posts there are to REVIEW (62), not how many decisions are pending (one:
  // do the check-in). So each card declares `items` explicitly, and the sum
  // uses that.
  //
  // Backlog is split out rather than folded in: tier-4 cards say in their own
  // gate line that nothing is blocked by them, so adding a 157-clip pile to
  // the "waiting on you" number would overstate urgency as badly as the old
  // headline understated volume.
  const DECISION_ITEMS = {
    // One review action, regardless of how much there is to look at.
    learning_checkin: () => 1,
  }
  for (const card of queue) {
    card.items = DECISION_ITEMS[card.type] ? DECISION_ITEMS[card.type]() : (card.count || 0)
  }
  const summary = {
    checkpoints: queue.length,
    decisions: queue.filter((c) => c.tier <= 3).reduce((s, c) => s + c.items, 0),
    backlog: queue.filter((c) => c.tier >= 4).reduce((s, c) => s + c.items, 0),
  }

  const ledger = {
    yours: [
      { type: 'post_approvals', label: 'Post approvals', count: posts.count },
      { type: 'clips_proposed', label: 'Clip review', count: clips },
      { type: 'video_packages_complete', label: 'Video packages', count: packages },
      { type: 'publish_failed', label: 'Publish failures', count: failures.count },
      { type: 'escalated_caption', label: 'Escalated captions', count: escalated },
      { type: 'consent_pending', label: 'Media consent', count: consent },
    ],
    clinicians: [
      { type: 'answers_needs_review', label: 'Answer reviews', count: clinician.totals.answers_needs_review },
      { type: 'words_pending', label: 'Words approvals', count: clinician.totals.words_pending },
      { type: 'blog_review', label: 'Blog drafts', count: clinician.totals.blog_review },
      { type: 'supersessions_pending', label: 'Memory updates', count: clinician.totals.supersessions_pending },
    ],
  }

  return res.status(200).json({
    queue,
    summary,
    ledger,
    waitingOnClinicians: clinician.perStaff,
    health: { channels: health, publishFailures7d: failures.count },
  })
}
