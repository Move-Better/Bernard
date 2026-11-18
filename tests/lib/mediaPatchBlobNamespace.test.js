// PATCH /api/media/:id accepted thumbnailUrl and renderedUrl from any editor
// with no check on where they point. Both are later handed to Vercel Blob
// del(): the old thumbnail on a rotate / replace-master (thumbnail.js), the
// render on purge. The Blob store is shared by every tenant, so an editor in
// workspace A could store workspace B's public blob URL on their own asset and
// then trigger its deletion (audit 2026-11-18, full). No client sends either
// field today; the server writes them directly. The PATCH now accepts only a
// Blob URL inside the caller's own workspace namespace (or null).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { isWorkspaceBlobUrl } from '../../api/_lib/blobNamespace.js'

const WS = '11111111-1111-4111-8111-111111111111'
const OTHER = '22222222-2222-4222-8222-222222222222'
const HOST = 'https://abc123.public.blob.vercel-storage.com'

describe('isWorkspaceBlobUrl', () => {
  it('accepts a blob in this workspace namespace', () => {
    expect(isWorkspaceBlobUrl(`${HOST}/media/thumbs/${WS}/asset.jpg`, WS)).toBe(true)
    expect(isWorkspaceBlobUrl(`${HOST}/voice/pre-visit/${WS}/x.mp3`, WS)).toBe(true)
  })

  it('refuses another workspace blob', () => {
    expect(isWorkspaceBlobUrl(`${HOST}/media/thumbs/${OTHER}/asset.jpg`, WS)).toBe(false)
  })

  it('refuses path traversal out of the namespace', () => {
    expect(isWorkspaceBlobUrl(`${HOST}/media/thumbs/${WS}/%2e%2e/${OTHER}/a.jpg`, WS)).toBe(false)
    expect(isWorkspaceBlobUrl(`${HOST}/media/thumbs/${WS}/..%2f${OTHER}/a.jpg`, WS)).toBe(false)
  })

  it('refuses a non-blob host even with the workspace id in the path', () => {
    expect(isWorkspaceBlobUrl(`https://evil.example/${WS}/a.jpg`, WS)).toBe(false)
    expect(isWorkspaceBlobUrl(`http://abc123.public.blob.vercel-storage.com/media/${WS}/a.jpg`, WS)).toBe(false)
  })

  it('refuses garbage and a missing workspace id', () => {
    expect(isWorkspaceBlobUrl('not a url', WS)).toBe(false)
    expect(isWorkspaceBlobUrl(`${HOST}/media/thumbs/${WS}/a.jpg`, '')).toBe(false)
  })
})

describe('PATCH /api/media/:id checks the two URLs that later reach blob del()', () => {
  const src = readFileSync(new URL('../../api/_routes/media/[id].js', import.meta.url), 'utf8')
  it('validates thumbnailUrl and renderedUrl against the workspace namespace', () => {
    expect(src.match(/isWorkspaceBlobUrl\(patch\.(thumbnailUrl|renderedUrl), scope\.id\)/g)?.length).toBe(2)
  })
})
