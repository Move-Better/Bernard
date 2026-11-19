// Google connect callbacks (gbp, gsc, drive) must be bound to the browser that
// started the connect: connect sets an HttpOnly nonce cookie whose value is
// also in the signed state, and the callback refuses when they differ. Without
// it, an attacker could hand a victim a consent link minted for the attacker's
// workspace and the victim's Google account would land there.
// (2026-11-18 full audit, P2.)
import { describe, it, expect, vi, beforeAll, beforeEach } from 'vitest'

const { exchange, persist } = vi.hoisted(() => ({
  exchange: vi.fn(async () => ({ refresh_token: 'r', access_token: 'a' })),
  persist: vi.fn(async () => {}),
}))

vi.mock('../../api/_lib/sentry.js', () => ({ withSentry: (h) => h }))
vi.mock('../../api/_lib/workspaceContext.js', () => ({
  workspaceById: vi.fn(async (id) => ({ id, slug: 'victimws', status: 'active' })),
}))

vi.mock('../../api/_lib/gbpAuth.js', async (orig) => ({
  ...(await orig()),
  exchangeCodeForTokens: (...a) => exchange(...a),
  persistGbpCredential: (...a) => persist(...a),
  persistGscCredential: (...a) => persist(...a),
  persistDriveCredential: (...a) => persist(...a),
  fetchAccountEmail: async () => 'x@example.com',
}))
vi.mock('../../api/_lib/gscAuth.js', async (orig) => ({
  ...(await orig()),
  exchangeCodeForTokens: (...a) => exchange(...a),
  persistGbpCredential: (...a) => persist(...a),
  persistGscCredential: (...a) => persist(...a),
  persistDriveCredential: (...a) => persist(...a),
  fetchAccountEmail: async () => 'x@example.com',
}))
vi.mock('../../api/_lib/driveAuth.js', async (orig) => ({
  ...(await orig()),
  exchangeCodeForTokens: (...a) => exchange(...a),
  persistGbpCredential: (...a) => persist(...a),
  persistGscCredential: (...a) => persist(...a),
  persistDriveCredential: (...a) => persist(...a),
  fetchAccountEmail: async () => 'x@example.com',
}))

const PROVIDERS = {
  gbp: { auth: 'gbpAuth' },
  gsc: { auth: 'gscAuth' },
  drive: { auth: 'driveAuth' },
}

function fakeRes() {
  const headers = {}
  return {
    statusCode: 200,
    headers,
    setHeader(k, v) { headers[k.toLowerCase()] = v },
    getHeader(k) { return headers[k.toLowerCase()] },
    status(c) { this.statusCode = c; return this },
    json(b) { this.body = b; return this },
    end(b) { this.body = b; return this },
  }
}

let cookieLib
beforeAll(async () => {
  process.env.WORKSPACE_CREDENTIALS_KEY = 'a'.repeat(64)
  cookieLib = await import('../../api/_lib/oauthNonceCookie.js')
})
beforeEach(() => { persist.mockClear(); exchange.mockClear() })

describe('oauth nonce cookie', () => {
  it('sets an HttpOnly, Secure, SameSite=Lax, short-lived cookie on the shared domain', () => {
    const res = fakeRes()
    const nonce = cookieLib.issueOAuthNonce({ headers: { host: 'acme.withbernard.ai' } }, res, 'gbp')
    const [c] = res.getHeader('Set-Cookie')
    expect(c).toContain(`bernard_oauth_gbp=${nonce}`)
    expect(c).toMatch(/HttpOnly/)
    expect(c).toMatch(/Secure/)
    expect(c).toMatch(/SameSite=Lax/)
    expect(c).toMatch(/Max-Age=600/)
    expect(c).toMatch(/Domain=withbernard\.ai/)
    expect(c).toMatch(/Path=\/api\/integrations\/gbp\/callback/)
  })
})

for (const [p, { auth }] of Object.entries(PROVIDERS)) {
  describe(`${p}/callback`, () => {
    let handler, sign
    beforeAll(async () => {
      handler = (await import(`../../api/_routes/integrations/${p}/callback.js`)).default
      sign = (await import(`../../api/_lib/${auth}.js`)).signOAuthState
    })

    function call(state, cookie) {
      const req = {
        method: 'GET',
        url: `/api/integrations/${p}/callback?code=c&state=${encodeURIComponent(state)}`,
        headers: { host: 'withbernard.ai', ...(cookie ? { cookie } : {}) },
      }
      const res = fakeRes()
      return handler(req, res).then(() => res)
    }

    it('refuses a valid state with no nonce cookie (different browser)', async () => {
      const state = sign({ workspaceId: 'w1', slug: 'attackerws', userId: 'u', nonce: 'N'.repeat(24) })
      const res = await call(state, null)
      expect(res.statusCode).toBe(400)
      expect(persist).not.toHaveBeenCalled()
      expect(exchange).not.toHaveBeenCalled()
    })

    it('refuses when the cookie holds a different nonce', async () => {
      const state = sign({ workspaceId: 'w1', slug: 'attackerws', userId: 'u', nonce: 'N'.repeat(24) })
      const res = await call(state, `bernard_oauth_${p}=${'M'.repeat(24)}`)
      expect(res.statusCode).toBe(400)
      expect(persist).not.toHaveBeenCalled()
    })

    it('connects when the cookie matches, and clears the cookie', async () => {
      const nonce = 'N'.repeat(24)
      const state = sign({ workspaceId: 'w1', slug: 'victimws', userId: 'u', nonce })
      const res = await call(state, `other=1; bernard_oauth_${p}=${nonce}`)
      expect(res.statusCode).toBe(302)
      expect(res.getHeader('Location')).toContain(`${p}=connected`)
      expect(persist).toHaveBeenCalledTimes(1)
      const cookies = [].concat(res.getHeader('Set-Cookie'))
      expect(cookies.some((c) => c.startsWith(`bernard_oauth_${p}=;`) && c.includes('Max-Age=0'))).toBe(true)
    })
  })
}

// The connect side: without the cookie every real connect would fail at the
// callback. A source check per route (connect needs Clerk + capability mocks
// to run, and the wiring is one line).
import { readFileSync } from 'node:fs'
describe('connect routes issue the nonce into the signed state', () => {
  for (const p of Object.keys(PROVIDERS)) {
    it(`${p}/connect`, () => {
      const src = readFileSync(new URL(`../../api/_routes/integrations/${p}/connect.js`, import.meta.url), 'utf8')
      expect(src).toMatch(new RegExp(`signOAuthState\\(\\{[^}]*nonce: issueOAuthNonce\\(req, res, '${p}'\\)`, 's'))
    })
  }
})
