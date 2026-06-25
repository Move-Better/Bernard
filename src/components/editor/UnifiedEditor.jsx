import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { ArrowRight, Check, Crop, ImageIcon, Loader2, MessageCircle, Palette, Plus, Send, Type, Video, X } from 'lucide-react'
import { toast } from 'sonner'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorIconRail from '@/components/editor/IconRail'
import PostPreview from '@/components/PostPreview'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import OverlayTextEditor from '@/components/story-detail/OverlayTextEditor'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useUpdateContentItem, useMediaSuggestions, queryKeys } from '@/lib/queries'
import { apiFetch } from '@/lib/api'
import { clipToMediaEntry, mediaEntryKey, photoSourceUrl, isVideoEntry } from '@/lib/mediaEntry'
import { resolveArchetype, ARCHETYPES, railFor, mediaTierFor, MEDIA_TIER } from '@/lib/editorArchetype'
import { PLATFORM_META } from '@/lib/contentMeta'

// UnifiedEditor — the single-shell editor body for every archetype that isn't a
// carousel (SlideEditor) or an Instagram Story (StoryComposer): the `visual`
// text/photo posts (LinkedIn, Facebook, Twitter…), `doc` (blog/landing),
// `email`, `textad` (Google ads) and `ad` creative. It gives these posts the
// same full-bleed shell (EditorChrome + IconRail + centered canvas) as the
// carousel and reel editors — the "one editing backbone for every channel"
// from `.claude/mockups/unified-shell-all-channels.html`.
//
// The rail is driven by `railFor(piece)` (the archetype's section list), the
// same matrix the mockup uses. Only sections with a real working panel render —
// today: Words (caption), Media (attach/swap a photo), Text (on-image overlay).
// Grade (brand-template bake) is the next section to land. Publish is always
// present and is the DEFAULT so Schedule/Send stay at a glance.

const RAIL_META = {
  words: { icon: MessageCircle, label: 'Words' },
  media: { icon: ImageIcon, label: 'Media' },
  photo: { icon: ImageIcon, label: 'Media' },
  text: { icon: Type, label: 'Text' },
  grade: { icon: Palette, label: 'Grade' },
}

const ASPECTS = ['1:1', '4:5', '16:9']

// Does this post have at least one photo (non-video media entry with a source)?
const hasPhotoEntry = (media) =>
  Array.isArray(media) && media.some((m) => m && !isVideoEntry(m) && (m.url || m.sourceUrl || m.thumbnailUrl))

// Caption editor — mirrors SlideEditor's CaptionPanel (textarea + onBlur save).
function WordsPanel({ piece, updateItem }) {
  const [draft, setDraft] = useState(() => (typeof piece?.content === 'string' ? piece.content : ''))
  const savedRef = useRef(draft)

  useEffect(() => {
    const next = typeof piece?.content === 'string' ? piece.content : ''
    setDraft(next)
    savedRef.current = next
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

  async function handleBlur() {
    if (draft === savedRef.current) return
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { content: draft } })
      savedRef.current = draft
    } catch (e) {
      toast.error('Caption save failed', { description: e.message })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Caption</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-2 overflow-y-auto p-3">
        <textarea
          value={draft}
          onChange={(e) => setDraft(e.target.value)}
          onBlur={handleBlur}
          placeholder="Caption visible to followers…"
          className="min-h-[200px] flex-1 w-full resize-none rounded-md border bg-muted/40 px-2 py-1.5 text-xs leading-relaxed text-foreground placeholder:text-muted-foreground/50 focus:bg-background focus:border-primary focus:outline-none"
        />
        <p className="shrink-0 text-3xs text-muted-foreground/70">
          Saves when you click away. The live preview updates as you type.
        </p>
      </div>
    </div>
  )
}

// One suggestion thumbnail — modeled on SlideEditor's SuggestionThumb.
function SuggestionThumb({ clip, attached, attaching, onAttach }) {
  const thumb = clip.thumbnailUrl || clip.blobUrl || clip.url
  return (
    <button
      type="button"
      disabled={attaching}
      onClick={onAttach}
      title={attached ? 'Already in this post' : 'Use this photo'}
      className={`group relative aspect-square overflow-hidden rounded-md border transition-all ${
        attached ? 'border-primary' : 'border-border hover:border-primary'
      }`}
    >
      {thumb ? (
        <img src={thumb} alt="" className="h-full w-full object-cover" />
      ) : (
        <div className="flex h-full w-full items-center justify-center bg-muted">
          <ImageIcon className="h-4 w-4 text-muted-foreground" />
        </div>
      )}
      <span className="absolute left-1 top-1 rounded bg-primary px-1 text-3xs font-bold leading-tight text-primary-foreground">AI</span>
      <span
        className={`absolute inset-0 flex items-center justify-center bg-black/40 text-white transition-opacity ${
          attaching ? 'opacity-100' : 'opacity-0 group-hover:opacity-100'
        }`}
      >
        {attaching ? <Loader2 className="h-4 w-4 animate-spin" /> : attached ? <Check className="h-4 w-4" /> : <Plus className="h-4 w-4" />}
      </span>
    </button>
  )
}

// Media inspector — attach / swap / remove a photo on a single (non-carousel)
// post. Suggestions come from the same suggest-media brain the carousel and
// Storyboard use; attach goes through clipToMediaEntry so the stored entry has
// the correct {url,type,mediaAssetId,…} shape (never a raw clip → url:null).
function MediaPanel({ piece, updateItem, aspect, setAspect }) {
  const media = Array.isArray(piece.media_urls) ? piece.media_urls : []
  const optional = mediaTierFor(piece) === MEDIA_TIER.OPTIONAL
  const { data: sugg, isLoading } = useMediaSuggestions(piece.id, { kind: 'photo', k: 12 })
  const clips = sugg?.clips || []
  const [attaching, setAttaching] = useState(null)
  const attachedKeys = new Set(media.map(mediaEntryKey))

  async function attach(clip) {
    const entry = clipToMediaEntry(clip)
    if (attachedKeys.has(mediaEntryKey(entry))) return
    setAttaching(clip.assetId || clip.blobUrl || clip.url)
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { media_urls: [...media, entry] } })
    } catch (e) {
      toast.error('Could not attach media', { description: e.message })
    } finally {
      setAttaching(null)
    }
  }

  async function removeAt(idx) {
    const next = media.filter((_, i) => i !== idx)
    try {
      await updateItem.mutateAsync({ id: piece.id, patch: { media_urls: next } })
    } catch (e) {
      toast.error('Could not remove media', { description: e.message })
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
          Media{media.length > 0 ? ` · ${media.length}` : optional ? ' · optional' : ''}
        </span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3">
        {/* Currently attached */}
        {media.length > 0 ? (
          <div className="grid grid-cols-3 gap-2">
            {media.map((entry, idx) => {
              const url = photoSourceUrl(entry) || entry.thumbnailUrl
              return (
                <div key={mediaEntryKey(entry) || idx} className="group relative aspect-square overflow-hidden rounded-md border">
                  {url ? (
                    <img src={url} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <div className="flex h-full w-full items-center justify-center bg-muted">
                      <ImageIcon className="h-4 w-4 text-muted-foreground" />
                    </div>
                  )}
                  <button
                    type="button"
                    onClick={() => removeAt(idx)}
                    title="Remove"
                    className="absolute right-1 top-1 flex h-5 w-5 items-center justify-center rounded-full bg-black/60 text-white opacity-0 transition-opacity hover:bg-black/80 group-hover:opacity-100"
                  >
                    <X className="h-3 w-3" />
                  </button>
                </div>
              )
            })}
          </div>
        ) : (
          <div className="rounded-md border border-dashed border-primary/40 bg-primary/5 p-3 text-center">
            <p className="text-2xs font-semibold text-primary">+ Add a photo or video</p>
            {optional && (
              <p className="mt-1 text-3xs text-muted-foreground">Text-only is a valid post on this channel.</p>
            )}
          </div>
        )}

        {/* Reframe — output aspect (parity with the carousel's Photo reframe). */}
        {hasPhotoEntry(media) && setAspect && (
          <div>
            <p className="mb-1.5 flex items-center gap-1 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
              <Crop className="h-3 w-3" /> Reframe
            </p>
            <div className="flex overflow-hidden rounded-md border border-border">
              {ASPECTS.map((a) => (
                <button
                  key={a}
                  type="button"
                  onClick={() => setAspect(a)}
                  className={`flex-1 px-2 py-1 text-2xs font-medium transition-colors ${
                    aspect === a
                      ? 'bg-primary text-primary-foreground'
                      : 'text-muted-foreground hover:bg-muted hover:text-foreground'
                  }`}
                >
                  {a}
                </button>
              ))}
            </div>
            <p className="mt-1 text-3xs text-muted-foreground/70">Sets the crop used when you bake a brand look in Grade.</p>
          </div>
        )}

        {/* Suggestions */}
        <div>
          <p className="mb-1.5 text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
            Suggested for this post
          </p>
          {isLoading ? (
            <div className="flex items-center justify-center py-6 text-muted-foreground">
              <Loader2 className="h-4 w-4 animate-spin" />
            </div>
          ) : clips.length === 0 ? (
            <p className="py-4 text-center text-2xs text-muted-foreground">
              No photo suggestions yet — upload media in your Library to see picks here.
            </p>
          ) : (
            <div className="grid grid-cols-3 gap-2">
              {clips.slice(0, 12).map((clip) => {
                const entry = clipToMediaEntry(clip)
                const key = clip.chunkId || clip.assetId || clip.blobUrl || clip.url
                return (
                  <SuggestionThumb
                    key={key}
                    clip={clip}
                    attached={attachedKeys.has(mediaEntryKey(entry))}
                    attaching={attaching === (clip.assetId || clip.blobUrl || clip.url)}
                    onAttach={() => attach(clip)}
                  />
                )
              })}
            </div>
          )}
        </div>
      </div>
    </div>
  )
}

// On-image text inspector — the shared overlay-text editor (writes overlay_text
// + rewrites the body markers). Same component the Storyboard editor uses.
function TextPanel({ piece }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">On-image text</span>
      </div>
      <div className="min-h-0 flex-1 overflow-y-auto p-3">
        <OverlayTextEditor piece={piece} />
      </div>
    </div>
  )
}

const GRADE_TEMPLATES = [
  ['editorial', 'Editorial'],
  ['dark-claim', 'Dark claim'],
  ['light-claim', 'Light claim'],
  ['dark-badge', 'Dark badge'],
  ['light-badge', 'Light badge'],
  ['dark-split', 'Dark split'],
  ['light-split', 'Light split'],
]

// Grade inspector — the brand-look bake. Same server compositor the carousel and
// the old Storyboard editor use (`/api/editorial/compose-photo`): it bakes a
// brand treatment (template + headline + accent + grade + scrim) onto the photo
// and writes the composite back into media_urls (preview == publish). After a
// bake we invalidate the piece so the canvas re-renders the composite.
function GradePanel({ piece, aspect }) {
  const qc = useQueryClient()
  const media = Array.isArray(piece.media_urls) ? piece.media_urls : []
  const t0 = piece?.photo_treatment && typeof piece.photo_treatment === 'object' ? piece.photo_treatment : {}
  const [treatment, setTreatment] = useState(() => ({
    templateId: t0.templateId || 'editorial',
    headline: t0.headline || '',
    headlineSize: t0.headlineSize || 'm',
    grade: typeof t0.grade === 'number' ? t0.grade : 40,
    scrim: t0.scrim || 'navy',
    label: t0.label || '',
    accentText: t0.accentText || '',
    figure: t0.figure || '',
    figureUnit: t0.figureUnit || '',
  }))
  const [composing, setComposing] = useState(false)
  const composed = media.some((m) => m?.composed)
  const isBadge = String(treatment.templateId || '').includes('badge')

  async function compose(patch) {
    const next = { ...treatment, ...(patch || {}), aspect: aspect || '4:5' }
    if (!next.headline) {
      next.headline = String(piece?.content || '').split(/(?<=[.!?])\s/)[0]?.slice(0, 140) || ''
    }
    setTreatment(next)
    setComposing(true)
    try {
      const r = await apiFetch('/api/editorial/compose-photo', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ pieceId: piece.id, treatment: next, imageIndex: 0 }),
      })
      if (r?.url) {
        await qc.invalidateQueries({ queryKey: queryKeys.contentItems.detail(piece.id) })
        toast.success(composed ? 'Re-baked' : 'Baked to image')
      }
      return r
    } catch (e) {
      toast.error('Could not bake the image', { description: e?.message })
      return null
    } finally {
      setComposing(false)
    }
  }

  if (!hasPhotoEntry(media)) {
    return (
      <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
        <div className="shrink-0 border-b px-3 py-2">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Brand look</span>
        </div>
        <div className="flex flex-1 items-center justify-center p-5 text-center">
          <p className="text-2xs text-muted-foreground">
            Add a photo in the <span className="font-semibold text-foreground">Media</span> tab first — Grade bakes your
            brand headline + treatment onto it.
          </p>
        </div>
      </div>
    )
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
      <div className="shrink-0 border-b px-3 py-2">
        <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Brand look</span>
      </div>
      <div className="flex min-h-0 flex-1 flex-col gap-3 overflow-y-auto p-3 text-xs">
        {/* Template — selecting a non-badge template bakes immediately. */}
        <div>
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Template</span>
          <div className="mt-1 flex flex-wrap gap-1">
            {GRADE_TEMPLATES.map(([id, label]) => (
              <button
                key={id}
                type="button"
                disabled={composing}
                onClick={() => {
                  if (String(id).includes('badge')) setTreatment((t) => ({ ...t, templateId: id }))
                  else compose({ templateId: id })
                }}
                className={`rounded border px-2 py-1 text-2xs disabled:opacity-50 ${
                  (treatment.templateId || 'editorial') === id
                    ? 'border-primary bg-primary/10 text-primary'
                    : 'border-border text-muted-foreground hover:border-primary/40'
                }`}
              >
                {label}
              </button>
            ))}
          </div>
        </div>

        <label className="flex flex-col gap-1">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Headline</span>
          <textarea
            rows={2}
            value={treatment.headline}
            onChange={(e) => setTreatment((t) => ({ ...t, headline: e.target.value }))}
            placeholder="Defaults to your caption's first line…"
            className="resize-none rounded border border-border bg-background px-2 py-1.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Highlight word(s)</span>
          <input
            value={treatment.accentText}
            onChange={(e) => setTreatment((t) => ({ ...t, accentText: e.target.value }))}
            placeholder="word(s) to accent — e.g. “isn't tight”"
            className="rounded border border-border bg-background px-2 py-1.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </label>

        <label className="flex flex-col gap-1">
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Label (optional)</span>
          <input
            value={treatment.label}
            onChange={(e) => setTreatment((t) => ({ ...t, label: e.target.value }))}
            placeholder="THE SCIENCE"
            className="rounded border border-border bg-background px-2 py-1.5 outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
          />
        </label>

        {isBadge && (
          <div className="flex items-center gap-2">
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Badge</span>
            <input
              value={treatment.figure}
              onChange={(e) => setTreatment((t) => ({ ...t, figure: e.target.value }))}
              placeholder="2"
              className="w-12 rounded border border-border bg-background px-2 py-1 text-center outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
            <input
              value={treatment.figureUnit}
              onChange={(e) => setTreatment((t) => ({ ...t, figureUnit: e.target.value }))}
              placeholder="min"
              className="w-16 rounded border border-border bg-background px-2 py-1 text-center outline-none focus:border-primary focus:ring-1 focus:ring-primary/40"
            />
          </div>
        )}

        <div>
          <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Light &amp; color</span>
          <input
            type="range"
            min={0}
            max={100}
            value={treatment.grade}
            onChange={(e) => setTreatment((t) => ({ ...t, grade: Number(e.target.value) }))}
            className="mt-1 w-full accent-primary"
          />
        </div>

        <div className="flex items-center gap-3">
          <div className="flex flex-col gap-1">
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Scrim</span>
            <div className="flex overflow-hidden rounded-md border border-border">
              {[['navy', 'Navy'], ['brand', 'Brand']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTreatment((t) => ({ ...t, scrim: v }))}
                  className={`px-2 py-1 text-2xs font-medium ${
                    treatment.scrim === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
          <div className="flex flex-col gap-1">
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">Headline size</span>
            <div className="flex overflow-hidden rounded-md border border-border">
              {[['s', 'S'], ['m', 'M'], ['l', 'L']].map(([v, label]) => (
                <button
                  key={v}
                  type="button"
                  onClick={() => setTreatment((t) => ({ ...t, headlineSize: v }))}
                  className={`px-2.5 py-1 text-2xs font-medium ${
                    treatment.headlineSize === v ? 'bg-primary text-primary-foreground' : 'text-muted-foreground hover:bg-muted'
                  }`}
                >
                  {label}
                </button>
              ))}
            </div>
          </div>
        </div>

        <button
          type="button"
          disabled={composing}
          onClick={() => compose()}
          className="mt-1 flex items-center justify-center gap-1.5 rounded-lg bg-action px-3 py-2 text-xs font-semibold text-action-foreground transition-colors hover:bg-action/90 disabled:opacity-50"
        >
          {composing ? <Loader2 className="h-3.5 w-3.5 animate-spin" /> : <Palette className="h-3.5 w-3.5" />}
          {composed ? 'Re-bake to image' : 'Bake to image'}
        </button>
        <p className="text-3xs text-muted-foreground/70">
          Bakes server-side at the {aspect || '4:5'} crop — the baked image is exactly what publishes.
        </p>
      </div>
    </div>
  )
}

// Publish inspector — the full ApprovalPanel toolkit plus the "Next up" loop that
// flows the producer back into the queue after publishing one piece.
function PublishPanel({ piece, remainingNeedsMedia = [], isReel }) {
  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-3 space-y-4">
      {isReel && (
        <div className="flex items-start gap-2 rounded-lg border bg-muted/30 p-3 text-xs text-muted-foreground">
          <Video className="mt-0.5 h-4 w-4 shrink-0 text-muted-foreground" />
          <p>
            <span className="font-medium text-foreground">This posts as a Reel.</span> A video publishes on
            its own — any on-screen text is baked into the clip itself.
          </p>
        </div>
      )}
      <ApprovalPanel piece={piece} mode="publish" />
      {remainingNeedsMedia.length > 0 && (
        <Link
          to="/publish"
          className="group block rounded-lg border border-primary/20 bg-accent/20 p-3 transition-colors hover:border-primary/40"
        >
          <p className="mb-1 text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Next up</p>
          <span className="flex items-center justify-between gap-2">
            <span className="text-sm text-foreground">
              <b className="font-medium">
                {remainingNeedsMedia.length} more draft{remainingNeedsMedia.length === 1 ? '' : 's'}
              </b>{' '}
              need media
            </span>
            <span className="inline-flex shrink-0 items-center gap-1 text-xs font-medium text-primary">
              Publish <ArrowRight className="h-3.5 w-3.5" />
            </span>
          </span>
        </Link>
      )}
      {piece.status === 'published' && piece.buffer_update_id && <BufferMetricsRow contentItemId={piece.id} />}
      {piece.status === 'published' && <WinnerToggle piece={piece} />}
    </div>
  )
}

export default function UnifiedEditor({ piece, onBack, formatLabel, formatSub, photoCount, remainingNeedsMedia = [] }) {
  // Default to the Publish panel so Schedule/Send stay visible the moment the
  // editor opens — addressing the "schedule hides behind a button" regression
  // the decision mockup called out for caption-only posts.
  const [tool, setTool] = useState('publish')
  const updateItem = useUpdateContentItem()

  const archetype = resolveArchetype(piece)
  const cfg = ARCHETYPES[archetype] || ARCHETYPES.visual
  // Output aspect for the photo bake (the carousel's "reframe"). Seeded from a
  // prior bake's treatment, else the archetype default.
  const [aspect, setAspect] = useState(() => piece?.photo_treatment?.aspect || cfg.aspect || '1:1')
  const aspectOptions = Array.isArray(cfg.aspects) && cfg.aspects.length ? cfg.aspects : ASPECTS
  const meta = PLATFORM_META[piece.platform] || { label: piece.platform || '—', icon: undefined }
  const isReel = piece.platform === 'instagram' && archetype === 'vvideo'
  const count = Number.isFinite(photoCount) ? photoCount : null
  const noMedia = mediaTierFor(piece) === MEDIA_TIER.NONE

  // Rail = Publish (always) + the archetype's sections that have a real panel.
  // Drop Media for media-none channels (Google text ads). De-dupe so carousel's
  // 'photo' alias doesn't double up with 'media'.
  const seen = new Set()
  const railKeys = railFor(piece).filter((k) => {
    if (!RAIL_META[k]) return false
    if ((k === 'media' || k === 'photo') && noMedia) return false
    const label = RAIL_META[k].label
    if (seen.has(label)) return false
    seen.add(label)
    return true
  })
  const railItems = [
    { key: 'publish', icon: Send, label: 'Publish' },
    ...railKeys.map((k) => ({ key: k, icon: RAIL_META[k].icon, label: RAIL_META[k].label })),
  ]
  const activeKey = railItems.some((r) => r.key === tool) ? tool : 'publish'

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {/* ── TOP BAR — shared EditorChrome (unified shell) ─────────────────── */}
      <EditorChrome
        onBack={onBack}
        title={piece?.topic || 'Untitled draft'}
        badge={{ icon: meta.icon, label: formatLabel || meta.label, sub: formatSub || cfg.label }}
        note={count != null ? (count === 0 ? 'no media' : `${count} ${count === 1 ? 'item' : 'items'}`) : null}
        aspect={!noMedia && cfg.canvas === 'visual' ? { value: aspect, options: aspectOptions, onChange: setAspect } : null}
      />

      {/* ── WORK AREA: rail | inspector | canvas ─────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <EditorIconRail items={railItems} active={activeKey} onPick={setTool} />

        {/* Inspector — single panel chosen by the rail */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r bg-card overflow-hidden">
          {activeKey === 'words' ? (
            <WordsPanel piece={piece} updateItem={updateItem} />
          ) : activeKey === 'media' || activeKey === 'photo' ? (
            <MediaPanel piece={piece} updateItem={updateItem} aspect={aspect} setAspect={setAspect} />
          ) : activeKey === 'text' ? (
            <TextPanel piece={piece} />
          ) : activeKey === 'grade' ? (
            <GradePanel piece={piece} aspect={aspect} />
          ) : (
            <PublishPanel piece={piece} remainingNeedsMedia={remainingNeedsMedia} isReel={isReel} />
          )}
        </aside>

        {/* Canvas — centered live preview (the per-channel PostPreview card) */}
        <div className="flex min-h-0 flex-1 items-start justify-center overflow-y-auto bg-muted/20 p-6">
          <div className="w-full max-w-[440px]">
            <PostPreview
              platform={piece.platform}
              content={typeof piece.content === 'string' ? piece.content : JSON.stringify(piece.content)}
              mediaUrls={Array.isArray(piece.media_urls) ? piece.media_urls : []}
              slides={Array.isArray(piece.slides) ? piece.slides : null}
              overlayText={piece.overlay_text || null}
              locationOverrides={piece.location_overrides || null}
              photoTemplateId={piece.photo_template_id || null}
            />
          </div>
        </div>
      </div>
    </div>
  )
}
