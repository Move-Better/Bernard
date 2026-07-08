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
  Archive, AlertTriangle,
} from 'lucide-react'

export const PLATFORM_META = {
  blog:         { label: 'Blog Post',       icon: FileText,   color: 'text-muted-foreground', bg: 'bg-muted' },
  instagram:    { label: 'Instagram',       icon: Instagram,  color: 'text-pink-600',   bg: 'bg-pink-50' },
  instagram_story:{ label: 'Instagram Story', icon: Instagram, color: 'text-pink-600',   bg: 'bg-pink-50' },
  facebook:     { label: 'Facebook',        icon: Facebook,   color: 'text-blue-600',   bg: 'bg-blue-50' },
  linkedin:     { label: 'LinkedIn',        icon: Linkedin,   color: 'text-info',       bg: 'bg-info/10' },
  gbp:          { label: 'Google Business', icon: MapPin,     color: 'text-primary',    bg: 'bg-primary/10' },
  google_ads:   { label: 'Google Ads',      icon: MousePointer2, color: 'text-yellow-700', bg: 'bg-yellow-50' },
  instagram_ads:{ label: 'Instagram Ads',   icon: Megaphone,  color: 'text-rose-600',   bg: 'bg-rose-50' },
  landing_page: { label: 'Landing Page',    icon: LayoutTemplate, color: 'text-primary',    bg: 'bg-primary/10' },
  youtube:      { label: 'YouTube',         icon: Youtube,       color: 'text-red-600',    bg: 'bg-red-50' },
  tiktok:       { label: 'TikTok / Reels', icon: Music2,        color: 'text-fuchsia-600', bg: 'bg-fuchsia-50' },
  email:        { label: 'Email',           icon: Mail,       color: 'text-muted-foreground', bg: 'bg-muted' },
}

// Hard caption-length caps the destination platform actually enforces at
// publish time (not soft best-practice guidance). Only platforms with a cap
// that's realistically reachable by a real caption are listed — Facebook
// (63,206) and LinkedIn (3,000) posts essentially never hit their ceiling in
// practice, so they're omitted to avoid cluttering the editor with a warning
// that never fires. GBP's 1500 is enforced server-side (silently truncated)
// in api/_routes/publish/buffer.js — surfacing it here in the editor lets the
// author see and fix an overlong caption before it ships shortened.
export const CAPTION_LIMITS = {
  gbp:              1500,
  twitter:          280,
  threads:          500,
  bluesky:          300,
  instagram:        2200,
  instagram_story:  2200,
  tiktok:           2200,
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
  ['email'],
]
