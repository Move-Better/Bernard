// Pure helpers for the auto-publish cron's per-channel / per-location retry of
// partial dispatch failures. No side effects — unit-testable in isolation.
//
// The hard invariant these enforce: a location that has ALREADY been posted to
// (its stable id is recorded in `published_channels[channel].locations`) is
// NEVER re-dispatched. Re-posting to a customer's Google Business Profile /
// social account is irreversible, so the posted-set is treated as monotonic
// (append-only) and is the basis for the skip-if-already-posted guard.
//
// Durable state lives in story_packages.auto_publish_state (existing JSONB
// column), shaped as:
//   {
//     eligible, evaluated_at, channels, gated_reasons,  // evaluation snapshot
//     retry_count,                                       // dispatch attempts
//     retry_exhausted_at?,                               // set when cap hit
//     published_channels: {
//       gbp: {
//         content_item_id, buffer_id, first_fired_at,    // overall bookkeeping
//         locations: { '<channelId|teamId>': { post_id, fired_at } }
//       }
//     }
//   }

// Cron fires every 10 minutes, so 6 attempts ≈ 1 hour of retries before a
// permanently-failing channel stops being re-attempted (claim retained).
export const MAX_AUTO_PUBLISH_RETRIES = 6

// Targets that have NOT yet been posted for a channel, keyed by stable id.
// `targets` is the full per-location target list ({ id, ... }); `channelState`
// is published_channels[channel] (may be undefined on first run).
export function unpostedTargets(targets, channelState) {
  const posted = new Set(Object.keys(channelState?.locations || {}))
  return (Array.isArray(targets) ? targets : []).filter((t) => t && !posted.has(t.id))
}

// Merge newly-posted location results into a channel's durable state. Monotonic:
// an existing posted record is never overwritten or dropped, so a retry run can
// only ADD locations, never resurrect/duplicate one. Returns a new object.
export function mergePostedLocations(channelState, posted, nowIso) {
  const next = { ...(channelState || {}) }
  const locations = { ...(next.locations || {}) }
  for (const p of Array.isArray(posted) ? posted : []) {
    if (!p || !p.id) continue
    if (locations[p.id]) continue // already recorded — never overwrite
    locations[p.id] = { post_id: p.postId ?? null, fired_at: nowIso }
  }
  next.locations = locations
  return next
}

// A channel is fully done only when every target has a recorded posted location
// AND the content_item bookkeeping succeeded (content_item_id present). The ci
// requirement keeps a post-fired-but-bookkeeping-failed channel "retriable" so
// the marking is retried (without re-posting — the locations are already
// recorded, so unpostedTargets returns []).
export function isChannelComplete(targets, channelState) {
  const list = Array.isArray(targets) ? targets : []
  if (list.length === 0) return false
  const posted = new Set(Object.keys(channelState?.locations || {}))
  const allPosted = list.every((t) => posted.has(t.id))
  const ciOk = channelState?.content_item_id != null
  return allPosted && ciOk
}

// Decide whether to RELEASE the claim (auto_published_at=null → re-armed for the
// next run to retry the still-failed targets) or RETAIN it (auto_published_at
// stays set → cron skips the package).
//
//   - allComplete                  → retain (nothing left to do)
//   - !anyRetriable                → retain (only permanent config blocks remain;
//                                     retrying every 10 min forever is pointless)
//   - retryCount >= maxRetries     → retain + exhausted (budget spent; manual fix)
//   - otherwise                    → release (retry transient failures next run)
//
// Releasing is ONLY ever safe because the posted-set is recorded durably in the
// SAME atomic PATCH that releases the claim — the next run reads that set from
// its claim representation and skips already-posted locations.
export function decideClaimDisposition({ allComplete, anyRetriable, retryCount, maxRetries = MAX_AUTO_PUBLISH_RETRIES }) {
  if (allComplete) return { release: false, exhausted: false }
  if (!anyRetriable) return { release: false, exhausted: false }
  if (retryCount >= maxRetries) return { release: false, exhausted: true }
  return { release: true, exhausted: false }
}
