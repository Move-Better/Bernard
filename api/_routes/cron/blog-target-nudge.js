// POST/GET /api/cron/blog-target-nudge
//
// The 1-blog-per-clinician-per-month nudge (Q, 2026-08-01).
//
// Daily. For each active workspace with the blog target on:
//   1. Skip unless we are late enough in the month to fairly say "you're behind"
//      (NUDGE_FROM_DAY_OF_MONTH) — every clinician reads zero for most of a
//      month, so an early nudge is an all-staff guilt email, not a signal.
//   2. Find clinicians opted into blog review who are still short of target.
//   3. Skip anyone whose staff.blog_target_nudged_month already equals this
//      month — at most one per person per month, ever.
//   4. Skip anyone with no Clerk account; there is nowhere to send.
//   5. Send one email each (a bad address must not blackhole the workspace).
//   6. Stamp blog_target_nudged_month on exactly the rows that were emailed.
//
// The watermark is a column on staff rather than an agent_actions row on
// purpose: recordAgentAction() is gated on the workspace's producer config being
// enabled and silently returns { skipped } when it is not, so a cooldown built
// on it would fail OPEN — nothing recorded, and every clinician short of target
// emailed once a day for the rest of the month. Stamping the person's own row
// cannot fail open. Mirrors the moment-sendback nudge.
//
// A clinician who is AT target sends nothing, and a workspace where everyone is
// at target sends nothing at all — silence is the normal state.
//
// Auth: Bearer CRON_SECRET.
//
// Safe-verification switches, both default OFF: `?dryRun=1` computes and returns
// the exact plan without sending or recording; `?slug=<slug>` restricts the run
// to one workspace. This emails real clinicians, so the first live run should be
// rehearsed with dryRun and then aimed at one workspace.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { withSentry } from '../../_lib/sentry.js'
import { createClerkClient } from '@clerk/backend'
import { verifyCronSecret } from '../../_lib/auth.js'
import {
  blogTargetFor, monthKey, dayOfMonth, progressFor, NUDGE_FROM_DAY_OF_MONTH,
} from '../../_lib/blogTarget.js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const CLERK_SECRET   = process.env.CLERK_SECRET_KEY
const NOTIFY_FROM    = process.env.ADMIN_NOTIFY_FROM || 'Bernard <noreply@withbernard.ai>'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

let _clerk = null
function clerk() {
  if (!_clerk) _clerk = createClerkClient({ secretKey: CLERK_SECRET })
  return _clerk
}

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; every query below is scoped by a workspace_id taken from that list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(8_000),
    ...init,
    headers: {
      apikey:         SUPABASE_KEY,
      Authorization:  `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function buildEmail({ firstName, count, target, monthLabel, workspaceHost }) {
  const short = target - count
  const subject = count === 0
    ? `Your ${monthLabel} blog — nothing captured yet`
    : `Your ${monthLabel} blog — ${short} to go`
  const opener = count === 0
    ? `You haven't captured a blog this month yet.`
    : `You've captured ${count} of ${target} this month.`
  const text = [
    `Hi${firstName ? ` ${firstName}` : ''},`,
    '',
    opener,
    '',
    `The way a blog gets written here is that you talk and Bernard writes it up — an interview is the whole job. Start one and this month is done:`,
    // /new (the capture picker) is the real entry point. There is no bare
    // /interview route — it is /interview/:staffId/:interviewId, which needs ids
    // this email has no business minting.
    `https://${workspaceHost}/new`,
    '',
    `Anything already waiting on your read is on your week:`,
    `https://${workspaceHost}/week`,
  ].join('\n')
  return { subject, text }
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })

  const url      = new URL(req.url, 'http://localhost')
  const dryRun   = ['1', 'true'].includes((url.searchParams.get('dryRun') || '').toLowerCase())
  const onlySlug = url.searchParams.get('slug') || null
  if (onlySlug && !SLUG_RE.test(onlySlug)) return res.status(400).json({ error: 'invalid_slug' })

  if (!dryRun && !RESEND_API_KEY) return res.status(503).json({ error: 'RESEND_API_KEY not configured' })
  if (!CLERK_SECRET) return res.status(503).json({ error: 'CLERK_SECRET_KEY not configured' })

  const wsRes = await sb(
    'workspaces?status=eq.active' +
    (onlySlug ? `&slug=eq.${encodeURIComponent(onlySlug)}` : '') +
    '&select=id,slug,display_name,cadence_policy'
  )
  if (!wsRes.ok) {
    console.error('[blog-target-nudge] workspaces fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'db_error' })
  }
  const workspaces = await wsRes.json().catch(() => [])
  const results = []
  const now = new Date()

  for (const ws of workspaces) {
    try {
      const target = blogTargetFor(ws)
      if (!target.enabled) { results.push({ slug: ws.slug, skipped: 'target_disabled' }); continue }

      const tz = ws.cadence_policy?.timezone || 'America/Los_Angeles'
      const month = monthKey(now, tz)
      const day = dayOfMonth(now, tz)
      if (day < NUDGE_FROM_DAY_OF_MONTH) {
        results.push({ slug: ws.slug, skipped: 'too_early_in_month', day, nudgeFromDay: NUDGE_FROM_DAY_OF_MONTH })
        continue
      }

      // One nudge per person per month — the watermark filter is applied in the
      // query itself, so a clinician already stamped for this month is never
      // even considered.
      const staffRes = await sb(
        `staff?workspace_id=eq.${ws.id}&blog_review_enabled=is.true&user_id=not.is.null` +
        `&or=(blog_target_nudged_month.is.null,blog_target_nudged_month.neq.${month})` +
        `&select=id,name,user_id,blog_target_nudged_month`
      )
      if (!staffRes.ok) { results.push({ slug: ws.slug, error: `staff_${staffRes.status}` }); continue }
      const clinicians = await staffRes.json().catch(() => [])
      if (!clinicians.length) { results.push({ slug: ws.slug, skipped: 'nobody_to_nudge' }); continue }

      // One query for the whole workspace's blogs this month, then counted per
      // clinician in memory — never a round-trip per person.
      const ids = clinicians.map((c) => `"${c.id}"`).join(',')
      const blogRes = await sb(
        `content_items?workspace_id=eq.${ws.id}&platform=eq.blog&staff_id=in.(${ids})` +
        `&select=id,staff_id,platform,status,created_at`
      )
      if (!blogRes.ok) { results.push({ slug: ws.slug, error: `blogs_${blogRes.status}` }); continue }
      const blogs = await blogRes.json().catch(() => [])
      const byStaff = new Map()
      for (const b of blogs) {
        if (!byStaff.has(b.staff_id)) byStaff.set(b.staff_id, [])
        byStaff.get(b.staff_id).push(b)
      }

      const behind = clinicians
        .map((c) => ({ c, p: progressFor(byStaff.get(c.id) || [], month, target.perClinicianPerMonth, tz) }))
        .filter(({ p }) => !p.met)

      if (!behind.length) { results.push({ slug: ws.slug, month, skipped: 'everyone_at_target' }); continue }

      const host = `${ws.slug}.withbernard.ai`
      const monthLabel = new Date(`${month}-01T12:00:00Z`)
        .toLocaleDateString('en-US', { month: 'long', timeZone: 'UTC' })
      const sent = []
      const failed = []

      for (const { c, p } of behind) {
        let email = null
        let firstName = null
        try {
          const u = await clerk().users.getUser(c.user_id)
          email = u?.primaryEmailAddress?.emailAddress
            || u?.emailAddresses?.[0]?.emailAddress
            || null
          firstName = u?.firstName || (c.name ? String(c.name).split(' ')[0] : null)
        } catch (e) {
          console.error(`[blog-target-nudge] clerk lookup failed for staff=${c.id}:`, e?.message)
        }
        if (!email) { failed.push({ staffId: c.id, name: c.name, reason: 'no_email' }); continue }

        const { subject, text } = buildEmail({
          firstName, count: p.count, target: p.target, monthLabel, workspaceHost: host,
        })
        if (dryRun) { sent.push({ staffId: c.id, name: c.name, email, subject, count: p.count }); continue }

        try {
          const r = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: NOTIFY_FROM, to: [email], subject, text }),
          })
          if (!r.ok) {
            console.error(`[blog-target-nudge] resend ${r.status} for staff=${c.id}`)
            failed.push({ staffId: c.id, name: c.name, reason: `resend_${r.status}` })
            continue
          }
          sent.push({ staffId: c.id, name: c.name, count: p.count })
        } catch (e) {
          console.error(`[blog-target-nudge] resend threw for staff=${c.id}:`, e?.message)
          failed.push({ staffId: c.id, name: c.name, reason: 'resend_threw' })
        }
      }

      // Stamped AFTER the sends, and only on who actually got one — this is the
      // per-month watermark, so stamping someone who was never emailed would
      // silently suppress their nudge for the rest of the month. Conversely a
      // failed stamp means they get one again tomorrow, which is the safe
      // direction to fail.
      let stamped = null
      if (!dryRun && sent.length) {
        const ids = sent.map((s) => `"${s.staffId}"`).join(',')
        const r = await sb(`staff?workspace_id=eq.${ws.id}&id=in.(${ids})`, {
          method: 'PATCH',
          headers: { Prefer: 'return=minimal' },
          body: JSON.stringify({ blog_target_nudged_month: month }),
        })
        stamped = r.ok ? 'ok' : `failed_${r.status}`
        if (!r.ok) console.error('[blog-target-nudge] watermark stamp failed:', r.status)
      }

      results.push({
        slug: ws.slug, month, day, target: target.perClinicianPerMonth,
        behind: behind.length, sent, failed, stamped, dryRun,
      })
    } catch (e) {
      console.error(`[blog-target-nudge] workspace ${ws.slug} threw:`, e?.message)
      results.push({ slug: ws.slug, error: 'threw' })
    }
  }

  return res.status(200).json({ ok: true, dryRun, results })
}

export default withSentry(handler)
