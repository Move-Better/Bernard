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
