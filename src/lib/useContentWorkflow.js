import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQueryClient } from '@tanstack/react-query'
import { posthogCapture } from '@/lib/posthog'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  useUpdateContentItemStatus,
  useCarouselThemes,
  queryKeys,
} from '@/lib/queries'
import { publishBlogToWebsite, sendBlogToBeehiiv, cancelScheduledPost } from '@/lib/publish'
import { publishPieceToSocial } from '@/lib/publishPiece'
import { renderAndUploadHero } from '@/lib/renderSlides'
import { publishMediaForFormat, photoSourceUrl, isVideoEntry } from '@/lib/mediaEntry'
import { heroReframed } from '@/lib/heroPhoto'
import { brandStyleForRender } from '@/lib/brandSwatches'
import { suggestScheduleTime } from '@/lib/scheduleHeuristics'
import { buildImagesManifest } from '@/lib/publishImageMirror'
import { slugifyTitle, deriveSeoTitle, deriveMetaDescription, cleanBlogMarkdown } from '@/lib/blogOutput'
import { canDirectPublishPlatform } from '@/lib/outputChannels'
import { describeFormatViolation } from '@/lib/platformFormats'
import { toast, runWithToast } from '@/lib/toast'
import { stripStoryDatePrefix } from '@/lib/storyTitle'

// Pull scheduled cross-platform items out of the React Query cache — free when
// Stories has already loaded, empty otherwise (the suggestion engine simply
// doesn't know about other-platform posts and the conflict warner stays silent).
// Mirrors getCachedScheduledItems in AssetsPane so the suggested slot matches.
function getCachedScheduledItems(qc) {
  const out = []
  const lists = qc.getQueriesData({ queryKey: queryKeys.stories.all })
  const seen = new Set()
  for (const [, data] of lists) {
    if (!Array.isArray(data)) continue
    for (const story of data) {
      for (const p of story?.pieces ?? []) {
        if (!p?.scheduled_at) continue
        if (seen.has(p.id)) continue
        seen.add(p.id)
        out.push({ id: p.id, platform: p.platform, scheduled_at: p.scheduled_at })
      }
    }
  }
  return out
}

/**
 * useContentWorkflow — the single source of truth for approving, unapproving,
 * and publishing / scheduling / queueing ONE content_items piece.
 *
 * Extracted from ApprovalPanel (story-detail/AssetsPane) so the full publish
 * panel AND the editor header workflow bar (EditorWorkflowBar) run the exact
 * same orchestration — the codebase's recurring publish-path-divergence bug
 * class (see CLAUDE.md "Buffer vs bundle.social publish paths") is avoided by
 * having exactly one copy of the blog-vs-social branch and the status writes.
 *
 * The low-level publish dispatch already lives in publishPieceToSocial; this hook
 * owns the layer above it (blog website path, media gate, approver audit,
 * status transitions, cache invalidation, toasts).
 *
 * @param {object} piece content_items row
 * @returns handlers + derived state (see return block)
 */
export function useContentWorkflow(piece) {
  const { user } = useUser()
  const navigate = useNavigate()
  const { canReview } = useUserRole()
  const workspace = useWorkspace()
  const skipReview = !!workspace?.skip_review
  const updateStatus = useUpdateContentItemStatus()
  const qc = useQueryClient()
  const { data: allThemes = [] } = useCarouselThemes()

  const [publishing, setPublishing] = useState(false)
  const [beehiivPublishing, setBeehiivPublishing] = useState(false)

  const otherScheduled = useMemo(
    () => getCachedScheduledItems(qc).filter((it) => it.id !== piece.id),
    [qc, piece.id],
  )
  const prefsOverride = workspace?.schedule_prefs
  const suggested = useMemo(
    () => suggestScheduleTime(piece.platform, otherScheduled, undefined, prefsOverride),
    [piece.platform, otherScheduled, prefsOverride],
  )

  const userEmail = user?.primaryEmailAddress?.emailAddress || user?.id || ''
  const canDirectPublish = canDirectPublishPlatform(
    workspace,
    piece.platform,
    workspace?.connected_publish_services,
  )

  // Explicit format vs. attached media, checked before the publish round-trip.
  // An Instagram "Post" with 6 photos, a Facebook album mixing photo + video,
  // etc. would be rejected server-side (bundle validates format BEFORE upload) —
  // so block it here with an actionable reason instead of letting it fail out.
  // null (valid) whenever the piece has no explicit format or the platform has
  // no format choice at all, so nothing else is affected.
  //
  // Validate what actually SHIPS, not the raw media_urls pool: a carousel with a
  // slide deck posts one card per SLIDE, so a 4-slide deck drawing from a 12-photo
  // pool is a valid 4-item carousel, not an over-cap "12 items" one. Counting the
  // pool disabled Schedule on exactly that shape (feedback a473c03a). See
  // publishMediaForFormat — it mirrors publishPieceToSocial's own media choice.
  const formatViolation = useMemo(
    () => describeFormatViolation(
      piece.platform,
      piece.format,
      publishMediaForFormat({ media_urls: piece.media_urls, slides: piece.slides }),
    ),
    [piece.platform, piece.format, piece.media_urls, piece.slides],
  )
  const formatValid = !formatViolation
  const formatBlockReason = formatViolation?.message || null

  const sendForReview = async () => {
    try {
      await updateStatus.mutateAsync({ id: piece.id, status: 'in_review', reviewedBy: userEmail })
    } catch (err) {
      toast.error('Failed to send for review', { description: err.message })
    }
  }

  const approve = async () => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        approvedBy: userEmail,
        approvedAt: new Date().toISOString(),
      })
      posthogCapture('draft_reviewed', { pieceId: piece.id, platform: piece.platform })
      // Blog is the ONE channel where approve does not publish (every social
      // channel dispatches on approve, so approve-means-done is the learned
      // model). Say so at the exact moment the model misleads, with the missing
      // step one click away — 7 approved movebetter blogs sat unpublished for
      // up to 66 days with zero "Publish to website" clicks ever recorded
      // (2026-08-21 outcome review).
      if (piece.platform === 'blog') {
        toast.success('Approved — one step left', {
          description: 'Blogs don’t publish on approve. Press “Publish to website” when you’re ready to put it live.',
          duration: 12000,
          action: {
            label: 'Publish to website',
            onClick: () => publish({ bypassMediaCheck: true }),
          },
        })
      } else {
        toast.success('Stories approved — ready for media')
      }
    } catch (err) {
      toast.error('Failed to approve', { description: err.message })
    }
  }

  // Undo approve. Drops the piece back to in_review (or draft if the workspace
  // skips the review step) and clears the approver audit trail. Only valid while
  // status='approved' — once scheduled/published, use Cancel/Delete instead.
  const unapprove = async () => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: skipReview ? 'draft' : 'in_review',
        approvedBy: null,
        approvedAt: null,
      })
      toast.success('Unapproved', {
        description: skipReview
          ? 'Back to draft. Approve again when ready.'
          : 'Back to in review. Approve again when ready.',
      })
    } catch (err) {
      toast.error('Failed to unapprove', { description: err.message })
    }
  }

  // T4 learning loop — reject with a reason, instead of silently deleting or
  // ignoring a wrong draft. Terminal state (no undo — a rejected piece stays
  // as a labeled record so it can feed the weekly "Bernard learned" digest).
  // `reason` must be one of the fixed enum values the server validates
  // (api/_routes/db/content.js REJECT_REASONS); `note` is optional free text.
  const reject = async (reason, note) => {
    try {
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'rejected',
        rejectReason: reason,
        rejectNote: note?.trim() || undefined,
      })
      posthogCapture('draft_rejected', { pieceId: piece.id, platform: piece.platform, reason })
      toast.success('Rejected', { description: "Thanks — Bernard will factor this in." })
    } catch (err) {
      toast.error('Failed to reject', { description: err.message })
    }
  }

  // Unified publish path. Called with one of:
  //   { scheduledAt: Date } — schedule at specific time (customScheduled)
  //   { useQueue: true }    — add to Buffer's queue (shareNext)
  //   {}                    — publish immediately (shareNow)
  // Blog publishes ignore both args and go to the website webhook synchronously.
  // mediaUrlsOverride — dispatch THESE media instead of piece.media_urls, for the
  // one case where the piece prop can't have refreshed yet: the embedded video
  // editor bakes the current edit into a fresh reel and, in the SAME click, asks
  // to schedule/publish it. `piece` here still holds the pre-bake media (the
  // parent's useContentItem hasn't re-rendered mid-handler), so without the
  // override the just-baked trim/captions would be persisted to the row but the
  // dispatched post would carry the stale reel — the preview-vs-published
  // divergence this whole path exists to prevent (feedback f46a0eec). Undefined
  // for every other caller, so the normal path is unchanged.
  const publish = async ({ scheduledAt: scheduledDate, useQueue, bypassMediaCheck, mediaUrlsOverride } = {}) => {
    // Hard format gate (block): an explicit format the attached media can't
    // satisfy would be rejected server-side after a round-trip. Stop here with
    // the reason + the fix (usually "switch to Carousel"). Covers every publish
    // surface — editor bar, publish panel, and the failed-piece Retry button —
    // since they all funnel through this one hook.
    if (formatViolation) {
      toast.error('Can’t publish yet', { description: formatViolation.message })
      return
    }
    // Soft media gate (warn, don't block): a draft with no photo/video can still
    // ship — but media usually helps. Warn once with an override; "Add media"
    // routes to Storyboard. A confirmed publish re-runs with bypassMediaCheck.
    const effectiveMediaUrls = mediaUrlsOverride || piece.media_urls
    const hasMedia = Array.isArray(effectiveMediaUrls) && effectiveMediaUrls.length > 0
    if (!hasMedia && !bypassMediaCheck && piece.platform === 'blog') {
      // Blog-specific: a hero is optional (publish/website ships fine without
      // one), and the generic warning below is social-framed — worse, its "Add
      // media" action navigates to /publish/:id, the page the blog editor is
      // already on, a dead click. Name the real tradeoff and keep publishing
      // one click away.
      toast.warning('This blog has no hero image', {
        description: 'It will publish without one. You can attach a hero from the media rail first, or just publish.',
        action: {
          label: 'Publish anyway',
          onClick: () => publish({ bypassMediaCheck: true }),
        },
      })
      return
    }
    if (!hasMedia && !bypassMediaCheck) {
      toast.warning('This post has no photo or video', {
        description: 'Posts with media usually perform better.',
        action: {
          label: 'Publish anyway',
          onClick: () => publish({ scheduledAt: scheduledDate, useQueue, bypassMediaCheck: true, mediaUrlsOverride }),
        },
        cancel: {
          label: 'Add media',
          onClick: () => navigate(`/publish/${piece.id}`),
        },
      })
      return
    }
    const effectiveScheduledAt = scheduledDate ? scheduledDate.toISOString() : null
    const usingQueue = !!useQueue

    setPublishing(true)
    try {
      const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)
      if (piece.platform === 'blog') {
        // Blog output hygiene (see src/lib/blogOutput.js): the headline is the
        // first body "# " line and becomes the page title (the receiver renders
        // the single <h1>), so we strip it from the published body. Slug + SEO
        // title are derived deterministically so the same article always yields
        // the same URL and a <title> that fits in SERPs.
        const { headline, body } = cleanBlogMarkdown(markdown)
        const title = headline || (stripStoryDatePrefix(piece.topic) || 'Blog Post')
        const slug = slugifyTitle(title)
        // A manual override (Words > SEO panel) wins; otherwise fall back to
        // the same deterministic derivation the SEO panel shows as a
        // placeholder, so what the author saw before leaving it blank is
        // exactly what gets published.
        const seoTitle = (piece.seo_title || '').trim() || deriveSeoTitle(title)
        const description = (piece.meta_description || '').trim() || deriveMetaDescription(body, seoTitle)
        const pubDate = new Date().toISOString().slice(0, 10)
        // Bake the framed + colour-graded hero to a real 16:9 image so the site
        // receives an already-cropped photo — the reason the bake approach was
        // chosen over passing crop metadata (Philip's feedback #692e60b0, Q
        // 2026-08-27). Only when the author actually reframed/graded it; an
        // untouched hero ships as-is (the site's object-fit:cover crops it to the
        // same 16:9 the preview showed). Reuses the carousel's canvas→upload
        // path; a bake failure is non-fatal — fall back to the original hero
        // rather than block the publish.
        let heroMedia = Array.isArray(piece.media_urls) ? piece.media_urls : []
        const heroIdx = heroMedia.findIndex((m) => m && !isVideoEntry(m))
        const heroEntry = heroIdx >= 0 ? heroMedia[heroIdx] : null
        if (heroEntry && heroReframed(heroEntry)) {
          try {
            const bakedUrl = await renderAndUploadHero({
              entry: heroEntry,
              brandStyle: brandStyleForRender(workspace),
              pieceId: piece.id,
            })
            if (bakedUrl) {
              heroMedia = heroMedia.slice()
              heroMedia[heroIdx] = { ...heroEntry, url: bakedUrl, sourceUrl: photoSourceUrl(heroEntry), composed: true }
            }
          } catch (e) {
            console.warn('[publish] hero bake failed, shipping original:', e?.message)
          }
        }
        const manifest = buildImagesManifest({ markdown: body, mediaUrls: heroMedia, slug })
        const payload = { contentItemId: piece.id, slug, title, seoTitle, headline: title, description, pubDate, markdown: body, ...manifest }
        if (piece.published_at) payload.updatedDate = pubDate
        if (piece.staff_name) payload.author = piece.staff_name
        if (piece.topic) {
          const topicSlug = stripStoryDatePrefix(piece.topic).toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
          if (topicSlug) payload.topic = topicSlug
        }
        const result = await runWithToast(publishBlogToWebsite(payload), {
          loading: 'Publishing to website… this can take 30–90s',
          success: (r) => ({
            message: 'Published to website',
            description: r.postUrl ? `View at ${r.postUrl}` : 'Post is live.',
          }),
          error: (e) => ({ message: 'Publish failed', description: e.message }),
        })
        await updateStatus.mutateAsync({
          id: piece.id,
          status: 'published',
          publishedAt: new Date().toISOString(),
          resolvedUrl: result.postUrl || undefined,
        })
        posthogCapture('published', { platform: 'blog', pieceId: piece.id })
      } else {
        // Social publish runs through the shared publishPieceToSocial helper —
        // the single source of truth for the Buffer path (incl. carousel
        // slide-baking). The helper dispatches + PATCHes status AND persists the
        // freshly-baked slides itself (pre-lock, before dispatch); we own only the
        // toast and the approver audit.
        const { scheduling } = await runWithToast(
          publishPieceToSocial(mediaUrlsOverride ? { ...piece, media_urls: mediaUrlsOverride } : piece, {
            scheduledAt: effectiveScheduledAt,
            useQueue: usingQueue,
            userEmail,
            workspace,
            themes: allThemes,
          }),
          {
            loading: usingQueue ? 'Adding to queue…'
              : effectiveScheduledAt ? 'Scheduling…'
              : 'Publishing…',
            success: usingQueue ? 'Added to queue'
              : effectiveScheduledAt ? 'Scheduled'
              : '🎉 It’s live! Your story is out in the world.',
            // Prefer the server's human `message` (e.g. the format-mismatch
            // explanation) over the raw machine `error` key that ApiError.message
            // otherwise surfaces (extractMessage favours payload.error).
            error: (e) => ({ message: 'Publish failed', description: e.payload?.message || e.message }),
          },
        )
        // The publish route already committed status + scheduled_at (and the
        // post id) server-side, bypassing the publish lock, and the helper
        // persisted the baked slides pre-lock. We must NOT echo any frozen field
        // (status/scheduled_at/slides) back through the lock's route
        // (/api/db/content) — that 409s on the now-'scheduled'/'published' row,
        // the false "Post failed" / locked_scheduled bug. Just refetch so the
        // calendar and header reflect the server-committed state.
        qc.invalidateQueries({ queryKey: queryKeys.contentItems.all })
        qc.invalidateQueries({ queryKey: queryKeys.stories.all })
        posthogCapture(scheduling ? 'publish_scheduled' : 'published', { platform: piece.platform, pieceId: piece.id })
        qc.invalidateQueries({ queryKey: queryKeys.stories.detail(piece.interview_id) })
      }
    } catch {
      // runWithToast already surfaced the error toast; swallow so we don't
      // double-toast and so the finally block resets the spinner.
    } finally {
      setPublishing(false)
    }
  }

  // Send the blog draft to Beehiiv as a draft post. Independent of the
  // website-publish path. Does NOT advance piece.status; Beehiiv is a secondary
  // destination and the tenant finishes the send inside Beehiiv's UI.
  const sendToBeehiiv = async () => {
    if (piece.platform !== 'blog') return
    setBeehiivPublishing(true)
    try {
      const markdown = typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)
      const { headline, body } = cleanBlogMarkdown(markdown)
      const title = headline || (stripStoryDatePrefix(piece.topic) || 'Blog Post')
      const descLine = body.split('\n').find((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l))
      const description = descLine?.trim().slice(0, 200) || title
      const slug = slugifyTitle(title)
      const heroImage = Array.isArray(piece.media_urls) && piece.media_urls[0]?.url
        ? piece.media_urls[0].url
        : undefined
      const payload = { contentItemId: piece.id, title, description, markdown: body, slug }
      if (heroImage) payload.heroImage = heroImage
      const result = await runWithToast(sendBlogToBeehiiv(payload), {
        loading: 'Sending draft to Beehiiv…',
        success: (r) => ({
          message: 'Draft in Beehiiv',
          description: r.postUrl ? 'Open Beehiiv to add thumbnail, set audience, and schedule.' : 'Draft created — finish in Beehiiv.',
        }),
        error: (e) => ({
          message: e.code === 'not_configured' ? 'Beehiiv not connected' : 'Beehiiv send failed',
          description: e.code === 'not_configured'
            ? 'Add a Beehiiv API key in Settings → Integrations.'
            : e.message,
        }),
      })
      if (result?.postUrl && typeof window !== 'undefined') {
        window.open(result.postUrl, '_blank', 'noopener')
      }
    } catch {
      // runWithToast already surfaced the error toast.
    } finally {
      setBeehiivPublishing(false)
    }
  }

  // Cancel a scheduled Buffer post. Resets the row to status='approved' with
  // scheduled_at + platform_post_id cleared. NOT for already-published pieces.
  const cancelScheduled = async () => {
    if (!piece.platform_post_id) {
      toast.error('Cannot cancel — no scheduled post ID on file')
      return
    }
    setPublishing(true)
    try {
      await runWithToast(cancelScheduledPost(piece.platform_post_id), {
        loading: 'Cancelling…',
        success: 'Cancelled — back to Approved',
        error: (e) => ({ message: 'Cancel failed', description: e.message }),
      })
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        scheduledAt: null,
        platformPostId: null,
        publishedAt: null,
      })
      qc.invalidateQueries({ queryKey: queryKeys.stories.detail(piece.interview_id) })
    } catch {
      // runWithToast surfaced the error; keep status='scheduled' so the user can
      // retry rather than having Buffer + our DB drift apart.
    } finally {
      setPublishing(false)
    }
  }

  return {
    // handlers
    sendForReview,
    approve,
    unapprove,
    reject,
    publish,
    sendToBeehiiv,
    cancelScheduled,
    // shared mutation (so callers reuse ONE instance for their own review-only
    // status writes + a single isPending across every workflow button)
    updateStatus,
    // derived state
    publishing,
    beehiivPublishing,
    statusPending: updateStatus.isPending,
    suggested,
    otherScheduled,
    prefsOverride,
    userEmail,
    canDirectPublish,
    // Whether the piece's explicit format fits its media. false → publish is
    // blocked; formatBlockReason is the human explanation + fix. true for pieces
    // with no explicit format (nothing to gate).
    formatValid,
    formatBlockReason,
    skipReview,
    canReview,
  }
}
