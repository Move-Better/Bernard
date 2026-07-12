import { useMemo, useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useUser } from '@clerk/react'
import { useQueryClient } from '@tanstack/react-query'
import { posthogCapture } from '@/lib/posthog'
import { useUserRole } from '@/lib/useUserRole'
import { useWorkspace } from '@/lib/WorkspaceContext'
import {
  useUpdateContentItem,
  useUpdateContentItemStatus,
  useCarouselThemes,
  queryKeys,
} from '@/lib/queries'
import { publishBlogToWebsite, sendBlogToBeehiiv, cancelBufferPost } from '@/lib/publish'
import { publishPieceToBuffer } from '@/lib/publishPiece'
import { suggestScheduleTime } from '@/lib/scheduleHeuristics'
import { buildImagesManifest } from '@/lib/publishImageMirror'
import { slugifyTitle, deriveSeoTitle, cleanBlogMarkdown } from '@/lib/blogOutput'
import { canDirectPublishPlatform } from '@/lib/outputChannels'
import { toast, runWithToast } from '@/lib/toast'

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
 * The low-level Buffer dispatch already lives in publishPieceToBuffer; this hook
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
  const updateItem = useUpdateContentItem()
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
      toast.success('Stories approved — ready for media')
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

  // Unified publish path. Called with one of:
  //   { scheduledAt: Date } — schedule at specific time (customScheduled)
  //   { useQueue: true }    — add to Buffer's queue (shareNext)
  //   {}                    — publish immediately (shareNow)
  // Blog publishes ignore both args and go to the website webhook synchronously.
  const publish = async ({ scheduledAt: scheduledDate, useQueue, bypassMediaCheck } = {}) => {
    // Soft media gate (warn, don't block): a draft with no photo/video can still
    // ship — but media usually helps. Warn once with an override; "Add media"
    // routes to Storyboard. A confirmed publish re-runs with bypassMediaCheck.
    const hasMedia = Array.isArray(piece.media_urls) && piece.media_urls.length > 0
    if (!hasMedia && !bypassMediaCheck) {
      toast.warning('This post has no photo or video', {
        description: 'Posts with media usually perform better.',
        action: {
          label: 'Publish anyway',
          onClick: () => publish({ scheduledAt: scheduledDate, useQueue, bypassMediaCheck: true }),
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
        const title = headline || (piece.topic || 'Blog Post')
        const slug = slugifyTitle(title)
        const seoTitle = deriveSeoTitle(title)
        const descLine = body.split('\n').find((l) => l.trim() && !/^#/.test(l) && !/^!\[/.test(l))
        const description = descLine?.trim().slice(0, 200) || seoTitle
        const pubDate = new Date().toISOString().slice(0, 10)
        const manifest = buildImagesManifest({ markdown: body, mediaUrls: piece.media_urls, slug })
        const payload = { contentItemId: piece.id, slug, title, seoTitle, headline: title, description, pubDate, markdown: body, ...manifest }
        if (piece.published_at) payload.updatedDate = pubDate
        if (piece.staff_name) payload.author = piece.staff_name
        if (piece.topic) {
          const topicSlug = piece.topic.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '')
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
        // Social publish runs through the shared publishPieceToBuffer helper —
        // the single source of truth for the Buffer path (incl. carousel
        // slide-baking). The helper dispatches + PATCHes status; we own the
        // toast, the baked-slide persist, and the approver audit.
        const { scheduling, scheduledAt: finalScheduledAt, renderedSlides } = await runWithToast(
          publishPieceToBuffer(piece, {
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
            error: (e) => ({ message: 'Publish failed', description: e.message }),
          },
        )
        // Persist freshly-baked slide URLs so the next publish reuses them.
        if (renderedSlides) {
          try {
            await updateItem.mutateAsync({ id: piece.id, patch: { slides: renderedSlides } })
          } catch { /* non-fatal: publish already used the rendered URLs */ }
        }
        // publishAndTrack already set status + publishedAt; this pass writes the
        // approver audit trail and (for scheduled posts) persists the chosen
        // scheduled_at on the row so the calendar/header reflect the new time.
        await updateStatus.mutateAsync({
          id: piece.id,
          status: scheduling ? 'scheduled' : 'published',
          approvedBy: userEmail,
          approvedAt: new Date().toISOString(),
          publishedAt: scheduling ? null : new Date().toISOString(),
          scheduledAt: scheduling ? finalScheduledAt : null,
        })
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
      const title = headline || (piece.topic || 'Blog Post')
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
  // scheduled_at + buffer_update_id cleared. NOT for already-published pieces.
  const cancelScheduled = async () => {
    if (!piece.buffer_update_id) {
      toast.error('Cannot cancel — no scheduled post ID on file')
      return
    }
    setPublishing(true)
    try {
      await runWithToast(cancelBufferPost(piece.buffer_update_id), {
        loading: 'Cancelling…',
        success: 'Cancelled — back to Approved',
        error: (e) => ({ message: 'Cancel failed', description: e.message }),
      })
      await updateStatus.mutateAsync({
        id: piece.id,
        status: 'approved',
        scheduledAt: null,
        bufferUpdateId: null,
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
    skipReview,
    canReview,
  }
}
