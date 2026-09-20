import { useState, useRef, useEffect, useMemo, useCallback } from 'react'
import { useParams, useNavigate, useLocation } from 'react-router-dom'
import { useSmartBack } from '@/lib/useSmartBack'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import {
  Play, Pause, Film, Check, Loader2, AlertCircle, FolderOpen, Megaphone, ChevronDown, ChevronLeft, ChevronRight, History,
  ThumbsDown, } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useAppMutation } from '@/lib/useAppMutation'
import { workspaceCaptionAccent} from '@/lib/brandSwatches'
import { apiFetch } from '@/lib/api'
import { buildTemplateFromEditor, suggestTemplateName } from '@/lib/videoTemplateCapture'
import { posthogCapture } from '@/lib/posthog'
import { getMediaAsset, updateMediaAsset } from '@/lib/mediaLib'
import { resolveVideoEditSource, shouldUseSourceWindow } from '@/lib/videoEditSource'
import { videoEditFingerprint, isVideoEditUnbaked, VIDEO_EDIT_HASH_KEY } from '@/lib/videoEditFingerprint'
import { applyCaptionWindow} from '@/lib/captionTimeline'
import { getSegments, renderWholeVideo, findClips, updateSegment, exportClipToBroll, startClipRenderJob, getClipRenderJob } from '@/lib/clipsLib'
import { updateBrandStyle } from '@/lib/brandKitLib'
import AdVideoExportModal from '@/components/AdVideoExportModal'
import EditorChrome from '@/components/editor/EditorChrome'
import EditorWorkflowBar from '@/components/editor/EditorWorkflowBar'
import { useContentItem, useUpdateContentItem, useUpdateContentItemStatus } from '@/lib/queries'
import { NEUTRAL_GRADE} from '@/lib/gradeParams'
import { toast } from '@/lib/toast'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import ClipDiscardReasons from '@/components/moments/ClipDiscardReasons'
import { useDocumentTitle } from '@/lib/useDocumentTitle'
import SaveStatus from '@/components/editor/SaveStatus'
import UndoRedoButtons from '@/components/editor/UndoRedoButtons'
import { useUndoHistory } from '@/lib/useUndoHistory'
import { useUndoRedoShortcut } from '@/lib/useUndoRedoShortcut'
import { useVideoShortcuts } from '@/lib/useVideoShortcuts'
import { useAutosave } from '@/lib/useAutosave'
import { detectFaceCenterX } from '@/lib/faceReframe'
import { FORMATS, FORMAT_KEYS, channelFor, defaultFormatFor, normalizeFormat } from '@/lib/videoFormats'
import { PLATFORM_META } from '@/lib/contentMeta'
import { listRevisions, saveRevision } from '@/lib/editorRevisions'
import {
  sliceWords, groupLines, } from './video-editor/captions'
import {
  addRange, subRange, inCut, } from './video-editor/cuts'
import { HEX6_RE, UUID_RE, clamp, fmt, isOverlaySel } from './video-editor/constants'
import { segBtn } from './video-editor/shared'
import { Canvas } from './video-editor/Canvas'
import { HorizontalTimeline } from './video-editor/HorizontalTimeline'
import { IconRail } from './video-editor/IconRail'
import { CaptionInspector } from './video-editor/inspectors/CaptionInspector'
import { ClipInspector } from './video-editor/inspectors/ClipInspector'
import { GradeInspector } from './video-editor/inspectors/GradeInspector'
import { MediaInspector } from './video-editor/inspectors/MediaInspector'
import { MomentsInspector } from './video-editor/inspectors/MomentsInspector'
import { MusicInspector } from './video-editor/inspectors/MusicInspector'
import { OverlayInspector } from './video-editor/inspectors/OverlayInspector'
import { PostCaptionInspector } from './video-editor/inspectors/PostCaptionInspector'
import { TranscriptInspector } from './video-editor/inspectors/TranscriptInspector'

// ── RAIL + VERTICAL TIMELINE (v3) ────────────────────────────────────────────
// Thin icon rail (v3) — picks the inspector tool. "Text" selects the latest
// overlay (or adds one). Replaces the old Layers/Transcript rail.
// ── Edit-by-transcript (WS4) ──────────────────────────────────────────────────

// ── MAIN ─────────────────────────────────────────────────────────────────────
export default function VideoEditor({ piece = null, embedded = false, onBack = null } = {}) {
  useDocumentTitle('Video editor')
  const { assetId: routeAssetId } = useParams()
  const navigate = useNavigate()
  const location = useLocation()
  // Embedded from a video content piece: StoryboardPublish routes Reels /
  // long-video posts (vvideo/lvideo) HERE instead of the caption-only
  // UnifiedEditor, so "one pathway per media type" — video pieces get the full
  // editor (trim/captions/design) with the publish shell around it, mirroring
  // how photo pieces open SlideEditor. The clip to edit is then the piece's
  // attached video asset; standalone (Moment Miner / Slate) it's the route param.
  const pieceVideoEntry = useMemo(() => (
    piece && Array.isArray(piece.media_urls)
      ? piece.media_urls.find((m) => m && (m.type === 'video' || m.kind === 'video')) || null
      : null
  ), [piece])
  const assetId = piece ? (pieceVideoEntry?.mediaAssetId || null) : routeAssetId
  // Routed at both /moments/clip/:assetId and /slate/clip/:assetId — the
  // fallback (used only when there's no real history to go back to) must
  // match whichever section the URL says we're actually in, not always
  // Moment Miner. When embedded, the host (StoryboardPublish) owns "back".
  const fallbackBack = useSmartBack(() => (location.pathname.startsWith('/slate') ? '/slate' : '/moments'))
  const goBack = onBack || fallbackBack
  const videoRef = useRef(null)
  // When opened from a Media Hub edit brief ("Edit clip in Bernard"), the brief
  // id rides along as ?briefId=. Saving this clip to the Library then closes
  // that brief server-side (final_asset_id + status 'returned') — the in-app
  // replacement for the contractor "Upload final" round-trip. Query param (not
  // router state) so it survives the reloads the draft-resume flow invites.
  const briefId = useMemo(() => {
    const v = new URLSearchParams(location.search).get('briefId')
    return v && UUID_RE.test(v) ? v : null
  }, [location.search])

  // Distinct query key ('src') so the source_clip-enriched asset the editor needs
  // can't be clobbered by MediaDetail's plain ['media-asset', id] cache entry.
  const { data: asset, isLoading, error } = useQuery({ queryKey: ['media-asset', assetId, 'src'], queryFn: () => getMediaAsset(assetId, { withSourceClip: true }), enabled: !!assetId, retry: 1 })
  const { data: segData } = useQuery({ queryKey: ['video-segments', assetId], queryFn: () => getSegments(assetId), enabled: !!assetId, staleTime: 30_000 })

  // A caption-baked auto-reel's editable source is the RAW un-captioned interview
  // + this segment's source window (server resolves it as asset.source_clip via
  // video_segments.rendered_asset_id). Editing the baked blob directly would
  // re-caption an already-captioned clip — double karaoke in the preview and a
  // double-baked track on save. resolveVideoEditSource points the <video>, the
  // caption transcript, and the render at the raw source; the source window is
  // applied to startSec/endSec on hydrate below, and the existing trim/playback/
  // timeline machinery (already source-relative for manual clips cut from a long
  // interview) handles the rest unchanged. A manual clip / raw upload has no
  // source_clip and edits from its own blob exactly as before. Pure logic lives in
  // videoEditSource.js (tested) so this invariant can't silently regress.
  const editSource = useMemo(() => resolveVideoEditSource(asset, assetId), [asset, assetId])
  const editVideoUrl = editSource.videoUrl
  const editAssetId = editSource.assetId
  // A caption-baked clip with no resolvable clean source (a manually-exported
  // broll re-attached to a post) is edited from its own baked blob — so LOCK
  // captions: no live overlay, no re-bake on save, so the already-baked track
  // shows once and can't double. See videoEditSource.js.
  const captionsBaked = editSource.captionsBaked
  // <video> poster. asset.thumbnail_url is the BAKED clip's thumbnail — it carries
  // the burned-in karaoke. When editing a baked auto-reel from its RAW source
  // (window resolved), the <video> src is clean but that poster is NOT: on the
  // paused/undecoded frame it shows the baked captions UNDER the live overlay —
  // the exact double #2609 removed from the src but left on the poster. Drop it so
  // the paused frame decodes clean from the raw source. Keep it for a normal clip/
  // upload and for the captionsBaked fallback (there the video IS the baked blob,
  // so the thumbnail matches and no live overlay is drawn).
  const editPoster = editSource.window ? undefined : (asset?.thumbnail_url || undefined)

  // Embedded from a post (the publish flow) opens on the post caption — the
  // text that publishes below the video, and what users came here to review.
  // Standalone clip editing (Moment Miner) opens on Clip as before.
  const [sel, setSel] = useState(() => (embedded && piece?.id ? 'postcaption' : 'clip'))
  const [railMode, setRailMode] = useState('layers')
  const [playing, setPlaying] = useState(false)
  const [currentTime, setCurrentTime] = useState(0)
  const [videoDuration, setVideoDuration] = useState(0)
  const [startSec, setStartSec] = useState(0)
  const [endSec, setEndSec] = useState(30)
  const [grade, setGrade] = useState({ ...NEUTRAL_GRADE })
  const [format, setFormat] = useState(() => defaultFormatFor(piece?.platform))
  const [reframe, setReframe] = useState({ zoom: 100, x: 50, y: 50 })
  const [kenBurns, setKenBurnsState] = useState({ motion: 'none', intensity: 50 })
  const [speed, setSpeedState] = useState(1)
  // accent starts null (NOT a Bernard product color) and is seeded from the
  // TENANT workspace brand on hydrate — Bernard's own #0C7580/#d97706 must never
  // become a Move Better caption color. The bake resolves a null/invalid accent
  // to the tenant's brand primary too (brandRenderVideo.js), so preview == bake.
  const [caption, setCaptionState] = useState({ preset: 'karaoke', position: 'bottom', size: 'medium', accent: null, anim: 'none', style: 'bold' })
  const [overlays, setOverlays] = useState([])
  // Music bed (WS3.3): trackId null = no music. volume 0..1; duck/fade default on.
  const [music, setMusic] = useState({ trackId: null, volume: 0.22, duck: true, fade: true })
  const [cuts, setCuts] = useState([])   // edit-by-transcript: clip-relative removed ranges
  const [historyOpen, setHistoryOpen] = useState(false)
  const [revisions, setRevisions] = useState([])
  const lastRevRef = useRef(0)
  // Drag-reveal guides: safe-zone margins + centre snap lines appear while a text
  // overlay is being dragged (no persistent "safe zones" toggle). Mirrors the
  // photo editor's snapping guides.
  const [dragging, setDragging] = useState(false)
  const [snap, setSnap] = useState({ v: false, h: false })
  const [selectedSegmentId, setSelectedSegmentId] = useState(null)
  const seededRef = useRef(false)
  // Deny verdict (header) — reasons are optional, same contract as moment Retire.
  const [denyOpen, setDenyOpen] = useState(false)
  const [denyReasons, setDenyReasons] = useState([])
  const [denyNote, setDenyNote] = useState('')

  const durationSec = Math.max(1, endSec - startSec)
  const playClipT = clamp(currentTime - startSec, 0, durationSec)
  // Optimistic scrub target while dragging the timeline — the video's real
  // playClipT only updates once <video> fires timeupdate/seeked for the seek
  // we issued, which can lag a beat or never fire before the next drag frame
  // on a slow/unbuffered source. Shared by the timeline playhead and the
  // transport readout so both redraw immediately and hand off together once
  // the real value converges.
  const [scrubT, setScrubT] = useState(null)
  useEffect(() => {
    if (scrubT != null && Math.abs(playClipT - scrubT) < 0.08) setScrubT(null)
  }, [playClipT, scrubT])
  const displayClipT = scrubT != null ? scrubT : playClipT

  // Editable caption lines. Declared up here (ahead of draftDoc) so the draft
  // snapshot can persist them alongside every other editable field — otherwise
  // hand-edited caption text is dropped on autosave/reload/undo/version-restore.
  // The lines are seeded and edited further below, where the transcript-derived
  // lines are available; only the state containers live up here.
  const [captionLines, setCaptionLines] = useState([])
  // Once the user hand-edits a caption line, their words win: we stop auto-
  // re-seeding from the transcript on trim changes (which used to silently wipe
  // the edits). "Reset captions to transcript" clears this to re-derive.
  const captionsEditedRef = useRef(false)
  const [captionsEdited, setCaptionsEdited] = useState(false)
  // The startSec that captionLines' word timings are currently clip-relative to
  // (their 0:00 == this source second). It EQUALS startSec at every (re)seed and
  // restore; it only LAGS startSec when a trim moves the window while captions are
  // hand-edited (the seed effect then leaves the edited lines frozen). The `lines`
  // memo translates by (captionWin - startSec) so those frozen captions re-align to
  // the trimmed audio instead of baking misaligned — the "trimming messed up caption
  // timing" report. State (not a ref) so the `lines` memo can depend on it cleanly.
  // See applyCaptionWindow in src/lib/captionTimeline.js.
  const [captionWin, setCaptionWin] = useState(0)
  // Per-word transcript corrections (Script tab): fix a mis-transcribed word
  // ("that's" → "Yes") without re-cutting it. Keyed by the word's ABSOLUTE start
  // time (clip-relative start + trim offset) so a correction survives re-trims;
  // value is the corrected text. Applied to `words` below, which flows to the
  // Script list, the karaoke caption, and the export bake (captionWords override).
  const [wordEdits, setWordEdits] = useState({})

  // Save & resume. On open, restore this asset's editor doc — preferring the
  // SERVER draft (media_assets.video_edit_draft, cross-device) and falling back
  // to localStorage if the asset hasn't loaded a server draft yet. Autosave
  // (debounced) writes BOTH: localStorage immediately (offline mirror) + a
  // server PATCH. Fully defensive: a missing/corrupt draft just opens fresh.
  const restoredRef = useRef(false)
  // Mirrors whether the restore effect below has run — a plain ref flip
  // doesn't itself trigger a re-render, and when there's no draft to restore,
  // no setState call happens in that effect to cause one incidentally. Undo
  // history and autosave both need an actual re-render to pick up enabled=true.
  const [hydrated, setHydrated] = useState(false)
  useEffect(() => {
    if (!asset || restoredRef.current) return
    restoredRef.current = true
    let draftAccent = null
    let draftStartSec = null
    try {
      const server = asset.video_edit_draft
      let local = null
      try {
        const raw = localStorage.getItem(`videoEdit:${assetId}`)
        if (raw) local = JSON.parse(raw)
      } catch { /* corrupt local — ignore */ }
      const d = (server && typeof server === 'object') ? server : local
      if (d && typeof d === 'object') {
        if (d.grade) setGrade(d.grade)
        // Output shape is a property of the DESTINATION, not the clip. The draft
        // is asset-scoped and shared across every piece a b-roll clip appears
        // in, so its stored shape must NOT override a new piece's platform
        // default — a clip once edited as a Vertical (9:16) reel was forcing that
        // shape onto later Google Business / LinkedIn posts. Honour a saved shape
        // only when it was chosen FOR this piece (shapePieceId match), or when
        // there's no piece at all (standalone Moment Miner / Slate). Otherwise
        // the platform default seeded at line ~1153 stands. Every OTHER draft
        // field (grade, trim, captions, music) is a genuine clip edit and still
        // restores regardless of piece.
        const savedShape = normalizeFormat(d.format)
        const shapeAppliesHere = piece ? d.shapePieceId === piece.id : true
        if (shapeAppliesHere && FORMAT_KEYS.includes(savedShape)) setFormat(savedShape)
        if (d.reframe) setReframe(d.reframe)
        if (d.kenBurns) setKenBurnsState((s) => ({ ...s, ...d.kenBurns }))
        if (Array.isArray(d.overlays)) setOverlays(d.overlays)
        if (d.speed) setSpeedState(d.speed)
        if (d.caption) { setCaptionState((c) => ({ ...c, ...d.caption })); draftAccent = d.caption.accent }
        if (Number.isFinite(d.startSec)) { setStartSec(d.startSec); draftStartSec = d.startSec }
        if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
        if (Array.isArray(d.cuts)) setCuts(d.cuts)
        if (d.music) setMusic(d.music)
        // Restore hand-edited caption lines. Only when the user actually edited
        // them (captionsEdited) — an unedited draft re-seeds cleanly from the
        // current transcript below. Setting the ref true stops the seed effect
        // from clobbering the restored lines on the trim/derived-lines change.
        if (d.captionsEdited && Array.isArray(d.captionLines) && d.captionLines.length) {
          setCaptionLines(d.captionLines)
          setCaptionsEdited(true)
          captionsEditedRef.current = true
          // The restored lines are clip-relative to the window they were saved in.
          // Prefer the persisted captionWin (correct even when the draft was left
          // FROZEN mid-trim); fall back to the saved startSec for older drafts.
          setCaptionWin(Number.isFinite(d.captionWin) ? d.captionWin : (Number.isFinite(draftStartSec) ? draftStartSec : 0))
        }
        // Restore per-word transcript corrections (Script tab).
        if (d.wordEdits && typeof d.wordEdits === 'object' && !Array.isArray(d.wordEdits)) {
          setWordEdits(d.wordEdits)
        }
        seededRef.current = true // a restored trim wins over the proposal seed
      }
    } catch { /* corrupt draft — open fresh */ }
    // A caption-baked auto-reel edits from its RAW source (asset.source_clip): the
    // draft's stored trim is CLIP-relative (0..N, from when the entry pointed at
    // the baked clip), so replace it with the true SOURCE window here — otherwise
    // the raw <video> would play/render the wrong region (the interview's start,
    // not the moment). seededRef stops the proposal seed from clobbering it. A
    // genuine source-relative re-trim (startSec >= the window start) is preserved.
    const srcWindow = resolveVideoEditSource(asset, assetId).window
    if (shouldUseSourceWindow(draftStartSec, srcWindow)) {
      setStartSec(srcWindow.startSec)
      setEndSec(srcWindow.endSec)
      seededRef.current = true
      // Trim just became source-relative; treat any restored captions as belonging
      // to the new window (no translation) — matches the pre-fix as-is behavior.
      setCaptionWin(srcWindow.startSec)
    }
    // Seed the caption accent from the workspace brand when the draft didn't
    // bring a valid one. The bake always receives caption.accent (renderBody),
    // and the server resolves a missing/invalid accent via resolveBrandColors —
    // seeding the same resolution up front keeps preview == bake, while an
    // existing draft's stored (possibly hand-picked) accent stays untouched so
    // already-baked clips re-render byte-identical.
    if (!HEX6_RE.test(String(draftAccent || ''))) {
      setCaptionState((c) => ({ ...c, accent: workspaceCaptionAccent(asset.workspace) }))
    }
    setHydrated(true)
    // restoredRef guards this to one run, so `piece` in the deps can't re-fire
    // it — it's here only because the shape-restore gate above reads piece.id.
  }, [asset, assetId, piece])

  // Draft snapshot shared by autosave + undo/redo.
  // shapePieceId records WHICH piece the current `format` was chosen for, so a
  // deliberate per-post shape override sticks on reopen (see the restore gate
  // above) without leaking to a different piece that reuses the same b-roll.
  // captionWin travels with the snapshot so a draft left FROZEN mid-trim (edited
  // captions, then re-trimmed) restores with its caption timings still aligned —
  // captionLines are clip-relative to captionWin, which can lag startSec.
  const draftDoc = useMemo(
    () => ({ format, shapePieceId: piece?.id ?? null, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec, cuts, music, captionLines, captionsEdited, captionWin, wordEdits }),
    [format, piece?.id, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec, cuts, music, captionLines, captionsEdited, captionWin, wordEdits],
  )

  // Publish-fidelity guard (embedded reel). Approve/Schedule/Publish must bake the
  // CURRENT edit into media_urls, or they ship the untouched auto-reel — the
  // trim/caption style the operator sees would differ from the scheduled post
  // (feedback f46a0eec). We can't prove the pre-existing auto-reel matches the
  // hydrated editor state (its baked caption style/trim may already differ from
  // the editor's), so the edit starts DIRTY: the first commit always bakes. Each
  // in-editor bake records the exact draft it rendered, so a redundant
  // Save→Approve (draft unchanged since) doesn't re-render. JSON.stringify is
  // stable because draftDoc is a fixed-key object literal. State, not a ref, so
  // clearing dirty after a bake re-renders the workflow bar.
  const [lastBakedDoc, setLastBakedDoc] = useState(null)
  // Dirty = the current edit isn't already rendered into this piece's media, so a
  // commit must re-bake. Two ways it can be clean: it matches the doc we baked
  // earlier THIS session (lastBakedDoc), or — across a reopen, where lastBakedDoc
  // is null — the current draft's fingerprint matches the stamp the last bake
  // wrote onto the media entry. That second check is isVideoEditUnbaked, the SAME
  // predicate /week's server dispatch uses (dispatchContentItem.js), so the editor
  // and the server can't disagree about whether a reel still needs baking; before
  // this, reopening an already-baked reel and hitting Approve paid a full ~1-min
  // re-render for nothing. An untouched auto-reel carries no stamp, so it stays
  // dirty and its first commit bakes — that render is genuinely unavoidable here
  // (the auto-reel was rendered from segment params, not a draft doc, so there's
  // no baseline to compare a zero-edit draft against). The failure mode of a
  // hydration round-trip that doesn't fingerprint-match is a redundant bake, never
  // a stale ship, so this only ever removes work, never fidelity.
  const videoEditDirty = useMemo(() => {
    if (!(embedded && piece?.id)) return false
    if (JSON.stringify(draftDoc) === lastBakedDoc) return false
    return isVideoEditUnbaked(pieceVideoEntry, draftDoc)
  }, [embedded, piece?.id, draftDoc, lastBakedDoc, pieceVideoEntry])

  // localStorage mirror — immediate, undebounced offline copy. The server
  // PATCH below is debounced via useAutosave, which also flushes any pending
  // save on unmount so navigating away mid-edit doesn't drop the change.
  useEffect(() => {
    if (!assetId || !hydrated) return
    try { localStorage.setItem(`videoEdit:${assetId}`, JSON.stringify(draftDoc)) } catch { /* quota — ignore */ }
  }, [assetId, hydrated, draftDoc])

  const { status: saveStatus } = useAutosave(
    draftDoc,
    (doc) => updateMediaAsset(assetId, { videoEditDraft: doc }),
    { debounceMs: 1500, enabled: !!assetId && hydrated, resetKey: assetId },
  )

  // Undo/redo over the same draft shape the autosave above persists. Disabled
  // until the server/localStorage draft has hydrated, so the initial restore
  // doesn't itself become an undoable step.
  const { undo, redo, canUndo, canRedo } = useUndoHistory(draftDoc, (snap) => {
    setFormat(normalizeFormat(snap.format))
    setGrade(snap.grade)
    setReframe(snap.reframe)
    setKenBurnsState(snap.kenBurns)
    setOverlays(snap.overlays)
    setSpeedState(snap.speed)
    setCaptionState(snap.caption)
    setStartSec(snap.startSec)
    setEndSec(snap.endSec)
    setCuts(snap.cuts || [])
    setMusic(snap.music || { trackId: null, volume: 0.22, duck: true, fade: true })
    setCaptionLines(snap.captionLines || [])
    setCaptionsEdited(!!snap.captionsEdited)
    captionsEditedRef.current = !!snap.captionsEdited
    setCaptionWin(Number.isFinite(snap.captionWin) ? snap.captionWin : (Number.isFinite(snap.startSec) ? snap.startSec : 0))
    setWordEdits(snap.wordEdits || {})
  }, { enabled: hydrated })
  useUndoRedoShortcut(undo, redo)

  // Version history (WS5) — apply a saved snapshot back into editor state.
  const applyDoc = useCallback((d) => {
    if (!d || typeof d !== 'object') return
    if (d.grade) setGrade(d.grade)
    if (FORMAT_KEYS.includes(normalizeFormat(d.format))) setFormat(normalizeFormat(d.format))
    if (d.reframe) setReframe(d.reframe)
    if (d.kenBurns) setKenBurnsState((s) => ({ ...s, ...d.kenBurns }))
    if (Array.isArray(d.overlays)) setOverlays(d.overlays)
    if (d.speed) setSpeedState(d.speed)
    if (d.caption) setCaptionState((c) => ({ ...c, ...d.caption }))
    if (Number.isFinite(d.startSec)) setStartSec(d.startSec)
    if (Number.isFinite(d.endSec)) setEndSec(d.endSec)
    if (Array.isArray(d.cuts)) setCuts(d.cuts)
    setMusic(d.music || { trackId: null, volume: 0.22, duck: true, fade: true })
    if (Array.isArray(d.captionLines)) setCaptionLines(d.captionLines)
    setCaptionsEdited(!!d.captionsEdited)
    captionsEditedRef.current = !!d.captionsEdited
    setCaptionWin(Number.isFinite(d.captionWin) ? d.captionWin : (Number.isFinite(d.startSec) ? d.startSec : 0))
  }, [])
  // Auto-snapshot the draft at most every ~3 min of editing (pruned to 30 server-side).
  useEffect(() => {
    if (!hydrated || !assetId) return
    const now = Date.now()
    if (now - lastRevRef.current < 180000) return
    lastRevRef.current = now
    saveRevision('video', assetId, draftDoc).catch(() => {})
  }, [draftDoc, hydrated, assetId])
  async function openHistory() {
    if (historyOpen) { setHistoryOpen(false); return }
    try { const r = await listRevisions('video', assetId); setRevisions(r?.revisions || []) } catch { setRevisions([]) }
    setHistoryOpen(true)
  }

  // Seed trim + caption from the first proposed segment, once.
  const proposals = useMemo(() => (segData?.segments || []).filter((s) => s.status === 'proposed' || s.status === 'kept'), [segData])
  useEffect(() => {
    if (seededRef.current) return
    if (proposals.length) {
      const s = proposals[0]
      const st = Math.max(0, Number(s.start_sec) || 0)
      let en = Math.min(Number(s.end_sec) || st + 30, st + 60)
      if (videoDuration > 0) en = Math.min(en, videoDuration)
      setStartSec(st); setEndSec(en > st ? en : st + 1); setSelectedSegmentId(s.id); seededRef.current = true
    } else if (videoDuration > 0 && !seededRef.current) {
      setEndSec(Math.min(videoDuration, 60)); seededRef.current = true
    }
  }, [proposals, videoDuration])

  // When videoDuration first becomes known (loadedmetadata fires after proposals load
  // from cache), clamp endSec to the real video length regardless of seededRef state.
  useEffect(() => {
    if (videoDuration > 0) setEndSec((e) => Math.min(e, videoDuration))
  }, [videoDuration])

  // For a baked auto-reel, editTranscriptWords is the RAW source's word track;
  // slicing it to the source window [startSec,endSec] rebases to 0 and yields the
  // exact words reelFactory baked — so the live caption preview matches the clip
  // (and the un-captioned raw video underneath), WYSIWYG. For a manual clip it is
  // the asset's own transcript, unchanged.
  const rawWords = useMemo(() => sliceWords(editSource.transcriptWords, startSec, durationSec), [editSource, startSec, durationSec])
  // Source-relative word boundaries the trim handles soft-snap to, so a cut lands
  // BETWEEN words instead of slicing one in half — a straddling word gets clamped to
  // 0:00 by sliceWords and mistimes the first caption line (the "shrunk / messed up
  // caption timing" report). In-handle snaps to word STARTS, out-handle to word ENDS;
  // silent gaps carry no boundaries, so trims there stay free. transcriptWords are
  // absolute source seconds — the same space as startSec / span.
  const trimSnaps = useMemo(() => {
    const ws = Array.isArray(editSource.transcriptWords) ? editSource.transcriptWords : []
    const starts = [], ends = []
    for (const wd of ws) {
      const a = Number(wd?.start), b = Number(wd?.end)
      if (Number.isFinite(a)) starts.push(a)
      if (Number.isFinite(b)) ends.push(b)
    }
    return { starts, ends }
  }, [editSource])
  // Apply per-word corrections (keyed by absolute start time). A corrected word
  // carries `edited: true` so the Script list can mark it. Text-only change —
  // timings are untouched, so cut ranges and karaoke timing stay valid.
  const words = useMemo(() => {
    if (!wordEdits || !Object.keys(wordEdits).length) return rawWords
    const s = Math.max(0, startSec || 0)
    return rawWords.map((w) => {
      const fix = wordEdits[(w.start + s).toFixed(2)]
      return fix != null && fix !== w.word ? { ...w, word: fix, edited: true } : w
    })
  }, [rawWords, wordEdits, startSec])
  const editWord = useCallback((w, text) => {
    const clean = String(text || '').trim()
    if (!clean || clean === w.word) return
    const s = Math.max(0, startSec || 0)
    const key = (w.start + s).toFixed(2)
    setWordEdits((prev) => (prev[key] === clean ? prev : { ...prev, [key]: clean }))
  }, [startSec])
  // Instrument caption corrections (heard → fixed) so we can measure whether the
  // new timeline caption track actually gets used to fix words, and which terms
  // recur — the go/no-go signal for an auto-correct pass (Option A in
  // .claude/decisions.md "Auto-correct captions"). MEASUREMENT ONLY: nothing is
  // rewritten. Emits once at commit (blur/Enter), never per keystroke. PostHog
  // already attaches the workspace group, so per-workspace rate is queryable
  // without threading workspace through here.
  const logCaptionCorrection = useCallback((heard, fixed, source) => {
    const a = String(heard || '').trim(), b = String(fixed || '').trim()
    if (!a || !b || a.toLowerCase() === b.toLowerCase()) return
    posthogCapture('caption_correction', {
      source, // 'line' | 'word'
      heard: a.slice(0, 120),
      fixed: b.slice(0, 120),
      heard_words: a.split(/\s+/).length,
      fixed_words: b.split(/\s+/).length,
      asset_id: assetId || null,
    })
  }, [assetId])
  const derivedLines = useMemo(() => groupLines(words), [words])
  // captionLines / captionsEdited / captionsEditedRef are declared above (near
  // draftDoc) so the draft snapshot can persist edited caption text. Here we
  // seed them from the derived transcript lines and re-split on edit: editing a
  // line re-distributes its words across the line's time so karaoke still
  // animates, and the bake receives these EXACT words (captionWords override →
  // preview==publish for edited captions).
  // Re-seed only when the trim window or line count actually changes — NOT on a
  // bare asset-object refetch, and NOT once the user has manually edited a line.
  const seedSigRef = useRef('')
  useEffect(() => {
    // Include the derived TEXT (not just line count) so a word correction — which
    // changes a word without changing the line count — still re-seeds the caption
    // from the corrected transcript. Manual line edits stay protected by the
    // captionsEditedRef guard below.
    const sig = `${startSec}|${durationSec}|${derivedLines.map((l) => l.text).join('')}`
    if (sig === seedSigRef.current) return
    seedSigRef.current = sig
    if (captionsEditedRef.current) return
    setCaptionLines(derivedLines)
    setCaptionWin(startSec) // derivedLines are clip-relative to this window
  }, [derivedLines, startSec, durationSec])
  const resetCaptions = useCallback(() => {
    captionsEditedRef.current = false
    setCaptionsEdited(false)
    setCaptionLines(derivedLines)
    setCaptionWin(startSec)
  }, [derivedLines, startSec])
  const editLine = useCallback((i, text) => {
    captionsEditedRef.current = true
    setCaptionsEdited(true)
    setCaptionLines((prev) => prev.map((l, idx) => {
      if (idx !== i) return l
      const parts = text.trim().split(/\s+/).filter(Boolean)
      const span = Math.max(0.01, l.end - l.start)
      const w = parts.map((word, k) => ({
        word,
        start: +(l.start + span * k / parts.length).toFixed(2),
        end: +(l.start + span * (k + 1) / parts.length).toFixed(2),
      }))
      // Mark the line as user-authored so per-word transcript corrections skip
      // it (see the `lines` memo). Timing alone cannot discriminate: a rewritten
      // line's words are redistributed across the ORIGINAL line span, so its
      // first word always starts exactly at the first transcript word's start
      // and would collide with that word's correction key.
      return { ...l, text, words: w, userEdited: true }
    }))
  }, [])
  // Apply per-word corrections to the caption lines themselves, not just to the
  // Script list. The re-seed effect above is the ONLY route a word fix used to
  // take into the captions, and it bails once captionsEditedRef is set — so as
  // soon as a user hand-edited any one line, every later word correction showed
  // underlined in the Script tab but never reached the caption or the export.
  // That is the original "script not allowing change of words" report in a
  // narrower form, and the only escape was "Reset captions to transcript", which
  // throws away all their line edits.
  //
  // Lines the user rewrote themselves are skipped outright (l.userEdited) — their
  // typed text wins. Timing alone cannot make that call: editLine() redistributes
  // a rewritten line's words across the ORIGINAL line span, so its first word
  // always starts exactly at the first transcript word's start and would collide
  // with that word's correction key.
  const lines = useMemo(
    () => applyCaptionWindow(captionLines, { wordEdits, captionWin, startSec, durationSec }),
    [captionLines, wordEdits, captionWin, startSec, durationSec],
  )

  // playback: keep <video> within the trim window
  const togglePlay = useCallback(() => {
    const v = videoRef.current; if (!v) return
    if (playing) v.pause()
    // .catch swallows the promise rejection an undecodable source (a .mov / 4K
    // camera-original) throws — NotSupportedError — which was surfacing in prod
    // as an unhandled rejection. The <video>'s onError paints the fallback.
    else { if (v.currentTime < startSec || v.currentTime >= endSec) v.currentTime = startSec; v.playbackRate = speed; v.play().catch(() => {}) }
  }, [playing, startSec, endSec, speed])
  useEffect(() => { const v = videoRef.current; if (v) v.playbackRate = speed }, [speed])
  const seekClip = useCallback((clipT) => { const v = videoRef.current; if (!v) return; v.currentTime = startSec + clamp(clipT, 0, durationSec) }, [startSec, durationSec])
  // Nudge the playhead ~one frame (1/30s), clamped to the trim window.
  const stepFrame = useCallback((dir) => {
    const v = videoRef.current
    const nt = clamp((v ? v.currentTime : startSec) + dir / 30, startSec, endSec)
    if (v) { v.pause(); v.currentTime = nt }
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  // Jump the playhead by ±N seconds (keyboard shuttle), clamped to the trim
  // window. Keeps playback running if it was — only stepFrame pauses.
  const seekBy = useCallback((delta) => {
    const v = videoRef.current
    const nt = clamp((v ? v.currentTime : startSec) + delta, startSec, endSec)
    if (v) v.currentTime = nt
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  const seekToClip = useCallback((clipT) => {
    const v = videoRef.current
    const nt = clamp(startSec + clipT, startSec, endSec)
    if (v) v.currentTime = nt
    setCurrentTime(nt)
    setScrubT(clamp(nt - startSec, 0, durationSec))
  }, [startSec, endSec, durationSec])
  const toStart = useCallback(() => seekToClip(0), [seekToClip])
  const toEnd = useCallback(() => seekToClip(durationSec), [seekToClip, durationSec])
  // Standard editor keyboard transport (Space play/pause, arrows step, etc.).
  useVideoShortcuts({ togglePlay, stepFrame, seekBy, toStart, toEnd })

  const selectKey = useCallback((k) => {
    if (typeof k === 'string' && k.startsWith('overlay:')) setSel({ type: 'overlay', id: k.split(':')[1] })
    else setSel(k)
  }, [])
  const curOverlay = isOverlaySel(sel) ? overlays.find((o) => o.id === sel.id) : null

  // overlay actions
  const addOverlay = useCallback(() => {
    const id = `o${Date.now()}`
    setOverlays((prev) => [...prev, { id, role: 'callout', text: 'New text', x: 0.5, y: 0.5, size: 1, in: clamp(playClipT, 0, durationSec - 1), out: clamp(playClipT + 3, 1, durationSec), color: '#ffffff' }])
    setSel({ type: 'overlay', id })
  }, [playClipT, durationSec])
  const setOverlay = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (isOverlaySel(sel) && o.id === sel.id ? { ...o, [k]: v } : o))), [sel])
  const setOverlayTime = useCallback((k, v) => setOverlays((prev) => prev.map((o) => (isOverlaySel(sel) && o.id === sel.id ? { ...o, [k]: clamp(Number(v) || 0, 0, durationSec) } : o))), [sel, durationSec])
  // Set a specific overlay's in/out by id (used by the vertical timeline bar drag/resize).
  const setOverlayWindow = useCallback((id, inT, outT) => setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, in: clamp(inT, 0, durationSec), out: clamp(outT, 0, durationSec) } : o))), [durationSec])
  const delOverlay = useCallback(() => { setOverlays((prev) => prev.filter((o) => !(isOverlaySel(sel) && o.id === sel.id))); setSel('clip') }, [sel])
  const dragOverlay = useCallback((e, id) => {
    e.preventDefault(); e.stopPropagation()
    const frame = e.currentTarget.parentElement
    let moved = false
    const move = (ev) => {
      if (!moved) { moved = true; setDragging(true) }   // reveal guides on real drag
      const r = frame.getBoundingClientRect()
      let x = clamp((ev.clientX - r.left) / r.width, 0.06, 0.94)
      let y = clamp((ev.clientY - r.top) / r.height, 0.05, 0.95)
      const sv = Math.abs(x - 0.5) < 0.02; const sh = Math.abs(y - 0.5) < 0.02
      if (sv) x = 0.5
      if (sh) y = 0.5
      setSnap({ v: sv, h: sh })
      setOverlays((prev) => prev.map((o) => (o.id === id ? { ...o, x, y } : o)))
    }
    const up = () => {
      window.removeEventListener('mousemove', move); window.removeEventListener('mouseup', up)
      if (moved) { setDragging(false); setSnap({ v: false, h: false }) }
    }
    window.addEventListener('mousemove', move); window.addEventListener('mouseup', up)
  }, [])

  const handleTimeUpdate = useCallback((t) => {
    setCurrentTime(t)
    const v = videoRef.current
    if (v && t >= endSec) { v.pause(); v.currentTime = startSec }
  }, [endSec, startSec])

  const setGradeKey = useCallback((k, v) => setGrade((g) => ({ ...g, [k]: v })), [])
  const applyVibe = useCallback((p) => setGrade({ ...NEUTRAL_GRADE, ...p }), [])
  const resetGrade = useCallback(() => setGrade({ ...NEUTRAL_GRADE }), [])
  const setReframeKey = useCallback((k, v) => setReframe((r) => ({ ...r, [k]: v })), [])
  // WS6 auto-reframe — detect the speaker's face in the current frame and centre
  // the crop's horizontal position on them. Degrades to manual if no face / model.
  const [autoReframing, setAutoReframing] = useState(false)
  const autoReframe = useCallback(async () => {
    setAutoReframing(true)
    try {
      const cx = await detectFaceCenterX(videoRef.current)
      if (cx == null) { toast('No face detected — reframe manually'); return }
      setReframeKey('x', Math.round(cx * 100))
      toast('Centred on the speaker')
    } catch { toast('Auto-reframe unavailable') }
    finally { setAutoReframing(false) }
  }, [setReframeKey])
  const setKenBurns = useCallback((k, v) => setKenBurnsState((s) => ({ ...s, [k]: v })), [])
  const setCaption = useCallback((k, v) => setCaptionState((c) => ({ ...c, [k]: v })), [])
  const setSpeed = useCallback((s) => setSpeedState(s), [])
  // Edit-by-transcript cut handlers (all clip-relative to durationSec).
  const toggleWordCut = useCallback((w) => {
    const mid = (w.start + w.end) / 2
    setCuts((prev) => (inCut(mid, prev) ? subRange(prev, { start: w.start, end: w.end }, durationSec) : addRange(prev, { start: w.start, end: w.end }, durationSec)))
  }, [durationSec])
  const addCuts = useCallback((ranges) => setCuts((prev) => (ranges || []).reduce((acc, r) => addRange(acc, r, durationSec), prev)), [durationSec])
  const clearCuts = useCallback(() => setCuts([]), [])
  const trimToLine = useCallback((l) => {
    const ns = startSec + l.start
    const ne = Math.min(startSec + l.end, startSec + 60)
    setStartSec(ns); setEndSec(ne > ns ? ne : ns + 1)
    seededRef.current = true; toast('Trimmed to that line')
  }, [startSec])

  // Outputs — render ONCE with the full editor doc, then route to the chosen
  // destination (post / b-roll / ad sizes), or render the whole untouched source.
  const [exportOpen, setExportOpen] = useState(false)
  const [adExportOpen, setAdExportOpen] = useState(false)
  const [dest, setDest] = useState({ broll: true, ad: false })
  // Async b-roll export: the id of the destination row we're polling to
  // completion (null when idle). See exportMutation + the poll effect below.
  const [pollBrollId, setPollBrollId] = useState(null)
  const exportPollStartRef = useRef(0)
  const toggleDest = (k) => setDest((d) => ({ ...d, [k]: !d[k] }))

  // Inline "finalize this clip into a post" — Q's "create the post inline" so
  // approve + Sounds-like-me + publish all happen right here without exporting
  // and jumping to the Publish screen. One "Sounds like me" click renders the
  // trimmed clip, creates the content_item (clip-to-post), and approves it; the
  // header then swaps to the shared EditorWorkflowBar bound to that new post so
  // the publish controls (Schedule / queue / now) light up in place.
  // Embedded: bind the header workflow bar to the EXISTING piece from the start
  // (no clip-to-post creation) so Approve / Schedule / publish act on this reel.
  const [postId, setPostId] = useState(piece?.id ?? null)
  const updatePostStatus = useUpdateContentItemStatus()
  const { data: post } = useContentItem(postId)
  const finalizeToPost = useAppMutation({
    mutationFn: async () => {
      const render = await doRenderClip()
      const d = await apiFetch('/api/editorial/clip-to-post', {
        method: 'POST', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ assetId, renderedBlobUrl: render.blobUrl, captionText: captionSummary(), platform: 'instagram' }),
      })
      const id = d?.contentItemId
      if (!id) throw new Error('Could not create the post from this clip.')
      // "Sounds like me" is the sign-off — approve the fresh draft so the bar
      // lands on the publish step. approved_by is stamped server-side.
      await updatePostStatus.mutateAsync({ id, status: 'approved', approvedAt: new Date().toISOString() })
      return id
    },
    onSuccess: (id) => { setPostId(id); toast('Clip finalized & approved — ready to publish') },
  })
  const captionSummary = () => lines.map((l) => l.text).join(' ').slice(0, 500)
  const renderBody = () => ({
    // editAssetId is the RAW source for a baked auto-reel (else the asset itself),
    // and startSec/endSec are its source-relative window — so the bake renders the
    // un-captioned source once with these captions, never re-caption the baked clip.
    // captionsBaked (a baked broll with no clean source) forces subtitles off so a
    // re-render doesn't burn a SECOND track over the already-baked one.
    assetId: editAssetId, channels: [channelFor(format, piece?.platform)], startSec, durationSec, subtitles: !captionsBaked && caption.preset !== 'off',
    overlayPosition: caption.position, overlaySize: caption.size, captionAccent: caption.accent,
    captionAnim: caption.anim, captionStyle: caption.style,
    grade, reframe, speed, cuts,
    ...(kenBurns.motion && kenBurns.motion !== 'none' ? { kenBurns } : {}),
    // EXACT (possibly edited) caption words so the bake matches the preview.
    captionWords: lines.flatMap((l) => l.words),
    overlays: overlays.map((o) => ({ role: o.role, text: o.text, x: o.x, y: o.y, size: o.size, color: o.color, in: o.in, out: o.out })),
    // Music bed (WS3.3): the server resolves the URL from trackId (source of
    // truth), so we send only the id + mix options. Omitted when no track picked.
    ...(music.trackId ? { music: { trackId: music.trackId, volume: music.volume, duck: music.duck, fade: music.fade } } : {}),
  })
  // Render the current edit into a finished clip and resolve with its blob.
  //
  // The render runs ASYNC on a fresh worker budget (render-clip-job): kick a job
  // (202), then poll it to a terminal status. A long/hi-res EDITED reel used to
  // render inside ONE synchronous /api/editorial/render-clip request and 504 at
  // the 300s wall, which aborted the commit and made that reel un-publishable.
  // Offloading only the raw render keeps the return contract IDENTICAL
  // ({ blobUrl, width, height, sizeBytes, hadSubtitles }), so both callers
  // (saveVideoToPiece's media_urls finalization + finalizeToPost) are unchanged
  // — the stamp/draft/PATCH fidelity logic stays entirely client-side.
  //
  // Hard-capped: the worker has its own 300s budget and a stuck job is swept to
  // 'failed' by cron, so this never loops forever; on cap it throws so the
  // commit aborts (never ships a stale reel) with a legible message.
  async function doRenderClip() {
    const kicked = await startClipRenderJob(renderBody())
    const jobId = kicked?.jobId
    if (!jobId) throw new Error('Render did not start — please try again.')

    const CAP_MS = 6 * 60 * 1000
    const startedAt = Date.now()
    while (Date.now() - startedAt < CAP_MS) {
      await new Promise((r) => setTimeout(r, 2500))
      let job
      try {
        job = await getClipRenderJob(jobId)
      } catch {
        continue  // transient read blip — keep polling until the cap
      }
      if (job?.status === 'ready') {
        if (!job.blobUrl) throw new Error('Render returned no output.')
        return { blobUrl: job.blobUrl, width: job.width, height: job.height, sizeBytes: job.sizeBytes, hadSubtitles: job.hadSubtitles }
      }
      if (job?.status === 'failed') throw new Error(job.error || 'Render failed — please try again.')
    }
    throw new Error('Rendering took too long — please try again.')
  }

  // Embedded (video content piece) render-back. Editing a Reel from the publish
  // screen must bake the current edit (trim/captions/overlays/grade) and write
  // the finished clip back onto THIS piece's media_urls — so Approve/Schedule
  // publishes the EDITED video, never the untouched source. The per-asset edit
  // spec itself is already persisted by the autosave draft (media_assets.
  // video_edit_draft), so re-opening restores the timeline; here we only need to
  // persist the baked output the publisher will send. mediaAssetId stays the
  // SOURCE asset (so re-open re-edits from source), url is the baked render.
  const updateItem = useUpdateContentItem()
  const saveVideoToPiece = useAppMutation({
    errorMessage: 'Could not save the video to this post.',
    mutationFn: async () => {
      // Snapshot the draft we're about to render BEFORE the async work, so a mid-
      // render edit isn't wrongly marked as already-baked. Committed to
      // lastBakedDocRef only after the persist succeeds.
      const bakedSnapshot = draftDoc
      const bakedDoc = JSON.stringify(bakedSnapshot)
      // Stamp the SERVER-readable marker of what this render was made from, so
      // /week's inline Approve can tell an already-baked reel from one carrying
      // a pending edit and route the latter back here instead of dispatching the
      // stale render. See src/lib/videoEditFingerprint.js.
      const bakedPrint = videoEditFingerprint(bakedSnapshot)
      const render = await doRenderClip()
      const baked = {
        url: render.blobUrl,
        type: 'video',
        kind: 'video',
        mediaAssetId: pieceVideoEntry?.mediaAssetId || null,
        thumbnailUrl: pieceVideoEntry?.thumbnailUrl || null,
        ...(pieceVideoEntry?.name ? { name: pieceVideoEntry.name } : {}),
        ...(bakedPrint ? { [VIDEO_EDIT_HASH_KEY]: bakedPrint } : {}),
      }
      // Flush the exact doc the stamp describes to the asset now rather than
      // waiting on the 1500ms autosave debounce. Without this, a bake followed
      // immediately by an Approve elsewhere compares the new stamp against the
      // PREVIOUS draft and defers a reel that is in fact freshly baked.
      if (assetId) await updateMediaAsset(assetId, { videoEditDraft: bakedSnapshot }).catch(() => {})
      await updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: [baked] } })
      setLastBakedDoc(bakedDoc)
      // Return the fresh media_urls so an auto-bake-on-commit can dispatch THESE
      // (the parent's piece query can't have refetched yet in the same click).
      return [baked]
    },
    onSuccess: () => toast('Video saved to this post — approve & schedule when ready'),
  })

  // Bake the current edit into the post before a commit (Approve / Schedule /
  // Publish / Retry), but only when it differs from what was last baked — a
  // redundant Save→Approve won't re-render. Returns the freshly-baked media_urls
  // for the publish override, or null when nothing needed baking. Wired to the
  // embedded EditorWorkflowBar as onBeforeCommit; a throw (render failure)
  // propagates so the commit is aborted rather than shipping a stale reel.
  const bakeVideoIfDirty = useCallback(async () => {
    if (!embedded || !piece?.id || !videoEditDirty) return null
    return await saveVideoToPiece.mutateAsync()
  }, [embedded, piece?.id, videoEditDirty, saveVideoToPiece])

  // Swap the reel's SOURCE video. Writes the picked clip to media_urls through
  // the normal content PATCH so classifyMediaChange stamps media_source:'human'
  // — the same override signal that already trains Bernard's photo picking, now
  // for video. The new clip's assetId then differs, and StoryboardPublish keys
  // the editor on that id, so the whole editor remounts and re-hydrates cleanly
  // on the new source (the restore effect is one-shot per mount by design and
  // would otherwise strand the old clip's trim/captions on the new video).
  const swapVideoMutation = useAppMutation({
    errorMessage: 'Could not update the media on this post.',
    mutationFn: (entry) => piece?.id
      ? updateItem.mutateAsync({ id: piece.id, patch: { mediaUrls: [entry] } })
      : Promise.resolve(),
    // Type-aware: the same media_urls write backs both a clip swap (stays in this
    // editor, remounted on the new asset) and a switch to a photo (re-resolves to
    // a visual piece → StoryboardPublish routes it to the photo editor).
    onSuccess: (_data, entry) => {
      const isVid = entry?.type === 'video' || entry?.kind === 'video'
      toast(isVid
        ? 'Swapped — the new clip is loaded'
        : 'Switched to a photo — opening the photo editor')
    },
  })

  // ONE render → every selected destination. Post + b-roll share the single reel
  // render; ad export is its own (interactive) modal flow opened afterward.
  // Export = the non-post destinations (Library b-roll + ad sizes). The post
  // path moved inline (finalizeToPost above), so this no longer navigates away.
  const exportMutation = useAppMutation({
    mutationFn: async () => {
      let renderingAssetId = null
      if (dest.broll) {
        // Async export: the clip renders on a FRESH worker budget instead of
        // inline, so a long/hi-res clip can't blow the 300s ceiling → 504
        // ("Failed Export to library"). Returns fast (202) with the new b-roll
        // row id; we poll it to completion below. briefId is passed only when
        // this clip was opened from a Media Hub brief (the worker closes it on
        // success, scoped to workspace + this exact source asset).
        const r = await exportClipToBroll({ ...renderBody(), captionText: captionSummary(), ...(briefId ? { briefId } : {}) })
        renderingAssetId = r?.assetId || null
      }
      return { renderingAssetId }
    },
    onSuccess: ({ renderingAssetId }) => {
      if (dest.broll) {
        toast('Rendering your clip — it’ll appear in your Library shortly.')
        if (renderingAssetId) { exportPollStartRef.current = 0; setPollBrollId(renderingAssetId) }
      }
      setExportOpen(false)
      // Ad export is an interactive download modal — open it and STAY here.
      if (dest.ad) { setAdExportOpen(true) }
    },
  })
  // Poll the async b-roll export to completion so we can toast success/failure
  // without blocking the editor (the button frees the instant the 202 lands,
  // matching the full-video render UX). Hard-capped — the worker has its own
  // 300s budget and a stuck row is swept to 'failed' by cron within ~10min, so
  // this never loops forever.
  const EXPORT_POLL_CAP_MS = 6 * 60 * 1000
  const { data: pollBroll } = useQuery({
    queryKey: ['media-asset', pollBrollId],
    queryFn: () => getMediaAsset(pollBrollId),
    enabled: !!pollBrollId,
    refetchInterval: (q) => {
      if (!pollBrollId) return false
      const row = q.state.data
      if (row?.render_status && row.render_status !== 'rendering') return false
      if (!exportPollStartRef.current) exportPollStartRef.current = Date.now()
      if (Date.now() - exportPollStartRef.current > EXPORT_POLL_CAP_MS) return false
      return 2500
    },
    refetchOnWindowFocus: false,
  })
  useEffect(() => {
    if (!pollBrollId || !pollBroll) return
    const s = pollBroll.render_status
    if (s === 'ready') { toast('Clip saved to your Library.'); exportPollStartRef.current = 0; setPollBrollId(null) }
    else if (s === 'failed') { toast('Clip export failed — please try again.'); exportPollStartRef.current = 0; setPollBrollId(null) }
  }, [pollBrollId, pollBroll])
  const wholeMutation = useAppMutation({
    mutationFn: () => renderWholeVideo(assetId),
    onSuccess: () => { toast('Rendering the full-length video — track it on Moment Miner.'); navigate('/moments') },
  })
  // Karaoke fix for LEGACY clips (detected before words were persisted): re-run
  // detection (which now persists transcript_words), poll the asset until the
  // words land, then update the query cache so the preview + Words populate.
  const queryClient = useQueryClient()
  const genCaptionsMutation = useAppMutation({
    mutationFn: async () => {
      await findClips(assetId)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const a = await getMediaAsset(assetId)
        if (Array.isArray(a?.transcript_words) && a.transcript_words.length) {
          queryClient.setQueryData(['media-asset', assetId], a)
          return
        }
      }
      throw new Error('Transcription timed out — try again.')
    },
    onSuccess: () => toast('Captions generated.'),
  })

  // Auto-transcribe raw uploads (Phase 2). A Reel / long-video piece opened in
  // the publish shell whose video is a raw upload (no transcript_words — e.g.
  // b-roll that never went through the interview segmenter, like a phone-shot
  // clip) has no word timings, so the Caps/Script tabs would start empty and the
  // karaoke captions can't render. Fire the SAME transcription genCaptions uses,
  // once on open, so word-level caption editing is ready without the manual
  // "Generate captions" click — "video subtitle control works on every reel, not
  // just interview-derived clips". Scoped to the embedded reel flow (Q's
  // "auto-transcribe raw uploads"); standalone Moment Miner / Slate clips are
  // interview-derived and already carry a transcript, so this stays off there and
  // doesn't spend a transcription on every clip open. Guarded by a ref so it
  // fires at most once per mount, and it self-skips the instant words exist
  // (including right after it lands, since genCaptions writes them to the cache).
  const autoTranscribedRef = useRef(false)
  useEffect(() => {
    if (!embedded || autoTranscribedRef.current) return
    if (!asset || genCaptionsMutation.isPending) return
    const hasWords = Array.isArray(asset.transcript_words) && asset.transcript_words.length > 0
    if (asset.kind !== 'video' || hasWords) return
    autoTranscribedRef.current = true
    toast('Transcribing your video so you can edit the captions…')
    genCaptionsMutation.mutate()
  }, [embedded, asset, genCaptionsMutation])

  // Proposals (AI moments) — pick which moment to edit, discard, or find more.
  const applySegment = useCallback((seg) => {
    if (!seg) return
    const st = Math.max(0, Number(seg.start_sec) || 0)
    let en = Math.min(Number(seg.end_sec) || st + 30, st + 60)
    if (videoDuration > 0) en = Math.min(en, videoDuration)
    setStartSec(st); setEndSec(en > st ? en : st + 1); setSelectedSegmentId(seg.id)
    seededRef.current = true; toast('Switched to that moment')
  }, [videoDuration])
  const discardSegment = useCallback((id) => {
    updateSegment(id, 'discarded').then(() => queryClient.invalidateQueries({ queryKey: ['video-segments', assetId] })).catch(() => {})
    if (selectedSegmentId === id) setSelectedSegmentId(null)
  }, [assetId, selectedSegmentId, queryClient])

  // Deny the clip you're looking at, with an optional reason (migration 202).
  // The same status write the side-panel Discard link does — this is the header
  // affordance for it, because the link was findable enough to be used once in
  // 172 segments. Reasons ride along; skipping them still denies.
  const denyClip = useAppMutation({
    errorMessage: "Couldn't deny this clip",
    mutationFn: () => updateSegment(selectedSegmentId, 'discarded', { reasons: denyReasons, note: denyNote }),
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['video-segments', assetId] })
      posthogCapture('clip_denied', { assetId, segmentId: selectedSegmentId, reasons: denyReasons })
      setSelectedSegmentId(null)
      setDenyOpen(false); setDenyReasons([]); setDenyNote('')
      toast.success('Clip denied', { description: 'It won’t be offered again.' })
    },
  })
  const findMomentsMutation = useAppMutation({
    mutationFn: async () => {
      await findClips(assetId)
      for (let i = 0; i < 40; i++) {
        await new Promise((r) => setTimeout(r, 3000))
        const d = await getSegments(assetId)
        if (d?.status === 'ready') { queryClient.setQueryData(['video-segments', assetId], d); return }
        if (d?.status === 'failed') throw new Error('Find clips failed')
      }
      throw new Error('Find clips timed out')
    },
    onSuccess: () => toast('Found moments.'),
  })

  // Brand look — save the current grade as the workspace's brand vibe; the Brand
  // chip applies it. Merged into brand_style so colours/fonts are preserved.
  const brandGrade = asset?.workspace?.brand_style?.grade
  const saveBrandMutation = useAppMutation({
    mutationFn: async () => {
      await updateBrandStyle({ grade })  // merges grade into brand_style (brand kit)
      queryClient.invalidateQueries({ queryKey: ['media-asset', assetId] })
    },
    onSuccess: () => toast("Saved as your Brand look — it's now a vibe preset."),
  })

  // Save-as-template — the look of THIS clip becomes a reusable video template.
  // Authoring happens in the editor rather than a separate template screen, so
  // what you signed off on is literally what the bake produces. The dialog shows
  // the captured/skipped split before committing: a template that silently took
  // the wrong things is only discovered on the next reel.
  const [tplOpen, setTplOpen] = useState(false)
  const [tplName, setTplName] = useState('')
  const tplDraft = useMemo(
    () => buildTemplateFromEditor({ caption, overlays, durationSec }),
    [caption, overlays, durationSec],
  )
  function openSaveTemplate() {
    setTplName(suggestTemplateName({ caption, overlays }))
    setTplOpen(true)
  }
  const saveTemplateMutation = useAppMutation({
    mutationFn: async ({ name, makeDefault }) => {
      const row = await apiFetch('/api/video-templates', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ name, is_default: !!makeDefault, config: tplDraft.config }),
      })
      // The PIN is what the factory reads first (reelFactory resolves pin →
      // default row → built-in), so setting is_default alone is a silent no-op
      // for any workspace that already has one. "Use for new reels" has to move
      // the pin or it does nothing visible.
      if (makeDefault && row?.id) {
        await apiFetch('/api/workspace/me', {
          method: 'PATCH',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ reel_preset: row.id }),
        })
      }
      return row
    },
    onSuccess: (_d, vars) => {
      setTplOpen(false)
      toast(vars?.makeDefault
        ? `Saved "${vars.name}" — new reels use it from now on.`
        : `Saved "${vars?.name}" as a template.`)
    },
  })

  const [alignGuidesOn, setAlignGuidesOn] = useState(false)
  const alignGuideTimerRef = useRef(null)
  function flashAlignGuides() {
    if (alignGuideTimerRef.current) clearTimeout(alignGuideTimerRef.current)
    setAlignGuidesOn(true)
    alignGuideTimerRef.current = setTimeout(() => setAlignGuidesOn(false), 800)
  }
  // Clear the flash timer on unmount so it can't fire setAlignGuidesOn after teardown.
  useEffect(() => () => { if (alignGuideTimerRef.current) clearTimeout(alignGuideTimerRef.current) }, [])
  // Tap a caption box on the timeline (or a row in the Caption-lines list) →
  // jump the playhead onto that spoken line and open the Karaoke inspector,
  // whose Caption-lines list is where the words are edited (list → editLine).
  // We turn captions on first so tapping a box can't be a dead click when the
  // preset is off — you can't edit words you can't see.
  const editCaptionLine = useCallback((i) => {
    const l = lines[i]
    if (!l) return
    if (caption.preset === 'off') setCaption('preset', 'karaoke')
    const mid = clamp((l.start + l.end) / 2, 0, durationSec)
    const v = videoRef.current
    if (v) { v.pause(); v.currentTime = startSec + mid }
    setCurrentTime(startSec + mid)
    setScrubT(mid)
    selectKey('caption')
  }, [lines, caption.preset, startSec, durationSec, selectKey, setCaption])
  const busy = exportMutation.isPending || wholeMutation.isPending || finalizeToPost.isPending || saveVideoToPiece.isPending
  const anyDest = dest.broll || dest.ad

  // Workspace caption-size multiplier — the bake applies it
  // (brandRenderVideo.js karaoke fontSizePx: × (subtitle_font_size ?? 10)/10),
  // so the on-canvas preview must too or a workspace that customized subtitle
  // size sees a caption that doesn't match the exported reel. Mirror of the
  // server factor; 1.0 for the default (10). See the client/server caption
  // mirror-pair note in CLAUDE.md.
  const captionSizeFactor = (asset?.workspace?.brand_style?.subtitle_font_size ?? 10) / 10

  const ctx = {
    videoRef, asset, editVideoUrl, editPoster, captionsBaked, captionSizeFactor, sel, selectKey, railMode, setRailMode, grade, setGradeKey, applyVibe, resetGrade,
    format, setFormat, formatCss: (FORMATS[format] || FORMATS.reel).css, formatDim: (FORMATS[format] || FORMATS.reel).dim,
    reframe, setReframe: setReframeKey, autoReframe, autoReframing, kenBurns, setKenBurns, speed, setSpeed, caption, setCaption, overlays, addOverlay, setOverlay,
    setOverlayTime, setOverlayWindow, delOverlay, curOverlay, dragOverlay, lines, words, editLine, editWord, logCaptionCorrection, resetCaptions, captionsEdited, cuts, toggleWordCut, addCuts, clearCuts, playClipT, displayClipT, scrubT, setScrubT, playing, togglePlay, seekClip,
    startSec, endSec, durationSec, videoDuration, setStartSec, setEndSec, dragging, snap, trimToLine, trimSnaps,
    setVideoDuration, setPlaying, handleTimeUpdate,
    genCaptions: () => genCaptionsMutation.mutate(), genCaptionsPending: genCaptionsMutation.isPending,
    brandGrade, saveBrandGrade: () => saveBrandMutation.mutate(), savingBrand: saveBrandMutation.isPending,
    openSaveTemplate,
    editCaptionLine,
    music, setMusic,
    alignGuidesOn, flashAlignGuides,
    proposals, selectedSegmentId, applySegment, discardSegment,
    findMoments: () => findMomentsMutation.mutate(), findingMoments: findMomentsMutation.isPending, segDetecting: segData?.status === 'detecting',
    // Post caption: prefer the live-refetched content item, fall back to the
    // prop so the field is editable immediately (embedded) before `post` loads.
    captionPiece: post || piece || null, updateItem,
    // Media swap (embedded reels): the piece to repoint, its current video
    // entry, and the swap handler that writes it back through the content PATCH.
    piece, pieceVideoEntry,
    swapVideo: (entry) => swapVideoMutation.mutate(entry),
    swapping: swapVideoMutation.isPending,
  }

  if (isLoading) return <div role="status" className="flex justify-center py-24"><Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" /><span className="sr-only">Loading video…</span></div>
  if (error || !asset) {
    return (
      <div className="flex flex-col items-center justify-center gap-3 py-24 text-center">
        <AlertCircle className="h-8 w-8 text-destructive" />
        <p className="text-sm font-medium text-destructive">Could not load this clip</p>
        <Button size="sm" variant="outline" onClick={goBack}>Back</Button>
      </div>
    )
  }

  // Where this clip publishes. Embedded from a content piece → the piece's
  // platform pill (so the editor and the Weekly card agree on the destination);
  // standalone (Moment Miner / Slate) there's no destination, so the shape badge
  // carries the header instead.
  const destMeta = piece?.platform ? PLATFORM_META[piece.platform] : null
  return (
    <div className="flex h-[calc(100vh-3.5rem)] flex-col">
      {/* Shared top chrome (unified shell). Format switcher + transport + Export
          fold into the action slot; the side panel below is inspector-only. */}
      <EditorChrome
        onBack={goBack}
        title={asset.display_title || asset.filename || 'Clip'}
        destination={destMeta ? { icon: destMeta.icon, label: destMeta.label, colorClass: destMeta.color, bgClass: destMeta.bg, borderClass: destMeta.border } : null}
        badge={destMeta ? null : { icon: Film, label: (FORMATS[format] || FORMATS.reel).label, sub: (FORMATS[format] || FORMATS.reel).dim }}
      >
        {/* Transport */}
        <div className="flex items-center gap-2 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))' }}>
          <button onClick={() => stepFrame(-1)} className="rounded p-0.5 hover:opacity-70 text-muted-foreground" aria-label="Previous frame" title="Previous frame (←)"><ChevronLeft className="h-3.5 w-3.5" /></button>
          <Tooltip>
            <TooltipTrigger asChild>
              <button onClick={togglePlay} className="rounded p-0.5 hover:opacity-70 text-primary" aria-label={playing ? 'Pause' : 'Play'}>
                {playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}
              </button>
            </TooltipTrigger>
            <TooltipContent>{playing ? 'Pause' : 'Play'} · Space</TooltipContent>
          </Tooltip>
          <button onClick={() => stepFrame(1)} className="rounded p-0.5 hover:opacity-70 text-muted-foreground" aria-label="Next frame" title="Next frame (→)"><ChevronRight className="h-3.5 w-3.5" /></button>
          <span className="font-mono tabular-nums" style={{ color: 'hsl(var(--muted-foreground))' }}>{fmt(displayClipT)} / {fmt(durationSec)}</span>
        </div>
        <UndoRedoButtons canUndo={canUndo} canRedo={canRedo} onUndo={undo} onRedo={redo} />
        <SaveStatus status={saveStatus} />
        {/* Version history — auto-snapshots + restore */}
        <div className="relative">
          <button onClick={openHistory} className="flex items-center gap-1 rounded-lg border px-2 py-1 text-2xs" style={{ borderColor: 'hsl(var(--border))', color: 'hsl(var(--muted-foreground))' }} title="Version history" aria-label="Version history"><History className="h-3.5 w-3.5" /></button>
          {historyOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setHistoryOpen(false)} />
              <div role="menu" aria-label="Version history" className="absolute right-0 top-full z-40 mt-1 max-h-72 w-64 overflow-auto rounded-lg border bg-card p-1.5 shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Version history</p>
                {revisions.length === 0 ? (
                  <p className="px-1 py-2 text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>No saved versions yet — they appear as you edit.</p>
                ) : revisions.map((rv) => (
                  <button key={rv.id} onClick={() => { applyDoc(rv.doc); setHistoryOpen(false); toast('Restored a previous version') }} className="flex w-full items-center justify-between rounded-md px-2 py-1.5 text-2xs hover:bg-muted">
                    <span>{new Date(rv.created_at).toLocaleString([], { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })}</span>
                    <span className="font-medium text-primary">Restore</span>
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
        {/* Format — one clip, any shape. Drives the canvas aspect + render channel. */}
        <div className="flex gap-1" role="group" aria-label="Output format">
          {FORMAT_KEYS.map((k) => (
            <Tooltip key={k}>
              <TooltipTrigger asChild>
                <button
                  onClick={() => setFormat(k)}
                  className="flex flex-col items-center gap-0.5 rounded-md border px-2.5 py-1 text-3xs leading-tight"
                  style={segBtn(format === k)}
                >
                  <span className="font-medium">{FORMATS[k].label}</span>
                  <span style={{ opacity: 0.7 }}>{FORMATS[k].dim}</span>
                </button>
              </TooltipTrigger>
              <TooltipContent>{`${FORMATS[k].label} · ${FORMATS[k].dim}`}</TooltipContent>
            </Tooltip>
          ))}
        </div>
        {/* Approve + publish this clip inline. Before a post exists, one
            "Sounds like me" renders the clip → creates the post → approves it;
            then the shared workflow bar takes over with the publish controls,
            all without leaving the clip editor. */}
        {/* Embedded (Reel/long-video content piece): bake edits back to THIS
            post, then the shared workflow bar (bound to the existing piece)
            approves / schedules / publishes the edited video. */}
        {embedded ? (
          <>
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  size="sm"
                  disabled={busy}
                  loading={saveVideoToPiece.isPending}
                  onClick={() => saveVideoToPiece.mutate()}
                >
                  {!saveVideoToPiece.isPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {saveVideoToPiece.isPending ? 'Rendering… ~1 min' : 'Save video'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Renders your edits and saves the finished clip to this post (about a minute)</TooltipContent>
            </Tooltip>
            {post && <EditorWorkflowBar piece={post} onBeforeCommit={bakeVideoIfDirty} renderingReel={saveVideoToPiece.isPending} />}
          </>
        ) : post ? (
          <EditorWorkflowBar piece={post} />
        ) : (
          <>
            {/* Deny — the other half of the verdict. Only meaningful on a clip
                that hasn't become a post yet (once a post exists the workflow
                bar owns Approve/Reject), and only when a proposal is actually
                selected, since the verdict lands on that segment. Red per the
                house rule: approve=green, reject=red, brand teal reads as
                navigation. */}
            {selectedSegmentId && (
              <Popover
                open={denyOpen}
                onOpenChange={(o) => { setDenyOpen(o); if (!o) { setDenyReasons([]); setDenyNote('') } }}
              >
                <PopoverTrigger asChild>
                  <Button size="sm" variant="outline" disabled={busy} className="border-destructive/40 text-destructive hover:bg-destructive/10">
                    <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />Deny
                  </Button>
                </PopoverTrigger>
                <PopoverContent align="end" className="w-80 space-y-3">
                  <p className="text-sm font-semibold text-foreground">Why doesn&rsquo;t this clip work?</p>
                  <ClipDiscardReasons
                    reasons={denyReasons}
                    onToggleReason={(k) => setDenyReasons((rs) => (rs.includes(k) ? rs.filter((x) => x !== k) : [...rs, k]))}
                    note={denyNote}
                    onNoteChange={setDenyNote}
                  />
                  <Button
                    size="sm"
                    disabled={busy}
                    loading={denyClip.isPending}
                    onClick={() => denyClip.mutate()}
                    className="w-full bg-destructive text-destructive-foreground hover:bg-destructive/90"
                  >
                    {!denyClip.isPending && <ThumbsDown className="mr-1.5 h-3.5 w-3.5" />}
                    {denyClip.isPending ? 'Denying…' : 'Deny this clip'}
                  </Button>
                </PopoverContent>
              </Popover>
            )}
            <Tooltip>
              <TooltipTrigger asChild>
                <Button
                  variant="success"
                  size="sm"
                  disabled={busy}
                  loading={finalizeToPost.isPending}
                  onClick={() => finalizeToPost.mutate()}
                >
                  {!finalizeToPost.isPending && <Check className="mr-1.5 h-3.5 w-3.5" />}
                  {finalizeToPost.isPending ? 'Rendering clip…' : 'Approve'}
                </Button>
              </TooltipTrigger>
              <TooltipContent>Renders this clip into a post and approves it — then publish right here</TooltipContent>
            </Tooltip>
          </>
        )}
        {/* Export — b-roll + ad sizes. Hidden when embedded: on the publish
            screen the destination is THIS post, not a new Library clip / an ad
            download / a navigate-away whole-video render. */}
        {!embedded && (
        <div className="relative">
          <Button size="sm" disabled={busy} onClick={() => setExportOpen((v) => !v)} className="justify-center" style={{ background: 'hsl(var(--action))', color: 'hsl(var(--action-foreground))' }}>
            {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Export this clip<ChevronDown className="ml-1 h-3.5 w-3.5" />
          </Button>
          {exportOpen && (
            <>
              <div className="fixed inset-0 z-30" aria-hidden="true" onClick={() => setExportOpen(false)} />
              <div role="menu" aria-label="Export destination" className="absolute right-0 top-full z-40 mt-1 w-64 rounded-lg border bg-card p-2 shadow-lg" style={{ borderColor: 'hsl(var(--border))' }}>
                <p className="px-1 pb-1 text-3xs font-semibold uppercase tracking-wide" style={{ color: 'hsl(var(--muted-foreground))' }}>Send this clip to — pick any</p>
                {[
                  { k: 'broll', icon: FolderOpen, label: 'Save to Library', sub: 'Reusable b-roll clip' },
                  { k: 'ad', icon: Megaphone, label: 'Export for ads', sub: 'Download ad-sized versions' },
                ].map((o) => (
                  <label key={o.k} className="flex cursor-pointer items-center gap-2 rounded-md px-2 py-1.5 hover:bg-muted">
                    <input type="checkbox" checked={dest[o.k]} onChange={() => toggleDest(o.k)} />
                    <o.icon className="h-4 w-4 shrink-0" style={{ color: 'hsl(var(--muted-foreground))' }} />
                    <span className="min-w-0"><span className="block text-xs font-medium">{o.label}</span><span className="block text-3xs" style={{ color: 'hsl(var(--muted-foreground))' }}>{o.sub}</span></span>
                  </label>
                ))}
                <Button size="sm" disabled={busy || !anyDest} onClick={() => exportMutation.mutate()} className="mt-1.5 w-full justify-center" style={{ background: 'hsl(var(--action))', color: 'hsl(var(--action-foreground))' }}>
                  {busy ? <Loader2 className="mr-1 h-3.5 w-3.5 animate-spin" /> : null}Render &amp; send →
                </Button>
                <div className="my-1.5 border-t" style={{ borderColor: 'hsl(var(--border))' }} />
                <button disabled={busy} onClick={() => { setExportOpen(false); wholeMutation.mutate() }} className="flex w-full items-center gap-2 rounded-md px-2 py-1.5 text-left text-3xs hover:bg-muted disabled:opacity-50" style={{ color: 'hsl(var(--muted-foreground))' }}>
                  <Film className="h-3.5 w-3.5 shrink-0" />Render the whole untrimmed video instead
                </button>
              </div>
            </>
          )}
        </div>
        )}
      </EditorChrome>
      {/* Brief-origin hint — this clip was opened from a Media Hub edit brief.
          "Save to Library" is the action that closes the brief (marks it
          returned), so point the user at it. */}
      {briefId && (
        <div className="flex shrink-0 items-center gap-1.5 border-b bg-primary/5 px-4 py-1.5 text-2xs text-primary" style={{ borderColor: 'hsl(var(--border))' }}>
          <FolderOpen className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
          <span>Editing a Media Hub brief — <b>Save to Library</b> to mark it returned.</span>
        </div>
      )}
      {/* WORK AREA: rail | inspector | canvas on top, timeline spanning full width below */}
      <div className="flex min-h-0 flex-1 flex-col">
        <div className="flex min-h-0 flex-1">
          <IconRail ctx={ctx} />
          <aside className="flex w-[272px] shrink-0 flex-col border-r bg-card" style={{ borderColor: 'hsl(var(--border))' }}>
            <div className="min-h-0 flex-1 overflow-auto p-3">
              {sel === 'postcaption' && <PostCaptionInspector ctx={ctx} />}
              {sel === 'moments' && <MomentsInspector ctx={ctx} />}
              {sel === 'clip' && <ClipInspector ctx={ctx} />}
              {sel === 'media' && <MediaInspector ctx={ctx} />}
              {sel === 'grade' && <GradeInspector ctx={ctx} />}
              {sel === 'caption' && <CaptionInspector ctx={ctx} />}
              {sel === 'music' && <MusicInspector ctx={ctx} />}
              {sel === 'transcript' && <TranscriptInspector ctx={ctx} />}
              {isOverlaySel(sel) && <OverlayInspector ctx={ctx} />}
            </div>
          </aside>
          <Canvas ctx={ctx} />
        </div>
        <HorizontalTimeline ctx={ctx} />
      </div>
      {adExportOpen && (
        <AdVideoExportModal
          clip={{ assetId, startSec, durationSec, captionText: captionSummary(), overlayPosition: caption.position, overlaySize: caption.size, title: asset?.display_title || asset?.filename }}
          onClose={() => setAdExportOpen(false)}
        />
      )}

      {tplOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center p-4">
          <div className="fixed inset-0 bg-black/50" aria-hidden="true" onClick={() => setTplOpen(false)} />
          <div role="dialog" aria-modal="true" aria-label="Save as video template"
            className="relative w-full max-w-md rounded-xl border bg-card p-5 shadow-lg">
            <h2 className="text-base font-semibold">Save as video template</h2>
            <p className="mt-1 text-xs text-muted-foreground">
              New video posts will be able to use this look. It saves the styling, not this clip&apos;s content.
            </p>

            <label className="mt-4 block text-2xs font-semibold uppercase tracking-wide text-muted-foreground" htmlFor="tpl-name">Name</label>
            <input id="tpl-name" value={tplName} onChange={(e) => setTplName(e.target.value)} maxLength={80}
              className="mt-1 w-full rounded-md border bg-background px-2.5 py-1.5 text-sm" />

            <div className="mt-4 space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">What carries over</p>
              {tplDraft.captured.map((c) => (
                <p key={c} className="flex gap-1.5 text-xs text-foreground"><Check className="mt-0.5 h-3 w-3 shrink-0 text-primary" />{c}</p>
              ))}
            </div>
            <div className="mt-3 space-y-1.5">
              <p className="text-2xs font-semibold uppercase tracking-wide text-muted-foreground">Stays with this clip</p>
              {tplDraft.skipped.map((s) => (
                <p key={s} className="pl-4.5 text-xs text-muted-foreground">{s}</p>
              ))}
            </div>

            <div className="mt-5 flex items-center justify-between gap-3">
              <button type="button" onClick={() => setTplOpen(false)} className="text-xs text-muted-foreground hover:underline">Cancel</button>
              <div className="flex gap-2">
                <button type="button" disabled={!tplName.trim() || saveTemplateMutation.isPending}
                  onClick={() => saveTemplateMutation.mutate({ name: tplName.trim(), makeDefault: false })}
                  className="rounded-md border px-3 py-1.5 text-xs disabled:opacity-60">Save</button>
                <button type="button" disabled={!tplName.trim() || saveTemplateMutation.isPending}
                  onClick={() => saveTemplateMutation.mutate({ name: tplName.trim(), makeDefault: true })}
                  className="flex items-center gap-1.5 rounded-md px-3 py-1.5 text-xs text-primary-foreground disabled:opacity-60"
                  style={{ background: 'hsl(var(--primary))' }}>
                  {saveTemplateMutation.isPending && <Loader2 className="h-3.5 w-3.5 animate-spin" />}
                  Save &amp; use for new reels
                </button>
              </div>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
