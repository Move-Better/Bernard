// F2.1 — Strategist orchestration: reads a workspace's week of inputs, composes
// the plan (api/_lib/strategist.js), and PERSISTS it to content_plan_atoms with
// replace-untouched idempotency. Called by both the completion-trigger
// (interviews.js, on each interview completion) and the weekly cron backstop.
// See .claude/f1-f2-cadence-spec.md (F2.1).
//
// The DB-op decision is factored into a PURE function (planToDbOps) so the
// replace-untouched rules are unit-testable without a database.

import { composeWeeklyPlan, RECOMMENDED_CADENCE, mondayOf } from './strategist.js'
import { getCadencePrior, computeAutoCadenceChannels } from './cadenceDefaults.js'

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
      `&select=id,topic,staff_id,summary_text,created_at`,
  )
  const interviews = ivRes.ok ? await ivRes.json() : []

  // Recent topics already posted — for the LLM to avoid repeating.
  const since = new Date(Date.now() - RECENT_TOPIC_DAYS * 24 * 60 * 60 * 1000).toISOString()
  const recRes = await sb(
    `content_items?workspace_id=eq.${wsId}&status=in.(approved,scheduled,published)` +
      `&created_at=gte.${since}&select=topic&limit=200`,
  )
  const recentTopics = recRes.ok
    ? [...new Set((await recRes.json()).map((r) => r.topic).filter(Boolean))]
    : []

  // Backlog: banked atoms (held_at set) available to top up thin channels.
  const bkRes = await sb(
    `content_plan_atoms?workspace_id=eq.${wsId}&held_at=not.is.null` +
      `&select=id,platform,angle,angle_label,brief,held_at`,
  )
  const backlog = bkRes.ok ? await bkRes.json() : []

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
    cadence = computeAutoCadenceChannels(workspace.enabled_outputs, prior)
  } else {
    cadence = policy?.channels || {}
  }
  if (!cadence || Object.keys(cadence).length === 0) cadence = RECOMMENDED_CADENCE
  const quietDays = policy?.quiet_days || ['sat', 'sun']

  return { interviews, cadence, quietDays, recentTopics, backlog }
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
async function persistPlan({ ops, sb = defaultSb, workspaceId = null }) {
  const wsFilter = workspaceId ? `&workspace_id=eq.${workspaceId}` : ''
  if (ops.toDelete.length) {
    const ids = ops.toDelete.map((id) => `"${id}"`).join(',')
    await sb(`content_plan_atoms?id=in.(${ids})${wsFilter}`, { method: 'DELETE', headers: { Prefer: 'return=minimal' } })
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
  for (const u of ops.toUpdate) {
    await sb(`content_plan_atoms?id=eq.${u.id}${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify(u.patch),
      headers: { Prefer: 'return=minimal' },
    })
  }
}

/**
 * Re-plan one workspace's current (or given) week end to end: read inputs →
 * compose → persist (replace-untouched). Safe to call repeatedly (the
 * completion-trigger fires on every interview completion; the weekly cron is a
 * backstop). Returns the compose stats. `sb`/`generate` injectable for tests.
 */
export async function replanWorkspaceWeek({ workspace, weekMonday, sb = defaultSb, generate }) {
  const planWeek = weekMonday || mondayOf(new Date().toISOString())
  const { interviews, cadence, quietDays, recentTopics, backlog } = await getWeekInputs({
    workspace,
    weekMonday: planWeek,
    sb,
  })
  // Compose when there are fresh captures this week OR banked backlog to drip
  // out. A week with no new interviews but a non-empty backlog still produces a
  // plan: allocateToCadence promotes backlog atoms up to each channel's
  // target_per_week, so /week stays populated between capture weeks.
  if (!interviews.length && !backlog.length) return { weekMonday: planWeek, skipped: 'no-inputs' }

  const plan = await composeWeeklyPlan({
    workspaceId: workspace.id,
    interviews,
    cadence,
    quietDays,
    timezone: workspace.cadence_policy?.timezone || 'America/Los_Angeles',
    recentTopics,
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
  }
}
