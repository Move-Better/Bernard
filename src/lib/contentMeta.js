// Shared content-meta constants used across the publishing surfaces
// (ContentHub, ContentCalendar, ReviewQueue, ReviewPost, PipelineKanban,
// and the upcoming Stories views). Lifted out of ContentHub.jsx in the
// IA refactor (PR 1/6) so the Stories surface can consume them without a
// circular page dependency.
//
// Keep purely declarative — no React state, no hooks. Icons are
// lucide-react components, referenced by symbol so consumers can render
// them however they like (color via tailwind classes on the wrapper).

import {
  Instagram, Facebook, Linkedin, FileText, Mail,
  MapPin, Clock, CheckCircle2, Send, CalendarDays,
  MousePointer2, LayoutTemplate, Youtube, Music2, Megaphone,
  Archive, AlertTriangle, Twitter, AtSign, Cloud, Hash,
} from 'lucide-react'

// CANONICAL platform registry — the single source of truth for per-platform
// label/icon/colors. atomPlan.js's PLATFORM_UI and ChannelsSettings' icon maps
// derive from this object, so adding a platform here covers those surfaces too.
// Every entry carries the full field set (label, icon, color, bg, border, dot)
// so derived views never hit a missing field.
export const PLATFORM_META = {
  blog:         { label: 'Blog Post',       icon: FileText,   color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', dot: 'bg-muted-foreground' },
  instagram:    { label: 'Instagram',       icon: Instagram,  color: 'text-pink-600',   bg: 'bg-pink-50', border: 'border-pink-200', dot: 'bg-pink-500' },
  instagram_story:{ label: 'Instagram Story', icon: Instagram, color: 'text-pink-600',   bg: 'bg-pink-50', border: 'border-pink-200', dot: 'bg-pink-500' },
  facebook:     { label: 'Facebook',        icon: Facebook,   color: 'text-blue-600',   bg: 'bg-blue-50', border: 'border-blue-200', dot: 'bg-blue-600' },
  linkedin:     { label: 'LinkedIn',        icon: Linkedin,   color: 'text-info',       bg: 'bg-info/10', border: 'border-info/30', dot: 'bg-info' },
  gbp:          { label: 'Google Business', icon: MapPin,     color: 'text-primary',    bg: 'bg-primary/10', border: 'border-primary/20', dot: 'bg-primary' },
  google_ads:   { label: 'Google Ads',      icon: MousePointer2, color: 'text-yellow-700', bg: 'bg-yellow-50', border: 'border-yellow-200', dot: 'bg-yellow-600' },
  instagram_ads:{ label: 'Instagram Ads',   icon: Megaphone,  color: 'text-rose-600',   bg: 'bg-rose-50', border: 'border-rose-200', dot: 'bg-rose-500' },
  landing_page: { label: 'Landing Page',    icon: LayoutTemplate, color: 'text-primary',    bg: 'bg-primary/10', border: 'border-primary/20', dot: 'bg-primary' },
  youtube:      { label: 'YouTube',         icon: Youtube,       color: 'text-red-600',    bg: 'bg-red-50', border: 'border-red-200', dot: 'bg-red-600' },
  tiktok:       { label: 'TikTok / Reels', icon: Music2,        color: 'text-fuchsia-600', bg: 'bg-fuchsia-50', border: 'border-fuchsia-200', dot: 'bg-fuchsia-600' },
  twitter:      { label: 'X / Twitter',     icon: Twitter,    color: 'text-foreground', bg: 'bg-muted', border: 'border-border', dot: 'bg-foreground' },
  threads:      { label: 'Threads',         icon: AtSign,     color: 'text-zinc-700',   bg: 'bg-zinc-50', border: 'border-zinc-200', dot: 'bg-zinc-700' },
  bluesky:      { label: 'Bluesky',         icon: Cloud,      color: 'text-info',       bg: 'bg-info/10', border: 'border-info/30', dot: 'bg-info' },
  mastodon:     { label: 'Mastodon',        icon: Hash,       color: 'text-violet-600', bg: 'bg-violet-50', border: 'border-violet-200', dot: 'bg-violet-600' },
  email:        { label: 'Email',           icon: Mail,       color: 'text-muted-foreground', bg: 'bg-muted', border: 'border-border', dot: 'bg-muted-foreground' },
}

// Hard caption-length caps the destination platform actually enforces at
// publish time (not soft best-practice guidance).
//
// Every platform the SERVER caps must appear here, because these caps now gate
// the Approve button as well as the editor warning — a platform capped
// server-side but missing here would disable Approve with no explanation of
// why. LinkedIn (3,000) was previously omitted on the grounds that a real post
// never gets near it; that was fine for a warning and wrong for a gate.
// tests/lib/captionCap.test.js enforces the correspondence in both directions.
//
// Facebook (63,206) stays out: neither side caps it, so nothing is gated.
// GBP's 1500 is not a gate either — it is clamped sentence-aware at publish
// (see AUTO_CLAMP_PLATFORMS below); the warning here just lets the author fix
// it before it ships shortened.
export const CAPTION_LIMITS = {
  gbp:              1500,
  twitter:          280,
  threads:          500,
  bluesky:          300,
  instagram:        2200,
  instagram_story:  2200,
  tiktok:           2200,
  linkedin:         3000,
  mastodon:         500,
}

// Platforms whose over-length text is CLAMPED at publish rather than blocked at
// approve. Mirror of AUTO_CLAMP_PLATFORMS in api/_lib/socialLengthTargets.js —
// tests/lib/captionCap.test.js asserts the two stay in step.
export const AUTO_CLAMP_PLATFORMS = new Set(['gbp'])

// How many characters this caption is OVER the platform's hard ceiling; 0 when
// it fits, the platform has no ceiling, or the platform auto-clamps instead.
//
// Client mirror of checkCaptionCap() in api/_lib/socialLengthTargets.js. The
// server route is the real boundary — this exists so Approve can be disabled
// with a reason the author can act on, instead of failing on click.
export function captionOverage(platform, text) {
  const cap = CAPTION_LIMITS[platform]
  if (!cap || AUTO_CLAMP_PLATFORMS.has(platform)) return 0
  const len = typeof text === 'string' ? text.length : 0
  return Math.max(0, len - cap)
}

// See also src/lib/contentStatusTokens.js (kanban-lane variant with `accent` borders; same "Ready to publish" label for the approved status).
export const STATUS_META = {
  draft:      { label: 'Draft',      color: 'bg-muted text-muted-foreground', icon: FileText },
  in_review:  { label: 'In Review',  color: 'bg-warning/10 text-warning',    icon: Clock },
  approved:   { label: 'Ready to publish', color: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', icon: CheckCircle2 },
  scheduled:  { label: 'Scheduled',  color: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', icon: CalendarDays },
  published:  { label: 'Published',  color: 'bg-success/10 text-success', icon: Send },
  failed:     { label: 'Failed',     color: 'bg-destructive/10 text-destructive', icon: AlertTriangle },
  archived:   { label: 'Archived',   color: 'bg-muted text-muted-foreground', icon: Archive },
}

// 'archived' is a UI-only pseudo-tab — there's no `archived` value on the
// status enum. Selecting it switches the list query to `archived=only` so
// rows with archived_at set come back regardless of their underlying status.
export const STATUS_TABS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']

// Chip groups for the platform filter — IG Ads sits alone between Social and Google.
export const PLATFORM_GROUPS = [
  ['blog'],
  ['instagram', 'facebook', 'linkedin', 'gbp'],
  ['instagram_ads'],
  ['google_ads', 'landing_page'],
  ['youtube', 'tiktok'],
  ['twitter', 'threads', 'bluesky', 'mastodon'],
  ['email'],
]
