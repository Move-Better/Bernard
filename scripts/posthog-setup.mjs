/**
 * PostHog Phase 2 Setup — creates the Bernard UX Frustration dashboard,
 * key insights, and alerts via the PostHog Management API.
 *
 * Requires: POSTHOG_PERSONAL_API_KEY in env (server-only, never VITE_).
 * Get it: PostHog → Project settings → Personal API keys → Create key
 * with "All access" on the bernard project. Store in 1Password (Bernard vault).
 *
 * Usage (from project root, with .env.local sourced or 1pw mount active):
 *   node scripts/posthog-setup.mjs
 *
 * Idempotent: skips creation if a dashboard/insight with the same name exists.
 */

import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

// ── Config ────────────────────────────────────────────────────────────────────

const PERSONAL_API_KEY = process.env.POSTHOG_PERSONAL_API_KEY
if (!PERSONAL_API_KEY) {
  // Try loading from .env.local
  try {
    const raw = readFileSync(resolve(process.cwd(), '.env.local'), 'utf8')
    for (const line of raw.split('\n')) {
      const m = line.match(/^POSTHOG_PERSONAL_API_KEY=(.+)$/)
      if (m) process.env.POSTHOG_PERSONAL_API_KEY = m[1].trim()
    }
  } catch { /* no .env.local */ }
  if (!process.env.POSTHOG_PERSONAL_API_KEY) {
    console.error('❌  POSTHOG_PERSONAL_API_KEY not set.')
    console.error('    Get it: PostHog → Project settings → Personal API keys')
    console.error('    Store in 1Password (Bernard vault) as POSTHOG_PERSONAL_API_KEY')
    process.exit(1)
  }
}

const API_KEY = process.env.POSTHOG_PERSONAL_API_KEY
const HOST = 'https://us.posthog.com'

// Get project id from VITE_POSTHOG_KEY prefix ("phc_...") via the /projects/ endpoint
async function getProjectId() {
  const r = await ph('GET', '/api/projects/')
  const projects = r.results ?? []
  if (!projects.length) throw new Error('No PostHog projects found for this API key')
  // Pick the one whose api_token matches VITE_POSTHOG_KEY if set, else take the first
  const projectToken = process.env.VITE_POSTHOG_KEY
  const match = projectToken ? projects.find(p => p.api_token === projectToken) : projects[0]
  return (match ?? projects[0]).id
}

// ── API helper ────────────────────────────────────────────────────────────────

async function ph(method, path, body) {
  const res = await fetch(`${HOST}${path}`, {
    method,
    headers: {
      Authorization: `Bearer ${API_KEY}`,
      'Content-Type': 'application/json',
    },
    body: body ? JSON.stringify(body) : undefined,
  })
  if (!res.ok) {
    const text = await res.text().catch(() => '')
    throw new Error(`PostHog ${method} ${path} → ${res.status}: ${text.slice(0, 200)}`)
  }
  return res.json()
}

// ── Dashboard helpers ─────────────────────────────────────────────────────────

async function getOrCreateDashboard(projectId, name, description) {
  const existing = await ph('GET', `/api/projects/${projectId}/dashboards/`)
  const found = (existing.results ?? []).find(d => d.name === name)
  if (found) { console.log(`  ✓ Dashboard "${name}" already exists (id ${found.id})`); return found.id }

  const created = await ph('POST', `/api/projects/${projectId}/dashboards/`, { name, description })
  console.log(`  ✓ Created dashboard "${name}" (id ${created.id})`)
  return created.id
}

async function createInsight(projectId, dashboardId, { name, query, description }) {
  const existing = await ph('GET', `/api/projects/${projectId}/insights/?search=${encodeURIComponent(name)}`)
  const found = (existing.results ?? []).find(i => i.name === name)
  if (found) { console.log(`    ✓ Insight "${name}" already exists — skipping`); return found.id }

  const insight = await ph('POST', `/api/projects/${projectId}/insights/`, {
    name,
    description,
    query,
    dashboards: [dashboardId],
    saved: true,
  })
  console.log(`    ✓ Created insight "${name}" (id ${insight.id})`)
  return insight.id
}

// ── Alert helpers ─────────────────────────────────────────────────────────────

async function createAlert(projectId, insightId, { name, threshold, type = 'absolute' }) {
  // PostHog alerts API — POST /api/projects/:id/alerts/
  const existing = await ph('GET', `/api/projects/${projectId}/alerts/`)
  const found = (existing.results ?? []).find(a => a.name === name)
  if (found) { console.log(`    ✓ Alert "${name}" already exists — skipping`); return }

  await ph('POST', `/api/projects/${projectId}/alerts/`, {
    name,
    insight: insightId,
    threshold: { type, value: threshold },
    condition: { type: 'absolute_value' },
    enabled: true,
  })
  console.log(`    ✓ Created alert "${name}" (threshold ≥ ${threshold})`)
}

// ── Insight definitions ───────────────────────────────────────────────────────

// HogQL-backed trend queries for PostHog's query builder
const insights = [
  {
    name: 'Rage clicks — daily trend',
    description: 'Count of $rageclick events per day. Spike = something just broke or became unresponsive.',
    query: {
      kind: 'TrendsQuery',
      series: [{ kind: 'EventsNode', event: '$rageclick', name: 'Rage clicks', math: 'total' }],
      interval: 'day',
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Top rage-clicked elements',
    description: 'Which CSS selectors / elements are being rage-clicked most. Direct fix list.',
    query: {
      kind: 'TrendsQuery',
      series: [{
        kind: 'EventsNode',
        event: '$rageclick',
        name: 'Rage clicks',
        math: 'total',
        math_group_type_index: null,
      }],
      breakdownFilter: { breakdown: '$el_text', breakdown_type: 'event' },
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Dead clicks — daily trend',
    description: 'Elements that look clickable but do nothing. Dead click = visual affordance mismatch.',
    query: {
      kind: 'TrendsQuery',
      series: [{ kind: 'EventsNode', event: '$dead_click', name: 'Dead clicks', math: 'total' }],
      interval: 'day',
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Core funnel — capture to published',
    description: 'capture_started → interview_completed → story_generated → published. Where do users drop?',
    query: {
      kind: 'FunnelsQuery',
      series: [
        { kind: 'EventsNode', event: 'capture_started', name: 'Capture started' },
        { kind: 'EventsNode', event: 'interview_completed', name: 'Interview completed' },
        { kind: 'EventsNode', event: 'story_generated', name: 'Story generated' },
        { kind: 'EventsNode', event: 'published', name: 'Published' },
      ],
      funnelsFilter: { funnelWindowInterval: 7, funnelWindowIntervalUnit: 'day' },
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Publish funnel — piece opened to scheduled/published',
    description: 'piece_opened → publish_scheduled | published. Storyboard/Publish drop-off.',
    query: {
      kind: 'FunnelsQuery',
      series: [
        { kind: 'EventsNode', event: 'piece_opened', name: 'Piece opened' },
        { kind: 'EventsNode', event: 'published', name: 'Published' },
      ],
      funnelsFilter: { funnelWindowInterval: 3, funnelWindowIntervalUnit: 'day' },
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Onboarding conversion',
    description: 'Pageview /onboard → onboard_complete. Self-serve activation rate.',
    query: {
      kind: 'FunnelsQuery',
      series: [
        { kind: 'EventsNode', event: '$pageview', name: 'Visited /onboard',
          properties: [{ key: '$current_url', operator: 'icontains', value: '/onboard', type: 'event' }] },
        { kind: 'EventsNode', event: 'onboard_complete', name: 'Workspace created' },
      ],
      funnelsFilter: { funnelWindowInterval: 1, funnelWindowIntervalUnit: 'day' },
      dateRange: { date_from: '-30d' },
    },
  },
  {
    name: 'Slowest pages — P95 load time',
    description: 'Routes with highest P95 load time. Candidates for code-split / query optimisation.',
    query: {
      kind: 'TrendsQuery',
      series: [{
        kind: 'EventsNode',
        event: '$pageview',
        name: 'P95 load time (ms)',
        math: 'p95',
        math_property: '$performance_page_loaded',
      }],
      breakdownFilter: { breakdown: '$pathname', breakdown_type: 'event' },
      dateRange: { date_from: '-30d' },
    },
  },
]

// ── Main ──────────────────────────────────────────────────────────────────────

async function main() {
  console.log('PostHog Phase 2 Setup — Bernard UX Frustration Dashboard\n')

  const projectId = await getProjectId()
  console.log(`Project id: ${projectId}\n`)

  console.log('Creating dashboard…')
  const dashboardId = await getOrCreateDashboard(
    projectId,
    'Bernard — UX Frustration',
    'Rage clicks, dead clicks, funnel drop-offs, slow routes. Fed to the Claude recommendation routine weekly.',
  )

  console.log('\nCreating insights…')
  const insightIds = {}
  for (const def of insights) {
    insightIds[def.name] = await createInsight(projectId, dashboardId, def)
  }

  console.log('\nCreating alerts…')
  // Alert fires when rage clicks exceed 20/day — conservative threshold to
  // catch genuine spikes without noise at low traffic. Tune after a week of data.
  if (insightIds['Rage clicks — daily trend']) {
    await createAlert(projectId, insightIds['Rage clicks — daily trend'], {
      name: 'Bernard — rage click spike',
      threshold: 20,
    })
  }
  // Alert fires when funnel conversion drops below 50% on any step — configured
  // as an absolute count; funnel-specific threshold alerting is coming in PostHog.
  // For now, a separate check: if capture_started drops to 0 for a day, something's broken.
  if (insightIds['Core funnel — capture to published']) {
    await createAlert(projectId, insightIds['Core funnel — capture to published'], {
      name: 'Bernard — capture_started dropped to 0',
      threshold: 0,
      type: 'absolute',
    })
  }

  console.log('\n✅  Done. Visit your PostHog project to review:')
  console.log(`   ${HOST}/project/${projectId}/dashboard/${dashboardId}`)
  console.log('\nNext steps:')
  console.log('  1. After 1–2 days of data, tune alert thresholds to your traffic baseline.')
  console.log('  2. Use Session Replay → filter by "rage click" to watch the worst sessions.')
  console.log('  3. Phase 3: add POSTHOG_PERSONAL_API_KEY to Vercel server env and schedule')
  console.log('     the Claude recommendation routine (/schedule).')
}

main().catch(e => { console.error('❌', e.message); process.exit(1) })
