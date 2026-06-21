// Brand-styled video rendering — Phase 2 Day 7b of the 30-day video output build.
//
// Takes a source video URL + caption + workspace brand context and produces per-channel
// MP4 outputs with:
//   • Video cropped + resized to the channel's aspect ratio (cover fit, centered)
//   • Static caption band overlay (same brand SVG as photo renders)
//   • Whisper-transcribed burned-in subtitles (best-effort; skipped on failure)
//   • Lower-third with clinician name + workspace name
//
// Pipeline per channel:
//   1. Stream download source video to /tmp
//   2. If > 20MB, ffmpeg-extract audio → mp3 for Whisper (else send video directly)
//   3. Whisper-1 → SRT (best-effort; no subs if fails)
//   4. Sharp + SVG → brand overlay PNG (reuses buildBrandOverlaySvg from brandRender.js)
//   5. ffmpeg: scale+crop → overlay brand PNG → burn subtitles (if present) → H.264 MP4
//   6. Return output Buffer for caller to upload to Vercel Blob
//
// All /tmp files are cleaned up in the finally block even on failure.

import { spawn } from 'node:child_process'
import { createWriteStream } from 'node:fs'
import { writeFile as writeFileP, readFile as readFileP, unlink as unlinkP, stat as statP } from 'node:fs/promises'
import { Readable } from 'node:stream'
import { pipeline } from 'node:stream/promises'
import { randomUUID } from 'node:crypto'
import ffmpegPath from 'ffmpeg-static'
import sharp from 'sharp'
import { buildBrandOverlaySvg, resolveBrandColors } from './brandRender.js'
import { getBrandFont, ensureFontconfig } from './brandFonts.js'
import { transcribeToSrt, transcribeToWords } from './whisper.js'
import { buildKaraokeAss } from './karaokeCaptions.js'
import { gradeToFfmpeg } from './gradeParams.js'
import { reframeFilter, isNeutralReframe, buildOverlaySvg, normalizeOverlays } from './videoOverlays.js'

// Fast-path threshold: sources at/below this stream to /tmp untouched (the
// original is preserved for the render). ZV-1F 4K clips can be large.
const MAX_VIDEO_BYTES = 500 * 1024 * 1024
// Absolute ingest ceiling. Sources between MAX_VIDEO_BYTES and this are
// downscaled-on-ingest straight from the URL (the full original never lands on
// the function's ephemeral /tmp); beyond this we refuse rather than spend
// minutes transcoding a pathological upload.
const MAX_INGEST_BYTES = 4 * 1024 * 1024 * 1024 // 4GB

// Source-file deduplication: when two clips from the same source render
// concurrently on the same warm Fluid Compute instance, they share one
// downloaded /tmp file instead of writing two copies (which blows the 512MB
// /tmp budget). Key = videoUrl for the fast path (full source on disk) or
// `url:start:dur` for the large-source proxy (window-specific). Value =
// { tmpPath, downstreamStart, refCount, promise }.
const _sourceCache = new Map()

async function acquireSourceFile({ videoUrl, declaredLen, clipStart, clipDur, id }) {
  // Mirror the original branching: fast path only when size is known and ≤ threshold.
  // Unknown-size (declaredLen=0) falls through to the proxy path, same as before.
  const isLarge = !(declaredLen > 0 && declaredLen <= MAX_VIDEO_BYTES)
  const cacheKey = isLarge ? `${videoUrl}:${clipStart}:${clipDur}` : videoUrl

  if (_sourceCache.has(cacheKey)) {
    const entry = _sourceCache.get(cacheKey)
    entry.refCount++
    await entry.promise  // wait for an in-progress download on another concurrent render
    return { tmpPath: entry.tmpPath, downstreamStart: entry.downstreamStart }
  }

  const tmpPath = `/tmp/vid-in-${id}.mp4`
  const entry = {
    tmpPath,
    downstreamStart: isLarge ? 0 : clipStart,
    refCount: 1,
    promise: null,
  }

  entry.promise = (async () => {
    if (!isLarge) {
      // ORIENTATION (read before touching any render ffmpeg call): this raw copy
      // preserves the source's rotation flag — iPhone/Sony portrait capture stores
      // landscape pixels + a 90/270° displaymatrix. The downstream
      // `-filter_complex [0:v]…` render comes out upright ONLY because ffmpeg
      // auto-rotates filtergraph inputs by default. Do NOT add `-noautorotate` to
      // any render step (and do NOT route a `-c copy` source through a
      // filter_complex) without also prepending an explicit `transpose` keyed off
      // a rotation probe — otherwise small portrait clips publish sideways.
      // Verified upright across both the large (re-encode) and small (raw-copy)
      // paths on 2026-06-03; a fixtured per-channel rotation regression test is the
      // tracked follow-up before making orientation explicit here.
      const fetchRes = await fetch(videoUrl)
      if (!fetchRes.ok) throw new Error(`Source video fetch failed: ${fetchRes.status}`)
      await pipeline(Readable.fromWeb(fetchRes.body), createWriteStream(tmpPath))
    } else {
      // Probe the remote source for the first DECODABLE audio stream BEFORE the
      // downscale re-encode. ffmpeg's default stream selection picks the audio
      // track with the most channels — on an iPhone spatial-audio source that's
      // the undecodable `apac` track (4ch) over the real `aac` stereo (2ch), so a
      // bare `-c:a aac` would crash this ingest with exit 234 before the proxy is
      // ever written (same class as the render-step bug, #1208). Map video + the
      // one good audio stream explicitly (or `-an` when none decodes) so the proxy
      // the render step later probes is always clean.
      //
      // ORIENTATION: `-map 0:v:0` + simple `-vf` does NOT disable autorotation
      // (that's `-noautorotate`, which we never add) — the filtergraph input is
      // still auto-rotated, so portrait sources stay upright exactly as before.
      const ingestAudioMap = await probeUsableAudioMap(videoUrl)
      const ingestArgs = []
      if (clipStart > 0) ingestArgs.push('-ss', String(clipStart))
      ingestArgs.push(
        '-t', String(clipDur),
        '-i', videoUrl,
        '-map', '0:v:0',                                     // first video stream (then -vf applies)
        ...(ingestAudioMap ? ['-map', ingestAudioMap] : []), // the one decodable audio stream, if any
        '-vf', 'scale=w=1920:h=1920:force_original_aspect_ratio=decrease:flags=lanczos',
        '-c:v', 'libx264', '-preset', 'ultrafast', '-crf', '26',
        ...(ingestAudioMap ? ['-c:a', 'aac', '-b:a', '128k'] : ['-an']),
        '-movflags', '+faststart',
        '-y', tmpPath,
      )
      await runFfmpeg(ingestArgs)
    }
  })().catch((err) => {
    // On failure, evict the cache entry so the next attempt retries fresh.
    _sourceCache.delete(cacheKey)
    throw err
  })

  _sourceCache.set(cacheKey, entry)
  await entry.promise
  return { tmpPath, downstreamStart: entry.downstreamStart }
}

function releaseSourceFile({ videoUrl, declaredLen, clipStart, clipDur }) {
  const isLarge = !(declaredLen > 0 && declaredLen <= MAX_VIDEO_BYTES)
  const cacheKey = isLarge ? `${videoUrl}:${clipStart}:${clipDur}` : videoUrl
  const entry = _sourceCache.get(cacheKey)
  if (!entry) return
  entry.refCount--
  if (entry.refCount <= 0) {
    _sourceCache.delete(cacheKey)
    unlinkP(entry.tmpPath).catch(() => {})
  }
}
// Cap each rendered clip (and the Whisper pass) to this many seconds. Social
// video posts are short, and render cost scales with duration × channels — an
// uncapped multi-minute source blew past the 300s function budget and left
// packages stuck 'generating' (found 2026-05-29). Turning one long source into
// SEVERAL distinct clips is the follow-up feature; this cap makes single-clip
// rendering bounded and reliable today.
const MAX_RENDER_SECONDS = 60
// Long-form / "keep whole" lane: a teaching explanation runs as long as the
// idea needs — we do NOT trim it to a social norm. Its render is lighter
// (landscape, fit-not-crop), but render cost is decode-bound, so a multi-minute
// source still can't finish inside the 300s function budget on a single pass.
// This interim cap is what renders reliably TODAY; the chunked/stitched render
// (in progress) is what removes the ceiling for genuinely long pieces.
//
// Raised 120 → 240 once the three identical long-form channels were deduped to
// a SINGLE master render (renderPackageChannels.js): cutting 3 redundant
// ffmpeg+Whisper passes to 1 freed ~2/3 of the per-package budget, so one
// landscape pass can safely cover ~4 min of source inside the 300s function
// ceiling. INTERIM and conservative — validate on a real source before trusting
// the headroom; the chunked path removes this cap entirely for 30–60 min talks.
const LONGFORM_MAX_SECONDS = 240

/**
 * Channel specs for video rendering.
 * Dimensions + aspect match the photo CHANNEL_SPECS so the brand overlay SVG
 * geometry is identical — only the output format (MP4 vs JPEG) differs.
 */
export const VIDEO_CHANNEL_SPECS = {
  linkedin_video:  { width: 1080, height: 1080, aspect: '1:1',  captionPos: 'top' },
  instagram_reel:  { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  tiktok:          { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  youtube_short:   { width: 1080, height: 1920, aspect: '9:16', captionPos: 'top' },
  blog_hero_video: { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom' },
  facebook_video:  { width: 1080, height: 1350, aspect: '4:5',  captionPos: 'top' },
  // Long-form / "keep whole" channels — landscape masters for teaching content
  // that should NOT be cropped into a reel. fit:'contain' letterboxes to keep
  // the WHOLE frame (a teaching video must never crop the speaker out of frame);
  // longform:true selects the higher duration budget (LONGFORM_MAX_SECONDS).
  youtube:         { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom', fit: 'contain', longform: true },
  linkedin_native: { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom', fit: 'contain', longform: true },
  website_embed:   { width: 1920, height: 1080, aspect: '16:9', captionPos: 'bottom', fit: 'contain', longform: true },
}

/**
 * Probe a local media file for the FIRST decodable audio stream's map spec.
 *
 * Two distinct traps that `-map 0:a?` does NOT handle:
 *   1. An audio track whose codec ffmpeg classifies as `none` (no decoder) — the
 *      `?` only guards against ZERO audio streams; it still selects an
 *      undecodable one.
 *   2. A source with MULTIPLE audio streams where one is undecodable. iPhone
 *      `.mov` captures carry both a normal `aac` track AND an Apple Spatial Audio
 *      `apac` track that ffmpeg-static reports as `Audio: none` (prod 2026-06-04,
 *      IMG_4272.mov). `-map 0:a?` maps ALL audio streams, so the apac one is
 *      included and ffmpeg aborts the whole render with
 *      "Decoding requested, but no decoder found for: none" → exit 234.
 *
 * So we can't just map "all audio" or even "the first audio stream" — we must map
 * the first stream whose codec is a real decoder, by its absolute index. We parse
 * ffmpeg's input-dump stderr (`Stream #0:N ... Audio: <codec>`) and return the map
 * spec (`0:N`) for the first decodable stream, or null to render video-only.
 * Operates on the already-downloaded /tmp file — a fast header read, no network.
 *
 * @param {string} filePath — local path to probe
 * @returns {Promise<string|null>} ffmpeg map spec (e.g. "0:0") or null if no decodable audio
 */
function probeUsableAudioMap(filePath) {
  return new Promise((resolve) => {
    let proc
    try {
      proc = spawn(ffmpegPath, ['-hide_banner', '-i', filePath], {
        stdio: ['ignore', 'ignore', 'pipe'],
      })
    } catch {
      return resolve(null)
    }
    let stderr = ''
    proc.stderr.on('data', (c) => {
      stderr += c.toString('utf8')
      if (stderr.length > 64 * 1024) { try { proc.kill('SIGKILL') } catch { /* noop */ } }
    })
    const timer = setTimeout(() => { try { proc.kill('SIGKILL') } catch { /* noop */ } }, 30_000)
    const finish = () => {
      clearTimeout(timer)
      // Walk every audio stream line; return the map spec of the first decodable one.
      const matches = [...stderr.matchAll(/Stream #(\d+):(\d+)[^\n]*: Audio:\s*([A-Za-z0-9_]+)/g)]
      for (const m of matches) {
        const codec = (m[3] || '').toLowerCase()
        if (codec && codec !== 'none' && codec !== 'unknown') {
          resolve(`${m[1]}:${m[2]}`)
          return
        }
      }
      resolve(null)
    }
    proc.on('close', finish)
    proc.on('error', () => { clearTimeout(timer); resolve(null) })
  })
}

/**
 * Run ffmpeg with the given args. Resolves on exit-0, rejects with the last
 * few stderr lines on non-zero exit (ffmpeg always writes progress to stderr
 * even on success, so we don't surface stderr on clean exit).
 */
function runFfmpeg(args) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, args, { stdio: ['ignore', 'ignore', 'pipe'] })
    const stderrChunks = []
    proc.stderr.on('data', (chunk) => {
      stderrChunks.push(chunk)
      // Cap total buffered stderr at 256KB to avoid OOM on long renders
      const total = stderrChunks.reduce((s, c) => s + c.length, 0)
      if (total > 256 * 1024) stderrChunks.shift()
    })
    proc.on('close', (code) => {
      if (code === 0) {
        resolve()
      } else {
        const errText = Buffer.concat(stderrChunks).toString('utf8').trim()
        const tail = errText.split('\n').slice(-8).join('\n')
        reject(new Error(`ffmpeg exited ${code}:\n${tail}`))
      }
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
  })
}

/**
 * Render one channel's worth of a video asset.
 *
 * @param {Object} params
 * @param {string} params.videoUrl      — source video URL (Vercel Blob etc.)
 * @param {string} params.channel       — key in VIDEO_CHANNEL_SPECS
 * @param {string} params.captionText   — text shown in the caption band (optional marketing headline)
 * @param {Object} params.workspace     — workspace row (display_name, colors)
 * @param {string} params.staffName — display name for lower-third
 * @param {number} [params.startSec]    — clip start offset in the source (multi-clip v1). Default 0.
 * @param {number} [params.durationSec] — clip length in seconds; clamped to MAX_RENDER_SECONDS. Default MAX_RENDER_SECONDS.
 * @param {boolean} [params.subtitles]  — burn Whisper spoken-word captions. Default true (clip lanes).
 *                                         The keep-whole long-form lane passes false: a 30–60 min talk
 *                                         would add a Whisper pass per ~2 min piece, and captions are
 *                                         opt-in there (PR4 toggle). Brand overlay still burns regardless.
 * @param {Array<{word:string,start:number,end:number}>} [params.captionWords]
 *                                         — pre-transcribed, clip-window-relative word timestamps
 *                                         (sliced from media_assets.transcript_words). When supplied,
 *                                         the karaoke captions are built from these and the per-render
 *                                         Whisper pass is skipped entirely (migration 137 — "persist the
 *                                         words once at detection, never re-transcribe on render").
 * @param {Object} [params.grade]        — canonical AI-colorist grade params
 *                                         {exposure,contrast,saturation,warmth,tint,depth}.
 *                                         Rendered to the source frame via the ffmpeg emitter
 *                                         (gradeToFfmpeg) — the SAME schema as the photo Sharp
 *                                         grade. Neutral/absent → no filter, byte-identical output.
 * @param {Object} [params.reframe]      — static crop {zoom (%, ≥100), x, y (0..100)}. Neutral
 *                                         {100,50,50} = centered cover (legacy). Cover lanes only.
 * @param {Array}  [params.overlays]     — manual timed text overlays
 *                                         [{role,text,x,y,size,color,in,out}]. Each is a positioned
 *                                         text card shown for its [in,out] window (carousel text
 *                                         block + time). Cover + long-form lanes both supported.
 * @returns {Promise<{buffer: Buffer, width: number, height: number, channel: string, hadSubtitles: boolean, words: Array|null}>}
 */
const OVERLAY_SIZE_SCALE = { small: 0.75, medium: 1.0, large: 1.35 }

export async function renderVideoChannel({ videoUrl, channel, captionText, workspace, staffName, startSec, durationSec, subtitles = true, overlayPosition, overlaySize, captionWords, grade, reframe, overlays }) {
  const spec = VIDEO_CHANNEL_SPECS[channel]
  if (!spec) throw new Error(`Unknown video channel: ${channel}`)

  // Clip window (multi-clip v1). For a single-clip render both default to the
  // legacy behavior: start at 0, render the first MAX_RENDER_SECONDS. For a
  // proposed segment, startSec/durationSec carve one ≤60s moment out of a long
  // source via ffmpeg input seeking.
  const clipStart = Math.max(0, Number(startSec) || 0)
  // Per-lane duration budget: clips stay tight (60s, intentional); long-form
  // "keep whole" channels get the higher budget (~2 min single-pass today,
  // unbounded once chunked render lands). Length follows the content, not a norm.
  const maxDur = spec.longform ? LONGFORM_MAX_SECONDS : MAX_RENDER_SECONDS
  const clipDur = Math.min(Math.max(1, Number(durationSec) || maxDur), maxDur)

  // Initialise fontconfig before any Sharp SVG work. No-op after first call.
  await ensureFontconfig()

  const id = randomUUID()
  // tmpInput is managed by acquireSourceFile / releaseSourceFile (shared across
  // concurrent renders from the same source URL to avoid downloading the source
  // twice and blowing the 512MB /tmp budget — ENOSPC with two clips).
  const tmpAudio   = `/tmp/vid-audio-${id}.mp3`
  const tmpOverlay = `/tmp/vid-ov-${id}.png`
  const tmpSrt     = `/tmp/vid-sub-${id}.srt`
  const tmpAss     = `/tmp/vid-sub-${id}.ass`
  // Manual-overlay PNGs (one per timed overlay) — paths tracked out here so the
  // finally block can unlink them even though they're created inside the try.
  const overlayTmpPaths = []
  const tmpOutput  = `/tmp/vid-out-${id}.mp4`

  // HEAD the source once to get declared size (used for cache-key logic).
  const headRes = await fetch(videoUrl, { method: 'HEAD' }).catch(() => null)
  const declaredLen = parseInt(headRes?.headers?.get('content-length') || '0', 10)
  if (declaredLen > MAX_INGEST_BYTES) {
    throw new Error(`Source video too large: ${Math.round(declaredLen / 1e6)}MB (max ${MAX_INGEST_BYTES / 1e6}MB)`)
  }

  const { tmpPath: tmpInput, downstreamStart } = await acquireSourceFile({
    videoUrl, declaredLen, clipStart, clipDur, id,
  })

  try {
    // ── 1. Verify the source fits in /tmp ────────────────────────────────────
    const { size: actualSize } = await statP(tmpInput)
    if (actualSize > MAX_VIDEO_BYTES) {
      // Even the downscaled proxy overflowed the /tmp headroom (extremely long
      // source). Bail clearly rather than risk a disk-full render failure.
      throw new Error(`Source video too large to render: ${Math.round(actualSize / 1e6)}MB after downscale`)
    }

    // Probe for the first DECODABLE audio stream's map spec. A present-but-
    // undecodable track (iPhone .mov spatial-audio `apac` → `Audio: none`) must
    // NOT be mapped/transcoded, or ffmpeg aborts the whole render (exit 234).
    // null → no usable audio, render video-only. Drives both the Whisper extract
    // and the final map so neither touches the bad stream.
    const audioMap = await probeUsableAudioMap(tmpInput)

    // ── 2. Whisper transcription (best-effort, opt-out) ──────────────────────
    // ALWAYS extract audio to MP3 first — sidesteps the Whisper "Invalid file format"
    // error we saw in prod 2026-05-27 when sending MP4 directly. MP3 is well-tested,
    // smaller to upload, and works for any input size.
    // When subtitles=false (keep-whole long-form default) the whole pass is
    // skipped — no audio extract, no Whisper — and only the brand overlay burns.
    // No usable audio → nothing to transcribe; skip straight to the silent render.
    let hadSubtitles = false
    let useAss = false
    let karaokeWords = null
    if (Array.isArray(captionWords) && captionWords.length && subtitles) {
      // PERSISTED PATH (migration 137): the source was transcribed ONCE at
      // detection (media_assets.transcript_words); the caller sliced + rebased
      // those words to this clip window (sliceWordsToWindow) and passed them in.
      // No audio extract, no Whisper — the karaoke ASS is built from these below,
      // byte-identical to the live pass for the same words, at zero re-transcribe
      // cost. (Output audio is still mapped from the source in the final ffmpeg.)
      karaokeWords = captionWords.filter(
        (w) => w && w.word && Number.isFinite(w.start) && Number.isFinite(w.end) && w.end > w.start,
      )
      if (!karaokeWords.length) karaokeWords = null
    } else if (subtitles && audioMap) {
      try {
        const audioArgs = []
        if (downstreamStart > 0) audioArgs.push('-ss', String(downstreamStart))
        audioArgs.push(
          '-i', tmpInput,
          '-map', audioMap,               // the decodable audio stream only (skip apac/none)
          '-vn',                          // no video
          '-acodec', 'libmp3lame',
          '-ar', '16000',                 // 16kHz — Whisper-optimal sample rate
          '-ac', '1',                     // mono
          '-b:a', '32k',
          '-t', String(clipDur),          // only transcribe the rendered clip window
          '-y', tmpAudio,
        )
        await runFfmpeg(audioArgs)

        // Prefer word-level timestamps → karaoke ASS (words fill to the brand
        // accent as spoken). Fall back to segment SRT if the word pass is
        // unavailable, so captions never silently disappear.
        try {
          const words = await transcribeToWords(tmpAudio)
          if (words && words.length) karaokeWords = words
        } catch (e) {
          console.error(`[brandRenderVideo] word transcribe skip (${channel}):`, e.message)
        }
        if (!karaokeWords) {
          const srt = await transcribeToSrt(tmpAudio)
          if (srt && srt.trim()) {
            await writeFileP(tmpSrt, srt, 'utf8')
            hadSubtitles = true
          }
        }
      } catch (e) {
        // Non-fatal: continue with brand overlay only, no spoken-word captions.
        console.error(`[brandRenderVideo] whisper skip (${channel}):`, e.message)
      }
    }

    // ── 3. Build brand overlay PNG via Sharp + SVG ───────────────────────────
    // Resolve brand colors + opacity from the priority chain (see brandRender.js header)
    const { primaryColor, accentColor, captionOpacity } = resolveBrandColors(workspace)

    // Resolve brand font (workspace.brand_style.heading_font → Google Fonts → bundled Inter).
    // Embedding the font via @font-face data-URI is what fixes the garbled-text bug —
    // librsvg can't find system fonts in the Vercel function container, so the SVG
    // must carry its own font.
    const { buffer: fontBuffer } = await getBrandFont(workspace).catch(() => ({ buffer: null }))

    const effectiveCaptionPos = overlayPosition ?? spec.captionPos
    const captionSizeScale = OVERLAY_SIZE_SCALE[overlaySize] ?? 1.0

    // Karaoke ASS captions (built here because it needs the resolved accent
    // colour + caption position). Falls back to the SRT path written above if
    // the word-timestamp pass didn't produce a usable track.
    if (karaokeWords) {
      const ass = buildKaraokeAss({
        words: karaokeWords,
        width: spec.width,
        height: spec.height,
        captionPos: effectiveCaptionPos,
        accentColor,
        fontSizePx: Math.round(Math.min(spec.width, spec.height) * 0.05 * ((workspace?.brand_style?.subtitle_font_size ?? 10) / 10)),
        fontName: workspace?.brand_style?.heading_font || 'Inter',
      })
      if (ass) {
        await writeFileP(tmpAss, ass, 'utf8')
        hadSubtitles = true
        useAss = true
      }
    }

    const overlaySvg = buildBrandOverlaySvg({
      width:         spec.width,
      height:        spec.height,
      captionPos:    effectiveCaptionPos,
      captionText:   captionText || '',
      staffName: staffName || '',
      workspaceName: workspace?.display_name || '',
      primaryColor,
      accentColor,
      fontBuffer,
      captionOpacity,
      captionSizeScale,
    })
    const overlayPng = await sharp(overlaySvg).png().toBuffer()
    await writeFileP(tmpOverlay, overlayPng)

    // Manual timed overlays → one transparent full-frame PNG each. Composited
    // below the brand overlay with an enable='between(t,in,out)' time window, so
    // each card shows only during its window. Reuses the resolved brand font +
    // accent so they match the editor canvas (preview==publish).
    const normedOverlays = normalizeOverlays(overlays, clipDur)
    const overlayItems = []
    for (let i = 0; i < normedOverlays.length; i++) {
      const ov = normedOverlays[i]
      const ovSvg = buildOverlaySvg({ width: spec.width, height: spec.height, overlay: ov, accentColor, fontBuffer })
      const ovPng = await sharp(ovSvg).png().toBuffer()
      const ovPath = `/tmp/vid-ovl-${id}-${i}.png`
      await writeFileP(ovPath, ovPng)
      overlayTmpPaths.push(ovPath)
      overlayItems.push({ path: ovPath, in: ov.in, out: ov.out })
    }

    // ── 4. Build ffmpeg filter_complex ───────────────────────────────────────
    // [0:v] = source video, [1:v] = brand overlay PNG
    //
    // Scale + cover-crop to target dimensions, then composite the brand overlay.
    // The PNG was rendered at exactly spec.width × spec.height so overlay=0:0 fits perfectly.
    const W = spec.width
    const H = spec.height
    // fit:'contain' (long-form/landscape) letterboxes — scales to fit and pads,
    // preserving the WHOLE frame so a teaching video never crops the speaker
    // out. Default (clips) uses cover — scale-to-fill + crop — to fill the
    // vertical/square format edge-to-edge.
    // Cover lanes (clips) support static reframe (zoom + pan). Neutral reframe →
    // legacy centered cover, byte-identical. contain lanes (long-form) letterbox
    // the whole frame and never reframe.
    const coverFilter = (reframe && !isNeutralReframe(reframe))
      ? reframeFilter(reframe, W, H)
      : `[0:v]scale=${W}:${H}:force_original_aspect_ratio=increase:flags=lanczos,crop=${W}:${H}[scaled]`
    const scaleFilter = spec.fit === 'contain'
      ? `[0:v]scale=${W}:${H}:force_original_aspect_ratio=decrease:flags=lanczos,pad=${W}:${H}:(ow-iw)/2:(oh-ih)/2:color=black,setsar=1[scaled]`
      : coverFilter

    // AI Colorist grade — applied to the SOURCE FRAME before the brand overlay
    // (mirrors the photo path: grade the photo, then composite brand text). Same
    // canonical param schema as the Sharp photo grade; gradeToFfmpeg returns null
    // for a neutral grade so the chain is byte-identical to before when unset.
    const gradeFilter = gradeToFfmpeg(grade)
    let filterComplex = gradeFilter
      ? [
          scaleFilter,
          `[scaled]${gradeFilter}[graded]`,
          `[graded][1:v]overlay=0:0[branded]`,
        ]
      : [
          scaleFilter,
          `[scaled][1:v]overlay=0:0[branded]`,
        ]

    // Composite manual overlays on top of the branded frame; each shows only in
    // its [in,out] window. Overlay PNGs are inputs 2..(1+N) (0=video, 1=brand
    // overlay). The enable expr's commas are inside single quotes, so the
    // filtergraph parser keeps them as part of the value (same as force_style').
    let stage = '[branded]'
    overlayItems.forEach((ov, i) => {
      const next = `[ovl${i}]`
      filterComplex.push(`${stage}[${2 + i}:v]overlay=0:0:enable='between(t,${ov.in.toFixed(2)},${ov.out.toFixed(2)})'${next}`)
      stage = next
    })

    let finalOutput = stage
    if (hadSubtitles) {
      if (useAss) {
        // Karaoke ASS carries its own styling (PlayRes, font, colours, margins,
        // per-word \k timing) — no force_style needed; the .ass defines it all.
        filterComplex.push(`${stage}ass=${tmpAss}[vout]`)
      } else {
        // SRT fallback. The subtitles filter path must not contain colons (fine —
        // /tmp/vid-sub-uuid.srt has none). force_style overrides: white text, black
        // outline, positioned above the lower-third. When the caption band is at the
        // bottom (e.g. blog_hero_video) bump MarginV so the last subtitle line clears
        // the band.
        //
        // FontSize in libass scales with video height — FontSize=N at 1080px gives
        // roughly N*(1080/PlayRes) px of actual text. We normalise against 1080 so the
        // visual size stays consistent across 1:1, 9:16, and 16:9 channels. Target ≈
        // 10px ref units at 1080p; tune via workspace.brand_style.subtitle_font_size.
        const subtitleFontSize = Math.round(
          (workspace?.brand_style?.subtitle_font_size ?? 10) * (1080 / spec.height)
        )
        const marginV = effectiveCaptionPos === 'bottom' ? 220 : effectiveCaptionPos === 'center' ? 160 : 120
        filterComplex.push(
          `${stage}subtitles=${tmpSrt}:force_style='PrimaryColour=&H00FFFFFF,OutlineColour=&H00000000,BackColour=&H80000000,Bold=1,FontSize=${subtitleFontSize},Outline=1,Shadow=0,MarginV=${marginV}'[vout]`,
        )
      }
      finalOutput = '[vout]'
    }

    // ── 5. Run ffmpeg ────────────────────────────────────────────────────────
    // Input-seek to the clip window on input 0 (the video). The overlay PNG
    // (input 1) is a static image, unaffected by the seek. The subtitle SRT was
    // built from audio extracted at the same offset, so its timestamps (which
    // start at 0) align with the seeked input.
    const ffmpegArgs = []
    if (downstreamStart > 0) ffmpegArgs.push('-ss', String(downstreamStart))
    ffmpegArgs.push(
      '-i', tmpInput,
      '-i', tmpOverlay,
      ...overlayItems.flatMap((ov) => ['-i', ov.path]),  // inputs 2..(1+N): timed overlays
      '-filter_complex', filterComplex.join(';'),
      '-map', finalOutput,
    )
    // Map + transcode ONLY the first decodable audio stream. A blanket `-map 0:a?`
    // would also pull in a present-but-undecodable track (iPhone spatial-audio
    // `apac` → Audio: none) and abort the render at exit 234. When no stream is
    // decodable, render the clip silently instead of failing the whole hand-off.
    if (audioMap) {
      ffmpegArgs.push(
        '-map', audioMap,                // the one decodable audio stream
        '-c:a', 'aac',
        '-b:a', '128k',
      )
    } else {
      ffmpegArgs.push('-an')             // no usable audio — render video-only
    }
    ffmpegArgs.push(
      '-c:v', 'libx264',
      '-preset', 'fast',
      '-crf', '23',                      // perceptually lossless quality for clinic content
      '-pix_fmt', 'yuv420p',             // required for broad compatibility (LinkedIn, etc.)
      '-movflags', '+faststart',         // moov atom at start for streaming
      '-t', String(clipDur),             // cap clip length; bounds render time vs the 300s budget
      '-y',                              // overwrite if exists
      tmpOutput,
    )

    await runFfmpeg(ffmpegArgs)

    // ── 6. Read output buffer ────────────────────────────────────────────────
    // Rendered MP4 at CRF 23 is compact: ~0.5–2MB/minute at 1080p fast preset.
    const outBuffer = await readFileP(tmpOutput)
    return { buffer: outBuffer, width: W, height: H, channel, hadSubtitles, words: karaokeWords }

  } finally {
    // tmpInput is ref-counted — release (and unlink when last render is done).
    releaseSourceFile({ videoUrl, declaredLen, clipStart, clipDur })
    // Per-render scratch files are always unique — unlink immediately.
    for (const f of [tmpAudio, tmpOverlay, tmpSrt, tmpAss, tmpOutput, ...overlayTmpPaths]) {
      await unlinkP(f).catch(() => {})
    }
  }
}
