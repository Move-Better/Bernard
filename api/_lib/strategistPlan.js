// F2.1 — Strategist orchestration: reads a workspace's week of inputs, composes
// the plan (api/_lib/strategist.js), and PERSISTS it to content_plan_atoms with
// replace-untouched idempotency. Called by both the completion-trigger
// (interviews.js, on each interview completion) and the weekly cron backstop.
// See .claude/f1-f2-cadence-spec.md (F2.1).
//
// The DB-op decision is factored into a PURE function (planToDbOps) so the
// replace-untouched rules are unit-testable without a database.

import { composeWeeklyPlan, RECOMMENDED_CADENCE, mondayOf } from './strategist.js'
import { getCadencePrior, computeCadenceChannels } from './cadenceDefaults.js'
import { getActiveCampaigns, campaignWeight } from './activeCampaigns.js'
import { applyExplorationSlots, computeDayProposal } from './cadenceAdaptive.js'
import { mergeSlotsIntoCadence, withExplorationSlot } from './cadenceSlots.js'

// P3 promo lane: how much of the feed campaign-attributed pieces may claim.
// Ramps with event proximity — a far-off (or evergreen) campaign gets the floor,
// an imminent seminar the ceiling. Derived from the shared campaignWeight ramp
// (1..30) so the promo lane and the Moment Miner slot allocation stay in lockstep.
const PROMO_MIN = 0.15
const PROMO_MAX = 0.40
function promoShareFor(activeCampaigns, now) {
  if (!activeCampaigns?.length) return 0
  const maxW = Math.max(...activeCampaigns.map((c) => campaignWeight(c, now)))
  const t = Math.min(1, Math.max(0, (maxW - 1) / (30 - 1))) // weight 1→0, 30→1
  return Number((PROMO_MIN + t * (PROMO_MAX - PROMO_MIN)).toFixed(3))
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function defaultSb(path, init = {}) {
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

const WEEK_MS = 7 * 24 * 60 * 60 * 1000
const RECENT_TOPIC_DAYS = 30
// Rolling window the topic-balance cap is evaluated against (P2). Kept as one
// window across channels; allocateToCadence enforces the cap per channel.
const RECENT_REGION_DAYS = 21

/**
 * Read the inputs the Strategist composes from, for one workspace + week.
 * Returns { interviews, cadence, quietDays, recentTopics, backlog }.
 */
export async function getWeekInputs({ workspace, weekMonday, sb = defaultSb }) {
  const wsId = workspace.id
  const weekStart = `${weekMonday}T00:00:00.000Z`
  const weekEnd = new Date(new Date(weekStart).getTime() + WEEK_MS).toISOString()

  // The week's captures: completed/synthesized interviews created this week.
  const ivRes = await sb(
    `interviews?workspace_id=eq.${wsId}&status=in.(completed,synthesized)` +
      `&created_at=gte.${weekStart}&created_at=lt.${weekEnd}` +
      `&select=id,topic,staff_id,summary_text,created_at,region,theme,campaign_id`,
  )
  const interviews = ivRes.ok ? await ivRes.json() : []

  // Live campaigns (date-window aware — excludes stale-active past end_at) drive
  // the P3 promo lane. Their ids mark which pieces are campaign-attributed;
  // event proximity sizes the promo share.
  const activeCampaigns = await getActiveCampaigns(wsId)
  const promoCampaignIds = activeCampaigns.map((c) => c.id)
  const promoShare = promoShareFor(activeCampaigns, Date.now())

  // Recent topics already posted — for the LLM to avoid repeating.
  const since = new Date(Date.now() - RECENT_TOPIC_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const recRes = await sb(
    `content_items?workspace_id=eq.${wsId}&status=in.(approved,scheduled,published)` +
      `&created_at=gte.${since}&select=topic&limit=200`,
  )
  const recentTopics = recRes.ok
    ? [...new Set((await recRes.json()).map((r) => r.topic).filter(Boolean))]
    : []

  // Rolling-window region mix per channel (P2 topic-balance). Counts recent
  // output (approved/scheduled/published) by platform × region so the allocator
  // can keep any one region under the cap. Shape: { platform: { region: n } }.
  const regionSince = new Date(Date.now() - RECENT_REGION_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const rgRes = await sb(
    `content_items?workspace_id=eq.${wsId}&status=in.(approved,scheduled,published)` +
      `&created_at=gte.${regionSince}&region=not.is.null&select=platform,region&limit=1000`,
  )
  const recentRegionCounts = {}
  if (rgRes.ok) {
    for (const row of await rgRes.json()) {
      if (!row.platform || !row.region) continue
      ;(recentRegionCounts[row.platform] ||= {})[row.region] =
        (recentRegionCounts[row.platform]?.[row.region] || 0) + 1
    }
  }

  // Backlog: banked atoms (held_at set) available to top up thin channels. Embed
  // the source interview's region so the allocator can cap-check backlog too.
  const bkRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&held_at=not.is.null` +
      `&select=id,platform,angle,angle_label,brief,held_at,interview_id,interviews(region,campaign_id)`,
  )
  const backlog = bkRes.ok
    ? (await bkRes.json()).map((b) => ({
        ...b,
        region: b.interviews?.region || null,
        campaign_id: b.interviews?.campaign_id || null,
        interviews: undefined,
      }))
    : []

  // Cadence resolution. Auto (provenance !== 'user', the default) COMPUTES the
  // per-channel cadence from the workspace's enabled_outputs × the cold-start
  // prior — so every enabled channel is planned, not just the old hardcoded
  // instagram/linkedin/gbp trio. Manual (provenance === 'user') uses the
  // operator's stored channel targets verbatim. The RECOMMENDED_CADENCE
  // fallback only fires when a workspace has no enabled_outputs at all.
  const policy = workspace.cadence_policy || null
  const isAuto = (policy?.provenance ?? 'bernard') !== 'user'
  let cadence
  if (isAuto) {
    const prior = await getCadencePrior(sb)
    cadence = await computeCadenceChannels(workspace.id, workspace.enabled_outputs, prior, sb)
  } else {
    cadence = policy?.channels || {}
  }
  if (!cadence || Object.keys(cadence).length === 0) cadence = RECOMMENDED_CADENCE

  // T4 learning loop, part 3 — day/time ("when") learning. quiet_days is a
  // frozen author default that can never self-correct on its own: no weekend
  // inventory ⇒ no weekend engagement data ⇒ Auto can never learn a weekend
  // works. applyExplorationSlots() rotates one currently-quiet, not-dismissed
  // day open per week (deterministically, by weekMonday) so real posts land
  // there and produce real engagement_snapshots for computeDayProposal()
  // (called from replanWorkspaceWeek below) to eventually act on. See
  // api/_lib/cadenceAdaptive.js and .claude/decisions.md 2026-07-21 T4 scoping.
  const configuredQuietDays = policy?.quiet_days || ['sat', 'sun']
  const dismissedDays = policy?.day_time_dismissed || []
  const { effectiveQuietDays, exploring } = applyExplorationSlots(configuredQuietDays, dismissedDays, weekMonday)

  // T3: attach each channel's pinned posting slots (persisted, or a computed
  // default when absent) — orthogonal to the Auto/Manual/Adaptive "how many"
  // resolution above, since Auto mode recomputes `cadence` fresh every call
  // and never itself carries slots. Uses the CONFIGURED quiet days (not
  // effectiveQuietDays) so a channel's default slot layout stays stable week
  // to week rather than shifting with T4's weekly exploration rotation. See
  // cadenceSlots.js.
  cadence = mergeSlotsIntoCadence(cadence, policy?.channels || {}, configuredQuietDays)

  // T4's exploration mechanism assumes a channel falls back to assignSlots'
  // legacy even-spread (which honors effectiveQuietDays) — but a channel with
  // PINNED slots (the common case after the T3 seed) ignores quietDays
  // entirely and would never place anything on the exploring day. Inject a
  // real, ephemeral (never persisted) exploration slot so pinned-slot
  // channels participate in exploration too.
  if (exploring) cadence = withExplorationSlot(cadence, exploring)

  return { interviews, cadence, quietDays: effectiveQuietDays, exploring, recentTopics, recentRegionCounts, promoShare, promoCampaignIds, backlog }
}

// T4 learning loop, part 3 — evaluate whether the workspace's quiet days have
// accumulated enough exploration evidence to say anything, and persist it as
// a proposal Q can Accept/Dismiss (Settings → Channels → Cadence). Cheap and
// idempotent: a no-op once a proposal is already pending, and safe to call on
// every replan (the interview-completion trigger fires often — see file
// header). Never throws — a failure here must not block the actual replan.
async function maybeProposeDayChange({ workspace, sb }) {
  try {
    const policy = workspace.cadence_policy || {}
    if (policy.day_time_proposal) return // already have one pending — don't overwrite
    const quietDays = policy.quiet_days || ['sat', 'sun']
    const dismissedDays = policy.day_time_dismissed || []
    const timezone = policy.timezone || 'America/Los_Angeles'
    const proposal = await computeDayProposal(workspace.id, quietDays, dismissedDays, timezone, sb)
    if (!proposal) return
    const nextPolicy = { ...policy, day_time_proposal: { ...proposal, computed_at: new Date().toISOString() } }
    const r = await sb(`workspaces?id=eq.${workspace.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ cadence_policy: nextPolicy }),
    })
    if (!r.ok) console.error('[strategistPlan] day-proposal persist failed:', r.status)
  } catch (e) {
    console.error('[strategistPlan] day-proposal check failed:', e?.message)
  }
}

/**
 * PURE: given a freshly-composed plan and the strategist's EXISTING atoms for
 * this plan_week, decide the DB ops under the replace-untouched rule.
 *
 * Replace-untouched = recompute only atoms that are still
 *   planned_by='strategist' AND status='pending' AND content_piece_id IS NULL
 * (i.e. the Strategist's own, not-yet-drafted, not-human-edited slots). Any atom
 * that's been drafted/approved/held-by-a-human, or is a legacy 'grid' atom, is
 * left untouched.
 *
 * @returns {{ toDelete: string[], toInsert: object[], toUpdate: Array<{id, patch}> }}
 */
export function planToDbOps(plan, existingAtoms = []) {
  const untouched = existingAtoms.filter(
    (a) => a.planned_by === 'strategist' && a.status === 'pending' && !a.content_piece_id,
  )
  const toDelete = untouched.map((a) => a.id)
  const toInsert = [...plan.thisWeek, ...plan.held]
  const toUpdate = plan.promoted.map((a) => ({
    id: a.id,
    patch: { held_at: null, scheduled_at: a.scheduled_at, plan_week: a.plan_week },
  }))
  return { toDelete, toInsert, toUpdate }
}

/**
 * Execute the DB ops from planToDbOps. `workspaceId`, when provided, is added as
 * a secondary `&workspace_id=eq.` guard on every DELETE/PATCH so a stale or
 * corrupt id can never reach a row outside the plan's workspace — matching the
 * defense-in-depth used by every other mutation in the codebase. The ids come
 * from a workspace-scoped SELECT, so this is belt-and-suspenders, not a live
 * leak fix.
 */
async function persistPlan({ ops, sb = defaultSb, workspaceId }) {
  if (!workspaceId) throw new Error('persistPlan: workspaceId required')
  const wsFilter = `&workspace_id=eq.${workspaceId}`
  if (ops.toDelete.length) {
    const ids = ops.toDelete.map((id) => `"${id}"`).join(',')
    const delR = await sb(`content_plan_atoms?id=in.(${ids})${wsFilter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
    if (!delR.ok) throw new Error(`atom delete ${delR.status}: ${(await delR.text().catch(() => '')).slice(0, 200)}`)
  }
  if (ops.toInsert.length) {
    const r = await sb('content_plan_atoms', {
      method: 'POST',
      body: JSON.stringify(ops.toInsert),
      headers: { Prefer: 'return=minimal' },
    })
    // Surface failures (e.g. a bad uuid) so the caller's fallback/logging fires
    // instead of silently writing nothing.
    if (!r.ok) throw new Error(`atom insert ${r.status}: ${(await r.text().catch(() => '')).slice(0, 200)}`)
  }
  const patchErrors = []
  for (const u of ops.toUpdate) {
    const result = await sb(`content_plan_atoms?id=eq.${u.id}${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(u.patch),
      headers: { Prefer: 'return=minimal' },
    })
    if (!result.ok) patchErrors.push(`atom patch ${u.id} ${result.status}: ${(await result.text().catch(() => '')).slice(0, 200)}`)
  }
  if (patchErrors.length) throw new Error(patchErrors.join('; '))
}

/**
 * Re-plan one workspace's current (or given) week end to end: read inputs →
 * compose → persist (replace-untouched). Safe to call repeatedly (the
 * completion-trigger fires on every interview completion; the weekly cron is a
 * backstop). Returns the compose stats. `sb`/`generate` injectable for tests.
 */
export async function replanWorkspaceWeek({ workspace, weekMonday, sb = defaultSb, generate }) {
  const planWeek = weekMonday || mondayOf(new Date().toISOString())
  const { interviews, cadence, quietDays, exploring, recentTopics, recentRegionCounts, promoShare, promoCampaignIds, backlog } = await getWeekInputs({
    workspace,
    weekMonday: planWeek,
    sb,
  })

  // T4 learning loop, part 3 — evaluate (and persist, if new) a day/time
  // proposal from prior weeks' exploration data. Independent of whether THIS
  // week composes a plan, so it runs before the no-inputs early return.
  await maybeProposeDayChange({ workspace, sb })

  // Compose when there are fresh captures this week OR banked backlog to drip
  // out. A week with no new interviews but a non-empty backlog still produces a
  // plan: allocateToCadence promotes backlog atoms up to each channel's
  // target_per_week, so /week stays populated between capture weeks.
  if (!interviews.length && !backlog.length) return { weekMonday: planWeek, skipped: 'no-inputs', exploring }

  const plan = await composeWeeklyPlan({
    workspaceId: workspace.id,
    interviews,
    cadence,
    quietDays,
    timezone: workspace.cadence_policy?.timezone || 'America/Los_Angeles',
    recentTopics,
    recentRegionCounts,
    promoShare,
    promoCampaignIds,
    backlog,
    weekMonday: planWeek,
    ...(generate ? { generate } : {}),
  })

  // Read existing strategist atoms for this week to apply replace-untouched.
  const exRes = await sb(
    `content_plan_atoms?workspace_id=eq.${workspace.id}&plan_week=eq.${planWeek}` +
      `&select=id,planned_by,status,content_piece_id`,
  )
  const existing = exRes.ok ? await exRes.json() : []

  const ops = planToDbOps(plan, existing)
  await persistPlan({ ops, sb, workspaceId: workspace.id })

  return {
    weekMonday: planWeek,
    ...plan.stats,
    replaced: ops.toDelete.length,
    promoted: ops.toUpdate.length,
    exploring,
  }
}
