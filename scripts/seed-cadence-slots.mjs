#!/usr/bin/env node
// T3 — one-time backfill: persist a pinned posting-slot list onto every active
// workspace's cadence_policy.channels[platform].slots, computed with the SAME
// even-spread + BEST_HOUR math the app already used to stamp scheduled_at —
// see api/_lib/cadenceSlots.js defaultSlotsForChannel(). Existing cadence
// targets translate into a sensible starting slot layout with no manual setup.
//
// Idempotent: skips any channel that already has a non-empty `.slots` array,
// so re-running (or a workspace onboarded after this ran) is safe. Channels
// that are disabled or have target_per_week === 0 are left alone — this
// backfill is generic over cadence_policy.channels[x].enabled, so a channel
// re-enabled later (e.g. instagram_story reviving, per .claude/decisions.md
// 2026-07-21) gets sensible default slots the next time it's read even
// without a second run of this script (the same fallback is computed live by
// mergeSlotsIntoCadence when no slots are persisted yet) — this script just
// makes the day-one state concrete rather than relying on the live fallback.
//
// Usage:
//   node scripts/seed-cadence-slots.mjs [--dry-run]

import { defaultSlotsForChannel } from '../api/_lib/cadenceSlots.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_KEY in env.')
  process.exit(1)
}
const DRY_RUN = process.argv.includes('--dry-run')

function sb(path, init = {}) {
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

async function main() {
  const r = await sb('workspaces?status=eq.active&select=id,slug,cadence_policy')
  if (!r.ok) throw new Error(`fetch workspaces failed: ${r.status} ${await r.text().catch(() => '')}`)
  const workspaces = await r.json()

  let seededCount = 0
  for (const ws of workspaces) {
    const policy = ws.cadence_policy
    if (!policy || typeof policy !== 'object') {
      console.log(`[skip] ${ws.slug} — no cadence_policy`)
      continue
    }
    const channels = policy.channels || {}
    const quietDays = Array.isArray(policy.quiet_days) ? policy.quiet_days : ['sat', 'sun']
    let changed = false
    const nextChannels = {}
    for (const [platform, cfg] of Object.entries(channels)) {
      nextChannels[platform] = { ...cfg }
      const hasSlots = Array.isArray(cfg.slots) && cfg.slots.length > 0
      if (hasSlots || !cfg.enabled || !(cfg.target_per_week > 0)) continue
      const slots = defaultSlotsForChannel(platform, cfg.target_per_week, quietDays)
      if (!slots.length) continue
      nextChannels[platform].slots = slots
      changed = true
    }
    if (!changed) {
      console.log(`[skip] ${ws.slug} — nothing to seed`)
      continue
    }
    seededCount++
    console.log(`[${DRY_RUN ? 'dry-run' : 'seed'}] ${ws.slug}:`)
    for (const [platform, cfg] of Object.entries(nextChannels)) {
      if (cfg.slots) console.log(`  ${platform}: ${cfg.slots.map((s) => `${s.weekday} ${s.hour}:00 ${s.format}`).join(', ')}`)
    }
    if (!DRY_RUN) {
      const patchRes = await sb(`workspaces?id=eq.${ws.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ cadence_policy: { ...policy, channels: nextChannels } }),
      })
      if (!patchRes.ok) {
        console.error(`  FAILED to patch ${ws.slug}: ${patchRes.status} ${await patchRes.text().catch(() => '')}`)
        seededCount--
      }
    }
  }
  console.log(`\n${DRY_RUN ? '[dry-run] would seed' : 'Seeded'} ${seededCount}/${workspaces.length} workspace(s).`)
}

main().catch((e) => {
  console.error(e)
  process.exit(1)
})
