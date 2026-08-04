// Interview outputs → content_items fan-out selection.
//
// Extracted as a pure function so both api/_routes/db/interviews.js and the
// tests call the SAME rule — a rule left inline behind the PATCH handler can
// only be tested by re-implementing it, and a test that re-declares its own
// copy passes happily while the real handler rots.
//
// WHY THIS IS RE-ENTRANT
// ----------------------
// The fan-out used to be gated on "does this interview have ANY content_item
// yet" (`select=id&limit=1` + `if (existsRows.length === 0)`). That is a
// one-shot, all-or-nothing gate: it fires once, and every output key that
// arrives in a later PATCH is dropped forever with no error.
//
// It cost real content. Across the interviews that carry generated outputs,
// blogPost — the key present in the FIRST completed PATCH — materialised
// 23/23, while every key a legacy multi-output generator appended afterwards
// materialised 0/N:
//
//   blogPost        23 generated → 23 content_items
//   emailNewsletter  2 generated →  0
//   googleAds        2 generated →  0
//   instagramAds     2 generated →  0
//   landingPage      2 generated →  0
//   youtubeScript    2 generated →  0
//
// No current caller can retrigger it: today's flows write exactly one key
// (blogPost or emailNewsletter) in a single status='completed' PATCH, and the
// two server-side writers that merge into outputs (blog-regen-finalize,
// split-into-series) only overwrite blogPost and never send
// status='completed', so the cascade does not fire for them at all. This is
// therefore hardening against a latent landmine rather than a repair of a live
// outage — but it is the exact failure mode anything that adds a SECOND output
// key post-completion would hit on its first run (a digest assembler, a "also
// write a newsletter from this story" action, a per-part atom regeneration).
//
// Idempotency is preserved by narrowing the guard rather than removing it: we
// skip a platform that already has a row for this interview, instead of
// skipping the whole batch because some unrelated platform does.

// Platforms covered by the on-demand content plan (instagram, facebook,
// linkedin, gbp, tiktok) are intentionally NOT in this map — the Plan tab
// handles those via content_plan_atoms. Those rows share the interview_id,
// which is precisely why the old any-row guard mis-fired: an atom landing
// first permanently blocked the keystone fan-out.
export const OUTPUT_PLATFORM_MAP = Object.freeze([
  { key: 'blogPost',        platform: 'blog' },
  { key: 'googleAds',       platform: 'google_ads' },
  { key: 'landingPage',     platform: 'landing_page' },
  { key: 'youtubeScript',   platform: 'youtube' },
  { key: 'emailNewsletter', platform: 'email' },
  { key: 'instagramAds',    platform: 'instagram_ads' },
])

/**
 * Decide which output keys still need a content_item.
 *
 * @param {object|null}        outputs            interviews.outputs JSONB
 * @param {Iterable<string>}   existingPlatforms  platforms already present on
 *                                                content_items for THIS interview
 * @returns {Array<{key: string, platform: string}>} entries to insert, in map order
 */
export function selectMissingOutputPlatforms(outputs, existingPlatforms = []) {
  const o = outputs && typeof outputs === 'object' ? outputs : {}
  const have = new Set(existingPlatforms || [])
  return OUTPUT_PLATFORM_MAP.filter(({ key, platform }) => {
    if (have.has(platform)) return false
    const v = o[key]
    return typeof v === 'string' && v.trim().length > 0
  })
}
