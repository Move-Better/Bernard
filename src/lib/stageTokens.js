// Canonical stage tokens — single source of truth for story stage colours.
//
// badge — Tailwind classes for <Badge> (StoryDetail, StoryCard)
// dot   — Tailwind classes for dot indicators (StoriesThemesView)
// label — human-readable stage name

export const STAGE_TOKENS = {
  capture:   { label: 'Draft',       badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50' },
  drafting:  { label: 'Draft',       badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/50'  },
  review:    { label: 'In Review',  badge: 'bg-warning/10 text-warning',   dot: 'bg-warning'    },
  scheduled: { label: 'Scheduled',  badge: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', dot: 'bg-scheduled' },
  published: { label: 'Published',  badge: 'bg-success/10 text-success', dot: 'bg-success' },
}

/** @param {string} stage @returns {{ label: string, badge: string, dot: string }} */
export function getStageToken(stage) {
  return STAGE_TOKENS[stage] ?? { label: stage, badge: 'bg-muted text-muted-foreground', dot: 'bg-muted-foreground/40' }
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
