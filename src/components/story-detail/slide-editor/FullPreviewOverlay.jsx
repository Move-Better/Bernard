import { useEffect } from 'react'
import {
  X, Smartphone, ChevronLeft, ChevronRight,
  Heart, MessageCircle, Send, Bookmark, Facebook, Linkedin, ThumbsUp, Repeat2, MapPin,
} from 'lucide-react'
import { resolveTheme } from '@/lib/photoTemplates'
import { photoSourceUrl } from '@/lib/mediaEntry'
import MiniSlideCanvas from './MiniSlideCanvas'
import { ASPECT_STAGE } from './shared'

// ── Phone-mockup preview overlay (renders the REAL slide) ────────────────────

// Per-platform chrome for the full-preview overlay — mirrors the treatments in
// PostPreview.jsx so this overlay stops always looking like Instagram
// regardless of the piece's actual target platform (facebook/linkedin/gbp
// carousels and single-visual posts all route through SlideEditor).
const OVERLAY_PLATFORM_CHROME = {
  facebook: {
    avatar: <div className="h-7 w-7 rounded-full bg-[#1877f2] flex items-center justify-center"><Facebook className="h-4 w-4 text-white" /></div>,
    actions: (
      <>
        <ThumbsUp className="h-4.5 w-4.5" />
        <MessageCircle className="h-4.5 w-4.5" />
        <Repeat2 className="ml-auto h-4.5 w-4.5" />
      </>
    ),
  },
  linkedin: {
    avatar: <div className="h-7 w-7 rounded bg-[#0a66c2] flex items-center justify-center"><Linkedin className="h-4 w-4 text-white" /></div>,
    actions: (
      <>
        <ThumbsUp className="h-4.5 w-4.5" />
        <MessageCircle className="h-4.5 w-4.5" />
        <Repeat2 className="h-4.5 w-4.5" />
        <Send className="ml-auto h-4.5 w-4.5" />
      </>
    ),
  },
  gbp: {
    avatar: <div className="h-7 w-7 rounded-full bg-primary flex items-center justify-center"><MapPin className="h-4 w-4 text-white" /></div>,
    actions: null,
  },
}
const DEFAULT_OVERLAY_CHROME = {
  avatar: (
    <div className="h-7 w-7 rounded-full bg-gradient-to-tr from-amber-400 to-rose-500 p-[2px]">
      <div className="h-full w-full rounded-full bg-white p-[1.5px]"><div className="h-full w-full rounded-full bg-muted" /></div>
    </div>
  ),
  actions: (
    <>
      <Heart className="h-5 w-5" />
      <MessageCircle className="h-5 w-5" />
      <Send className="h-5 w-5" />
      <Bookmark className="ml-auto h-5 w-5" />
    </>
  ),
}

export default function FullPreviewOverlay({ slides, activeIdx, mediaUrls, brandStyle, themeId, customThemes, workspace, caption, platform, aspect = '4:5', onClose, onNav }) {
  // Keyboard navigation + ESC
  useEffect(() => {
    function handleKey(e) {
      if (e.key === 'Escape') onClose()
      if (e.key === 'ArrowRight') onNav(1)
      if (e.key === 'ArrowLeft') onNav(-1)
    }
    document.addEventListener('keydown', handleKey)
    return () => document.removeEventListener('keydown', handleKey)
  }, [onClose, onNav])

  const slide = slides[activeIdx]
  if (!slide) return null

  // Render the REAL slide (renderFreeformSlide via MiniSlideCanvas) inside a
  // phone frame — "how people actually see it", and identical to what publishes.
  // Replaces the old fullscreen CSS approximation, which drew a DIFFERENT look
  // from the canvas/bake (a preview != published gap).
  const photoUrl = typeof slide.photo_idx === 'number' && mediaUrls[slide.photo_idx]
    ? photoSourceUrl(mediaUrls[slide.photo_idx])
    : null
  const theme = resolveTheme(slide.template_id || themeId, customThemes)
  const handle = workspace?.slug || workspace?.display_name || 'yourbrand'
  const text = (caption || '').replace(/\s+/g, ' ').trim()
  const snippet = text.slice(0, 90)
  const chrome = OVERLAY_PLATFORM_CHROME[platform] || DEFAULT_OVERLAY_CHROME
  const stageAspect = ASPECT_STAGE[aspect]?.twAspect || 'aspect-[4/5]'
  // Re-render the canvas when anything that affects the pixels changes.
  const renderKey = [
    activeIdx, photoUrl || '', slide.template_id || themeId || '',
    (slide.blocks || []).map((b) => `${b.role}:${b.text}:${typeof b.position === 'object' ? `${b.position.x},${b.position.y}` : b.position}:${b.fontScale || ''}:${b.color || ''}:${b.fontWeight || ''}:${b.uppercase ?? ''}:${b.italic ? 'i' : ''}:${b.underline ? 'u' : ''}:${b.letterSpacing || ''}:${b.lineHeight || ''}:${b.shadow || ''}:${b.textEffect || ''}:${b.effectIntensity || ''}:${b.effectColor || ''}:${b.runs ? JSON.stringify(b.runs) : ''}`).join('~'),
    (slide.objects || []).map((o) => `${o.type}:${o.src}:${o.x},${o.y}:${o.scale}:${o.opacity}`).join('~'),
    slide.photo_zoom ?? 'fill',
    slide.photo_fill ?? '',
    slide.photo_offset ? `${slide.photo_offset.x},${slide.photo_offset.y}` : '',
    slide.grade ? JSON.stringify(slide.grade) : '',
  ].join('|')

  return (
    <div role="dialog" aria-modal="true" aria-label="Slide preview" className="fixed inset-0 z-[100] flex flex-col items-center justify-center bg-black/80 p-6">
      {/* Top bar */}
      <div className="absolute top-0 inset-x-0 z-10 flex items-center gap-3 px-5 py-3">
        <Smartphone className="h-4 w-4 text-white/70" />
        <span className="text-sm font-medium text-white/90">Preview — how it’ll appear</span>
        <span className="text-xs text-white/50">{activeIdx + 1} / {slides.length}</span>
        <button
          type="button"
          onClick={onClose}
          className="ml-auto h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 flex items-center justify-center text-white"
          aria-label="Close preview"
        >
          <X className="h-5 w-5" aria-hidden="true" />
        </button>
      </div>

      <div className="flex items-center gap-4">
        <button
          type="button"
          onClick={() => onNav(-1)}
          disabled={activeIdx === 0}
          aria-label="Previous slide"
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronLeft className="h-7 w-7" aria-hidden="true" />
        </button>

        {/* iPhone frame with platform-specific chrome + the real rendered slide */}
        <div className="relative rounded-[2.5rem] border-[10px] border-black bg-black shadow-2xl" style={{ width: 320 }}>
          <div className="absolute left-1/2 top-0 z-20 h-5 w-28 -translate-x-1/2 rounded-b-2xl bg-black" />
          <div className="overflow-hidden rounded-[1.9rem] bg-white">
            {/* Header — avatar + handle styled per target platform */}
            <div className="flex items-center gap-2 px-3 py-2">
              {chrome.avatar}
              <span className="text-2xs font-semibold text-foreground">{handle}</span>
            </div>
            {/* The real slide */}
            <div className={`relative ${stageAspect} w-full bg-muted`}>
              <MiniSlideCanvas
                renderSlide={slide}
                photoUrl={photoUrl}
                brandStyle={brandStyle}
                theme={theme}
                renderKey={renderKey}
              />
              {slides.length > 1 && (
                <span className="absolute right-2 top-2 rounded-full bg-black/55 px-2 py-0.5 text-3xs font-semibold text-white">{activeIdx + 1}/{slides.length}</span>
              )}
            </div>
            {/* Action row — platform-specific (or omitted, e.g. GBP has none) */}
            {chrome.actions && (
              <div className="flex items-center gap-4 px-3 py-2 text-foreground" aria-hidden="true">
                {chrome.actions}
              </div>
            )}
            {slides.length > 1 && (
              <div className="flex justify-center gap-1 pb-1">
                {slides.map((_, i) => (
                  <span key={i} className={`h-1.5 w-1.5 rounded-full ${i === activeIdx ? 'bg-primary' : 'bg-muted-foreground/30'}`} />
                ))}
              </div>
            )}
            {snippet && (
              <p className="px-3 pb-3 pt-1 text-2xs leading-snug text-foreground">
                <span className="font-semibold">{handle}</span> {snippet}{text.length > 90 ? '… ' : ' '}
                {text.length > 90 && <span className="text-muted-foreground">more</span>}
              </p>
            )}
          </div>
        </div>

        <button
          type="button"
          onClick={() => onNav(1)}
          disabled={activeIdx === slides.length - 1}
          aria-label="Next slide"
          className="h-12 w-12 shrink-0 rounded-full bg-white/10 hover:bg-white/20 text-white flex items-center justify-center disabled:opacity-20 transition-colors"
        >
          <ChevronRight className="h-7 w-7" aria-hidden="true" />
        </button>
      </div>

      <p className="mt-4 text-xs text-white/45">← → to navigate · Esc to close · the real rendered slide — exactly what publishes</p>
    </div>
  )
}
