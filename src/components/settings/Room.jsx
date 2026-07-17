// Shared "room" primitives for the Brand settings screens (Voice / Identity /
// Look). The organizing idea: instead of one long scroll of undifferentiated
// fields, each section is a contained card ("room") with an icon, a title, and
// a one-line purpose — plus a SectionGuide at the top that jumps between rooms
// and shows completion at a glance. Presentation only; no data logic lives here.

import { Check, AlertTriangle, ChevronRight } from 'lucide-react'
import { cn } from '@/lib/utils'

// Numbered jump-nav shown under a page header. items: [{ id, label, done }].
// Clicking scrolls the matching Room (by DOM id) into view.
export function SectionGuide({ items }) {
  return (
    <nav aria-label="Sections" className="flex flex-wrap gap-2">
      {items.map((it, i) => (
        <button
          key={it.id}
          type="button"
          onClick={() => document.getElementById(it.id)?.scrollIntoView({ behavior: 'smooth', block: 'start' })}
          className="inline-flex items-center gap-2 rounded-full border border-border bg-card pl-2 pr-3 py-1.5 text-xs font-semibold text-muted-foreground transition-colors hover:border-primary/40 hover:text-foreground"
        >
          <span className="grid h-5 w-5 place-items-center rounded-full bg-primary/10 text-2xs font-bold text-primary">
            {i + 1}
          </span>
          {it.label}
          {it.done && <span className="h-1.5 w-1.5 rounded-full bg-success" aria-label="complete" />}
        </button>
      ))}
    </nav>
  )
}

// A small status pill. tone: 'done' (emerald) | 'todo' (amber "needs attention").
export function StatePill({ label, tone = 'done' }) {
  const done = tone === 'done'
  const Icon = done ? Check : AlertTriangle
  return (
    <span
      className={cn(
        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-xs font-semibold whitespace-nowrap',
        done
          ? 'bg-success/10 text-success border-success/25'
          : 'bg-action/10 text-action border-action/30'
      )}
    >
      <Icon className="h-3 w-3" />
      {label}
    </span>
  )
}

// A contained section card. icon is a lucide component; state is an optional
// { label, tone } for the header pill; action is optional header-right content.
export function Room({ id, icon: Icon, title, purpose, state, action, children, className }) {
  return (
    <section id={id} className={cn('scroll-mt-6 overflow-hidden rounded-2xl border border-border bg-card shadow-sm', className)}>
      <header className="flex items-center gap-3 border-b border-border/60 px-5 py-4">
        {Icon && (
          <span className="grid h-9 w-9 shrink-0 place-items-center rounded-xl bg-primary/10 text-primary">
            <Icon className="h-5 w-5" />
          </span>
        )}
        <div className="min-w-0 flex-1">
          <h2 className="text-base font-semibold tracking-tight">{title}</h2>
          {purpose && <p className="text-xs text-muted-foreground mt-0.5">{purpose}</p>}
        </div>
        {state && <StatePill label={state.label} tone={state.tone} />}
        {action}
      </header>
      <div className="space-y-4 px-5 pb-5 pt-4">
        {children}
      </div>
    </section>
  )
}

// A quiet sub-heading inside a room, with an optional right-aligned count/note.
export function RoomSubhead({ title, note, className }) {
  return (
    <div className={cn('flex items-baseline gap-2', className)}>
      <h3 className="text-xs font-semibold">{title}</h3>
      {note && <span className="text-2xs text-muted-foreground">{note}</span>}
    </div>
  )
}

// Progressive-disclosure block. Heavy/secondary content collapses behind a
// dashed summary row so the resting state stays calm. Uses native <details>.
export function Collapse({ summary, hint, children, defaultOpen = false, className }) {
  return (
    <details open={defaultOpen} className={cn('group rounded-xl border border-dashed border-border bg-muted/30', className)}>
      <summary className="flex cursor-pointer list-none items-center gap-2 px-3.5 py-2.5 text-xs font-semibold text-muted-foreground [&::-webkit-details-marker]:hidden">
        <ChevronRight className="h-3.5 w-3.5 text-muted-foreground/70 transition-transform group-open:rotate-90" />
        <span className="text-foreground">{summary}</span>
        {hint && <span className="font-normal text-muted-foreground">{hint}</span>}
      </summary>
      <div className="space-y-3 px-3.5 pb-3.5">
        {children}
      </div>
    </details>
  )
}
