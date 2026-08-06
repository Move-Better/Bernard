// POST /api/content-items/copy-to-platforms
//
// "Copy this post to other platforms" — Philip's feedback (in-app feedback
// 21331b1d): a post that came together well on one platform gets its photo
// carried to the others, rather than the good version sitting alone while its
// siblings stall as empty drafts (the media auto-attach work covers most new
// drafts, but a producer reaching for a PROVEN post is a distinct, deliberate
// action — see project-media-library-suggestions memory).
//
// Deliberately NOT a same-caption crossposter (that's the commodity behavior
// Bernard positions against): the photo copies verbatim, but the caption is
// either kept as-is (clamped to the target's own cap — never blasted past a
// limit) or re-fit in the target platform's voice via a small AI call. Every
// result lands as a DRAFT — never auto-approved, never auto-published — same
// as a fresh atom draft.
//
// Scope (v1): source must be a SINGLE PHOTO post (not a multi-slide carousel,
// not video/Reel) — the exact shape of the post that prompted this feature.
// Video/carousel copy is a real follow-up, not built here: re-fitting baked
// slide text or transcoding video per platform is a materially bigger scope.
//
// Body (real run):
//   { sourceId: string, targets: [{ platform: string, captionMode: 'keep'|'refit' }] }
//   → { results: [{ platform, action: 'filled'|'created'|'skipped', id?, reason? }] }
// Body (dry run — no writes, no AI call, used to render the copy modal's
// per-platform state before the user picks anything):
//   { sourceId: string, dryRun: true }
//   → { results: [{ platform, action: 'fill'|'create'|'skipped', id?, reason? }] }
//     for every COPYABLE_PLATFORMS entry except the source's own platform.
export const config = { runtime: 'nodejs', maxDuration: 60 }

import { generateText } from 'ai'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { clampToCap, platformCap } from '../../_lib/socialLengthTargets.js'
import { stripAiDashes } from '../../_lib/stripAiDashes.js'
import { fixBrokenHashtags } from '../../_lib/fixBrokenHashtags.js'
import { photoSourceUrl, isVideoEntry } from '../../../src/lib/mediaEntry.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Real organic-social platforms (ATOM_DEFINITIONS keys in atomPlan.js) — the
// same set the Standing Producer schedules atoms for. Excludes blog/email/
// landing_page (text-only, no photo concept) and the ad platforms (a
// different content type, not an organic post).
const COPYABLE_PLATFORMS = new Set([
  'instagram', 'instagram_story', 'linkedin', 'facebook', 'gbp',
  'tiktok', 'twitter', 'threads', 'bluesky', 'mastodon',
])

const LIVE_STATUSES = new Set(['published', 'scheduled'])
const FILLABLE_STATUSES = new Set(['draft', 'in_review', 'approved'])

// Fill/create/skip verdict for one target platform, independent of caption
// mode — shared by the dry-run preview and the real run so they can never
// disagree about which action a checkbox represents.
async function resolveSiblingAction({ ws, source, platform }) {
  let siblings = []
  if (source.interview_id) {
    const sibRes = await sb(
      `content_items?workspace_id=eq.${ws.id}&interview_id=eq.${source.interview_id}` +
      `&platform=eq.${platform}&archived_at=is.null` +
      `&select=id,status,media_urls&order=created_at.desc&limit=5`,
    )
    siblings = sibRes.ok ? await sibRes.json() : []
  }
  if (siblings.some((s) => LIVE_STATUSES.has(s.status))) {
    return { action: 'skipped', reason: 'already_live' }
  }
  const emptyDraft = siblings.find(
    (s) => FILLABLE_STATUSES.has(s.status) && (!Array.isArray(s.media_urls) || s.media_urls.length === 0),
  )
  if (emptyDraft) return { action: 'fill', id: emptyDraft.id }
  const hasNonEmptyDraft = siblings.some(
    (s) => FILLABLE_STATUSES.has(s.status) && Array.isArray(s.media_urls) && s.media_urls.length > 0,
  )
  if (hasNonEmptyDraft) return { action: 'skipped', reason: 'already_has_media' }
  return { action: 'create' }
}

async function refitCaption({ ws, sourceCaption, sourcePlatform, targetPlatform, cap }) {
  try {
    const prompt = `You are rewrapping a social caption that already worked on ${sourcePlatform} so it fits ${targetPlatform} instead, for ${ws.display_name}.

Keep the SAME message, stance, and call to action — do not add new claims, examples, or specifics that aren't in the original. Only adjust voice, structure, and length for ${targetPlatform}'s norms. Stay at or under ${cap} characters. Output ONLY the final caption text, no headers, no quotation marks, no markdown.

ORIGINAL (${sourcePlatform}):
${sourceCaption}`
    const result = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      instructions: prompt,
      messages: [{ role: 'user', content: `Rewrite this for ${targetPlatform} now.` }],
      maxOutputTokens: 900,
    })
    const text = (result.text || '').trim()
    return text || sourceCaption
  } catch (e) {
    console.error('[copy-to-platforms] re-fit failed, falling back to keep-exact:', e?.message)
    return sourceCaption
  }
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'method_not_allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'no_workspace', 404)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason, auth.reason === 'forbidden' ? 403 : 401)

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const body = req.body || {}
  const sourceId = body.sourceId ? String(body.sourceId) : null
  if (!sourceId || !UUID_RE.test(sourceId)) return err(res, 'invalid_sourceId', 400)

  const dryRun = body.dryRun === true
  const targets = Array.isArray(body.targets) ? body.targets : []
  const seen = new Set()
  if (!dryRun) {
    if (!targets.length) return err(res, 'targets_required', 400)
    for (const t of targets) {
      if (!t || !COPYABLE_PLATFORMS.has(t.platform)) return err(res, `invalid_target_platform:${t?.platform}`, 400)
      if (!['keep', 'refit'].includes(t.captionMode)) return err(res, 'invalid_captionMode', 400)
      if (seen.has(t.platform)) return err(res, `duplicate_target:${t.platform}`, 400)
      seen.add(t.platform)
    }
  }

  const srcRes = await sb(
    `content_items?id=eq.${sourceId}&workspace_id=eq.${ws.id}` +
    `&select=id,platform,content,media_urls,slides,interview_id,topic,staff_id,staff_name&limit=1`,
  )
  if (!srcRes.ok) {
    console.error(`[copy-to-platforms] source fetch failed ${srcRes.status}`)
    return err(res, 'source_fetch_failed', 500)
  }
  const source = (await srcRes.json())?.[0]
  if (!source) return err(res, 'source_not_found', 404)

  const media = Array.isArray(source.media_urls) ? source.media_urls : []
  const slides = Array.isArray(source.slides) ? source.slides : []
  if (media.length !== 1) return err(res, 'unsupported_source_shape:media_count', 400)
  if (slides.length > 1) return err(res, 'unsupported_source_shape:carousel', 400)
  if (isVideoEntry(media[0])) return err(res, 'unsupported_source_shape:video', 400)
  if (!dryRun && seen.has(source.platform)) return err(res, 'target_matches_source', 400)

  if (dryRun) {
    const platforms = [...COPYABLE_PLATFORMS].filter((p) => p !== source.platform)
    const results = await Promise.all(platforms.map(async (platform) => ({
      platform, ...(await resolveSiblingAction({ ws, source, platform })),
    })))
    return ok(res, { results })
  }

  // The RAW photo, never a source-platform-specific baked composite (see
  // photoSourceUrl's header comment — a baked text card was framed for the
  // SOURCE platform and would carry stale context onto a different one).
  const rawUrl = photoSourceUrl(media[0]) || media[0].url
  const targetEntry = {
    url: rawUrl,
    type: 'image',
    kind: 'image',
    thumbnailUrl: media[0].thumbnailUrl || null,
    mediaAssetId: media[0].mediaAssetId || null,
    name: media[0].name || null,
  }

  const results = await Promise.all(targets.map(async (t) => {
    const cap = platformCap(t.platform)
    const caption = t.captionMode === 'refit'
      ? clampToCap(fixBrokenHashtags(stripAiDashes(await refitCaption({
          ws, sourceCaption: source.content, sourcePlatform: source.platform,
          targetPlatform: t.platform, cap,
        }))), cap)
      : clampToCap(source.content, cap)

    const verdict = await resolveSiblingAction({ ws, source, platform: t.platform })
    if (verdict.action === 'skipped') return { platform: t.platform, ...verdict }

    if (verdict.action === 'fill') {
      // Re-read immediately before writing so a producer mid-edit on this
      // exact sibling (or a concurrent auto-attach) can't be silently
      // clobbered by the fill PATCH — mirrors the same guard in
      // autoAttachMedia.js, which exists for the identical reason.
      const curRes = await sb(
        `content_items?id=eq.${verdict.id}&workspace_id=eq.${ws.id}&select=media_urls&limit=1`,
      )
      if (!curRes.ok) return { platform: t.platform, action: 'skipped', reason: 'recheck_failed' }
      const curRow = (await curRes.json().catch(() => []))?.[0]
      const curMedia = Array.isArray(curRow?.media_urls) ? curRow.media_urls : []
      if (curMedia.length > 0) return { platform: t.platform, action: 'skipped', reason: 'raced_has_media' }

      const patchRes = await sb(`content_items?id=eq.${verdict.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        body: JSON.stringify({ media_urls: [targetEntry], content: caption, updated_at: new Date().toISOString() }),
      })
      if (!patchRes.ok) {
        console.error(`[copy-to-platforms] fill failed for ${t.platform}: ${patchRes.status}`)
        return { platform: t.platform, action: 'skipped', reason: 'fill_failed' }
      }
      return { platform: t.platform, action: 'filled', id: verdict.id }
    }

    const createRes = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify({
        workspace_id: ws.id,
        interview_id: source.interview_id,
        staff_id: source.staff_id,
        staff_name: source.staff_name,
        topic: source.topic,
        platform: t.platform,
        content: caption,
        media_urls: [targetEntry],
        status: 'draft',
      }),
    })
    if (!createRes.ok) {
      const detail = await createRes.text().catch(() => '')
      console.error(`[copy-to-platforms] create failed for ${t.platform}: ${createRes.status} ${detail.slice(0, 200)}`)
      return { platform: t.platform, action: 'skipped', reason: 'create_failed' }
    }
    const created = (await createRes.json())?.[0]
    return { platform: t.platform, action: 'created', id: created?.id }
  }))

  return ok(res, { results })
}
