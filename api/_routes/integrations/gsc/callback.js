import { withSentry } from '../../../_lib/sentry.js'
import {
  gscRedirectUri,
  exchangeCodeForTokens,
  persistGscCredential,
  verifyOAuthState,
} from '../../../_lib/gscAuth.js'
import { workspaceById } from '../../../_lib/workspaceContext.js'

// GET /api/integrations/gsc/callback?code=…&state=…
//
// Runs on the apex (withbernard.ai) — Google requires a fixed redirect URI and
// wildcard subdomains aren't supported. The state token carries the originating
// workspace_id + slug so we know where to persist the credential and where to
// redirect the admin back to. Mirrors drive/callback.js exactly.

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
    `<!doctype html><meta charset="utf-8"><title>Search Console connect</title>` +
    `<body style="font-family:system-ui;padding:2rem;max-width:32rem;margin:auto">` +
    `<h1>Couldn't complete Search Console connect</h1>` +
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
    if (parsed?.slug) return redirectBack(res, parsed.slug, { gsc: 'error', reason: errParam })
    return renderApexError(res, `Google reported: ${errParam}`)
  }

  if (!code || !state) {
    return renderApexError(res, 'Missing OAuth code or state. Try connecting again from Settings → Integrations.')
  }

  const parsed = verifyOAuthState(state)
  if (!parsed) {
    return renderApexError(res, 'OAuth state is invalid or has expired (10 minute window). Try connecting again.')
  }

  let tokens
  try {
    tokens = await exchangeCodeForTokens({ code, redirectUri: gscRedirectUri() })
  } catch (e) {
    console.error('[gsc/callback] exchange failed:', e?.message)
    return redirectBack(res, parsed.slug, { gsc: 'error', reason: 'exchange_failed' })
  }

  const ws = await workspaceById(parsed.workspaceId)
  if (!ws) {
    console.error('[gsc/callback] workspace not found:', parsed.workspaceId)
    return renderApexError(res, 'Your workspace could not be found. Contact support if this is unexpected.')
  }

  try {
    await persistGscCredential({
      workspaceId:  parsed.workspaceId,
      refreshToken: tokens.refresh_token,
      accessToken:  tokens.access_token,
    })
  } catch (e) {
    console.error('[gsc/callback] persist failed:', e?.message)
    return redirectBack(res, parsed.slug, { gsc: 'error', reason: 'persist_failed' })
  }

  return redirectBack(res, parsed.slug, { gsc: 'connected' })
}

export default withSentry(handler)
