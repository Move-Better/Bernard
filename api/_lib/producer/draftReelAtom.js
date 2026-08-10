// Re-draft a REEL atom from the clip that was already rendered for it.
//
// See draftSource.js for how an atom ends up here. The short version: a reel
// atom is born linked to a rendered draft, sweep-past-weeks.js archives that
// draft when its week closes and clears content_piece_id, and the slot then
// reappears on /week as "needs draft" with no interview to draft from.
//
// This does NOT re-render. renderSegmentToReel() is two LLM calls, an ffmpeg
// pass, a blob upload and a new media_assets row — and every byte of that
// output already exists: video_segments.rendered_asset_id still points at the
// finished mp4, with its poster, and video_segments.status is 'rendered'.
// Re-rendering would duplicate a Library asset to reproduce a file we already
// have, and would not fit inside the route's 120s budget reliably.
//
// So the expensive artifact (the clip) is reused and only the cheap, genuinely
// stale part (the caption, written for a week that has since closed) is
// regenerated. That is the same trade the moment-bank sweep makes — keep the
// inventory, discard the week-frozen copy — applied to the one atom shape
// whose inventory is NOT re-drawable: selectReelCandidates() requires
// status='proposed' AND rendered_asset_id IS NULL, so a rendered segment is
// never picked again and the clip has exactly one route back to a draft.

import { generateCaption } from '../captionGen.js'
import { createClipDraft } from '../clipDraft.js'

const SEGMENT_SELECT =
  'id,staff_id,hook,transcript_excerpt,start_sec,end_sec,status,rendered_asset_id,' +
  'rendered_asset:media_assets!video_segments_rendered_asset_id_fkey(id,blob_url,thumbnail_url,filename,archived_at)'

/**
 * Compose a fresh draft for a reel atom from its already-rendered clip.
 *
 * Throws on any unrecoverable state so the caller's existing catch resets the
 * atom to 'pending' — the same contract the interview path has.
 *
 * @param {Object}   p
 * @param {Object}   p.ws    — workspace context (must have .id)
 * @param {Object}   p.atom  — the content_plan_atom, with source_segment_id set
 * @param {Function} p.sb    — workspace-scoped supabase REST helper from the route
 * @returns {Promise<{contentPieceId: string, caption: string, segment: Object}>}
 */
export async function draftReelAtom({ ws, atom, sb }) {
  const segRes = await sb(
    `video_segments?id=eq.${atom.source_segment_id}&workspace_id=eq.${ws.id}&select=${SEGMENT_SELECT}`,
  )
  if (!segRes.ok) throw new Error(`Could not fetch source segment: ${segRes.status}`)
  const segRows = await segRes.json().catch(() => [])
  if (!segRows.length) throw new Error('Source clip not found')
  const seg = segRows[0]

  // The clip must still exist as a usable Library asset. A missing or archived
  // asset means the rendered mp4 is gone; there is nothing to draft around and
  // pretending otherwise would produce a video post with no video.
  const asset = seg.rendered_asset
  if (!asset || !asset.blob_url) throw new Error('Source clip has not been rendered yet')
  if (asset.archived_at) throw new Error('Source clip has been archived')

  const hook = String(seg.hook || '').trim()
  const transcriptExcerpt = String(seg.transcript_excerpt || '').trim()

  // Voice-faithful caption from the moment's own transcript, exactly as the
  // factory does it. Best-effort: fall back to the hook rather than failing the
  // whole re-draft because captioning hiccuped — the clip is the artifact, and
  // a producer can always rewrite the words.
  let caption = hook
  try {
    const generated = await generateCaption({
      topic: hook || 'Clip',
      clip: {},
      workspace: ws,
      staffId: seg.staff_id || null,
      clipTranscript: transcriptExcerpt,
    })
    if (generated && generated.trim()) caption = generated.trim().slice(0, 500)
  } catch (e) {
    console.error('[draftReelAtom] caption gen failed, using hook:', e?.stack || e?.message)
  }

  const durationSec = Math.max(1, (Number(seg.end_sec) || 0) - (Number(seg.start_sec) || 0))

  const contentPieceId = await createClipDraft({
    ws,
    videoUrl: asset.blob_url,
    assetId: asset.id,
    thumbnailUrl: asset.thumbnail_url || null,
    filename: asset.filename || null,
    durationS: durationSec,
    caption,
    staffId: seg.staff_id || null,
    platform: atom.platform,
    notes: `Re-drafted reel from moment ${seg.id} (clip ${asset.id})`,
    // Keep the slot's own time. The atom may already have been promoted back
    // into a plan week by the Strategist, and a draft that disagrees with the
    // slot it fills reads as broken on /week.
    scheduledAt: atom.scheduled_at || null,
  })
  if (!contentPieceId) throw new Error('Could not create content item for reel')

  return { contentPieceId, caption, segment: seg }
}
