import React from 'react'
import ReactMarkdown from 'react-markdown'
import { Heart, MessageCircle, Send, Bookmark, ThumbsUp, Repeat2, Globe, MapPin, ChevronLeft, ChevronRight, Play } from 'lucide-react'
import emailTemplateHtml from '../email-template.html?raw'
import { workspace } from '@/lib/workspace'
import { useWorkspace } from '@/lib/WorkspaceContext'
import { renderFreeformSlide, SLIDE_W, SLIDE_H } from '@/lib/overlayTemplates'
import { resolveTheme } from '@/lib/photoTemplates'
import { usePhotoTemplates } from '@/lib/queries'
import { pickHero } from '@/lib/publishImageMirror'
import { isVideoEntry, photoSourceUrl } from '@/lib/mediaEntry'
import { deriveStory } from '@/lib/storyFields'

// Pull the best logo URL for previews, preferring Brand Kit (primary_logo_url
// is resolved by api/workspace/me from brand_kit_roles), then any legacy
// workspaces.logo.main, then the static per-deploy fallback.
function useWorkspaceLogo() {
  const ws = useWorkspace()
  return ws?.primary_logo_url
    ?? ws?.logo?.main
    ?? workspace.logo.main
}

// Brand identity used in mock previews — sourced from src/lib/workspace.js
const MB_HANDLE   = workspace.social.instagram
const MB_NAME     = workspace.name
const MB_LOCATION = workspace.location
const MB_INITIALS = workspace.socialAvatarInitials
const MB_BLURB    = workspace.linkPreviewBlurb
const MB_HOSTNAME = workspace.websiteHostname
const MB_INDUSTRY = workspace.linkedInIndustry
const MB_BOOKING  = workspace.prompt.bookingUrl

// Highlight hashtags and @mentions in social copy
function SocialText({ text }) {
  if (!text) return null
  const parts = text.split(/(\s+)/)
  return (
    <span>
      {parts.map((part, i) => {
        if (part.startsWith('#') || part.startsWith('@')) {
          return <span key={i} className="text-primary">{part}</span>
        }
        return <span key={i}>{part}</span>
      })}
    </span>
  )
}

// Resolve the best displayable URL for a media item. After the Drive
// phase-out, every media item ships a direct Vercel Blob URL; the
// historical /api/drive/media fallback (now removed) is no longer needed.
function mediaSrc(m) {
  if (!m) return null
  return m.url || m.thumbnailUrl || null
}

// ── Carousel — shared by Instagram and Facebook ───────────────────────────────
// Per-slide canvas — draws photo + freeform text blocks via the renderer.
// `theme` MUST be passed: renderFreeformSlide keys layout/palette/per-block
// styling off it, so omitting it renders an un-themed fallback that doesn't
// match the editor or the published bake.
function SlideCanvas({ slide, photo, brandStyle, theme }) {
  const canvasRef = React.useRef(null)
  React.useEffect(() => {
    const canvas = canvasRef.current
    if (!canvas) return
    let cancelled = false
    async function draw() {
      try {
        await renderFreeformSlide({
          sourceUrl: photoSourceUrl(photo),
          slide,
          brandStyle: brandStyle || {},
          canvas,
          theme,
          width: SLIDE_W,
          height: SLIDE_H,
        })
      } catch (e) {
        if (!cancelled) console.warn('[SlideCanvas] render failed', e?.message)
      }
    }
    draw()
    return () => { cancelled = true }
  }, [slide, photo, brandStyle, theme])
  return <canvas ref={canvasRef} className="absolute inset-0 w-full h-full" aria-hidden="true" />
}

function SlidesCarousel({ slides, mediaUrls, photoTemplateId = null }) {
  const [idx, setIdx] = React.useState(0)
  const ws = useWorkspace()
  const brandStyle = ws?.brand_style || {}
  // Resolve the same theme the editor and the publish bake use: per-slide
  // override (slide.template_id) falls back to the deck theme (photoTemplateId).
  const { data: allThemes = [] } = usePhotoTemplates()
  const customThemes = allThemes.filter((t) => t.custom)
  const total = slides.length

  if (total === 0) {
    return <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-square" />
  }

  const slide = slides[idx]
  const photo = typeof slide.photo_idx === 'number' ? mediaUrls[slide.photo_idx] : null
  const theme = resolveTheme(slide.template_id || photoTemplateId, customThemes)

  return (
    <div className="relative aspect-[4/5] overflow-hidden bg-black select-none">
      <SlideCanvas slide={slide} photo={photo} brandStyle={brandStyle} theme={theme} />

      {total > 1 && (
        <>
          {idx > 0 && (
            <button
              onClick={() => setIdx(idx - 1)}
              aria-label="Previous slide"
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors z-10"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {idx < total - 1 && (
            <button
              onClick={() => setIdx(idx + 1)}
              aria-label="Next slide"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors z-10"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          <div className="absolute top-2 right-2 bg-black/50 text-white text-3xs font-medium px-1.5 py-0.5 rounded-full z-10" aria-hidden="true">
            {idx + 1} / {total}
          </div>
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1 z-10" role="tablist" aria-label="Slides">
            {slides.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                role="tab"
                aria-label={`Slide ${i + 1}`}
                aria-selected={i === idx}
                className={`rounded-full transition-all ${i === idx ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

function MediaCarousel({ mediaUrls, aspectClass = 'aspect-square' }) {
  const [idx, setIdx] = React.useState(0)
  const total = mediaUrls.length
  const logoSrc = useWorkspaceLogo()

  if (total === 0) {
    return (
      <div className={`bg-muted ${aspectClass} flex flex-col items-center justify-center gap-2`}>
        <img src={logoSrc} alt={workspace.name} className="h-16 w-auto opacity-30" />
        <p className="text-xs text-muted-foreground">Add media in the editor</p>
      </div>
    )
  }

  const m   = mediaUrls[idx]
  const src = mediaSrc(m)

  return (
    <div className={`relative ${aspectClass} overflow-hidden bg-black select-none`}>
      {/* Slide */}
      {m.type === 'video' ? (
        <div className="absolute inset-0 bg-slate-900 flex flex-col items-center justify-center gap-2">
          {src ? (
            <img src={src} alt={m.name} className="w-full h-full object-cover opacity-70" loading="lazy" decoding="async" onError={(e) => { e.target.style.display = 'none' }} />
          ) : null}
          <div className="absolute inset-0 flex items-center justify-center">
            <div className="h-12 w-12 rounded-full bg-black/50 flex items-center justify-center">
              <Play className="h-6 w-6 text-white ml-1" />
            </div>
          </div>
          <p className="absolute bottom-2 left-0 right-0 text-center text-3xs text-white/60 px-4 line-clamp-1">{m.name}</p>
        </div>
      ) : src ? (
        <img src={src} alt={m.name} className="absolute inset-0 w-full h-full object-cover" loading="lazy" decoding="async" />
      ) : (
        <div className="absolute inset-0 bg-muted flex items-center justify-center">
          <p className="text-xs text-muted-foreground">{m.name}</p>
        </div>
      )}

      {/* Prev / Next arrows */}
      {total > 1 && (
        <>
          {idx > 0 && (
            <button
              onClick={() => setIdx(idx - 1)}
              aria-label="Previous slide"
              className="absolute left-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <ChevronLeft className="h-4 w-4" aria-hidden="true" />
            </button>
          )}
          {idx < total - 1 && (
            <button
              onClick={() => setIdx(idx + 1)}
              aria-label="Next slide"
              className="absolute right-1.5 top-1/2 -translate-y-1/2 h-7 w-7 rounded-full bg-black/50 text-white flex items-center justify-center hover:bg-black/70 transition-colors"
            >
              <ChevronRight className="h-4 w-4" aria-hidden="true" />
            </button>
          )}

          {/* Slide counter */}
          <div className="absolute top-2 right-2 bg-black/50 text-white text-3xs font-medium px-1.5 py-0.5 rounded-full" aria-hidden="true">
            {idx + 1} / {total}
          </div>

          {/* Dot indicators */}
          <div className="absolute bottom-2 left-0 right-0 flex justify-center gap-1" role="tablist" aria-label="Slides">
            {mediaUrls.map((_, i) => (
              <button
                key={i}
                onClick={() => setIdx(i)}
                role="tab"
                aria-label={`Slide ${i + 1}`}
                aria-selected={i === idx}
                className={`rounded-full transition-all ${i === idx ? 'w-2 h-2 bg-white' : 'w-1.5 h-1.5 bg-white/50'}`}
              />
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// A single video attached to an Instagram post publishes as a Reel (9:16),
// not a photo carousel — Instagram/Buffer can't mix photo + video in one post.
// Shows the video in portrait with a Reel marker; the play-over-thumbnail
// treatment matches MediaCarousel (real inline playback isn't needed for a
// preview, and any on-clip text was already baked upstream in Slate).
function ReelPreview({ video }) {
  const src = mediaSrc(video)
  return (
    <div className="relative mx-auto aspect-[9/16] max-h-[70vh] overflow-hidden bg-slate-900 select-none">
      {src ? (
        <img
          src={video.thumbnailUrl || src}
          alt={video.name || ''}
          className="absolute inset-0 h-full w-full object-cover opacity-80"
          loading="lazy"
          decoding="async"
          onError={(e) => { e.target.style.display = 'none' }}
        />
      ) : null}
      <div className="absolute inset-0 flex items-center justify-center">
        <div className="flex h-14 w-14 items-center justify-center rounded-full bg-black/50">
          <Play className="ml-1 h-7 w-7 text-white" />
        </div>
      </div>
      <span className="absolute right-2 top-2 z-10 rounded-full bg-black/55 px-2 py-0.5 text-3xs font-medium text-white">
        Reel
      </span>
      {video.name && (
        <p className="absolute bottom-2 left-0 right-0 line-clamp-1 px-4 text-center text-3xs text-white/60">
          {video.name}
        </p>
      )}
    </div>
  )
}

// ── Instagram ────────────────────────────────────────────────────────────────
function InstagramPreview({ content, mediaUrls = [], slides = null, photoTemplateId = null }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 4).join('\n')
  const hasMore = lines.length > 4

  // A video attached → this is a Reel (9:16 single video), not a photo carousel.
  // Instagram/Buffer can't mix photo + video in one post (mixed carousel parked,
  // blocked on Buffer — see .claude/ideas.md). The first video wins as the Reel.
  const reelVideo = mediaUrls.find(isVideoEntry) || null

  // When slides exist, render the carousel as one canvas per slide (photo +
  // baked text blocks). When slides are absent (legacy/fresh draft), fall back
  // to plain media carousel with no on-photo text — backfill covers all
  // pre-existing rows so this branch only hits brand-new in-progress drafts.
  const hasSlides = Array.isArray(slides) && slides.length > 0

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      {/* Header */}
      <div className="flex items-center gap-3 px-4 py-3 border-b">
        <div className="h-9 w-9 rounded-full bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
          {MB_INITIALS}
        </div>
        <div>
          <p className="text-xs font-semibold">{MB_HANDLE}</p>
          <p className="text-3xs text-muted-foreground">{MB_LOCATION}</p>
        </div>
        <button className="ml-auto text-xs font-semibold text-info">Follow</button>
      </div>

      {/* Reel (video) takes precedence over the photo carousel. */}
      <div className="relative">
        {reelVideo
          ? <ReelPreview video={reelVideo} />
          : hasSlides
            ? <SlidesCarousel slides={slides} mediaUrls={mediaUrls} photoTemplateId={photoTemplateId} />
            : <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-square" />}
      </div>

      {/* Actions */}
      <div className="px-4 pt-3 pb-1 flex items-center gap-4">
        <Heart className="h-6 w-6" />
        <MessageCircle className="h-6 w-6" />
        <Send className="h-6 w-6" />
        <Bookmark className="h-6 w-6 ml-auto" />
      </div>

      {/* Caption */}
      <div className="px-4 pb-4">
        <p className="text-xs font-semibold mb-1">{MB_HANDLE}</p>
        <p className="text-xs leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">more</button>
          )}
        </p>
      </div>
    </div>
  )
}

// ── Facebook ─────────────────────────────────────────────────────────────────
function FacebookPreview({ content, mediaUrls = [] }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 5).join('\n')
  const hasMore = lines.length > 5

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="px-4 pt-4 pb-3">
        {/* Author */}
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <div className="flex items-center gap-1 text-3xs text-muted-foreground">
              <Globe className="h-3 w-3" /> Public · Just now
            </div>
          </div>
        </div>

        {/* Content */}
        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-info ml-1 text-sm">See more</button>
          )}
        </p>
      </div>

      {/* Media carousel */}
      {mediaUrls.length > 0 && (
        <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-video" />
      )}

      {/* Link preview */}
      <div className="border-t bg-slate-50 px-4 py-3">
        <p className="text-3xs text-muted-foreground uppercase tracking-wide">{MB_HOSTNAME}</p>
        <p className="text-xs font-semibold mt-0.5">{MB_NAME} · {MB_LOCATION}</p>
        <p className="text-2xs text-muted-foreground mt-0.5">{MB_BLURB}</p>
      </div>

      {/* Reactions bar */}
      <div className="px-4 py-2 border-t flex items-center gap-4 text-xs text-muted-foreground">
        <button className="flex items-center gap-1.5 hover:text-info"><ThumbsUp className="h-4 w-4" /> Like</button>
        <button className="flex items-center gap-1.5 hover:text-info"><MessageCircle className="h-4 w-4" /> Comment</button>
        <button className="flex items-center gap-1.5 hover:text-info"><Repeat2 className="h-4 w-4" /> Share</button>
      </div>
    </div>
  )
}

// ── LinkedIn ─────────────────────────────────────────────────────────────────
function LinkedInPreview({ content }) {
  const [showFull, setShowFull] = React.useState(false)
  const lines = (content || '').split('\n')
  const preview = lines.slice(0, 5).join('\n')
  const hasMore = lines.length > 5

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-start gap-3 mb-3">
          <div className="h-12 w-12 rounded-sm bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-sm font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <p className="text-2xs text-muted-foreground">{MB_INDUSTRY} · {MB_LOCATION}</p>
            <p className="text-3xs text-muted-foreground">Just now · 🌐</p>
          </div>
          <button className="ml-auto text-xs font-semibold text-info border border-info rounded-full px-3 py-1">+ Follow</button>
        </div>

        <p className="text-sm leading-relaxed whitespace-pre-wrap">
          <SocialText text={showFull ? content : preview} />
          {!showFull && hasMore && (
            <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">…more</button>
          )}
        </p>
      </div>

      <div className="px-4 py-2 border-t flex items-center gap-4 text-xs text-muted-foreground">
        <button className="flex items-center gap-1.5 hover:text-info"><ThumbsUp className="h-4 w-4" /> Like</button>
        <button className="flex items-center gap-1.5 hover:text-info"><MessageCircle className="h-4 w-4" /> Comment</button>
        <button className="flex items-center gap-1.5 hover:text-info"><Repeat2 className="h-4 w-4" /> Repost</button>
        <button className="flex items-center gap-1.5 hover:text-info"><Send className="h-4 w-4" /> Send</button>
      </div>
    </div>
  )
}

// ── Google Business Profile ───────────────────────────────────────────────────
function GBPPreview({ content, locationOverrides }) {
  const overrideEntries = locationOverrides
    ? Object.entries(locationOverrides).filter(([, v]) => v?.content)
    : []
  const hasMultiple = overrideEntries.length > 0
  const defaultTab = hasMultiple ? overrideEntries[0][0] : '__canonical__'
  const [activeTab, setActiveTab] = React.useState(defaultTab)

  // Reset active tab when switching between content items
  React.useEffect(() => {
    setActiveTab(hasMultiple ? overrideEntries[0][0] : '__canonical__')
  }, [locationOverrides]) // eslint-disable-line react-hooks/exhaustive-deps

  const displayContent = (hasMultiple && activeTab !== '__canonical__')
    ? (locationOverrides[activeTab]?.content ?? content)
    : content

  const tabs = hasMultiple
    ? [
        { key: '__canonical__', label: 'Canonical' },
        ...overrideEntries.map(([id, v]) => ({ key: id, label: v.location_name ?? 'Location' })),
      ]
    : null

  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      {tabs && (
        <div className="flex overflow-x-auto bg-white border-b">
          {tabs.map((tab) => (
            <button
              key={tab.key}
              onClick={() => setActiveTab(tab.key)}
              className={`px-3 py-2 text-xs font-medium whitespace-nowrap shrink-0 border-b-2 transition-colors ${
                activeTab === tab.key
                  ? 'border-primary text-foreground'
                  : 'border-transparent text-muted-foreground hover:text-foreground'
              }`}
            >
              {tab.label}
            </button>
          ))}
        </div>
      )}
      <div className="bg-slate-50 px-4 py-3 border-b flex items-center gap-2">
        <MapPin className="h-4 w-4 text-destructive shrink-0" />
        <p className="text-xs font-semibold">{MB_NAME} · Google Business Profile</p>
      </div>
      <div className="px-4 py-4">
        <div className="flex items-center gap-3 mb-3">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            MB
          </div>
          <div>
            <p className="text-sm font-semibold">{MB_NAME}</p>
            <p className="text-3xs text-muted-foreground">{MB_LOCATION}</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap text-foreground">{displayContent}</p>
      </div>
      <div className="px-4 py-3 border-t bg-muted">
        <button className="text-xs text-info font-medium">Book appointment →</button>
      </div>
    </div>
  )
}

// ── Blog (rendered Markdown) ──────────────────────────────────────────────────
function BlogPreview({ content, mediaUrls = [] }) {
  // Hero image — selected with the SAME helper the publish path uses
  // (pickHero in src/lib/publishImageMirror.js → buildImagesManifest.heroImage),
  // so the preview shows exactly what ships. Without this the preview was
  // markdown-only: a blog with a photo attached read "1 media attached" but
  // showed a header-less wall of text, confusing the publisher.
  const hero = pickHero(mediaUrls)
  return (
    <div className="max-w-2xl mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
      {hero?.url && (
        <img
          src={hero.url}
          alt={hero.alt || ''}
          className="w-full aspect-video object-cover border-b"
        />
      )}
      <div className="px-8 py-8 prose prose-sm max-w-none
        prose-headings:font-bold prose-headings:tracking-tight
        prose-h1:text-2xl prose-h1:mb-4
        prose-h2:text-lg prose-h2:mt-8 prose-h2:mb-3
        prose-p:leading-relaxed prose-p:text-slate-700
        prose-a:text-primary prose-a:no-underline hover:prose-a:underline
        prose-strong:text-slate-900
        prose-li:text-slate-700">
        <ReactMarkdown>{content || ''}</ReactMarkdown>
      </div>
    </div>
  )
}

// ── Instagram Ads — Meta Ads Manager creative ────────────────────────────────
function parseInstagramAdFields(content) {
  if (!content) return {}
  const labels = ['PRIMARY TEXT', 'HEADLINE', 'DESCRIPTION', 'CTA BUTTON', 'DESTINATION URL', 'CREATIVE NOTES']
  const fields = {}
  let current = null
  let buf = []

  const flush = () => {
    if (!current || current === 'CREATIVE NOTES') return
    let val = buf.join('\n').trim()
    if (val.startsWith('[') && val.endsWith(']')) val = val.slice(1, -1).trim()
    if (val) fields[current] = val
  }

  for (const line of content.split('\n')) {
    const hit = labels.find((l) => line.startsWith(`${l}:`))
    if (hit) {
      flush()
      current = hit
      buf = []
    } else if (current) {
      buf.push(line)
    }
  }
  flush()
  return fields
}

const IG_AD_FIELDS = [
  { key: 'PRIMARY TEXT',    label: 'Primary Text',    hint: 'Main caption above the creative' },
  { key: 'HEADLINE',        label: 'Headline',        hint: 'Bold text under the creative' },
  { key: 'DESCRIPTION',     label: 'Description',     hint: 'Optional supporting line' },
  { key: 'CTA BUTTON',      label: 'CTA Button',      hint: 'Pick from Meta’s preset options' },
  { key: 'DESTINATION URL', label: 'Destination URL', hint: 'Where the ad sends clicks' },
]

function InstagramAdsPreview({ content, mediaUrls = [] }) {
  const f = parseInstagramAdFields(content)
  const hasFields = Object.keys(f).length > 0
  const [showFull, setShowFull] = React.useState(false)

  if (!hasFields) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex gap-3">
          <span className="text-warning text-lg shrink-0">⚠</span>
          <div>
            <p className="text-sm font-medium text-warning">Regenerate to use the structured Instagram Ads format</p>
            <p className="text-xs text-warning mt-0.5">
              This ad copy was created before the labeled-field format. Click <strong>Regenerate</strong> to get
              Primary Text, Headline, Description, CTA Button, and Destination URL as separate one-click-copy fields.
            </p>
          </div>
        </div>
        <PlainPreview content={content} />
      </div>
    )
  }

  const primary = f['PRIMARY TEXT'] || ''
  const lines = primary.split('\n')
  const previewText = lines.slice(0, 2).join('\n').slice(0, 125)
  const hasMore = primary.length > previewText.length

  return (
    <div className="max-w-2xl mx-auto space-y-6">
      {/* Mock feed ad */}
      <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
        <div className="flex items-center gap-3 px-4 py-3 border-b">
          <div className="h-9 w-9 rounded-full bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">
            {MB_INITIALS}
          </div>
          <div className="flex-1 min-w-0">
            <p className="text-xs font-semibold">{MB_HANDLE}</p>
            <p className="text-3xs text-muted-foreground">Sponsored · {MB_LOCATION}</p>
          </div>
        </div>

        <MediaCarousel mediaUrls={mediaUrls} aspectClass="aspect-square" />

        <div className="px-4 pt-3 pb-1 flex items-center gap-4">
          <Heart className="h-6 w-6" />
          <MessageCircle className="h-6 w-6" />
          <Send className="h-6 w-6" />
          <Bookmark className="h-6 w-6 ml-auto" />
        </div>

        {/* CTA bar — Meta renders this directly under reactions for ads */}
        <div className="border-t px-4 py-2.5 flex items-center justify-between bg-slate-50">
          <div className="min-w-0">
            <p className="text-2xs font-semibold leading-tight truncate">{f['HEADLINE'] || '—'}</p>
            {f['DESCRIPTION'] && (
              <p className="text-3xs text-muted-foreground leading-tight truncate">{f['DESCRIPTION']}</p>
            )}
          </div>
          <button className="ml-3 shrink-0 text-2xs font-semibold bg-slate-900 text-white px-3 py-1.5 rounded">
            {f['CTA BUTTON'] || 'Learn More'}
          </button>
        </div>

        {/* Primary text */}
        <div className="px-4 pb-4 pt-2">
          <p className="text-xs leading-relaxed whitespace-pre-wrap">
            <span className="font-semibold">{MB_HANDLE}</span>{' '}
            <SocialText text={showFull ? primary : previewText} />
            {!showFull && hasMore && (
              <button onClick={() => setShowFull(true)} className="text-muted-foreground ml-1">… more</button>
            )}
          </p>
        </div>
      </div>

      {/* Per-field copy cards — paste into Meta Ads Manager */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          Paste into Meta Ads Manager
        </p>
        {IG_AD_FIELDS.map(({ key, label, hint }) => {
          const value = f[key]
          if (!value) return null
          const charCount = value.length
          return (
            <div key={key} className="border rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  <span className="ml-2 text-3xs text-muted-foreground">{hint}</span>
                  <span className="ml-2 text-3xs font-mono text-slate-500">{charCount} chars</span>
                </div>
                <CopyButton value={value} />
              </div>
              <p className="px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Plain formatted (ads, landing page, video scripts) ───────────────────────
function PlainPreview({ content }) {
  return (
    <div className="max-w-2xl mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-6 py-6">
        <pre className="text-sm leading-relaxed font-sans whitespace-pre-wrap text-slate-800">{content}</pre>
      </div>
    </div>
  )
}

// ── Generic short-form social (X / Threads / Bluesky / Mastodon) ──────────────
// Media-optional post card: caption + optional media. Replaces the raw
// PlainPreview dump for the text-first networks that share the "single visual"
// archetype.
const NETWORK_META = {
  twitter: 'X', threads: 'Threads', bluesky: 'Bluesky', mastodon: 'Mastodon',
}
function SimpleSocialPreview({ content, mediaUrls = [], platform }) {
  const label = NETWORK_META[platform] || 'Post'
  const media = Array.isArray(mediaUrls) ? mediaUrls : []
  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      <div className="px-4 pt-4 pb-3">
        <div className="flex items-center gap-3 mb-2">
          <div className="h-10 w-10 rounded-full bg-gradient-to-br from-action to-primary flex items-center justify-center text-white text-xs font-bold shrink-0">{MB_INITIALS}</div>
          <div className="min-w-0">
            <p className="text-sm font-semibold truncate">{MB_NAME}</p>
            <p className="text-3xs text-muted-foreground">{MB_HANDLE} · {label}</p>
          </div>
        </div>
        <p className="text-sm leading-relaxed whitespace-pre-wrap"><SocialText text={content} /></p>
      </div>
      {media.length > 0 && <div className="border-t"><MediaCarousel mediaUrls={media} aspectClass="aspect-video" /></div>}
    </div>
  )
}

// ── Video channels (TikTok / YouTube / YouTube Short) ─────────────────────────
function VideoChannelPreview({ content, mediaUrls = [] }) {
  const media = Array.isArray(mediaUrls) ? mediaUrls : []
  const video = media.find(isVideoEntry) || null
  return (
    <div className="max-w-sm mx-auto border rounded-xl overflow-hidden bg-white shadow-sm font-sans">
      {video ? <ReelPreview video={video} /> : <MediaCarousel mediaUrls={media} aspectClass="aspect-[9/16]" />}
      <div className="px-4 py-3">
        <p className="text-xs leading-relaxed whitespace-pre-wrap"><SocialText text={content} /></p>
      </div>
    </div>
  )
}

// ── Text ad (Google Ads search) — copy-only, no creative ──────────────────────
function TextAdPreview({ content }) {
  const lines = (content || '').split('\n').map((l) => l.trim()).filter(Boolean)
  const headline = lines[0] || 'Your ad headline'
  const desc = lines.slice(1).join(' ')
  return (
    <div className="max-w-md mx-auto bg-white border rounded-xl shadow-sm overflow-hidden">
      <div className="px-5 py-4">
        <div className="flex items-center gap-2 mb-1.5">
          <span className="text-3xs font-bold text-slate-900 border border-slate-900 rounded px-1">Ad</span>
          <span className="text-xs text-slate-700">{MB_HOSTNAME}</span>
        </div>
        <p className="text-lg leading-snug text-[#1a0dab]">{headline}</p>
        {desc && <p className="mt-1 text-xs leading-relaxed text-slate-600">{desc}</p>}
      </div>
    </div>
  )
}

// ── Instagram Story — 9:16 phone frame ───────────────────────────────────────
// Renders the real Story: media (photo / video first frame) or a branded card
// when none is attached, with the overlay headline printed over it and the
// link-sticker pill near the bottom. Derives all three from the row defensively
// (deriveStory) so a raw "LINK_STICKER_TEXT:" line never leaks into the preview.
function InstagramStoryPreview({ content, mediaUrls = [], overlayText = null, textCard = null }) {
  const { overlay, sticker } = deriveStory({ content, overlay_text: overlayText, text_card: textCard })
  const media = Array.isArray(mediaUrls) ? mediaUrls : []
  const first = media[0] || null
  const isVideo = first ? isVideoEntry(first) : false
  const src = first ? (photoSourceUrl(first) || mediaSrc(first)) : null
  const logoSrc = useWorkspaceLogo()

  return (
    <div className="mx-auto w-full max-w-[280px]">
      <div className="relative aspect-[9/16] overflow-hidden rounded-2xl bg-slate-900 shadow-md select-none">
        {/* Background: media, or a branded gradient card when none attached */}
        {src ? (
          <img
            src={src}
            alt={first?.name || 'Story media'}
            className="absolute inset-0 h-full w-full object-cover"
            loading="lazy"
            decoding="async"
            onError={(e) => { e.target.style.display = 'none' }}
          />
        ) : (
          <div className="absolute inset-0 bg-gradient-to-br from-primary to-primary/70 flex items-center justify-center">
            {logoSrc && <img src={logoSrc} alt={workspace.name} className="h-14 w-auto opacity-20" />}
          </div>
        )}

        {/* Scrim so overlay text stays legible over any photo */}
        <div className="absolute inset-0 bg-black/30" aria-hidden="true" />

        {/* Top progress bar (story chrome) */}
        <div className="absolute inset-x-0 top-0 flex items-center gap-2 px-3 pt-2.5">
          <div className="h-0.5 flex-1 rounded-full bg-white/90" />
          <span className="text-3xs font-medium text-white/80">{MB_HANDLE}</span>
        </div>

        {/* Video affordance */}
        {isVideo && (
          <div className="absolute inset-0 flex items-center justify-center" aria-hidden="true">
            <div className="flex h-12 w-12 items-center justify-center rounded-full bg-white/15 backdrop-blur-sm ring-1 ring-white/25">
              <Play className="ml-0.5 h-6 w-6 text-white" />
            </div>
          </div>
        )}

        {/* Overlay headline */}
        {overlay && (
          <div className="absolute inset-x-0 top-1/2 -translate-y-1/2 px-5 text-center">
            <p className="text-lg font-extrabold uppercase leading-tight tracking-wide text-white drop-shadow-[0_2px_8px_rgba(0,0,0,0.6)]">
              {overlay}
            </p>
          </div>
        )}

        {/* Link sticker */}
        {sticker && (
          <div className="absolute inset-x-0 bottom-10 flex justify-center">
            <span className="inline-flex items-center gap-1 rounded-full bg-white px-3 py-1 text-2xs font-bold text-slate-900 shadow">
              {sticker}
              <ChevronRight className="h-3 w-3" aria-hidden="true" />
            </span>
          </div>
        )}
      </div>

      {media.length === 0 && (
        <p className="mt-2 text-center text-3xs text-muted-foreground">
          No media yet — add a photo or video, or publish the branded card.
        </p>
      )}
    </div>
  )
}

// ── Email — parse sections + visual mock matching the TDC master template ────
function parseEmailSections(content) {
  if (!content) return {}
  const result = {}
  const regex  = /^---([A-Z][A-Z 0-9]+)---$/gm
  const matches = []
  let m
  while ((m = regex.exec(content)) !== null) {
    matches.push({ key: m[1].trim(), start: m.index + m[0].length })
  }
  matches.forEach((match, i) => {
    const end   = i < matches.length - 1 ? matches[i + 1].start - matches[i + 1].key.length - 7 : content.length
    result[match.key] = content.slice(match.start, end).trim()
  })
  return result
}

function CopyButton({ value }) {
  const [copied, setCopied] = React.useState(false)
  function copy() {
    navigator.clipboard.writeText(value)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }
  return (
    <button
      onClick={copy}
      className={`shrink-0 text-2xs px-2 py-1 rounded border transition-colors ${
        copied ? 'border-success text-success bg-success/5' : 'border-border text-muted-foreground hover:text-foreground hover:border-foreground/30'
      }`}
    >
      {copied ? '✓ Copied' : 'Copy'}
    </button>
  )
}

const EMAIL_FIELDS = [
  { key: 'SUBJECT LINE',    tag: null,                    label: 'Subject Line',      hint: 'Set in TrustDrivenCare send settings' },
  { key: 'PREVIEW TEXT',   tag: '{{preview_text}}',      label: 'Preview Text',      hint: 'Inbox snippet — 50–90 chars' },
  { key: 'HEADLINE',       tag: '{{headline}}',           label: 'Headline',          hint: 'Large bold heading at top of email' },
  { key: 'PULL QUOTE',     tag: '{{pull_quote}}',         label: 'Pull Quote',        hint: 'Styled callout block — most compelling line' },
  { key: 'BODY PARAGRAPH 1', tag: '{{body_paragraph_1}}', label: 'Body Paragraph 1', hint: 'Opening hook' },
  { key: 'BODY PARAGRAPH 2', tag: '{{body_paragraph_2}}', label: 'Body Paragraph 2', hint: `${workspace.name} perspective` },
  { key: 'BODY PARAGRAPH 3', tag: '{{body_paragraph_3}}', label: 'Body Paragraph 3', hint: 'Patient story + bridge to action' },
  { key: 'CTA TEXT',       tag: '{{cta_text}}',           label: 'CTA Button Text',   hint: 'Button label only' },
  { key: 'CTA URL',        tag: '{{cta_url}}',            label: 'CTA URL',           hint: 'Button destination URL' },
  { key: 'PS',             tag: '{{ps_text}}',            label: 'P.S.',              hint: 'Optional postscript line' },
]

function escapeForHtml(str) {
  if (!str) return ''
  return str
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
}

function fillTemplate(html, s, heroSrc) {
  const year = new Date().getFullYear()
  return html
    .replace(/\{\{preview_text\}\}/g,    escapeForHtml(s['PREVIEW TEXT'] || ''))
    .replace(/\{\{headline\}\}/g,         escapeForHtml(s['HEADLINE'] || ''))
    .replace(/\{\{pull_quote\}\}/g,       escapeForHtml(s['PULL QUOTE'] || ''))
    .replace(/\{\{body_paragraph_1\}\}/g, escapeForHtml(s['BODY PARAGRAPH 1'] || ''))
    .replace(/\{\{body_paragraph_2\}\}/g, escapeForHtml(s['BODY PARAGRAPH 2'] || ''))
    .replace(/\{\{body_paragraph_3\}\}/g, escapeForHtml(s['BODY PARAGRAPH 3'] || ''))
    .replace(/\{\{cta_text\}\}/g,         escapeForHtml(s['CTA TEXT'] || 'Book Now'))
    .replace(/\{\{cta_url\}\}/g,          escapeForHtml(s['CTA URL'] || MB_BOOKING))
    .replace(/\{\{ps_text\}\}/g,          escapeForHtml(s['PS'] || ''))
    .replace(/\{\{hero_image_url\}\}/g,   heroSrc || 'https://assets.cdn.filesafe.space/55VqA3IoxvCxZyjszdj7/media/698ce4a13fdd0e24c8bf6754.svg')
    .replace(/\{\{year\}\}/g,             String(year))
    .replace(/\{\{unsubscribe_url\}\}/g,  '#')
    .replace(/\{\{webview_url\}\}/g,      '#')
}

function EmailPreview({ content, mediaUrls = [] }) {
  const s = parseEmailSections(content)
  const hasSections = Object.keys(s).length > 0
  const heroMedia = mediaUrls.find((m) => m.type === 'image' || m.kind === 'image')
  const heroSrc   = heroMedia ? (heroMedia.url || heroMedia.thumbnailUrl || null) : null

  // Old-format email: show a notice + raw content instead of the broken shell
  if (!hasSections) {
    return (
      <div className="max-w-2xl mx-auto space-y-4">
        <div className="rounded-lg border border-warning/30 bg-warning/10 px-4 py-3 flex gap-3">
          <span className="text-warning text-lg shrink-0">⚠</span>
          <div>
            <p className="text-sm font-medium text-warning">This email needs to be regenerated</p>
            <p className="text-xs text-warning mt-0.5">
              It was created before the structured template format. Switch to <strong>Edit</strong>, delete the content,
              and re-run <em>Generate Content</em> from the interview to get the new section layout with one-click copy into TrustDrivenCare.
            </p>
          </div>
        </div>
        <div className="rounded-xl border bg-white shadow-sm">
          <div className="px-5 py-4 border-b bg-slate-50">
            <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">Current content (raw)</p>
          </div>
          <pre className="px-5 py-4 text-xs leading-relaxed font-sans whitespace-pre-wrap text-slate-700">{content}</pre>
        </div>
      </div>
    )
  }

  const filledHtml = fillTemplate(emailTemplateHtml, s, heroSrc)

  return (
    <div className="max-w-2xl mx-auto space-y-6">

      {/* Email subject / preview chrome bar */}
      <div className="rounded-t-lg overflow-hidden border border-slate-200 bg-slate-800">
        <div className="px-4 py-2">
          <p className="text-2xs text-slate-400"><span className="text-slate-300 font-medium">Subject: </span>{s['SUBJECT LINE'] || '—'}</p>
          <p className="text-3xs text-slate-500 truncate">{s['PREVIEW TEXT'] || 'Preview text will appear here…'}</p>
        </div>
      </div>

      {/* Iframe rendering actual TDC template */}
      <iframe
        srcDoc={filledHtml}
        title="Email Preview"
        style={{ width: '100%', height: 'min(960px, 80vh)', border: '1px solid #e2e8f0', borderRadius: 8, display: 'block' }}
        sandbox=""
      />

      {/* Section copy cards */}
      <div className="space-y-2">
        <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide">
          {workspace.newsletterCopyHeader}
        </p>
        {EMAIL_FIELDS.map(({ key, tag, label, hint }) => {
          const value = s[key]
          if (!value) return null
          return (
            <div key={key} className="border rounded-lg bg-white overflow-hidden">
              <div className="flex items-center justify-between px-3 py-2 bg-slate-50 border-b">
                <div>
                  <span className="text-xs font-semibold text-slate-700">{label}</span>
                  {tag && <span className="ml-2 text-3xs font-mono text-primary bg-primary/10 px-1.5 py-0.5 rounded">{tag}</span>}
                  <span className="ml-2 text-3xs text-muted-foreground">{hint}</span>
                </div>
                <CopyButton value={value} />
              </div>
              <p className="px-3 py-2 text-xs text-slate-700 leading-relaxed whitespace-pre-wrap">{value}</p>
            </div>
          )
        })}
      </div>
    </div>
  )
}

// ── Main export ───────────────────────────────────────────────────────────────
export default function PostPreview({ platform, content, mediaUrls = [], slides = null, overlayText = null, textCard = null, locationOverrides = null, photoTemplateId = null }) {
  // A Story is valid with media + no caption (the overlay/sticker live in
  // dedicated fields), so it must not trip the "no content" guard below.
  const isStory = platform === 'instagram_story'
  if (!isStory && !content?.trim()) {
    return (
      <div className="flex items-center justify-center py-16 text-muted-foreground text-sm">
        No content to preview yet.
      </div>
    )
  }

  switch (platform) {
    case 'instagram':   return <InstagramPreview content={content} mediaUrls={mediaUrls} slides={slides} photoTemplateId={photoTemplateId} />
    case 'instagram_story': return <InstagramStoryPreview content={content} mediaUrls={mediaUrls} overlayText={overlayText} textCard={textCard} />
    case 'facebook':    return <FacebookPreview  content={content} mediaUrls={mediaUrls} />
    case 'linkedin':    return <LinkedInPreview  content={content} />
    case 'gbp':         return <GBPPreview       content={content} locationOverrides={locationOverrides} />
    case 'blog':        return <BlogPreview      content={content} mediaUrls={mediaUrls} />
    case 'landing_page': return <BlogPreview     content={content} mediaUrls={mediaUrls} />
    case 'email':       return <EmailPreview     content={content} mediaUrls={mediaUrls} />
    case 'instagram_ads': return <InstagramAdsPreview content={content} mediaUrls={mediaUrls} />
    case 'google_ads':  return <TextAdPreview    content={content} />
    case 'twitter':
    case 'threads':
    case 'bluesky':
    case 'mastodon':    return <SimpleSocialPreview content={content} mediaUrls={mediaUrls} platform={platform} />
    case 'tiktok':
    case 'youtube':
    case 'youtube_short': return <VideoChannelPreview content={content} mediaUrls={mediaUrls} />
    default:            return <PlainPreview     content={content} />
  }
}
