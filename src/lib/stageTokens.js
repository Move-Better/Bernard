// Canonical stage tokens — single source of truth for story stage colours.
//
// badge — Tailwind classes for <Badge> (StoryDetail, StoryCard)
// dot   — Tailwind classes for dot indicators (StoriesThemesView)
// label — human-readable stage name

export const STAGE_TOKENS = {
  capture:   { label: 'Draft',       badge: 'bg-slate-100 text-slate-600',  dot: 'bg-slate-400'  },
  drafting:  { label: 'Draft',       badge: 'bg-slate-100 text-slate-600',  dot: 'bg-slate-400'  },
  review:    { label: 'In Review',  badge: 'bg-amber-100 text-amber-700',  dot: 'bg-amber-400'  },
  scheduled: { label: 'Scheduled',  badge: 'bg-purple-100 text-purple-700', dot: 'bg-purple-400' },
  published: { label: 'Published',  badge: 'bg-green-100 text-green-700',  dot: 'bg-green-500'  },
}

/** @param {string} stage @returns {{ label: string, badge: string, dot: string }} */
export function getStageToken(stage) {
  return STAGE_TOKENS[stage] ?? { label: stage, badge: 'bg-slate-100 text-slate-600', dot: 'bg-slate-300' }
}

// Dot colours keyed by content_item.status — single source so AssetsPane
// tab indicators and any future list views stay in sync. Values deliberately
// differ from STAGE_TOKENS.dot for 'draft' (slate = inert) and 'archived'
// (zinc = retired) to communicate item state rather than story pipeline stage.
export const STATUS_DOT = {
  draft:     'bg-slate-400',
  in_review: 'bg-amber-400',
  approved:  'bg-purple-500',
  scheduled: 'bg-purple-500',
  published: 'bg-green-500',
  archived:  'bg-zinc-400',
}

/** @param {string} status @returns {string} Tailwind bg class for the status dot */
export function getStatusDot(status) {
  return STATUS_DOT[status] ?? 'bg-slate-300'
}
