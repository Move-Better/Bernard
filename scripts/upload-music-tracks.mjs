#!/usr/bin/env node
// Upload curated licensed music tracks to the bernard-prod Vercel Blob and print
// the manifest entries to paste into api/_lib/musicLibrary.js (WS3.3).
//
// Usage (from the Bernard project root, with BLOB_READ_WRITE_TOKEN in env):
//   node scripts/upload-music-tracks.mjs "Open Road|upbeat" ~/Downloads/open-road.mp3 \
//                                         "Slow Morning|calm" ~/Downloads/slow-morning.mp3
//
// Each pair is:  "<Title>|<mood>"  <path-to-mp3>
//   mood ∈ { calm, upbeat, warm, cinematic }
//
// The tracks must be royalty-free with a redistribution-OK license (Pixabay
// Music is the chosen source: commercial use OK, no attribution required). Do
// NOT upload anything you don't have the right to host + let tenants publish over.
//
// After running, paste the printed entries into MUSIC_TRACKS in
// api/_lib/musicLibrary.js and commit.

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

async function main() {
  if (!process.env.BLOB_READ_WRITE_TOKEN) {
    console.error('BLOB_READ_WRITE_TOKEN not set. Source it from .env.bernard.1pw / 1Password first.')
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
    entries.push({ id, title, mood, url, durationSec })
    console.error(`✓ uploaded ${title} (${mood}, ${durationSec ?? '?'}s)`)
  }

  console.log('\n// Paste into MUSIC_TRACKS in api/_lib/musicLibrary.js:')
  for (const e of entries) {
    console.log(`  { id: '${e.id}', title: ${JSON.stringify(e.title)}, mood: '${e.mood}', url: '${e.url}', durationSec: ${e.durationSec ?? 0} },`)
  }
}

main().catch((e) => { console.error(e); process.exit(1) })
