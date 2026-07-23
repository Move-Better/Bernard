// Server-side entry point for "what media kind can this draft use?".
//
// This file used to keep its OWN copy of the platform→kind maps. It had already
// drifted from the client copy (it carried 'email' and a dead 'reels'; the
// client carried neither), and neither copy could tell that a Reel — stored as
// platform:'instagram' with a video attached, never platform:'instagram_reel' —
// is a video post. That gap is what surfaced as photos being suggested on a
// Reel draft.
//
// There is now ONE implementation, in src/lib/platformMediaKind.js, re-exported
// here so both the API and the app resolve identically by construction and the
// existing '../_lib/platformMedia.js' import path keeps working. The cross-repo
// import is the same pattern api/_lib/dispatchContentItem.js already uses for
// isInstagramReel; that module's graph is alias-free so Node can load it.
//
// Prefer mediaKindForDraft(piece) — mediaKindForPlatform(platform) alone cannot
// identify a Reel.

export { mediaKindForDraft, mediaKindForPlatform } from '../../src/lib/platformMediaKind.js'
