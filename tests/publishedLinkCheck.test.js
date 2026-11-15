import { describe, it, expect, vi } from 'vitest'

vi.mock('../api/_lib/notifyAdmin.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../api/_lib/agentActions.js', () => ({ recordAgentAction: vi.fn() }))
vi.mock('../api/_lib/workspaceOwner.js', () => ({ alertRecipientEmails: vi.fn() }))

const { checkPublishedUrl, canonicalUrl } = await import('../api/_lib/publishedLinkCheck.js')
const { runPublishedLinkCheck, brokenLinksEmail } = await import('../api/_routes/cron/check-published-links.js')

const answering = (...codes) => { let i = 0; return vi.fn(async () => ({ status: codes[Math.min(i++, codes.length - 1)] })) }
const noSleep = async () => {}

describe('checkPublishedUrl', () => {
  it('a page that loads is reachable on the first try', async () => {
    const f = answering(200)
    expect((await checkPublishedUrl('https://x.co/a', { fetchImpl: f, sleep: noSleep })).ok).toBe(true)
    expect(f).toHaveBeenCalledTimes(1)
  })
  it('a blip that recovers on the retry is not an alarm', async () => {
    const f = answering(503, 200)
    expect((await checkPublishedUrl('https://x.co/a', { fetchImpl: f, sleep: noSleep })).ok).toBe(true)
  })
  it('a page missing twice is broken, with the status in the reason', async () => {
    const r = await checkPublishedUrl('https://x.co/a', { fetchImpl: answering(404), sleep: noSleep })
    expect(r).toMatchObject({ ok: false, status: 404, reason: 'answered 404' })
  })
  it('a host that cannot be reached is broken', async () => {
    const f = vi.fn(async () => { throw new TypeError('fetch failed') })
    expect(await checkPublishedUrl('https://gone.example/a', { fetchImpl: f, sleep: noSleep })).toMatchObject({ ok: false, status: null, reason: 'could not be reached' })
  })
  it('a bot challenge is "can not check", never broken', async () => {
    const f = vi.fn(async () => ({ status: 403, headers: new Headers({ 'cf-mitigated': 'challenge' }) }))
    expect(await checkPublishedUrl('https://x.co/a', { fetchImpl: f, sleep: noSleep })).toMatchObject({ ok: true, unverifiable: true })
  })
  it('a plain 403 is still broken', async () => {
    const f = vi.fn(async () => ({ status: 403, headers: new Headers() }))
    expect((await checkPublishedUrl('https://x.co/a', { fetchImpl: f, sleep: noSleep })).ok).toBe(false)
  })
  it('tracking parameters are dropped before loading', () => {
    expect(canonicalUrl('https://x.co/a?utm_source=x&utm_medium=y&id=3')).toBe('https://x.co/a?id=3')
  })
})

describe('the daily run', () => {
  const posts = [
    { id: 'p1', workspace_id: 'w1', topic: 'Good', resolved_url: 'https://a.co/good' },
    { id: 'p2', workspace_id: 'w1', topic: 'Gone', resolved_url: 'https://a.co/gone' },
    { id: 'p3', workspace_id: 'w2', topic: 'Other', resolved_url: 'https://b.co/fine' },
  ]
  const check = async (url) => (url.endsWith('gone') ? { ok: false, status: 404, reason: 'answered 404' } : { ok: true, status: 200 })

  it('emails only the workspace whose post is broken, and records it', async () => {
    const send = vi.fn(); const record = vi.fn(); const listWorkspaces = vi.fn(async (ids) => ids.map((id) => ({ id, display_name: id })))
    const s = await runPublishedLinkCheck({ listPosts: async () => posts, listWorkspaces, check, record, recipients: async () => ['owner@x.co'], send })
    expect(s).toMatchObject({ checked: 3, broken: 1, workspacesAlerted: 1 })
    expect(listWorkspaces).toHaveBeenCalledWith(['w1'])
    expect(send).toHaveBeenCalledTimes(1)
    expect(send.mock.calls[0][0].text).toContain('https://a.co/gone')
    expect(send.mock.calls[0][0].text).not.toContain('https://a.co/good')
    expect(record.mock.calls[0][0]).toMatchObject({ workspaceId: 'w1', kind: 'published_link_broken' })
  })

  it('sends nothing when every post opens', async () => {
    const send = vi.fn()
    const s = await runPublishedLinkCheck({ listPosts: async () => posts.filter((p) => p.id !== 'p2'), check, send, listWorkspaces: vi.fn() })
    expect(s.broken).toBe(0)
    expect(send).not.toHaveBeenCalled()
  })

  it('the email names the post and why', () => {
    const e = brokenLinksEmail({ wsName: 'Move Better', broken: [{ topic: 'Disc pain', url: 'https://a.co/x', reason: 'answered 404' }] })
    expect(e.subject).toContain('1 published post can')
    expect(e.text).toContain('Disc pain: https://a.co/x (answered 404)')
  })
})
