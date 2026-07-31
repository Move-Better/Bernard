// GET /api/producer/checkin
//
// The periodic check-in (Phase 4, mockup-approved): "is Bernard still trending
// right?" — answered in BOTH halves Q asked for.
//
//   numbers — per-format reach/engagement over the window, vs the window before
//   taste   — a sample of what actually published, to look at
//
// Deliberately reports what the data supports and nothing more. Two cold-start
// realities are handled explicitly rather than papered over:
//
//   1. Almost no post carries an EXPLICIT format yet — format_source only began
//      stamping when Phase 3a merged. Grouping on content_items.format alone
//      would put every historical post in one meaningless bucket, so a post
//      without one is grouped by its DERIVED format, using the same rule the
//      editor badge uses (postFormat). That is what those posts effectively
//      are, and it makes the breakdown useful today instead of in a month.
//   2. Some posts genuinely cannot be measured — bundle can't read IG
//      carousels/stories and writes an `unavailable` sentinel. Those are
//      counted and reported separately, never averaged in as zeros, because a
//      zero from "we couldn't look" and a zero from "nobody saw it" mean
//      opposite things.

export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { postFormat } from '../../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Window length. Compared against the immediately preceding window of the same
// length, so "vs prior" is like-for-like. A stored last-check-in timestamp
// would be better (the comparison would track when the owner actually last
// looked) — deferred rather than faked, since it needs its own column.
const WINDOW_DAYS = 30
// Below this many measurable posts a format's delta is not reported. Same
// reasoning as the learning panel's MIN_SAMPLE: with 2 posts, one good day
// reads as a trend.
const MIN_POSTS_FOR_DELTA = 3
const SAMPLE_COUNT = 5

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

const num = (v) => (Number.isFinite(Number(v)) ? Number(v) : 0)

// Explicit format when the piece has one, else the same derivation the editor
// badge shows. Never invents a format for a channel that has no format concept.
function formatKeyFor(piece) {
  if (typeof piece.format === 'string' && piece.format) return piece.format
  const f = postFormat(piece)
  return f?.kind || 'post'
}

function aggregate(pieces, snapshotByItem) {
  const byFormat = {}
  for (const p of pieces) {
    const key = formatKeyFor(p)
    const b = (byFormat[key] ||= { format: key, posts: 0, measurable: 0, unavailable: 0, impressions: 0, likes: 0 })
    b.posts++
    const stats = snapshotByItem[p.id]
    if (!stats) continue
    if (stats.unavailable) { b.unavailable++; continue }
    b.measurable++
    b.impressions += num(stats.statistics?.impressions)
    b.likes += num(stats.statistics?.likes)
  }
  return byFormat
}

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method_not_allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })
  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  if (!(await enforceLimit(req, res, 'read', ws.id))) return

  const now = Date.now()
  const startISO = new Date(now - WINDOW_DAYS * 86400_000).toISOString()
  const priorStartISO = new Date(now - 2 * WINDOW_DAYS * 86400_000).toISOString()

  try {
    const itemsRes = await sb(
      `content_items?workspace_id=eq.${ws.id}&status=eq.published` +
      `&published_at=gte.${encodeURIComponent(priorStartISO)}` +
      `&select=id,topic,platform,format,media_urls,slides,published_at` +
      `&order=published_at.desc&limit=300`,
    )
    if (!itemsRes.ok) return res.status(500).json({ error: 'items_read_failed' })
    const all = await itemsRes.json()

    const current = all.filter((p) => p.published_at >= startISO)
    const prior = all.filter((p) => p.published_at < startISO)

    // Latest snapshot per item. Ordered desc so the first row per item wins.
    const snapRes = await sb(
      `engagement_snapshots?workspace_id=eq.${ws.id}` +
      `&select=content_item_id,stats,fetched_at&order=fetched_at.desc&limit=600`,
    )
    const snapshotByItem = {}
    if (snapRes.ok) {
      for (const row of await snapRes.json()) {
        if (!(row.content_item_id in snapshotByItem)) snapshotByItem[row.content_item_id] = row.stats || {}
      }
    }

    const nowAgg = aggregate(current, snapshotByItem)
    const priorAgg = aggregate(prior, snapshotByItem)

    const formats = Object.values(nowAgg)
      .sort((a, b) => b.posts - a.posts)
      .map((b) => {
        const before = priorAgg[b.format]
        // A delta needs BOTH windows to be measurable, and a non-zero base to
        // divide by. Otherwise report the raw numbers and no percentage —
        // "+∞%" from a base of zero is noise dressed as a finding.
        const comparable = b.measurable >= MIN_POSTS_FOR_DELTA
          && (before?.measurable || 0) >= MIN_POSTS_FOR_DELTA
          && (before?.impressions || 0) > 0
        const perPost = b.measurable ? b.impressions / b.measurable : null
        const beforePerPost = before?.measurable ? before.impressions / before.measurable : null
        return {
          ...b,
          impressionsPerPost: perPost == null ? null : Math.round(perPost * 10) / 10,
          deltaPct: comparable && beforePerPost
            ? Math.round(((perPost - beforePerPost) / beforePerPost) * 100)
            : null,
        }
      })

    // Taste half — newest first, so the owner reviews what Bernard is doing NOW
    // rather than a flattering historical pick.
    const samples = current.slice(0, SAMPLE_COUNT).map((p) => ({
      id: p.id,
      topic: p.topic || '',
      platform: p.platform,
      format: formatKeyFor(p),
      publishedAt: p.published_at,
      thumbnailUrl: Array.isArray(p.media_urls)
        ? (p.media_urls.find((m) => m?.thumbnailUrl)?.thumbnailUrl
           || p.media_urls.find((m) => m?.url)?.url || null)
        : null,
    }))

    return res.status(200).json({
      window: { days: WINDOW_DAYS, start: startISO },
      published: current.length,
      priorPublished: prior.length,
      formats,
      samples,
      // Surfaced so the client can say "3 posts couldn't be measured" rather
      // than quietly showing a smaller denominator than the post count.
      unmeasurable: formats.reduce((s, f) => s + f.unavailable, 0),
      generatedAt: new Date().toISOString(),
    })
  } catch (e) {
    console.error('[producer/checkin] failed:', e?.stack || e?.message)
    return res.status(500).json({ error: 'checkin_read_failed' })
  }
}
