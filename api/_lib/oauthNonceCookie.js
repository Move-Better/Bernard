// Binds a Google OAuth round-trip (gbp, gsc, drive) to the browser that
// started it. (2026-11-18 audit, P2: login CSRF on the connect callbacks.)
//
// The signed `state` proves Bernard issued it, but not WHO is holding it: an
// attacker could start a connect on their own workspace, stop before Google,
// and send the victim the consent link. The victim's Google account would then
// be stored against the attacker's workspace. So `connect` also sets a random
// nonce in an HttpOnly cookie, puts the same nonce in the signed state, and the
// callback refuses unless the cookie in THIS browser matches.
//
// Connect runs on `<slug>.withbernard.ai`; the callback runs on the apex
// (Google needs one fixed redirect URI). The cookie is therefore scoped to
// `Domain=withbernard.ai` and to the provider's callback path. SameSite=Lax is
// enough: the callback is a top-level GET navigation from accounts.google.com.

import { randomBytes, timingSafeEqual } from 'node:crypto'

const PROVIDERS = new Set(['gbp', 'gsc', 'drive'])
const MAX_AGE_S = 10 * 60 // matches the 10-minute state TTL

function cookieName(provider) {
  if (!PROVIDERS.has(provider)) throw new Error(`unknown oauth provider: ${provider}`)
  return `bernard_oauth_${provider}`
}

function hostOf(req) {
  const h = req.headers?.['x-forwarded-host'] || req.headers?.host || ''
  return String(h).split(',')[0].trim().toLowerCase().replace(/:\d+$/, '')
}

function cookieAttrs(req, provider) {
  const host = hostOf(req)
  const onProdDomain = host === 'withbernard.ai' || host.endsWith('.withbernard.ai')
  const parts = [
    `Path=/api/integrations/${provider}/callback`,
    'HttpOnly',
    'Secure',
    'SameSite=Lax',
  ]
  if (onProdDomain) parts.push('Domain=withbernard.ai')
  return parts
}

function appendSetCookie(res, value) {
  const prev = res.getHeader?.('Set-Cookie')
  const list = prev == null ? [] : Array.isArray(prev) ? prev : [String(prev)]
  res.setHeader('Set-Cookie', [...list, value])
}

/** Mint a nonce, set it as the provider's cookie on `res`, and return it for the state. */
export function issueOAuthNonce(req, res, provider) {
  const nonce = randomBytes(18).toString('base64url')
  appendSetCookie(res, [`${cookieName(provider)}=${nonce}`, `Max-Age=${MAX_AGE_S}`, ...cookieAttrs(req, provider)].join('; '))
  return nonce
}

/** Expire the provider's cookie (call on every callback outcome). */
export function clearOAuthNonce(req, res, provider) {
  appendSetCookie(res, [`${cookieName(provider)}=`, 'Max-Age=0', ...cookieAttrs(req, provider)].join('; '))
}

function readCookie(req, name) {
  const raw = req.headers?.cookie
  if (!raw) return null
  for (const part of String(raw).split(';')) {
    const i = part.indexOf('=')
    if (i < 0) continue
    if (part.slice(0, i).trim() === name) return part.slice(i + 1).trim()
  }
  return null
}

/** True only when this browser's cookie equals the nonce carried in the signed state. */
export function oauthNonceMatches(req, provider, stateNonce) {
  if (typeof stateNonce !== 'string' || !stateNonce) return false
  const cookie = readCookie(req, cookieName(provider))
  if (!cookie) return false
  const a = Buffer.from(cookie)
  const b = Buffer.from(stateNonce)
  return a.length === b.length && timingSafeEqual(a, b)
}
