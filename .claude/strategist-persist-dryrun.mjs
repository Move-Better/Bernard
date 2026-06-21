// Unit harness for the SAFETY-CRITICAL replace-untouched rule (planToDbOps).
// No DB/env needed — pure function. Run: node .claude/strategist-persist-dryrun.mjs
import { planToDbOps } from '../api/_lib/strategistPlan.js'

// Existing atoms for this plan_week — a mix of states the rule must respect.
const existing = [
  { id: 'a1', planned_by: 'strategist', status: 'pending',  content_piece_id: null  }, // untouched → RECOMPUTE (delete)
  { id: 'a2', planned_by: 'strategist', status: 'drafted',  content_piece_id: 'cp1' }, // drafted → PRESERVE
  { id: 'a3', planned_by: 'grid',       status: 'pending',  content_piece_id: null  }, // legacy grid → PRESERVE
  { id: 'a4', planned_by: 'strategist', status: 'approved', content_piece_id: 'cp2' }, // approved → PRESERVE
  { id: 'a5', planned_by: 'strategist', status: 'pending',  content_piece_id: null  }, // untouched → RECOMPUTE (delete)
]

const plan = {
  thisWeek: [
    { platform: 'instagram', plan_week: '2026-06-22', scheduled_at: '2026-06-22T12:00:00Z', planned_by: 'strategist' },
    { platform: 'linkedin',  plan_week: '2026-06-22', scheduled_at: '2026-06-22T07:00:00Z', planned_by: 'strategist' },
  ],
  held: [
    { platform: 'instagram', plan_week: '2026-06-22', held_at: '2026-06-21T00:00:00Z', planned_by: 'strategist' },
  ],
  promoted: [
    { id: 'bk1', platform: 'gbp', plan_week: '2026-06-22', scheduled_at: '2026-06-22T08:00:00Z', held_at: null },
  ],
}

const ops = planToDbOps(plan, existing)
console.log('\n  toDelete:', ops.toDelete)
console.log('  toInsert:', ops.toInsert.length, 'rows')
console.log('  toUpdate:', JSON.stringify(ops.toUpdate))

const checks = [
  ['deletes only the 2 untouched strategist atoms', ops.toDelete.length === 2 && ops.toDelete.includes('a1') && ops.toDelete.includes('a5')],
  ['preserves drafted (a2)',     !ops.toDelete.includes('a2')],
  ['preserves legacy grid (a3)', !ops.toDelete.includes('a3')],
  ['preserves approved (a4)',    !ops.toDelete.includes('a4')],
  ['inserts thisWeek + held (3)', ops.toInsert.length === 3],
  ['promotes bk1 (held→slot)',   ops.toUpdate.length === 1 && ops.toUpdate[0].id === 'bk1' && ops.toUpdate[0].patch.held_at === null && !!ops.toUpdate[0].patch.scheduled_at],
  ['empty existing → no deletes', planToDbOps(plan, []).toDelete.length === 0],
]
console.log('\n  CHECKS:')
let pass = 0
for (const [name, ok] of checks) { console.log(`    ${ok ? '✓' : '✗ FAIL'}  ${name}`); if (ok) pass++ }
console.log(`\n  ${pass}/${checks.length} passed\n`)
process.exit(pass === checks.length ? 0 : 1)
