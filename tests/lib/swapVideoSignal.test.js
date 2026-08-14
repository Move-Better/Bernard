import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { classifyMediaChange } from '../../api/_lib/mediaOverride.js'

// The Media-tab video swap (SwapAddVideo → VideoEditor) exists to do two things:
// give producers a way to change the reel's clip, AND feed Bernard's media-
// confidence loop — which was blind to video because only photos had a swap UI.
// The second is the load-bearing half: it only works if the swap writes through
// the SAME content PATCH the photo swap uses, so the server's structural
// classifier stamps media_source:'human'. These guards pin both.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const EDITOR = read('../../src/pages/VideoEditor.jsx')
const PANEL = read('../../src/components/editor/SwapAddVideo.jsx')

const vid = (id) => ({ mediaAssetId: id, url: `https://x/${id}.mp4`, type: 'video', kind: 'video' })

describe('a reel video swap produces the human-override signal', () => {
  it('replacing the reel clip with a different one IS an override', () => {
    // The exact shape SwapAddVideo → updateItem writes: a single video entry
    // replaced by a different single video entry.
    expect(classifyMediaChange([vid('a')], [vid('b')])).toBe('human')
  })

  it('re-selecting the SAME clip is not an override', () => {
    expect(classifyMediaChange([vid('a')], [vid('a')])).toBe(undefined)
  })
})

describe('the swap is wired to feed the loop, not bypass it', () => {
  it('VideoEditor writes the swap through updateItem (the content PATCH)', () => {
    // updateItem → PATCH /api/db/content → classifyMediaChange stamps the
    // signal. A bespoke swap endpoint would silently lose it, so pin the path.
    expect(EDITOR).toContain('swapVideoMutation')
    expect(EDITOR).toMatch(/updateItem\.mutateAsync\(\{\s*id:\s*piece\.id,\s*patch:\s*\{\s*mediaUrls:\s*\[entry\]/)
  })

  it('the editor remounts on the swapped clip so edits re-hydrate cleanly', () => {
    // The restore effect is one-shot per mount; without the key the new clip
    // would inherit the old clip's trim/captions. See StoryboardPublish.
    const HOST = read('../../src/pages/StoryboardPublish.jsx')
    expect(HOST).toMatch(/key=\{videoAssetId\}[^]*VideoPieceEditor|VideoPieceEditor[^]*key=\{videoAssetId\}/)
  })

  it('the picker asks for video candidates, not photos', () => {
    // suggest-media defaults kind from the draft; an explicit video kind keeps a
    // reel from being offered stills it cannot use.
    expect(PANEL).toContain("kind: 'video'")
  })
})
