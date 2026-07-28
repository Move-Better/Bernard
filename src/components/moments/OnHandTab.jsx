import { useMemo, useState } from 'react'
import { Link, useNavigate } from 'react-router-dom'
import { useQueryClient } from '@tanstack/react-query'
import { Loader2, MoreHorizontal, Search, PlayCircle, Quote } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { Select, SelectTrigger, SelectValue, SelectContent, SelectItem } from '@/components/ui/select'
import { Popover, PopoverTrigger, PopoverContent } from '@/components/ui/popover'
import { ConfirmDialog } from '@/components/ui/alert-dialog'
import { useAppMutation } from '@/lib/useAppMutation'
import { apiFetch } from '@/lib/api'
import { toast } from '@/lib/toast'
import ErrorState from '@/components/ErrorState'

// Display labels for the scoreMoments.js taxonomy. Local mirror — the api/
// module can't be imported across the client/server boundary (same note as
// MomentsPanel.jsx).
const MOMENT_TYPE_LABELS = {
  coaching_cue: 'Coaching cue',
  patient_breakthrough: 'Patient breakthrough',
  hook: 'Hook',
  credibility: 'Credibility',
  insight: 'Insight',
  technique: 'Technique',
  story: 'Story',
}

const SORTS = [
  { key: 'strongest', label: 'Strongest first' },
  { key: 'newest', label: 'Newest first' },
  { key: 'most_used', label: 'Most used' },
]

function scoreTone(score) {
  if (score >= 80) return 'bg-primary/10 text-primary'
  if (score >= 60) return 'text-foreground/70 bg-muted'
  return 'bg-muted text-muted-foreground'
}

function fmtDay(iso) {
  if (!iso) return null
  return new Date(iso).toLocaleDateString(undefined, { month: 'short', day: 'numeric' })
}

function RowMenu({ m, onRetire, onRestore }) {
  const navigate = useNavigate()
  const [open, setOpen] = useState(false)
  const item =
    'w-full text-left px-3 py-1.5 rounded-md text-sm hover:bg-muted transition-colors'
  return (
    <Popover open={open} onOpenChange={setOpen}>
      <PopoverTrigger asChild>
        <button
          type="button"
          aria-label="Moment actions"
          className="shrink-0 p-1.5 rounded-md text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
        >
          <MoreHorizontal className="h-4 w-4" />
        </button>
      </PopoverTrigger>
      <PopoverContent align="end" className="w-48 p-1.5">
        <button type="button" className={item} onClick={() => { setOpen(false); navigate(`/stories/${m.interview_id}`) }}>
          Open story
        </button>
        {m.clip_asset_id && (
          <button type="button" className={item} onClick={() => { setOpen(false); navigate(`/moments/clip/${m.clip_asset_id}`) }}>
            Open clip
          </button>
        )}
        {m.status === 'retired' ? (
          <button type="button" className={item} onClick={() => { setOpen(false); onRestore(m) }}>
            Restore
          </button>
        ) : (
          <button
            type="button"
            className={`${item} text-muted-foreground`}
            onClick={() => { setOpen(false); onRetire(m) }}
          >
            Retire
          </button>
        )}
      </PopoverContent>
    </Popover>
  )
}

function MomentRow({ m, staffName, onRetire, onRestore }) {
  const retired = m.status === 'retired'
  const typeLabel = MOMENT_TYPE_LABELS[m.moment_type] || m.moment_type || 'Moment'
  const interviewLabel = m.interview?.topic || 'Untitled story'
  const interviewDay = fmtDay(m.interview?.created_at)
  return (
    <div className="flex items-start gap-3 py-3.5 border-t border-border first:border-t-0">
      <span
        className={`shrink-0 inline-flex items-center justify-center min-w-[30px] rounded-md px-1.5 py-0.5 text-xs font-bold tabular-nums ${scoreTone(m.score ?? 0)}`}
        title="Post-worthiness score at extraction (0–100)"
      >
        {m.score ?? '—'}
      </span>
      <div className="min-w-0 flex-1">
        <blockquote className={`text-sm leading-relaxed ${retired ? 'text-muted-foreground' : 'text-foreground/90'}`}>
          &ldquo;{m.excerpt}&rdquo;
        </blockquote>
        <div className="flex flex-wrap items-center gap-x-2 gap-y-1 mt-1 text-2xs text-muted-foreground">
          <span className="font-semibold text-foreground/60">{typeLabel}</span>
          {m.topic && <span>· {m.topic}</span>}
          <span>
            · from{' '}
            <Link to={`/stories/${m.interview_id}`} className="font-medium text-primary hover:underline">
              {interviewLabel}
            </Link>
            {interviewDay && <> · {interviewDay}</>}
          </span>
          {staffName && <span>· {staffName}</span>}
          {m.usage_count > 0 && (
            <span>
              · used ×{m.usage_count}
              {m.last_used_at && <> · last {fmtDay(m.last_used_at)}</>}
            </span>
          )}
          {m.clip_asset_id && (
            <span className="inline-flex items-center gap-1 rounded px-1.5 py-0.5 text-3xs font-bold text-primary bg-primary/10">
              <PlayCircle className="h-3 w-3" />clip attached
            </span>
          )}
          {retired && (
            <span className="uppercase tracking-wide font-bold text-3xs rounded px-1.5 py-0.5 bg-muted text-muted-foreground">
              Retired
            </span>
          )}
        </div>
      </div>
      <RowMenu m={m} onRetire={onRetire} onRestore={onRestore} />
    </div>
  )
}

/**
 * The /moments "On hand" tab — the workspace's usable inventory as a list
 * (never a grid), searchable and filterable, with quiet retire/restore.
 * Data comes from the page-level bank query so the header stats and the tab
 * count stay one fetch.
 */
export default function OnHandTab({ moments, isLoading, error, refetch, staffMap }) {
  const navigate = useNavigate()
  const queryClient = useQueryClient()
  const [search, setSearch] = useState('')
  const [type, setType] = useState('all')
  const [staffId, setStaffId] = useState('all')
  const [sort, setSort] = useState('strongest')
  const [retireTarget, setRetireTarget] = useState(null)

  const staffOptions = useMemo(() => {
    const ids = [...new Set((moments || []).map((m) => m.staff_id).filter(Boolean))]
    return ids
      .map((id) => ({ id, name: staffMap[id] }))
      .filter((s) => s.name)
      .sort((a, b) => a.name.localeCompare(b.name))
  }, [moments, staffMap])

  const visible = useMemo(() => {
    let list = moments || []
    if (type !== 'all') list = list.filter((m) => m.moment_type === type)
    if (staffId !== 'all') list = list.filter((m) => m.staff_id === staffId)
    const q = search.trim().toLowerCase()
    if (q) {
      list = list.filter((m) =>
        [m.excerpt, m.hook, m.topic, m.interview?.topic]
          .some((t) => t && t.toLowerCase().includes(q)),
      )
    }
    const byInterviewDate = (m) => new Date(m.interview?.created_at || m.created_at || 0).getTime()
    list = [...list]
    if (sort === 'newest') list.sort((a, b) => byInterviewDate(b) - byInterviewDate(a))
    else if (sort === 'most_used') list.sort((a, b) => (b.usage_count || 0) - (a.usage_count || 0) || (b.score || 0) - (a.score || 0))
    else list.sort((a, b) => (b.score || 0) - (a.score || 0))
    return list
  }, [moments, type, staffId, search, sort])

  const statusMutation = useAppMutation({
    errorMessage: 'Could not update this moment',
    mutationFn: ({ id, status }) =>
      apiFetch(`/api/db/moments?id=${encodeURIComponent(id)}`, {
        method: 'PATCH',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ status }),
      }),
    onSuccess: (_data, { status }) => {
      queryClient.invalidateQueries({ queryKey: ['moment-bank'] })
      setRetireTarget(null)
      toast(status === 'retired' ? 'Retired — Bernard won’t use this moment again.' : 'Restored — back on hand.')
    },
  })

  if (isLoading) {
    return (
      <div role="status" className="flex justify-center py-16">
        <Loader2 className="h-8 w-8 animate-spin text-muted-foreground" aria-hidden="true" />
        <span className="sr-only">Loading moments…</span>
      </div>
    )
  }
  if (error) return <ErrorState message="Failed to load moments" onRetry={refetch} size="sm" />

  const total = (moments || []).length
  const plannedN = retireTarget?.planned_count || 0

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:flex-wrap">
        <div className="relative">
          <Search className="w-4 h-4 absolute left-2.5 top-1/2 -translate-y-1/2 text-muted-foreground pointer-events-none" />
          <input
            type="search"
            aria-label="Search moments"
            placeholder="Search moments…"
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            className="pl-8 pr-3 py-1.5 rounded-lg border border-border bg-card text-sm w-full sm:w-56 outline-none focus:ring-2 focus:ring-primary/30"
          />
        </div>
        <Select value={type} onValueChange={setType}>
          <SelectTrigger className="h-9 text-sm w-auto min-w-[110px]" aria-label="Filter by type">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            <SelectItem value="all">All types</SelectItem>
            {Object.entries(MOMENT_TYPE_LABELS).map(([k, label]) => (
              <SelectItem key={k} value={k}>{label}</SelectItem>
            ))}
          </SelectContent>
        </Select>
        {staffOptions.length > 0 && (
          <Select value={staffId} onValueChange={setStaffId}>
            <SelectTrigger className="h-9 text-sm w-auto min-w-[110px]" aria-label="Filter by staff">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All staff</SelectItem>
              {staffOptions.map((s) => <SelectItem key={s.id} value={s.id}>{s.name}</SelectItem>)}
            </SelectContent>
          </Select>
        )}
        <Select value={sort} onValueChange={setSort}>
          <SelectTrigger className="h-9 text-sm w-auto min-w-[130px]" aria-label="Sort moments">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SORTS.map((s) => <SelectItem key={s.key} value={s.key}>{s.label}</SelectItem>)}
          </SelectContent>
        </Select>
      </div>

      {total === 0 ? (
        <div className="flex flex-col items-center justify-center py-16 gap-3 text-center rounded-xl border-2 border-dashed border-border">
          <Quote className="h-8 w-8 text-muted-foreground" />
          <p className="text-sm font-semibold">Nothing on hand yet</p>
          <p className="text-xs text-muted-foreground max-w-sm">
            Capture a conversation and Bernard mines it into moments — verbatim
            excerpts your weekly content gets composed from.
          </p>
          <Button size="sm" variant="outline" onClick={() => navigate('/new')}>
            Capture a conversation
          </Button>
        </div>
      ) : visible.length === 0 ? (
        <div className="flex flex-col items-center justify-center py-12 gap-2 text-center rounded-xl border-2 border-dashed border-border">
          <p className="text-sm font-semibold">No moments match</p>
          <p className="text-xs text-muted-foreground">Try a different search, type, or staff member.</p>
        </div>
      ) : (
        <div className="flex flex-col">
          {visible.map((m) => (
            <MomentRow
              key={m.id}
              m={m}
              staffName={staffMap[m.staff_id]}
              onRetire={setRetireTarget}
              onRestore={(row) => statusMutation.mutate({ id: row.id, status: 'banked' })}
            />
          ))}
        </div>
      )}

      <ConfirmDialog
        open={!!retireTarget}
        onOpenChange={(open) => { if (!open) setRetireTarget(null) }}
        title="Retire this moment?"
        description={
          plannedN > 0
            ? `Stops future use — Bernard won't compose new pieces from it. ${plannedN} planned piece${plannedN === 1 ? '' : 's'} keep${plannedN === 1 ? 's' : ''} their drafts.`
            : 'Stops future use — Bernard won’t compose new pieces from it. No planned pieces are affected.'
        }
        confirmLabel="Retire"
        destructive={false}
        loading={statusMutation.isPending}
        onConfirm={() => retireTarget && statusMutation.mutate({ id: retireTarget.id, status: 'retired' })}
      />
    </div>
  )
}
