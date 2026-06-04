#!/usr/bin/env node
/**
 * buffer-schema-probe.mjs — introspect Buffer's GraphQL schema to find where
 * per-post engagement metrics live (the open question blocking the social
 * outcome loop: api/_lib/bufferPostStats.js returns `statistics: {}` because
 * the real field name was never confirmed).
 *
 * Run with YOUR Buffer Personal Key (publish.buffer.com/settings/api → Personal
 * Keys). The token stays in your terminal env — it is NOT printed. Only schema
 * field NAMES (non-sensitive) are output, which you can paste back.
 *
 *   cd "/Users/qbook/Claude Projects/NarrateRx" && \
 *     BUFFER_TOKEN='<paste-your-buffer-personal-key>' node scripts/buffer-schema-probe.mjs
 */

const BUFFER_GQL = 'https://api.buffer.com/graphql'
const TOKEN = process.env.BUFFER_TOKEN
if (!TOKEN) {
  console.error('BUFFER_TOKEN not set — paste your Personal Key from publish.buffer.com/settings/api')
  process.exit(1)
}

async function gql(query) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: { Authorization: `Bearer ${TOKEN}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ query }),
  })
  const j = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: j.data, errors: j.errors }
}

function typeName(t) {
  if (!t) return ''
  return t.name || (t.ofType ? `${t.kind}<${typeName(t.ofType)}>` : t.kind)
}

// 1) Fields on the Post type — is there a metrics/analytics/insights field?
const post = await gql(`{ __type(name:"Post"){ name fields{ name type{ name kind ofType{ name kind } } } } }`)
console.log('\n=== Post type fields ===')
if (post.errors) console.log('errors:', JSON.stringify(post.errors))
const postFields = post.data?.__type?.fields || []
for (const f of postFields) console.log(`  ${f.name}: ${typeName(f.type)}`)
const metricish = postFields.filter((f) => /metric|analytic|insight|statistic|engagement|performance|stat/i.test(f.name))
console.log('\n  → metric-ish fields on Post:', metricish.map((f) => f.name).join(', ') || '(none)')

// 2) Any TYPE in the schema whose name looks like post metrics.
const types = await gql(`{ __schema{ types{ name kind } } }`)
const named = (types.data?.__schema?.types || [])
  .map((t) => t.name)
  .filter((n) => n && /metric|analytic|insight|statistic|engagement/i.test(n))
console.log('\n=== Schema types matching metric/analytic/insight/engagement ===')
console.log(' ', named.join(', ') || '(none)')

// 3) If a promising metrics TYPE exists, dump ITS fields so we know the metric names.
for (const tn of named.slice(0, 4)) {
  const t = await gql(`{ __type(name:"${tn}"){ name fields{ name type{ name kind ofType{ name } } } } }`)
  const fs = t.data?.__type?.fields || []
  if (fs.length) {
    console.log(`\n=== ${tn} fields ===`)
    for (const f of fs) console.log(`  ${f.name}: ${typeName(f.type)}`)
  }
}
console.log('\nDone. Paste the "Post type fields" + any metric-type fields above.')
