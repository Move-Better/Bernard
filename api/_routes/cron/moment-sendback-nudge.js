// POST/GET /api/cron/moment-sendback-nudge
//
// Tells an author that a producer sent one of their quotes back for repair
// (migration 200). Without this the flag is invisible until they happen to open
// /moments — and a quote awaiting repair is held out of drafting, so silence
// here costs real posts.
//
// Daily. For each active workspace:
//   1. Find banked moments with sent_back_at set and no nudge sent yet.
//   2. Group by staff_id — the person who SAID it is the only one who can fix it.
//   3. Resolve that staff row's Clerk email; skip anyone unclaimed.
//   4. One email per author, listing their own quotes and the producer's note.
//   5. Stamp sent_back_notified_at on exactly the rows that were emailed.
//
// The watermark is stamped AFTER a successful send and only on the rows that
// went out, so a Resend failure means those rows are simply picked up tomorrow
// rather than being silently marked as delivered. There is no cooldown beyond
// the watermark itself: each moment is nudged once, so a second email only ever
// happens because a producer sent something NEW back.
//
// Auth: Bearer CRON_SECRET.
//
// Safe-verification switches, both default OFF: `?dryRun=1` returns the exact
// plan without sending or stamping; `?slug=<slug>` restricts the run to one
// workspace. A first live run mails real clinicians, so it can be rehearsed.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { withSentry } from '../../_lib/sentry.js'
import { createClerkClient } from '@clerk/backend'
import { verifyCronSecret } from '../../_lib/auth.js'
import { buildSendBackNudge, momentsUrl } from '../../_lib/momentSendBackEmail.js'

const SUPABASE_URL   = process.env.SUPABASE_URL
const SUPABASE_KEY   = process.env.SUPABASE_SERVICE_KEY
const RESEND_API_KEY = process.env.RESEND_API_KEY
const CLERK_SECRET   = process.env.CLERK_SECRET_KEY
const NOTIFY_FROM    = process.env.ADMIN_NOTIFY_FROM || 'Bernard <noreply@withbernard.ai>'

const RESEND_ENDPOINT = 'https://api.resend.com/emails'
const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,62}$/

// Cap per email. Beyond this the list stops being scannable and starts reading
// as a chore; the app shows the rest. Overflow is NOT dropped — only the rows
// actually emailed get stamped, so the remainder goes out in the next run, and
// the API response reports `remaining` so a truncated batch is never silent.
const MAX_ITEMS_PER_EMAIL = 8

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
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })

  const url    = new URL(req.url, 'http://localhost')
  const dryRun = ['1', 'true'].includes((url.searchParams.get('dryRun') || '').toLowerCase())
  const onlySlug = url.searchParams.get('slug') || null
  if (onlySlug && !SLUG_RE.test(onlySlug)) return res.status(400).json({ error: 'invalid_slug' })

  if (!dryRun && !RESEND_API_KEY) return res.status(503).json({ error: 'RESEND_API_KEY not configured' })
  if (!CLERK_SECRET) return res.status(503).json({ error: 'CLERK_SECRET_KEY not configured' })

  const wsRes = await sb(
    'workspaces?status=eq.active' +
    (onlySlug ? `&slug=eq.${encodeURIComponent(onlySlug)}` : '') +
    // No `name` column on workspaces — including it 400s the query (42703).
    '&select=id,slug,display_name'
  )
  if (!wsRes.ok) {
    console.error('[moment-sendback-nudge] workspaces fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'db_error' })
  }
  const workspaces = await wsRes.json().catch(() => [])
  const results = []

  for (const ws of workspaces) {
    try {
      const pendRes = await sb(
        `moments?workspace_id=eq.${ws.id}&status=eq.banked` +
        `&sent_back_at=not.is.null&sent_back_notified_at=is.null&staff_id=not.is.null` +
        `&select=id,excerpt,staff_id,sent_back_at,sent_back_by,sent_back_note` +
        `&order=sent_back_at.asc`
      )
      if (!pendRes.ok) {
        console.error(`[moment-sendback-nudge] pending fetch failed for ${ws.slug}:`, pendRes.status)
        results.push({ workspace: ws.slug, error: 'pending_fetch_failed' })
        continue
      }
      const pending = await pendRes.json().catch(() => [])
      if (pending.length === 0) {
        results.push({ workspace: ws.slug, skipped: 'nothing_pending' })
        continue
      }

      // staff_id → the author; sent_back_by is a Clerk id → the producer's name
      // for the "who asked" line. Both come from the same staff table.
      const staffIds = [...new Set(pending.map((m) => m.staff_id))]
      const staffRes = await sb(
        `staff?workspace_id=eq.${ws.id}&id=in.(${staffIds.join(',')})&select=id,name,user_id`
      )
      const staffRows = staffRes.ok ? await staffRes.json().catch(() => []) : []
      const staffById = new Map(staffRows.map((s) => [s.id, s]))

      const senderRes = await sb(`staff?workspace_id=eq.${ws.id}&user_id=not.is.null&select=user_id,name`)
      const senderRows = senderRes.ok ? await senderRes.json().catch(() => []) : []
      const nameByUserId = new Map(senderRows.map((s) => [s.user_id, s.name]))

      const byStaff = new Map()
      for (const m of pending) {
        if (!byStaff.has(m.staff_id)) byStaff.set(m.staff_id, [])
        byStaff.get(m.staff_id).push(m)
      }

      const perWorkspace = []
      for (const [staffId, rows] of byStaff) {
        const staff = staffById.get(staffId)
        if (!staff?.user_id) {
          // An unclaimed staff row has no inbox. Their quotes stay pending and
          // unstamped, so this resolves itself the day the account is linked.
          perWorkspace.push({ staff: staff?.name || staffId, skipped: 'no_linked_account', count: rows.length })
          continue
        }

        let email = null
        try {
          const user = await clerk().users.getUser(staff.user_id)
          email = user.emailAddresses?.find((a) => a.id === user.primaryEmailAddressId)?.emailAddress
            || user.emailAddresses?.[0]?.emailAddress
        } catch (e) {
          console.warn(`[moment-sendback-nudge] clerk lookup failed for ${staff.user_id}:`, e?.message)
        }
        if (!email) {
          perWorkspace.push({ staff: staff.name || staffId, skipped: 'no_email', count: rows.length })
          continue
        }

        const shown = rows.slice(0, MAX_ITEMS_PER_EMAIL)
        const { subject, html, text } = buildSendBackNudge({
          workspace: ws,
          recipientName: staff.name || null,
          items: shown.map((m) => ({
            excerpt: m.excerpt,
            note: m.sent_back_note,
            senderName: nameByUserId.get(m.sent_back_by) || null,
          })),
        })

        if (dryRun) {
          perWorkspace.push({
            staff: staff.name || staffId, dry_run: true, to: email,
            subject, pending: rows.length, shown: shown.length, link: momentsUrl(ws.slug),
          })
          continue
        }

        let ok = false
        try {
          const sendRes = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: NOTIFY_FROM, to: [email], subject, text, html }),
          })
          ok = sendRes.ok
          if (!ok) {
            const t = await sendRes.text().catch(() => '')
            console.error(`[moment-sendback-nudge] resend ${sendRes.status} for ${ws.slug}:`, t.slice(0, 200))
          }
        } catch (e) {
          console.error(`[moment-sendback-nudge] resend threw for ${ws.slug}:`, e?.message)
        }

        if (!ok) {
          // Unstamped on purpose — tomorrow's run retries rather than treating
          // a failed send as delivered.
          perWorkspace.push({ staff: staff.name || staffId, sent: false, count: rows.length })
          continue
        }

        // Stamp ONLY what was in the email. Anything beyond MAX_ITEMS_PER_EMAIL
        // stays pending and goes out in the next run.
        const ids = shown.map((m) => m.id)
        const stampRes = await sb(
          `moments?workspace_id=eq.${ws.id}&id=in.(${ids.join(',')})`,
          { method: 'PATCH', body: JSON.stringify({ sent_back_notified_at: new Date().toISOString() }) },
        )
        if (!stampRes.ok) {
          // Surfaced, not swallowed: an unstamped success is the one failure
          // mode that would re-mail the same person tomorrow.
          console.error(`[moment-sendback-nudge] stamp failed for ${ws.slug}:`, stampRes.status)
        }
        perWorkspace.push({
          staff: staff.name || staffId, sent: true, to: email,
          notified: ids.length, remaining: rows.length - ids.length,
          stamped: stampRes.ok,
        })
      }

      results.push({ workspace: ws.slug, pending: pending.length, authors: perWorkspace })
    } catch (e) {
      console.error(`[moment-sendback-nudge] ${ws.slug} threw:`, e?.message)
      results.push({ workspace: ws.slug, error: 'workspace_failed' })
    }
  }

  return res.status(200).json({ ok: true, dryRun, workspaces: results })
}

export default withSentry(handler)
