export const config = { runtime: 'nodejs' }
// Cron: auto-publish eligible story packages (every 10 minutes).
//
// For each video-pipeline-enabled workspace that has at least one channel
// with auto_publish enabled, walks approved story_packages that haven't been
// auto-published yet, runs the gate evaluator, and dispatches eligible
// packages via the existing Buffer publish path (useQueue=true so the post
// lands in the Buffer queue rather than firing immediately).
//
// GBP is the only live channel at launch — other channels in
// auto_publish_settings are accepted and stored but silently skipped here
// until they're wired.
//
// Auth: Bearer CRON_SECRET (same as backup-db and refresh-engagement).

import { evaluate } from '../../_lib/autoPublishGate.js'
import { getCredential } from '../../_lib/getCredential.js'
import { prepareMediaForBuffer } from '../../_lib/prepareMediaForBuffer.js'
import { filterCampaignsForStaff } from '../../_lib/tentpoleCampaignContext.js'
import { getActiveCampaigns } from '../../_lib/activeCampaigns.js'
import { BundlePublisher } from '../../_lib/social/bundlePublisher.js'
import { verifyCronSecret } from '../../_lib/auth.js'
import {
  MAX_AUTO_PUBLISH_RETRIES,
  unpostedTargets,
  mergePostedLocations,
  isChannelComplete,
  decideClaimDisposition,
} from '../../_lib/autoPublishRetry.js'
import { waitUntil } from '@vercel/functions'

const SUPABASE_URL  = process.env.SUPABASE_URL
const SUPABASE_KEY  = process.env.SUPABASE_SERVICE_KEY
const BUFFER_GQL    = 'https://api.buffer.com/graphql'

// How many approved packages to consider per workspace per run.
const BATCH_SIZE = 20

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// eslint-disable-next-line bernard/require-workspace-scope -- Cron — iterates all workspaces; each DB query is scoped by workspace_id from the workspace list
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

// Resolve bundle GBP location targets for a workspace: active locations with a bundle Team.
async function resolveBundleGbpTargets(workspaceId) {
  const r = await sb(
    `workspace_locations?workspace_id=eq.${workspaceId}&status=eq.active&bundle_team_id=not.is.null&select=id,label,bundle_team_id`
  )
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.bundle_team_id === 'string' && row.bundle_team_id.trim())
    .map((row) => ({ locationId: row.id, label: row.label, teamId: row.bundle_team_id }))
}

// Dispatch a GBP package via bundle.social (one post per location team).
// `targets` is the PENDING (not-yet-posted) subset — the caller filters out
// locations already recorded in published_channels so they're never re-sent.
// Returns { posted: [{ id, postId }], failed: [id] } keyed by the stable target
// id (= bundle teamId) so the caller can record exactly which locations posted.
async function dispatchGbpBundle({ pkg, workspace, targets }) {
  const text = pkg.caption_text || pkg.topic || ''
  const mediaUrls = Array.isArray(pkg.renders)
    ? pkg.renders.filter((r) => r.channel === 'gbp_post' && r.blobUrl).map((r) => ({ url: r.blobUrl, type: 'image' }))
    : []

  const posted = []
  const failed = []
  for (const target of targets) {
    const pub = new BundlePublisher(workspace, { teamId: target.teamId })
    try {
      const result = await pub.publish({ platform: 'gbp', content: text, mediaUrls })
      posted.push({ id: target.id, postId: result?.postId ?? null })
    } catch (e) {
      console.error('[auto-publish] bundle GBP dispatch failed for location:', target.label, e?.message)
      failed.push(target.id)
    }
  }
  return { posted, failed }
}

// Resolve Buffer GBP channel IDs for a workspace (same logic as api/publish/buffer.js).
async function resolveGbpChannelIds(workspaceId) {
  const r = await sb(
    `workspace_locations?workspace_id=eq.${workspaceId}&status=eq.active&gbp_location_id=not.is.null&select=id,gbp_location_id`
  )
  if (!r.ok) return []
  const rows = await r.json().catch(() => [])
  return (Array.isArray(rows) ? rows : [])
    .filter((row) => typeof row.gbp_location_id === 'string' && row.gbp_location_id.trim())
    .map((row) => ({ locationId: row.id, channelId: row.gbp_location_id }))
}

// Post a GBP package to Buffer queue. `locationChannels` is the PENDING subset
// (caller filters out already-posted locations). Returns
// { posted: [{ id, postId }], failed: [id] } keyed by stable target id
// (= Buffer channelId) so the caller records exactly which locations posted.
async function dispatchGbp({ pkg, token, locationChannels }) {
  const text = pkg.caption_text || pkg.topic || ''
  const mediaUrls = Array.isArray(pkg.renders)
    ? pkg.renders
        .filter((r) => r.channel === 'gbp_post' && r.blobUrl)
        .map((r) => ({ url: r.blobUrl, type: 'image' }))
    : []
  const preparedMedia = await prepareMediaForBuffer(mediaUrls)
  const assets = preparedMedia.map((m) =>
    m.type?.startsWith('video') ? { video: { url: m.url } } : { image: { url: m.url } }
  )

  const posted = []
  const failed = []
  for (const { id, channelId } of locationChannels) {
    const input = {
      channelId,
      text,
      schedulingType: 'automatic',
      mode: 'shareNext',
      assets,
      metadata: { google: { type: 'whats_new', detailsWhatsNew: { button: 'learn_more' } } },
    }
    const r = await gql(token, `
      mutation CreatePost($input: CreatePostInput!) {
        createPost(input: $input) {
          __typename
          ... on PostActionSuccess { post { id status dueAt } }
          ... on NotFoundError { message }
          ... on UnauthorizedError { message }
          ... on UnexpectedError { message }
          ... on InvalidInputError { message }
          ... on LimitReachedError { message }
        }
      }
    `, { input })
    if (r.errors || r.data?.createPost?.__typename !== 'PostActionSuccess') {
      const msg = r.errors?.[0]?.message || r.data?.createPost?.message || 'unknown'
      console.error('[auto-publish] GBP createPost failed:', msg, 'channelId:', channelId, 'pkg:', pkg.id)
      failed.push(id)
      continue
    }
    posted.push({ id, postId: r.data.createPost.post?.id ?? null })
  }
  return { posted, failed }
}

// Upsert the approved content_items row to scheduled + mark auto_published.
async function markContentItemScheduled({ pkg, workspaceId, bufferId }) {
  // Find the GBP content_item created by approve-package for this package.
  if (!UUID_RE.test(pkg.id)) {
    console.error('[auto-publish] invalid pkg.id format:', pkg.id)
    return null
  }
  const ciRes = await sb(
    `content_items?workspace_id=eq.${workspaceId}` +
    `&provenance->>package_id=eq.${pkg.id}` +
    `&platform=eq.gbp` +
    `&status=eq.approved` +
    `&select=id&limit=1`
  )
  if (!ciRes.ok) {
    console.error('[auto-publish] markContentItemScheduled fetch failed:', ciRes.status, 'pkg:', pkg.id)
    return null
  }
  const rows = await ciRes.json().catch(() => [])
  const ci = rows?.[0]
  if (!ci?.id) {
    console.warn('[auto-publish] markContentItemScheduled: 0 rows matched for pkg:', pkg.id, 'workspace:', workspaceId, 'status:', ciRes.status, 'rows:', rows?.length ?? 0)
    return null
  }

  const now = new Date().toISOString()
  const patchRes = await sb(`content_items?id=eq.${ci.id}&workspace_id=eq.${workspaceId}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status:           'scheduled',
      buffer_update_id: bufferId,
      auto_published:   true,
      // Do NOT write approved_at here — it's set by the human editorial
      // approve flow in approve-package.js and must not be overwritten
      // with the cron dispatch time (breaks time-since-approval analytics).
      notes:            `Auto-published by cron at ${now}`,
    }),
  })
  if (!patchRes.ok) {
    console.error('[auto-publish] markContentItemScheduled PATCH failed:', patchRes.status, 'ci:', ci.id, 'pkg:', pkg.id)
    return null
  }
  return ci.id
}

async function processWorkspace(ws, summary) {
  const settings = ws.auto_publish_settings || {}
  const hasEnabled = Object.values(settings).some((cfg) => cfg?.enabled)
  if (!hasEnabled) return

  // Pull approved packages not yet auto-published.
  const pkgRes = await sb(
    `story_packages?workspace_id=eq.${ws.id}` +
    `&status=eq.approved` +
    `&auto_published_at=is.null` +
    `&select=id,workspace_id,staff_id,source_asset_id,topic,caption_text,similarity,voice_fidelity_score,channels,renders,qc_flags,auto_publish_state,source_asset:media_assets(consent_status,qc_flags)` +
    `&order=updated_at.asc` +
    `&limit=${BATCH_SIZE}`
  )
  if (!pkgRes.ok) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, error: `pkg fetch ${pkgRes.status}` })
    return
  }
  const packages = await pkgRes.json().catch(() => [])
  if (!Array.isArray(packages) || packages.length === 0) {
    summary.workspaces.push({ id: ws.id, slug: ws.slug, evaluated: 0 })
    return
  }

  const isBundle = ws.publish_provider === 'bundle'

  // Resolve provider credential / GBP targets once (same for all packages).
  let cred = null
  let gbpChannels = []
  let bundleGbpTargets = []
  if (isBundle) {
    if (settings.gbp?.enabled) bundleGbpTargets = await resolveBundleGbpTargets(ws.id)
  } else {
    cred = await getCredential(ws.id, 'buffer')
    if (!cred?.secret) {
      summary.workspaces.push({ id: ws.id, slug: ws.slug, skipped: 'no-buffer-token' })
      return
    }
    if (settings.gbp?.enabled) gbpChannels = await resolveGbpChannelIds(ws.id)
  }

  // Load active campaigns once — used to enforce target_staff_ids per package.
  const activeCampaigns = await getActiveCampaigns(ws.id).catch(() => [])

  const dispatched = []
  const held = []
  const now = new Date().toISOString()

  for (const pkg of packages) {
    // Campaign targeting gate: if active campaigns exist and none apply to this
    // clinician (i.e. all campaigns have target restrictions that exclude them),
    // hold the package rather than publishing under the wrong campaign window.
    if (activeCampaigns.length > 0) {
      const campaignsForStaff = filterCampaignsForStaff(activeCampaigns, pkg.staff_id)
      if (campaignsForStaff.length === 0) {
        held.push({ id: pkg.id, reasons: [{ signal: 'campaign_targeting', detail: 'No active campaigns target this clinician' }] })
        continue
      }
    }

    const result = evaluate({ pkg, sourceAsset: pkg.source_asset, workspace: ws })

    if (!result.eligible || result.channels.length === 0) {
      // Held / ineligible: refresh the evaluation snapshot for the Moment Miner badge
      // but PRESERVE any durable published_channels / retry_count from a prior
      // run (a package can flip eligible→held — e.g. consent revoked — between
      // runs; wiping its posted-set would let a later re-dispatch double-post
      // to an already-posted location). This is race-free: an ineligible
      // package is never claimed/dispatched, so no concurrent run is writing
      // published_channels for it.
      const prior = pkg.auto_publish_state || {}
      await sb(`story_packages?id=eq.${pkg.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          auto_publish_state: {
            ...prior,
            eligible:      result.eligible,
            evaluated_at:  now,
            channels:      result.channels,
            gated_reasons: result.reasons,
          },
          updated_at: now,
        }),
      }).catch((e) => console.error('[auto-publish] state patch failed:', e?.message))
      held.push({ id: pkg.id, reasons: result.reasons })
      continue
    }

    // Atomically claim the package before dispatching. Vercel cron runs can
    // overlap if a previous run hangs (e.g. slow Buffer API), and two runs
    // reading the same auto_published_at=is.null package would each dispatch —
    // double-posting to the customer's Google Business Profile. The PATCH is
    // filtered on auto_published_at=is.null, so only one run wins the claim;
    // a losing run gets 0 rows back and skips. The claim is released at the end
    // (in a single atomic PATCH alongside the recorded posted-set) only when
    // unfinished, retriable work remains, so failed locations retry next run.
    const claimRes = await sb(
      `story_packages?id=eq.${pkg.id}&workspace_id=eq.${ws.id}&auto_published_at=is.null`,
      {
        method: 'PATCH',
        headers: { Prefer: 'return=representation' },
        body: JSON.stringify({ auto_published_at: now }),
      }
    )
    const claimed = claimRes.ok ? await claimRes.json().catch(() => []) : []
    if (!Array.isArray(claimed) || claimed.length === 0) {
      // Another concurrent run already claimed this package — skip silently.
      continue
    }

    // AUTHORITATIVE posted-set: read published_channels from the CLAIM
    // representation, never from the (possibly stale) batch-select pkg. The
    // claim PATCH is the serialization point — the winning run sees the latest
    // committed auto_publish_state, so already-posted locations are skipped even
    // across overlapping runs. This is the core double-post guard.
    const priorState = claimed[0]?.auto_publish_state || {}
    const publishedChannels = { ...(priorState.published_channels || {}) }
    const retryCount = (Number(priorState.retry_count) || 0) + 1

    // Per-channel terminal status this run: 'complete' | 'retriable' | 'permanent'.
    const channelStatus = {}

    for (const channel of result.channels) {
      // Only GBP is wired (autoPublishGate LIVE_CHANNELS); guard defensively so
      // a future live channel without a dispatch branch can't silently 'complete'.
      if (channel !== 'gbp') continue

      // Full per-location target list with a stable id (Buffer channelId /
      // bundle teamId) used as the skip key in published_channels.
      const targets = isBundle
        ? bundleGbpTargets.map((t) => ({ id: t.teamId, teamId: t.teamId, label: t.label }))
        : gbpChannels.map((c) => ({ id: c.channelId, channelId: c.channelId, locationId: c.locationId }))

      if (targets.length === 0) {
        // No locations configured — permanent (admin must fix); don't retry forever.
        held.push({ id: pkg.id, reasons: [{ signal: 'config', detail: `No ${isBundle ? 'bundle ' : ''}GBP locations configured` }] })
        channelStatus[channel] = 'permanent'
        continue
      }

      const channelState = publishedChannels[channel] || { locations: {} }
      const pending = unpostedTargets(targets, channelState)

      // Dispatch only the not-yet-posted locations. A null/throw is treated as
      // "all pending failed" so nothing is silently marked posted.
      let posted = []
      let failed = []
      if (pending.length > 0) {
        const dispatch = isBundle
          ? await dispatchGbpBundle({ pkg, workspace: ws, targets: pending }).catch(() => null)
          : await dispatchGbp({ pkg, token: cred.secret, locationChannels: pending }).catch(() => null)
        posted = dispatch?.posted || []
        failed = dispatch?.failed || pending.map((t) => t.id)
      }

      // Merge newly-posted locations durably (monotonic — never drops a prior post).
      const merged = mergePostedLocations(channelState, posted, now)
      publishedChannels[channel] = merged

      // Mark the GBP content_item scheduled the first time ANY location posts.
      // On retry runs (content_item_id already recorded) this is skipped, so the
      // post is never re-sent and the content_item isn't re-queried.
      const anyPosted = Object.keys(merged.locations).length > 0
      if (anyPosted && merged.content_item_id == null) {
        const firstPostId = merged.buffer_id || posted[0]?.postId || Object.values(merged.locations)[0]?.post_id
        const ciId = await markContentItemScheduled({ pkg, workspaceId: ws.id, bufferId: firstPostId })
        if (ciId != null) {
          merged.content_item_id = ciId
          merged.buffer_id = firstPostId
          merged.first_fired_at = merged.first_fired_at || now
        } else {
          // Post fired but bookkeeping failed — retry the marking next run
          // (post NOT re-sent: the location is already recorded above).
          console.error('[auto-publish] GBP post fired but markContentItemScheduled returned null — will retry bookkeeping next run (post NOT re-sent)', { pkgId: pkg.id, channel, retryCount })
        }
      }

      if (posted.length > 0) {
        dispatched.push({ id: pkg.id, channel, count: posted.length, bufferId: merged.buffer_id ?? null })
      }
      if (failed.length > 0) {
        console.error('[auto-publish] GBP partial dispatch — failed locations recorded for retry', { pkgId: pkg.id, failed, retryCount })
        held.push({ id: pkg.id, reasons: [{ signal: 'gbp_partial_failure', detail: `GBP locations failed (will retry): ${failed.join(', ')}` }] })
      }

      channelStatus[channel] = isChannelComplete(targets, merged) ? 'complete' : 'retriable'
    }

    // Claim disposition across all eligible channels.
    const statuses = Object.values(channelStatus)
    const allComplete = statuses.length > 0 && statuses.every((s) => s === 'complete')
    const anyRetriable = statuses.some((s) => s === 'retriable')
    const { release, exhausted } = decideClaimDisposition({
      allComplete, anyRetriable, retryCount, maxRetries: MAX_AUTO_PUBLISH_RETRIES,
    })

    if (exhausted) {
      console.error('[auto-publish] retry budget exhausted — retaining claim, manual investigation required', { pkgId: pkg.id, retryCount, channelStatus })
    }

    // SINGLE atomic final PATCH: record the posted-set AND set the claim
    // disposition together. Releasing (auto_published_at=null) is only ever safe
    // because the posted-set is persisted in the same write — if this PATCH
    // fails, the claim stays held (set by the claim PATCH above) and the package
    // is NOT re-dispatched, which is the safe direction (no double-post).
    const finalPatch = await sb(`story_packages?id=eq.${pkg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({
        auto_published_at: release ? null : now,
        auto_publish_state: {
          ...priorState,
          eligible:           result.eligible,
          evaluated_at:       now,
          channels:           result.channels,
          gated_reasons:      result.reasons,
          retry_count:        retryCount,
          published_channels: publishedChannels,
          ...(exhausted ? { retry_exhausted_at: now } : {}),
        },
        updated_at: now,
      }),
    }).catch((e) => { console.error('[auto-publish] final PATCH error', { pkgId: pkg.id, error: e?.message }); return null })
    if (finalPatch && !finalPatch.ok) {
      const body = await finalPatch.text().catch(() => '')
      console.error('[auto-publish] final PATCH failed — claim retained (safe), package not re-dispatched', { pkgId: pkg.id, status: finalPatch.status, body: body.slice(0, 300) })
    }
  }

  summary.workspaces.push({
    id: ws.id, slug: ws.slug,
    evaluated: packages.length,
    dispatched: dispatched.length,
    held: held.length,
    dispatched_detail: dispatched,
    held_detail: held,
  })
}

export default async function handler(req, res) {
  if (!verifyCronSecret(req)) return res.status(401).json({ error: 'Unauthorized' })

  if (!SUPABASE_URL || !SUPABASE_KEY) {
    return res.status(503).json({ error: 'Supabase env not configured' })
  }

  // Enumerate active workspaces with non-empty auto_publish_settings.
  const wsRes = await fetch(
    `${SUPABASE_URL}/rest/v1/workspaces?status=eq.active&select=id,slug,auto_publish_settings,publish_provider,bundle_team_id`,
    { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } }
  )
  if (!wsRes.ok) return res.status(500).json({ error: 'workspace fetch failed' })
  const workspaces = await wsRes.json()

  const summary = { startedAt: new Date().toISOString(), workspaces: [] }
  for (const ws of workspaces) {
    try {
      await processWorkspace(ws, summary)
    } catch (e) {
      console.error('[cron/auto-publish] workspace threw:', e?.message)
      summary.workspaces.push({ id: ws.id, slug: ws.slug, error: 'workspace_error' })
    }
  }
  summary.finishedAt = new Date().toISOString()

  const pingUrl = process.env.HC_PING_AUTO_PUBLISH
  if (pingUrl) waitUntil(fetch(pingUrl).catch((e) => console.error('[auto-publish] healthcheck ping failed:', e?.message)))

  return res.status(200).json(summary)
}
