// Web version of a video for the movebetter.co website
// (docs/media-library-plan.md, phase 4; Q chose "Bernard makes an MP4",
// 2026-11-14). Made only when the website session asks for a specific video.
//
// Output: a 1080-class H.264/AAC MP4 with faststart (plays in a plain <video>
// tag everywhere) plus a JPEG poster, both public Blob files next to the
// original. Stored on the row as web_blob_url / web_width / web_height (the
// same columns photos use for their web variant; nothing reads them for video)
// and thumbnail_url when the row has no poster yet.
//
// Not unit-tested beyond the pure helpers: real fetch, real ffmpeg, real Blob
// upload, like videoRenderProxy.js. Verified live against prod assets.

import { put as blobPut } from '@vercel/blob'
import { readFile, stat, unlink, mkdtemp, rm } from 'node:fs/promises'
import { createWriteStream } from 'node:fs'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'
import { probeUsableAudioMap, runFfmpeg } from './brandRenderVideo.js'
import { supabaseRest } from './supabaseRest.js'

// The function's whole budget is 300s (download + encode + upload). A 1080p
// veryfast encode runs roughly 2-4x realtime on a function, so cap the source.
export const MAX_WEB_VIDEO_SECONDS = 600

export function webVideoStatus(asset) {
  if (!asset || asset.kind !== 'video') return 'not_video'
  if (asset.web_blob_url) return 'ready'
  if (Number(asset.duration_s) > MAX_WEB_VIDEO_SECONDS) return 'too_long'
  return 'needs_encode'
}

export function webVideoArgs({ inPath, outPath, audioMap }) {
  return [
    '-i', inPath,
    '-map', '0:v:0',
    ...(audioMap ? ['-map', audioMap] : []),
    '-vf', 'scale=w=1920:h=1920:force_original_aspect_ratio=decrease:flags=lanczos,format=yuv420p',
    '-c:v', 'libx264', '-preset', 'veryfast', '-crf', '24',
    '-maxrate', '5M', '-bufsize', '10M', '-profile:v', 'high',
    ...(audioMap ? ['-c:a', 'aac', '-b:a', '128k', '-ac', '2'] : ['-an']),
    '-movflags', '+faststart',
    '-y', outPath,
  ]
}

function probeSize(path) {
  return new Promise((resolve) => {
    const proc = spawn(ffmpegPath, ['-hide_banner', '-i', path], { stdio: ['ignore', 'ignore', 'pipe'] })
    let err = ''
    proc.stderr.on('data', (c) => { err += c.toString('utf8') })
    proc.on('close', () => {
      const m = err.match(/Video:[^\n]*?(\d{2,5})x(\d{2,5})/)
      resolve(m ? { width: Number(m[1]), height: Number(m[2]) } : { width: null, height: null })
    })
    proc.on('error', () => resolve({ width: null, height: null }))
  })
}

// Encode, upload, and record the web version. Returns the updated fields.
export async function makeWebVideo({ asset, ws }) {
  const dir = await mkdtemp(join(tmpdir(), 'webvideo-'))
  const inPath = join(dir, 'in.bin')
  const outPath = join(dir, 'web.mp4')
  const posterPath = join(dir, 'poster.jpg')
  try {
    const r = await fetch(asset.blob_url)
    if (!r.ok) throw new Error(`download failed: ${r.status}`)
    await pipeline(Readable.fromWeb(r.body), createWriteStream(inPath))

    const audioMap = await probeUsableAudioMap(inPath)
    await runFfmpeg(webVideoArgs({ inPath, outPath, audioMap }))
    await unlink(inPath).catch(() => {})
    const { width, height } = await probeSize(outPath)
    const seek = Math.min(1, Math.max(0, (Number(asset.duration_s) || 2) / 2))
    await runFfmpeg(['-ss', String(seek), '-i', outPath, '-frames:v', '1', '-vf', 'scale=w=1280:h=1280:force_original_aspect_ratio=decrease', '-q:v', '3', '-y', posterPath])

    // ws.id, never ws.slug, for blob keys.
    const base = `media/web-video/${ws.id}/${asset.id}`
    const video = await blobPut(`${base}.mp4`, await readFile(outPath), {
      access: 'public', contentType: 'video/mp4', addRandomSuffix: false, allowOverwrite: true,
    })
    const poster = await blobPut(`${base}-poster.jpg`, await readFile(posterPath), {
      access: 'public', contentType: 'image/jpeg', addRandomSuffix: false, allowOverwrite: true,
    })
    const { size } = await stat(outPath)

    const patch = { web_blob_url: video.url, web_width: width, web_height: height }
    if (!asset.thumbnail_url) patch.thumbnail_url = poster.url
    const p = await supabaseRest(`media_assets?id=eq.${asset.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH', body: JSON.stringify(patch),
    }, { contentType: 'application/json', prefer: 'return=minimal' })
    if (!p.ok) throw new Error(`patch failed: ${p.status}`)
    return { ...patch, poster_url: poster.url, size_bytes: size }
  } finally {
    await rm(dir, { recursive: true, force: true }).catch(() => {})
  }
}
