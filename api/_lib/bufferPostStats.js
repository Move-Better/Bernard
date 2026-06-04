// Shared helper for fetching Buffer post statistics via the GraphQL API.
//
// The old v1 REST API (api.bufferapp.com/1/updates/:id.json?access_token=...)
// rejects Personal Access Tokens (PAT) with "OIDC tokens are not accepted for
// direct API access." All three analytics paths (buffer-analytics, engagement/
// refresh, cron/refresh-engagement) now go through here instead.
//
// Schema notes (2026-05-17):
//   - Query.post requires `input: PostInput!` (not `id: String!`). Buffer's
//     schema validator rejects the bare id argument with
//     "Field 'post' argument 'input' of type 'PostInput!' is required".
//
// ENGAGEMENT METRICS — NOT AVAILABLE VIA THE API YET (confirmed 2026-06-04):
//   Buffer's GraphQL API does not expose per-post engagement (reach, likes,
//   comments, impressions). Verified two ways:
//     1. Schema introspection (scripts/buffer-schema-probe.mjs): the `Post`
//        type has NO metrics/analytics/insights/statistics field, and there
//        is NO metric-named type anywhere in the schema.
//     2. Buffer's own developer roadmap (https://developers.buffer.com/roadmap.html):
//        "API for Post Analytics" is listed In Progress, and "Expose Post
//        Engagement Metrics via the API" is in Exploring — analytics are
//        Buffer Analyze (dashboard) only for now.
//   This is "not yet," not "never" — it's actively on Buffer's roadmap.
//
//   So this helper fetches only the real, available fields (id/status/sentAt),
//   which sync-buffer-published.js relies on. `statistics` is returned as an
//   empty object purely so legacy callers' `?? {}` paths don't crash. The
//   daily engagement cron now SKIPS writing snapshots when statistics is
//   empty (api/cron/refresh-engagement.js), so we no longer accumulate hollow
//   rows. Social engagement is meanwhile partly covered by GA4 referral
//   attribution (social → site clicks).
//
// WHEN BUFFER SHIPS IT: add the metrics field to the `post(input:)` query
// below (re-run scripts/buffer-schema-probe.mjs to find its name) and populate
// `statistics` from it — the cron + analytics paths light up automatically.

const BUFFER_GQL = 'https://api.buffer.com/graphql'

async function gql(token, query, variables = {}) {
  const r = await fetch(BUFFER_GQL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
  })
  const json = await r.json().catch(() => ({}))
  return { ok: r.ok, status: r.status, data: json.data, errors: json.errors }
}

// Returns { ok, post } or { ok: false, status, errors }.
// post shape: { id, status, sentAt, statistics: {} } — statistics is an empty
// placeholder until the correct Buffer schema field is wired (see TODO above).
// Returns { ok: false } silently when the post ID isn't found.
export async function fetchPostStats(token, postId) {
  const result = await gql(token, `
    query GetPostStats($input: PostInput!) {
      post(input: $input) {
        id
        status
        sentAt
      }
    }
  `, { input: { id: postId } })

  if (!result.ok || result.errors?.length) {
    console.error('[bufferPostStats] GraphQL error', result.status, JSON.stringify(result.errors))
    return { ok: false, status: result.status, errors: result.errors }
  }
  const post = result.data?.post
  // Attach empty statistics so callers' `?? {}` paths still see the shape
  // they expect and the UI degrades to zeroed metrics rather than 502.
  return { ok: true, post: post ? { ...post, statistics: {} } : null }
}
