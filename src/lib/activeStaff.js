// Who can be picked for NEW work: everyone whose access has not been switched
// off (staff.deactivated_at — migration 216).
//
// Use this only where someone CHOOSES a person (record an interview with,
// attribute an upload to, target a campaign at). Lists that label PAST work —
// who approved, who commented, a story's author — must keep deactivated people,
// or their history shows as "Unknown".
//
// keepIds: people already selected on the thing being edited (a campaign's
// targets, an asset's attribution) stay visible, so a departed person can be
// seen and un-selected instead of silently vanishing from the form.

/**
 * @template {{ id?: string, deactivated_at?: string|null }} T
 * @param {T[]|null|undefined} list
 * @param {string|string[]|null|undefined} [keepIds]
 * @returns {T[]}
 */
export function pickableStaff(list, keepIds = []) {
  const keep = new Set((Array.isArray(keepIds) ? keepIds : [keepIds]).filter(Boolean))
  return (Array.isArray(list) ? list : []).filter((s) => !!s && (!s.deactivated_at || keep.has(s.id)))
}

// Pickers for WHO IS PICTURED in media. Same as pickableStaff, minus the
// Playwright fixture rows ("E2E Smoke Staff", "E2E Smoke Clinician", "e2e"):
// they must stay active for the e2e specs, but nobody is photographed as them.
// A fixture already selected on the thing being edited stays visible.
export function pickablePictured(list, keepIds = []) {
  const keep = new Set((Array.isArray(keepIds) ? keepIds : [keepIds]).filter(Boolean))
  return pickableStaff(list, keepIds).filter((s) => keep.has(s.id) || !/^e2e\b/i.test(s.name || ''))
}
