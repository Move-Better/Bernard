// Client-upload pathnames must stay inside their lane's namespace. Each
// handleUpload lane checked only startsWith(prefix), which accepts traversal
// such as `music/<ws>/../<other ws>/x` (audit 2026-11-18, P2).

import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { isPathInNamespace } from '../../api/_lib/blobPathGuard.js'

describe('isPathInNamespace', () => {
  const P = 'music/ws-a/'
  it('accepts a plain path under the prefix', () => {
    expect(isPathInNamespace('music/ws-a/1700000000-track.mp3', P)).toBe(true)
    expect(isPathInNamespace('media/edited/ws-a/x.jpg', ['media/raw/ws-a/', 'media/edited/ws-a/'])).toBe(true)
  })
  it('rejects traversal out of the namespace', () => {
    expect(isPathInNamespace('music/ws-a/../ws-b/track.mp3', P)).toBe(false)
    expect(isPathInNamespace('music/ws-a/./x', P)).toBe(false)
    expect(isPathInNamespace('music/ws-a//x', P)).toBe(false)
    expect(isPathInNamespace('music/ws-a/%2e%2e/ws-b/x', P)).toBe(false)
    expect(isPathInNamespace('music/ws-a/..\\ws-b\\x', P)).toBe(false)
  })
  it('rejects other prefixes and junk', () => {
    expect(isPathInNamespace('music/ws-b/x', P)).toBe(false)
    expect(isPathInNamespace(null, P)).toBe(false)
    expect(isPathInNamespace('music/ws-a/x', 'music/ws-a')).toBe(false) // prefix must end in /
  })
})

describe('every client-upload lane uses the guard', () => {
  const lanes = [
    'api/music/upload.js',
    'api/media/upload.js',
    'api/_routes/brand-discovery/anchor-upload.js',
    'api/_routes/brand-kit/upload.js',
    'api/_routes/seminar/upload.js',
  ]
  for (const rel of lanes) {
    it(`${rel} checks the pathname with isPathInNamespace`, () => {
      const src = readFileSync(fileURLToPath(new URL('../../' + rel, import.meta.url)), 'utf8')
      expect(src).toMatch(/isPathInNamespace\(pathname,/)
      expect(src).not.toMatch(/pathname\.startsWith\(/)
    })
  }
  it('interviews/audio pins the exact <id>.<ext> shape', () => {
    const src = readFileSync(fileURLToPath(new URL('../../api/_routes/interviews/audio.js', import.meta.url)), 'utf8')
    expect(src).not.toMatch(/pathname\.startsWith\(/)
    expect(src).toMatch(/\^interviews\/audio\/\$\{interviewId\}/)
  })
})
