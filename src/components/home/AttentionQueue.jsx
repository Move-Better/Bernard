// Home's attention queue — every "needs a human" signal in one card, each row
// one click from the thing it names.
//
// Replaces three surfaces that used to stack on Home: the amber count strip,
// the failed-publish banner above it, and the channel-health banner below it.
// Folding the two red banners in is what makes the headline count honest —
// they were previously excluded from it, so "16 items need your attention"
// was never the real total (Q, 2026-08-11).
//
// The rules (what's blocked, where a row links, how ties break) live in
// src/lib/attentionItems.js as a pure function. Nothing here decides anything;
// this file only draws. See that module for why.

import { Link } from 'react-router-dom'
import {
  AlertTriangle, ChevronRight, Eye, Inbox, Mic2, Send, Sparkles, BookOpen, MessageSquareQuote,
} from 'lucide-react'
import { TIERS, attentionSummary } from '@/lib/attentionItems'

const TIER_META = {
  blocked: {
    label: 'Blocked',
    hint: 'Already broken — nothing publishes until these are cleared',
    labelClass: 'text-destructive',
    iconClass: 'bg-destructive/10 text-destructive',
  },
  waiting: {
    label: 'Waiting on you',
    hint: null,
    labelClass: 'text-action',
    iconClass: 'bg-action/10 text-action',
  },
  slipping: {
    label: 'Slipping',
    hint: null,
    labelClass: 'text-muted-foreground',
    iconClass: 'bg-muted text-muted-foreground',
  },
}

const KIND_ICON = {
  channel: AlertTriangle,
  failed: AlertTriangle,
  words: Mic2,
  review: Eye,
  publish: Send,
  blog: BookOpen,
  answer: MessageSquareQuote,
  supersession: Sparkles,
  overdue: Mic2,
}

function AttentionRow({ item, iconClass }) {
  const Icon = KIND_ICON[item.kind] || Inbox
  return (
    <Link
      to={item.to}
      // text-foreground because an <a> otherwise inherits the global link
      // colour and repaints the row title teal, which then competes with the
      // CTA for the eye (see CLAUDE.md, "Making a static element clickable").
      className="flex items-center gap-3 border-t border-border/60 px-4 py-2.5 text-foreground transition-colors hover:bg-accent/40 focus-visible:bg-accent/40 first:border-t-0"
    >
      <span className={`flex h-6 w-6 shrink-0 items-center justify-center rounded ${iconClass}`}>
        <Icon className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
      <span className="min-w-0 flex-1">
        <span className="block truncate text-sm font-semibold">{item.title}</span>
        <span className="block truncate text-2xs text-muted-foreground">{item.meta}</span>
      </span>
      <span className="inline-flex shrink-0 items-center gap-0.5 text-xs font-semibold text-primary">
        {item.cta} <ChevronRight className="h-3.5 w-3.5" aria-hidden="true" />
      </span>
    </Link>
  )
}

/**
 * @param {{ queue: ReturnType<import('@/lib/attentionItems').buildAttentionItems> }} props
 */
export default function AttentionQueue({ queue }) {
  if (!queue || queue.total === 0) return null

  const { total, byTier, counts } = queue

  return (
    <section
      aria-label="Things that need you"
      className="overflow-hidden rounded-lg border border-border border-l-4 border-l-action bg-card"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1 bg-action/10 px-4 py-3">
        <span className="flex h-6 w-6 shrink-0 items-center justify-center rounded-full bg-action text-action-foreground">
          <Inbox className="h-4 w-4" aria-hidden="true" />
        </span>
        <h2 className="text-sm font-semibold text-foreground">
          {total} {total === 1 ? 'thing needs' : 'things need'} you
        </h2>
        <p className="text-xs font-semibold text-action">{attentionSummary(counts)}</p>
      </header>

      {TIERS.map((tier) => {
        const rows = byTier[tier]
        // A tier with nothing in it renders nothing at all, so a quiet week is
        // a short card rather than three empty headings.
        if (!rows.length) return null
        const meta = TIER_META[tier]
        return (
          <div key={tier} className="border-t border-border">
            <div className="flex flex-wrap items-baseline gap-x-2 px-4 pb-1 pt-2.5">
              <h3 className={`text-3xs font-bold uppercase tracking-wider ${meta.labelClass}`}>
                {meta.label}
              </h3>
              <span className="text-2xs text-muted-foreground">
                {rows.length}
                {meta.hint ? ` · ${meta.hint}` : ''}
              </span>
            </div>
            {rows.map((item) => (
              <AttentionRow key={item.key} item={item} iconClass={meta.iconClass} />
            ))}
          </div>
        )
      })}
    </section>
  )
}
