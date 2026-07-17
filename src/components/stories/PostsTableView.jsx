import { useMemo, useState } from 'react'
import { useNavigate, Link } from 'react-router-dom'
import { Send, SearchX, AlertTriangle, Image as ImageIcon, Film, FileText } from 'lucide-react'
import { Button } from '@/components/ui/button'
import EmptyState from '@/components/EmptyState'
import { useContentItems } from '@/lib/queries'
import { formatStoryDate } from '@/lib/storyTitle'
import { isVideoEntry } from '@/lib/mediaEntry'

// Short channel labels for the compact Channels column (matches StoriesTableView).
const PLATFORM_SHORT = {
  instagram: 'IG', instagram_story: 'Story', facebook: 'FB', linkedin: 'LI',
  twitter: 'X', threads: 'Threads', gbp: 'GBP', blog: 'Blog', email: 'Email',
  tiktok: 'TT', youtube: 'YT', bluesky: 'Bsky', mastodon: 'Masto', pinterest: 'Pin',
}

// The three lifecycle sections, in "needs-you-first" order. Colors mirror the
// mock: amber (draft = act now), sky (scheduled = pending), emerald (published).
const SECTIONS = [
  { key: 'draft',     label: 'Drafts',    hint: 'needs you to publish or schedule', pill: 'bg-warning/15 text-warning', rail: 'border-warning' },
  { key: 'scheduled', label: 'Scheduled', hint: 'queued to go out',                 pill: 'bg-info/15 text-info',       rail: 'border-info' },
  { key: 'published', label: 'Published', hint: 'live on channel',                  pill: 'bg-success/15 text-success', rail: 'border-success' },
]

// Per-channel lifecycle state, derived from the row's own fields (no interview).
function pieceState(p) {
  if (p.status === 'failed') return 'failed'
  if (p.status === 'published' || p.published_at) return 'published'
  if (p.scheduled_at) return 'scheduled'
  return 'draft'
}

// A Post (all channels sharing a brief_id) rolls up to the section that most
// needs attention: anything unfinished pulls it back to Drafts.
function groupSection(states) {
  if (states.includes('failed') || states.includes('draft')) return 'draft'
  if (states.includes('scheduled')) return 'scheduled'
  return 'published'
}

// First non-empty line of the post body, stripped of a leading markdown heading
// marker — the scannable preview for the Post column.
function postPreview(content) {
  if (typeof content !== 'string') return ''
  const line = content.split('\n').map((l) => l.trim()).find(Boolean) || ''
  return line.replace(/^#{1,6}\s+/, '')
}

function mediaKind(pieces) {
  for (const p of pieces) {
    const media = Array.isArray(p.media_urls) ? p.media_urls : []
    if (media.some(isVideoEntry)) return 'video'
    if (media.length > 0) return 'photo'
  }
  return 'text'
}

function whenLabel(section, pieces) {
  const iso = section === 'scheduled'
    ? pieces.map((p) => p.scheduled_at).filter(Boolean).sort()[0]
    : section === 'published'
      ? pieces.map((p) => p.published_at || p.updated_at).filter(Boolean).sort().reverse()[0]
      : null
  if (!iso) return ''
  const d = new Date(iso)
  return d.toLocaleString('en-US', { month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' })
}

const MEDIA_ICON = { photo: ImageIcon, video: Film, text: FileText }
const FILTERS = [
  { key: 'all', label: 'All' },
  { key: 'draft', label: 'Drafts' },
  { key: 'scheduled', label: 'Scheduled' },
  { key: 'published', label: 'Published' },
]

/**
 * PostsTableView — the home for one-off "Post" content (a Post/Brief, which has
 * a brief_id and no interview, so buildStories() drops it and it never appears
 * in the Stories views). Groups the per-channel content_items back into one row
 * per Post, sectioned by lifecycle (Draft / Scheduled / Published). Each row
 * opens the existing /publish/:id editor + publish flow.
 */
export default function PostsTableView() {
  const navigate = useNavigate()
  const [filter, setFilter] = useState('all')
  const { data: items = [], isLoading } = useContentItems({ origin: 'post' })

  // Roll the per-channel content_items up into one entry per Post (brief_id).
  const posts = useMemo(() => {
    const byBrief = new Map()
    for (const it of items) {
      const key = it.brief_id || it.id
      const arr = byBrief.get(key)
      if (arr) arr.push(it)
      else byBrief.set(key, [it])
    }
    const list = []
    for (const [key, pieces] of byBrief) {
      const states = pieces.map(pieceState)
      const section = groupSection(states)
      const channels = [...new Set(pieces.map((p) => p.platform).filter(Boolean))]
      const createdMs = Math.max(...pieces.map((p) => new Date(p.created_at || 0).getTime()))
      // Open the piece that still needs work (a draft) when there is one, so a
      // click lands on something editable rather than an already-sent channel.
      const primary = pieces.find((p) => pieceState(p) === 'draft') || pieces[0]
      list.push({
        key,
        pieces,
        section,
        channels,
        createdMs,
        primaryId: primary.id,
        preview: postPreview(pieces[0].content),
        media: mediaKind(pieces),
        when: whenLabel(section, pieces),
        failed: states.includes('failed'),
      })
    }
    return list.sort((a, b) => b.createdMs - a.createdMs)
  }, [items])

  const visible = filter === 'all' ? posts : posts.filter((p) => p.section === filter)

  if (isLoading) {
    return (
      <div className="rounded-xl border border-border overflow-hidden">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="h-12 border-b border-border/60 bg-card animate-pulse last:border-b-0" />
        ))}
      </div>
    )
  }

  if (posts.length === 0) {
    return (
      <EmptyState
        icon={<Send className="h-5 w-5" />}
        title="No one-off posts yet"
        description="A Post is a quick, one-off message — an announcement, a promo, a photo — written once and sent to the channels you pick. Each one lands here so you can edit, schedule, or publish it."
        action={<Button asChild size="sm"><Link to="/new/brief">Write a post</Link></Button>}
      />
    )
  }

  // Group the visible posts into their lifecycle sections, preserving order.
  const bySection = SECTIONS.map((s) => ({
    ...s,
    rows: visible.filter((p) => p.section === s.key),
  })).filter((s) => s.rows.length > 0)

  return (
    <div className="flex flex-col gap-3">
      {/* One message → many channels — the "keep Post, clarify" contract, in copy. */}
      <p className="text-xs text-muted-foreground">
        Each row is one post you wrote once — the chips show the channels it went to.
      </p>

      {/* Lifecycle filter */}
      <div className="flex items-center gap-1.5" role="tablist" aria-label="Filter posts by status">
        {FILTERS.map((f) => {
          const active = filter === f.key
          const count = f.key === 'all' ? posts.length : posts.filter((p) => p.section === f.key).length
          return (
            <button
              key={f.key}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => setFilter(f.key)}
              className={`shrink-0 text-xs font-semibold px-3 py-1.5 rounded-full border transition-colors ${
                active
                  ? 'bg-primary text-primary-foreground border-primary'
                  : 'border-border text-muted-foreground hover:border-primary/40 bg-background'
              }`}
            >
              {f.label}
              <span className={`ml-1.5 tabular-nums ${active ? 'text-primary-foreground/70' : 'text-muted-foreground/60'}`}>{count}</span>
            </button>
          )
        })}
      </div>

      {visible.length === 0 ? (
        <div className="py-16 text-center text-muted-foreground flex flex-col items-center">
          <div className="h-11 w-11 rounded-full bg-muted flex items-center justify-center mb-3">
            <SearchX className="h-5 w-5" aria-hidden="true" />
          </div>
          <p className="text-sm font-medium text-foreground">No {FILTERS.find((f) => f.key === filter)?.label.toLowerCase()} posts</p>
          <p className="text-xs mt-1">Switch to another status to see more.</p>
        </div>
      ) : (
        <div className="overflow-x-auto rounded-xl border border-border">
          <table className="w-full min-w-[720px] border-collapse text-sm">
            <thead>
              <tr className="bg-muted/60 text-muted-foreground">
                <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-24">Date</th>
                <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2">Post</th>
                <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-44">Channels</th>
                <th className="text-left font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-28">Status</th>
                <th className="text-right font-semibold text-2xs uppercase tracking-wide px-3.5 py-2 w-36">When</th>
              </tr>
            </thead>
            <tbody>
              {bySection.map((s) => (
                <SectionRows key={s.key} section={s} navigate={navigate} />
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  )
}

// A lifecycle section header row followed by its post rows. Module-scope
// component (react-hooks/static-components) so it isn't redefined each render.
function SectionRows({ section, navigate }) {
  const MediaIconFor = (m) => MEDIA_ICON[m] || FileText
  return (
    <>
      <tr aria-hidden="true">
        <td colSpan={5} className="bg-muted/40 px-3.5 py-1.5">
          <span className="inline-flex items-center gap-2">
            <span className={`text-3xs font-bold uppercase tracking-wider rounded-full px-2 py-0.5 ${section.pill}`}>
              {section.label} · {section.rows.length}
            </span>
            <span className="text-2xs text-muted-foreground">{section.hint}</span>
          </span>
        </td>
      </tr>
      {section.rows.map((p) => {
        const MediaIcon = MediaIconFor(p.media)
        return (
          <tr
            key={p.key}
            onClick={() => navigate(`/publish/${p.primaryId}`)}
            className="border-b border-border/60 last:border-b-0 hover:bg-primary/5 cursor-pointer transition-colors"
          >
            <td className={`px-3.5 py-2.5 align-middle whitespace-nowrap font-mono text-xs tabular-nums text-muted-foreground border-l-2 ${section.rail}`}>
              {formatStoryDate(p.createdMs) || '—'}
            </td>
            <td className="px-3.5 py-2.5 align-middle max-w-0">
              <div className="flex items-center gap-2.5 min-w-0">
                <span className="shrink-0 h-6 w-6 rounded-md bg-muted flex items-center justify-center text-muted-foreground">
                  <MediaIcon className="h-3.5 w-3.5" aria-hidden="true" />
                </span>
                <Link
                  to={`/publish/${p.primaryId}`}
                  onClick={(e) => e.stopPropagation()}
                  className="font-semibold text-foreground truncate hover:underline focus:outline-none focus-visible:underline"
                  title={p.preview || 'Untitled post'}
                >
                  {p.preview || <span className="italic text-muted-foreground font-normal">Untitled post</span>}
                </Link>
                {p.failed && (
                  <span className="shrink-0 inline-flex items-center gap-1 text-3xs font-bold rounded-full px-1.5 py-0.5 bg-destructive text-destructive-foreground">
                    <AlertTriangle className="w-2.5 h-2.5" aria-hidden="true" /> failed
                  </span>
                )}
              </div>
            </td>
            <td className="px-3.5 py-2.5 align-middle">
              <div className="flex items-center gap-1">
                {p.channels.slice(0, 4).map((c) => (
                  <span key={c} className="inline-flex items-center text-3xs font-semibold rounded px-1.5 py-0.5 whitespace-nowrap border text-muted-foreground bg-muted border-border">
                    {PLATFORM_SHORT[c] ?? c}
                  </span>
                ))}
                {p.channels.length > 4 && (
                  <span className="text-3xs font-semibold text-muted-foreground px-1">+{p.channels.length - 4}</span>
                )}
              </div>
            </td>
            <td className="px-3.5 py-2.5 align-middle">
              <span className={`inline-flex items-center text-2xs font-semibold px-2 py-0.5 rounded-full ${section.pill}`}>
                {section.label.replace(/s$/, '')}
              </span>
            </td>
            <td className="px-3.5 py-2.5 align-middle text-right whitespace-nowrap text-xs text-muted-foreground tabular-nums">
              {p.when || <span className="text-primary font-semibold">Edit →</span>}
            </td>
          </tr>
        )
      })}
    </>
  )
}
