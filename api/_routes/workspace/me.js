import { withSentry } from '../../_lib/sentry.js'
export const config = { runtime: 'nodejs' }
// Workspace profile endpoint.
//
// GET  — returns the active workspace row (resolved from Host header).
//        Unauthenticated callers (or JWTs whose org_id doesn't match this
//        workspace's clerk_org_id) get a slim public-branding shape so the
//        sign-in page can render without leaking tenant-editable fields like
//        brand_voice, patient_context, schedule_prefs, etc. (Audit
//        2026-05-25 item 9.) Authenticated, org-bound callers get the full row.
// PATCH — updates tenant-editable fields on the workspace row. Requires Clerk admin role.
//
// 404 when no resolvable workspace (apex, www, preview URL, unknown subdomain).

import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../../_lib/workspaceContext.js'
import { requireRole, requireCapability } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { resolveCapabilities, CAP_SETTINGS_EDIT } from '../../_lib/capabilities.js'
import { getActiveCampaigns } from '../../_lib/activeCampaigns.js'
import { getCadencePrior } from '../../_lib/cadenceDefaults.js'
import { listConfiguredServices } from '../../_lib/getCredential.js'

// Hard allowlist — only these columns may be patched via this endpoint.
// slug, clerk_org_id, capabilities, status are developer-owned.
const PATCHABLE_FIELDS = new Set([
  'display_name', 'tagline', 'sign_in_blurb',
  'website', 'location', 'region',
  'clinic_context', 'audience_short', 'brand_voice', 'booking_url',
  'internal_links_markdown', 'signature_system_name', 'signature_system_url',
  'social',
  'app_name', 'region_short', 'website_hostname', 'link_preview_blurb',
  'audience_description', 'activity_context',
  'location_keyword', 'location_hashtag', 'brand_hashtag',
  'spoken_url',
  'enabled_outputs',
  'logo', 'colors', 'brandbook',
  'tone_modifiers',
  'patient_context',
  'interview_context',
  'topic_suggestions',
  'audience_options',
  'story_type_options',
  'publish_topics',
  'skip_review',
  'buffer_use_queue',
  'publish_provider',
  'schedule_prefs',
  'realtime_voice_daily_cap_min',
  'auto_publish_settings',
  'cadence_policy',
  'engagement_digest_enabled',
  'engagement_digest_recipients',
  'publish_intent',
  'social_length_lean',
])

// Platforms recognized in schedule_prefs. Mirrors PLATFORM_SCHEDULE_PREFS in
// src/lib/scheduleHeuristics.js. Unknown platforms are silently dropped.
const SCHEDULE_PREF_PLATFORMS = new Set([
  'instagram', 'facebook', 'linkedin', 'blog', 'email',
  'youtube', 'tiktok', 'gbp', 'google_ads', 'instagram_ads', 'landing_page',
])

// Shape: { [platform]: { days: number[], hours: number[] } | null }
// Returns the cleaned object on success, or null on shape error.
// Merges over the stored value (same reasoning as sanitizeCadencePolicy, #2253):
// a PATCH mentioning only `instagram` must not wipe the other platforms' prefs.
// An explicit per-platform null still clears that platform; a top-level null
// still clears the whole column (handled at the call site).
function sanitizeSchedulePrefs(value, existing) {
  if (value === null) return null
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const out = isPlainObject(existing) ? { ...existing } : {}
  for (const [platform, entry] of Object.entries(value)) {
    if (!SCHEDULE_PREF_PLATFORMS.has(platform)) continue
    if (entry === null) { out[platform] = null; continue }
    if (typeof entry !== 'object' || Array.isArray(entry)) return null
    const { days, hours } = entry
    if (!Array.isArray(days) || days.length === 0 || days.length > 7) return null
    if (!Array.isArray(hours) || hours.length === 0 || hours.length > 24) return null
    const cleanDays = []
    for (const d of days) {
      if (!Number.isInteger(d) || d < 0 || d > 6) return null
      if (!cleanDays.includes(d)) cleanDays.push(d)
    }
    const cleanHours = []
    for (const h of hours) {
      if (!Number.isInteger(h) || h < 0 || h > 23) return null
      if (!cleanHours.includes(h)) cleanHours.push(h)
    }
    cleanDays.sort((a, b) => a - b)
    cleanHours.sort((a, b) => a - b)
    out[platform] = { days: cleanDays, hours: cleanHours }
  }
  return out
}

// Caps for the curated pre-interview slot lists. Must stay in lockstep with
// MAX_CATALOG_SLOTS / MAX_CUSTOM_SLOTS in src/lib/interviewOptionsCatalog.js
// (server doesn't import the SPA module to avoid coupling the API bundle
// to JSX dependencies).
const MAX_CATALOG_SLOTS = 6
const MAX_CUSTOM_SLOTS  = 2
const MAX_SLOT_LABEL_LEN       = 60
const MAX_SLOT_DESCRIPTION_LEN = 120
const SLOT_KEY_RE = /^[a-z][a-z0-9_]{0,40}$/

const TOPIC_SLUG_RE = /^[a-z0-9]+(?:-[a-z0-9]+)*$/

function sanitizePublishTopics(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  const seen = new Set()
  const out = []
  for (const raw of value) {
    if (typeof raw !== 'string') return null
    const t = raw.trim().toLowerCase()
    if (!t) continue
    if (t.length > 60) return null
    if (!TOPIC_SLUG_RE.test(t)) return null
    if (seen.has(t)) continue
    seen.add(t)
    out.push(t)
  }
  return out
}

// Channels that may appear in auto_publish_settings.
// Only 'gbp' is wired at launch; others are accepted and stored so the UI
// can surface them as "coming soon" without a future migration.
const AUTO_PUBLISH_CHANNELS = new Set([
  'gbp', 'instagram', 'facebook', 'linkedin', 'tiktok', 'youtube', 'blog',
])
// voice_fidelity_score is stored 1–10 (captionFidelity.js mean of per-dimension scores).
// Default gate = 7.0 (let through "mostly faithful"). See autoPublishGate.js.
const DEFAULT_VOICE_FIDELITY_MIN = 7.0
const DEFAULT_SIMILARITY_MIN     = 0.65

// Shape: { [channel]: { enabled: bool, voice_fidelity_min?: number, similarity_min?: number } }
// Returns {} (all-off) on null/empty — an explicit reset. Returns null on bad shape.
// Non-empty patches merge over the stored value (#2253 pattern): mentioning only
// `gbp` must not wipe another channel's settings.
function sanitizeAutoPublishSettings(value, existing) {
  if (value === null || (typeof value === 'object' && !Array.isArray(value) && Object.keys(value).length === 0)) {
    return {}
  }
  if (!isPlainObject(value)) return null
  const out = isPlainObject(existing) ? { ...existing } : {}
  for (const [ch, entry] of Object.entries(value)) {
    if (!AUTO_PUBLISH_CHANNELS.has(ch)) continue
    if (!isPlainObject(entry)) return null
    const enabled = Boolean(entry.enabled)
    const vfMin = entry.voice_fidelity_min != null
      ? parseFloat(entry.voice_fidelity_min) : DEFAULT_VOICE_FIDELITY_MIN
    const simMin = entry.similarity_min != null
      ? parseFloat(entry.similarity_min) : DEFAULT_SIMILARITY_MIN
    if (!isFinite(vfMin) || vfMin < 0 || vfMin > 10) return null
    if (!isFinite(simMin) || simMin < 0 || simMin > 1) return null
    out[ch] = { enabled, voice_fidelity_min: vfMin, similarity_min: simMin }
  }
  return out
}

const TONE_KEYS = ['active', 'clinical', 'warm', 'smart']

// Shape gates for the JSONB paradigm-content columns. We require the
// client to PATCH parsed objects/arrays, not raw strings — Settings UI
// parses its JSON textarea before saving and surfaces parse errors there.
function isPlainObject(v) {
  return v !== null && typeof v === 'object' && !Array.isArray(v)
}

const JSONB_MAX_BYTES = 50_000

function sanitizePatientContext(value) {
  if (value === null || value === undefined) return {}
  if (!isPlainObject(value)) return null
  if (JSON.stringify(value).length > JSONB_MAX_BYTES) return null
  return value
}

function sanitizeInterviewContext(value) {
  if (value === null || value === undefined) return {}
  if (!isPlainObject(value)) return null
  if (JSON.stringify(value).length > JSONB_MAX_BYTES) return null
  return value
}

function sanitizeTopicSuggestions(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null
  return value
}

// Shape gate for slot arrays (audience_options / story_type_options).
// Each slot must be { key, label, emoji, description, is_custom }. Caps:
// up to 6 catalog slots + 2 custom slots. Returns the cleaned array on
// success, null on shape violation.
function sanitizeSlotArray(value) {
  if (value === null || value === undefined) return []
  if (!Array.isArray(value)) return null

  let catalogCount = 0
  let customCount  = 0
  const seenKeys = new Set()
  const out = []

  for (const raw of value) {
    if (!isPlainObject(raw)) return null

    const isCustom = !!raw.is_custom
    if (isCustom) {
      if (++customCount > MAX_CUSTOM_SLOTS) return null
    } else {
      if (++catalogCount > MAX_CATALOG_SLOTS) return null
    }

    const key = typeof raw.key === 'string' ? raw.key.trim() : ''
    if (!key || !SLOT_KEY_RE.test(key)) return null
    if (seenKeys.has(key)) return null
    seenKeys.add(key)

    const label = typeof raw.label === 'string' ? raw.label.trim() : ''
    if (!label || label.length > MAX_SLOT_LABEL_LEN) return null

    const emoji = typeof raw.emoji === 'string' ? raw.emoji.trim().slice(0, 8) : ''
    const description = typeof raw.description === 'string'
      ? raw.description.trim().slice(0, MAX_SLOT_DESCRIPTION_LEN)
      : ''

    out.push({ key, label, emoji, description, is_custom: isCustom })
  }

  return out
}

function sanitizeToneModifiers(value) {
  if (value === null || value === undefined) return {}
  if (typeof value !== 'object' || Array.isArray(value)) return null
  const out = {}
  for (const [k, v] of Object.entries(value)) {
    if (!TONE_KEYS.includes(k)) continue
    if (v === null || v === undefined || v === '') continue
    if (typeof v !== 'string') return null
    out[k] = v
  }
  return out
}

// Valid atom-platform IDs for cadence_policy.channels. Must cover every
// cadence-bearing atom platform in api/_lib/cadenceDefaults.js (the prior), or
// a computed Auto channel gets silently dropped on save.
const CADENCE_PLATFORMS = new Set([
  'instagram', 'linkedin', 'gbp', 'facebook', 'tiktok',
  'twitter', 'threads', 'bluesky', 'instagram_story', 'mastodon',
])
const CADENCE_QUIET_DAYS = new Set(['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat'])

// T3 — posting-schedule slots (see api/_lib/cadenceSlots.js). One channel can
// carry slots of more than one format (Instagram: post + reel), so format
// lives per-slot, not per-channel.
const SLOT_FORMATS = new Set(['post', 'reel', 'story'])
const MAX_SLOTS_PER_CHANNEL = 30

// Shape: [{ weekday, hour, format?, enabled? }]. Returns the cleaned array on
// success, null on shape violation, undefined when the key is absent (caller
// then leaves the channel's slots untouched rather than clearing them).
function sanitizeChannelSlots(value) {
  if (value === undefined) return undefined
  if (!Array.isArray(value) || value.length > MAX_SLOTS_PER_CHANNEL) return null
  const out = []
  for (const raw of value) {
    if (!isPlainObject(raw)) return null
    if (!CADENCE_QUIET_DAYS.has(raw.weekday)) return null
    const hour = Number.isInteger(raw.hour) ? raw.hour : parseInt(raw.hour, 10)
    if (!Number.isInteger(hour) || hour < 0 || hour > 23) return null
    const format = SLOT_FORMATS.has(raw.format) ? raw.format : 'post'
    out.push({ weekday: raw.weekday, hour, format, enabled: raw.enabled !== false })
  }
  return out
}

// cadence_policy.formats — per-format settings (see the `formats` block below).
// 'any' lets the reel worker auto-draft from any speaker; 'clinician' restricts
// it to moments the speaker-voice classifier scored as the clinician talking
// (migration 180). Manual rendering is never restricted by this.
const CADENCE_FORMATS = new Set(['reel'])
const CADENCE_FORMAT_VOICES = new Set(['any', 'clinician'])

// Shape: { channels: { [platform]: { target_per_week, enabled, slots? } }, quiet_days, timezone, formats, ...rest }
//
// `existing` is the workspace's CURRENT stored cadence_policy (pass
// workspace.cadence_policy from the caller). The result is built by merging
// the incoming `value` over `existing`, not by trusting the caller sent a
// complete object — every real caller today (ChannelsSettings.jsx,
// CadenceCard's day-proposal resolver, /week's quiet-day toggle) already
// spreads the full policy client-side before sending, but nothing here
// enforced that. A caller that sends a genuinely partial patch (a future
// Settings panel, a script, a manual API call) used to silently replace the
// WHOLE cadence_policy column with just the few keys it sent — wiping
// channels/slots/version/trust_stage/digests/goals/etc. Confirmed live
// 2026-07-22: a hand-crafted `{ quiet_days: [...] }` PATCH during T3
// verification wiped movebetter's cadence_policy down to just quiet_days.
// Merging against `existing` here makes the server defensive regardless of
// caller discipline, matching what the doc comment already claimed.
function sanitizeCadencePolicy(value, existing) {
  if (!isPlainObject(value)) return null
  const base = isPlainObject(existing) ? existing : {}
  const out = { ...base, ...value }

  if ('channels' in value) {
    if (!isPlainObject(value.channels)) return null
    // Carry forward every platform this patch doesn't mention — same reasoning
    // as the top-level merge above, one level deeper: a caller updating just
    // `instagram` must not wipe `facebook`/`gbp`/etc.
    const baseChannels = isPlainObject(base.channels) ? base.channels : {}
    const cleanChannels = {}
    for (const [platform, entry] of Object.entries(baseChannels)) {
      if (CADENCE_PLATFORMS.has(platform) && isPlainObject(entry)) cleanChannels[platform] = entry
    }
    for (const [platform, entry] of Object.entries(value.channels)) {
      if (!CADENCE_PLATFORMS.has(platform)) continue
      if (!isPlainObject(entry)) return null
      const enabled = Boolean(entry.enabled)
      const tpw = entry.target_per_week != null ? parseInt(entry.target_per_week, 10) : 0
      if (!Number.isInteger(tpw) || tpw < 0 || tpw > 28) return null
      cleanChannels[platform] = { target_per_week: tpw, enabled }
      if ('slots' in entry) {
        const cleanSlots = sanitizeChannelSlots(entry.slots)
        if (cleanSlots === null) return null
        cleanChannels[platform].slots = cleanSlots
      } else if (baseChannels[platform]?.slots) {
        cleanChannels[platform].slots = baseChannels[platform].slots
      }
    }
    out.channels = cleanChannels
  }

  if ('quiet_days' in value) {
    if (!Array.isArray(value.quiet_days)) return null
    for (const d of value.quiet_days) {
      if (!CADENCE_QUIET_DAYS.has(d)) return null
    }
    out.quiet_days = [...new Set(value.quiet_days)]
  }

  if ('timezone' in value) {
    if (typeof value.timezone !== 'string' || value.timezone.length > 60) return null
    out.timezone = value.timezone
  }

  // `formats` — per-FORMAT settings, a namespace deliberately separate from
  // `channels`. It is not an oversight that the Reel target does not live in
  // `channels.instagram_reel`: channels have ADDITIVE semantics (planGaps in
  // producer/needs-you.js sums target_per_week across every enabled channel to
  // get the week's total), and the Reel target is a SUBSET of the Instagram
  // target — 3 of 4 Instagram posts are Reels, not 3 posts on top of 4. Putting
  // it in `channels` would inflate the weekly target to 7 and make /week report
  // a permanent shortfall.
  if ('formats' in value) {
    if (!isPlainObject(value.formats)) return null
    // Same carry-forward as `channels` above — only one format key exists
    // today (`reel`), but the pattern must hold as more are added.
    const baseFormats = isPlainObject(base.formats) ? base.formats : {}
    const cleanFormats = {}
    for (const [name, entry] of Object.entries(baseFormats)) {
      if (CADENCE_FORMATS.has(name) && isPlainObject(entry)) cleanFormats[name] = entry
    }
    for (const [name, entry] of Object.entries(value.formats)) {
      if (!CADENCE_FORMATS.has(name)) continue
      if (!isPlainObject(entry)) return null
      const clean = { ...(isPlainObject(baseFormats[name]) ? baseFormats[name] : {}) }
      if (entry.target_per_week != null) {
        const tpw = parseInt(entry.target_per_week, 10)
        if (!Number.isInteger(tpw) || tpw < 0 || tpw > 28) return null
        clean.target_per_week = tpw
      }
      if (entry.voice != null) {
        if (!CADENCE_FORMAT_VOICES.has(entry.voice)) return null
        clean.voice = entry.voice
      }
      cleanFormats[name] = clean
    }
    out.formats = cleanFormats
  }

  // T4 learning loop, part 3 — day/time proposal (day_time_proposal) is
  // computed + written server-side only, via the direct service-role PATCH in
  // strategistPlan.js's maybeProposeDayChange(). The client (Accept/Dismiss in
  // CadenceCard) may only CLEAR it through this route, never set content.
  if ('day_time_proposal' in value) {
    if (value.day_time_proposal !== null) return null
    out.day_time_proposal = null
  }
  if ('day_time_dismissed' in value) {
    if (!Array.isArray(value.day_time_dismissed)) return null
    for (const d of value.day_time_dismissed) {
      if (!CADENCE_QUIET_DAYS.has(d)) return null
    }
    out.day_time_dismissed = [...new Set(value.day_time_dismissed)]
  }

  return out
}

const PUBLISH_INTENT_WEBSITE  = new Set(['wordpress', 'astro', 'none'])
const PUBLISH_INTENT_SOCIAL   = new Set(['buffer', 'bundle', 'manual'])
const PUBLISH_INTENT_NEWSLETTER = new Set(['beehiiv', 'other', 'skip'])

// Merges over the stored value (#2253 pattern): a PATCH setting only `social`
// must not wipe website/newsletter/analytics.
function sanitizePublishIntent(value, existing) {
  if (!isPlainObject(value)) return null
  const out = isPlainObject(existing) ? { ...existing } : {}
  if ('website' in value) {
    if (!PUBLISH_INTENT_WEBSITE.has(value.website)) return null
    out.website = value.website
  }
  if ('social' in value) {
    if (!PUBLISH_INTENT_SOCIAL.has(value.social)) return null
    out.social = value.social
  }
  if ('newsletter' in value) {
    if (!PUBLISH_INTENT_NEWSLETTER.has(value.newsletter)) return null
    out.newsletter = value.newsletter
  }
  if ('analytics' in value) {
    out.analytics = Boolean(value.analytics)
  }
  return out
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

async function handler(req, res) {
  if (req.method === 'GET') {
    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    // Gate the full row behind a Clerk session bound to this workspace's org.
    // Unauth/wrong-org callers get a slim shape (sign-in page branding only).
    // We don't 401 here because the sign-in page itself is unauth and reads
    // app_name / sign_in_blurb from this endpoint to render the panel.
    const auth = await requireRole(req, null, { orgId: workspace.clerk_org_id })
    res.setHeader('Cache-Control', 'private, no-store')

    if (!auth.ok) {
      // Slim public-branding shape. INCLUDES clerk_org_id even though the
      // caller is unauth/wrong-org — it's derived from the host header, not
      // the user's auth state, so disclosing it doesn't leak anything that
      // a curl of the same subdomain wouldn't reveal. The client needs it
      // to recover from a wrong-org-stuck Clerk session (apiFetch reads it
      // from window.__bernardExpectedClerkOrgId to force a setActive flip
      // — without it, the recovery path silently skips and the user is
      // stranded on a "wrong-org" error screen).
      return res.status(200).json({
        // Discriminator the SPA uses to tell this apart from a sparse full row.
        // If the client sees this true while Clerk reports a signed-in session
        // bound to this workspace's org, it forces a token-refresh refetch —
        // the slim response means the server didn't see a matching JWT.
        slim_branding:    true,
        id:               workspace.id,
        slug:             workspace.slug,
        clerk_org_id:     workspace.clerk_org_id,
        app_name:         workspace.app_name,
        display_name:     workspace.display_name,
        sign_in_blurb:    workspace.sign_in_blurb,
        logo:             workspace.logo,
        colors:           workspace.colors,
      })
    }

    // ---- Six independent enrichment reads, run concurrently ----
    //
    // Each of these needs only workspace.id (the tier read also needs
    // auth.userId); none consumes another's result. They used to run as six
    // sequential awaits, so this handler cost the SUM of six round trips.
    //
    // That matters more here than almost anywhere else: the SPA shell blocks on
    // this endpoint (App.jsx holds AppRoutes until /api/workspace/me resolves,
    // so it doesn't flash the wrong guard), which puts this latency on the
    // critical path of EVERY authed route. Measured on prod 2026-07-22 it ran
    // ~850ms consistently, and /week's own week-summary query — which answers in
    // ~300ms — couldn't even start until ~3.7s into the load. Same waterfall fix
    // #2170 applied to week-summary.js.
    //
    // Each element keeps its OWN try/catch and non-fatal fallback INSIDE the
    // promise: Promise.all rejects on the first throw, so the isolation has to
    // live in the element, not around the group. Every one of these is
    // best-effort by design — the client degrades rather than fails.
    const [
      locations,
      primary_logo_url,
      tierRow,
      active_campaigns,
      connected_publish_services,
      cadence_defaults,
    ] = await Promise.all([
      // Active workspace_locations so the SPA can render the per-post location
      // picker without an extra round trip. Locations are not secret — the same
      // identity (city/region/hashtag) is already interpolated into public-facing
      // copy via prompts. Legacy workspaces with the table absent get [] and
      // degrade to single-location behavior.
      (async () => {
        try {
          const lr = await sb(
            `workspace_locations?workspace_id=eq.${encodeURIComponent(workspace.id)}&status=eq.active&select=*&order=position.asc`
          )
          if (lr.ok) {
            const rows = await lr.json().catch(() => [])
            return Array.isArray(rows) ? rows : []
          }
        } catch (e) {
          console.error('[workspace/me] locations fetch failed:', e?.message)
        }
        return []
      })(),

      // Brand Kit primary_logo resolved to a URL so the SPA header can render it
      // without a second round trip. Falls back to workspace.logo.main when no
      // role is assigned — header still has the static logo to fall back to.
      (async () => {
        try {
          const lr = await sb(
            `brand_kit_roles?workspace_id=eq.${encodeURIComponent(workspace.id)}&role=eq.primary_logo&select=brand_assets(blob_url)&limit=1`
          )
          if (lr.ok) {
            const rows = await lr.json().catch(() => [])
            return rows?.[0]?.brand_assets?.blob_url || null
          }
        } catch (e) {
          console.error('[workspace/me] primary_logo fetch failed:', e?.message)
        }
        return null
      })(),

      // Phase 4: per-workspace permission_tier for the calling user. Drives the
      // producer-restricted UX (nav filtering, default landing redirect). Null
      // when the user has no staff row in this workspace — the client treats
      // null as "no special restriction" so the existing nav shows.
      (async () => {
        try {
          const ctr = await sb(
            `staff?user_id=eq.${encodeURIComponent(auth.userId)}` +
            `&workspace_id=eq.${encodeURIComponent(workspace.id)}` +
            `&select=permission_tier,producer_onboarded_at,capability_overrides&limit=1`
          )
          if (ctr.ok) {
            const rows = await ctr.json().catch(() => [])
            return rows?.[0] || null
          }
        } catch (e) {
          console.error('[workspace/me] tier fetch failed:', e?.message)
        }
        return null
      })(),

      // Phase 4 Tentpole PR B: currently-active campaigns, so the Moment Miner
      // client can do slot allocation against them without a separate fetch.
      // Moment Miner falls back to legacy non-campaign generation when absent.
      (async () => {
        try {
          return await getActiveCampaigns(workspace.id)
        } catch (e) {
          console.error('[workspace/me] active campaigns fetch failed:', e?.message)
          return []
        }
      })(),

      // Connected publish-integration service names (buffer, wordpress, beehiiv,
      // …). Exposed to every org-bound caller — not just admins — so Story Detail
      // can decide Publish-vs-Export client-side without hitting the admin-gated
      // /credentials endpoint. Service NAMES only; never the secrets. [] degrades
      // the UI to Export, which is the safe default.
      (async () => {
        try {
          const rows = await listConfiguredServices(workspace.id)
          return Array.isArray(rows) ? rows.map((r) => r.service).filter(Boolean) : []
        } catch (e) {
          console.error('[workspace/me] connected services fetch failed:', e?.message)
          return []
        }
      })(),

      // Cold-start cadence prior (app_config.cadence_defaults) so the Presence
      // settings UI computes the Auto per-channel cadence from server data
      // instead of a client-side hardcode. The client falls back to its own
      // constant if absent.
      (async () => {
        try {
          return await getCadencePrior(sb)
        } catch (e) {
          console.error('[workspace/me] cadence prior fetch failed:', e?.message)
          return null
        }
      })(),
    ])

    const current_user_tier = tierRow?.permission_tier || null
    const current_user_producer_onboarded_at = tierRow?.producer_onboarded_at || null
    const current_user_capability_overrides = tierRow?.capability_overrides || {}

    // Phase 4 PR 3: resolve the user's effective capability set. Matches the
    // opt-in-per-user model used by requireCapability server-side:
    //   • Clerk org admins (isOrgAdmin === true) ALWAYS get the owner template.
    //   • Users with NO explicit permission_tier set fall back to legacy —
    //     full owner caps when requireRole resolved them to admin (covers the
    //     internal-plan bypass case so Move Better members keep working as
    //     today). Non-admins with no tier get the 'clinician' default template.
    //   • Users with an explicit tier are resolved against the workspace's
    //     role_templates (or code defaults).
    let current_user_capabilities
    if (auth.isOrgAdmin) {
      current_user_capabilities = resolveCapabilities('owner', workspace)
    } else if (!current_user_tier) {
      current_user_capabilities = auth.role === 'admin'
        ? resolveCapabilities('owner', workspace)
        : resolveCapabilities('clinician', workspace)
    } else {
      current_user_capabilities = resolveCapabilities(current_user_tier, workspace, current_user_capability_overrides)
    }

    return res.status(200).json({
      ...workspace,
      locations,
      primary_logo_url,
      connected_publish_services,
      current_user_tier,
      current_user_capabilities,
      current_user_producer_onboarded_at,
      active_campaigns,
      cadence_defaults,
    })
  }

  if (req.method === 'PATCH') {
    const workspace = await workspaceContext(req)
    if (!workspace) return res.status(404).json({ error: 'no-workspace-context' })

    const auth = await requireRole(req, ['admin'], { orgId: workspace.clerk_org_id })
    if (!auth.ok) {
      const status = auth.reason === 'forbidden' ? 403 : 401
      return res.status(status).json({ error: auth.reason })
    }
    if (!(await enforceLimit(req, res, 'generic', workspace.id))) return

    // Phase 4 PR 3: capability gate on settings edits.
    const capAuth = await requireCapability(req, workspace, [CAP_SETTINGS_EDIT])
    if (!capAuth.ok) {
      return res.status(403).json({ error: capAuth.reason, missing: capAuth.missing })
    }

    const body = req.body || {}
    const patch = {}
    for (const [key, value] of Object.entries(body)) {
      if (!PATCHABLE_FIELDS.has(key)) continue
      if (key === 'tone_modifiers') {
        const cleaned = sanitizeToneModifiers(value)
        if (cleaned === null) {
          return res.status(400).json({ error: 'invalid-tone-modifiers' })
        }
        patch.tone_modifiers = cleaned
        continue
      }
      if (key === 'patient_context') {
        const cleaned = sanitizePatientContext(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-patient-context' })
        patch.patient_context = cleaned
        continue
      }
      if (key === 'interview_context') {
        const cleaned = sanitizeInterviewContext(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-interview-context' })
        patch.interview_context = cleaned
        continue
      }
      if (key === 'topic_suggestions') {
        const cleaned = sanitizeTopicSuggestions(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-topic-suggestions' })
        patch.topic_suggestions = cleaned
        continue
      }
      if (key === 'audience_options') {
        const cleaned = sanitizeSlotArray(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-audience-options' })
        patch.audience_options = cleaned
        continue
      }
      if (key === 'story_type_options') {
        const cleaned = sanitizeSlotArray(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-story-type-options' })
        patch.story_type_options = cleaned
        continue
      }
      if (key === 'publish_topics') {
        const cleaned = sanitizePublishTopics(value)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-publish-topics' })
        patch.publish_topics = cleaned
        continue
      }
      if (key === 'realtime_voice_daily_cap_min') {
        // Accept null (unlimited, ops escalation) or an integer in [0, 1440].
        // 1440 = a full day in minutes; higher than that is functionally
        // equivalent to unlimited and almost certainly a typo. 0 is the
        // "temporarily disable Live Interview" knob.
        if (value === null) { patch.realtime_voice_daily_cap_min = null; continue }
        const n = typeof value === 'number' ? value : parseInt(value, 10)
        if (!Number.isInteger(n) || n < 0 || n > 1440) {
          return res.status(400).json({ error: 'invalid-realtime-voice-daily-cap-min' })
        }
        patch.realtime_voice_daily_cap_min = n
        continue
      }
      if (key === 'schedule_prefs') {
        const cleaned = sanitizeSchedulePrefs(value, workspace.schedule_prefs)
        if (cleaned === null && value !== null) {
          return res.status(400).json({ error: 'invalid-schedule-prefs' })
        }
        patch.schedule_prefs = cleaned
        continue
      }
      if (key === 'auto_publish_settings') {
        const cleaned = sanitizeAutoPublishSettings(value, workspace.auto_publish_settings)
        if (cleaned === null) {
          return res.status(400).json({ error: 'invalid-auto-publish-settings' })
        }
        patch.auto_publish_settings = cleaned
        continue
      }
      if (key === 'publish_provider') {
        // Which social publisher routes this workspace's posts. Constrained to
        // the same values as the DB CHECK so a bad value 400s, not 500s.
        if (value !== 'buffer' && value !== 'bundle') {
          return res.status(400).json({ error: 'invalid-publish-provider' })
        }
        patch.publish_provider = value
        continue
      }
      if (key === 'cadence_policy') {
        const cleaned = sanitizeCadencePolicy(value, workspace.cadence_policy)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-cadence-policy' })
        patch.cadence_policy = cleaned
        continue
      }
      if (key === 'engagement_digest_enabled') {
        patch.engagement_digest_enabled = Boolean(value)
        continue
      }
      if (key === 'engagement_digest_recipients') {
        if (!Array.isArray(value)) return res.status(400).json({ error: 'invalid-engagement-digest-recipients' })
        const clean = value.filter((v) => typeof v === 'string' && v.trim())
        patch.engagement_digest_recipients = clean
        continue
      }
      if (key === 'publish_intent') {
        const cleaned = sanitizePublishIntent(value, workspace.publish_intent)
        if (cleaned === null) return res.status(400).json({ error: 'invalid-publish-intent' })
        patch.publish_intent = cleaned
        continue
      }
      if (key === 'social_length_lean') {
        // Content length-lean dial. Constrained to the same values as the DB
        // CHECK so a bad value 400s here, not 500s at the write.
        if (value !== 'punchy' && value !== 'balanced' && value !== 'indepth') {
          return res.status(400).json({ error: 'invalid-social-length-lean' })
        }
        patch.social_length_lean = value
        continue
      }
      patch[key] = value
    }
    if (Object.keys(patch).length === 0) {
      return res.status(400).json({ error: 'no-patchable-fields' })
    }

    let r
    try {
      r = await sb(
        `workspaces?id=eq.${encodeURIComponent(workspace.id)}`,
        {
          method: 'PATCH',
          headers: { Prefer: 'return=representation' },
          body: JSON.stringify(patch),
        },
      )
    } catch (e) {
      console.error('[workspace/me PATCH] network error:', e?.message)
      return res.status(500).json({ error: 'db-error' })
    }

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.error(`[workspace/me PATCH] supabase ${r.status}:`, text)
      return res.status(500).json({ error: 'db-error' })
    }

    const rows = await r.json().catch(() => null)
    const updated = Array.isArray(rows) ? rows[0] : null
    if (!updated) return res.status(500).json({ error: 'db-error' })
    // Drop the in-process workspace cache so the next read on this instance
    // sees the write. Sibling instances still TTL out at 60s; the front-end
    // sees its own write back in the response body so the immediate UI is
    // correct, but freshness on the next GET matters for any other tab.
    invalidateWorkspaceCacheById(workspace.id)
    invalidateWorkspaceCacheBySlug(workspace.slug)
    return res.status(200).json(updated)
  }

  return res.status(405).json({ error: 'method-not-allowed' })
}

export default withSentry(handler)
