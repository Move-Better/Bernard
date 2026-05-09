// Developer-owned registry of output channels NarrateRx generates content for.
//
// The set is fixed in code (developers add new channels by editing this file
// and shipping a release). Per-workspace participation is tenant-editable:
//
//   - workspaces.enabled_outputs[]   → channels this workspace participates in
//                                      at all (the brand-layer business gate)
//   - interviews.selected_outputs[]  → subset chosen for a single interview
//                                      (the per-run time gate)
//
// Each channel declares two paths content can take to leave NarrateRx:
//
//   - exportShape — used by external workspaces (no first-party integration
//                   credentials configured). Maps to a UI export affordance.
//   - publishMode — used by first-party workspaces (Move Better's three brands)
//                   when the matching capability flag in workspaces.capabilities
//                   is set. null = export-only across all workspaces (no
//                   first-party publish path exists or is planned).
//
// Per the 2026-05-08 export-first scope decision (memory:
// project_export_first_scope.md), external workspaces always render the
// exportShape regardless of channel. First-party direct publishing — Buffer,
// Facebook Graph, GBP via service account, Astro/WordPress webhooks, TDC
// newsletter — is feature-flagged to Move Better's workspaces only.
//
// Phase 0c ships this registry without wiring it into runtime flows. Phase 1
// (settings UI + subdomain routing) reads from it to drive the channel-toggle
// UI and the publish-vs-export branching at the per-output card level.

export const EXPORT_SHAPES = Object.freeze({
  // Markdown blob → blog CMS paste (Jasper / Notion / Ghost / WP block editor /
  // any markdown-aware authoring surface).
  MARKDOWN: 'markdown',

  // Caption text + properly-sized image download. Covers every short-form
  // social channel where the workflow is "compose somewhere else (Buffer /
  // Later / native composer), drop in our copy + assets."
  SOCIAL_COMPOSE: 'social_compose',

  // Ready-to-paste HTML for Mailchimp / Beehiiv / ConvertKit / TrustDrivenCare.
  // Inlined styles, table-based layout, no external CSS.
  HTML_EMAIL: 'html_email',
})

export const PUBLISH_MODES = Object.freeze({
  BUFFER:    'buffer',     // Buffer queue → IG / FB / LinkedIn (Buffer in maintenance — kept for Move Better)
  FACEBOOK:  'facebook',   // Facebook Page direct via Graph API
  GBP_QUEUE: 'gbp_queue',  // Google Business Profile via service account, scheduled by api/cron/publish-due.js
  WEBSITE:   'website',    // Astro+GitHub (animals) or WordPress REST (equine), dispatched in api/publish/website.js
  TDC:       'tdc',        // TrustDrivenCare newsletter — currently a paste-into-template flow, not a true API publish
})

// Channel registry. Order here drives the default UI ordering of the
// enabled_outputs picker in the workspace settings UI.
export const OUTPUT_CHANNELS = Object.freeze({
  blog: {
    id: 'blog',
    label: 'Blog post',
    exportShape: EXPORT_SHAPES.MARKDOWN,
    publishMode: PUBLISH_MODES.WEBSITE,
  },
  email: {
    id: 'email',
    label: 'Newsletter',
    exportShape: EXPORT_SHAPES.HTML_EMAIL,
    publishMode: PUBLISH_MODES.TDC,
  },
  gbp: {
    id: 'gbp',
    label: 'Google Business Profile post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.GBP_QUEUE,
  },
  instagram_post: {
    id: 'instagram_post',
    label: 'Instagram feed post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.BUFFER,
  },
  instagram_reel: {
    id: 'instagram_reel',
    label: 'Instagram reel',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.BUFFER,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.FACEBOOK,
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.BUFFER,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: null, // export-only across all workspaces — no first-party TikTok publish path
  },
  youtube_short: {
    id: 'youtube_short',
    label: 'YouTube Short',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: null, // export-only across all workspaces
  },
  pinterest: {
    id: 'pinterest',
    label: 'Pinterest pin',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: null, // export-only across all workspaces
  },
  google_ads: {
    id: 'google_ads',
    label: 'Google Ads copy',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: null, // copy-only output; runs through Google Ads platform manually
  },
  ig_ads: {
    id: 'ig_ads',
    label: 'Instagram Ads copy',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: null,
  },
  landing_page: {
    id: 'landing_page',
    label: 'Landing page',
    exportShape: EXPORT_SHAPES.MARKDOWN,
    publishMode: null, // landing pages are hand-crafted on the marketing site, not API-published
  },
})

export const OUTPUT_CHANNEL_IDS = Object.freeze(Object.keys(OUTPUT_CHANNELS))

// Capability flag key on workspaces.capabilities that gates the first-party
// publish path for a channel. Returns null for channels with no publish path
// (export-only across all workspaces).
//
// Convention: `<publishMode>Publish` in camelCase. Move Better's three
// workspaces will set these true on the rows where the integration is wired
// up; external workspaces leave them unset/false.
export function publishCapabilityKey(channelId) {
  const channel = OUTPUT_CHANNELS[channelId]
  if (!channel || !channel.publishMode) return null
  const mode = channel.publishMode
  // gbp_queue → gbpQueuePublish
  const camel = mode.replace(/_([a-z])/g, (_, c) => c.toUpperCase())
  return `${camel}Publish`
}

// True if the workspace can directly publish this channel (capability flag set
// AND the channel has a publish path). Falsy otherwise — caller should fall
// back to export.
export function canDirectPublish(workspace, channelId) {
  const key = publishCapabilityKey(channelId)
  if (!key) return false
  return Boolean(workspace?.capabilities?.[key])
}
