import { describe, it, expect, vi, beforeEach } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// A 500 from this route used to leave no durable trace anywhere: dbErr
// RETURNS an error response rather than throwing, so it never reaches
// withSentry's catch (this route isn't even wrapped with it) or the Express
// central error handler. The only record was a console.error, and Vercel's
// log retention is short enough that a report read a few hours later already
// has nothing to search — which is exactly what happened to a real 500 here
// on 2026-08-10 (feedback a680d6c4): by the time it was investigated,
// `vercel logs` covered barely the last hour and the cause was gone for good.
//
// This pins the two things that make it diagnosable next time: dbErr reports
// to Sentry with the real Supabase error body, and every call site in the
// route actually threads `req` through — a call site that reverted to the
// pre-fix two-arg form would compile fine (req would just bind to the msg
// parameter) and silently stop reporting.

const captureServerException = vi.fn()
// content.js imports this as '../../_lib/sentry.js' relative to itself
// (api/_routes/db/content.js → api/_lib/sentry.js) — mock the resolved path,
// not the specifier string, or vitest silently loads the real module instead.
vi.mock('../../api/_lib/sentry.js', () => ({ captureServerException }))

const { dbErr } = await import('../../api/_routes/db/content.js')

beforeEach(() => {
  captureServerException.mockClear()
})

function fakeSupabaseResponse({ status = 500, body = '' } = {}) {
  return { ok: false, status, text: async () => body }
}

function fakeExpressRes() {
  const res = {}
  res.status = vi.fn(() => res)
  res.json = vi.fn(() => res)
  return res
}

describe('dbErr reports the real failure to Sentry', () => {
  it('captures an Error carrying the Supabase status and body', async () => {
    const req = { url: '/api/db/content?id=abc', method: 'PATCH' }
    const res = fakeExpressRes()
    const supabaseFail = fakeSupabaseResponse({
      status: 503,
      body: '{"message":"upstream timeout"}',
    })

    await dbErr(res, supabaseFail, req, 'Update failed')

    expect(captureServerException).toHaveBeenCalledTimes(1)
    const [err, passedReq] = captureServerException.mock.calls[0]
    expect(err).toBeInstanceOf(Error)
    expect(err.message).toContain('Update failed')
    expect(err.message).toContain('503')
    expect(err.message).toContain('upstream timeout')
    // The req object is what lets Sentry attach route/workspace/user context
    // (applyScope in sentry.js) — passing the wrong thing, or nothing, means
    // every future issue lands unscoped and unattributable.
    expect(passedReq).toBe(req)
  })

  it('still returns the opaque public response — Sentry reporting is additive', async () => {
    const res = fakeExpressRes()
    await dbErr(res, fakeSupabaseResponse({ status: 500 }), {}, 'Insert failed')
    expect(res.status).toHaveBeenCalledWith(500)
    expect(res.json).toHaveBeenCalledWith({ error: 'Insert failed' })
  })

  it('reports even when the Supabase body cannot be read', async () => {
    const res = fakeExpressRes()
    const brokenResponse = { ok: false, status: 500, text: async () => { throw new Error('stream closed') } }
    await dbErr(res, brokenResponse, {}, 'Delete failed')
    expect(captureServerException).toHaveBeenCalledTimes(1)
  })
})

// Source-level: dbErr's own behavior is covered above, but the failure this
// whole thing exists to prevent is a call site that stops passing `req` —
// which compiles and lints clean (req just binds to the `msg` parameter
// instead), so only reading the call sites catches it.
const ROUTE = fileURLToPath(new URL('../../api/_routes/db/content.js', import.meta.url))
const raw = readFileSync(ROUTE, 'utf8')
const src = raw
  .replace(/\/\*[\s\S]*?\*\//g, ' ')
  .replace(/(^|[^:])\/\/[^\n]*/g, '$1')

describe('every dbErr( call site threads req through', () => {
  it('the comment stripper did not eat the file', () => {
    expect(src.length).toBeGreaterThan(raw.length * 0.4)
  })

  it('finds more than one call site, so this isn\'t vacuous', () => {
    const calls = [...src.matchAll(/dbErr\(([^)]*)\)/g)]
    expect(calls.length).toBeGreaterThanOrEqual(10)
  })

  it('every call passes req as the third argument', () => {
    const calls = [...src.matchAll(/dbErr\(([^)]*)\)/g)].map((m) => m[1])
    for (const args of calls) {
      const parts = args.split(',').map((s) => s.trim())
      // dbErr(res, r, req, ...) — definition included, since it's in the same
      // file and matches the same regex; skip it via the default-param tell.
      if (parts[3]?.startsWith('msg')) continue
      expect(parts[2], `call site "dbErr(${args})" is missing req`).toBe('req')
    }
  })
})
