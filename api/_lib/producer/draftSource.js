// Which source a content_plan_atom can be drafted FROM.
//
// Extracted as a pure function (not left inline in the route) so the rule is
// testable against real atom shapes rather than a re-implemented copy — a
// route-inline rule can only be tested by a test that restates it, which
// passes no matter what the route actually does.
//
// Background (feedback e491bb5c, 2026-08-10). draft.js used to open with a
// bare `if (!atom.interview_id) return 422`, which was correct when every atom
// was interview-backed. Migration 179 deliberately made interview_id NULLABLE
// so REEL atoms could exist: a reel's source is a media_asset video + a
// video_segments moment, never a transcript. reelFactory creates those atoms
// already linked to a rendered draft, on the stated assumption that they can
// therefore never re-enter the draft path.
//
// That assumption does not hold. sweep-past-weeks.js's archiveStaleDrafts()
// returns a closed week's undrafted slots to the backlog — archiving the item
// and clearing content_piece_id (status→'pending', held_at set). Its
// re-bank/delete split keys on moment_id, so reel atoms take the LEGACY
// re-bank branch and land as { interview_id: null, content_piece_id: null,
// source_segment_id: <set>, status: 'pending' }. /week's cardState() offers
// "Draft" on !contentPieceId alone, so the slot reappears as draftable — and
// every click hit the interview guard. Five atoms on movebetter, permanently.
//
// A reel atom in that state is fully recoverable and must NOT be deleted the
// way a moment-composed atom is: selectReelCandidates() only ever picks
// segments with status='proposed' AND rendered_asset_id IS NULL, so a segment
// that already rendered can never be re-selected. Deleting the atom would
// strand the rendered clip in the Library and lose the slot for good. The
// rendered mp4 still exists — only the pointer to it was cleared — so the
// recovery is to compose a fresh draft around the existing asset.

/** @typedef {'interview'|'reel_segment'} DraftSource */

export const DRAFT_SOURCES = {
  INTERVIEW: 'interview',
  REEL_SEGMENT: 'reel_segment',
}

// Shown to the user when an atom carries no draftable source at all. The old
// copy ("backlog atoms must be linked to an interview") was actively
// misleading for a reel — it sent the reporter looking for an interview to
// attach to a clip that never had one and never needed one.
export const NO_SOURCE_MESSAGE =
  'This slot has nothing to draft from — it has neither an interview nor a source clip. Delete it and let the planner refill the slot.'

/**
 * Decide which generator path an atom belongs to.
 *
 * interview_id wins when both are present: an interview-backed atom is a
 * transcript piece regardless of any segment that may also be attached, and
 * that ordering keeps every pre-existing atom on exactly the path it used
 * before this function existed.
 *
 * @param {{interview_id?: string|null, source_segment_id?: string|null}|null|undefined} atom
 * @returns {DraftSource|null} null when the atom has no draftable source
 */
export function resolveDraftSource(atom) {
  if (!atom) return null
  if (atom.interview_id) return DRAFT_SOURCES.INTERVIEW
  if (atom.source_segment_id) return DRAFT_SOURCES.REEL_SEGMENT
  return null
}
