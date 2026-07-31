// Developer-owned registry of output channels Bernard generates content for.
//
// The set is fixed in code (developers add new channels by editing this file
// and shipping a release). Per-workspace participation is tenant-editable:
//
//   - workspaces.enabled_outputs[]   → channels this workspace participates in
//                                      at all (the brand-layer business gate)
//   - interviews.selected_outputs[]  → subset chosen for a single interview
//                                      (the per-run time gate)
//
// Each channel declares two paths content can take to leave Bernard:
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
  // The universal social + local path: IG, FB, LinkedIn, X/Twitter, TikTok,
  // YouTube Shorts, Threads, Bluesky, Mastodon, GBP. Adding a new supported
  // platform = (1) entry here in the registry with this mode, (2) entry in
  // PLATFORM_TO_BUNDLE_TYPE in api/_lib/social/bundlePublisher.js, (3) prompt
  // generator in src/lib/prompts.js. No new credential card, no OAuth flow.
  //
  // The VALUE stays the string 'buffer' — it is persisted data, matched against
  // workspaces.publish_intent.social and workspace_credentials.service, so it
  // can only move in a migration, not a rename. The IDENTIFIER below is just a
  // JS name and carries no such constraint; it was renamed SOCIAL because
  // 'buffer' as a mode name reads like the retired provider it no longer is.
  SOCIAL:    'buffer',
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
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  // NOTE: Instagram is split here (post + reel + story) for the settings
  // picker. Post and reel share the `instagram` atom platform key in
  // ATOM_DEFINITIONS (same 4-angle set). Story is its own atom platform key
  // `instagram_story` with a single story_teaser angle and a Buffer type:story
  // payload. Any code that compares enabled_outputs against atom-namespace keys
  // must normalize via atomPlatformsFromEnabledOutputs() in
  // api/_lib/atomPlan.js — see PR #485.
  instagram_post: {
    id: 'instagram_post',
    label: 'Instagram feed post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  instagram_reel: {
    id: 'instagram_reel',
    label: 'Instagram reel',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  instagram_story: {
    id: 'instagram_story',
    label: 'Instagram Story',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  facebook: {
    id: 'facebook',
    label: 'Facebook post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  linkedin: {
    id: 'linkedin',
    label: 'LinkedIn post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  youtube_short: {
    id: 'youtube_short',
    label: 'YouTube Short',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  youtube: {
    id: 'youtube',
    label: 'YouTube video',   // long-form, landscape (keep-whole lane)
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  twitter: {
    id: 'twitter',
    label: 'X / Twitter post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  threads: {
    id: 'threads',
    label: 'Threads post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  bluesky: {
    id: 'bluesky',
    label: 'Bluesky post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
  },
  mastodon: {
    id: 'mastodon',
    label: 'Mastodon post',
    exportShape: EXPORT_SHAPES.SOCIAL_COMPOSE,
    publishMode: PUBLISH_MODES.SOCIAL,
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
// Capability key per publish mode. Derived from the mode id EXCEPT for the
// social mode, whose id is the persisted string 'buffer' (it is matched against
// publish_intent.social and workspace_credentials.service, so it can only move
// in a migration — see PUBLISH_MODES). Deriving from it produced
// `bufferPublish`, a key NO workspace has ever had: prod holds exactly two
// capability keys, websitePublish (4 workspaces) and socialPublish (1). So the
// social capability has never once been read, and the only thing granting a
// workspace the in-editor Publish affordance was a connected buffer credential
// — which is why deleting those rows looked like it would break publishing on
// the live workspace. Mapping the social mode to socialPublish is what the
// stored data always meant.
const MODE_CAPABILITY_KEYS = Object.freeze({
  [PUBLISH_MODES.SOCIAL]: 'socialPublish',
})

export function publishCapabilityKey(channelId) {
  const channel = OUTPUT_CHANNELS[channelId]
  if (!channel || !channel.publishMode) return null
  const mode = channel.publishMode
  const explicit = MODE_CAPABILITY_KEYS[mode]
  if (explicit) return explicit
  // website → websitePublish, tdc → tdcPublish.
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

// content_items.platform (the atom namespace) → OUTPUT_CHANNELS registry key.
// The registry splits a few channels for the settings picker that the atom
// namespace keeps singular (see the instagram note above). Anything not listed
// matches the registry key 1:1.
const PLATFORM_TO_CHANNEL = Object.freeze({
  instagram:     'instagram_post',
  // 'youtube' now resolves 1:1 to its own registry channel (long-form landscape
  // video). The old youtube→youtube_short alias predated a real 'youtube'
  // channel; youtube_short stays a distinct channel for vertical shorts.
  instagram_ads: 'ig_ads',
})

// Resolve a content_items.platform value to its OUTPUT_CHANNELS key.
export function channelIdForPlatform(platform) {
  if (!platform) return null
  return PLATFORM_TO_CHANNEL[platform] || (OUTPUT_CHANNELS[platform] ? platform : null)
}

// Credential `service` values (workspace_credentials.service) that satisfy each
// publishMode. Connecting any one of these flips the channel from Export to
// Publish — this is the runtime signal the publish endpoints actually gate on
// (e.g. api/publish/social.js requires a publish credential, not a flag).
const PUBLISH_MODE_SERVICES = Object.freeze({
  // 'buffer' is retained deliberately. No NEW buffer credential can be created
  // (the provider was retired 2026-07-30), but five rows still exist in prod and
  // this entry is what makes those workspaces' social channels read as Publish
  // rather than Export. Dropping it is a user-visible downgrade, so it waits on
  // a decision about the rows themselves.
  [PUBLISH_MODES.SOCIAL]:  ['buffer'],
  [PUBLISH_MODES.WEBSITE]: ['wordpress', 'astro_github', 'website'],
  [PUBLISH_MODES.TDC]:     ['tdc', 'beehiiv'],
})

// True if a connected credential enables direct publish for this channel.
// `connectedServices` is the array from GET /api/workspace/credentials
// (each entry { service, ... }), or a Set/array of service id strings.
export function channelHasPublishCredential(channelId, connectedServices) {
  const channel = OUTPUT_CHANNELS[channelId]
  if (!channel || !channel.publishMode) return false
  const accepted = PUBLISH_MODE_SERVICES[channel.publishMode]
  if (!accepted) return false
  const ids = Array.isArray(connectedServices)
    ? connectedServices.map((s) => (typeof s === 'string' ? s : s?.service)).filter(Boolean)
    : connectedServices instanceof Set ? [...connectedServices] : []
  return accepted.some((svc) => ids.includes(svc))
}

// Platform-keyed publish gate — the form the Story Detail action surface needs.
// A channel is publishable when EITHER a publish-integration credential is
// connected (the export-first upgrade path: connect Buffer/WordPress/etc → get
// Publish) OR the first-party capability flag is set (back-compat for Move
// Better's internal workspaces). Default — no credential, no flag — is Export.
export function canDirectPublishPlatform(workspace, platform, connectedServices = []) {
  const channelId = channelIdForPlatform(platform)
  if (!channelId) return false
  if (channelHasPublishCredential(channelId, connectedServices)) return true
  return canDirectPublish(workspace, channelId)
}

// The export affordance shape for a content_items.platform value. Used to pick
// the right export UI (copy markdown vs copy caption + download image vs copy
// HTML email) when direct publish isn't available. Falls back to SOCIAL_COMPOSE
// since every short-form channel exports as caption + asset.
export function exportShapeForPlatform(platform) {
  const channelId = channelIdForPlatform(platform)
  const channel = channelId ? OUTPUT_CHANNELS[channelId] : null
  return channel?.exportShape || EXPORT_SHAPES.SOCIAL_COMPOSE
}

// ── Publish intent (onboarding "How do you publish today?" step) ─────────────
//
// Captured in the onboarding wizard BEFORE the channel picker and stored on
// workspaces.publish_intent. It does NOT gate anything — every channel always
// exports (the export-first scope decision is preserved). Intent only:
//   1. tailors which integration connect-options are surfaced (hide WordPress
//      for an Astro shop, hide Buffer for a paste-it-myself user), and
//   2. annotates the channel picker with one-click-ready badges.
// The single exception that hides a channel is an explicit "no newsletter".
//
// This module is the ONE shared source of truth, imported by the onboarding
// wizard (src/pages/Onboarding.jsx), the integrations settings page
// (src/pages/Integrations.jsx), and the claim handler (api/onboarding/claim.js).
export const PUBLISH_INTENT_OPTIONS = Object.freeze({
  website:    ['wordpress', 'astro', 'none'],
  // 'bundle' = bundle.social (Bernard connects + posts directly); 'manual' =
  // copy & paste. Buffer was retired 2026-07-30, so every claimed workspace
  // gets publish_provider='bundle' regardless of this answer — it now only
  // tailors which cards the UI shows.
  social:     ['bundle', 'manual'],
  newsletter: ['beehiiv', 'other', 'skip'],
})

// Defaults match the recommended path: no website yet, social one-click on
// (bundle.social is recommended for new tenants — better analytics, no token
// paste; existing Buffer tenants pick Buffer), newsletter via export. Used to
// pre-fill the wizard and as the fallback when a stored value is malformed.
export const DEFAULT_PUBLISH_INTENT = Object.freeze({
  website: 'none',
  social: 'bundle',
  newsletter: 'other',
})

// Coerce an arbitrary value into a valid publish_intent. Unknown keys/values
// are dropped to the default for that key. Safe to run on request bodies.
export function sanitizePublishIntent(value) {
  const out = { ...DEFAULT_PUBLISH_INTENT }
  if (!value || typeof value !== 'object' || Array.isArray(value)) return out
  for (const key of Object.keys(PUBLISH_INTENT_OPTIONS)) {
    const v = value[key]
    if (typeof v === 'string' && PUBLISH_INTENT_OPTIONS[key].includes(v)) out[key] = v
  }
  if (typeof value.analytics === 'boolean') out.analytics = value.analytics
  return out
}

// True once the workspace has actually answered the publish-intent step. A bare
// {} (every pre-existing workspace) is treated as "not captured" so the
// integrations UI falls back to showing everything (back-compat).
export function hasPublishIntent(intent) {
  return Boolean(
    intent && typeof intent === 'object' && !Array.isArray(intent) &&
    (intent.website || intent.social || intent.newsletter)
  )
}

// Which integration `service` ids each intent answer makes relevant — drives
// the "hide integrations only" filter in onboarding + /settings/integrations.
// No intent captured → returns true for everything (back-compat). Callers must
// still OR this with "already connected" so a live credential is never hidden.
export function isIntegrationRelevantForIntent(serviceId, intent) {
  if (!hasPublishIntent(intent)) return true
  switch (serviceId) {
    case 'wordpress':    return intent.website === 'wordpress'
    case 'astro_github': return intent.website === 'astro'
    case 'website':      return intent.website === 'wordpress' || intent.website === 'astro'
    case 'beehiiv':      return intent.newsletter === 'beehiiv'
    case 'ga4':          return true   // analytics is always offerable
    default:             return true   // unknown services are never hidden by intent
  }
}

// True when, given the stated intent, connecting the matching integration would
// upgrade this channel to one-click publishing — drives the picker badge.
export function channelOneClickReadyForIntent(channelId, intent) {
  const channel = OUTPUT_CHANNELS[channelId]
  if (!channel || !channel.publishMode) return false
  switch (channel.publishMode) {
    // The mode id is still the persisted 'buffer' string, but the integration
    // that upgrades a social channel to one-click is bundle.social — Buffer was
    // retired 2026-07-30 and is no longer a selectable intent.
    case PUBLISH_MODES.SOCIAL:  return intent?.social === 'bundle'
    case PUBLISH_MODES.WEBSITE: return intent?.website === 'wordpress' || intent?.website === 'astro'
    case PUBLISH_MODES.TDC:     return intent?.newsletter === 'beehiiv'
    default:                    return false
  }
}

// The ONLY channel an intent answer may hide: the newsletter tile, and only
// when the user explicitly says they run no newsletter. Everything else always
// stays visible (export-first).
export function channelHiddenForIntent(channelId, intent) {
  return channelId === 'email' && intent?.newsletter === 'skip'
}
