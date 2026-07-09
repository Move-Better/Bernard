// Curated licensed music library (WS3.3) — the server-side source of truth.
//
// Tracks are royalty-free (Pixabay Music license: commercial use OK, no
// attribution required — see memory: Q chose Pixabay 2026-07-08), stored in the
// bernard-prod Vercel Blob, and mixed under video clips with auto-duck by
// api/_lib/brandRenderVideo.js.
//
// SECURITY BOUNDARY: this is the ONLY place track URLs live. The client picker
// sends just a `trackId`; the render route resolves the URL from here via
// resolveMusicTrack(), so a caller can NEVER make the render function fetch an
// arbitrary URL (no SSRF). The client fetches the display list from
// GET /api/editorial/music-tracks (this same array), so there is a single
// source of truth — no client/server mirror to drift.
//
// To add tracks: download from https://pixabay.com/music/, then run
//   node scripts/upload-music-tracks.mjs "<Title>|<mood>" path/to/file.mp3 ...
// which uploads each to Blob and prints the manifest entry to paste below.

export const MUSIC_MOODS = ['calm', 'upbeat', 'warm', 'cinematic']

// Each entry: { id, title, mood, url, durationSec }
//   id         — stable kebab-case slug (sent by the client, resolved here)
//   title      — human label shown in the picker
//   mood       — one of MUSIC_MOODS (filter chips)
//   url        — public Vercel Blob URL of the MP3 (https, bernard-prod store)
//   durationSec— track length, for the picker
//
// Empty until the curated Pixabay set is uploaded (no placeholder/fake tracks —
// see the "no fake data" rule). The picker shows an empty state until populated.
export const MUSIC_TRACKS = []

// Resolve a client-supplied track id to its manifest entry (or null). The render
// route uses this to turn a trackId into a trusted URL — never trust a raw URL
// from the client.
export function resolveMusicTrack(id) {
  if (!id || typeof id !== 'string') return null
  return MUSIC_TRACKS.find((t) => t.id === id) || null
}
