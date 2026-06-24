// Canonical content_item status tokens — single source of truth for
// content-piece status colours across the pipeline UI.
//
// label  — human-readable status name
// badge  — Tailwind classes for badge/pill backgrounds (bg + text)
// accent — Tailwind border class for lane containers / outlined cards
//
// Mirrors the shape of stageTokens.js (label/badge) and adds `accent`
// for the kanban lane borders. Keep the palette aligned with the
// existing PipelineKanban lanes so visual output stays identical.

// See also src/lib/contentMeta.js (STATUS_META — badge+icon variant used by ContentHub/Stories surfaces with the "Approved" label and an `archived` row).
export const CONTENT_STATUS_TOKENS = {
  draft:     { label: 'Draft',               badge: 'bg-muted text-muted-foreground',  accent: 'border-border'   },
  in_review: { label: 'In Review',           badge: 'bg-warning/10 text-warning',     accent: 'border-warning/30'  },
  approved:  { label: 'Ready to publish',    badge: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', accent: 'border-scheduled/30' },
  scheduled: { label: 'Scheduled',           badge: 'bg-[hsl(var(--scheduled)/0.12)] text-scheduled', accent: 'border-scheduled/30' },
  published: { label: 'Published',           badge: 'bg-success/10 text-success',      accent: 'border-success/30'  },
  failed:    { label: 'Failed',              badge: 'bg-destructive/10 text-destructive', accent: 'border-destructive/30' },
}

/** @param {string} status @returns {{ label: string, badge: string, accent: string }} */
export function getContentStatusToken(status) {
  return (
    CONTENT_STATUS_TOKENS[status] ?? {
      label: status,
      badge: 'bg-muted text-muted-foreground',
      accent: 'border-border',
    }
  )
}
