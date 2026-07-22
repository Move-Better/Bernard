// F2.1 — the Strategist: composes a practice-WEEK content plan from the week's
// interviews, replacing the per-interview hardcoded grid (atomPlan.js
// buildPlanRows). See .claude/f1-f2-cadence-spec.md (F2.1).
//
// Division of labour (deliberate — keeps the LLM job narrow + the rest testable):
//   • LLM  → judgment only: from the week's interviews, pick the strongest
//            pieces per channel, choose an angle FROM THE PALETTE, write a
//            concrete brief, and dedupe semantically against recent topics.
//   • Code → everything deterministic: enforce per-channel cadence (cap →
//            surplus held), top up under-filled channels from the backlog,
//            assign best-time slots around quiet days, stamp plan_week /
//            planned_by. Cheap, predictable, and unit-testable without a model.
//
// The model call is dependency-injected (`generate`) so a harness can run the
// whole pipeline against real interview data with no gateway key.

import { z } from 'zod'
import { ATOM_DEFINITIONS, defaultFormatForPlatform } from './atomPlan.js'

// One planned piece as the Strategist must return it. `brief` is REQUIRED and
// non-empty — the whole point of the schema over a hand-parsed array is that the
// model can no longer silently drop the brief (which left ~87% of atoms with a
// null brief and every card in a channel looking identical). Kept short so the
// backlog/calendar rows stay a scannable one-liner.
// `brief` is a REQUIRED key (not .optional()) — that presence is what forces the
// model to emit one per piece, which is the whole fix. Length is deliberately
// NOT a schema constraint: a hard .max() makes generateObject reject the ENTIRE
// response when a single brief runs long, silently zeroing the plan. We keep it
// short via the prompt + describe() and truncate on store instead.
const BRIEF_MAX = 90
const candidateSchema = z.object({
  interview_id: z.string().describe('The exact interview id this piece draws from, copied verbatim from the input.'),
  platform: z.string().describe('The channel to publish on (one of the provided channels).'),
  angle: z.string().describe('The angle key, chosen FROM THE PROVIDED PALETTE for that channel.'),
  brief: z.string().describe(
    "A concrete one-line brief (aim for under 90 characters): the specific subject + the clinician's own framing, NOT a generic angle name. E.g. \"Why sciatica isn't a back problem\", not \"Clinical Insight\".",
  ),
})
const planSchema = z.object({ pieces: z.array(candidateSchema) })

// Atom-level (social) channels the Strategist fills to cadence. blog / email /
// landing_page / youtube / ads are single-output or digest-assembled and are
// governed by the cadence digest layer, NOT the per-piece atom plan.
export const RECOMMENDED_CADENCE = {
  instagram: { target_per_week: 4, enabled: true },
  linkedin:  { target_per_week: 3, enabled: true },
  gbp:       { target_per_week: 3, enabled: true },
  // facebook / tiktok / twitter / threads / bluesky default off until enabled.
}

// Best-time defaults per channel (LOCAL hour, 24h) — a placeholder schedule the
// producer/scheduler slice (build step 5) will replace with engagement-derived
// peaks. Used only to stamp scheduled_at so the week renders on the calendar.
// These are LOCAL hours in the workspace timezone, converted to UTC by assignSlots.
const BEST_HOUR = { instagram: 12, instagram_story: 8, linkedin: 7, gbp: 8, facebook: 12, tiktok: 18, twitter: 9, threads: 12, bluesky: 10, mastodon: 9 }
const WEEKDAY = ['sun', 'mon', 'tue', 'wed', 'thu', 'fri', 'sat']

// Convert a local hour (in tzName) to a UTC Date on weekMonday.
// Uses a single-pass Intl probe: start with the naive UTC candidate, check
// what local hour that produces, then nudge by the delta. ±1h DST boundary
// error is acceptable for scheduling purposes.
function dateAtLocalHour(weekMonday, localHour, tzName) {
  try {
    // Candidate: treat localHour as UTC (off by the tz offset)
    const [yr, mo, dy] = weekMonday.split('-').map(Number)
    const candidate = new Date(Date.UTC(yr, mo - 1, dy, localHour, 0, 0, 0))
    const gotLocalHour = parseInt(
      new Intl.DateTimeFormat('en-US', { timeZone: tzName, hour: 'numeric', hour12: false }).format(candidate),
      10,
    )
    // Nudge: gotLocalHour should equal localHour. Difference = tz offset error.
    const delta = localHour - gotLocalHour
    const result = new Date(candidate)
    result.setUTCHours(result.getUTCHours() + delta)
    return result
  } catch {
    // Fallback: treat localHour as UTC
    const [yr, mo, dy] = weekMonday.split('-').map(Number)
    return new Date(Date.UTC(yr, mo - 1, dy, localHour, 0, 0, 0))
  }
}

// The angle palette the Strategist chooses from (the curated-palette decision).
// Derived from ATOM_DEFINITIONS so it stays in lockstep with the existing
// per-platform angle library.
export function anglePalette() {
  const out = {}
  for (const [platform, atoms] of Object.entries(ATOM_DEFINITIONS)) {
    out[platform] = atoms.map((a) => ({ angle: a.angle, label: a.label, description: a.description }))
  }
  return out
}

// ── deterministic helpers (pure) ────────────────────────────────────────────

// Monday (ISO) of the week containing `date`, as 'YYYY-MM-DD'.
//
// `tz` (IANA) makes the week boundary the workspace's LOCAL midnight: derive the
// local calendar date at that instant first, THEN take its ISO-Monday. This
// matters when `date` is a NOW instant near the UTC date line — e.g. Sunday
// ~5pm–midnight Pacific is already Monday in UTC, so a UTC-only boundary would
// report next week and hide the still-running week's earlier posts. Omit `tz` to
// treat `date` as a floating UTC calendar date — the correct, unshifted behavior
// for canonicalizing/validating a bare 'YYYY-MM-DD' Monday, where mondayOf(monday)
// must return it unchanged (do NOT pass tz on the validation path).
export function mondayOf(date, tz) {
  const instant = new Date(date)
  let y, m, d
  if (tz) {
    const parts = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, year: 'numeric', month: '2-digit', day: '2-digit',
    }).formatToParts(instant)
    const part = (t) => Number(parts.find((p) => p.type === t).value)
    y = part('year'); m = part('month'); d = part('day')
  } else {
    y = instant.getUTCFullYear(); m = instant.getUTCMonth() + 1; d = instant.getUTCDate()
  }
  // Anchor at UTC noon of the (local) calendar date so the weekday lookup never
  // straddles a date boundary, then step back to Monday. Pure UTC math from here.
  const anchor = new Date(Date.UTC(y, m - 1, d, 12, 0, 0, 0))
  const dow = (anchor.getUTCDay() + 6) % 7 // 0 = Monday
  anchor.setUTCDate(anchor.getUTCDate() - dow)
  return anchor.toISOString().slice(0, 10)
}

// Spread N this-week pieces of a channel across the non-quiet weekdays, stamping
// scheduled_at at the channel's best LOCAL hour converted to UTC. Pure.
//
// Each platform has a single fixed best-hour, so two pieces landing on the same
// weekday must get DIFFERENT hours or they collapse to an identical scheduled_at
// (same platform + same UTC instant) — which the auto-publisher then either
// double-schedules or silently drops. So:
//   • target ≤ open days → spread evenly across the open weekdays (e.g. Tue & Fri,
//     not Mon & Tue), all at the base hour. Distinct days ⇒ distinct timestamps.
//   • target > open days → wrap across the open days with `i % openOffsets.length`
//     (multiple-per-day is intentional), and bump the hour by the wrap count so
//     same-day pieces get distinct hours and never share a (day, hour) slot.
export function assignSlots(atoms, weekMonday, quietDays, timezone = 'UTC') {
  const quiet = new Set((quietDays || []).map((q) => q.toLowerCase()))
  // Candidate weekday offsets (Mon..Sun = 0..6) that aren't quiet.
  const openOffsets = [0, 1, 2, 3, 4, 5, 6].filter((off) => !quiet.has(WEEKDAY[(off + 1) % 7]))
  const byChannel = {}
  for (const a of atoms) (byChannel[a.platform] ||= []).push(a)
  for (const [platform, list] of Object.entries(byChannel)) {
    const baseHour = BEST_HOUR[platform] ?? 11
    list.forEach((a, i) => {
      let off, hourBump
      if (!openOffsets.length) {
        off = 0
        hourBump = 0
      } else if (list.length <= openOffsets.length) {
        // Fewer pieces than open days: step evenly across them. Indices are
        // distinct for i in [0, list.length), so no two share a day.
        off = openOffsets[Math.round((i * (openOffsets.length - 1)) / Math.max(1, list.length - 1))]
        hourBump = 0
      } else {
        // More pieces than open days: wrap, and bump the hour on each full wrap so
        // two pieces on the same weekday land at different hours.
        off = openOffsets[i % openOffsets.length]
        hourBump = Math.floor(i / openOffsets.length) * 2
      }
      // Clamp into a sane posting window. ponytail: re-collision is only possible
      // at unrealistic per-platform volumes (>~7 pieces/day past the clamp); the
      // weekly cadence target keeps `hourBump` ≤ ~4 in practice.
      const localHour = Math.min(baseHour + hourBump, 22)
      // Compute the calendar date for this offset from weekMonday.
      const [yr, mo, dy] = weekMonday.split('-').map(Number)
      const dayDate = new Date(Date.UTC(yr, mo - 1, dy + off))
      const dayStr = dayDate.toISOString().slice(0, 10)
      const d = dateAtLocalHour(dayStr, localHour, timezone)
      a.scheduled_at = d.toISOString()
    })
  }
  return atoms
}

// Topic-balance (P2): keep any one body region from flooding a channel's feed.
// The cap is evaluated against a ROLLING WINDOW per channel — the region mix of
// what's recently gone out (`recentRegionCounts`, seeded from content_items over
// the last ~21d) PLUS what we're adding this week. A candidate whose region
// would exceed the cap is DEFERRED (banked as backlog) and a different-region
// piece is slotted instead, so a burst of same-region interviews drips out over
// several weeks rather than flooding two.
export const REGION_CAP = 0.30        // no region past 30% of the rolling window
const REGION_WINDOW_MIN = 4           // don't police until the window has ≥4 pieces
const REGION_FLOOR = 2                // always allow at least this many per region

// Would adding one more piece of `region` keep the channel within the cap?
// `general` / unclassified (null) are exempt — they're a catch-all, not a theme.
function regionWithinCap(regionCount, total, region) {
  if (!region || region === 'general') return true
  const projTotal = total + 1
  if (projTotal < REGION_WINDOW_MIN) return true
  const projRegion = (regionCount[region] || 0) + 1
  const allowed = Math.max(REGION_FLOOR, Math.ceil(REGION_CAP * projTotal))
  return projRegion <= allowed
}

/**
 * Allocate candidates + backlog to the week's cadence. Pure (no LLM, no DB).
 *
 * Two lanes per channel (P2 evergreen cap + P3 promo lane):
 *   • PROMO lane — campaign-attributed pieces (`.isPromo`) get up to
 *     round(target × promoShare) slots (min 1 when a campaign is live) and
 *     BYPASS the region cap: a live seminar is allowed to lean into its theme.
 *   • EVERGREEN lane — everything else fills the remaining slots under the
 *     rolling-window region cap (no region past 30% of the window).
 * Promo is placed first so its reserved slots aren't eaten by evergreen; if
 * there's no promo to place, evergreen uses those slots (no wasted airtime).
 * Anything not placed (cadence surplus, region-deferred, or promo-over-budget)
 * is HELD/deferred and interleaved into a later week. Gap under target is topped
 * up from the backlog (FIFO by held_at), promo-first then region-capped.
 *
 * `recentRegionCounts` = { [platform]: { [region]: count } } rolling window.
 * `promoShare` ∈ [0, 0.4] — 0 disables the promo lane (pre-P3 behavior).
 *
 * @returns {{ thisWeek: object[], held: object[], promoted: object[] }}
 */
export function allocateToCadence(candidates, cadence, backlog = [], recentRegionCounts = {}, promoShare = 0) {
  const thisWeek = []
  const held = []
  const promoted = []
  const backlogByCh = {}
  for (const b of backlog) (backlogByCh[b.platform] ||= []).push(b)
  for (const list of Object.values(backlogByCh)) {
    list.sort((a, b) => new Date(a.held_at || 0) - new Date(b.held_at || 0)) // FIFO
  }
  const freshByCh = {}
  for (const c of candidates) (freshByCh[c.platform] ||= []).push(c)

  for (const [platform, cfg] of Object.entries(cadence)) {
    if (!cfg?.enabled) continue
    const target = cfg.target_per_week || 0
    // Reserved promo slots — at least 1 when a campaign is live so a seminar can
    // always surge, capped at ~promoShare of the channel's target.
    const promoCap = promoShare > 0 ? Math.max(1, Math.round(target * promoShare)) : 0
    const fresh = freshByCh[platform] || []
    // Seed the running per-region tally for this channel from the rolling window.
    const regionCount = { ...(recentRegionCounts[platform] || {}) }
    let total = Object.values(regionCount).reduce((s, n) => s + n, 0)
    const bumpRegion = (r) => { if (r) { regionCount[r] = (regionCount[r] || 0) + 1; total++ } }
    // A piece only rides the promo lane when there IS a promo lane (promoCap>0);
    // with no live campaign, campaign-flagged pieces are just evergreen.
    const isPromoPiece = (x) => x.isPromo && promoCap > 0

    let added = 0
    let promoAdded = 0
    // 1. Promo lane first (region-cap-exempt, bounded by promoCap).
    for (const c of fresh.filter(isPromoPiece)) {
      if (added >= target || promoAdded >= promoCap) { held.push(c); continue }
      thisWeek.push(c); added++; promoAdded++; bumpRegion(c.region)
    }
    // 2. Evergreen fills the remaining slots under the region cap.
    for (const c of fresh.filter((x) => !isPromoPiece(x))) {
      if (added >= target) { held.push(c); continue }          // cadence surplus
      if (regionWithinCap(regionCount, total, c.region)) {
        thisWeek.push(c); added++; bumpRegion(c.region)
      } else {
        held.push(c)                                           // over-budget → defer
      }
    }
    // 3. Top up the remaining gap from the backlog (FIFO): promo-first up to the
    //    remaining promo cap, then evergreen under the region cap. A backlog atom
    //    that can't be placed stays untouched (held) and is tried next week.
    let gap = target - added
    const bl = backlogByCh[platform] || []
    for (const b of bl.filter(isPromoPiece)) {
      if (gap <= 0 || promoAdded >= promoCap) break
      promoted.push(b); gap--; promoAdded++; bumpRegion(b.region)
    }
    for (const b of bl.filter((x) => !isPromoPiece(x))) {
      if (gap <= 0) break
      if (regionWithinCap(regionCount, total, b.region)) {
        promoted.push(b); gap--; bumpRegion(b.region)
      }
      // else: skipped this pass, remains a held atom in the DB (untouched).
    }
  }
  // Candidates for channels not in the cadence (or disabled) are banked, never dropped.
  for (const [platform, list] of Object.entries(freshByCh)) {
    if (!cadence[platform]?.enabled) held.push(...list)
  }
  return { thisWeek, held, promoted }
}

// Trim a model-written brief to a single clean line within BRIEF_MAX chars.
// Returns null for an empty/whitespace brief so the UI's topic fallback kicks in
// rather than showing a blank row.
function normalizeBrief(brief) {
  const t = String(brief || '').replace(/\s+/g, ' ').trim()
  if (!t) return null
  return t.length > BRIEF_MAX ? `${t.slice(0, BRIEF_MAX - 1).trimEnd()}…` : t
}

// Shape a raw candidate ({interview_id, platform, angle, brief}) into a full
// content_plan_atoms row, looking the angle label/description up in the palette.
function toAtomRow(c, { workspaceId, planWeek, palette }) {
  const pal = (palette[c.platform] || []).find((p) => p.angle === c.angle) || {}
  return {
    interview_id: c.interview_id,
    workspace_id: workspaceId,
    platform: c.platform,
    slot: c.slot || 1,
    angle: c.angle,
    angle_label: pal.label || c.angle,
    angle_description: pal.description || null,
    brief: normalizeBrief(c.brief),
    // Stamped explicitly rather than left NULL so a Strategist-planned slot is
    // self-describing. The Strategist never plans REEL — see the comment on
    // PLATFORM_DEFAULT_FORMAT: reels are only ever created against a clip that
    // has actually rendered, by the reel worker.
    format: defaultFormatForPlatform(c.platform),
    status: 'pending',
    planned_by: 'strategist',
    plan_week: planWeek,
    scheduled_at: null,
    held_at: null,
  }
}

// ── the LLM compose step (dependency-injected) ──────────────────────────────

// Collapse the per-channel rolling-window region counts into a workspace-wide
// "region mix" the LLM can use to bias toward under-represented body regions.
// Returns [] when there's no window yet (new workspace).
function summarizeRegionMix(recentRegionCounts) {
  const agg = {}
  for (const perRegion of Object.values(recentRegionCounts || {})) {
    for (const [region, n] of Object.entries(perRegion || {})) agg[region] = (agg[region] || 0) + n
  }
  const total = Object.values(agg).reduce((s, n) => s + n, 0)
  if (!total) return []
  return Object.entries(agg)
    .sort((a, b) => b[1] - a[1])
    .map(([region, n]) => ({ region, pct: Math.round((n / total) * 100) }))
}

export function buildStrategistPrompt({ interviews, channels, recentTopics, recentRegionCounts = {}, palette }) {
  const paletteText = channels
    .map((ch) => `${ch}: ${(palette[ch] || []).map((p) => `${p.angle} (${p.label})`).join(', ')}`)
    .join('\n')
  const interviewText = interviews
    .map((i) => `- [${i.id}] ${i.staff_name || 'A clinician'} on "${i.topic}": ${(i.summary_text || '').slice(0, 600)}`)
    .join('\n')
  const regionMix = summarizeRegionMix(recentRegionCounts)
  const system =
    `You are the content strategist for a clinical practice. From this week's clinician ` +
    `interviews, compose the strongest set of social pieces to publish. For each piece choose ` +
    `the channel and an angle FROM THE PROVIDED PALETTE for that channel. EVERY piece must have ` +
    `a concrete one-line brief: the specific subject + the clinician's own framing, never a ` +
    `generic angle name — a reader should know exactly what the post is about from the brief ` +
    `alone, and two pieces from the same interview must have distinct briefs. ` +
    `NEVER begin a brief with the channel or angle name (e.g. do not write "Instagram hook:" ` +
    `or "LinkedIn clinical perspective:") — the reader already sees both; open with the subject. ` +
    `Prefer variety across clinicians and topics. Do NOT repeat any subject in RECENT TOPICS. ` +
    `Favor body regions that are UNDER-represented in the RECENT REGION MIX — don't pile more ` +
    `pieces onto a region that's already heavy in the feed. ` +
    `Aim for roughly the per-channel weekly targets, but quality over quantity.`
  const user =
    `THIS WEEK'S INTERVIEWS:\n${interviewText}\n\n` +
    `CHANNELS + ANGLE PALETTE:\n${paletteText}\n\n` +
    `RECENT TOPICS (already posted — avoid repeating):\n${recentTopics.length ? recentTopics.map((t) => `- ${t}`).join('\n') : '- (none)'}\n\n` +
    `RECENT REGION MIX (already in the feed — favor the under-represented):\n${regionMix.length ? regionMix.map((r) => `- ${r.region}: ${r.pct}%`).join('\n') : '- (none yet)'}`
  return { system, user }
}

// Real model call (lazy-imports the AI SDK so a harness importing this module
// doesn't need a gateway key). Returns validated candidate objects — the schema
// forces a non-empty brief on every piece, so the model can't drop it.
async function defaultGenerate({ system, user }) {
  const { generateObject } = await import('ai')
  try {
    const { object } = await generateObject({
      model: 'anthropic/claude-sonnet-4-6',
      schema: planSchema,
      instructions: system,
      messages: [{ role: 'user', content: user }],
      maxOutputTokens: 2000,
    })
    return Array.isArray(object?.pieces) ? object.pieces : []
  } catch (e) {
    console.error('[strategist] defaultGenerate: model call/validation failed:', e?.message)
    return []
  }
}

/**
 * Compose a workspace's weekly plan. Returns the atom rows to write (this-week
 * + held) and the backlog atoms to promote — but writes NOTHING itself; the
 * caller (cron) persists. `generate` is injectable for testing.
 *
 * @returns {Promise<{ weekMonday, thisWeek, held, promoted, stats }>}
 */
export async function composeWeeklyPlan({
  workspaceId,
  interviews,
  cadence = RECOMMENDED_CADENCE,
  recentTopics = [],
  recentRegionCounts = {},
  promoShare = 0,
  promoCampaignIds = [],
  backlog = [],
  quietDays = ['sat', 'sun'],
  timezone = 'America/Los_Angeles',
  weekMonday,
  generate = defaultGenerate,
}) {
  const palette = anglePalette()
  const channels = Object.entries(cadence).filter(([, c]) => c?.enabled).map(([ch]) => ch)
  const planWeek = weekMonday || mondayOf(new Date().toISOString())

  let candidates = []
  if (interviews.length && channels.length) {
    const prompt = buildStrategistPrompt({ interviews, channels, recentTopics, recentRegionCounts, palette })
    // The LLM echoes interview_id back and can corrupt it (e.g. inject a space),
    // which 400s the uuid insert. Normalize whitespace, then require an EXACT
    // match to a real input interview — this both repairs that corruption and
    // prevents the model from inventing or hallucinating an id.
    const interviewIds = new Set(interviews.map((i) => i.id))
    candidates = (await generate(prompt))
      .map((c) => (c && typeof c.interview_id === 'string'
        ? { ...c, interview_id: c.interview_id.replace(/\s+/g, '') }
        : c))
      // Keep only well-formed candidates: enabled channel, palette angle, real id.
      .filter((c) => c && channels.includes(c.platform) && interviewIds.has(c.interview_id)
        && (palette[c.platform] || []).some((p) => p.angle === c.angle))
  }

  // Attach each candidate's body region + promo flag (from its interview) so the
  // allocator can region-cap evergreen pieces and route campaign-attributed ones
  // through the promo lane. Backlog atoms already carry `.region`/`.campaign_id`
  // (attached in getWeekInputs via the interview join).
  const promoSet = new Set(promoCampaignIds)
  const regionByIv = new Map(interviews.map((i) => [i.id, i.region || null]))
  const campaignByIv = new Map(interviews.map((i) => [i.id, i.campaign_id || null]))
  candidates = candidates.map((c) => ({
    ...c,
    region: regionByIv.get(c.interview_id) || null,
    isPromo: promoSet.has(campaignByIv.get(c.interview_id)),
  }))
  const backlogWithPromo = backlog.map((b) => ({ ...b, isPromo: promoSet.has(b.campaign_id) }))

  const { thisWeek, held, promoted } = allocateToCadence(candidates, cadence, backlogWithPromo, recentRegionCounts, promoShare)

  // Materialize this-week + held candidates into atom rows; assign slots to the
  // this-week set; mark held with held_at=now.
  const now = new Date().toISOString()
  const thisWeekRows = assignSlots(thisWeek.map((c) => toAtomRow(c, { workspaceId, planWeek, palette })), planWeek, quietDays, timezone)
  const heldRows = held.map((c) => ({ ...toAtomRow(c, { workspaceId, planWeek, palette }), held_at: now }))
  // Promoted backlog atoms already exist — they just flip held→this-week.
  const promotedUpdates = assignSlots(
    promoted.map((b) => ({ ...b, held_at: null, plan_week: planWeek })),
    planWeek,
    quietDays,
    timezone,
  )

  return {
    weekMonday: planWeek,
    thisWeek: thisWeekRows,
    held: heldRows,
    promoted: promotedUpdates,
    stats: {
      interviews: interviews.length,
      candidates: candidates.length,
      scheduled: thisWeekRows.length,
      held: heldRows.length,
      promotedFromBacklog: promotedUpdates.length,
    },
  }
}
