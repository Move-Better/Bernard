import { verifyToken } from '@clerk/backend'
import { withSentry } from '../../../_lib/sentry.js'
import {
  gbpRedirectUri,
  exchangeCodeForTokens,
  persistGbpCredential,
  verifyOAuthState,
} from '../../../_lib/gbpAuth.js'
import { workspaceById } from '../../../_lib/workspaceContext.js'

// GET /api/integrations/gbp/callback?code=…&state=…
//
// Runs on the apex (withbernard.ai) — Google requires a fixed redirect URI and
// wildcard subdomains aren't supported. Mirrors gsc/callback.js exactly.

export const config = { runtime: 'nodejs' }

function redirectBack(res, slug, params) {
  const target = new URL(`https://${slug}.withbernard.ai/settings/integrations`)
  for (const [k, v] of Object.entries(params)) target.searchParams.set(k, v)
  res.statusCode = 302
  res.setHeader('Location', target.toString())
  res.setHeader('Cache-Control', 'no-store')
  res.end()
}

function renderApexError(res, message) {
  res.statusCode = 400
  res.setHeader('Content-Type', 'text/html; charset=utf-8')
  res.setHeader('Cache-Control', 'no-store')
  const safe = String(message).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
  res.end(
    `<!doctype html><meta charset="utf-8"><title>Google Business connect</title>` +
    `<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">` +
    `<h1>Couldn't complete Google Business connect</h1>` +
    `<p>${safe}</p>` +
    `<p>Return to your workspace's Settings → Integrations page and try again.</p>` +
    `</body>`,
  )
}

async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'method-not-allowed' })

  const url      = new URL(req.url, 'http://localhost')
  const code     = url.searchParams.get('code')
  const state    = url.searchParams.get('state')
  const errParam = url.searchParams.get('error')

  if (errParam) {
    const parsed = state ? verifyOAuthState(state) : null
    if (parsed?.slug) return redirectBack(res, parsed.slug, { gbp: 'error', reason: errParam })
    return renderApexError(res, `Google reported: ${errParam}`)
  }

  if (!code || !state) {
    return renderApexError(res, 'Missing OAuth code or state. Try connecting again from Settings → Integrations.')
  }

  const parsed = verifyOAuthState(state)
  if (!parsed) {
    return renderApexError(res, 'OAuth state is invalid or has expired (10 minute window). Try connecting again.')
  }

  // Verify the Clerk session cookie matches the user who initiated the flow,
  // preventing replay of a legitimately-issued state token by a different user.
  if (parsed.userId) {
    const cookies = req.headers.cookie || ''
    const match = cookies.match(/(?:^|;\s*)__session=([^;]+)/)
    const sessionToken = match ? decodeURIComponent(match[1]) : null
    if (!sessionToken) {
      return renderApexError(res, 'Session expired. Please sign in and try connecting again.')
    }
    try {
      const claims = await verifyToken(sessionToken, { secretKey: process.env.CLERK_SECRET_KEY })
      if (claims.sub !== parsed.userId) {
        console.error('[gbp/callback] user_id mismatch — possible state replay', { state_uid: parsed.userId, session_uid: claims.sub })
        return renderApexError(res, 'Authentication mismatch. Please try connecting again from your workspace settings.')
      }
    } catch (e) {
      console.error('[gbp/callback] session verification failed:', e?.message)
      return renderApexError(res, 'Session expired. Please sign in and try connecting again.')
    }
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri: gbpRedirectUri() })
  } catch (e) {
    console.error('[gbp/callback] exchange failed:', e?.message)
    return redirectBack(res, parsed.slug, { gbp: 'error', reason: 'exchange_failed' })
  }

  const ws = await workspaceById(parsed.workspaceId)
  if (!ws) {
    console.error('[gbp/callback] workspace not found:', parsed.workspaceId)
    return renderApexError(res, 'Your workspace could not be found. Contact support if this is unexpected.')
  }

  try {
    await persistGbpCredential({
      workspaceId:  parsed.workspaceId,
      refreshToken: tokens.refresh_token,
      accessToken:  tokens.access_token,
    })
  } catch (e) {
    console.error('[gbp/callback] persist failed:', e?.message)
    return redirectBack(res, parsed.slug, { gbp: 'error', reason: 'persist_failed' })
  }

  return redirectBack(res, parsed.slug, { gbp: 'connected' })
}

export default withSentry(handler)
