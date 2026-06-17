import { useEffect, useMemo, useState } from 'react'
import { Link } from 'react-router-dom'
import {
  DndContext, DragOverlay, PointerSensor, KeyboardSensor,
  useSensor, useSensors, useDraggable, useDroppable, closestCorners,
} from '@dnd-kit/core'
import { FileText, Clock, CheckCircle2, CalendarDays, Send, Image as ImageIcon, ExternalLink, ClipboardList, GripVertical } from 'lucide-react'
import { toast } from 'sonner'
import { formatRelativeDate } from '@/lib/utils'
import { PLATFORM_META } from '@/lib/contentMeta'
import { getContentStatusToken } from '@/lib/contentStatusTokens'

// Five lanes in workflow order. Archived items are intentionally excluded —
// they don't belong on the active pipeline. Published items DO render here
// so the publisher sees recently-shipped work on the right edge.
//
// The Kanban is read-only by default. When an `onMove` handler is passed it
// becomes a drag-to-transition board for the REVIEW lanes only — see MOVABLE.
// Per-lane accent rail color aligns with contentStatusTokens hues.
const LANES = [
  { id: 'draft',     icon: FileText,     publisherInbox: false, rail: '#94a3b8' /* slate-400 */ },
  { id: 'in_review', icon: Clock,        publisherInbox: false, rail: '#d97706' /* amber-600 */ },
  { id: 'approved',  icon: CheckCircle2, publisherInbox: true,  rail: 'hsl(var(--action))' /* act-now */ },
  { id: 'scheduled', icon: CalendarDays, publisherInbox: false, rail: '#7c3aed' /* violet-600 */ },
  { id: 'published', icon: Send,         publisherInbox: false, rail: '#059669' /* emerald-600 */ },
]

// Statuses a card can be dragged between. draft/in_review/approved are pure
// status flips with an audit stamp (reviewedBy / approvedBy) — safe to set from
// a drag. scheduled & published carry Buffer side-effects (scheduledAt,
// bufferUpdateId, publish), so those lanes are NOT drop targets and their cards
// are NOT draggable — schedule/publish stay in the story detail.
const MOVABLE = new Set(['draft', 'in_review', 'approved'])

export default function PipelineKanban({ items, onMove }) {
  const interactive = typeof onMove === 'function'
  // Optimistic overrides: item id → status. Bridges the gap between drop and
  // the server refetch so the card moves instantly.
  const [overrides, setOverrides] = useState({})
  const [activeId, setActiveId] = useState(null)

  // Drop an override once the server data catches up to it (or diverges).
  useEffect(() => {
    setOverrides((prev) => {
      let changed = false
      const next = { ...prev }
      for (const it of items) {
        if (next[it.id] !== undefined && it.status === next[it.id]) {
          delete next[it.id]
          changed = true
        }
      }
      return changed ? next : prev
    })
  }, [items])

  const effective = useMemo(
    () => items.map((it) => (overrides[it.id] ? { ...it, status: overrides[it.id] } : it)),
    [items, overrides],
  )
  const grouped = useMemo(
    () => LANES.reduce((acc, lane) => {
      acc[lane.id] = effective.filter((i) => i.status === lane.id)
      return acc
    }, {}),
    [effective],
  )

  const sensors = useSensors(
    useSensor(PointerSensor, { activationConstraint: { distance: 4 } }),
    useSensor(KeyboardSensor),
  )
  const activeItem = activeId ? effective.find((i) => i.id === activeId) : null

  function handleDragEnd({ active, over }) {
    setActiveId(null)
    if (!interactive || !over) return
    const id = active.id
    const from = active.data.current?.from
    const to = over.id
    if (!MOVABLE.has(to) || to === from) return
    setOverrides((o) => ({ ...o, [id]: to }))
    Promise.resolve(onMove({ id, from, to })).catch(() => {
      setOverrides((o) => {
        const n = { ...o }
        delete n[id]
        return n
      })
      toast.error('Could not move card')
    })
  }

  // Always render inside a DndContext so LaneColumn's useDroppable always has
  // its provider — even in read-only mode (no onMove), where the context is
  // inert (no draggable cards, all lanes disabled as drop targets).
  return (
    <DndContext
      sensors={sensors}
      collisionDetection={closestCorners}
      onDragStart={(e) => setActiveId(e.active.id)}
      onDragEnd={handleDragEnd}
      onDragCancel={() => setActiveId(null)}
    >
      <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-5 gap-3">
        {LANES.map((lane) => (
          <LaneColumn
            key={lane.id}
            lane={lane}
            items={grouped[lane.id] || []}
            isPublisherInbox={lane.publisherInbox}
            interactive={interactive}
          />
        ))}
      </div>
      {interactive && (
        <DragOverlay>
          {activeItem ? <div className="w-[260px]"><CardContent item={activeItem} dragging /></div> : null}
        </DragOverlay>
      )}
    </DndContext>
  )
}

function LaneColumn({ lane, items, isPublisherInbox, interactive }) {
  const Icon = lane.icon
  const token = getContentStatusToken(lane.id)
  const droppable = interactive && MOVABLE.has(lane.id)
  // useDroppable is always called (rules-of-hooks); `disabled` makes scheduled/
  // published non-targets without an extra component. In read-only mode the
  // whole tree is outside a DndContext, so the hook is disabled+harmless.
  const { setNodeRef, isOver } = useDroppable({ id: lane.id, disabled: !droppable })

  const surface = isPublisherInbox
    ? 'border-primary/30 bg-gradient-to-b from-white to-[hsl(var(--primary)/0.05)] shadow-[0_1px_2px_rgba(15,23,42,0.04),0_8px_24px_-18px_rgba(12,117,128,0.25)]'
    : 'border-border bg-card shadow-[0_1px_2px_rgba(15,23,42,0.03)]'
  const dropRing = droppable && isOver ? 'ring-2 ring-primary/50 ring-offset-1' : ''

  return (
    <div ref={interactive ? setNodeRef : undefined} className={`rounded-2xl border p-3 transition-shadow ${surface} ${dropRing}`}>
      <div className="flex items-center justify-between gap-2 mb-3 px-1">
        <div className="flex items-center gap-2 min-w-0">
          <span className="inline-block w-1 h-5 rounded-full shrink-0" style={{ background: lane.rail }} aria-hidden="true" />
          <Icon className={`h-3.5 w-3.5 ${isPublisherInbox ? 'text-primary' : 'text-muted-foreground'}`} />
          <span className={`text-sm font-bold tracking-tight ${isPublisherInbox ? 'text-primary' : 'text-foreground'}`}>
            {token.label}
          </span>
          {isPublisherInbox && items.length > 0 && (
            <span className="text-3xs font-bold uppercase tracking-wider text-primary ml-0.5">your queue</span>
          )}
        </div>
        <span
          className={
            isPublisherInbox
              ? 'text-3xs font-bold rounded-full px-2 py-0.5 bg-primary text-primary-foreground'
              : `text-3xs font-semibold rounded-full px-2 py-0.5 ${token.badge}`
          }
        >
          {items.length}
        </span>
      </div>
      <div className="space-y-2 min-h-[80px]">
        {items.length === 0 && <p className="text-2xs text-muted-foreground italic px-1">Nothing here yet.</p>}
        {items.map((item) =>
          interactive && MOVABLE.has(item.status)
            ? <DraggableCard key={item.id} item={item} />
            : <StaticCard key={item.id} item={item} />,
        )}
      </div>
    </div>
  )
}

function VoiceDriftChip({ provenance }) {
  if (!provenance?.summary) return null
  const { verbatim_pct = 0, paraphrase_pct = 0 } = provenance.summary
  const ownWords = Math.round(verbatim_pct + paraphrase_pct)
  if (ownWords === 0) return null
  const color = ownWords >= 60 ? 'text-agreement-signal bg-agreement-signal/10' : ownWords >= 35 ? 'text-amber-700 bg-amber-50' : 'text-slate-600 bg-slate-50'
  return (
    <span className={`inline-flex items-center gap-0.5 rounded px-1 py-0.5 text-3xs font-medium ${color}`}>
      {ownWords}% voice
    </span>
  )
}

// Pure visual card body. Shared by the static Link card and the DragOverlay.
function CardContent({ item, dragging, handle }) {
  const pm = PLATFORM_META[item.platform] || { label: item.platform, icon: FileText, color: 'text-slate-600', bg: 'bg-slate-50' }
  const Icon = pm.icon
  const hasMedia = Array.isArray(item.media_urls) && item.media_urls.length > 0
  const snippet = (item.content || '').slice(0, 90)
  const scheduledAt = item.scheduled_at ? new Date(item.scheduled_at) : null
  const showVoiceDrift = ['approved', 'scheduled', 'published'].includes(item.status)

  return (
    <div className={`relative rounded-xl border border-border bg-white p-2.5 text-xs space-y-1.5 ${dragging ? 'shadow-[0_12px_28px_-12px_rgba(15,23,42,0.35)] ring-2 ring-primary/40' : ''}`}>
      {handle}
      <div className="flex items-center justify-between gap-1.5">
        <div className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full ${pm.bg}`}>
          <Icon className={`h-2.5 w-2.5 ${pm.color}`} />
          <span className={`text-3xs font-semibold ${pm.color}`}>{pm.label}</span>
        </div>
        <div className="flex items-center gap-1">
          {item.brief_id && (
            <span className="inline-flex items-center gap-0.5 px-1 py-0.5 rounded text-3xs font-semibold bg-action/10 text-action">
              <ClipboardList className="h-2 w-2" />Brief
            </span>
          )}
          {showVoiceDrift && <VoiceDriftChip provenance={item.provenance} />}
          {hasMedia && <ImageIcon className="h-3 w-3 text-muted-foreground" />}
        </div>
      </div>
      <p className="font-semibold leading-snug line-clamp-2 text-foreground">{item.topic}</p>
      {snippet && <p className="text-muted-foreground text-2xs line-clamp-2">{snippet}</p>}
      <div className="flex items-center justify-between gap-2 text-3xs text-muted-foreground pt-1 border-t border-slate-100">
        <span className="truncate">
          {scheduledAt ? scheduledAt.toLocaleString(undefined, { month: 'short', day: 'numeric', hour: 'numeric' }) : formatRelativeDate(item.updated_at)}
        </span>
        <span className="text-primary shrink-0 inline-flex items-center gap-0.5 font-semibold">
          <ExternalLink className="h-2.5 w-2.5" />
          Open
        </span>
      </div>
      {item.reviewed_by && (
        <p className="text-3xs text-muted-foreground truncate" title={item.reviewed_by}>Reviewer: {item.reviewed_by}</p>
      )}
    </div>
  )
}

function itemHref(item) {
  return item.interview_id ? `/stories/${item.interview_id}?piece=${item.id}` : `/review/${item.id}`
}

// Read-only card: the whole card navigates to the story.
function StaticCard({ item }) {
  return (
    <Link
      to={itemHref(item)}
      className="block transition-all duration-150 hover:-translate-y-0.5 [&>div]:hover:border-primary/30 [&>div]:hover:shadow-[0_8px_20px_-16px_rgba(15,23,42,0.18)]"
    >
      <CardContent item={item} />
    </Link>
  )
}

// Interactive card: a drag handle (top-right grip) initiates the drag; the rest
// of the card still navigates on click. setActivatorNodeRef scopes the drag to
// the handle so click-to-open is never swallowed.
function DraggableCard({ item }) {
  const { attributes, listeners, setNodeRef, setActivatorNodeRef, isDragging } = useDraggable({
    id: item.id,
    data: { from: item.status },
  })
  const handle = (
    <button
      ref={setActivatorNodeRef}
      {...attributes}
      {...listeners}
      onClick={(e) => e.preventDefault()}
      aria-label="Drag to move"
      className="absolute top-1 right-1 z-10 grid place-items-center h-6 w-6 rounded-md text-muted-foreground/60 hover:text-foreground hover:bg-muted cursor-grab touch-none"
    >
      <GripVertical className="h-3.5 w-3.5" />
    </button>
  )
  return (
    <div ref={setNodeRef} className={isDragging ? 'opacity-30' : ''}>
      <Link
        to={itemHref(item)}
        className="block transition-all duration-150 hover:-translate-y-0.5 [&>div]:hover:border-primary/30 [&>div]:hover:shadow-[0_8px_20px_-16px_rgba(15,23,42,0.18)]"
      >
        <CardContent item={item} handle={handle} />
      </Link>
    </div>
  )
}
