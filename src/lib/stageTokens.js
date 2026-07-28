// Canonical stage tokens — single source of truth for story stage colours.
//
// badge — Tailwind classes for <Badge> (StoryDetail, StoryCard)
// dot   — Tailwind classes for dot indicators (StoriesThemesView)
// rail  — Tailwind left-border color for row status rails (StoriesTableView).
//         Pair with a width utility, e.g. `border-l-2 ${rail}`. Draft stages
//         use the faint neutral border so they read as inert.
// label — human-readable stage name

export const STAGE_TOKENS = {
  capture:   { label: 'Draft',       badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50', rail: 'border-l-border' },
  drafting:  { label: 'Draft',       badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50', rail: 'border-l-border' },
  review:    { label: 'In Review',  badge: 'bg-warning/10 text-warning',   dot: 'bg-warning',    rail: 'border-l-warning' },
  scheduled: { label: 'Scheduled',  badge: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', dot: 'bg-scheduled', rail: 'border-l-scheduled' },
  published: { label: 'Published',  badge: 'bg-success/10 text-success', dot: 'bg-success', rail: 'border-l-success' },
}

/** @param {string} stage @returns {{ label: string, badge: string, dot: string, rail: string }} */
export function getStageToken(stage) {
  return STAGE_TOKENS[stage] ?? { label: stage, badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/40', rail: 'border-l-border' }
}

// Bank-era display stages (Moments IA, decisions.md 2026-07-27). These label
// what a story IS in the moment-bank model — captured → processed → yielding —
// and are display-only: `story_stage` + STAGE_TOKENS above stay the machine
// the quick-filter pills and per-piece badges key on. Yielding wears the
// spruce (--primary) tint per mockup §03; captured stays the inert neutral
// chip; processed sits between — banked but nothing drawn yet.
export const BANK_STAGE_TOKENS = {
  captured:  { label: 'Captured',  badge: 'bg-muted text-muted-foreground',        dot: 'bg-muted-foreground/50', rail: 'border-l-border' },
  processed: { label: 'Processed', badge: 'bg-muted-foreground/15 text-foreground/80', dot: 'bg-muted-foreground',    rail: 'border-l-muted-foreground/40' },
  yielding:  { label: 'Yielding',  badge: 'bg-primary/10 text-primary',            dot: 'bg-primary',             rail: 'border-l-primary' },
}

/** @param {string} stage @returns {{ label: string, badge: string, dot: string, rail: string }} */
export function getBankStageToken(stage) {
  return BANK_STAGE_TOKENS[stage] ?? BANK_STAGE_TOKENS.captured
}

// Dot colours keyed by content_item.status — single source so AssetsPane
// tab indicators and any future list views stay in sync. Values deliberately
// differ from STAGE_TOKENS.dot for 'draft' (slate = inert) and 'archived'
// (zinc = retired) to communicate item state rather than story pipeline stage.
export const STATUS_DOT = {
  draft:     'bg-muted-foreground/50',
  in_review: 'bg-warning',
  approved:  'bg-scheduled',
  scheduled: 'bg-scheduled',
  published: 'bg-success',
  archived:  'bg-muted-foreground/40',
}

/** @param {string} status @returns {string} Tailwind bg class for the status dot */
export function getStatusDot(status) {
  return STATUS_DOT[status] ?? 'bg-muted-foreground/40'
}
