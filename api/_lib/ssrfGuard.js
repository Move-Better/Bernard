// SSRF guard for any server-side fetch of a URL a client can influence.
//
// Moved here from api/_routes/onboarding/scan-website.js (audit 2026-11-18) so
// website publish can share it instead of a second copy drifting: publish
// downloaded heroImage / inline image URLs from the request body with a bare,
// redirect-following fetch and uploaded the bytes to WordPress, which let a
// member read internal or cloud-metadata responses back out of their own site.
import dns from 'node:dns/promises'
import net from 'node:net'

// Reject any address inside a non-routable / link-local / loopback /
// unique-local / cloud-metadata range. This is the address-level check; DNS
// resolution wraps it for hostnames.
export function isPrivateIp(ip) {
  const family = net.isIP(ip)
  if (family === 4) {
    const parts = ip.split('.').map(Number)
    if (parts.length !== 4 || parts.some(n => Number.isNaN(n))) return true
    const [a, b] = parts
    if (a === 10) return true                                  // 10.0.0.0/8
    if (a === 127) return true                                 // 127.0.0.0/8 loopback
    if (a === 0) return true                                   // 0.0.0.0/8
    if (a === 169 && b === 254) return true                    // 169.254.0.0/16 link-local + AWS/GCP metadata
    if (a === 172 && b >= 16 && b <= 31) return true           // 172.16.0.0/12
    if (a === 192 && b === 168) return true                    // 192.168.0.0/16
    if (a === 100 && b >= 64 && b <= 127) return true          // 100.64.0.0/10 CGNAT
    if (a >= 224) return true                                  // 224.0.0.0/4 multicast + reserved
    return false
  }
  if (family === 6) {
    const lower = ip.toLowerCase()
    if (lower === '::1' || lower === '::') return true
    // IPv4-mapped (::ffff:a.b.c.d) — re-check as IPv4
    const mapped = lower.match(/^::ffff:(\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3})$/)
    if (mapped) return isPrivateIp(mapped[1])
    // Unique-local fc00::/7 → first byte 0xfc or 0xfd
    if (/^f[cd][0-9a-f]{2}:/.test(lower)) return true
    // Link-local fe80::/10
    if (/^fe[89ab][0-9a-f]:/.test(lower)) return true
    return false
  }
  // Unknown / unparseable — treat as private to be safe.
  return true
}

export function isBlockedHostnameLiteral(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '').toLowerCase()
  if (h === 'localhost' || h.endsWith('.localhost')) return true
  if (h.endsWith('.internal') || h.endsWith('.local')) return true
  if (net.isIP(h) && isPrivateIp(h)) return true
  return false
}

export async function isPublicHostname(hostname) {
  const h = hostname.replace(/^\[|\]$/g, '')
  if (isBlockedHostnameLiteral(h)) return false
  if (net.isIP(h)) return !isPrivateIp(h)
  try {
    const addrs = await dns.lookup(h, { all: true })
    if (!addrs.length) return false
    return addrs.every(a => !isPrivateIp(a.address))
  } catch {
    return false
  }
}

// fetch() that re-runs the check on every redirect hop. `redirect: 'follow'`
// is unsafe: undici resolves redirects internally and would follow a
// 302 → http://169.254.169.254/. Throws on a refused URL; otherwise returns
// the final Response (callers check .ok as before).
export async function fetchPublic(url, init = {}, { maxHops = 5 } = {}) {
  let current = url
  for (let hop = 0; hop <= maxHops; hop++) {
    let parsed
    try { parsed = new URL(current) } catch { throw new Error('URL not allowed: unparseable') }
    if (!['http:', 'https:'].includes(parsed.protocol)) throw new Error(`URL not allowed: ${parsed.protocol} scheme`)
    if (!(await isPublicHostname(parsed.hostname))) throw new Error('URL not allowed: private or unresolvable host')
    const r = await fetch(current, { ...init, redirect: 'manual' })
    if (r.status >= 300 && r.status < 400) {
      const loc = r.headers.get('location')
      if (!loc) return r
      current = new URL(loc, current).toString()
      continue
    }
    return r
  }
  throw new Error('URL not allowed: too many redirects')
}
