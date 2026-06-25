import { useEffect, useRef, useState } from 'react'
import { Link } from 'react-router-dom'
import { ArrowRight, MessageCircle, Send, Video } from 'lucide-react'
import { toast } from 'sonner'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorIconRail from '@/components/editor/IconRail'
import PostPreview from '@/components/PostPreview'
import BufferMetricsRow from '@/components/story-detail/BufferMetricsRow'
import WinnerToggle from '@/components/story-detail/WinnerToggle'
import { ApprovalPanel } from '@/components/story-detail/AssetsPane'
import { useUpdateContentItem } from '@/lib/queries'
import { resolveArchetype, ARCHETYPES } from '@/lib/editorArchetype'
import { PLATFORM_META } from '@/lib/contentMeta'

// UnifiedEditor — the single-shell editor body for every archetype that isn't a
// carousel (SlideEditor) or an Instagram Story (StoryComposer): the `visual`
// text/photo posts (LinkedIn, Facebook, Twitter…), `doc` (blog/landing),
// `email`, `textad` (Google ads) and `ad` creative. It replaces the legacy
// two-column "preview + ApprovalPanel" publish layout so these posts get the
// same full-bleed shell (EditorChrome + IconRail + centered canvas) as the
// carousel and reel editors.
//
// Phase 3b/4 of the unified-shell spec. The canvas reuses PostPreview (which
// already renders a per-channel card for every enabled platform after #1675),
// so the "new UI" is consistent everywhere without a per-archetype canvas.
//
// Rail (v1): Publish (default — keeps schedule/send at a glance, the loss the
// phase4-visual-channel-fold mockup flagged) + Words (caption editor). Media is
// attached upstream on Storyboard, so there is no media-attach control here.

const RAIL = [
  { key: 'publish', icon: Send, label: 'Publish' },
  { key: 'words', icon: MessageCircle, label: 'Words' },
]

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
        <EditorIconRail items={RAIL} active={tool} onPick={setTool} />

        {/* Inspector — single panel chosen by the rail */}
        <aside className="flex w-[340px] shrink-0 flex-col border-r bg-card overflow-hidden">
          {tool === 'words' ? (
            <WordsPanel piece={piece} updateItem={updateItem} />
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
