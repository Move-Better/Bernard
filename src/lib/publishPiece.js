import { publishAndTrack } from '@/lib/publish'
import { resolveTheme } from '@/lib/photoTemplates'
import { ensureRenderedSlides } from '@/lib/renderSlides'
import { isInstagramReel } from '@/lib/mediaEntry'

/**
 * Publish — or schedule / queue — ONE social content piece through Buffer.
 *
 * This is the single source of truth for the social publish path, shared by the
 * per-piece ApprovalPanel (story-detail/AssetsPane) and the Review Inbox bulk
 * scheduler so the two can never diverge. The carousel slide-baking below is
 * exactly the "preview ≠ published" step a hand-rolled bulk copy would drop:
 * a carousel with per-slide on-screen text must ship the BAKED images (photo +
 * text), not the raw photos. (See .claude — the 2026-05-29 carousel bug.)
 *
 * Blog pieces are NOT handled here — they publish to the website via a separate
 * multi-step path that stays inline in ApprovalPanel.
 *
 * Side-effect boundary: this performs the Buffer dispatch (via publishAndTrack,
 * which also PATCHes the row's status). It does NOT invalidate React Query
 * caches, write the approver audit trail, or toast — the CALLER owns those so it
 * can batch them (bulk) or attach per-piece approval fields (single). When a
 * carousel's slides were freshly baked, `renderedSlides` is returned so the
 * caller can persist them on the row for reuse on the next publish.
 *
 * @param {object} piece content_items row (platform, content, media_urls, slides, photo_template_id, …)
 * @param {object} opts
 * @param {string|null} [opts.scheduledAt] ISO string for a specific slot, or null
 * @param {boolean} [opts.useQueue] add to the channel's Buffer queue (Buffer picks the slot)
 * @param {string} opts.userEmail approver/publisher identity
 * @param {object} opts.workspace workspace row (for brand_style on baked slides)
 * @param {Array} [opts.themes] photo templates (resolveTheme custom-template lookup)
 * @returns {Promise<{result:any, scheduling:boolean, scheduledAt:(string|null), renderedSlides:(Array|null)}>}
 */
export async function publishPieceToBuffer(
  piece,
  { scheduledAt = null, useQueue = false, userEmail, workspace, themes = [] },
) {
  const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)

  // Carousel pieces with per-slide on-screen text publish the BAKED slide images
  // (photo + text), not the raw photos. A Reel (Instagram piece with a video)
  // skips this — baking photo-slides would silently drop the video. Identical to
  // the logic that used to live inline in ApprovalPanel.handlePublish.
  let mediaUrls = piece.media_urls || []
  let renderedSlides = null
  const reelHasVideo = isInstagramReel(piece.media_urls)
  if (!reelHasVideo && Array.isArray(piece.slides) && piece.slides.length) {
    const customThemes = themes.filter((t) => t.custom)
    const theme = resolveTheme(piece.photo_template_id || null, customThemes)
    const { slides, publishMediaUrls, changed } = await ensureRenderedSlides({
      slides: piece.slides,
      mediaUrls: piece.media_urls,
      brandStyle: workspace?.brand_style || {},
      theme,
      themeId: piece.photo_template_id || null,
      customThemes,
      pieceId: piece.id,
    })
    if (publishMediaUrls.length) mediaUrls = publishMediaUrls
    if (changed) renderedSlides = slides
  }

  const result = await publishAndTrack(
    {
      id: piece.id,
      platform: piece.platform,
      content: markdown,
      mediaUrls,
      scheduledAt,
      useQueue,
    },
    userEmail,
  )

  const scheduling = !!scheduledAt || !!useQueue
  // In queue mode Buffer returns the slot it assigned — echo it back so the
  // row's scheduled_at reflects the real time without a webhook round-trip.
  const queueDueAt = result?.buffer?.scheduledAt || null

  return {
    result,
    scheduling,
    scheduledAt: scheduling ? scheduledAt || queueDueAt : null,
    renderedSlides,
  }
}
