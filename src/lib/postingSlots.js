// T3 — client-side helpers for the posting-slots week board. Diffs the
// week's ACTUAL scheduled atoms against the workspace's PINNED slot
// definitions (cadence[platform].slots, attached server-side by
// api/_lib/cadenceSlots.js and returned in week-summary.js's `cadence` field)
// to find genuinely empty slots — tiles with no matching post yet, rendered
// as a "+ open slot" affordance on the week board.

function slotKey(platform, weekday, hour, format) {
  return `${platform}:${weekday}:${hour}:${format || 'post'}`
}

// Reduce a scheduled_at instant to its local (weekday, hour) wall-clock parts
// in the given timezone — comparing what an atom ACTUALLY landed on, not
// recomputing an expected value server-side math would produce, so this is
// robust to any DST/timezone edge case rather than needing to replicate
// api/_lib/strategist.js's dateForWeekdaySlot() client-side.
export function localSlotParts(iso, tz) {
  const d = new Date(iso)
  const weekday = new Intl.DateTimeFormat('en-US', { weekday: 'short', timeZone: tz }).format(d).toLowerCase().slice(0, 3)
  const hour = parseInt(new Intl.DateTimeFormat('en-US', { hour: 'numeric', hour12: false, timeZone: tz }).format(d), 10) % 24
  return { weekday, hour }
}

/**
 * Compute the set of pinned slots that have NO matching scheduled item this
 * week — the calendar's "+ open slot" tiles. `cadence` is the week-summary
 * response's `cadence` field (each enabled platform carries `.slots`);
 * `scheduled` is the response's `scheduled` array. Pure.
 *
 * @returns {Array<{platform: string, weekday: string, hour: number, format: string, enabled: boolean, exploring?: boolean}>}
 */
export function computeEmptySlots(cadence, scheduled, tz) {
  const filled = new Set(
    (scheduled || [])
      .filter((item) => item.scheduled_at)
      .map((item) => {
        const { weekday, hour } = localSlotParts(item.scheduled_at, tz)
        return slotKey(item.platform, weekday, hour, item.format || 'post')
      }),
  )
  const empty = []
  for (const [platform, cfg] of Object.entries(cadence || {})) {
    if (!cfg?.enabled) continue
    for (const slot of cfg.slots || []) {
      if (slot.enabled === false) continue
      const key = slotKey(platform, slot.weekday, slot.hour, slot.format)
      if (!filled.has(key)) empty.push({ platform, ...slot })
    }
  }
  return empty
}

// Fallback hour for an ad-hoc add on a channel that has no pinned slot to copy
// a time from. Midday is the least-wrong default: it is the hour the cadence
// template itself uses for most channels.
const DEFAULT_AD_HOC_HOUR = 12

/**
 * The channel · format choices offered when adding a post to a day OUTSIDE the
 * pinned cadence.
 *
 * computeEmptySlots above can only ever offer what the cadence template
 * defines, so a day whose slots are all filled offers nothing at all — the
 * board's only add-affordance disappears exactly when the day is busiest. On
 * the reported week, Thursday had a single pinned slot (instagram/12:00/reel),
 * it was taken, and there was no way to put anything else on that day
 * ("Unable to schedule new posts today (Thursday)"). Cadence is a template for
 * what Bernard plans on its own, not a ceiling on what a human may add.
 *
 * Neither server path validates against the cadence template — create-slot-atom
 * and assign-slot both accept any well-formed weekday+hour — so an ad-hoc
 * choice is already a first-class thing to schedule; only the UI was gating it.
 *
 * One entry per enabled channel × each format that channel actually posts in,
 * so Instagram offers both its post and its reel lane rather than collapsing to
 * one. `hour` copies the channel's own most-used configured hour so an ad-hoc
 * add lands at the time that channel normally posts.
 *
 * @param {Record<string, {enabled?: boolean, slots?: Array<object>}>} cadence
 * @returns {Array<{platform: string, format: string, hour: number}>}
 */
export function adHocSlotOptions(cadence) {
  const options = []
  for (const [platform, cfg] of Object.entries(cadence || {})) {
    if (!cfg?.enabled) continue
    const slots = (cfg.slots || []).filter((s) => s && s.enabled !== false)

    // Most-used configured hour for this channel, so an ad-hoc Instagram add
    // lands at the hour Instagram already posts rather than a global default.
    const hourCounts = new Map()
    for (const s of slots) {
      if (!Number.isInteger(s.hour)) continue
      hourCounts.set(s.hour, (hourCounts.get(s.hour) || 0) + 1)
    }
    let hour = DEFAULT_AD_HOC_HOUR
    let best = 0
    for (const [h, n] of hourCounts) {
      // Ties break to the earlier hour so the choice is stable across renders
      // (Map order follows insertion, which follows slot order, not time).
      if (n > best || (n === best && h < hour)) { hour = h; best = n }
    }

    const formats = [...new Set(slots.map((s) => s.format || 'post'))]
    // An enabled channel with no slots at all still deserves an entry —
    // otherwise turning a channel on but not pinning it a time makes it
    // unreachable from the board.
    if (formats.length === 0) formats.push('post')

    for (const format of formats) options.push({ platform, format, hour })
  }
  return options
}
