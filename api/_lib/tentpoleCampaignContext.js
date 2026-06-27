// Tentpole campaign prompt-context helper.
//
// Replaces the retired singleton (clinic_settings.campaign_* + clinicians.campaign_settings)
// previously loaded by api/_lib/campaignSettings.js.
//
// Two exports:
//   • loadCurrentTentpole(workspaceId) — returns the single highest-weighted
//     currently-active campaign, or null. Used by atom generators that don't
//     have a specific campaign in mind.
//   • getTentpolePromptContext(campaign, workspace) — returns the
//     "CAMPAIGN FOCUS —" prompt block to append to atom system prompts.
//     Empty string for the no-campaign / clinical-style case so callers
//     can concatenate safely.

import { getActiveCampaigns, campaignWeight } from './activeCampaigns.js'
import { applyLocationOverlay } from '../../src/lib/locationOverlay.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

/**
 * Fetch a single workspace_locations row for a campaign's target location.
 * Workspace-scoped so a stale/cross-tenant location id can't bleed in.
 * Returns null on any miss/failure — the campaign focus block then renders
 * brand-wide, exactly as it did before A1.
 */
async function loadCampaignLocation(workspaceId, locationId) {
  if (!workspaceId || !locationId || !SUPABASE_URL || !SUPABASE_KEY) return null
  try {
    const r = await fetch(
      `${SUPABASE_URL}/rest/v1/workspace_locations` +
        `?id=eq.${encodeURIComponent(locationId)}` +
        `&workspace_id=eq.${encodeURIComponent(workspaceId)}` +
        `&status=eq.active` +
        `&select=id,label,city,region,location_keyword,location_hashtag,visit_url` +
        `&limit=1`,
      { signal: AbortSignal.timeout(8_000), headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
    )
    if (!r.ok) {
      console.error('[tentpoleCampaignContext] location fetch failed:', r.status)
      return null
    }
    const rows = await r.json().catch(() => [])
    return Array.isArray(rows) ? (rows[0] ?? null) : null
  } catch (e) {
    console.error('[tentpoleCampaignContext] location fetch error:', e?.message)
    return null
  }
}

function formatEventDate(iso) {
  if (!iso) return null
  const d = new Date(iso)
  if (!Number.isFinite(d.getTime())) return null
  // Tuesday, June 14 · 6:00 PM ET
  const datePart = d.toLocaleDateString(undefined, {
    weekday: 'long', month: 'long', day: 'numeric',
  })
  const timePart = d.toLocaleTimeString(undefined, {
    hour: 'numeric', minute: '2-digit', timeZoneName: 'short',
  })
  return `${datePart} · ${timePart}`
}

/**
 * Filter campaigns to those that apply to the given clinician.
 *
 *   • target_staff_ids empty/missing → workspace-wide (applies to all)
 *   • target_staff_ids includes staffId → applies to this clinician
 *   • non-empty AND missing staffId → does NOT apply (a targeted campaign
 *     can't bind without a target)
 */
export function filterCampaignsForStaff(campaigns, staffId) {
  if (!Array.isArray(campaigns)) return []
  return campaigns.filter((c) => {
    const targets = Array.isArray(c.target_staff_ids) ? c.target_staff_ids : []
    if (targets.length === 0) return true
    return staffId ? targets.includes(staffId) : false
  })
}

/**
 * Load the most-relevant currently-active tentpole campaign for a workspace.
 * Returns null when nothing is active.
 *
 * The "most-relevant" pick is the highest-weighted active campaign per the
 * same weighting used by the slate slot allocator — so an event 3 days out
 * wins over an evergreen, etc.
 *
 * @param {string}      workspaceId
 * @param {string|null} staffId — When present, also requires that the
 *   campaign apply to this clinician (target_staff_ids empty or includes
 *   this id). Lets per-clinician atom prompts (draft.js / regenerate.js) skip
 *   campaigns that target other clinicians.
 */
export async function loadCurrentTentpole(workspaceId, staffId = null) {
  if (!workspaceId) return null
  const all = await getActiveCampaigns(workspaceId)
  const campaigns = filterCampaignsForStaff(all, staffId)
  if (!campaigns.length) return null
  const now = Date.now()
  const ranked = campaigns
    .map((c) => ({ c, w: campaignWeight(c, now) }))
    .sort((a, b) => (b.w - a.w) || String(a.c.id).localeCompare(String(b.c.id)))
  return ranked[0].c
}

/**
 * Build the "CAMPAIGN FOCUS —" prompt block from a tentpole campaign row.
 *
 * @param {object|null} campaign  — campaigns row or null. Null → ''.
 * @param {object}      workspace — used for grounding (display name, location).
 * @returns {Promise<string>} The block, including a leading newline, or '' if no
 *                   override applies (null campaign OR clinical content_style).
 *
 * Async because a campaign with target_location_id (A1 — location aim) fetches
 * the target workspace_locations row and overlays its city/keyword/hashtag/
 * visit_url so ALL channels lean toward that clinic's CTA.
 */
export async function getTentpolePromptContext(campaign, workspace = {}) {
  if (!campaign) return ''
  // Clinical campaigns are the default voice — no override needed. Callers
  // get their default per-platform CTAs (book a visit / link in bio).
  if (campaign.content_style === 'clinical') return ''

  // A1 — campaign location aim. When the campaign targets a location, overlay
  // it onto the workspace so the style builders below interpolate the target
  // city/keyword/hashtag instead of the umbrella, then append an explicit
  // "PROMOTE LOCATION" steer. Falls back to brand-wide when the location is
  // missing/archived.
  let ws = workspace || {}
  let targetLocation = null
  if (campaign.target_location_id) {
    targetLocation = await loadCampaignLocation(ws.id, campaign.target_location_id)
    if (targetLocation) ws = applyLocationOverlay(ws, targetLocation)
  }

  let block = buildCampaignStyleBlock(campaign, ws)
  if (!block) return ''
  if (targetLocation) block += buildLocationFocus({ location: targetLocation, wsName: resolveWsName(ws) })
  return block
}

function resolveWsName(ws = {}) {
  return ws.app_name || ws.display_name || ws.name || 'the clinic'
}

/**
 * Build the style-specific "CAMPAIGN FOCUS —" block from a campaign + a
 * (possibly location-overlaid) workspace. Shared by the all-channel path
 * (getTentpolePromptContext) and the GBP per-listing path
 * (buildTentpoleGbpLocationBlock). Returns '' for clinical / unknown styles.
 */
function buildCampaignStyleBlock(campaign, ws = {}) {
  const wsName    = resolveWsName(ws)
  const location  = ws.location || ws.location_keyword || ''
  const eventDate = formatEventDate(campaign.event_at)
  switch (campaign.content_style) {
    case 'promotional': return buildPromotional({ campaign, wsName, location, eventDate })
    case 'referral':    return buildReferral({ campaign, wsName, location })
    case 'relationship':return buildRelationship({ campaign, wsName, location })
    default:            return ''
  }
}

/**
 * A2 — resolve the workspace_locations row a campaign's location aim points at
 * (or null). Exported so the GBP per-listing generator (api/content-plan/draft.js)
 * can fetch the subject location ONCE before its per-listing loop, then pass it
 * into buildTentpoleGbpLocationBlock for each listing (avoids an N+1 fetch).
 */
export async function resolveCampaignSubjectLocation(campaign, workspace = {}) {
  if (!campaign?.target_location_id) return null
  return loadCampaignLocation(workspace?.id, campaign.target_location_id)
}

/**
 * A2 — GBP cross-promo split. Build the campaign focus block tailored for ONE
 * Google listing, distinguishing the publishing location (where the post goes)
 * from the subject location (the campaign's promoted clinic).
 *
 *   • No subject location  → standard workspace-wide style block (no cross-promo).
 *   • Publishing IS subject → "we're here / come in" primary copy (same steer as
 *     the all-channel PROMOTE LOCATION block).
 *   • Publishing ≠ subject  → cross-promote the new sister clinic while keeping
 *     this listing's own local identity primary; carries the subject's hashtag +
 *     visit_url inline. Bounded by the campaign window (the caller only invokes
 *     this for an active campaign, so out-of-window listings revert to local).
 *
 * Sync — the subject location is resolved once by the caller and passed in.
 *
 * @param {object}      campaign           campaigns row (must be active).
 * @param {object}      workspace          workspace context.
 * @param {object|null} publishingLocation the listing this post publishes to.
 * @param {object|null} subjectLocation    the campaign's promoted location.
 * @returns {string} The focus block, or '' for clinical / unknown styles.
 */
export function buildTentpoleGbpLocationBlock({ campaign, workspace = {}, publishingLocation = null, subjectLocation = null }) {
  if (!campaign || campaign.content_style === 'clinical') return ''

  // No location aim → behave like the workspace-wide style block.
  if (!subjectLocation) return buildCampaignStyleBlock(campaign, workspace) || ''

  const isSubjectListing = publishingLocation
    && String(publishingLocation.id) === String(subjectLocation.id)

  if (isSubjectListing) {
    // This listing IS the promoted clinic → "we're here / come in".
    const ws = applyLocationOverlay(workspace, subjectLocation)
    let block = buildCampaignStyleBlock(campaign, ws)
    if (!block) return ''
    block += buildLocationFocus({ location: subjectLocation, wsName: resolveWsName(ws) })
    return block
  }

  // A different listing → cross-promote the sister clinic, keep local identity.
  let block = buildCampaignStyleBlock(campaign, workspace)
  if (!block) return ''
  block += buildLocationCrossPromo({
    subject: subjectLocation,
    publishing: publishingLocation,
    wsName: resolveWsName(workspace),
  })
  return block
}

/**
 * Cross-promo steer for a NON-subject GBP listing: announce the new sister
 * clinic as community news without telling local patients to switch clinics.
 */
function buildLocationCrossPromo({ subject, publishing, wsName }) {
  const subjCity   = (subject.city || subject.label || '').trim()
  const subjRegion = (subject.region || '').trim()
  const subjPlace  = subjCity && subjRegion ? `${subjCity}, ${subjRegion}` : (subjCity || subject.label || 'a new location')
  const pubCity    = (publishing?.city || publishing?.label || '').trim() || 'this'
  const lines = [
    '',
    `CROSS-PROMOTE SISTER LOCATION — ${(subject.label || subjCity || 'new clinic').toUpperCase()}:`,
    `This post publishes to the ${pubCity} listing, but ${wsName} is now also in ${subjPlace}. Share it as exciting news for the wider community — "our new sister clinic in ${subjCity}" — as a SECONDARY beat. Do NOT tell ${pubCity} patients to switch clinics; this listing's own local identity stays primary.`,
  ]
  if (subject.location_hashtag) {
    lines.push(`Include the hashtag ${subject.location_hashtag} for the ${subjCity} mention where a hashtag fits.`)
  }
  if (subject.visit_url) {
    lines.push(`New location page (use as the link target for the ${subjCity} mention): ${subject.visit_url}`)
  }
  lines.push('Bounded by the campaign window — outside it, this listing returns to purely local content.')
  return lines.join('\n')
}

/**
 * Append an explicit location-promotion steer to the campaign focus block.
 * Drives every channel toward the target clinic's CTA without per-channel
 * branching (A1 — the broad, cheap part; GBP cross-promo split is A2).
 */
function buildLocationFocus({ location, wsName }) {
  const city = (location.city || location.label || '').trim()
  const region = (location.region || '').trim()
  const place = city && region ? `${city}, ${region}` : (city || location.label || '')
  const lines = [
    '',
    `PROMOTE LOCATION — ${(location.label || city || 'target clinic').toUpperCase()}:`,
    `This campaign is steering attention toward ${wsName}'s ${place || 'target'} location. Anchor any "visit us" / neighborhood / location reference to ${place || city} — this is the clinic we want people to come to.`,
  ]
  if (location.location_keyword) {
    lines.push(`Use the local keyword "${location.location_keyword}" where it reads naturally.`)
  }
  if (location.location_hashtag) {
    lines.push(`Include the location hashtag ${location.location_hashtag} where a hashtag fits the platform.`)
  }
  if (location.visit_url) {
    lines.push(`Location page: ${location.visit_url} — use this as the visit/CTA link target when the campaign has no more specific Action URL.`)
  }
  return lines.join('\n')
}

// ─── Style-specific builders ─────────────────────────────────────────────────

function buildPromotional({ campaign, wsName, location, eventDate }) {
  const lines = [
    '',
    `CAMPAIGN FOCUS — ${campaign.name.toUpperCase()}:`,
    `${wsName} is running an active campaign${location ? ` based out of their ${location} clinic` : ''}. CTAs in this content must orient the reader toward the campaign's specific event or offering — not the default "book a visit" CTA.`,
  ]
  if (campaign.theme_notes) lines.push(`Campaign theme: ${campaign.theme_notes}`)
  if (eventDate)            lines.push(`Event date & time: ${eventDate}.`)
  if (campaign.cta_url) {
    lines.push(`Action URL: ${campaign.cta_url}`)
    lines.push('Use exactly this URL as the link target in any CTA — do not invent or alter it.')
  }
  if (campaign.cta_pitch) {
    lines.push(`Workspace-supplied invitation sentence (use this verbatim or lightly adapted for platform tone as the body-copy CTA): "${campaign.cta_pitch}"`)
  }
  if (campaign.cta_label) {
    lines.push(`Preferred CTA button text (for platforms with a literal button — Instagram overlay, GBP): "${campaign.cta_label}".`)
  }
  lines.push(`Tone: lean into the campaign's specific moment without losing ${wsName}'s warm clinical voice.`)
  return lines.join('\n')
}

function buildReferral({ campaign, wsName, location }) {
  const lines = [
    '',
    `CAMPAIGN FOCUS — ${campaign.name.toUpperCase()}:`,
    `${wsName} is currently building relationships with coaches, personal trainers, physical therapists, orthopedic surgeons, and other ${location ? `${location}-area ` : ''}healthcare providers who can refer patients. Frame content with a professional, peer-to-peer voice — clinicians speaking to fellow health and fitness professionals.`,
  ]
  if (campaign.theme_notes) lines.push(`Campaign theme: ${campaign.theme_notes}`)
  if (campaign.cta_url) {
    lines.push(`Referral / contact URL: ${campaign.cta_url}`)
    lines.push('Use exactly this URL as the link target in any CTA — do not invent or alter it.')
  }
  if (campaign.cta_pitch) {
    lines.push(`Workspace-supplied invitation sentence (use verbatim or lightly adapted): "${campaign.cta_pitch}"`)
  }
  if (campaign.cta_label) lines.push(`Preferred CTA button text: "${campaign.cta_label}".`)
  if (!campaign.cta_pitch) {
    lines.push(`Preferred CTA phrasing variants: "Refer a patient to ${wsName}", "Connect with our team", "We'd love to collaborate", "Happy to be a resource for your patients or clients".`)
  }
  lines.push('Tone: authoritative and collegial — professionals talking to professionals.')
  return lines.join('\n')
}

function buildRelationship({ campaign, wsName, location }) {
  const lines = [
    '',
    `CAMPAIGN FOCUS — ${campaign.name.toUpperCase()}:`,
    `${wsName} is in a relationship-warming moment${location ? ` for their ${location} community` : ''}. Do NOT talk about clinical care, assessments, treatments, or sales-y CTAs. Focus on the people, the relationship, the moment. This content celebrates the community, not the clinic's services.`,
  ]
  if (campaign.theme_notes) lines.push(`Campaign theme: ${campaign.theme_notes}`)
  if (campaign.cta_url) {
    lines.push(`Optional action URL (use only if it serves the relationship, not as a hard sell): ${campaign.cta_url}`)
  }
  if (campaign.cta_pitch) {
    lines.push(`Workspace-supplied phrasing (use verbatim or lightly adapted): "${campaign.cta_pitch}"`)
  }
  lines.push('Tone: warm, generous, human. The clinic is saying thank you, not selling.')
  return lines.join('\n')
}
