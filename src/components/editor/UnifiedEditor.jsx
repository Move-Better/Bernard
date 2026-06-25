import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, Check, ImageIcon, Loader2, MessageCircle, Plus, Send, Type, Video, X } from 'lucide-react'
import { toast } from 'sonner'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorIconRail from '@/components/editor/IconRail'
import PostPreview from '@/components/PostPreview'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import OverlayTextEditor from '@/components/story-detail/OverlayTextEditor'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useUpdateContentItem, useMediaSuggestions } from '@/lib/queries'
import { clipToMediaEntry, mediaEntryKey, photoSourceUrl } from '@/lib/mediaEntry'
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
}

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
function MediaPanel({ piece, updateItem }) {
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
      />

      {/* ── WORK AREA: rail | inspector | canvas ─────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        <EditorIconRail items={railItems} active={activeKey} onPick={setTool} />

        {/* Inspector — single panel chosen by the rail */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r bg-card overflow-hidden">
          {activeKey === 'words' ? (
            <WordsPanel piece={piece} updateItem={updateItem} />
          ) : activeKey === 'media' || activeKey === 'photo' ? (
            <MediaPanel piece={piece} updateItem={updateItem} />
          ) : activeKey === 'text' ? (
            <TextPanel piece={piece} />
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
