// Read-only dry-run for the F2.1 Strategist deterministic pipeline.
// Runs composeWeeklyPlan against REAL Move Better People interviews with a
// stubbed LLM (injected `generate`) so no gateway key / DB write is needed.
// Validates: cadence cap, surplus→held, backlog FIFO top-up, disabled-channel
// banking, slot assignment + quiet days. Run: node .claude/strategist-dryrun.mjs
import { composeWeeklyPlan, RECOMMENDED_CADENCE } from '../api/_lib/strategist.js'

// Real MBP interviews (pulled via Supabase MCP 2026-06-21, read-only).
const interviews = [
  { id: 'f5dcb788-1eb8-4190-bc74-44f04dc353fe', staff_name: 'Dr. Sophie',  topic: 'Bicep tendinopathy', summary_text: 'Root-cause driven approach to biceps tendinopathy.' },
  { id: '6d497027-a332-482b-8d9f-71187291a8ac', staff_name: 'Dr. Cullen',  topic: 'Healthy relationship with movement', summary_text: 'Building a healthy relationship with exercise.' },
  { id: '8a35df40-5b3e-489c-b863-0d33f725cafa', staff_name: 'Dr. Q',       topic: 'Rosehaven Community Connection', summary_text: 'Community connection via a patient, Dana.' },
  { id: 'e1ad70fe-5ef7-46c9-bb91-99a7abd294bc', staff_name: 'Dr. Q',       topic: 'Running Seminar', summary_text: 'Running as a layered, phase-based process.' },
  { id: '88661b07-8db7-4639-9693-2afb1de5aa4b', staff_name: 'Dr. Tyler',   topic: 'Clinic to real world', summary_text: 'Clinic exercises are teaching tools for a feeling.' },
  { id: '1cc072e3-7447-4531-8aca-8456d152e303', staff_name: 'Dr. Tyler',   topic: 'When to push during training', summary_text: 'Deciding to push through discomfort.' },
  { id: '7c319a5f-649d-4ebb-b1fe-88e6dc653459', staff_name: 'Whitney',     topic: 'Plantar fasciitis', summary_text: 'Whole-body kinetic chain view of plantar fasciitis.' },
  { id: '6e08aac8-2ca8-4d64-8f96-87833d3b286b', staff_name: 'Dr. Q',       topic: 'Knee Pain with Running', summary_text: 'Observe the activity causing pain.' },
]

// Stub LLM: returns hand-built candidates (valid palette angles) to exercise
// every allocation branch. instagram OVER target (held), linkedin UNDER (top
// up 1), gbp EMPTY (top up from backlog), facebook DISABLED (banked).
const stubGenerate = async () => ([
  { interview_id: interviews[0].id, platform: 'instagram', angle: 'hook',             brief: 'Bicep tendinopathy: the move people skip' },
  { interview_id: interviews[1].id, platform: 'instagram', angle: 'patient_scenario', brief: 'Relearning to trust movement' },
  { interview_id: interviews[6].id, platform: 'instagram', angle: 'clinical_insight', brief: 'Plantar fasciitis is a whole-chain problem' },
  { interview_id: interviews[7].id, platform: 'instagram', angle: 'cta',              brief: 'Knee pain with running — book a gait look' },
  { interview_id: interviews[5].id, platform: 'instagram', angle: 'hook',             brief: 'When to push vs back off' }, // 5th → surplus held
  { interview_id: interviews[4].id, platform: 'linkedin',  angle: 'clinical_perspective', brief: 'Clinic exercises are teaching tools' },
  { interview_id: interviews[3].id, platform: 'linkedin',  angle: 'movement_principle',   brief: 'Running as a layered skill' },
  { interview_id: interviews[2].id, platform: 'facebook',  angle: 'community',        brief: 'Rosehaven community connection' }, // disabled → held
])

// Backlog (already-held atoms) to test FIFO top-up. linkedin gap=1, gbp gap=3.
const backlog = [
  { id: 'bk-li-1',  platform: 'linkedin', angle: 'referring_provider', brief: '[banked] What referrers should know about ACL', held_at: '2026-06-10T00:00:00Z' },
  { id: 'bk-gbp-1', platform: 'gbp',      angle: 'local_authority',    brief: '[banked] Why patients choose us', held_at: '2026-06-08T00:00:00Z' },
  { id: 'bk-gbp-2', platform: 'gbp',      angle: 'patient_outcome',    brief: '[banked] What recovery looks like', held_at: '2026-06-12T00:00:00Z' },
]

const plan = await composeWeeklyPlan({
  workspaceId: 'ws-mbp',
  interviews,
  cadence: RECOMMENDED_CADENCE, // instagram 4, linkedin 3, gbp 3
  recentTopics: ['Foam rolling myths'],
  backlog,
  weekMonday: '2026-06-22', // a Monday
  generate: stubGenerate,
})

const fmt = (a) => `    ${a.platform.padEnd(10)} ${(a.angle_label || a.angle).padEnd(22)} ${(a.scheduled_at ? a.scheduled_at.slice(0, 16).replace('T', ' ') : 'held').padEnd(17)} ${a.brief || ''}`
console.log(`\nWEEK OF ${plan.weekMonday}  ·  stats:`, plan.stats)
console.log(`\n  THIS WEEK (${plan.thisWeek.length}):`); plan.thisWeek.forEach((a) => console.log(fmt(a)))
console.log(`\n  PROMOTED FROM BACKLOG (${plan.promoted.length}):`); plan.promoted.forEach((a) => console.log(fmt(a)))
console.log(`\n  HELD / BANKED (${plan.held.length}):`); plan.held.forEach((a) => console.log(fmt(a)))

// ── assertions ──────────────────────────────────────────────────────────────
const all = [...plan.thisWeek, ...plan.promoted]
const DOW = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat']
const checks = [
  ['instagram capped at 4',        plan.thisWeek.filter((a) => a.platform === 'instagram').length === 4],
  ['1 instagram surplus held',     plan.held.filter((a) => a.platform === 'instagram').length === 1],
  ['linkedin topped up to 3',      [...plan.thisWeek, ...plan.promoted].filter((a) => a.platform === 'linkedin').length === 3],
  ['gbp topped up from backlog (2 avail)', plan.promoted.filter((a) => a.platform === 'gbp').length === 2],
  ['3 promoted total',             plan.promoted.length === 3],
  ['promoted cleared held_at',     plan.promoted.every((a) => a.held_at === null)],
  ['disabled facebook dropped (not enabled)', ![...plan.thisWeek, ...plan.held, ...plan.promoted].some((a) => a.platform === 'facebook') && plan.stats.candidates === 7],
  ['every this-week has a slot',   all.every((a) => !!a.scheduled_at)],
  ['no slot on a quiet day',       all.every((a) => !['Sat', 'Sun'].includes(DOW[new Date(a.scheduled_at).getUTCDay()]))],
  ['held rows carry held_at',      plan.held.every((a) => !!a.held_at)],
  ['all atoms planned_by strategist (new rows)', [...plan.thisWeek, ...plan.held].every((a) => a.planned_by === 'strategist')],
]
console.log('\n  CHECKS:')
let pass = 0
for (const [name, ok] of checks) { console.log(`    ${ok ? '✓' : '✗ FAIL'}  ${name}`); if (ok) pass++ }
console.log(`\n  ${pass}/${checks.length} passed\n`)
process.exit(pass === checks.length ? 0 : 1)
