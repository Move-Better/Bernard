// Website publish downloads heroImage and inline image URLs that come from the
// request body, then uploads the bytes to the workspace's WordPress site. It
// used a bare fetch() that followed redirects, so a member could point it at
// http://169.254.169.254/ (cloud metadata) or an internal host and read the
// response back out of their own WordPress media library (audit 2026-11-18,
// full). The download now goes through fetchPublic, which refuses private
// addresses on the first hop and on every redirect hop.

import { describe, it, expect, vi, afterEach } from 'vitest'
import { readFileSync } from 'node:fs'

const { fetchPublic, isPrivateIp } = await import('../../api/_lib/ssrfGuard.js')

afterEach(() => vi.unstubAllGlobals())

describe('website publish downloads through the SSRF guard', () => {
  const src = readFileSync(new URL('../../api/publish/website.js', import.meta.url), 'utf8')
  it('uploadMedia fetches the source with fetchPublic', () => {
    expect(src).toMatch(/await fetchPublic\(sourceUrl\)/)
  })
  it('has no bare fetch of the client-supplied source URL left', () => {
    expect(src).not.toMatch(/await fetch\(sourceUrl\)/)
  })
})

describe('fetchPublic', () => {
  it('refuses a cloud-metadata address without fetching it', async () => {
    const f = vi.fn()
    vi.stubGlobal('fetch', f)
    await expect(fetchPublic('http://169.254.169.254/latest/meta-data/')).rejects.toThrow(/not allowed/)
    expect(f).not.toHaveBeenCalled()
  })

  it('refuses a public URL that redirects to a private address', async () => {
    const f = vi.fn(async () => new Response(null, { status: 302, headers: { location: 'http://10.0.0.5/secret' } }))
    vi.stubGlobal('fetch', f)
    await expect(fetchPublic('https://93.184.216.34/photo.jpg')).rejects.toThrow(/not allowed/)
    expect(f).toHaveBeenCalledTimes(1)
    expect(f.mock.calls[0][1].redirect).toBe('manual')
  })

  it('follows a redirect to another public address and returns the final response', async () => {
    const f = vi.fn()
      .mockResolvedValueOnce(new Response(null, { status: 301, headers: { location: 'https://93.184.216.35/final.jpg' } }))
      .mockResolvedValueOnce(new Response('bytes', { status: 200 }))
    vi.stubGlobal('fetch', f)
    const r = await fetchPublic('https://93.184.216.34/photo.jpg')
    expect(await r.text()).toBe('bytes')
    expect(f.mock.calls[1][0]).toBe('https://93.184.216.35/final.jpg')
  })

  it('refuses non-http schemes', async () => {
    vi.stubGlobal('fetch', vi.fn())
    await expect(fetchPublic('file:///etc/passwd')).rejects.toThrow(/not allowed/)
  })

  it('classifies the ranges it must block', () => {
    for (const ip of ['10.1.2.3', '127.0.0.1', '169.254.169.254', '172.16.0.1', '192.168.1.1', '100.64.0.1', '::1', '::ffff:127.0.0.1', 'fd00::1', 'fe80::1']) {
      expect(isPrivateIp(ip), ip).toBe(true)
    }
    expect(isPrivateIp('93.184.216.34')).toBe(false)
  })
})
