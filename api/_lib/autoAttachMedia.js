// Auto-attach on-topic media to a media-less content_items DRAFT.
//
// Why this exists: story/moment drafts are BORN media-less — both the weekly
// moment-bank compose (api/_routes/content-plan/draft.js) and the Standing
// Producer topic path (api/_lib/producer/draftOnTopic.js) hardcode
// `media_urls: []`, and only the clip→draft path (api/_lib/clipDraft.js) ever
// carried media. The result: ~73% of drafts sat with no image, and a bare-text
// post is exactly the one a reviewer won't ship — so the low-priority channels
// (GBP, Facebook, Instagram) stalled in draft while LinkedIn went out. Bernard
// is close to useless without the picture, so every draft that CAN take media
// should get its best on-topic match automatically, leaving the human to swap
// rather than to source.
//
// The matcher is the SAME brain the manual "suggest media" panel uses
// (searchClips over the workspace's visual memory), so this is just running
// that suggestion at draft-creation time and taking the top pick when it is
// confident enough.
//
// It NEVER attaches filler. When nothing clears the confidence bar the draft is
// left media-less on purpose (the UI shows a "needs media" cue) — an off-topic
// photo a rushed approver rubber-stamps is worse than an honest gap, and it
// would poison the very thing the reviewer is there to protect. (CLAUDE.md:
// "No fake or seed data to make something work.")
//
// Tenant-safe by construction: searchClips only ever queries `workspaceId`'s
// own library, so a workspace with a thin library simply gets no match — the
// same outcome it has today — and this rolls out to all tenants at once.
//
// Scope (v1): Tier-2 SEMANTIC match only. A future Tier-1 could attach the
// moment's own source clip directly via moments.clip_asset_id, but that column
// can point at the raw (long) interview video rather than a rendered short, so
// it is deferred until that's verified — attaching a 30-minute source as a reel
// would be worse than a good semantic photo.

import { searchClips } from './clipSearch.js'
import { buildDraftMatchQuery } from './draftMatchQuery.js'
import { autoAttachKindForDraft, isTextOnlyPlatform } from './platformMedia.js'
import { clipToMediaEntry } from '../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Confidence bar for AUTO-attaching, deliberately well above suggest-media's
// permissive 0.3 "show me options" floor. A suggestion the producer can reject
// is cheap; a silent off-topic attach a rushed approver rubber-stamps is not.
// Env-tunable so prod can be dialed without a redeploy; validate any change
// against real drafts before trusting it (see scripts/verify-auto-attach.mjs).
const MIN_SCORE = Number(process.env.AUTO_ATTACH_MIN_SCORE) || 0.45

// A default post is not a place for a long raw source video. The clinic's
// library is video-heavy (median clip ~28s, fine) but carries some 1–3 minute
// unedited interview clips; auto-attaching one of those as a GBP/Facebook post
// is worse than a shorter clip or photo the reviewer would actually keep. Short
// clips still attach freely; only the long raw ones are skipped, and only for
// AUTO-attach — the manual suggest panel is unchanged. Env-tunable.
const MAX_AUTO_VIDEO_SECS = Number(process.env.AUTO_ATTACH_MAX_VIDEO_SECS) || 60

// Shared service-key fetch helper. Every caller below passes an explicit
// workspace_id=eq.${ws.id} filter — never an unscoped tenant query.
function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    signal: AbortSignal.timeout(10_000),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

/**
 * Attach one on-topic media entry to a media-less draft, in place. Best-effort:
 * never throws to the caller, returns a structured outcome instead so a hook
 * can log without try/catch and a sweep can tally reasons.
 *
 * @param {Object} p
 * @param {{ id: string }} p.ws                          — workspace (only .id read)
 * @param {{ id, topic, content, platform, media_urls, slides }} p.draft
 * @param {boolean} [p.dryRun] — compute the match but DON'T write. Used by the
 *   sweep's ?dry=1 mode to validate the confidence bar against real drafts
 *   before mutating anything. Returns `reason:'dry'` with the would-be score.
 * @returns {Promise<{attached:boolean, reason:string, score?:number, assetId?:string}>}
 */
export async function autoAttachMedia({ ws, draft, dryRun = false } = {}) {
  try {
    if (!ws?.id || !draft?.id) return { attached: false, reason: 'bad_args' }

    // Never clobber an existing choice (a human's, or an earlier auto-attach).
    const existing = Array.isArray(draft.media_urls) ? draft.media_urls : []
    if (existing.length > 0) return { attached: false, reason: 'already_has_media' }

    // A multi-slide carousel has its OWN attach-on-open path (SlideEditor) plus
    // a per-slide photo_idx binding we must not race — leave it to that path.
    if (Array.isArray(draft.slides) && draft.slides.length > 1) {
      return { attached: false, reason: 'carousel_handled_elsewhere' }
    }

    // Skip only genuinely text-dominant platforms (blog/landing/email) — their
    // hero image is a different concept from a social media_urls entry, and blog
    // drafts don't stall on a missing picture anyway.
    if (isTextOnlyPlatform(draft.platform)) return { attached: false, reason: 'text_only_platform' }

    // The kind to AUTO-attach. autoAttachKindForDraft — NOT mediaKindForDraft —
    // because auto-attach's default must differ from what the manual picker
    // offers: for the single-photo-default social platforms (linkedin/facebook/
    // gbp/x/…) it returns 'photo', so auto-attach can't silently drop a video on
    // a text/photo draft and flip it into a video post that reroutes to the
    // reel/timeline editor (the reported bug). Those platforms DO support video —
    // the user just adds it deliberately via the picker (which still shows both,
    // driven by mediaKindForDraft). Instagram stays null here (a Reel is an
    // expected IG format), and null still means "either", which searchClips reads
    // as no kind filter. Video-only (tiktok/youtube) and photo-only (blog/email)
    // constraints pass straight through.
    const kind = autoAttachKindForDraft(draft)

    const query = buildDraftMatchQuery(draft)
    if (!query) return { attached: false, reason: 'empty_query' }

    const clips = await searchClips({ query, workspaceId: ws.id, k: 5, kind, minScore: MIN_SCORE })
    // Take the first candidate that clears the RAW-similarity bar AND isn't a
    // long raw video. Two reasons this scans top-k rather than taking [0]:
    //   1. searchClips RANKS by a freshness-discounted effectiveScore, so gate
    //      the attach on raw `similarity` — a fresh-but-weak asset the discount
    //      floated up must not slip past the bar.
    //   2. a long raw source video at the top must not BLOCK a good shorter clip
    //      or photo sitting just behind it.
    const pick = (clips || []).find(
      (c) =>
        (c.similarity ?? 0) >= MIN_SCORE &&
        !(c.kind === 'video' && (c.durationS ?? 0) > MAX_AUTO_VIDEO_SECS),
    )
    if (!pick) return { attached: false, reason: 'no_confident_match' }

    const entry = clipToMediaEntry({
      kind: pick.kind,
      blobUrl: pick.blobUrl,
      thumbnailUrl: pick.thumbnailUrl,
      assetId: pick.assetId,
      filename: pick.filename,
      ...(pick.durationS != null ? { durationS: pick.durationS } : {}),
    })
    if (!entry.url) return { attached: false, reason: 'bad_entry' }

    // Dry run: we have a confident match but must not mutate. Report the pick.
    if (dryRun) {
      return { attached: false, reason: 'dry', score: pick.similarity, assetId: pick.assetId, kind: pick.kind }
    }

    // Re-read immediately before writing so we can't clobber a human (or the
    // SlideEditor open-attach) who picked media in the window since this draft
    // was handed to us. Cheap GET; this never runs on a latency-critical path.
    const curRes = await sb(
      `content_items?id=eq.${encodeURIComponent(draft.id)}&workspace_id=eq.${ws.id}&select=media_urls&limit=1`,
    )
    if (!curRes.ok) return { attached: false, reason: 'recheck_failed' }
    const curRow = (await curRes.json().catch(() => []))?.[0]
    const curMedia = Array.isArray(curRow?.media_urls) ? curRow.media_urls : []
    if (curMedia.length > 0) return { attached: false, reason: 'raced_has_media' }

    const patchRes = await sb(`content_items?id=eq.${encodeURIComponent(draft.id)}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ media_urls: [entry], updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    })
    if (!patchRes.ok) {
      console.error('[autoAttachMedia] patch failed', patchRes.status)
      return { attached: false, reason: 'patch_failed' }
    }
    return { attached: true, reason: 'semantic', score: pick.similarity, assetId: pick.assetId }
  } catch (e) {
    console.error('[autoAttachMedia] error:', e?.message)
    return { attached: false, reason: 'error' }
  }
}
