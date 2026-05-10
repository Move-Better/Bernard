#!/usr/bin/env node
// astro-verify.mjs — verify Astro+GitHub publish webhook credentials.
//
// Sends a deliberately-invalid probe payload with the bearer header set,
// then disambiguates auth vs. payload vs. connectivity from the response.
// Never sends a real publish payload. See docs/ASTRO_GITHUB_CREDENTIALS.md.
//
// Usage:
//   node scripts/astro-verify.mjs <webhook-url> <shared-secret>

const [, , url, secret] = process.argv

if (!url || !secret) {
  console.error('Usage: node scripts/astro-verify.mjs <webhook-url> <shared-secret>')
  process.exit(2)
}

const probe = {
  slug:        '__narraterx_verify__',
  title:       '__narraterx_verify__',
  description: '__narraterx_verify__',
  pubDate:     '1970-01-01',
  markdown:    '',
}

let res
try {
  res = await fetch(url, {
    method:  'POST',
    headers: { Authorization: `Bearer ${secret}`, 'Content-Type': 'application/json' },
    body:    JSON.stringify(probe),
  })
} catch (e) {
  console.error(`FAIL — could not reach ${url}: ${e.message}`)
  console.error('Check the URL spelling, DNS, and that the Astro deployment is up.')
  process.exit(1)
}

const status = res.status
let body = ''
try { body = await res.text() } catch {}
const snippet = body.slice(0, 200).replace(/\s+/g, ' ').trim()

if (status === 401) {
  console.error(`FAIL (401) — bearer secret rejected by ${url}.`)
  console.error('The secret pasted into NarrateRx does not match the env var on the Astro deployment.')
  console.error('Fix: re-paste the same secret on both sides (NarrateRx settings + Astro Vercel env var).')
  if (snippet) console.error(`  upstream body: ${snippet}`)
  process.exit(1)
}

if (status === 400) {
  console.log(`OK (400) — bearer accepted; Astro rejected the probe payload as invalid (expected).`)
  console.log('Credentials verify cleanly. Try a real publish from the Review Post UI as a final check.')
  if (snippet) console.log(`  upstream body: ${snippet}`)
  process.exit(0)
}

if (status === 200) {
  console.warn('UNEXPECTED (200) — the Astro side accepted an empty-markdown payload.')
  console.warn('This script assumed the receiver would 400 on an empty payload. The receiver may')
  console.warn('have changed contract. Verify nothing was actually published before trusting auth.')
  if (snippet) console.warn(`  upstream body: ${snippet}`)
  process.exit(0)
}

if (status === 404) {
  console.error(`FAIL (404) — ${url} returned not-found.`)
  console.error('The webhook URL is wrong, or the Astro deployment does not implement /api/publish.')
  process.exit(1)
}

if (status >= 500) {
  console.error(`FAIL (${status}) — the Astro deployment is misconfigured or down.`)
  console.error('Common cause: the receiver is missing its GitHub token env var. Check the Astro project logs.')
  if (snippet) console.error(`  upstream body: ${snippet}`)
  process.exit(1)
}

console.error(`UNCLEAR (${status}) — unexpected response.`)
if (snippet) console.error(`  upstream body: ${snippet}`)
console.error('This script cannot determine credential validity. Inspect manually or try a real publish.')
process.exit(1)
