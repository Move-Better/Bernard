// Is a published post still reachable? The pure half of the daily
// check-published-links cron (2026-11-15).
//
// Why: a publish to a website returns "success" when the receiver commits the
// file, before the site builds. If the build fails, or the site stops
// deploying (the animal site deployed nothing from 2026-05-04 to 2026-11-15
// because its Vercel project pointed at the repo's pre-transfer address), or a
// domain is retired later, nobody hears about it. This loads each published
// address and says which ones a visitor cannot open.

const TIMEOUT_MS = 15_000
const RETRY_DELAY_MS = 20_000

// A real browser's user agent: some hosts refuse obvious bots with a 403.
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36'

/** Strip tracking parameters; the post is the same page without them. */
export function canonicalUrl(url) {
  try {
    const u = new URL(url)
    for (const k of [...u.searchParams.keys()]) if (k.startsWith('utm_')) u.searchParams.delete(k)
    return u.toString()
  } catch { return null }
}

/**
 * Load the address once, following redirects. Resolves { ok, status, reason }:
 * ok is a 2xx after redirects; a network failure or timeout is status null.
 */
export async function loadOnce(url, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(url, {
      method: 'GET',
      redirect: 'follow',
      headers: { 'User-Agent': UA, Accept: 'text/html' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
    })
    // A bot challenge (Cloudflare answers 403 with `cf-mitigated: challenge` to
    // every script, homepage included) says nothing about the post, so it is
    // "can't check", never "broken": movebetterequine.com does this, 2026-11-15.
    if (res.headers?.get?.('cf-mitigated') === 'challenge') return { ok: true, unverifiable: true, status: res.status, reason: 'behind a bot challenge' }
    return { ok: res.status >= 200 && res.status < 300, status: res.status, reason: res.status >= 200 && res.status < 300 ? null : `answered ${res.status}` }
  } catch (e) {
    return { ok: false, status: null, reason: e?.name === 'TimeoutError' ? 'did not answer within 15 seconds' : 'could not be reached' }
  }
}

/**
 * Reachable, allowing one retry after a pause so a momentary blip is not an
 * alarm. `sleep` is injectable for tests.
 */
export async function checkPublishedUrl(url, { fetchImpl = fetch, sleep = (ms) => new Promise((r) => setTimeout(r, ms)) } = {}) {
  const target = canonicalUrl(url)
  if (!target) return { ok: false, status: null, reason: 'is not a valid address' }
  const first = await loadOnce(target, fetchImpl)
  if (first.ok) return first
  await sleep(RETRY_DELAY_MS)
  return loadOnce(target, fetchImpl)
}
