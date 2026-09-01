// Is this media_asset a RENDERED CLIP (a derived output), rather than a raw
// source video?
//
// Every render/clip-cut path in this codebase sets parent_asset_id to the source
// it was derived from — reelFactory.js, render-segments.js, exportClipEngine.js,
// approve-package.js (library branch), clip-to-broll.js, aspectVariants.js — all
// via saveBroll({ parentAssetId }). Raw sources (upload, capture_companion,
// local-import, drive imports) leave it null. So a non-null parent_asset_id is
// the authoritative "this is a derived output" marker, and it is exactly the
// signal the auto-detect-clips cron already excludes (`parent_asset_id=is.null`).
//
// WHY THIS GUARD EXISTS — the double-karaoke bug (feedback e292bc09 / a7a3361d,
// 2026-08-31): the manual clip entry points (find-clips, repurpose-video) and
// the render paths never excluded derived outputs, so a caption-baked reel could
// be re-segmented and re-rendered, baking a SECOND karaoke track over the first.
// Confirmed live: both reported pieces trace raw → reel#1(moments) →
// reel#2(moments), two burned-in caption tracks. Clip detection and reel
// rendering must run on RAW sources only; a rendered clip is already a cut,
// short clip — finding moments inside it (and re-baking) is never intended.
//
// Pure and single-signal so both the routes and reelFactory's candidate loop
// share ONE decision that cannot drift. Tolerates null/undefined and a missing
// field — an asset we cannot classify as a source is treated as raw (false),
// matching the callers' existing "if the field is absent, proceed" behaviour;
// the callers already reject a genuinely-missing asset separately.
export function isRenderedClip(asset) {
  return Boolean(asset && asset.parent_asset_id)
}
