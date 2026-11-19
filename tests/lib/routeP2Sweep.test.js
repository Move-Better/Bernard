// Four route defects from the 2026-11-18 full audit (P2), each driven through
// the real code with fetch faked:
//  - db/content PATCH on an id that matches no row answered 200 with no body;
//  - publish-blog wrote pubDate/updatedDate into YAML unquoted, and yamlQuote
//    let a raw newline through, so caller text could inject frontmatter keys;
//  - the WordPress slug-collision check failed open on a non-auth error, so
//    WordPress auto-suffixed the slug and the post went live at the wrong URL;
//  - the long-form chunk 'done' write was unchecked, so a failed write left
//    the piece 'rendering' until the cron net noticed the stall.

import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest'

vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceContext: async () => ({ id: 'ws-a', slug: 'a', clerk_org_id: 'org_a' }),
  workspaceById: async () => ({ id: 'ws-a', slug: 'a' }),
}))
vi.mock('../../api/_lib/auth.js', () => ({
  requireRole: async () => ({ ok: true, userId: 'user_1', role: 'admin', isOrgAdmin: true }),
  requireCapability: async () => ({ ok: true }),
}))
vi.mock('../../api/_lib/ratelimit.js', () => ({ enforceLimit: async () => true }))
vi.mock('../../api/_lib/brandRenderVideo.js', () => ({
  renderVideoChannel: async () => ({ buffer: Buffer.from('mp4'), width: 1920, height: 1080, hadSubtitles: false }),
}))
vi.mock('@vercel/blob', () => ({
  put: async (p) => ({ url: `https://blob.test/${p}` }),
  del: async () => {},
}))

const { default: content } = await import('../../api/_routes/db/content.js')
const { buildMarkdownFile, YAML_DATE_RE } = await import('../../api/_routes/publish-blog.js')
const { publishToWordPress } = await import('../../api/publish/website.js')
const { runChunkPass } = await import('../../api/_lib/longformEngine.js')

function res() {
  const r = { statusCode: 0, body: null }
  r.status = (c) => { r.statusCode = c; return r }
  r.json = (b) => { r.body = b; return r }
  r.setHeader = () => r
  return r
}
const json = (b, status = 200) => new Response(JSON.stringify(b), { status })

beforeEach(() => {
  for (const m of ['error', 'info', 'warn', 'log']) vi.spyOn(console, m).mockImplementation(() => {})
})
afterEach(() => vi.unstubAllGlobals())

describe('db/content PATCH', () => {
  it('answers 404 when the id matches no row in this workspace', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json([])))
    const r = res()
    const id = '44444444-4444-4444-8444-444444444444'
    await content({ method: 'PATCH', url: `/api/db/content?id=${id}`, headers: {}, body: { content: 'x' } }, r)
    expect(r.statusCode).toBe(404)
  })
})

describe('publish-blog frontmatter', () => {
  const base = { title: 't', description: 'd', pubDate: '2026-11-19', markdown: 'body' }

  it('accepts the date shapes callers send', () => {
    for (const v of ['2026-11-19', '2026-11-19T17:05:52.037Z', '2026-11-19T10:00:00.123456+00:00']) {
      expect(YAML_DATE_RE.test(v), v).toBe(true)
    }
  })

  it('refuses a pubDate that would inject a frontmatter key', () => {
    expect(() => buildMarkdownFile({ ...base, pubDate: '2026-11-19\ndraft: true' })).toThrow(/pubDate/)
    expect(() => buildMarkdownFile({ ...base, updatedDate: 'soon' })).toThrow(/updatedDate/)
  })

  it('keeps a newline in a quoted field inside its quotes', () => {
    const out = buildMarkdownFile({ ...base, title: 'line one\ndraft: true' })
    const fm = out.split('---')[1]
    expect(fm).not.toMatch(/^draft: true$/m)
    expect(fm).toContain('title: "line one\\ndraft: true"')
  })
})

describe('WordPress slug collision check', () => {
  it('fails closed when the check itself errors, instead of publishing', async () => {
    const calls = []
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      calls.push(`${init.method || 'GET'} ${url}`)
      return new Response('boom', { status: 500 })
    }))
    const r = res()
    await publishToWordPress(r, { slug: 's', title: 't', markdown: 'm' }, {
      secret: 'pw', config: { user: 'u', site_url: 'https://wp.test/wp-json/wp/v2/posts' },
    })
    expect(r.statusCode).toBe(502)
    expect(calls.filter((c) => c.startsWith('POST'))).toEqual([])
  })
})

describe('long-form chunk render', () => {
  it('re-queues a piece whose done write fails instead of leaving it rendering', async () => {
    const chunk = { id: 'c1', idx: 0, start_sec: 0, dur_sec: 60, status: 'pending', attempts: 0 }
    vi.stubGlobal('fetch', vi.fn(async (url, init = {}) => {
      const u = new URL(String(url), 'http://test.local')
      const table = u.pathname.split('/').pop()
      const method = init.method || 'GET'
      const body = init.body ? JSON.parse(init.body) : null
      if (table === 'story_packages') {
        return json([{ id: 'p1', workspace_id: 'ws-a', status: 'generating', source_asset_id: 'a1', channels: ['youtube'] }])
      }
      if (table === 'media_assets') return json([{ blob_url: 'https://blob.test/src.mp4' }])
      if (table !== 'story_package_chunks') return json([])
      const want = u.searchParams.get('status')
      if (method === 'GET') return json(!want || want === `eq.${chunk.status}` ? [{ ...chunk }] : [])
      if (want && want !== `eq.${chunk.status}`) return json([])
      if (body.status === 'done') return new Response('db down', { status: 503 })
      Object.assign(chunk, body)
      return json([{ ...chunk }])
    }))
    await runChunkPass({ packageId: 'p1', baseUrl: null })
    expect(chunk.status).not.toBe('rendering')
    expect(chunk.attempts).toBeGreaterThan(1)
  })
})
