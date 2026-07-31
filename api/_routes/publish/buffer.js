// DEPRECATED ALIAS — /api/publish/buffer -> ./social.js
//
// The route moved to /api/publish/social when the Buffer names were retired.
// This shim exists only so a browser tab still running the previous JS bundle
// keeps publishing successfully across the deploy: Bernard is a PWA whose
// service worker serves a cached app shell, so users can sit on an old bundle
// until the UpdateAvailableModal prompts them, and publish is the one path
// where a 404 costs a real post rather than a re-render.
//
// DELETE THIS FILE once the fleet has rolled over (safe from ~2026-08-06, one
// week out). Nothing in the tree imports it — the manifest generator picks it
// up from the filesystem and registers the legacy path against the same
// handler. Deleting it and regenerating the manifest is the whole removal.
export { default } from './social.js'
