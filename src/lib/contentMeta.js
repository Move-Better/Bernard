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
  Archive,
} from 'lucide-react'

export const PLATFORM_META = {
  blog:         { label: 'Blog Post',       icon: FileText,   color: 'text-slate-600',  bg: 'bg-slate-100' },
  instagram:    { label: 'Instagram',       icon: Instagram,  color: 'text-pink-600',   bg: 'bg-pink-50' },
  instagram_story:{ label: 'Instagram Story', icon: Instagram, color: 'text-pink-600',   bg: 'bg-pink-50' },
  facebook:     { label: 'Facebook',        icon: Facebook,   color: 'text-blue-600',   bg: 'bg-blue-50' },
  linkedin:     { label: 'LinkedIn',        icon: Linkedin,   color: 'text-sky-700',    bg: 'bg-sky-50' },
  gbp:          { label: 'Google Business', icon: MapPin,     color: 'text-primary',    bg: 'bg-primary/10' },
  google_ads:   { label: 'Google Ads',      icon: MousePointer2, color: 'text-yellow-700', bg: 'bg-yellow-50' },
  instagram_ads:{ label: 'Instagram Ads',   icon: Megaphone,  color: 'text-rose-600',   bg: 'bg-rose-50' },
  landing_page: { label: 'Landing Page',    icon: LayoutTemplate, color: 'text-primary',    bg: 'bg-primary/10' },
  youtube:      { label: 'YouTube',         icon: Youtube,       color: 'text-red-600',    bg: 'bg-red-50' },
  tiktok:       { label: 'TikTok / Reels', icon: Music2,        color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  email:        { label: 'Email',           icon: Mail,       color: 'text-teal-600',   bg: 'bg-teal-50' },
}

// See also src/lib/contentStatusTokens.js (kanban-lane variant with `accent` borders; same "Ready to publish" label for the approved status).
export const STATUS_META = {
  draft:      { label: 'Draft',      color: 'bg-slate-100 text-slate-700',   icon: FileText },
  in_review:  { label: 'In Review',  color: 'bg-amber-100 text-amber-700',   icon: Clock },
  approved:   { label: 'Ready to publish', color: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', icon: CheckCircle2 },
  scheduled:  { label: 'Scheduled',  color: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', icon: CalendarDays },
  published:  { label: 'Published',  color: 'bg-emerald-100 text-emerald-700', icon: Send },
  archived:   { label: 'Archived',   color: 'bg-zinc-100 text-zinc-600',     icon: Archive },
}

// 'archived' is a UI-only pseudo-tab — there's no `archived` value on the
// status enum. Selecting it switches the list query to `archived=only` so
// rows with archived_at set come back regardless of their underlying status.
export const STATUS_TABS = ['all', 'draft', 'in_review', 'approved', 'scheduled', 'published', 'archived']

// Platform family → content-type group for surfaces that colour by channel
// family rather than per-platform brand (e.g. the DraftsReadyRow review
// cards, LibraryReadyStrip). Keyed independently from per-platform brand
// colours so a rebrand to one family (e.g. "social" becomes teal) touches
// one place.
export const PLATFORM_FAMILY_PILL = {
  blog:   'bg-success/10 text-success',
  email:  'bg-action/10 text-action',
  social: 'bg-scheduled/10 text-scheduled',
  local:  'bg-info/10 text-info',
}

const PLATFORM_TO_FAMILY = {
  blog: 'blog', landing_page: 'blog',
  email: 'email',
  instagram: 'social', instagram_story: 'social', facebook: 'social', linkedin: 'social',
  tiktok: 'social', youtube: 'social', twitter: 'social',
  gbp: 'local',
}

/**
 * @param {string} platform
 * @returns {{ label: string, pill: string }}
 */
export function getPlatformFamilyPill(platform) {
  const meta = PLATFORM_META[platform]
  const family = PLATFORM_TO_FAMILY[platform] || 'social'
  return {
    label: meta?.label?.replace(' Post', '') ?? platform,
    pill:  PLATFORM_FAMILY_PILL[family] ?? 'bg-muted text-muted-foreground',
  }
}

// Chip groups for the platform filter — IG Ads sits alone between Social and Google.
export const PLATFORM_GROUPS = [
  ['blog'],
  ['instagram', 'facebook', 'linkedin', 'gbp'],
  ['instagram_ads'],
  ['google_ads', 'landing_page'],
  ['youtube', 'tiktok'],
  ['email'],
]
