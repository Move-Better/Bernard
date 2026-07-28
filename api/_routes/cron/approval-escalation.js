// POST/GET /api/cron/approval-escalation
//
// The Standing Producer's "these slots need you" nudge (.claude/decisions.md
// 2026-07-28 — built INSTEAD of P5 approve-once, because the measured problem is
// attention, not review effort: 8 missed slots in 14 days against a 0.6h median
// time-to-approve when someone actually looks).
//
// Daily. For each active workspace with the `escalation_email` producer lane on:
//   1. Skip if a nudge already went out inside the cooldown (≤1/day/workspace).
//   2. Find pieces sitting unapproved whose slot is today or already past.
//   3. Skip if there are none — a clean queue sends NOTHING, ever.
//   4. Resolve owner + producer-tier recipients via Clerk.
//   5. Send one email each (a bad address must not blackhole the workspace).
//   6. Record ONE `approval_nudge` row in agent_actions carrying the piece ids
//      and recipients — this is the instrument the 4-week P5 unlock threshold
//      is read from, so it is recorded AFTER the send and its success is
//      surfaced in the response rather than swallowed.
//
// Auth: Bearer CRON_SECRET.
//
// Safe-verification switches (both default OFF, so the scheduled run is
// unaffected): `?dryRun=1` computes and returns the exact plan without sending
// or recording; `?slug=<slug>` restricts the whole run to one workspace. A real
// first send is an outbound action to real people — these exist so it can be
// rehearsed and then aimed at exactly one inbox.

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { withSentry } from '../../_lib/sentry.js'
import { createClerkClient } from '@clerk/backend'
import { verifyCronSecret } from '../../_lib/auth.js'
import { laneEnabled } from '../../_lib/producer/config.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { buildEscalation } from '../../_lib/approvalEscalationEmail.js'
import {
  findOverdueApprovals, hasRecentNudge, pieceUrl,
  NUDGE_KIND, MAX_ITEMS_PER_EMAIL,
} from '../../_lib/producer/approvalEscalation.js'

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
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// The humans who can actually clear this queue. Owner + producer tier — the same
// population the /producer control surface is gated to. Deliberately NOT every
// clinician: a nudge that reaches people who cannot act on it is the exact
// escalation fatigue the sprint plan warned about.
async function resolveRecipients(wsId) {
  const r = await sb(
    `staff?workspace_id=eq.${wsId}&permission_tier=in.(owner,producer)` +
    `&user_id=not.is.null&select=user_id,name`
  )
  if (!r.ok) {
    console.error('[approval-escalation] staff fetch failed:', r.status)
    return []
  }
  const rows = (await r.json().catch(() => [])) || []

  const out = []
  for (const s of rows) {
    try {
      const user = await clerk().users.getUser(s.user_id)
      const email = user.emailAddresses?.find((a) => a.id === user.primaryEmailAddressId)?.emailAddress
        || user.emailAddresses?.[0]?.emailAddress
      if (email) out.push({ email, name: s.name || null })
    } catch (e) {
      console.warn(`[approval-escalation] clerk lookup failed for ${s.user_id}:`, e?.message)
    }
  }
  // Same person can hold two staff rows; never email them twice.
  return [...new Map(out.map((r2) => [r2.email.toLowerCase(), r2])).values()]
}

async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })

  const url    = new URL(req.url, 'http://localhost')
  const dryRun = ['1', 'true'].includes((url.searchParams.get('dryRun') || '').toLowerCase())
  const onlySlug = url.searchParams.get('slug') || null
  if (onlySlug && !SLUG_RE.test(onlySlug)) {
    return res.status(400).json({ error: 'invalid_slug' })
  }

  if (!dryRun && !RESEND_API_KEY) return res.status(503).json({ error: 'RESEND_API_KEY not configured' })
  if (!CLERK_SECRET)              return res.status(503).json({ error: 'CLERK_SECRET_KEY not configured' })

  const wsRes = await sb(
    'workspaces?status=eq.active' +
    (onlySlug ? `&slug=eq.${encodeURIComponent(onlySlug)}` : '') +
    '&select=id,slug,display_name,name,colors,cadence_policy,producer_config'
  )
  if (!wsRes.ok) {
    console.error('[approval-escalation] workspaces fetch failed:', wsRes.status)
    return res.status(500).json({ error: 'db_error' })
  }
  const workspaces = await wsRes.json().catch(() => [])

  const now = new Date()
  const results = []

  for (const ws of workspaces) {
    try {
      // Consent gate. `escalation_email` is a Standing Producer lane, so this is
      // false whenever the producer is disabled OR paused — a paused producer is
      // silent, which is the promise the /producer pause control makes.
      if (!laneEnabled(ws.producer_config, 'escalation_email')) {
        results.push({ workspace: ws.slug, skipped: 'lane_off' })
        continue
      }

      if (!dryRun && await hasRecentNudge({ workspaceId: ws.id, sb, now })) {
        results.push({ workspace: ws.slug, skipped: 'cooldown' })
        continue
      }

      const overdue = await findOverdueApprovals({ workspaceId: ws.id, sb, now })
      if (overdue.length === 0) {
        results.push({ workspace: ws.slug, skipped: 'queue_clean' })
        continue
      }

      const shown = overdue.slice(0, MAX_ITEMS_PER_EMAIL)
      const recipients = await resolveRecipients(ws.id)
      if (recipients.length === 0) {
        results.push({ workspace: ws.slug, skipped: 'no_recipients', overdue: overdue.length })
        continue
      }

      const { subject, html, text } = buildEscalation({
        workspace: ws, items: shown, totalCount: overdue.length,
      })

      if (dryRun) {
        results.push({
          workspace:  ws.slug,
          dry_run:    true,
          overdue:    overdue.length,
          subject,
          recipients: recipients.map((r) => r.email),
          links:      shown.map((it) => pieceUrl(ws.slug, it.pieceId)),
        })
        continue
      }

      // One send per recipient: Resend rejects an ENTIRE batch on any single
      // bad `to[]` entry, and per-address volume here is tiny.
      let sent = 0
      const failures = []
      for (const r2 of recipients) {
        try {
          const sendRes = await fetch(RESEND_ENDPOINT, {
            method: 'POST',
            headers: { Authorization: `Bearer ${RESEND_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ from: NOTIFY_FROM, to: [r2.email], subject, text, html }),
          })
          if (sendRes.ok) { sent++ } else {
            const t = await sendRes.text().catch(() => '')
            console.error(`[approval-escalation] resend ${sendRes.status} for ${ws.slug}:`, t.slice(0, 200))
            failures.push({ email: r2.email, status: sendRes.status })
          }
        } catch (e) {
          console.error(`[approval-escalation] resend threw for ${ws.slug}:`, e?.message)
          failures.push({ email: r2.email, error: 'send_failed' })
        }
      }

      if (sent === 0) {
        // Nothing was delivered, so nothing is recorded — the ledger must mean
        // "a human was actually emailed", or the 4-week measurement is fiction.
        results.push({ workspace: ws.slug, sent: false, error: 'all_recipients_failed', failures })
        continue
      }

      // Record AFTER the send, reflecting what actually went out. This row is
      // the measurement instrument (see the SQL in the PR body), so its success
      // is surfaced rather than swallowed — a silent ledger failure would look
      // exactly like "no nudge was ever sent" four weeks from now.
      const recorded = await recordAgentAction({
        workspaceId:    ws.id,
        producerConfig: ws.producer_config,
        kind:           NUDGE_KIND,
        title:          `Nudged ${sent === 1 ? '1 person' : `${sent} people`} about ${overdue.length} post${overdue.length === 1 ? '' : 's'} past their slot`,
        contentItemId:  overdue.length === 1 ? overdue[0].pieceId : null,
        detail: {
          overdue_count:   overdue.length,
          piece_ids:       overdue.map((it) => it.pieceId),
          platforms:       [...new Set(overdue.map((it) => it.platform).filter(Boolean))],
          max_days_past:   Number(overdue[overdue.length - 1]?.daysPast?.toFixed?.(1) ?? 0),
          recipients:      recipients.map((r2) => r2.email),
          recipient_count: sent,
          sent_at:         new Date().toISOString(),
        },
      })
      if (!recorded?.ok) {
        console.error(`[approval-escalation] WARN: emailed ${ws.slug} but the ledger write failed — this nudge will be invisible to the 4-week measurement`)
      }

      results.push({
        workspace:  ws.slug,
        sent:       true,
        recipients: sent,
        attempted:  recipients.length,
        overdue:    overdue.length,
        recorded:   !!recorded?.ok,
        failures:   failures.length ? failures : undefined,
      })
    } catch (e) {
      console.error(`[approval-escalation] error for ${ws.slug}:`, e?.stack || e?.message || e)
      results.push({ workspace: ws.slug, sent: false, error: 'workspace_error' })
    }
  }

  return res.status(200).json({
    ok: true,
    dry_run: dryRun,
    at: now.toISOString(),
    processed: results.length,
    results,
  })
}

export default withSentry(handler)
