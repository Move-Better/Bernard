// Vercel REST API helper for registering `<slug>.narraterx.ai` as a domain on
// the shared narraterx Vercel project at workspace-claim time.
//
// Why this exists: Cloudflare manages narraterx.ai DNS, which blocks Vercel's
// wildcard cert issuance. Per the Phase 1A pattern, each subdomain must be
// registered as a specific Vercel project domain so Vercel issues a per-domain
// cert via the HTTP-01 challenge. Move Better's three subdomains were added by
// hand; this helper automates the same step for self-serve onboarding.
//
// Required env (set on the shared narraterx Vercel project):
//   VERCEL_TOKEN         — Personal/integration token with project:write
//                          (Sensitive — paste via Vercel dashboard)
//   VERCEL_PROJECT_ID    — Project ID for the narraterx project
//                          (Mildly sensitive)
//   VERCEL_TEAM_ID       — Team/scope ID. Optional — set when the project lives
//                          in a Vercel Team (Mildly sensitive)
//
// Assumes Cloudflare has a wildcard CNAME `*.narraterx.ai → cname.vercel-dns.com`
// (or per-subdomain CNAMEs). Adding the domain in Vercel without DNS resolution
// returns 200 from Vercel but cert issuance hangs until DNS resolves. The
// onboarding wizard's 1.8s "launching" screen + Vercel's loading state cover
// the typical cert-provisioning gap (~10–30s).

const VERCEL_API = 'https://api.vercel.com'

export class VercelDomainError extends Error {
  constructor(message, { status, code, detail } = {}) {
    super(message)
    this.name = 'VercelDomainError'
    this.status = status
    this.code = code
    this.detail = detail
  }
}

function isConfigured() {
  return Boolean(process.env.VERCEL_TOKEN && process.env.VERCEL_PROJECT_ID)
}

function teamQuery() {
  const t = process.env.VERCEL_TEAM_ID
  return t ? `?teamId=${encodeURIComponent(t)}` : ''
}

// Adds <name> as a domain on the configured Vercel project. Idempotent: if the
// domain is already attached, Vercel returns code='domain_already_in_use_by_project'
// and we treat it as success. Throws VercelDomainError on any other failure.
export async function addProjectDomain(name) {
  if (!isConfigured()) {
    throw new VercelDomainError('vercel-not-configured', { code: 'not-configured' })
  }

  const url = `${VERCEL_API}/v10/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains${teamQuery()}`

  let r
  try {
    r = await fetch(url, {
      method: 'POST',
      headers: {
        Authorization: `Bearer ${process.env.VERCEL_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ name }),
    })
  } catch (e) {
    throw new VercelDomainError('network-error', { detail: e?.message })
  }

  if (r.ok) {
    return { added: true, name }
  }

  // Parse Vercel error envelope: { error: { code, message } }
  let errBody = null
  try { errBody = await r.json() } catch { /* noop */ }
  const code = errBody?.error?.code
  const message = errBody?.error?.message || 'unknown'

  // Idempotent path: domain already attached to this project.
  if (code === 'domain_already_in_use_by_project' || code === 'domain_already_exists') {
    return { added: false, name, alreadyAttached: true }
  }

  throw new VercelDomainError(message, { status: r.status, code, detail: errBody })
}

// Best-effort detach (rollback path when a downstream step fails after the
// domain was added). Swallows all errors — a stranded domain is recoverable
// manually and shouldn't mask the original failure being reported.
export async function removeProjectDomain(name) {
  if (!isConfigured()) return
  const url = `${VERCEL_API}/v9/projects/${encodeURIComponent(process.env.VERCEL_PROJECT_ID)}/domains/${encodeURIComponent(name)}${teamQuery()}`
  try {
    await fetch(url, {
      method: 'DELETE',
      headers: { Authorization: `Bearer ${process.env.VERCEL_TOKEN}` },
    })
  } catch (e) {
    console.error('[vercelDomains] removeProjectDomain failed (ignored):', e?.message)
  }
}

export function vercelDomainConfigured() {
  return isConfigured()
}
