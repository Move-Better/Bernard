import { useEffect, useMemo, useRef, useState } from 'react'
import { useSmartBack } from '@/lib/useSmartBack'
import { toast } from 'sonner'
import { Image as ImageIcon, Layers, Megaphone, Smartphone, SlidersHorizontal, Instagram, Type, ChevronLeft, ChevronRight, MessageCircle, History, BadgeCheck } from 'lucide-react'
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog'
import { useUpdateContentItem, usePhotoTemplates, useMediaSuggestions } from '@/lib/queries'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { resolveTheme, DEFAULT_DECK_THEME } from '@/lib/photoTemplates'
import { normalizeGrade, isNeutralGrade } from '@/lib/gradeParams'
import { ensureRenderedSlides } from '@/lib/renderSlides'
import { photoSourceUrl, clipToMediaEntry, mediaEntryKey } from '@/lib/mediaEntry'
import { brandStyleForRender } from '@/lib/brandSwatches'
import { deriveStory } from '@/lib/storyFields'
import AdCarouselExportModal from '@/components/AdCarouselExportModal'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorWorkflowBar from '@/components/editor/EditorWorkflowBar'
import EditorIconRail from '@/components/editor/IconRail'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import SaveStatus from '@/components/editor/SaveStatus'
import { listRevisions, saveRevision } from '@/lib/editorRevisions'
import UndoRedoButtons from '@/components/editor/UndoRedoButtons'
import { useAutosave } from '@/lib/useAutosave'
import { useUndoHistory } from '@/lib/useUndoHistory'
import { useUndoRedoShortcut } from '@/lib/useUndoRedoShortcut'
import {
  ROLE_META,
  normalizeSlide,
  defaultPositionFor,
  emptyBlockFor,
  ASPECT_STAGE,
} from './slide-editor/shared'
import RealQuotesSection from './slide-editor/RealQuotesSection'
import ObjectInspector from './slide-editor/ObjectInspector'
import SlideInspector from './slide-editor/SlideInspector'
import PhotoInspector from './slide-editor/PhotoInspector'
import TextInspector from './slide-editor/TextInspector'
import SlidePreview from './slide-editor/SlidePreview'
import TextDragLayer from './slide-editor/TextDragLayer'
import ObjectDragLayer from './slide-editor/ObjectDragLayer'
import CaptionPanel from './slide-editor/CaptionPanel'
import SlidePickerStrip from './slide-editor/SlidePickerStrip'
import FullPreviewOverlay from './slide-editor/FullPreviewOverlay'

// ── Top-level SlideEditor ─────────────────────────────────────────────────────

export default function SlideEditor({ piece, onBack, formatLabel, formatSub, photoCount, scheduleNode, singleSlide = false, badgeIcon = null, forcedAspect = null }) {
  const workspace = useWorkspace()
  const smartBack = useSmartBack('/publish')
  // heroAccent reconciled to the server compositor's chain so the client slide
  // bake (preview + publish + ad export) matches the server bake for the same
  // template. Flows to SlidePreview, FullPreviewOverlay, ensureRenderedSlides
  // and AdCarouselExportModal below.
  const brandStyle = brandStyleForRender(workspace)
  const pieceMediaUrls = piece?.media_urls
  const mediaUrls = (pieceMediaUrls || []).filter((m) => m && m.type !== 'video' && m.url)
  const hasMedia = mediaUrls.length > 0
  // Keys of every already-attached entry (photo or video) — so the swap/add
  // picks can mark which suggestions are already on the piece.
  const attachedKeys = useMemo(
    () => new Set((pieceMediaUrls || []).map(mediaEntryKey)),
    [pieceMediaUrls],
  )
  const [scheduleOpen, setScheduleOpen] = useState(false)
  // Drag-reveal guides: while a text block is being dragged we show the safe-zone
  // margins + centre snap lines (no more "safe zones" checkbox). `snap` tracks
  // which centre axis the block is currently snapped to.
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState({ x: null, y: null })
  const [guidesOn, setGuidesOn] = useState(false)
  const guidesTimerRef = useRef(null)
  function flashGuides() {
    if (guidesTimerRef.current) clearTimeout(guidesTimerRef.current)
    setGuidesOn(true)
    guidesTimerRef.current = setTimeout(() => setGuidesOn(false), 800)
  }
  // Clear the flash timer on unmount so it can't fire setGuidesOn after teardown.
  useEffect(() => () => { if (guidesTimerRef.current) clearTimeout(guidesTimerRef.current) }, [])

  // Seed: stored slides if any, else one empty cover slide bound to photo 0.
  // Instagram Story rows predate the slide model — their headline/sticker text
  // lived in content/text_card (see storyFields.js). A Story with no `slides`
  // yet gets that legacy text migrated into a hook/cta block pair on first
  // open, using the 'cta' template (headline top, CTA bottom) so it doesn't
  // silently vanish when the piece opens in this editor for the first time.
  function seedSlides() {
    const stored = Array.isArray(piece?.slides) ? piece.slides : null
    if (stored && stored.length > 0) return stored.map((s, i) => normalizeSlide(s, i))
    if (piece?.platform === 'instagram_story') {
      const { overlay, sticker } = deriveStory(piece)
      const blocks = []
      if (overlay) blocks.push({ role: 'hook', text: overlay, position: defaultPositionFor('cta', 'hook') })
      if (sticker) blocks.push({ role: 'cta', text: sticker, position: defaultPositionFor('cta', 'cta') })
      return [{ photo_idx: hasMedia ? 0 : null, template: 'cta', blocks }]
    }
    return [{ photo_idx: hasMedia ? 0 : null, template: 'cover', blocks: [] }]
  }

  const [slides, setSlides] = useState(seedSlides)
  const [themeId, setThemeId] = useState(() => piece?.photo_template_id || DEFAULT_DECK_THEME)
  const [aspect, setAspect] = useState(() => forcedAspect || piece?.aspect_ratio || '4:5')
  const [activeSlideIdx, setActiveSlideIdx] = useState(0)
  const [fullPreviewOpen, setFullPreviewOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  // Contextual selection driving the canvas (photo ring + text-block drag). One of:
  //   { type: null } | { type: 'slide' } | { type: 'photo' } | { type: 'text', idx }
  const [selection, setSelection] = useState({ type: null })
  // Which text block is being edited inline on the canvas (double-click). The
  // canvas skips this block's text while editing so the inline editor doesn't
  // double up with the baked render. Reset when the active slide changes.
  const [editingBlockIdx, setEditingBlockIdx] = useState(null)
  useEffect(() => { setEditingBlockIdx(null) }, [activeSlideIdx])
  // Unified-shell rail tool — which single inspector panel is shown. Orthogonal
  // to `selection` (which drives the canvas), but picking a tool syncs an
  // appropriate selection so the canvas highlight follows the rail.
  //   'words' | 'slide' | 'photo' | 'text'
  const [tool, setTool] = useState('slide')
  const pickTool = (t) => {
    setTool(t)
    if (t === 'photo') setSelection({ type: 'photo' })
    else if (t === 'text') setSelection((s) => (s.type === 'text' ? s : { type: 'text', idx: 0 }))
    else if (t === 'object') setSelection((s) => (s.type === 'object' ? s : { type: 'object', idx: 0 }))
    else setSelection({ type: null })
  }
  // Workspace logo for the objects layer — same resolver PostPreview uses
  // (primary_logo_url is derived by /api/workspace/me from brand_kit_roles).
  const workspaceLogo = workspace?.primary_logo_url ?? workspace?.logo?.main ?? null

  // Re-seed ONLY on a genuine piece switch (piece?.id changing) — not on every
  // `piece.slides` change. StoryboardPublish already gates rendering until
  // `piece` is loaded, so slides are never "still loading" here; once mounted,
  // local `slides` state is authoritative and autosave is what pushes it to
  // the server. Depending on `JSON.stringify(piece?.slides)` used to re-fire
  // this effect every time OUR OWN save echoed back through the query cache
  // (`useUpdateContentItem`'s onSuccess writes the saved row straight into
  // the detail query) — a delete-then-undo inside that echo's round-trip got
  // silently clobbered back to the deleted state, because the reseed fired
  // between the undo's local setSlides and the undo's own (later) autosave.
  // seedSlides()/photo_template_id/aspect_ratio still read the LATEST `piece`
  // via closure when the effect runs; they just don't need to be dependencies.
  useEffect(() => {
    const next = seedSlides()
    setSlides(next)
    setThemeId(piece?.photo_template_id || DEFAULT_DECK_THEME)
    setAspect(forcedAspect || piece?.aspect_ratio || '4:5')
    setActiveSlideIdx(0)
    setSelection({ type: null })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [piece?.id])

  // Fetch workspace custom templates for the picker
  const { data: allThemes = [] } = usePhotoTemplates()
  const customThemes = allThemes.filter((t) => t.custom)
  const theme = resolveTheme(themeId, customThemes)

  const updateItem = useUpdateContentItem()

  // Auto-attach top AI pick per slide on first open when slides have no photos.
  // A ref guards against re-firing; only fires when ALL slides are photo-less (fresh carousel).
  const autoAttachDoneRef = useRef(false)
  // k:10 covers Instagram's max carousel length (10 slides) so there are
  // enough distinct picks to avoid repeating a photo across slides.
  const { data: photoSuggestions } = useMediaSuggestions(piece?.id, { enabled: !!piece?.id, kind: 'photo', k: 10 })
  useEffect(() => {
    if (autoAttachDoneRef.current) return
    // useMediaSuggestions returns the raw suggest-media response — { clips: [...] },
    // NOT a bare array. (The Swap-photo panel reads `sugg.clips` correctly; this
    // effect previously read `photoSuggestions.length`/`[i]`, so the guard always
    // bailed and the auto-attach silently never ran — "5 slides from 0 photos".)
    // Each clip is a SUGGESTION shape ({ blobUrl, assetId, kind, … }), NOT a
    // media_urls entry — it must go through clipToMediaEntry (same as the Swap
    // panel's `attach(clipToMediaEntry(clip))`) or the stored entry has url:null
    // and mediaEntryKey (which reads mediaAssetId) can't dedup or bind it.
    const picks = (Array.isArray(photoSuggestions?.clips) ? photoSuggestions.clips : [])
      .map(clipToMediaEntry)
      .filter((e) => e && e.url && e.type !== 'video')
    if (!picks.length) return
    const allEmpty = mediaUrls.length === 0
    if (!allEmpty) { autoAttachDoneRef.current = true; return }
    autoAttachDoneRef.current = true
    const raw = Array.isArray(piece?.media_urls) ? piece.media_urls : []
    const seen = new Set(raw.map(mediaEntryKey))
    const toAdd = []
    // Straight index, NOT modulo — wrapping back into `picks` once slides
    // outnumber distinct suggestions was reusing the same photo across
    // multiple slides in one carousel. Better to leave a trailing slide
    // photo-less (the producer picks manually) than to duplicate a shot.
    for (let i = 0; i < slides.length; i++) {
      const pick = picks[i]
      if (!pick) break
      const key = mediaEntryKey(pick)
      if (!seen.has(key)) { toAdd.push(pick); seen.add(key) }
    }
    const nextRaw = [...raw, ...toAdd]
    const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
    const newSlides = slides.map((s, i) => {
      const pick = picks[i]
      if (!pick) return s
      const idx = photoOnly.findIndex((m) => mediaEntryKey(m) === mediaEntryKey(pick))
      return idx >= 0 ? { ...s, photo_idx: idx } : s
    })
    setSlides(newSlides)
    if (toAdd.length > 0) {
      // Persist BOTH the new media_urls AND the per-slide photo_idx binding in one
      // patch. media_urls alone (the previous behavior) survives reload but the
      // binding lived only in local state until the next autosave — so a reload
      // before that tick showed "N photos" attached but unbound (auto-attach won't
      // re-fire once media is non-empty). Saving the binding here makes the
      // auto-populate durable immediately. No bake: the slide images bake on
      // the next autosave, and publish has its own render fallback (same as
      // the render-failed path).
      updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw, slides: newSlides } }).catch(() => {})
    }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [photoSuggestions])

  const [rendering, setRendering] = useState(false)

  function updateSlide(idx, next) {
    const out = slides.slice()
    out[idx] = next
    setSlides(out)
  }
  function moveSlide(idx, dir) {
    const swap = idx + dir
    if (swap < 0 || swap >= slides.length) return
    const out = slides.slice()
    ;[out[idx], out[swap]] = [out[swap], out[idx]]
    setSlides(out)
  }
  function removeSlide(idx) {
    if (slides.length <= 1) {
      toast('A post needs at least one slide')
      return
    }
    const removed = slides[idx]
    const next = slides.filter((_, i) => i !== idx)
    setSlides(next)
    setActiveSlideIdx((prev) => Math.min(prev, Math.max(0, next.length - 1)))
    setSelection({ type: null })
    // Delete is recoverable until the next action — an undo toast instead of a
    // silent, instant, soon-permanent removal of the slide's block text.
    toast('Slide deleted', {
      action: {
        label: 'Undo',
        onClick: () => setSlides((cur) => {
          const out = cur.slice()
          out.splice(Math.min(idx, out.length), 0, removed)
          return out
        }),
      },
    })
  }
  function addSlide() {
    // New slide starts BLANK — pick a photo onto it (per-slide model). No more
    // auto-binding the next pool photo; select the Photo layer so the "Add a
    // photo" picker is front-and-centre immediately.
    const next = slides.concat([{ photo_idx: null, template: 'custom', blocks: [] }])
    setSlides(next)
    setActiveSlideIdx(next.length - 1)
    setSelection({ type: 'photo' })
  }

  // Attach a NEW photo to the piece (media_urls belongs to the content_item, not
  // the slides) and rebind the ACTIVE slide to it. media_urls is the content_item
  // field — mutate it via useUpdateContentItem, NOT the slides Save. After the
  // attach, recompute the new photo's index in the PHOTO-ONLY filtered list
  // (`photo_idx` indexes that filtered list, not raw media_urls) and bind it.
  async function attachPhoto(entry) {
    if (!entry || !piece?.id) return
    const raw = Array.isArray(piece?.media_urls) ? piece.media_urls : []
    const key = mediaEntryKey(entry)
    const already = raw.some((m) => mediaEntryKey(m) === key)
    // Single-slide posts (GBP, LinkedIn, Facebook, X, …) support exactly one
    // photo — replace media_urls outright instead of appending, or every swap
    // leaves the previous photo orphaned in the array (no slide references it,
    // but it's still there). GBP's Local Post API hard-rejects >1 media item
    // at publish time (400) — 3 accumulated swaps → 3 media_urls → publish
    // failure. Multi-slide carousels keep the append/reuse behavior.
    const nextRaw = singleSlide ? [entry] : (already ? raw : [...raw, entry])
    const noop = singleSlide ? (raw.length === 1 && already) : already
    try {
      if (!noop) {
        await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: nextRaw } })
      }
      // Index in the photo-only filtered list (videos excluded) — the same filter
      // the editor uses for `mediaUrls`/`photo_idx` everywhere.
      const photoOnly = nextRaw.filter((m) => m && m.type !== 'video' && m.url)
      const photoIdx = photoOnly.findIndex((m) => mediaEntryKey(m) === key)
      if (photoIdx >= 0) {
        setSlides((cur) => cur.map((s, i) => (i === activeSlideIdx ? { ...s, photo_idx: photoIdx } : s)))
      }
      if (singleSlide && !already && raw.length > 0) {
        toast.success('Photo replaced', { description: 'This platform supports one photo — the previous photo was removed.' })
      } else {
        toast.success(already ? 'Photo swapped' : 'Photo attached')
      }
    } catch (e) {
      toast.error('Could not attach photo', { description: e?.message })
    }
  }

  // Switch the active slide and close all accordion rows.
  function goToSlide(idx) {
    setActiveSlideIdx(idx)
    setSelection({ type: null })
  }

  // "Apply this theme to all slides" — set the deck theme to the chosen one and
  // clear every per-slide override so the whole deck reads uniformly again.
  function handleApplyThemeToAll(themeIdToApply) {
    const id = themeIdToApply || DEFAULT_DECK_THEME
    setThemeId(id)
    setSlides((prev) => prev.map((s) => (s.template_id ? { ...s, template_id: null } : s)))
    toast.success('Theme applied to all slides')
  }

  function handleUseAsHook(text) {
    const slide0 = slides[0]
    if (!slide0) return
    const hookIdx = slide0.blocks.findIndex((b) => b.role === 'hook')
    let newBlocks
    if (hookIdx >= 0) {
      newBlocks = slide0.blocks.map((b, i) => (i === hookIdx ? { ...b, text } : b))
    } else {
      newBlocks = [{ role: 'hook', text, position: defaultPositionFor(slide0.template, 'hook') }, ...slide0.blocks]
    }
    const out = slides.slice()
    out[0] = { ...slide0, blocks: newBlocks }
    setSlides(out)
    setActiveSlideIdx(0)
    setSelection({ type: 'text', idx: hookIdx >= 0 ? hookIdx : 0 })
    toast.success('Hook updated — Save to bake')
  }

  // Draft snapshot shared by autosave + undo/redo — the wholesale-restorable
  // shape of "what this editor persists" (slide content, theme, aspect).
  const draftState = useMemo(() => ({ slides, themeId, aspect }), [slides, themeId, aspect])

  // Autosave — bakes each slide (photo + on-screen text) into an image and
  // uploads it, so the overlay actually ships at publish, then persists the
  // slide/theme/aspect patch. Debounced by useAutosave; retries automatically
  // on the next edit if the render step fails (text is saved either way).
  async function saveDraft(next) {
    const cleaned = next.slides.map((s) => ({
      photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
      template:  s.template,
      // Preserve the per-slide theme override. Without this it was silently
      // dropped on save — the picker set slide.template_id, the resolver and the
      // bake honored it, but this rebuilt slides without it, so a per-slide
      // theme never persisted. (P0 data-loss fix.)
      template_id: s.template_id || null,
      // Persist the photo reframe (pan/zoom) so it survives reload and ships in
      // the bake. Omit when neutral to keep rows lean + legacy slides identical.
      ...(s.photo_zoom > 1 ? { photo_zoom: s.photo_zoom } : {}),
      ...(s.photo_offset && (s.photo_offset.x || s.photo_offset.y)
        ? { photo_offset: { x: s.photo_offset.x || 0, y: s.photo_offset.y || 0 } }
        : {}),
      // Persist the colorist grade; omit when neutral so legacy slides stay lean.
      ...(s.grade && !isNeutralGrade(s.grade) ? { grade: normalizeGrade(s.grade) } : {}),
      blocks:    s.blocks.filter((b) => (b.text || '').trim() !== ''),
    }))

    let toPersist = cleaned
    let renderFailed = false
    setRendering(true)
    try {
      const { slides: rendered } = await ensureRenderedSlides({
        slides:    cleaned,
        mediaUrls: piece?.media_urls,
        brandStyle,
        theme:     resolveTheme(next.themeId, customThemes),
        themeId:   next.themeId,
        customThemes,
        pieceId:   piece.id,
        aspect:    next.aspect,
      })
      toPersist = rendered
    } catch (e) {
      // Never lose the user's text on a render/upload hiccup — persist the slide
      // data anyway. Publish has its own render fallback, and the next autosave retries.
      renderFailed = true
      console.warn('[SlideEditor] slide render failed, saving text only', e.message)
    } finally {
      setRendering(false)
    }

    await updateItem.mutateAsync({
      id: piece.id,
      patch: { slides: toPersist, photo_template_id: next.themeId || null, aspectRatio: next.aspect },
    })
    if (renderFailed) {
      toast.error('Saved, but slide images need a retry', { description: 'Text is safe — the next autosave will retry baking the on-screen text into the images.' })
    }
  }

  const { status: saveStatus } = useAutosave(draftState, saveDraft, { debounceMs: 1500, resetKey: piece?.id })
  const { undo, redo, canUndo, canRedo } = useUndoHistory(draftState, (snap) => {
    setSlides(snap.slides)
    setThemeId(snap.themeId)
    setAspect(snap.aspect)
  })
  useUndoRedoShortcut(undo, redo)

  // Version history (WS5) — auto-snapshot the slide draft (throttled ~3 min,
  // pruned to 30 server-side) + restore a past version.
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState([])
  const lastRevRef = useRef(0)
  function applyDoc(d) {
    if (!d || typeof d !== 'object') return
    if (Array.isArray(d.slides)) setSlides(d.slides)
    if (d.themeId !== undefined) setThemeId(d.themeId)
    if (d.aspect) setAspect(d.aspect)
  }
  useEffect(() => {
    if (!piece?.id) return
    const now = Date.now()
    if (now - lastRevRef.current < 180000) return
    lastRevRef.current = now
    saveRevision('slides', piece.id, draftState).catch(() => {})
  }, [draftState, piece?.id])
  async function openHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    try { const r = await listRevisions('slides', piece.id); setRevisions(r?.revisions || []) } catch { setRevisions([]) }
    setHistoryOpen(true)
  }

  // Magic Resize (WS2): switching aspect pulls any hand-placed text back into the
  // new format's safe zone so it never lands in the crop. Idempotent (clamps into
  // a margin) so switching back and forth is stable; preset-positioned blocks
  // already resolve per-aspect in the renderer, so only custom {x,y} blocks move.
  function reflowForAspect(sl) {
    return (sl || []).map((s) => ({
      ...s,
      blocks: (s.blocks || []).map((b) => {
        const p = b.position
        if (p && typeof p === 'object' && Number.isFinite(p.x) && Number.isFinite(p.y)) {
          const x = Math.max(0.1, Math.min(0.9, p.x))
          const y = Math.max(0.12, Math.min(0.88, p.y))
          return (x !== p.x || y !== p.y) ? { ...b, position: { x, y } } : b
        }
        return b
      }),
    }))
  }
  function changeAspect(next) {
    if (!next || next === aspect) return
    setSlides((prev) => reflowForAspect(prev))
    setAspect(next)
  }

  // Active slide derived values — used by the canvas and the inspector.
  const activeSlide = slides[activeSlideIdx] || slides[0]
  const activePhotoUrl = typeof activeSlide?.photo_idx === 'number' && mediaUrls[activeSlide.photo_idx]
    ? photoSourceUrl(mediaUrls[activeSlide.photo_idx])
    : null
  const activeTheme = resolveTheme(activeSlide?.template_id || themeId, customThemes)

  function goBack() {
    if (onBack) onBack()
    else smartBack()
  }

  return (
    <div className="flex h-full min-h-0 flex-col bg-card">
      {fullPreviewOpen && (
        <FullPreviewOverlay
          slides={slides}
          activeIdx={activeSlideIdx}
          mediaUrls={mediaUrls}
          brandStyle={brandStyle}
          themeId={themeId}
          customThemes={customThemes}
          workspace={workspace}
          caption={piece?.content}
          platform={piece?.platform}
          aspect={forcedAspect || aspect}
          onClose={() => setFullPreviewOpen(false)}
          onNav={(delta) => setActiveSlideIdx((prev) => Math.max(0, Math.min(slides.length - 1, prev + delta)))}
        />
      )}
      {adExportOpen && (
        <AdCarouselExportModal
          piece={piece}
          slides={slides}
          mediaUrls={piece?.media_urls}
          brandStyle={brandStyle}
          theme={theme}
          themeId={themeId}
          customThemes={customThemes}
          onClose={() => setAdExportOpen(false)}
        />
      )}

      {/* Schedule & publish — folded into the top bar, opens here */}
      {scheduleNode && (
        <Dialog open={scheduleOpen} onOpenChange={setScheduleOpen}>
          <DialogContent className="max-w-lg max-h-[85vh] overflow-y-auto">
            <DialogHeader>
              <DialogTitle>Schedule &amp; publish</DialogTitle>
            </DialogHeader>
            {scheduleNode}
          </DialogContent>
        </Dialog>
      )}

      {/* ── TOP BAR — shared EditorChrome (unified shell) ─────────────────── */}
      <EditorChrome
        onBack={goBack}
        title={piece?.topic}
        badge={{ icon: badgeIcon || Instagram, label: formatLabel || 'Instagram Carousel', sub: formatSub || `${slides.length} slides` }}
        note={photoCount != null && photoCount !== slides.length
          ? `${slides.length} slides from ${photoCount} photo${photoCount === 1 ? '' : 's'}`
          : null}
        aspect={forcedAspect ? null : { value: aspect, options: ['1:1', '4:5', '9:16'], onChange: changeAspect }}
      >
        <Tooltip>
          <TooltipTrigger asChild>
            <button
              type="button"
              onClick={() => setFullPreviewOpen(true)}
              className="rounded-lg border border-border px-2.5 py-1.5 text-xs text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <Smartphone className="mr-1 inline h-3.5 w-3.5" />
              Preview
            </button>
          </TooltipTrigger>
          <TooltipContent>Preview as Instagram</TooltipContent>
        </Tooltip>
        {hasMedia && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setAdExportOpen(true)}
                className="rounded-lg border border-action/40 px-2.5 py-1.5 text-xs text-action hover:bg-action/10 transition-colors"
              >
                <Megaphone className="mr-1 inline h-3.5 w-3.5" />
                Ads
              </button>
            </TooltipTrigger>
            <TooltipContent>Render into ad sizes</TooltipContent>
          </Tooltip>
        )}
        <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
        <SaveStatus status={rendering ? 'saving' : saveStatus} />
        {/* Version history — auto-snapshots + restore */}
        <div className="relative">
          <button onClick={openHistory} className="flex h-8 items-center gap-1 rounded-lg border px-2 text-sm text-muted-foreground hover:border-primary/60 hover:text-primary" style={{ borderColor: 'hsl(var(--border))' }} title="Version history" aria-label="Version history"><History className="h-4 w-4" /></button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setHistoryOpen(false)} />
              <div role="menu" aria-label="Version history" className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 overflow-auto rounded-lg border border-border bg-card p-1.5 shadow-lg">
                <p className="px-1 pb-1 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Version history</p>
                {revisions.length === 0 ? (
                  <p className="px-1 py-2 text-xs text-muted-foreground">No saved versions yet — they appear as you edit.</p>
                ) : revisions.map((rv) => (
                  <button key={rv.id} onClick={() => { applyDoc(rv.doc); setHistoryOpen(false); toast.success('Restored a previous version') }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-sm hover:bg-muted">
                    <span>{new Date(rv.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="font-medium text-primary">Restore</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Approve · voice check · publish — inline, no modal or backing out.
            The full Publish panel (export, metrics, schedule details) stays one
            click away behind the sliders button for the cases the bar can't
            cover (export-only channels, published metrics). */}
        <EditorWorkflowBar piece={piece} />
        {scheduleNode && (
          <Tooltip>
            <TooltipTrigger asChild>
              <button
                type="button"
                onClick={() => setScheduleOpen(true)}
                className="rounded-lg border border-border px-2 py-1.5 text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                aria-label="Full publish panel"
              >
                <SlidersHorizontal className="h-3.5 w-3.5" />
              </button>
            </TooltipTrigger>
            <TooltipContent>Full publish panel — export, metrics, schedule details</TooltipContent>
          </Tooltip>
        )}
      </EditorChrome>

      {/* ── WORK AREA: rail | inspector | canvas ─────────────────────────── */}
      <div className="flex min-h-0 flex-1">
        {/* 1. Icon rail — unified shell; picks the single inspector panel */}
        {activeSlide && (
          <EditorIconRail
            items={[
              { key: 'words', icon: MessageCircle, label: 'Words' },
              { key: 'slide', icon: Layers, label: 'Slide' },
              { key: 'photo', icon: ImageIcon, label: 'Media' },
              { key: 'text', icon: Type, label: 'Text' },
              { key: 'object', icon: BadgeCheck, label: 'Logo' },
            ]}
            active={tool}
            onPick={pickTool}
          />
        )}

        {/* 2. Inspector — single panel chosen by the rail */}
        <aside className="flex w-[480px] shrink-0 flex-col border-r bg-card overflow-hidden">
          {!activeSlide ? (
            <div className="flex flex-1 items-center justify-center p-4 text-sm text-muted-foreground">
              Add a slide to start editing
            </div>
          ) : tool === 'words' ? (
            <CaptionPanel piece={piece} onUseAsHook={handleUseAsHook} updateItem={updateItem} />
          ) : (
            <>
              {/* Slide N of M + prev/next nav */}
              <div className="flex shrink-0 items-center justify-between border-b px-4 py-3">
                <span className="text-sm font-semibold">Slide {activeSlideIdx + 1} of {slides.length}</span>
                <div className="flex gap-1.5">
                  <button
                    type="button"
                    onClick={() => setActiveSlideIdx((i) => Math.max(0, i - 1))}
                    disabled={activeSlideIdx === 0}
                    className="rounded-lg border px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronLeft className="h-4 w-4" />
                  </button>
                  <button
                    type="button"
                    onClick={() => setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))}
                    disabled={activeSlideIdx === slides.length - 1}
                    className="rounded-lg border px-2 py-1 text-muted-foreground hover:bg-muted disabled:opacity-30 transition-colors"
                  >
                    <ChevronRight className="h-4 w-4" />
                  </button>
                </div>
              </div>

              <div className="min-h-0 flex-1 overflow-y-auto p-4">
                {tool === 'slide' && (
                  <SlideInspector
                    slide={activeSlide}
                    slideIdx={activeSlideIdx}
                    totalSlides={slides.length}
                    photoUrl={activePhotoUrl}
                    brandStyle={brandStyle}
                    allThemes={allThemes}
                    customThemes={customThemes}
                    globalThemeId={themeId}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                    onApplyThemeToAll={handleApplyThemeToAll}
                    onAddBlock={(role) => {
                      const blocks = activeSlide.blocks.concat(emptyBlockFor(activeSlide.template, role))
                      updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                      setTool('text'); setSelection({ type: 'text', idx: blocks.length - 1 })
                    }}
                    onMoveLeft={() => {
                      moveSlide(activeSlideIdx, -1)
                      setActiveSlideIdx((i) => Math.max(0, i - 1))
                    }}
                    onMoveRight={() => {
                      moveSlide(activeSlideIdx, 1)
                      setActiveSlideIdx((i) => Math.min(slides.length - 1, i + 1))
                    }}
                    onRemove={() => removeSlide(activeSlideIdx)}
                  />
                )}

                {tool === 'photo' && (
                  <PhotoInspector
                    slide={activeSlide}
                    photoUrl={activePhotoUrl}
                    mediaUrls={mediaUrls}
                    pieceId={piece?.id}
                    attachedKeys={attachedKeys}
                    onAttachPhoto={attachPhoto}
                    onChange={(next) => updateSlide(activeSlideIdx, next)}
                    singleSlide={singleSlide}
                  />
                )}

                {tool === 'text' && (
                  <div className="space-y-4">
                    <div className="space-y-2">
                      {activeSlide.blocks.map((b, i) => {
                        const meta = ROLE_META[b.role] || ROLE_META.body
                        const snippet = (b.text || '').trim().slice(0, 22)
                        const on = selection.type === 'text' && selection.idx === i
                        return (
                          <button
                            key={i}
                            type="button"
                            onClick={() => setSelection({ type: 'text', idx: i })}
                            className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2.5 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                          >
                            <span className={`shrink-0 text-xs font-semibold uppercase tracking-wide ${on ? 'text-primary' : 'text-muted-foreground'}`}>{meta.label}</span>
                            <span className="min-w-0 flex-1 truncate text-sm text-foreground">{snippet || 'Empty'}{snippet && b.text.trim().length > 22 ? '…' : ''}</span>
                          </button>
                        )
                      })}
                      <button
                        type="button"
                        onClick={() => {
                          const blocks = activeSlide.blocks.concat(emptyBlockFor(activeSlide.template, 'body'))
                          updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                          setSelection({ type: 'text', idx: blocks.length - 1 })
                        }}
                        className="w-full rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary hover:bg-muted transition-colors"
                      >
                        + Add text block
                      </button>
                    </div>

                    {selection.type === 'text' && activeSlide.blocks[selection.idx] && (
                      <div className="border-t pt-4">
                        <TextInspector
                          slide={activeSlide}
                          blockIdx={selection.idx}
                          photoUrl={activePhotoUrl}
                          onChange={(next) => updateSlide(activeSlideIdx, next)}
                          onRemoved={() => setSelection({ type: null })}
                          onCenter={flashGuides}
                        />
                      </div>
                    )}

                    <div className="border-t pt-3">
                      <RealQuotesSection
                        pieceId={piece?.id}
                        onInsertQuote={(text) => {
                          if (!activeSlide) return
                          const blocks = activeSlide.blocks.concat({ role: 'body', text, position: defaultPositionFor(activeSlide.template, 'body') })
                          updateSlide(activeSlideIdx, { ...activeSlide, blocks })
                          setSelection({ type: 'text', idx: blocks.length - 1 })
                        }}
                      />
                    </div>
                  </div>
                )}

                {tool === 'object' && (
                  <div className="space-y-4">
                    <button
                      type="button"
                      disabled={!workspaceLogo}
                      onClick={() => {
                        const objects = (activeSlide.objects || []).concat({
                          id: `obj_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 6)}`,
                          type: 'logo', mark: 'primary', src: workspaceLogo,
                          x: 0.82, y: 0.9, scale: 0.16, opacity: 1,
                        })
                        updateSlide(activeSlideIdx, { ...activeSlide, objects })
                        setSelection({ type: 'object', idx: objects.length - 1 })
                      }}
                      className="flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-border px-3 py-2.5 text-sm font-medium text-primary transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <BadgeCheck className="h-4 w-4" /> Add logo / watermark
                    </button>
                    {!workspaceLogo && (
                      <p className="text-xs text-muted-foreground">No logo in your Brand Kit yet. Add one in Settings → Brand Kit and it&apos;ll appear here.</p>
                    )}
                    {(activeSlide.objects || []).length > 0 && (
                      <div className="space-y-2">
                        {(activeSlide.objects || []).map((o, i) => {
                          const on = selection.type === 'object' && selection.idx === i
                          return (
                            <button
                              key={o.id || i} type="button"
                              onClick={() => setSelection({ type: 'object', idx: i })}
                              className={`flex w-full items-center gap-2.5 rounded-lg border px-3 py-2 text-left transition-colors ${on ? 'border-primary bg-primary/5' : 'border-border hover:bg-muted'}`}
                            >
                              <img src={o.src} alt="" className="h-6 w-auto max-w-[60px] object-contain" />
                              <span className="text-sm text-muted-foreground">Logo {i + 1}</span>
                            </button>
                          )
                        })}
                      </div>
                    )}
                    {selection.type === 'object' && (activeSlide.objects || [])[selection.idx] && (
                      <div className="border-t pt-4">
                        <ObjectInspector
                          slide={activeSlide}
                          objIdx={selection.idx}
                          onChange={(next) => updateSlide(activeSlideIdx, next)}
                          onRemoved={() => setSelection({ type: null })}
                        />
                      </div>
                    )}
                  </div>
                )}
              </div>
            </>
          )}
        </aside>

        {/* 3. Canvas — centre, takes remaining space. The photo box is bounded by
            BOTH viewport height and width (min(...)) so it letterboxes instead of
            overflowing either axis. Constants leave room for the top bar + the
            slide picker strip sitting directly under the photo (height), and the
            icon rail + inspector (width). */}
        <section
          className="relative flex min-w-0 flex-1 items-center justify-center overflow-hidden p-5"
          style={{ background: 'hsl(var(--muted))' }}
          // Click the empty stage (letterbox/padding) to deselect — turns a dead
          // zone into the standard Canva/Figma "click canvas to dismiss" gesture.
          // e.target === e.currentTarget so bubbled clicks from the canvas, text /
          // object handles, and the picker strip don't fire it.
          onClick={(e) => { if (e.target === e.currentTarget && selection.type) setSelection({ type: null }) }}
        >
          {activeSlide ? (
            <div
              className="flex flex-col items-center"
              onClick={(e) => { if (e.target === e.currentTarget && selection.type) setSelection({ type: null }) }}
            >
              <div
                className={`relative ${ASPECT_STAGE[aspect]?.twAspect ?? 'aspect-[4/5]'} rounded-xl ${selection.type === 'photo' ? 'ring-[2.5px] ring-primary ring-offset-2 ring-offset-muted' : ''}`}
                style={{ height: `min(calc(100vh - 210px), calc((100vw - 470px) * ${ASPECT_STAGE[aspect]?.hFactor ?? 1.25}))` }}
              >
                <SlidePreview
                  slide={editingBlockIdx != null ? { ...activeSlide, blocks: activeSlide.blocks.map((b, i) => (i === editingBlockIdx ? { ...b, text: '' } : b)) } : activeSlide}
                  photoUrl={activePhotoUrl}
                  brandStyle={brandStyle}
                  theme={activeTheme}
                  aspect={aspect}
                  onReframe={(next) => updateSlide(activeSlideIdx, next)}
                  onSelectPhoto={() => { setSelection({ type: 'photo' }); setTool('photo') }}
                  className={`h-full w-full rounded-xl border bg-muted shadow-lg ${activePhotoUrl ? 'cursor-move' : 'cursor-pointer'}`}
                />
                {/* Draggable text-layer handles — click to select, drag to place */}
                <TextDragLayer
                  slide={activeSlide}
                  theme={activeTheme}
                  selection={selection}
                  editingIdx={editingBlockIdx}
                  setEditingIdx={setEditingBlockIdx}
                  onDragging={setDragging}
                  onSnap={setSnap}
                  onSelectBlock={(idx) => { setSelection({ type: 'text', idx }); setTool('text') }}
                  onMoveBlock={(idx, pos) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => (i === idx ? { ...b, position: pos } : b)),
                  })}
                  onSetStyle={(idx, key, val) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => {
                      if (i !== idx) return b
                      const nb = { ...b }
                      if (val == null || val === '' || (key === 'fontScale' && val === 1)) delete nb[key]
                      else nb[key] = val
                      return nb
                    }),
                  })}
                  onSetRuns={(idx, { text, runs }) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    blocks: activeSlide.blocks.map((b, i) => {
                      if (i !== idx) return b
                      const nb = { ...b, text }
                      // Per-word style lives in runs; drop the key when the edit
                      // left no styled runs so the row stays clean (renderer falls
                      // back to the block's base typography).
                      if (runs && runs.length) nb.runs = runs
                      else delete nb.runs
                      return nb
                    }),
                  })}
                />
                {/* Draggable objects layer — logo/watermark hit-targets (WS3.1) */}
                <ObjectDragLayer
                  slide={activeSlide}
                  selection={selection}
                  onDragging={setDragging}
                  onSnap={setSnap}
                  onSelectObject={(idx) => { setSelection({ type: 'object', idx }); setTool('object') }}
                  onMoveObject={(idx, pos) => updateSlide(activeSlideIdx, {
                    ...activeSlide,
                    objects: (activeSlide.objects || []).map((o, i) => (i === idx ? { ...o, x: pos.x, y: pos.y } : o)),
                  })}
                />
                {/* Drag-reveal guides — safe-zone margins appear while dragging text;
                    centre lines light up when the block snaps to centre. The Center
                    button also flashes them briefly (guidesOn). */}
                <div className="pointer-events-none absolute inset-0 rounded-xl" aria-hidden="true">
                  <div className="absolute inset-0 transition-opacity duration-200" style={{ opacity: dragging ? 1 : 0 }}>
                    <div className="absolute inset-[7%] rounded border border-dashed border-white/50" />
                    <div className="absolute inset-x-0 top-0 h-[10%] bg-rose-500/10" />
                    <div className="absolute inset-x-0 bottom-0 h-[14%] bg-rose-500/10" />
                  </div>
                  {snap.y != null && <div className="absolute inset-x-0 h-px -translate-y-px bg-primary/80" style={{ top: `${snap.y * 100}%` }} />}
                  {snap.x != null && <div className="absolute inset-y-0 w-px -translate-x-px bg-primary/80" style={{ left: `${snap.x * 100}%` }} />}
                  {guidesOn && (
                    <>
                      <div className="absolute inset-x-0 top-1/2 h-px -translate-y-px bg-primary/70" />
                      <div className="absolute inset-y-0 left-1/2 w-px -translate-x-px bg-primary/70" />
                    </>
                  )}
                  <div className="absolute left-1/2 top-1/2 h-2.5 w-2.5 -translate-x-1/2 -translate-y-1/2 rounded-full bg-primary transition-opacity duration-150" style={{ opacity: guidesOn ? 1 : 0, boxShadow: '0 0 0 2px white' }} />
                </div>
              </div>

              {/* 4. Slide picker — floats directly under the photo, no bar */}
              <SlidePickerStrip
                slides={slides}
                activeIdx={activeSlideIdx}
                mediaUrls={mediaUrls}
                onSelect={goToSlide}
                onAdd={addSlide}
                onRemove={removeSlide}
                canAdd={!singleSlide}
              />
            </div>
          ) : (
            <p className="text-sm text-muted-foreground">No slides yet</p>
          )}
        </section>
      </div>
    </div>
  )
}
