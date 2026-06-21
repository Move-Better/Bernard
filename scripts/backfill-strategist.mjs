// Backfill the F2 Strategist over EXISTING interviews → populate the backlog.
//
// Why: /week only shows content for the current week's captures, so for most
// workspaces it's empty. This runs the Strategist over the historical corpus and
// banks the results as BACKLOG (held atoms) — a reserve the weekly plan pulls
// from — rather than scheduling months of old content into this week.
//
// Cautions (per Q): never re-propose content already shipped to social — skip any
// interview that has published/scheduled content_items. Idempotent: skip
// interviews that already have strategist atoms. Dry-run prints, writes nothing.
//
// Run (dry-run): node scripts/backfill-strategist.mjs --dry-run
// Run (apply):   node scripts/backfill-strategist.mjs
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY, AI_GATEWAY_API_KEY in env.

import { composeWeeklyPlan } from '../api/_lib/strategist.js'

const DRY = process.argv.includes('--dry-run')
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE env'); process.exit(1) }

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json', ...init.headers,
    },
  })
}
const j = async (r) => (r.ok ? r.json() : [])

const wsList = await j(await sb('workspaces?status=eq.active&select=id,slug,cadence_policy'))
console.log(`\n${DRY ? '[DRY RUN] ' : ''}Backfill over ${wsList.length} workspaces\n`)

let totalHeld = 0
for (const ws of wsList) {
  // Eligible: completed/synthesized interviews, newest first, capped.
  const interviews = await j(await sb(
    `interviews?workspace_id=eq.${ws.id}&status=in.(completed,synthesized)` +
    `&select=id,topic,staff_id,summary_text,created_at&order=created_at.desc&limit=40`,
  ))
  if (!interviews.length) { console.log(`  ${ws.slug}: no interviews`); continue }

  // Skip interviews whose content already shipped (published/scheduled).
  const shipped = await j(await sb(
    `content_items?workspace_id=eq.${ws.id}&status=in.(published,scheduled)&interview_id=not.is.null&select=interview_id`,
  ))
  const shippedIds = new Set(shipped.map((r) => r.interview_id))
  // Idempotency: skip interviews that already have strategist atoms.
  const existing = await j(await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&planned_by=eq.strategist&select=interview_id`,
  ))
  const haveIds = new Set(existing.map((r) => r.interview_id))

  const eligible = interviews.filter((i) => !shippedIds.has(i.id) && !haveIds.has(i.id))
  if (!eligible.length) { console.log(`  ${ws.slug}: ${interviews.length} interviews, 0 eligible (all shipped or already planned)`); continue }

  // Recent topics to dedup against (published).
  const recentTopics = [...new Set(shipped.map((r) => r.topic).filter(Boolean))]

  // Compose. Everything becomes BACKLOG (held), not this-week scheduled.
  const plan = await composeWeeklyPlan({
    workspaceId: ws.id,
    interviews: eligible,
    cadence: ws.cadence_policy?.channels || undefined,
    recentTopics,
    backlog: [],
    weekMonday: '2000-01-03', // sentinel Monday; held atoms aren't week-scheduled
  })
  const candidates = [...plan.thisWeek, ...plan.held]
  const now = new Date().toISOString()
  const heldRows = candidates.map((a) => ({
    interview_id: a.interview_id, workspace_id: ws.id, platform: a.platform, slot: a.slot,
    angle: a.angle, angle_label: a.angle_label, angle_description: a.angle_description,
    brief: a.brief, status: 'pending', planned_by: 'strategist',
    plan_week: null, scheduled_at: null, held_at: now,
  }))

  console.log(`  ${ws.slug}: ${eligible.length} eligible interviews → ${heldRows.length} backlog pieces${DRY ? '' : ' (writing…)'}`)
  for (const r of heldRows.slice(0, 3)) console.log(`      ${r.platform.padEnd(10)} ${(r.brief || r.angle_label || '').slice(0, 80)}`)

  if (!DRY && heldRows.length) {
    const res = await sb('content_plan_atoms', { method: 'POST', body: JSON.stringify(heldRows), headers: { Prefer: 'return=minimal' } })
    if (!res.ok) console.error(`      WRITE FAILED ${res.status}: ${(await res.text()).slice(0, 200)}`)
  }
  totalHeld += heldRows.length
}
console.log(`\n${DRY ? '[DRY RUN] would bank' : 'Banked'} ${totalHeld} backlog pieces total.\n`)
