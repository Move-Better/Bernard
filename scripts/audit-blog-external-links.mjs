#!/usr/bin/env node
// Audit (and optionally repair) external hyperlinks in blog post bodies.
//
// WHY THIS EXISTS
// The pre-#2665 blog generator sometimes fabricated external Markdown links
// ([anchor](https://…)) that 404 — a real one blocked a clinician from
// publishing (feedback 9142b546, rehabps.com/…/About_DNS.html). #2665 stopped
// NEW posts from fabricating links (real, verified citations only), but its
// own commit body deferred remediating the blogs already carrying fabricated
// links as "a separate reviewed pass — needs sign-off." This is that pass.
//
// WHAT IT DOES
// Scans every `blog` content_item, pulls the external Markdown links out of the
// body, and checks each URL's reachability. It classifies conservatively so a
// legitimate link is NEVER stripped by mistake:
//
//   DEAD    — HTTP 404/410/451, DNS host-not-found (ENOTFOUND), or a known
//             retired domain (RETIRED_HOSTS). Only DEAD links are eligible to
//             strip. A strip UNWRAPS the link: `[DNS](dead-url)` -> `DNS`,
//             keeping the anchor text so the prose reads unchanged.
//   BLOCKED — HTTP 403/429/503. A bot/WAF block, NOT a dead page (many real
//             health sites 403 a non-browser request — e.g. mayoclinic.org;
//             see api/_lib/citations/verify.js). Flagged, NEVER stripped.
//   OTHER   — timeouts, connection resets, transient DNS, other 4xx/5xx.
//             Ambiguous. Flagged, NEVER stripped.
//   OK      — 2xx. Left alone.
//
// Internal links (the clinic's booking widget and our own product domains) are
// out of scope entirely and never touched — see INTERNAL_HOSTS.
//
// REPORT-ONLY BY DEFAULT. `--apply` performs the strips, one row at a time,
// re-reading each row fresh immediately before it writes and verifying the
// result — and only ever unwraps a DEAD link that occurs EXACTLY ONCE in the
// current body (zero or many => skip, never guess; same fail-safe rule as
// api/_lib/citations/insertCitations.js).
//
// USAGE (from the project root)
//   Primary — source secrets straight from the 1Password mount (reliable; the
//   redacted .env.local does not carry the Sensitive service key):
//     cd "/Users/qbook/Claude Projects/Bernard" && \
//     T=$(mktemp) && cat .env.bernard.1pw > "$T" && \
//     export SUPABASE_URL="$(awk -F= '/^SUPABASE_URL=/{print substr($0,index($0,"=")+1)}' "$T" | tr -d '\r')" && \
//     export SUPABASE_SERVICE_KEY="$(awk -F= '/^SUPABASE_SERVICE_KEY=/{print substr($0,index($0,"=")+1)}' "$T" | tr -d '\r')" && \
//     rm -f "$T" && \
//     node scripts/audit-blog-external-links.mjs               # report only
//     node scripts/audit-blog-external-links.mjs --apply       # strip confirmed-dead
//
//   Flags:
//     --apply                 perform the strips (default: report only)
//     --id <content_item_id>  restrict to one post
//     --workspace <slug>      restrict to one workspace
//     --json                  emit the machine-readable report as well
//
// Env: SUPABASE_URL, SUPABASE_SERVICE_KEY.
// Idempotent: unwrapping a dead link is a no-op on the next run.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const APPLY   = process.argv.includes('--apply')
const AS_JSON = process.argv.includes('--json')
const argVal = (flag) => {
  const i = process.argv.indexOf(flag)
  return i >= 0 ? process.argv[i + 1] : null
}
const ONLY_ID = argVal('--id')
const ONLY_WS = argVal('--workspace')

if (!SUPABASE_URL || !SUPABASE_KEY) {
  console.error('SUPABASE_URL and SUPABASE_SERVICE_KEY are required (see the header for how to source them).')
  process.exit(1)
}

// Hosts that are ours / the clinic's own booking — never in scope.
const INTERNAL_HOSTS = [/(^|\.)movebetter\.janeapp\.com$/i, /(^|\.)movebetter\.co$/i, /(^|\.)withbernard\.ai$/i]
// Retired product domains — dead regardless of what the HTTP probe says today.
const RETIRED_HOSTS = new Set(['narraterx.ai'])

const LINK_RE = /\[([^\]]+)\]\((https?:\/\/[^)\s]+)\)/g
const UA = 'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/128.0.0.0 Safari/537.36'

function hostnameOf(url) { try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return '' } }
function isInternal(url) { const h = hostnameOf(url); return !h || INTERNAL_HOSTS.some((re) => re.test(h)) }

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

// Classify one URL. Biased hard toward "do not strip": only unambiguous dead
// signals (404/410/451, host does not resolve, retired domain) return DEAD.
async function classify(url) {
  const host = hostnameOf(url)
  if (RETIRED_HOSTS.has(host)) return { verdict: 'DEAD', detail: 'retired domain' }
  try {
    const res = await fetch(url, {
      redirect: 'follow',
      signal: AbortSignal.timeout(15_000),
      headers: { 'User-Agent': UA, Accept: 'text/html,application/xhtml+xml,*/*;q=0.8' },
    })
    if (res.ok) return { verdict: 'OK', detail: String(res.status) }
    if ([404, 410, 451].includes(res.status)) return { verdict: 'DEAD', detail: String(res.status) }
    if ([403, 429, 503].includes(res.status)) return { verdict: 'BLOCKED', detail: String(res.status) }
    return { verdict: 'OTHER', detail: String(res.status) }
  } catch (e) {
    const code = e?.cause?.code || e?.code || e?.name || 'error'
    // ENOTFOUND = the hostname does not resolve => genuinely dead.
    // Everything else (timeout, ECONNRESET, EAI_AGAIN transient DNS) is
    // ambiguous and must NOT be stripped.
    if (code === 'ENOTFOUND') return { verdict: 'DEAD', detail: code }
    return { verdict: 'OTHER', detail: code }
  }
}

// Sentence-ish context around an index, for the human report.
function contextAround(body, idx, span) {
  const start = Math.max(0, idx - 70)
  const end = Math.min(body.length, idx + span + 70)
  return (start > 0 ? '…' : '') + body.slice(start, end).replace(/\n+/g, ' ').trim() + (end < body.length ? '…' : '')
}

async function fetchBlogRows() {
  let path = 'content_items?platform=eq.blog&select=id,workspace_id,status,topic,seo_title,archived_at,content'
  if (ONLY_ID) path += `&id=eq.${encodeURIComponent(ONLY_ID)}`
  const r = await sb(path)
  if (!r.ok) { console.error('failed to read content_items:', r.status, await r.text()); process.exit(1) }
  const rows = await r.json()
  const w = await sb('workspaces?select=id,slug')
  const slugById = new Map((w.ok ? await w.json() : []).map((x) => [x.id, x.slug]))
  return rows
    .map((r) => ({ ...r, ws: slugById.get(r.workspace_id) || r.workspace_id }))
    .filter((r) => !ONLY_WS || r.ws === ONLY_WS)
}

// Pull the distinct external links from a body, with anchor text + positions.
function externalLinks(body) {
  const out = []
  for (const m of String(body || '').matchAll(LINK_RE)) {
    if (isInternal(m[2])) continue
    out.push({ token: m[0], text: m[1], url: m[2], index: m.index })
  }
  return out
}

async function main() {
  const rows = await fetchBlogRows()
  console.log(`Scanning ${rows.length} blog post(s)${ONLY_WS ? ` in workspace ${ONLY_WS}` : ''}${ONLY_ID ? ` (id ${ONLY_ID})` : ''}.`)
  console.log(APPLY ? 'MODE: --apply (confirmed-dead links WILL be stripped)\n' : 'MODE: report only (no changes)\n')

  // Verify every distinct URL once (cache), so N posts sharing a link cost one probe.
  const rowsWithLinks = rows.map((r) => ({ ...r, links: externalLinks(r.content) })).filter((r) => r.links.length)
  const distinct = [...new Set(rowsWithLinks.flatMap((r) => r.links.map((l) => l.url)))]
  const verdicts = new Map()
  for (const url of distinct) verdicts.set(url, await classify(url))

  const report = []
  const applyPlan = [] // { row, deadTokens: Set }

  for (const r of rowsWithLinks) {
    const perLink = r.links.map((l) => ({ ...l, ...verdicts.get(l.url) }))
    const dead = perLink.filter((l) => l.verdict === 'DEAD')
    report.push({ id: r.id, ws: r.ws, status: r.status, archived: !!r.archived_at, label: (r.topic || r.seo_title || '').slice(0, 60), content: r.content, links: perLink })
    if (dead.length) applyPlan.push({ row: r, dead })
  }

  // ---- human report ----
  const badge = { DEAD: '✗ DEAD  ', BLOCKED: '~ BLOCKED', OTHER: '? OTHER ', OK: '✓ OK    ' }
  for (const r of report) {
    const tag = `[${r.ws}/${r.status}${r.archived ? '/archived' : ''}]`
    console.log(`\n${tag} ${r.label}\n  ${r.id}`)
    for (const l of r.links) {
      console.log(`  ${badge[l.verdict] || l.verdict} (${l.detail})  [${l.text}](${l.url})`)
      if (l.verdict === 'DEAD') console.log(`      strip → keep "${l.text}"  ·  ${contextAround(r.content, l.index, l.token.length)}`)
    }
  }

  // ---- summary ----
  const counts = { DEAD: 0, BLOCKED: 0, OTHER: 0, OK: 0 }
  for (const r of report) for (const l of r.links) counts[l.verdict]++
  console.log(`\n── summary ──`)
  console.log(`posts with external links: ${report.length}`)
  console.log(`links: ${counts.DEAD} DEAD · ${counts.BLOCKED} BLOCKED · ${counts.OTHER} OTHER · ${counts.OK} OK`)
  console.log(`posts with ≥1 DEAD link (strip candidates): ${applyPlan.length}`)

  if (AS_JSON) console.log('\nJSON:\n' + JSON.stringify(report.map(({ content, ...r }) => r), null, 2))

  if (!APPLY) {
    console.log(`\nReport only. Re-run with --apply to strip the ${counts.DEAD} DEAD link(s) above.`)
    return
  }

  // ---- apply: strip DEAD links, one row at a time, re-reading fresh ----
  console.log(`\nApplying strips to ${applyPlan.length} post(s)…`)
  let stripped = 0, skipped = 0
  for (const { row, dead } of applyPlan) {
    const fresh = await sb(`content_items?id=eq.${row.id}&select=content`)
    if (!fresh.ok) { console.log(`  ✗ ${row.id} — re-read failed ${fresh.status}, skipped`); skipped++; continue }
    let body = (await fresh.json())[0]?.content
    if (typeof body !== 'string') { console.log(`  ✗ ${row.id} — no content, skipped`); skipped++; continue }
    let changed = 0
    for (const l of dead) {
      const occ = body.split(l.token).length - 1
      if (occ !== 1) { console.log(`  ~ ${row.id} — "${l.text}" link occurs ${occ}× (not 1), left as-is`); continue }
      body = body.replace(l.token, l.text) // unwrap: keep anchor text
      changed++
    }
    if (!changed) { skipped++; continue }
    const patch = await sb(`content_items?id=eq.${row.id}`, {
      method: 'PATCH',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify({ content: body, updated_at: new Date().toISOString() }),
    })
    if (!patch.ok) { console.log(`  ✗ ${row.id} — PATCH failed ${patch.status} ${await patch.text()}`); skipped++; continue }
    // verify
    const after = await sb(`content_items?id=eq.${row.id}&select=content`)
    const ab = (await after.json())[0]?.content || ''
    const anyDeadLeft = dead.some((l) => ab.includes(l.token))
    console.log(`  ✓ ${row.id} — stripped ${changed} dead link(s)${anyDeadLeft ? ' (WARNING: a token still present!)' : ''}`)
    stripped++
  }
  console.log(`\nDone. ${stripped} post(s) updated, ${skipped} skipped.`)
}

main().catch((e) => { console.error(e); process.exit(1) })
