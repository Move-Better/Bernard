// One-off: run the (backlog-aware) Strategist replan for a single workspace's
// current week against prod. Promotes banked backlog into this week with slots.
// Needs SUPABASE_URL, SUPABASE_SERVICE_KEY in env. No LLM call when there are no
// fresh interviews this week (it just promotes backlog).
import { replanWorkspaceWeek } from '../api/_lib/strategistPlan.js'

const WS_ID = process.argv[2]
if (!WS_ID) { console.error('usage: node run-replan-once.mjs <workspace_id>'); process.exit(1) }
const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) { console.error('Missing SUPABASE env'); process.exit(1) }

const wsRes = await fetch(
  `${SUPABASE_URL}/rest/v1/workspaces?id=eq.${WS_ID}&select=id,slug,cadence_policy`,
  { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
)
const [ws] = await wsRes.json()
if (!ws) { console.error('workspace not found'); process.exit(1) }

const stats = await replanWorkspaceWeek({ workspace: ws })
console.log(JSON.stringify(stats, null, 2))
