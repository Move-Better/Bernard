// Shared low-level Supabase PostgREST fetch primitive.
//
// See ARCHITECTURE.md "no database-level RLS" — every handler talks to Supabase as
// service_role over the PostgREST REST API by design, not by oversight. Before this file
// existed, ~290 call sites across api/**/*.js each hand-rolled an identical local `sb(path,
// init)` helper doing the same URL templating + auth-header construction (apikey +
// Authorization, both set to SUPABASE_SERVICE_KEY). This module is that one shared
// implementation — it owns the fetch mechanics only. It does not parse responses or
// normalize errors; callers keep doing that exactly as before (some throw, some return null
// on !r.ok, some use the api/_routes/db/*.js `dbErr()` helper — that variance is real and
// stays put).
//
// New Supabase REST call sites: don't hand-roll fetch(`${SUPABASE_URL}/rest/v1/...`). Define
// a local `sb` as a thin partial application of supabaseRest():
//
//   import { supabaseRest } from '../_lib/supabaseRest.js'
//   const sb = (path, init = {}) => supabaseRest(path, init, {
//     timeoutMs: 8_000,
//     contentType: 'application/json',
//     prefer: 'return=representation',
//   })
//
// opts:
//   timeoutMs   - wraps the call in AbortSignal.timeout(timeoutMs). Per ARCHITECTURE.md's
//                 "AbortSignal.timeout() on every external fetch" rule, every NEW call site
//                 must set this — see that section for the budget table (8s standard REST
//                 read/write, 10s for workspaceContext's critical path, etc). Some files
//                 migrated onto this helper predate that rule and had no timeout at all;
//                 this refactor preserves that (a missing timeout is a real, separately
//                 tracked gap — see ARCHITECTURE.md's PR #1824 note — not something to
//                 silently patch in here as a side effect of a mechanical refactor).
//   contentType - sets Content-Type (almost every caller: 'application/json').
//   prefer      - sets the Prefer header (e.g. 'return=representation', 'count=exact',
//                 'return=representation,resolution=ignore-duplicates').
//
// Header/init precedence matches every pre-existing local sb(): a caller-supplied
// init.headers entry wins over the opts-derived ones, and a caller-supplied init.signal
// wins over opts.timeoutMs (init is spread after the timeout signal, before headers).

// Exported so callers that guard on "is Supabase configured?" (e.g. a background
// path that should skip cleanly rather than throw when env is missing) don't need
// their own process.env reads — see agentActions.js / wordsApprovalGate.js /
// interviewStyleClassifier.js for the pattern.
export const SUPABASE_URL = process.env.SUPABASE_URL
export const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

export function supabaseRest(path, init = {}, opts = {}) {
  const { timeoutMs, contentType, prefer } = opts
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...(timeoutMs ? { signal: AbortSignal.timeout(timeoutMs) } : {}),
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      ...(contentType ? { 'Content-Type': contentType } : {}),
      ...(prefer ? { Prefer: prefer } : {}),
      ...init.headers,
    },
  })
}
