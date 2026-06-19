import { Link } from 'react-router-dom'
import { ChevronRight } from 'lucide-react'
import { PLATFORM_META } from '@/lib/contentMeta'

// MyWorkCard — a clinician's own pieces with where each one stands in the
// pipeline. Replaces the old thin "My recent stories" list (topics + dates
// only) with a status tracker: one row per story, showing its pipeline stage,
// a contextual sub-line, and the next action. This answers "where's my stuff?"
// in one glance on Home, so a busy clinician never has to click around to find
// out whether a story published or is still waiting on review.
//
// Personal — filtered to the logged-in user's own stories (owner_id). Capped
// so the card stays scannable; a footer links to the full owner-scoped list.

const MAX_ROWS = 6

// Stage → presentation. Mirrors the Stories/Overview pipeline vocabulary
// (Capture → Drafting → Review → Scheduled → Published) so one mental model
// spans every surface. Pill classes come from the shared .nx-pill palette.
const STAGE = {
  capture:   { label: 'Capturing', pill: 'nx-pill-ink',     action: 'Resume' },
  drafting:  { label: 'Drafting',  pill: 'nx-pill-amber',   action: 'Edit text' },
  review:    { label: 'In review', pill: 'nx-pill-tint',    action: 'View' },
  scheduled: { label: 'Scheduled', pill: 'nx-pill-violet',  action: 'Preview' },
  published: { label: '🎉 Live',   pill: 'nx-pill-emerald', action: 'View post' },
}

function shortDate(iso) {
  if (!iso) return ''
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function platformSummary(story) {
  const seen = []
  for (const p of story.pieces || []) {
    const label = PLATFORM_META[p.platform]?.label?.replace(' Post', '') ?? p.platform
    if (label && !seen.includes(label)) seen.push(label)
  }
  return seen.slice(0, 3).join(' · ')
}

// The contextual "where it stands" sub-line — honest about what we actually
// know (no fabricated reviewer names; we don't track who holds a review).
function statusLine(story) {
  switch (story.story_stage) {
    case 'published':
      return 'Published recently'
    case 'scheduled':
      return story.next_scheduled_at
        ? `Goes live ${shortDate(story.next_scheduled_at)}`
        : 'Scheduled'
    case 'review':
      return 'Sent for review'
    case 'drafting':
      return (story.pieces_count || 0) > 0 ? 'Ready for your edits' : 'Ready for content'
    case 'capture':
    default:
      return 'In progress'
  }
}

export default function MyWorkCard({ stories = [], userId }) {
  const mine = stories
    .filter((s) => userId && s.owner_id === userId)
    .sort((a, b) => {
      const safeMs = (v) => { const d = v ? Date.parse(v) : 0; return Number.isFinite(d) ? d : 0 }
      return safeMs(b.last_activity_at || b.updated_at) - safeMs(a.last_activity_at || a.updated_at)
    })

  if (mine.length === 0) return null
  const rows = mine.slice(0, MAX_ROWS)

  return (
    <div className="rounded-2xl border border-border bg-white overflow-hidden shadow-[0_1px_2px_rgba(15,23,42,0.04)]">
      <div className="flex items-center gap-2 px-5 py-3.5 border-b border-slate-100 flex-wrap">
        <h2 className="text-base font-bold tracking-tight">My work &amp; where it stands</h2>
        <span className="nx-pill nx-pill-ink">{mine.length} {mine.length === 1 ? 'piece' : 'pieces'}</span>
        <div className="ml-auto hidden md:flex items-center gap-1 text-2xs">
          <span className="nx-pill nx-pill-ink">Capturing</span>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="nx-pill nx-pill-amber">Drafting</span>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="nx-pill nx-pill-tint">In review</span>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="nx-pill nx-pill-sky">Scheduled</span>
          <ChevronRight className="h-3 w-3 text-slate-300" />
          <span className="nx-pill nx-pill-emerald">Live</span>
        </div>
      </div>

      <div className="divide-y divide-slate-100">
        {rows.map((s) => {
          const meta = STAGE[s.story_stage] || STAGE.capture
          const platforms = platformSummary(s)
          return (
            <Link
              key={s.id}
              to={`/stories/${s.id}`}
              className="flex items-center gap-3 px-4 py-3 hover:bg-accent/20 transition-colors group"
            >
              <div className="flex-1 min-w-0">
                <p className="text-sm font-semibold truncate text-foreground">{s.topic}</p>
                <p className="text-xs text-muted-foreground truncate">{platforms || s.staff_name}</p>
              </div>
              <span className={`nx-pill ${meta.pill} shrink-0`}>{meta.label}</span>
              <span className="w-32 shrink-0 text-xs text-muted-foreground hidden sm:block truncate">
                {statusLine(s)}
              </span>
              <span className="text-xs font-semibold text-muted-foreground group-hover:text-primary transition-colors inline-flex items-center gap-0.5 shrink-0">
                {meta.action} <ChevronRight className="h-3 w-3" />
              </span>
            </Link>
          )
        })}
      </div>

      <Link
        to="/stories?owner=me"
        className="block px-4 py-2.5 bg-slate-50/60 text-xs font-medium text-muted-foreground hover:text-primary transition-colors"
      >
        See all my work →
      </Link>
    </div>
  )
}
