// The reel factory — pick top moments, render them, and land them as approvable
// Reel drafts in the week's plan.
//
// T2 (reel spine), step 3. Steps 1 and 2 built the two halves this joins:
//   • createClipDraft()  (clipDraft.js, #2208) — a rendered clip becomes a draft
//   • content_plan_atoms.format / .source_segment_id (migration 179, #2209)
//
// This is the piece that deliberately crosses the line drawn in
// api/_routes/cron/auto-detect-clips.js: that cron proposes moments and stops,
// on the principle that automating the labour (find the moments) is fine but
// automating the judgment (what ships) is not. Q approved crossing it on
// 2026-07-21 for reels specifically, on the strength of the human approval gate
// that still sits in front of every publish: this worker only ever produces
// DRAFTS. Nothing here publishes, and nothing here can publish — the publish
// path is not in this module's call graph.
//
// What is still enforced, and why:
//   • consent_status pending/revoked is a hard skip. Unchanged from the manual
//     render path; auto-selection does not get a weaker gate than a human click.
//   • one reel per source video per run, so a single long interview cannot fill
//     the whole week with variations of itself.
//   • a moment is never drafted twice — content_plan_atoms.source_segment_id is
//     the ledger (that is what migration 179 added it for).
//   • the week's reel target is a ceiling, counted against reel atoms that
//     already exist, so re-running is idempotent rather than additive.

import { put as blobPut } from '@vercel/blob'
import { renderVideoChannel } from './brandRenderVideo.js'
import { sliceWordsToWindow } from './karaokeCaptions.js'
import { generateCaption } from './captionGen.js'
import { saveBroll } from './saveBroll.js'
import { createClipDraft } from './clipDraft.js'
import { assignSlots, dateAtLocalHour } from './strategist.js'
import { ATOM_FORMATS } from './atomPlan.js'
import { classifySegmentVoices, SPEAKER_VOICES } from './speakerVoice.js'
import { mergeSlotsIntoCadence, slotsByPlatformFromCadence } from './cadenceSlots.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// Mirrors render-segments.js — the AI path and the manual workshop must produce
// the same shape.
const CLIP_CHANNEL = 'instagram_reel'

// Default share of the Instagram cadence that ships as Reels, when the workspace
// has not set an explicit instagram_reel target. Q's call (2026-07-21): 3 of a
// 4-post Instagram week. Reels reach ~2.25x single images and 55% of reel views
// come from non-followers (discovery = new patients), while carousels win on
// engagement depth — 3/4 leans into discovery while keeping a carousel lane.
const DEFAULT_REEL_SHARE = 0.75

// Don't auto-draft a weak moment. Scores are 0-100 (avg ~62 on real movebetter
// data), NOT 0-10 — a 0-10 assumption here would pass literally every segment.
const MIN_SCORE = 75

// A reel that is too short reads as a clip of nothing; too long stops being a
// reel. The renderer already caps at 60s; this is the auto-selection floor.
const MIN_DURATION_S = 8
const MAX_DURATION_S = 60

// Never render more than this in one cron tick regardless of the gap. Each
// render is a full ffmpeg pass (~90s on real footage) inside a 300s function,
// so 3 sequential renders genuinely raced the wall on the first live run: two
// finished, the third was still going when the function was killed. 2 leaves
// headroom, and the hourly schedule fills a backlog soon enough anyway.
const MAX_PER_RUN = 2

// Every non-quiet day of the plan week at Instagram's best local hour, as epoch
// ms ascending. Used only to re-point an already-elapsed slot forward.
const WEEKDAY_IDS = ['mon', 'tue', 'wed', 'thu', 'fri', 'sat', 'sun']
const REEL_BEST_HOUR = 12
function openDaySlots(weekMonday, quietDays, timezone) {
  const quiet = new Set((quietDays || []).map((d) => String(d).toLowerCase()))
  const out = []
  const [yr, mo, dy] = weekMonday.split('-').map(Number)
  for (let off = 0; off < 7; off++) {
    if (quiet.has(WEEKDAY_IDS[off])) continue
    const day = new Date(Date.UTC(yr, mo - 1, dy + off))
    out.push(dateAtLocalHour(day.toISOString().slice(0, 10), REEL_BEST_HOUR, timezone).getTime())
  }
  return out.sort((a, b) => a - b)
}

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

/**
 * How many of this workspace's weekly Instagram posts should be Reels.
 *
 * The Reel target is a SUBSET of the Instagram target, never an addition: "3 of
 * your 4 Instagram posts are Reels", not "3 Reels on top of 4 posts". That is
 * why it lives in cadence_policy.FORMATS rather than in cadence_policy.channels
 * — channels are summed to get the week's total (planGaps in
 * producer/needs-you.js), so a reel key there would inflate the week to 7 and
 * make /week report a phantom permanent shortfall.
 *
 * Resolution order:
 *   1. formats.reel.target_per_week — an explicit setting, including an
 *      explicit 0, which is how a workspace turns auto-drafted Reels off.
 *   2. channels.instagram_reel.target_per_week — legacy, read-only. The
 *      sanitizer strips this key on save, so it only exists on rows written
 *      before formats existed. Kept so those rows keep their meaning.
 *   3. Derived: DEFAULT_REEL_SHARE of the Instagram target (Q's call: 3 of 4).
 *
 * Always clamped to the Instagram target — a subset can never exceed its set.
 */
export function reelTargetForWorkspace(ws) {
  const policy = ws?.cadence_policy || {}
  const channels = policy.channels || {}
  const ig = channels.instagram
  // No Instagram cadence at all means Instagram isn't a channel here — no reels.
  const igEnabled = ig && ig.enabled !== false
  const igTarget = igEnabled ? Math.max(0, Number(ig.target_per_week) || 0) : 0

  const explicit = policy.formats?.reel
  if (explicit && typeof explicit.target_per_week === 'number') {
    return Math.min(igTarget, Math.max(0, Math.round(explicit.target_per_week)))
  }

  const legacy = channels.instagram_reel
  if (legacy && typeof legacy.target_per_week === 'number') {
    if (legacy.enabled === false) return 0
    return Math.min(igTarget, Math.max(0, Math.round(legacy.target_per_week)))
  }

  if (!igTarget) return 0
  return Math.min(igTarget, Math.max(1, Math.round(igTarget * DEFAULT_REEL_SHARE)))
}

/**
 * Render one moment into a captioned reel, save it as b-roll, and create the
 * draft. Extracted from render-segments.js so the manual path and this worker
 * cannot drift apart. Never throws.
 *
 * @returns {Promise<{ok: boolean, assetId: string|null, draftId: string|null, caption: string}>}
 */
export async function renderSegmentToReel({ ws, seg, asset, staffName, createDraft = true }) {
  const startSec = Number(seg.start_sec) || 0
  const durationSec = Math.max(1, (Number(seg.end_sec) || 0) - startSec)
  const hook = String(seg.hook || '').slice(0, 500)
  const transcriptExcerpt = String(seg.transcript_excerpt || '').trim()

  try {
    // Voice-faithful caption from the moment's OWN transcript + the clinician's
    // voice phrases. Best-effort — fall back to the hook rather than failing the
    // render because captioning hiccuped.
    let captionText = hook
    try {
      const generated = await generateCaption({
        topic: hook || 'Clip',
        clip: {},
        workspace: ws,
        staffId: seg.staff_id || null,
        clipTranscript: transcriptExcerpt,
      })
      if (generated && generated.trim()) captionText = generated.trim().slice(0, 500)
    } catch (e) {
      console.error('[reelFactory] caption gen failed, using hook:', e?.stack || e?.message)
    }

    // Persisted captions (migration 137): slice the source's stored words to this
    // segment's window so the render reuses them instead of re-transcribing.
    const captionWords = Array.isArray(asset.transcript_words) && asset.transcript_words.length
      ? sliceWordsToWindow(asset.transcript_words, startSec, durationSec)
      : null

    // Render the ≤60s window as a reel-format clip with the caption burned in.
    const { buffer, width, height } = await renderVideoChannel({
      videoUrl: asset.blob_url,
      channel: CLIP_CHANNEL,
      captionText,
      workspace: ws,
      staffName,
      startSec,
      durationSec,
      subtitles: true,
      ...(captionWords && captionWords.length ? { captionWords } : {}),
    })

    const safeFilename = (asset.filename || 'clip')
      .replace(/[^\w.-]/g, '_')
      .replace(/\.\w+$/, '')
    // Key by segment id so multiple segments off one source never clobber.
    const pathname = `media/clips/${ws.id}/${asset.id}/${seg.id}-${safeFilename}.mp4`
    const blob = await blobPut(pathname, buffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    // Insert the b-roll media_assets row (parent_asset_id = source) + index it.
    const saved = await saveBroll({
      ws,
      renders: [{ blobUrl: blob.url, width, height, sizeBytes: buffer.length }],
      staffId: seg.staff_id || null,
      notes: `AI clip from asset ${asset.id}${hook ? ` — "${hook.slice(0, 80)}"` : ''}`,
      parentAssetId: asset.id,
    })
    const newAssetId = saved?.[0]?.id || null

    // Land the rendered reel as an approvable draft, not just a Library b-roll
    // row. Best-effort — a draft-insert failure must not undo a successful
    // render (the clip is saved and re-draftable by hand), so it is logged and
    // swallowed rather than triggering the reset-to-'proposed' path below.
    let draftId = null
    if (createDraft) {
      try {
        draftId = await createClipDraft({
          ws,
          videoUrl: blob.url,
          assetId: newAssetId,
          filename: `${safeFilename}.mp4`,
          durationS: durationSec,
          caption: captionText,
          staffId: seg.staff_id || null,
          platform: 'instagram',
          notes: `Auto-drafted reel from moment ${seg.id} (asset ${asset.id})`,
        })
        if (!draftId) console.error('[reelFactory] draft insert returned no id for segment', seg.id)
      } catch (e) {
        console.error('[reelFactory] draft creation failed for segment', seg.id, e?.stack || e?.message)
      }
    }

    await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'rendered', rendered_asset_id: newAssetId }),
    }).catch(() => {})

    return { ok: true, assetId: newAssetId, draftId, caption: captionText }
  } catch (e) {
    console.error('[reelFactory] render failed for segment', seg.id, e?.stack || e?.message)
    // Only reset to 'proposed' if still in 'rendering' — don't clobber a user
    // edit (discarded/kept) that arrived during the render window.
    await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}&status=eq.rendering`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'proposed' }),
    }).catch(() => {})
    return { ok: false, assetId: null, draftId: null, caption: '' }
  }
}

// How many unlabelled segments to classify per run. Bounded so a workspace with
// a large unclassified backlog (movebetter has 165) fills in over several ticks
// instead of spending the whole function budget on classification.
const MAX_CLASSIFY_PER_RUN = 24

/**
 * Ensure the given segments carry a speaker_voice label, classifying and
 * persisting any that don't (migration 180). Self-healing: segments detected
 * before the classifier existed get labelled the first time they're considered
 * for a reel, so no separate backfill job is needed.
 *
 * Mutates the passed rows in place so the caller can filter on the fresh label.
 */
async function ensureVoiceLabels(ws, segs) {
  const todo = segs.filter((s) => !s.speaker_voice).slice(0, MAX_CLASSIFY_PER_RUN)
  if (!todo.length) return

  const results = await classifySegmentVoices(todo)
  await Promise.all(
    todo.map(async (seg, i) => {
      const r = results[i]
      if (!r) return
      seg.speaker_voice = r.voice
      seg.speaker_voice_confidence = r.confidence
      await sb(`video_segments?id=eq.${seg.id}&workspace_id=eq.${ws.id}`, {
        method: 'PATCH',
        headers: { Prefer: 'return=minimal' },
        body: JSON.stringify({ speaker_voice: r.voice, speaker_voice_confidence: r.confidence }),
      }).catch(() => {})
    }),
  )
}

/**
 * Which speaker voices this workspace will auto-draft reels from.
 * Default 'any' preserves Q's 2026-07-22 call (filmed testimonials are in scope,
 * humans approve every publish). Setting it to 'clinician' restricts auto-draft
 * to clinician-voice moments — the patient-voice gate, available without a
 * deploy now that the label exists. Manual rendering is never restricted.
 */
export function reelVoiceFilter(ws) {
  const v = ws?.cadence_policy?.formats?.reel?.voice
  return v === 'clinician' ? 'clinician' : 'any'
}

/**
 * Top unrendered moments eligible to become reels, best first, at most one per
 * source video. Classifies speaker voice on demand; otherwise DB selection only.
 */
export async function selectReelCandidates({ ws, limit }) {
  if (limit <= 0) return []

  // Moments already turned into a reel atom — the never-draft-twice ledger.
  const drafted = new Set()
  const draftedRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&source_segment_id=not.is.null&select=source_segment_id`,
  )
  if (draftedRes.ok) {
    for (const r of await draftedRes.json().catch(() => [])) {
      if (r.source_segment_id) drafted.add(r.source_segment_id)
    }
  }

  // Candidates: proposed moments on a usable source video, scored above the bar.
  // Ordered by score so a truncated fetch still yields the strongest moments.
  const res = await sb(
    `video_segments?workspace_id=eq.${ws.id}&status=eq.proposed&score=gte.${MIN_SCORE}` +
      `&rendered_asset_id=is.null&order=score.desc&limit=120` +
      `&select=id,source_asset_id,staff_id,start_sec,end_sec,hook,transcript_excerpt,score,` +
      `speaker_voice,speaker_voice_confidence,` +
      `source_asset:media_assets!video_segments_source_asset_id_fkey(id,kind,blob_url,filename,archived_at,consent_status,transcript_words)`,
  )
  if (!res.ok) {
    console.error('[reelFactory] candidate fetch failed:', res.status)
    return []
  }
  const rows = await res.json().catch(() => [])

  // Label unconditionally, NOT only when the gate is on. Gating the labelling on
  // the filter meant a workspace running the default voice:'any' never got a
  // single segment classified — the classifier was live but dormant on the whole
  // backlog, so nobody could SEE who was talking without first flipping a gate
  // they'd flip based on... seeing who was talking. The label is information;
  // the filter is a policy applied to it. Cheap (Haiku, ≤24/run, persisted once
  // per segment forever) and it makes the data visible before it's enforced.
  const voiceFilter = reelVoiceFilter(ws)
  await ensureVoiceLabels(ws, rows)

  const picked = []
  const usedAssets = new Set()
  for (const seg of rows) {
    if (picked.length >= limit) break
    if (drafted.has(seg.id)) continue

    const asset = seg.source_asset
    if (!asset || asset.kind !== 'video' || !asset.blob_url || asset.archived_at) continue
    // Same hard consent gate the manual path enforces.
    if (asset.consent_status === 'pending' || asset.consent_status === 'revoked') continue
    // One reel per source video per run — a single long interview must not fill
    // the whole week with variations of itself.
    if (usedAssets.has(asset.id)) continue

    const dur = (Number(seg.end_sec) || 0) - (Number(seg.start_sec) || 0)
    if (dur < MIN_DURATION_S || dur > MAX_DURATION_S) continue

    // Patient-voice gate, off by default. When on, only a confidently
    // clinician-voice moment qualifies — 'mixed', 'unknown' and anything the
    // classifier wasn't sure about are excluded, because the caller asked for
    // clinician voice and "probably" is not an answer for a gate.
    if (voiceFilter === 'clinician') {
      if (seg.speaker_voice !== SPEAKER_VOICES.CLINICIAN) continue
      if ((seg.speaker_voice_confidence ?? 0) < 0.6) continue
    }

    usedAssets.add(asset.id)
    picked.push(seg)
  }
  return picked
}

/**
 * Fill this workspace's open Reel slots for the week: render the top moments and
 * insert a `format='reel'` atom per rendered clip, already linked to its draft.
 *
 * Idempotent — the target is a ceiling counted against reel atoms that already
 * exist for the week, so a re-run with a full week is a no-op.
 *
 * @returns {Promise<{skipped?: string, target?: number, existing?: number, rendered?: number, failed?: number, shortfall?: number}>}
 */
export async function fillReelSlots({ ws, weekMonday }) {
  if (!ws?.video_pipeline_enabled) return { skipped: 'video_pipeline_disabled' }

  const target = reelTargetForWorkspace(ws)
  if (target <= 0) return { skipped: 'no_reel_target', target: 0 }

  // Reel slots already filled this week. Skipped atoms don't hold a slot.
  const existingRes = await sb(
    `content_plan_atoms?workspace_id=eq.${ws.id}&plan_week=eq.${weekMonday}` +
      `&format=eq.${ATOM_FORMATS.REEL}&status=neq.skipped&select=id`,
  )
  if (!existingRes.ok) return { skipped: 'db_error' }
  const existing = (await existingRes.json().catch(() => [])).length

  const gap = Math.min(target - existing, MAX_PER_RUN)
  if (gap <= 0) return { target, existing, rendered: 0, failed: 0, shortfall: 0 }

  const candidates = await selectReelCandidates({ ws, limit: gap })
  if (!candidates.length) {
    // A real signal, not an error: the week wants reels and the clip library
    // cannot supply them. Surfaced so the footage-ask can act on it.
    return { target, existing, rendered: 0, failed: 0, shortfall: gap }
  }

  // Claim them up front so a concurrent tick can't double-render the same moment.
  const claimIds = candidates.map((s) => `"${s.id}"`).join(',')
  await sb(`video_segments?id=in.(${claimIds})&workspace_id=eq.${ws.id}&status=eq.proposed`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'rendering' }),
  }).catch(() => {})

  // Resolve staff names once for the lower-third overlay.
  const staffIds = [...new Set(candidates.map((s) => s.staff_id).filter(Boolean))]
  const staffNames = {}
  if (staffIds.length) {
    const cRes = await sb(
      `staff?id=in.(${staffIds.map((id) => `"${id}"`).join(',')})&workspace_id=eq.${ws.id}&select=id,name`,
    )
    if (cRes.ok) for (const c of await cRes.json().catch(() => [])) staffNames[c.id] = c.name
  }

  // Pre-compute the slot times for this batch UP FRONT, then stamp each atom as
  // its render lands. The batch-at-the-end version lost every atom whenever the
  // function was killed at the 300s wall mid-batch: the drafts existed but had
  // no atom, and /week reads atoms — so real rendered reels were invisible, and
  // their segments were already marked 'rendered' so they were never retried.
  // Placeholders exist only to run the spread; they are never written.
  const quietDays = Array.isArray(ws.cadence_policy?.quiet_days) ? ws.cadence_policy.quiet_days : []
  const timezone = ws.cadence_policy?.timezone || 'UTC'
  // T3: place into the workspace's PINNED Instagram slots, and specifically the
  // reel-format ones — assignToPinnedSlots matches on atom.format, so the
  // placeholders must carry format:'reel' or a reel would be slotted into a
  // photo tile. Falls back to the computed even-spread when nothing is pinned.
  const channels = ws.cadence_policy?.channels || {}
  const slotsByPlatform = slotsByPlatformFromCadence(mergeSlotsIntoCadence(channels, channels, quietDays))
  const slotTimes = assignSlots(
    candidates.map(() => ({ platform: 'instagram', format: ATOM_FORMATS.REEL })),
    weekMonday,
    quietDays,
    timezone,
    slotsByPlatform,
  ).map((a) => a.scheduled_at)

  // Never hand back a slot that has already happened. assignSlots spreads across
  // the WHOLE plan week with no "not before now" floor, so a reel cut on
  // Wednesday could be stamped for Monday — an auto-created draft dated in the
  // past, which reads as broken on /week. Re-point any elapsed slot at the next
  // open day in the same week (plan_week must still match, so it can only move
  // forward WITHIN the week); if the week is genuinely used up, keep the
  // computed time rather than inventing one outside the plan week.
  const now = Date.now()
  // Exclude days a still-valid slot already occupies, or the re-pointed reel
  // lands on top of one that was fine — two reels at the identical timestamp.
  const taken = new Set(slotTimes.filter((t) => Date.parse(t) > now).map((t) => Date.parse(t)))
  const futureSlots = openDaySlots(weekMonday, quietDays, timezone)
    .filter((t) => t > now && !taken.has(t))
  let nextFree = 0
  for (let i = 0; i < slotTimes.length; i++) {
    if (Date.parse(slotTimes[i]) > now) continue
    if (nextFree >= futureSlots.length) break
    slotTimes[i] = new Date(futureSlots[nextFree++]).toISOString()
  }

  let inserted = 0
  let failed = 0
  for (const [idx, seg] of candidates.entries()) {
    const out = await renderSegmentToReel({
      ws,
      seg,
      asset: seg.source_asset,
      staffName: staffNames[seg.staff_id] || '',
      createDraft: true,
    })
    if (!out.ok || !out.draftId) {
      failed += 1
      continue
    }
    const atomRow = {
      workspace_id: ws.id,
      // NULL by design: a reel's source is a media_asset + a moment, not an
      // interview. Migration 179 relaxed the NOT NULL for exactly this.
      interview_id: null,
      platform: 'instagram',
      slot: 1,
      angle: 'clip_moment',
      angle_label: 'Reel',
      angle_description: 'A standalone moment cut from a real clinician video',
      brief: String(seg.hook || '').replace(/\s+/g, ' ').trim().slice(0, 90) || null,
      format: ATOM_FORMATS.REEL,
      source_segment_id: seg.id,
      // Born drafted: the clip is rendered and the draft exists, so this slot is
      // never a promise. That is also what keeps it out of the draft/predraft
      // paths (they require a null content_piece_id) and out of the Strategist's
      // replace-untouched delete (it only removes pending, unlinked atoms).
      status: 'drafted',
      content_piece_id: out.draftId,
      planned_by: 'reel_factory',
      plan_week: weekMonday,
      scheduled_at: slotTimes[idx] || null,
      held_at: null,
    }

    // Insert this atom NOW, while we still have a function to do it in.
    const one = await sb('content_plan_atoms', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify([atomRow]),
    }).catch(() => null)
    if (!one || !one.ok) {
      console.error('[reelFactory] atom insert failed for segment', seg.id, one?.status)
      failed += 1
      continue
    }
    inserted += 1

    // Mirror the slot time onto the draft so /week and the piece agree.
    await sb(`content_items?id=eq.${out.draftId}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ scheduled_at: atomRow.scheduled_at }),
    }).catch(() => {})
  }

  return {
    target,
    existing,
    rendered: inserted,
    failed,
    shortfall: Math.max(0, gap - inserted),
  }
}
