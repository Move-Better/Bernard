import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest'
import { addProjectDomain, VercelDomainError } from '../../api/_lib/vercelDomains.js'

const PROJECT_ID = 'prj_test'
const TEAM_ID = 'team_test'

function jsonResponse(status, body) {
  return {
    ok: status >= 200 && status < 300,
    status,
    json: async () => body,
  }
}

function errorResponse(status, code, message = 'err') {
  return jsonResponse(status, { error: { code, message } })
}

describe('addProjectDomain', () => {
  let fetchMock

  beforeEach(() => {
    process.env.VERCEL_TOKEN = 'tok'
    process.env.VERCEL_PROJECT_ID = PROJECT_ID
    process.env.VERCEL_TEAM_ID = TEAM_ID
    fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)
  })

  afterEach(() => {
    vi.unstubAllGlobals()
    delete process.env.VERCEL_TOKEN
    delete process.env.VERCEL_PROJECT_ID
    delete process.env.VERCEL_TEAM_ID
  })

  it('returns { added: true } on 200 OK', async () => {
    fetchMock.mockResolvedValueOnce(jsonResponse(200, { name: 'studio.withbernard.ai' }))
    const r = await addProjectDomain('studio.withbernard.ai')
    expect(r).toEqual({ added: true, name: 'studio.withbernard.ai' })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats domain_already_in_use_by_project as success without inspecting', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use_by_project'))
    const r = await addProjectDomain('studio.withbernard.ai')
    expect(r).toEqual({ added: false, name: 'studio.withbernard.ai', alreadyAttached: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('treats domain_already_exists as success without inspecting', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(409, 'domain_already_exists'))
    const r = await addProjectDomain('studio.withbernard.ai')
    expect(r).toEqual({ added: false, name: 'studio.withbernard.ai', alreadyAttached: true })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })

  it('domain_already_in_use + inspect shows OUR project → success', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use'))
      .mockResolvedValueOnce(jsonResponse(200, { projects: [PROJECT_ID] }))
    const r = await addProjectDomain('studio.withbernard.ai')
    expect(r).toEqual({ added: false, name: 'studio.withbernard.ai', alreadyAttached: true })
    expect(fetchMock).toHaveBeenCalledTimes(2)
  })

  it('domain_already_in_use + nested envelope shape → success', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use'))
      .mockResolvedValueOnce(jsonResponse(200, { domain: { projects: [{ id: PROJECT_ID }] } }))
    const r = await addProjectDomain('studio.withbernard.ai')
    expect(r.alreadyAttached).toBe(true)
  })

  it('domain_already_in_use + inspect shows DIFFERENT project → throws', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use', 'in use by other'))
      .mockResolvedValueOnce(jsonResponse(200, { projects: ['prj_other'] }))
    await expect(addProjectDomain('studio.withbernard.ai')).rejects.toBeInstanceOf(VercelDomainError)
  })

  it('domain_already_in_use + inspect 404 → throws (ambiguous = real error)', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use'))
      .mockResolvedValueOnce(jsonResponse(404, { error: { code: 'not_found' } }))
    await expect(addProjectDomain('studio.withbernard.ai')).rejects.toBeInstanceOf(VercelDomainError)
  })

  it('domain_already_in_use + inspect network error → throws', async () => {
    fetchMock
      .mockResolvedValueOnce(errorResponse(409, 'domain_already_in_use'))
      .mockRejectedValueOnce(new Error('boom'))
    await expect(addProjectDomain('studio.withbernard.ai')).rejects.toBeInstanceOf(VercelDomainError)
  })

  it('throws on other error codes', async () => {
    fetchMock.mockResolvedValueOnce(errorResponse(403, 'forbidden', 'nope'))
    await expect(addProjectDomain('studio.withbernard.ai')).rejects.toMatchObject({
      name: 'VercelDomainError',
      code: 'forbidden',
      status: 403,
    })
    expect(fetchMock).toHaveBeenCalledTimes(1)
  })
})
