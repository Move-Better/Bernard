import { useEffect, useMemo, useRef, useState } from 'react'
import { useNavigate, useParams } from 'react-router-dom'
import {
  ArrowRight, Book, Calendar, Flag, ImagePlus, Images, Loader2, Pen, Search, Sliders,
  Sparkles, Upload, Video, ImageIcon, Play, X, ChevronDown, CornerDownLeft, Repeat, Type, Megaphone,
} from 'lucide-react'
import { Button } from '@/components/ui/button'
import PipelineStepper from '@/components/PipelineStepper'
import BackLink from '@/components/ui/BackLink'
import Breadcrumb from '@/components/ui/Breadcrumb'
import { pieceLabel } from '@/lib/pieceLabel'
import LoadingState from '@/components/LoadingState'
import ErrorState from '@/components/ErrorState'
import MediaPicker from '@/components/MediaPicker'
import AdExportModal from '@/components/AdExportModal'
import TextPostStudio from '@/components/TextPostStudio'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { BERNARD_EMERALD } from '@/lib/brand'
import CandidateCard from '@/components/storyboard/CandidateCard'
import MediaPreviewDialog from '@/components/storyboard/MediaPreviewDialog'
import {
  useContentItem, useContentItems, useInterview, useMediaSuggestions, useUpdateContentItem,
} from '@/lib/queries'
import { clipToMediaEntry, pickerItemToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import { mediaKindForPlatform, mediaKindLabel, isKindMismatch, isTextOnlyPlatform } from '@/lib/platformMediaKind'
import { PLATFORM_META } from '@/lib/contentMeta'
import { toast } from '@/lib/toast'
import { apiFetch } from '@/lib/api'
import { formatRelativeDate } from '@/lib/utils'

const KIND_TABS = [
  { key: 'both', label: 'Photos & video' },
  { key: 'photo', label: 'Photos' },
  { key: 'video', label: 'Videos' },
]

const NEEDS_MEDIA = (p) => !Array.isArray(p?.media_urls) || p.media_urls.length === 0

/**
 * StoryboardPiece — visual-hero single-post editor. Left: the post preview
 * (platform badge + media area + editable caption strip). Right: campaign
 * band (if applicable), Change-the-look chips (Phase 4 AI), Adjust-by-hand
 * controls, per-post schedule CTA.
 */
export default function StoryboardPiece() {
  const { pieceId } = useParams()
  const navigate = useNavigate()

  const { data: piece, isLoading, isError } = useContentItem(pieceId)
  const workspace = useWorkspace()
  const brandStyle = workspace?.brand_style || null
  const workspaceName = workspace?.display_name || workspace?.name || ''

  // Interview — needed for campaign band. Only fetched when piece has an interview.
  const { data: interview } = useInterview(piece?.interview_id, { enabled: !!piece?.interview_id })

  // Text post studio (Option B) — branded text-only card when there's no clip.
  const [studioOpen, setStudioOpen] = useState(false)

  // Caption edit state — seeded from piece.content once loaded.
  const [caption, setCaption] = useState('')
  const captionSeeded = useRef(false)
  useEffect(() => {
    if (captionSeeded.current || !piece) return
    captionSeeded.current = true
    setCaption(typeof piece.content === 'string' ? piece.content : '')
  }, [piece])

  // Manual-controls collapsible
  const [manualOpen, setManualOpen] = useState(false)

  // "Export for ads" — re-renders this piece's composed photo (its baked
  // headline/treatment) into the ad aspect sizes via AdExportModal.
  const [adExportOpen, setAdExportOpen] = useState(false)

  // "Adjust by hand" look knobs (mockup-faithful). Editor-local: Reframe
  // changes the preview aspect ratio live; Headline/Captions are placeholders
  // for baked-text template posts (no-op on a real photo, by design for now).
  const [look, setLook] = useState({ ar: '9:16', size: 'md', captions: true })
  const AR_CLASS = { '9:16': 'aspect-[9/16]', '4:5': 'aspect-[4/5]', '1:1': 'aspect-square' }

  // ── Photo compositor (P1) ──────────────────────────────────────────────
  // treatment = the spec the server bakes onto the photo (grade + scrim +
  // brand-font headline). composedUrl = the last baked image (== what ships).
  const [treatment, setTreatment] = useState({ templateId: 'editorial', headline: '', headlineSize: 'm', grade: 40, aspect: '4:5', scrim: 'navy', label: '', accentText: '' })
  const [composedUrl, setComposedUrl] = useState(null)
  const [composing, setComposing] = useState(false)
  // Which IMAGE entry (carousel index) the compositor targets.
  const [composeTargetIdx, setComposeTargetIdx] = useState(0)
  const treatmentSeeded = useRef(false)
  useEffect(() => {
    if (treatmentSeeded.current || !piece) return
    treatmentSeeded.current = true
    if (piece.photo_composite_url) setComposedUrl(piece.photo_composite_url)
    if (piece.photo_treatment && typeof piece.photo_treatment === 'object') {
      setTreatment((t) => ({ ...t, ...piece.photo_treatment }))
    }
  }, [piece])

  // Keep treatment.aspect in sync with the card's displayed aspect ratio so the
  // baked image never gets clipped by object-cover on a mismatched container.
  useEffect(() => {
    if (look.ar) setTreatment((t) => ({ ...t, aspect: look.ar }))
  }, [look.ar])

  // Bake the current treatment onto the photo, server-side (preview == publish).
  async function compose(patch) {
    // Always bake at the aspect the card displays — prevents object-cover clipping.
    const next = { ...treatment, ...(patch || {}), aspect: look.ar || treatment.aspect }
    if (!next.headline) {
      next.headline = String(caption || '').split(/(?<=[.!?])\s/)[0]?.slice(0, 140) || ''
    }
    setTreatment(next)
    setComposing(true)
    try {
      const r = await apiFetch('/api/editorial/compose-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceId, treatment: next, imageIndex: composeTargetIdx }),
      })
      if (r?.url) setComposedUrl(r.url)
      return r
    } catch (e) {
      toast.error('Could not update the image', { description: e?.message })
      return null
    } finally {
      setComposing(false)
    }
  }

  // Change the look — AI restyle state
  const [restyleLoading, setRestyleLoading] = useState(false)
  const [restyleInput, setRestyleInput] = useState('')

  // Campaign spin — AI re-tunes which angles/platforms to prioritize
  const [spinLoading, setSpinLoading] = useState(false)
  const [spinResult, setSpinResult] = useState(null)

  async function runSpin() {
    if (!piece?.campaign_id || spinLoading) return
    setSpinLoading(true)
    try {
      const result = await apiFetch('/api/editorial/campaign-spin', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ campaign_id: piece.campaign_id }),
      })
      setSpinResult(result)
      toast.success('Campaign re-tuned: ' + (result.explanation?.slice(0, 80) || 'Done'))
    } catch (_e) {
      toast.error('Could not tune campaign')
    } finally {
      setSpinLoading(false)
    }
  }

  async function fireRestyle(instruction) {
    if (!instruction.trim() || restyleLoading) return
    setRestyleLoading(true)
    try {
      const result = await apiFetch('/api/editorial/restyle', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          surface: 'post',
          instruction: instruction.trim(),
          content: caption,
          staffId: piece?.staff_id || undefined,
        }),
      })
      const ch = result?.changes || {}
      const next = {}
      if (ch.content) next.headline = String(ch.content)
      if (typeof ch.fontSizeStep === 'number') {
        const order = ['s', 'm', 'l']
        const i = Math.max(0, order.indexOf(treatment.headlineSize))
        next.headlineSize = order[Math.max(0, Math.min(2, i + ch.fontSizeStep))]
      }
      if (typeof ch.brightness === 'number') {
        next.grade = Math.round(Math.min(100, Math.max(0, ((ch.brightness - 0.8) / 0.45) * 100)))
      }
      if (ch.themeId) next.scrim = ch.themeId === 'brand' ? 'brand' : 'navy'
      // WHOOP template / accent / label / badge-figure the chat can now set.
      if (ch.templateId) next.templateId = String(ch.templateId)
      if (ch.accentText) next.accentText = String(ch.accentText)
      if (ch.label) next.label = String(ch.label)
      if (ch.figure) next.figure = String(ch.figure)
      if (ch.figureUnit) next.figureUnit = String(ch.figureUnit)

      if (Object.keys(next).length > 0) {
        await compose(next)
        toast.success(result?.explanation || 'Updated the image.')
      } else {
        // Honesty: the restyle returned a change this photo surface can't apply
        // (e.g. carousel-only page numbers / slide count). Don't fake success.
        toast(
          result?.explanation
            ? `${result.explanation} — but that change isn't available on a photo post yet.`
            : "I can't make that change to a photo post yet — try 'punchier headline', 'bigger text', or 'brighter'.",
        )
      }
    } catch (e) {
      toast.error(e?.message || 'Could not apply change')
    } finally {
      setRestyleLoading(false)
    }
  }

  // Platform kind (video | photo | null = either)
  const platformKind = piece ? mediaKindForPlatform(piece.platform) : null
  // Text-only output (email / blog / landing page) has no aspect ratio or
  // caption concept — hide those "look" affordances below.
  const textOnly = piece ? isTextOnlyPlatform(piece.platform) : false
  const meta = PLATFORM_META[piece?.platform] || { label: piece?.platform || '—' }
  const PlatformIcon = meta.icon

  // Kind filter, seeded from the platform once the draft loads.
  const [kind, setKind] = useState(null)
  const seeded = useRef(false)
  useEffect(() => {
    if (seeded.current || !piece) return
    seeded.current = true
    setKind(platformKind === 'video' ? 'video' : platformKind === 'photo' ? 'photo' : 'both')
    setLook((l) => ({ ...l, ar: platformKind === 'photo' ? '4:5' : '9:16' }))
  }, [piece, platformKind])

  const effectiveKind = kind === 'photo' ? 'photo' : kind === 'video' ? 'video' : undefined
  const {
    data: sugg, isLoading: suggLoading, isError: suggError, refetch, isFetching,
  } = useMediaSuggestions(pieceId, { enabled: !!pieceId && kind !== null, kind: effectiveKind, k: 12 })

  const updateItem = useUpdateContentItem()
  const media = useMemo(() => (Array.isArray(piece?.media_urls) ? piece.media_urls : []), [piece])
  const attachedKeys = useMemo(() => new Set(media.map(mediaEntryKey)), [media])
  const hasMedia = media.length > 0

  // Image entries the compositor can target (carousel support).
  const imageIdxs = useMemo(
    () => media.map((m, i) => ((m?.type === 'video' || m?.kind === 'video') ? -1 : i)).filter((i) => i >= 0),
    [media],
  )
  const targetMediaIdx = imageIdxs[composeTargetIdx] ?? imageIdxs[0] ?? -1
  const targetEntry = targetMediaIdx >= 0 ? media[targetMediaIdx] : null
  const targetThumb = targetEntry?.thumbnailUrl || targetEntry?.url || null

  // Switch which carousel image the compositor edits — load that entry's
  // baked result + its own saved treatment.
  function selectComposeTarget(k) {
    setComposeTargetIdx(k)
    const e = media[imageIdxs[k]]
    setComposedUrl(e?.composed ? e.url : null)
    if (e?.treatment && typeof e.treatment === 'object') setTreatment((t) => ({ ...t, ...e.treatment }))
  }

  const [attachingKey, setAttachingKey] = useState(null)
  const [removingKey, setRemovingKey] = useState(null)
  const [previewClip, setPreviewClip] = useState(null)
  const [pickerOpen, setPickerOpen] = useState(false)

  // "Describe the shot" — manual query into the same suggest-media brain.
  // The API has accepted a query override since P0; this is its missing UI.
  const [shotQ, setShotQ] = useState('')
  const [shotRes, setShotRes] = useState(null)
  const [shotLoading, setShotLoading] = useState(false)

  async function runShotSearch() {
    const q = shotQ.trim()
    if (!q || shotLoading) return
    setShotLoading(true)
    try {
      const resp = await apiFetch('/api/content-items/suggest-media', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          id: pieceId,
          query: q,
          k: 12,
          ...(effectiveKind ? { kind: effectiveKind } : {}),
        }),
      })
      setShotRes((resp?.clips || []).filter((c) => !attachedKeys.has(c.assetId)))
    } catch (e) {
      toast.error(e?.message || 'Search failed.')
    } finally {
      setShotLoading(false)
    }
  }

  function clearShot() {
    setShotRes(null)
    setShotQ('')
  }

  const attachEntry = async (entry) => {
    const key = mediaEntryKey(entry)
    if (attachedKeys.has(key)) return
    setAttachingKey(key)
    try {
      await updateItem.mutateAsync({ id: pieceId, patch: { mediaUrls: [...media, entry] } })
      toast.success('Media attached')
    } catch (e) {
      toast.error('Could not attach', { description: e?.message })
    } finally {
      setAttachingKey(null)
    }
  }

  const removeEntry = async (entry) => {
    const key = mediaEntryKey(entry)
    setRemovingKey(key)
    try {
      await updateItem.mutateAsync({ id: pieceId, patch: { mediaUrls: media.filter((m) => mediaEntryKey(m) !== key) } })
    } catch (e) {
      toast.error('Could not remove', { description: e?.message })
    } finally {
      setRemovingKey(null)
    }
  }

  const handlePicked = (assets) => {
    setPickerOpen(false)
    const incoming = (Array.isArray(assets) ? assets : [assets]).filter(Boolean).map(pickerItemToMediaEntry)
    const mismatched = incoming.filter((e) => isKindMismatch(piece.platform, e.type))
    if (mismatched.length > 0) {
      toast.warning(
        `Skipped ${mismatched.length} item${mismatched.length === 1 ? '' : 's'} — this channel takes ${mediaKindLabel(platformKind).toLowerCase()}`,
      )
    }
    const fresh = incoming
      .filter((e) => !isKindMismatch(piece.platform, e.type))
      .filter((e) => !attachedKeys.has(mediaEntryKey(e)))
    if (fresh.length === 0) return
    updateItem
      .mutateAsync({ id: pieceId, patch: { mediaUrls: [...media, ...fresh] } })
      .then(() => toast.success(`Attached ${fresh.length} item${fresh.length === 1 ? '' : 's'}`))
      .catch((e) => toast.error('Could not attach', { description: e?.message }))
  }

  // "Next draft" — next still-needs-media piece in the worklist.
  const { data: worklist = [] } = useContentItems({ status: 'draft,in_review' })
  const remainingNeedsMedia = useMemo(
    () => worklist.filter((p) => p.id !== pieceId && NEEDS_MEDIA(p)),
    [worklist, pieceId],
  )
  const nextPieceId = remainingNeedsMedia[0]?.id || null

  if (isLoading) return <LoadingState />
  if (isError || !piece) {
    return (
      <div className="space-y-4 py-6">
        <BackLink to="/publish">Back to Publish</BackLink>
        <ErrorState message="Draft not found." />
      </div>
    )
  }

  const clips = (sugg?.clips || []).filter((c) => !attachedKeys.has(c.assetId))
  // A manual "describe the shot" search overrides the automatic ranking until cleared.
  const shownClips = shotRes ?? clips
  const showKindToggle = platformKind === null
  const campaignName = interview?.campaign?.name ?? null

  // Primary attached media entry (for preview card)
  const primaryMedia = media[0] ?? null
  const primaryIsVideo = primaryMedia?.type === 'video' || primaryMedia?.kind === 'video'
  const primaryThumb = primaryMedia?.thumbnailUrl || (!primaryIsVideo ? primaryMedia?.url : null)

  return (
    <div className="space-y-5 py-6">
      <PipelineStepper current="media" />
      <Breadcrumb
        items={[
          { label: 'Publish', to: '/publish' },
          { label: pieceLabel(piece), to: `/publish/${piece.id}` },
          { label: 'Edit post' },
        ]}
      />

      {/* Header nav */}
      <div className="flex flex-wrap items-center justify-between gap-3">
        <BackLink to="/publish">Back to Publish</BackLink>
        <div className="flex items-center gap-2">
          {piece.interview_id && (
            <Button
              variant="ghost"
              size="sm"
              onClick={() => navigate(`/stories/${piece.interview_id}?piece=${piece.id}`)}
            >
              Edit words
            </Button>
          )}
          {nextPieceId && (
            <Button variant="ghost" size="sm" onClick={() => navigate(`/publish/${nextPieceId}`)}>
              Next draft ({remainingNeedsMedia.length} left) <ArrowRight className="ml-1 h-3.5 w-3.5" />
            </Button>
          )}
          <Button
            size="sm"
            disabled={!hasMedia}
            title={hasMedia ? undefined : 'Attach a photo or video to continue'}
            onClick={() => navigate(`/publish/${piece.id}/schedule`)}
          >
            Continue to publish <ArrowRight className="ml-1 h-3.5 w-3.5" />
          </Button>
        </div>
      </div>

      {/* Campaign band — shown only when this piece came from a campaign interview */}
      {campaignName && (
        <div className="flex flex-col gap-2 rounded-lg border border-primary/30 bg-card px-4 py-3">
          <div className="flex items-center gap-3 flex-wrap">
            <Flag className="h-4 w-4 shrink-0 text-primary" />
            <span className="text-sm font-semibold">{campaignName}</span>
            <span className="rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium text-primary">
              driving this post
            </span>
            <span className="hidden text-xs text-muted-foreground md:inline">
              — AI is working the goal in the background: it picked the media, shaped the caption, and tuned the angle.
            </span>
            {/* "Run the numbers" / spin button */}
            {piece.campaign_id && (
              <Button
                size="sm"
                variant="outline"
                className="ml-auto h-7 gap-1.5 text-xs"
                onClick={runSpin}
                disabled={spinLoading}
              >
                {spinLoading
                  ? <><Loader2 className="h-3 w-3 animate-spin" /> Tuning…</>
                  : <><Sparkles className="h-3 w-3" /> Run the numbers</>}
              </Button>
            )}
            {/* Live AI-tuning indicator */}
            <span className={`flex shrink-0 items-center gap-1.5 text-2xs text-info ${piece.campaign_id ? '' : 'ml-auto'}`}>
              <span className="h-2 w-2 animate-pulse rounded-full bg-info" />
              AI tuning · live
            </span>
            {/* Last spin timestamp */}
            {(() => {
              const tunedAt = spinResult?.ai_tuned_at ?? interview?.campaign?.ai_tuned_at ?? null
              return tunedAt
                ? <span className="w-full text-2xs text-muted-foreground md:w-auto">last spin {formatRelativeDate(tunedAt)}</span>
                : null
            })()}
          </div>
          {/* AI recommendations chip row */}
          {(() => {
            const angles = spinResult?.ai_tune_state?.priority_angles
            if (!Array.isArray(angles) || angles.length === 0) return null
            return (
              <div className="flex items-center gap-2 flex-wrap pt-0.5">
                <span className="text-2xs font-semibold text-primary/80">AI recommends:</span>
                {angles.map((a) => (
                  <span key={a} className="inline-flex items-center rounded-full bg-primary/10 px-2 py-0.5 text-2xs font-medium text-primary border border-primary/20">
                    {a}
                  </span>
                ))}
              </div>
            )
          })()}
        </div>
      )}

      {/* Two-column hero layout */}
      <div className="grid grid-cols-1 gap-6 lg:grid-cols-12">

        {/* ── LEFT: post preview is the hero ── */}
        <div className="lg:col-span-7">
          <p className="mb-2 text-2xs font-bold uppercase tracking-widest text-muted-foreground">
            The post <span className="font-normal normal-case tracking-normal">· this is what publishes</span>
          </p>

          <div className="mx-auto max-w-[520px] overflow-hidden rounded-xl border bg-card">
            {/* Platform header */}
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <div className={`flex h-7 w-7 items-center justify-center rounded-full ${meta.bg ?? 'bg-muted'}`}>
                {PlatformIcon && <PlatformIcon className={`h-4 w-4 ${meta.color ?? 'text-muted-foreground'}`} />}
              </div>
              <span className="text-sm font-semibold">{meta.label}</span>
              {piece.staff_name && (
                <span className="text-xs text-muted-foreground">· {piece.staff_name}</span>
              )}
              {!textOnly && (
                <span className="ml-auto text-3xs text-muted-foreground">
                  {look.ar} · captions {look.captions ? 'on' : 'off'}
                </span>
              )}
            </div>

            {/* Media area */}
            <div className={`relative bg-muted ${AR_CLASS[look.ar] || 'aspect-[4/5]'}`}>
              {primaryMedia ? (
                composedUrl ? (
                  /* Baked composite — exactly what publishes */
                  <img src={composedUrl} alt="" className="h-full w-full object-cover" />
                ) : (targetThumb || primaryThumb) ? (
                  /* Live preview of the treatment; baked server-side on apply/publish */
                  <>
                    <img
                      src={targetThumb || primaryThumb}
                      alt=""
                      className="h-full w-full object-cover"
                      style={{ filter: `brightness(${(1 + (treatment.grade / 100) * 0.12).toFixed(3)}) saturate(${(1 + (treatment.grade / 100) * 0.18).toFixed(3)})` }}
                    />
                    {/* The editorial template previews live in the DOM. The WHOOP
                        templates render too differently to fake in the DOM, so we
                        show the raw photo + a "Bake to preview" hint and let the
                        real server composite (composedUrl) be the preview. */}
                    {(treatment.templateId || 'editorial') === 'editorial' ? (
                      <>
                        <div
                          className="pointer-events-none absolute inset-0"
                          style={{ background: `linear-gradient(to bottom, transparent 42%, ${(treatment.scrim === 'brand' ? (brandStyle?.accent_color || '#10243f') : '#10243f')}e0 100%)` }}
                        />
                        <div className="pointer-events-none absolute inset-x-0 bottom-0 p-4">
                          <div
                            className="font-extrabold leading-tight tracking-tight text-white"
                            style={{
                              fontFamily: `${brandStyle?.heading_font || 'inherit'}, ui-sans-serif, system-ui, sans-serif`,
                              fontSize: treatment.headlineSize === 'l' ? 28 : treatment.headlineSize === 's' ? 20 : 24,
                              maxWidth: '92%',
                              textShadow: '0 1px 8px rgba(0,0,0,0.35)',
                            }}
                          >
                            {treatment.headline || String(caption || '').split(/(?<=[.!?])\s/)[0] || 'Your headline appears here'}
                          </div>
                          <div className="mt-2 flex items-center gap-2">
                            <span className="h-[3px] w-7 rounded-full" style={{ background: brandStyle?.accent_color || BERNARD_EMERALD }} />
                            <span className="text-xs font-semibold text-white/95">{piece.staff_name || workspaceName}</span>
                          </div>
                        </div>
                      </>
                    ) : (
                      <div className="pointer-events-none absolute inset-x-0 bottom-0 flex justify-center p-3">
                        <span className="rounded-full bg-black/60 px-3 py-1 text-2xs font-medium text-white">
                          {`${(treatment.templateId || '').replace('-', ' ')} — hit Bake to preview`}
                        </span>
                      </div>
                    )}
                    {composing && (
                      <div className="absolute inset-0 flex items-center justify-center bg-black/25">
                        <Loader2 className="h-6 w-6 animate-spin text-white" />
                      </div>
                    )}
                  </>
                ) : (
                  <div className="flex h-full w-full items-center justify-center text-muted-foreground">
                    <Play className="h-8 w-8" />
                  </div>
                )
              ) : (
                /* Thin library fallback */
                <div className="flex h-full w-full flex-col items-center justify-center gap-3 p-6">
                  <ImageIcon className="h-8 w-8 text-muted-foreground/50" />
                  <p className="text-center text-sm font-medium text-foreground">
                    No media attached yet
                  </p>
                  <p className="text-center text-xs text-muted-foreground">
                    Pick from the Library below or choose a fallback to get started.
                  </p>
                  {/* Thin-library quick-pick */}
                  <div className="mt-1 grid w-full max-w-[280px] grid-cols-3 gap-2 text-center text-2xs">
                    <button
                      type="button"
                      onClick={() => setStudioOpen(true)}
                      className="rounded-lg border-2 border-primary bg-primary/5 p-2"
                    >
                      <div className="mb-1 flex aspect-square items-center justify-center rounded bg-gradient-to-br from-orange-200 to-amber-100 text-accent-foreground">
                        <Pen className="h-4 w-4" />
                      </div>
                      Text template
                    </button>
                    <button
                      type="button"
                      onClick={() => {
                        if (piece.interview_id) navigate(`/stories/${piece.interview_id}?piece=${piece.id}`)
                      }}
                      className="rounded-lg border border-border p-2 hover:border-primary"
                    >
                      <div className="mb-1 flex aspect-square items-center justify-center rounded bg-gradient-to-br from-slate-700 to-slate-500 text-white">
                        <Video className="h-4 w-4" />
                      </div>
                      Interview frame
                    </button>
                    <button
                      type="button"
                      onClick={() => setPickerOpen(true)}
                      className="rounded-lg border border-border p-2 hover:border-primary"
                    >
                      <div className="mb-1 flex aspect-square items-center justify-center rounded bg-muted text-muted-foreground">
                        <Upload className="h-4 w-4" />
                      </div>
                      Upload
                    </button>
                  </div>
                </div>
              )}
            </div>

            {/* Caption strip — always editable */}
            <div className="px-4 py-3">
              <div className="mb-1 flex items-center gap-1.5">
                <Pen className="h-3 w-3 text-muted-foreground" />
                <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                  Caption
                </span>
                <span className="text-3xs text-muted-foreground">
                  · from your approved blog — edit if needed
                </span>
              </div>
              <textarea
                rows={3}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                className="w-full resize-none bg-transparent text-xs leading-snug text-foreground/85 outline-none"
                placeholder="Caption will appear here once you've approved the blog post…"
              />
            </div>
          </div>
        </div>

        {/* ── RIGHT: controls ── */}
        <div className="space-y-3 lg:col-span-5">

          {/* Change the look — AI conversation (Phase 4) */}
          <div className="overflow-hidden rounded-xl border border-primary/40 bg-card">
            <div className="flex items-center gap-2 border-b bg-primary/5 px-4 py-2.5">
              <Sparkles className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Change the look</span>
              <span className="text-2xs text-muted-foreground">· just ask, like talking to a designer</span>
              {restyleLoading && <Loader2 className="ml-auto h-3 w-3 animate-spin text-muted-foreground" />}
            </div>
            {/* AI greeting — sets the conversational frame */}
            <div className="flex gap-2 px-4 pt-3 text-xs">
              <span className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-primary/10">
                <Sparkles className="h-3 w-3 text-primary" />
              </span>
              <p className="text-muted-foreground">
                {hasMedia
                  ? 'I matched your brand book to this media. Want anything different? Try a suggestion, or just type.'
                  : 'Waiting for media — attach something from the picks and I can style it.'}
              </p>
            </div>
            <div className="px-3 pb-3 pt-3">
              <div className="mb-2 flex flex-wrap gap-1.5 text-2xs">
                {['Bigger headline', 'Use brand navy', 'Brighter photo', 'Match brand book'].map((label) => (
                  <button
                    key={label}
                    type="button"
                    disabled={restyleLoading || !hasMedia}
                    onClick={() => fireRestyle(label)}
                    className="flex items-center gap-1 rounded-full border px-2 py-1 transition-colors hover:border-primary hover:text-primary disabled:opacity-50 disabled:cursor-not-allowed"
                  >
                    {label === 'Match brand book' && <Book className="h-3 w-3" />}
                    {label}
                  </button>
                ))}
              </div>
              <div className="flex items-center gap-2">
                <input
                  type="text"
                  value={restyleInput}
                  onChange={(e) => setRestyleInput(e.target.value)}
                  onKeyDown={(e) => {
                    if (e.key === 'Enter' && restyleInput.trim() && hasMedia) {
                      fireRestyle(restyleInput)
                      setRestyleInput('')
                    }
                  }}
                  placeholder={hasMedia
                    ? "e.g. 'make the headline pop more' or 'warmer background'…"
                    : 'Attach media first — then ask for any look'}
                  className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                  disabled={restyleLoading || !hasMedia}
                />
                <button
                  type="button"
                  disabled={restyleLoading || !restyleInput.trim() || !hasMedia}
                  onClick={() => { fireRestyle(restyleInput); setRestyleInput('') }}
                  className="flex items-center justify-center rounded-lg bg-primary px-3 py-2 text-primary-foreground hover:bg-primary/90 transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
                >
                  <CornerDownLeft className="h-3.5 w-3.5" />
                </button>
              </div>

              {/* Manual knobs — same treatment the AI bakes. Photo posts only. */}
              {targetEntry && (
                <div className="mt-3 space-y-2 border-t pt-3 text-xs">
                  {/* Carousel: pick which image to compose. */}
                  {imageIdxs.length > 1 && (
                    <div>
                      <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
                        Editing photo {composeTargetIdx + 1} of {imageIdxs.length}
                      </span>
                      <div className="mt-1 flex flex-wrap gap-1.5">
                        {imageIdxs.map((mi, k) => {
                          const e = media[mi]
                          const thumb = e?.thumbnailUrl || e?.url
                          return (
                            <button
                              key={mediaEntryKey(e) || k}
                              type="button"
                              disabled={composing}
                              onClick={() => selectComposeTarget(k)}
                              className={`relative h-12 w-12 overflow-hidden rounded border-2 disabled:opacity-50 ${composeTargetIdx === k ? 'border-primary' : 'border-border'}`}
                              title={`Photo ${k + 1}`}
                            >
                              {thumb ? <img src={thumb} alt="" className="h-full w-full object-cover" /> : null}
                              {e?.composed && <span className="absolute bottom-0 right-0 bg-primary px-0.5 text-3xs font-bold leading-none text-primary-foreground">✓</span>}
                            </button>
                          )
                        })}
                      </div>
                    </div>
                  )}
                  {/* Template picker (P2 — WHOOP direction). Selecting bakes immediately. */}
                  <div>
                    <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Template</span>
                    <div className="mt-1 flex flex-wrap gap-1">
                      {[
                        ['editorial', 'Editorial'],
                        ['dark-claim', 'Dark claim'], ['light-claim', 'Light claim'],
                        ['dark-badge', 'Dark badge'], ['light-badge', 'Light badge'],
                        ['dark-split', 'Dark split'], ['light-split', 'Light split'],
                      ].map(([id, label]) => (
                        <button
                          key={id}
                          type="button"
                          disabled={composing}
                          onClick={() => {
                            // Badge templates need a figure first — just select, let
                            // the user fill the figure, then Bake. Others bake on select.
                            if (String(id).includes('badge')) setTreatment((t) => ({ ...t, templateId: id }))
                            else compose({ templateId: id })
                          }}
                          className={`rounded border px-2 py-1 text-2xs disabled:opacity-50 ${(treatment.templateId || 'editorial') === id ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground hover:border-primary/40'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                  </div>
                  {/* Slots — fill, then Bake. */}
                  <div className="flex items-start gap-2">
                    <span className="w-14 shrink-0 pt-1 text-muted-foreground">Headline</span>
                    <textarea
                      rows={2}
                      value={treatment.headline || ''}
                      onChange={(e) => setTreatment((t) => ({ ...t, headline: e.target.value }))}
                      placeholder="Defaults to your caption's first line…"
                      className="flex-1 resize-none rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">Accent</span>
                    <input
                      value={treatment.accentText || ''}
                      onChange={(e) => setTreatment((t) => ({ ...t, accentText: e.target.value }))}
                      placeholder="word(s) to highlight orange — e.g. 'isn't tight'"
                      className="flex-1 rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">Label</span>
                    <input
                      value={treatment.label || ''}
                      onChange={(e) => setTreatment((t) => ({ ...t, label: e.target.value }))}
                      placeholder="THE SCIENCE"
                      className="flex-1 rounded border border-border bg-background px-2 py-1 outline-none focus:ring-1 focus:ring-primary/40"
                    />
                  </div>
                  {String(treatment.templateId || '').includes('badge') && (
                    <div className="flex items-center gap-2">
                      <span className="w-14 shrink-0 text-muted-foreground">Badge</span>
                      <input
                        value={treatment.figure || ''}
                        onChange={(e) => setTreatment((t) => ({ ...t, figure: e.target.value }))}
                        placeholder="2"
                        className="w-12 rounded border border-border bg-background px-2 py-1 text-center outline-none focus:ring-1 focus:ring-primary/40"
                      />
                      <input
                        value={treatment.figureUnit || ''}
                        onChange={(e) => setTreatment((t) => ({ ...t, figureUnit: e.target.value }))}
                        placeholder="min"
                        className="w-16 rounded border border-border bg-background px-2 py-1 text-center outline-none focus:ring-1 focus:ring-primary/40"
                      />
                      <span className="text-3xs text-muted-foreground">the ring figure</span>
                    </div>
                  )}
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">Grade</span>
                    <input
                      type="range" min={0} max={100} value={treatment.grade}
                      onChange={(e) => setTreatment((t) => ({ ...t, grade: Number(e.target.value) }))}
                      className="flex-1 accent-primary"
                    />
                  </div>
                  <div className="flex items-center gap-2">
                    <span className="w-14 shrink-0 text-muted-foreground">Headline</span>
                    <div className="flex gap-1">
                      {[['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, label]) => (
                        <button
                          key={v}
                          type="button"
                          onClick={() => setTreatment((t) => ({ ...t, headlineSize: v }))}
                          className={`rounded border px-2 py-1 ${treatment.headlineSize === v ? 'border-primary bg-primary/10 text-primary' : 'border-border text-muted-foreground'}`}
                        >
                          {label}
                        </button>
                      ))}
                    </div>
                    <button
                      type="button"
                      disabled={composing}
                      onClick={() => compose()}
                      className="ml-auto flex items-center gap-1.5 rounded-lg bg-primary px-3 py-1.5 font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:opacity-50"
                    >
                      {composing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <ImageIcon className="h-3.5 w-3.5" />}
                      {composedUrl ? 'Re-bake' : 'Bake to image'}
                    </button>
                  </div>
                  <p className="text-3xs text-muted-foreground">
                    Smart crop + contrast-aware text. The baked image is exactly what publishes.
                  </p>
                  {targetEntry && (
                    <div className="mt-2 flex items-center gap-2 border-t pt-2">
                      <button
                        type="button"
                        onClick={() => setAdExportOpen(true)}
                        className="flex items-center gap-1.5 rounded-lg border border-action/40 bg-action/10 px-3 py-1.5 font-medium text-action transition-colors hover:bg-action/20"
                      >
                        <Megaphone className="h-3.5 w-3.5" /> Export for ads
                      </button>
                      <span className="text-3xs text-muted-foreground">
                        Re-render the baked headline into Meta/Google ad sizes.
                      </span>
                    </div>
                  )}
                </div>
              )}
            </div>
          </div>

          {/* Adjust by hand — collapsible */}
          <div className="overflow-hidden rounded-xl border bg-card">
            <button
              type="button"
              onClick={() => setManualOpen((o) => !o)}
              className="flex w-full items-center gap-2 px-4 py-2.5 text-left"
            >
              <Sliders className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Adjust by hand</span>
              <span className="text-2xs text-muted-foreground">· same knobs the AI turns</span>
              <ChevronDown
                className={`ml-auto h-4 w-4 text-muted-foreground transition-transform ${manualOpen ? 'rotate-180' : ''}`}
              />
            </button>
            {manualOpen && (
              <div className="space-y-2.5 border-t px-4 pb-3 pt-3 text-xs">
                {/* Media */}
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">Media</span>
                  <button
                    type="button"
                    onClick={() => setPickerOpen(true)}
                    className="flex items-center gap-1 rounded-lg border border-primary px-2.5 py-1 text-2xs font-medium text-primary hover:bg-primary/5"
                  >
                    <Repeat className="h-3 w-3" /> Change / swap
                  </button>
                </div>
                {/* Reframe — aspect ratio is a visual/social concept; hide for text-only output */}
                {!textOnly && (
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Reframe</span>
                    {['9:16', '4:5', '1:1'].map((ar) => (
                      <button
                        key={ar}
                        type="button"
                        onClick={() => setLook((l) => ({ ...l, ar }))}
                        className={`rounded-lg border px-2 py-1 text-2xs transition-colors ${
                          look.ar === ar ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary'
                        }`}
                      >
                        {ar}
                      </button>
                    ))}
                  </div>
                )}
                {/* Headline size */}
                <div className="flex items-center gap-2">
                  <span className="w-16 shrink-0 text-muted-foreground">Headline</span>
                  {[['sm', 'S'], ['md', 'M'], ['lg', 'L']].map(([s, lbl]) => (
                    <button
                      key={s}
                      type="button"
                      onClick={() => setLook((l) => ({ ...l, size: s }))}
                      className={`rounded-lg border px-2 py-1 text-2xs transition-colors ${
                        look.size === s ? 'border-primary bg-primary/10 text-primary' : 'hover:border-primary'
                      }`}
                    >
                      {lbl}
                    </button>
                  ))}
                </div>
                {/* Trim — video only */}
                {(platformKind === 'video' || primaryIsVideo) && (
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Trim</span>
                    <div className="relative h-6 flex-1 rounded bg-muted">
                      <div className="absolute inset-y-0 left-[10%] right-[35%] rounded border-x-2 border-primary bg-primary/30" />
                    </div>
                    <span className="text-3xs text-muted-foreground">:12</span>
                  </div>
                )}
                {/* Captions — burned-in lower-thirds are a video/social concept; hide for text-only output */}
                {!textOnly && (
                  <div className="flex items-center gap-2">
                    <span className="w-16 shrink-0 text-muted-foreground">Captions</span>
                    <label className="flex items-center gap-1.5 text-2xs">
                      <input
                        type="checkbox"
                        checked={look.captions}
                        onChange={(e) => setLook((l) => ({ ...l, captions: e.target.checked }))}
                        className="accent-primary"
                      />
                      burned in · lower-third
                    </label>
                  </div>
                )}
              </div>
            )}
          </div>

          {/* Media — attached + AI picks (all media management lives here, upper-right) */}
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-center gap-2 border-b px-4 py-2.5">
              <Images className="h-4 w-4 text-muted-foreground" />
              <span className="text-sm font-semibold">Media</span>
              <span className="text-2xs text-muted-foreground">· {media.length} attached</span>
              <div className="ml-auto flex items-center gap-1.5">
                <button
                  type="button"
                  onClick={() => setStudioOpen(true)}
                  className="flex items-center gap-1 rounded-lg border px-2.5 py-1 text-2xs font-medium hover:border-primary hover:text-primary"
                >
                  <Type className="h-3 w-3" /> {piece.text_card ? 'Edit text post' : 'Text post'}
                </button>
                <button
                  type="button"
                  onClick={() => setPickerOpen(true)}
                  className="flex items-center gap-1 rounded-lg border border-primary px-2.5 py-1 text-2xs font-medium text-primary hover:bg-primary/5"
                >
                  <Repeat className="h-3 w-3" /> Change / swap
                </button>
              </div>
            </div>
            <div className="space-y-3 px-4 py-3">
              {/* Attached thumbnails */}
              {hasMedia && (
                <div className="flex flex-wrap gap-1.5">
                  {media.map((m) => {
                    const isVid = m.type === 'video' || m.kind === 'video'
                    const thumb = m.thumbnailUrl || (!isVid ? m.url : null)
                    const key = mediaEntryKey(m)
                    return (
                      <div key={key} className="group relative h-12 w-12 shrink-0 overflow-hidden rounded border">
                        {thumb ? (
                          <img src={thumb} alt="" className="h-full w-full object-cover" />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                            {isVid ? <Play className="h-4 w-4" /> : <ImageIcon className="h-4 w-4" />}
                          </div>
                        )}
                        <button
                          type="button"
                          onClick={() => removeEntry(m)}
                          disabled={removingKey === key}
                          className="absolute inset-0 flex items-center justify-center bg-black/60 text-white opacity-0 transition-opacity group-hover:opacity-100 disabled:opacity-50"
                          title="Remove"
                          aria-label="Remove attached media"
                        >
                          <X className="h-3.5 w-3.5" />
                        </button>
                      </div>
                    )
                  })}
                </div>
              )}
              {/* AI picks header + kind toggle */}
              <div className="flex items-center gap-2">
                <span className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">AI picks</span>
                <span className="text-3xs text-muted-foreground">· re-ranked when your words change</span>
                {showKindToggle && (
                  <div className="ml-auto inline-flex rounded-md border p-0.5">
                    {KIND_TABS.map((t) => (
                      <button
                        key={t.key}
                        type="button"
                        onClick={() => setKind(t.key)}
                        className={`rounded px-2 py-0.5 text-3xs font-medium transition-colors ${
                          kind === t.key ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:text-foreground'
                        }`}
                      >
                        {t.label}
                      </button>
                    ))}
                  </div>
                )}
                {!showKindToggle && (
                  <span className="ml-auto inline-flex items-center gap-1 rounded-md border bg-muted/40 px-2 py-0.5 text-3xs text-muted-foreground">
                    {platformKind === 'video' ? <Video className="h-3 w-3" /> : <ImageIcon className="h-3 w-3" />}
                    {mediaKindLabel(platformKind)}
                  </span>
                )}
              </div>
              {/* Suggestions grid */}
              {suggLoading || kind === null ? (
                <CandidateGridSkeleton compact />
              ) : suggError ? (
                <p className="text-xs text-muted-foreground">
                  Couldn&apos;t load suggestions.{' '}
                  <button type="button" onClick={() => refetch()} className="text-primary hover:underline">Try again</button>
                </p>
              ) : shownClips.length === 0 ? (
                <div className="rounded-lg border bg-muted/20 py-6 text-center">
                  <ImagePlus className="mx-auto h-6 w-6 text-muted-foreground" />
                  {shotRes ? (
                    <>
                      <p className="mt-1.5 text-sm text-foreground">Nothing matched &ldquo;{shotQ}&rdquo;.</p>
                      <button
                        type="button"
                        onClick={clearShot}
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        Back to the AI picks
                      </button>
                    </>
                  ) : (
                    <>
                      <p className="mt-1.5 text-sm text-foreground">
                        No strong {kind === 'video' ? 'video' : kind === 'photo' ? 'photo' : ''} matches.
                      </p>
                      <button
                        type="button"
                        onClick={() => setPickerOpen(true)}
                        className="mt-1 text-xs text-primary hover:underline"
                      >
                        Browse the Library
                      </button>
                    </>
                  )}
                </div>
              ) : (
                <div className="grid grid-cols-3 gap-2">
                  {shownClips.slice(0, 6).map((clip) => (
                    <CandidateCard
                      key={clip.chunkId || clip.assetId}
                      clip={clip}
                      attached={attachedKeys.has(clip.assetId)}
                      attaching={attachingKey === clip.assetId}
                      onPreview={() => setPreviewClip(clip)}
                      onAttach={() => attachEntry(clipToMediaEntry(clip))}
                    />
                  ))}
                </div>
              )}
              {isFetching && !suggLoading && !shotRes && (
                <p className="text-2xs text-muted-foreground">Refreshing…</p>
              )}

              {/* Describe the shot — manual query into the same brain as the picks */}
              <div className="rounded-lg border bg-muted/30 p-2">
                {shotRes && (
                  <div className="mb-1.5 flex items-center gap-2 text-2xs text-muted-foreground">
                    <span>Showing matches for &ldquo;{shotQ}&rdquo;</span>
                    <button type="button" onClick={clearShot} className="text-primary hover:underline">
                      Back to AI picks
                    </button>
                  </div>
                )}
                <div className="flex items-center gap-2">
                  <input
                    type="text"
                    value={shotQ}
                    onChange={(e) => setShotQ(e.target.value)}
                    onKeyDown={(e) => { if (e.key === 'Enter') runShotSearch() }}
                    placeholder='Not it? Describe the shot — "her on the bike", "hands-on low back work"…'
                    className="flex-1 rounded-lg border bg-background px-3 py-2 text-xs outline-none focus:ring-1 focus:ring-primary/50"
                    disabled={shotLoading}
                  />
                  <button
                    type="button"
                    disabled={shotLoading || !shotQ.trim()}
                    onClick={runShotSearch}
                    className="flex items-center gap-1 rounded-lg bg-primary px-3 py-2 text-xs font-medium text-primary-foreground transition-colors hover:bg-primary/90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {shotLoading ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Search className="h-3.5 w-3.5" />}
                    Find it
                  </button>
                </div>
              </div>
            </div>
          </div>

          {/* Per-post schedule CTA */}
          <div className="rounded-xl border bg-card p-3">
            <div className="mb-2 flex items-center gap-1.5">
              <Calendar className="h-4 w-4 text-primary" />
              <span className="text-sm font-semibold">Schedule this post</span>
              <span className="ml-auto text-3xs text-muted-foreground">one at a time</span>
            </div>
            <div className="flex items-center gap-2">
              <Button
                className="flex-1"
                disabled={!hasMedia}
                title={hasMedia ? undefined : 'Attach media before scheduling'}
                onClick={() => navigate(`/publish/${piece.id}/schedule`)}
              >
                <Calendar className="mr-1.5 h-4 w-4" />
                Schedule this post
              </Button>
              {nextPieceId && (
                <Button
                  variant="outline"
                  size="sm"
                  onClick={() => navigate(`/publish/${nextPieceId}`)}
                  className="flex items-center gap-1"
                >
                  Next <ArrowRight className="h-3.5 w-3.5" />
                </Button>
              )}
            </div>
            <p className="mt-1.5 text-3xs text-muted-foreground">
              Each post gets its own look · no &ldquo;publish all&rdquo; unless you trust every one.
            </p>
          </div>
        </div>
      </div>

      <MediaPreviewDialog
        clip={previewClip}
        open={!!previewClip}
        onOpenChange={(o) => { if (!o) setPreviewClip(null) }}
        attached={previewClip ? attachedKeys.has(previewClip.assetId) : false}
        attaching={previewClip ? attachingKey === previewClip.assetId : false}
        onAttach={() => previewClip && attachEntry(clipToMediaEntry(previewClip))}
      />

      {pickerOpen && (
        <MediaPicker multi onClose={() => setPickerOpen(false)} onSelect={handlePicked} />
      )}

      {studioOpen && (
        <TextPostStudio
          pieceId={pieceId}
          initialState={piece.text_card || undefined}
          brandStyle={brandStyle}
          workspaceName={workspaceName}
          onClose={() => setStudioOpen(false)}
          onUse={async ({ state, url }) => {
            await updateItem.mutateAsync({
              id: pieceId,
              patch: { mediaUrls: [...media, { url, type: 'photo' }], textCard: state },
            })
            toast.success('Text post created & attached')
            setStudioOpen(false)
          }}
        />
      )}

      {adExportOpen && targetEntry && (
        <AdExportModal
          asset={{
            id: null,
            // Always export from the ORIGINAL photo of this entry, never a prior
            // composite — render-pack re-bakes the treatment itself per aspect.
            blob_url: targetEntry.sourceUrl || targetEntry.url || null,
            filename: `${treatment.headline || piece?.title || 'ad-creative'}.jpg`,
            display_title: treatment.headline || piece?.title || 'Ad creative',
          }}
          treatment={treatment}
          templateId={treatment.templateId}
          sourcePieceId={pieceId}
          onClose={() => setAdExportOpen(false)}
        />
      )}
    </div>
  )
}

// Compact skeleton grid shown while suggestions load.
function CandidateGridSkeleton({ compact = false }) {
  const count = compact ? 6 : 10
  const cols = compact
    ? 'grid grid-cols-3 gap-2'
    : 'grid grid-cols-2 gap-3 sm:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5'
  return (
    <div className={cols}>
      {Array.from({ length: count }).map((_, i) => (
        <div key={i} className="space-y-1.5">
          <div className="aspect-[4/3] animate-pulse rounded-lg bg-muted" />
          <div className="h-3 w-2/3 animate-pulse rounded bg-muted" />
        </div>
      ))}
    </div>
  )
}
