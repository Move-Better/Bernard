// GET /api/content-plan/month-summary?month=YYYY-MM — T3 month overview
// (mockup screen 3): a light density chip per day (filled/needs-review/open
// counts), not per-post detail. Deliberately NOT a per-week week-summary
// fan-out — that would need one round-trip per week and (for anything more
// than ~2 months out) exceed week-summary's own ±8/+4 week nav bounds.
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { mergeSlotsIntoCadence } from '../../_lib/cadenceSlots.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MONTH_RE = /^\d{4}-\d{2}$/

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}
const err = (res, msg, status = 400) => res.status(status).json({ error: msg })

// Reviewable/needs-action states — mirrors YourWeek.jsx's cardState() review
// bucket (drafted/in_review/draft content, or an atom with no draft yet).
function isReviewable(ciStatus) {
  if (!ciStatus) return true // no content_item yet — needs a draft
  return !['scheduled', 'published', 'approved'].includes(ciStatus)
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, null, { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason || 'Unauthorized', auth.reason === 'forbidden' ? 403 : 401)
  if (!(await enforceLimit(req, res, 'generic', ws.id))) return

  const month = new URL(req.url, 'http://localhost').searchParams.get('month')
  if (!month || !MONTH_RE.test(month)) return err(res, 'Invalid month — must be YYYY-MM', 400)
  const [year, mo] = month.split('-').map(Number)
  const monthStart = new Date(Date.UTC(year, mo - 1, 1))
  const monthEnd = new Date(Date.UTC(year, mo, 1))
  const daysInMonth = Math.round((monthEnd - monthStart) / 86_400_000)

  const tz = ws.cadence_policy?.timezone || 'America/Los_Angeles'
  const quietDays = ws.cadence_policy?.quiet_days || [] // weekends open by default (feedback 2026-07-26)
  const WEEKDAY_CODES = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

  // Static per-weekday slot count (a weekly-recurring template, not simulated
  // per-week — the exploration rotation and other week-to-week variation is
  // out of scope for a "light overview"; Week view is the source of truth).
  const rawChannels = ws.cadence_policy?.channels || {}
  const cadenceWithSlots = mergeSlotsIntoCadence(rawChannels, rawChannels, quietDays, ws.cadence_policy?.formats)
  const slotsPerWeekday = {}
  for (const wd of WEEKDAY_CODES) slotsPerWeekday[wd] = 0
  for (const cfg of Object.values(cadenceWithSlots)) {
    if (!cfg?.enabled) continue
    for (const slot of cfg.slots || []) {
      if (slot.enabled === false) continue
      slotsPerWeekday[slot.weekday] = (slotsPerWeekday[slot.weekday] || 0) + 1
    }
  }

  const atomsRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}` +
      `&scheduled_at=gte.${monthStart.toISOString()}&scheduled_at=lt.${monthEnd.toISOString()}` +
      `&select=id,scheduled_at,content_piece_id,status,content_piece:content_items!content_piece_id(status)`,
  )
  if (!atomsRes.ok) return err(res, 'Database error', 500)
  const atoms = await atomsRes.json().catch(() => [])

  // A post published immediately (publish-now, no reserved slot time) loses its
  // scheduled_at: the content_item PATCH that flips status→published sends
  // scheduledAt:null, and db/content.js's schedule sync mirrors that onto the
  // linked atom (nulling scheduled_at while keeping plan_week). The scheduled_at
  // range query above therefore can't return it, so it vanishes from the
  // calendar even though it's live. Fetch those atoms separately (piece already
  // published, with a published_at inside the month) and place them by the
  // content_item's published_at. Mirrors the /week fix in #2398; read path only,
  // no data migration — self-healing for already-stranded rows. (feedback
  // 2026-07-27: a LinkedIn post published Monday didn't show as Live.)
  const publishedRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&scheduled_at=is.null` +
      `&content_piece.status=eq.published` +
      `&content_piece.published_at=gte.${monthStart.toISOString()}` +
      `&content_piece.published_at=lt.${monthEnd.toISOString()}` +
      `&select=id,content_piece_id,content_piece:content_items!content_piece_id!inner(status,published_at)`,
  )
  if (!publishedRes.ok) return err(res, 'Database error', 500)
  const publishedNow = await publishedRes.json().catch(() => [])

  const days = {}
  for (let d = 1; d <= daysInMonth; d++) {
    const iso = `${month}-${String(d).padStart(2, '0')}`
    const weekday = WEEKDAY_CODES[new Date(Date.UTC(year, mo - 1, d)).getUTCDay()]
    days[iso] = { live: 0, review: 0, open: slotsPerWeekday[weekday] || 0, quiet: quietDays.includes(weekday) }
  }

  // Local (workspace-tz) calendar day for a UTC instant — a value near midnight
  // can fall on a different local date, so this must go through Intl, not a raw
  // ISO slice.
  const dayFmt = new Intl.DateTimeFormat('en-US', {
    timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
  })
  const localDay = (iso) => {
    const parts = dayFmt.formatToParts(new Date(iso))
    const p = (t) => parts.find((x) => x.type === t)?.value
    return `${p('year')}-${p('month')}-${p('day')}`
  }

  // Drop an atom into its local-day bucket as live-or-review and consume one open
  // slot. Deduped by atom id so an atom surfacing in both queries counts once —
  // they can't overlap today (the range query excludes null scheduled_at) but the
  // guard keeps that assumption cheap.
  const seen = new Set()
  const place = (atomId, instantIso, ciStatus) => {
    if (!instantIso || seen.has(atomId)) return
    seen.add(atomId)
    const bucket = days[localDay(instantIso)]
    if (!bucket) return
    if (isReviewable(ciStatus)) bucket.review += 1
    else bucket.live += 1
    bucket.open = Math.max(0, bucket.open - 1)
  }

  for (const atom of atoms) place(atom.id, atom.scheduled_at, atom.content_piece?.status)
  for (const atom of publishedNow) place(atom.id, atom.content_piece?.published_at, 'published')

  return res.status(200).json({ month, days })
}
