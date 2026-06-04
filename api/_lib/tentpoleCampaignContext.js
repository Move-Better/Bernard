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
      { headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` } },
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

  const wsName   = ws.app_name || ws.display_name || ws.name || 'the clinic'
  const location = ws.location || ws.location_keyword || ''
  const eventDate = formatEventDate(campaign.event_at)

  let block
  switch (campaign.content_style) {
    case 'promotional':
      block = buildPromotional({ campaign, wsName, location, eventDate })
      break
    case 'referral':
      block = buildReferral({ campaign, wsName, location })
      break
    case 'relationship':
      block = buildRelationship({ campaign, wsName, location })
      break
    default:
      return ''
  }

  if (targetLocation) block += buildLocationFocus({ location: targetLocation, wsName })
  return block
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
