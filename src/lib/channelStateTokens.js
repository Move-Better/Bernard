// Single source of truth for the per-channel lifecycle pill/rail tokens and the
// compact platform abbreviations shared by StoriesTableView and PostsTableView,
// so the two dense tables can't drift apart (audit 2026-07-16 found them out of
// sync on 2 of 4 states + two divergent PLATFORM_SHORT maps).
//
// Draft rides the --action act-now token — index.css reserves --action for
// awaiting-review queues ("needs you"), NOT --warning. Failed is a SOLID
// destructive chip per the severity-ramp convention (crit = solid), matching
// each table's own row-level "N failed" badge.
export const CHANNEL_STATE_TOKENS = {
  draft:     { label: 'Draft',     pill: 'bg-action/15 text-action',                   rail: 'border-action' },
  scheduled: { label: 'Scheduled', pill: 'bg-info/15 text-info',                       rail: 'border-info' },
  published: { label: 'Published', pill: 'bg-success/15 text-success',                 rail: 'border-success' },
  failed:    { label: 'Failed',    pill: 'bg-destructive text-destructive-foreground', rail: 'border-destructive' },
}

// Compact channel abbreviations for the dense Channels/Platform columns — the
// union of every live + planned channel id across both tables (the old two-place
// maps were each missing the other's channels, so a new channel had to be
// remembered twice). Falls back to the raw platform id when absent.
export const PLATFORM_SHORT = {
  instagram: 'IG', instagram_story: 'Story', facebook: 'FB', linkedin: 'LI',
  twitter: 'X', threads: 'Threads', bluesky: 'Bsky', mastodon: 'Masto',
  gbp: 'GBP', blog: 'Blog', email: 'Email', tiktok: 'TT', youtube: 'YT',
  pinterest: 'Pin', google_ads: 'G Ads', instagram_ads: 'IG Ads', landing_page: 'LP',
}
