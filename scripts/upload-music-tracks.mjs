#!/usr/bin/env node
// Seed the SHARED music library (WS3.3-P2): upload curated licensed tracks to the
// bernard-prod Vercel Blob AND insert them into public.music_tracks with
// workspace_id = NULL (shared — every workspace sees them; per-tenant uploads go
// through the Settings → Music UI instead).
//
// Usage (from the Bernard project root, with BLOB_READ_WRITE_TOKEN + SUPABASE_URL
// + SUPABASE_SERVICE_KEY in env):
//   node scripts/upload-music-tracks.mjs "Open Road|upbeat" ~/Downloads/open-road.mp3 \
//                                         "Slow Morning|calm" ~/Downloads/slow-morning.mp3
//
// Each pair is:  "<Title>|<mood>"  <path-to-mp3>   (mood ∈ calm|upbeat|warm|cinematic)
//
// Tracks must be royalty-free with a redistribution-OK license (Pixabay Music:
// commercial use OK, no attribution). Do NOT upload anything you don't have the
// right to host + let tenants publish over. Re-running with the same title
// overwrites the blob and inserts a fresh shared row.

import { put as blobPut } from '@vercel/blob'
import { readFile } from 'node:fs/promises'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

const MOODS = ['calm', 'upbeat', 'warm', 'cinematic']

function slugify(s) {
  return s.toLowerCase().trim().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '')
}

// Probe duration (seconds, rounded) via ffmpeg stderr — no ffprobe dependency.
function probeDuration(path) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (d) => { err += d.toString() })
    proc.on('close', () => {
      const m = err.match(/Duration:\s*(\d+):(\d+):(\d+(?:\.\d+)?)/)
      if (!m) return resolve(null)
      resolve(Math.round(+m[1] * 3600 + +m[2] * 60 + +m[3]))
    })
    proc.on('error', () => resolve(null))
  })
}

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

async function insertSharedRow({ title, mood, url, durationSec }) {
  const res = await fetch(`${SUPABASE_URL}/rest/v1/music_tracks`, {
    method: 'POST',
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}`, 'Content-Type': 'application/json', Prefer: 'return=representation' },
    // workspace_id omitted → NULL → shared library.
    body: JSON.stringify({ title, mood, blob_url: url, duration_sec: durationSec ?? null }),
  })
  if (!res.ok) throw new Error(`music_tracks insert ${res.status}: ${(await res.text()).slice(0, 200)}`)
  return (await res.json())[0]
}

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN not set. Source it from .env.bernard.1pw / 1Password first.')
    process.exit(1)
  }
  if (!SUPABASE_URL || !SUPABASE_KEY) {
    console.error('SUPABASE_URL / SUPABASE_SERVICE_KEY not set. Source them from .env.bernard.1pw first.')
    process.exit(1)
  }
  const args = process.argv.slice(2)
  if (args.length < 2 || args.length % 2 !== 0) {
    console.error('Usage: node scripts/upload-music-tracks.mjs "<Title>|<mood>" <file.mp3> [ ... ]')
    process.exit(1)
  }

  const entries = []
  for (let i = 0; i < args.length; i += 2) {
    const [title, mood] = args[i].split('|').map((s) => s.trim())
    const file = args[i + 1]
    if (!title || !MOODS.includes(mood)) {
      console.error(`Bad spec "${args[i]}" — expected "<Title>|<mood>" with mood ∈ ${MOODS.join(', ')}`)
      process.exit(1)
    }
    const id = slugify(title)
    const buf = await readFile(file)
    const durationSec = await probeDuration(file)
    const { url } = await blobPut(`music/${id}.mp3`, buf, {
      access: 'public',
      contentType: 'audio/mpeg',
      addRandomSuffix: false,
      allowOverwrite: true,
    })
    const row = await insertSharedRow({ title, mood, url, durationSec })
    entries.push({ id: row?.id, title, mood, durationSec })
    console.error(`✓ uploaded + seeded shared: ${title} (${mood}, ${durationSec ?? '?'}s) → ${row?.id}`)
  }

  console.log(`\nSeeded ${entries.length} shared track(s) into public.music_tracks (workspace_id=NULL). They now appear in every workspace's music picker.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
