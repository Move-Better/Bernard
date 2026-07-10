// F6 Phase 4 — Practice Brain supersession review UI.
//
// Renders the "has your thinking changed?" confirm cards. Used in two places:
//   - PracticeBrainCard  → a card on Overview that self-hides when nothing pends
//   - PracticeBrainReviewList → the body of the Settings → Practice Brain page
//
// Confirming suppresses the older take from retrieval; rejecting keeps both.
// Nothing is ever deleted. All components are declared at module scope
// (react-hooks/static-components).

import { Brain, GitCompareArrows, History, Sparkles, ArrowRight, Bot, Check } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { usePracticeBrainSupersessions, useUpdateSupersession } from '@/lib/practiceBrain'

function SupersessionItem({ item, onAct, pending }) {
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-start gap-2 mb-4">
        <GitCompareArrows className="h-5 w-5 mt-0.5 text-info shrink-0" aria-hidden="true" />
        <div className="min-w-0">
          <p className="font-semibold leading-snug">Has your thinking changed here?</p>
          <p className="text-xs text-muted-foreground mt-0.5">
            A newer take looks like it reverses an older one. Confirm which represents how you practice today.
          </p>
        </div>
      </div>

      <div className="grid md:grid-cols-[1fr_auto_1fr] gap-3 items-stretch">
        <div className="rounded-lg border bg-muted p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <History className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
            <span className="text-3xs font-semibold uppercase tracking-wide text-muted-foreground">
              Earlier · {item.old_source_label || 'older note'}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{item.old_excerpt}</p>
        </div>

        <div className="hidden md:grid place-items-center">
          <ArrowRight className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
        </div>

        <div className="rounded-lg border border-success/30 bg-success/5 p-4">
          <div className="flex items-center gap-1.5 mb-2">
            <Sparkles className="h-3.5 w-3.5 text-success" aria-hidden="true" />
            <span className="text-3xs font-semibold uppercase tracking-wide text-success">
              Recently · {item.new_source_label || 'newer note'}
            </span>
          </div>
          <p className="text-sm leading-relaxed text-foreground/90">{item.new_excerpt}</p>
        </div>
      </div>

      <div className="flex items-center gap-1.5 mt-3 mb-4 text-2xs text-muted-foreground">
        <Bot className="h-3.5 w-3.5 shrink-0" aria-hidden="true" />
        Bernard flagged this. Nothing is hidden until you confirm — and nothing is ever deleted.
      </div>

      <div className="flex flex-wrap items-center gap-2">
        <Button size="sm" disabled={pending} onClick={() => onAct(item.id, 'confirm')}>
          <Check className="h-4 w-4" aria-hidden="true" /> Yes — use my newer take
        </Button>
        <Button size="sm" variant="outline" disabled={pending} onClick={() => onAct(item.id, 'reject')}>
          Keep both
        </Button>
        <span className="text-2xs text-muted-foreground ml-1">
          Confirming stops the older take from steering generated content.
        </span>
      </div>
    </div>
  )
}

export function PracticeBrainReviewList({ items }) {
  const update = useUpdateSupersession()
  const actingId = update.isPending ? update.variables?.id : null
  const onAct = (id, action) => {
    if (update.isPending) return
    update.mutate({ id, action })
  }
  return (
    <div className="space-y-3">
      {items.map((item) => (
        <SupersessionItem key={item.id} item={item} onAct={onAct} pending={actingId === item.id} />
      ))}
    </div>
  )
}

// Overview placement — a self-hiding card. Renders nothing until there's at
// least one candidate (the usual state on a settled corpus).
export function PracticeBrainCard() {
  const { data: items = [], isLoading } = usePracticeBrainSupersessions()
  if (isLoading || items.length === 0) return null
  return (
    <div className="rounded-xl border bg-card p-5 shadow-sm">
      <div className="flex items-center gap-2 mb-3">
        <Brain className="h-4 w-4 text-primary" aria-hidden="true" />
        <h2 className="text-sm font-semibold">Clinic knowledge</h2>
        <span className="text-3xs font-semibold rounded-full px-2 py-0.5 bg-action/10 text-action">
          {items.length} update{items.length === 1 ? '' : 's'} to review
        </span>
      </div>
      <PracticeBrainReviewList items={items} />
    </div>
  )
}
