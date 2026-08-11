// Persistent, whole-asset render proxy for large (>MAX_VIDEO_BYTES) video
// sources — the throughput half of the 2026-08-11 reel-render fix (the two
// timeout fixes made rendering WORK; this makes it cheap). See
// .claude/decisions.md 2026-08-10/11 and api/_routes/cron/auto-reel-week.js.
//
// The problem: every reel render re-downloads and re-decodes the FULL source
// master to extract one ~15-30s window, and a single source can hold several
// detected moments (P1107562.MP4 has 7) — so a 4K master's decode cost is
// paid once PER SEGMENT, not once per asset. Measured 2026-08-10: ~68s wall /
// 130s CPU for the windowed 4K-to-1080 ingest alone.
//
// The fix: generate a 1080-class re-encode of the ENTIRE asset once, persist
// it (media_assets.render_proxy_url, migration 210), and have every render
// use that instead of the original — small enough that acquireSourceFile's
// own fast path (a raw copy, no re-encode) picks it up automatically. First
// render of a never-proxied asset still pays the full decode (generating the
// proxy IS that decode); every later render of ANY segment from that asset,
// by ANY caller, is fast from then on.
//
// SCOPE (deliberate — do not read this as "every video render call site"):
// wired into exactly one shared function, renderSegmentToReel() in
// reelFactory.js, called by both the auto cron (auto-reel-week) and the
// manual trigger (api/editorial/render-segments.js) — the two callers this
// was actually measured against tonight. Ad export (api/ads/render-video.js),
// longform chunked rendering (longformEngine.js), multi-channel package
// rendering (renderPackageChannels.js), and the manual multi-channel clip
// export (renderClipCore.js) are NOT wired in — different render shapes,
// not part of tonight's diagnosis, and not confirmed to have the same cost
// pattern. Candidates for the same treatment later if they show it.

import { MAX_VIDEO_BYTES, transcodeRemoteToLocal } from './brandRenderVideo.js'
import { put as blobPut } from '@vercel/blob'
import { unlink as unlinkP } from 'node:fs/promises'
import { randomUUID } from 'node:crypto'
import { supabaseRest } from './supabaseRest.js'

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

/**
 * PURE: does this asset need a persisted render proxy? Mirrors
 * acquireSourceFile's own large/fast-path predicate — MAX_VIDEO_BYTES is a
 * single shared constant so the two can never disagree about what "large"
 * means. False for anything that already has a proxy (nothing to generate)
 * or that isn't a large video in the first place (a proxy would just be a
 * second copy of an already-small file — no benefit, real cost).
 */
export function shouldGenerateRenderProxy(asset) {
  if (!asset || asset.kind !== 'video') return false
  if (asset.render_proxy_url) return false
  const size = Number(asset.size_bytes) || 0
  // Mirrors acquireSourceFile's isLarge exactly: unknown size (0) also counts
  // as large, since acquireSourceFile would take the large branch for it too.
  return !(size > 0 && size <= MAX_VIDEO_BYTES)
}

/**
 * PURE: the URL a render should actually fetch from — the persisted proxy
 * when one exists, else the original. Every render call site that wants this
 * optimization calls this instead of reading `asset.blob_url` directly.
 */
export function resolveRenderSourceUrl(asset) {
  return asset?.render_proxy_url || asset?.blob_url || null
}

/**
 * Ensure a large asset has a persisted render proxy, generating one if
 * needed, and return the URL a render should use (proxy or original).
 *
 * Not unit-tested — real network fetch, real ffmpeg, real Blob upload, same
 * class as acquireSourceFile/renderVideoChannel in brandRenderVideo.js, which
 * carry no test file either. Verified live against real prod assets instead
 * (see the PR description for the before/after measurement).
 *
 * Best-effort: on any failure, logs and returns the ORIGINAL url so the
 * caller's render still proceeds exactly as it did before this existed — a
 * proxy-generation failure must never be why a reel didn't get made.
 *
 * CONCURRENCY: no claim/lock around generation. api/editorial/render-segments.js
 * renders up to 3 segments concurrently, so two workers can both see
 * `!asset.render_proxy_url` for the same asset and both generate — worst case
 * is duplicate wasted compute and a last-write-wins on the DB patch, never
 * corruption (each writes its own /tmp path; the Blob PUT is per-object
 * atomic). Accepted rather than built around: the failure mode is cost, not
 * correctness, and this is the same class of race the segment-claiming code
 * already tolerates elsewhere in this file.
 */
export async function ensureRenderProxy({ asset, ws }) {
  if (!shouldGenerateRenderProxy(asset)) return resolveRenderSourceUrl(asset)

  const id = randomUUID()
  const tmpPath = `/tmp/render-proxy-${id}.mp4`
  try {
    // No clipStart/clipDur — transcode the WHOLE asset. A persisted proxy has
    // to serve every future segment's window, not just the one that happens
    // to trigger generation.
    await transcodeRemoteToLocal({ videoUrl: asset.blob_url, outPath: tmpPath })

    const { readFile, stat } = await import('node:fs/promises')
    const buffer = await readFile(tmpPath)
    const { size } = await stat(tmpPath)

    // Use ws.id (immutable), not ws.slug — same blob-namespacing rule as
    // every other media path in this codebase.
    const pathname = `media/proxy/${ws.id}/${asset.id}.mp4`
    const blob = await blobPut(pathname, buffer, {
      access: 'public',
      contentType: 'video/mp4',
      addRandomSuffix: false,
      allowOverwrite: true,
    })

    const patchRes = await sb(`media_assets?id=eq.${asset.id}&workspace_id=eq.${ws.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({
        render_proxy_url: blob.url,
        render_proxy_bytes: size,
        render_proxy_generated_at: new Date().toISOString(),
      }),
    })
    if (!patchRes.ok) {
      // The proxy file exists in Blob but didn't get recorded — the NEXT
      // render will just regenerate it (shouldGenerateRenderProxy still sees
      // no render_proxy_url) rather than ever using a half-persisted state.
      console.error('[videoRenderProxy] proxy generated but DB patch failed:', patchRes.status)
      return blob.url
    }
    return blob.url
  } catch (e) {
    console.error('[videoRenderProxy] proxy generation failed, using original:', e?.stack || e?.message)
    return asset.blob_url
  } finally {
    unlinkP(tmpPath).catch(() => {})
  }
}
