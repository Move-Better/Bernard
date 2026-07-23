import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'

// GUARD — every path that inserts a video media_assets row must generate a
// poster frame.
//
// A video row with thumbnail_url null renders as a BLANK BOX in the Library
// grid, the MediaPicker and the editor's attached-media tile. Nothing errors;
// the clip is just invisible to the eye and effectively unfindable.
//
// The upload path (recordUploadedAsset.js) has always called
// generateAndPersistThumbnail. Both DERIVED-clip paths — saveBroll.js and
// exportClipEngine.js — never did, so every clip saved to the library from
// Moments was born blank and stayed blank. 15 of 478 videos on the movebetter
// workspace, clustered at the top of the picker because it sorts newest-first.
//
// It hid because a route-by-route audit doesn't reach a shared helper: the
// insert lives in api/_lib/saveBroll.js, which no route's own source mentions
// near a media_assets POST. This test greps for the INSERT instead, so a new
// insert site is caught wherever it lives.

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects",
// and .pathname percent-encodes the space into %20, which readdirSync ENOENTs.
const API_DIR = fileURLToPath(new URL('../../api/', import.meta.url))
// Either generator counts. `generateAndPersistThumbnail` downloads from
// blob_url (the usual case); `generateThumbnailFromPath` reuses a file already
// on local disk, which media/[id]/edit.js does after re-encoding a rotated
// video — same poster, one fewer download.
const THUMB_FNS = ['generateAndPersistThumbnail', 'generateThumbnailFromPath']

function walk(dir, out = []) {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name)
    if (statSync(full).isDirectory()) walk(full, out)
    else if (name.endsWith('.js')) out.push(full)
  }
  return out
}

// A file "inserts a video asset" if it POSTs to media_assets and mentions the
// video kind. Deliberately loose — a false positive costs one added import,
// a false negative costs another invisible-library bug.
function insertsVideoAsset(src) {
  const posts = /sb\(\s*['"`]media_assets['"`]\s*,\s*\{[\s\S]{0,200}?method:\s*['"`]POST['"`]/.test(src)
  const video = /kind:\s*['"`]video['"`]/.test(src) || /kind\s*===\s*['"`]video['"`]/.test(src)
  return posts && video
}

describe('video media_assets inserts generate a thumbnail', () => {
  const files = walk(API_DIR)
  const inserters = files
    .filter((f) => insertsVideoAsset(readFileSync(f, 'utf8')))
    .map((f) => relative(API_DIR, f))

  it('finds the known video-insert sites', () => {
    // If this drops to 0 the regexes have rotted and the real assertion below
    // would vacuously pass — the exact way a guard silently stops guarding.
    expect(inserters.length).toBeGreaterThan(0)
    expect(inserters).toContain('_lib/saveBroll.js')
    expect(inserters).toContain('_lib/exportClipEngine.js')
  })

  it.each(
    walk(API_DIR)
      .filter((f) => insertsVideoAsset(readFileSync(f, 'utf8')))
      .map((f) => [relative(API_DIR, f), f]),
  )('%s generates a poster frame', (rel, full) => {
    const src = readFileSync(full, 'utf8')
    // If this fails: import generateAndPersistThumbnail from _lib/thumbnail.js
    // and call it after blob_url is set — waitUntil(...) from a request
    // handler, plain await from a worker. Do NOT delete this assertion; a
    // missing poster is invisible in every automated check except this one.
    // `fn(` — an actual CALL, not a bare mention. A plain src.includes(fn)
    // is satisfied by the function name appearing in a comment, which is
    // exactly the kind of hollow pass that lets a guard stop guarding.
    const calls = THUMB_FNS.filter((fn) => src.includes(`${fn}(`))
    expect(calls, `${rel} inserts a video asset but calls neither ${THUMB_FNS.join(' nor ')}`)
      .not.toEqual([])
  })
})
