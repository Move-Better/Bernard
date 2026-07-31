// The Standing Producer's workday ledger writer (Phase 0).
//
// recordAgentAction() appends one row to agent_actions — the append-only feed
// rendered as "Bernard's workday" (/producer + the /week strip). Every
// meaningful thing the system does on a workspace's behalf calls this AFTER the
// primary write succeeds. Best-effort and NEVER throws: a failed ledger write
// must never break the action that triggered it (callers wrap in waitUntil or
// don't await). Cloned from the api/_lib/audit.js posture.
//
// Gating: writes only happen when the workspace has hired Bernard
// (producer_config.enabled). Callers that already hold the workspace row pass
// `producerConfig` to avoid a read; callers that don't (webhooks, per-item
// cron loops) omit it and the helper does one indexed PK lookup. A disabled
// workspace therefore costs at most one cheap read and writes nothing.

import { supabaseRest, SUPABASE_URL, SUPABASE_KEY } from './supabaseRest.js'


// Background writer: workspace_id is always supplied by the caller and every
// query is scoped by it. (require-workspace-scope only lints api/_routes/**.)
const sb = (path, init = {}) => supabaseRest(path, init, { timeoutMs: 8_000, contentType: 'application/json' })


async function fetchProducerConfig(workspaceId) {
  try {
    const r = await sb(`workspaces?id=eq.${workspaceId}&select=producer_config&limit=1`)
    if (!r.ok) return null
    const rows = await r.json().catch(() => [])
    return rows?.[0]?.producer_config ?? null
  } catch {
    return null
  }
}

/**
 * Append a workday-ledger row, if the workspace has the producer enabled.
 *
 * @param {object} a
 * @param {string} a.workspaceId               required
 * @param {string} a.kind                       action type (free text, e.g. 'draft_created')
 * @param {string} a.title                      one-line human summary (the standup line)
 * @param {object} [a.detail]                   structured extras (scores, counts, reason)
 * @param {object} [a.producerConfig]           the workspace's producer_config, if the caller has it
 * @param {string} [a.actor]                    defaults to 'bernard'
 * @param {string} [a.contentItemId]
 * @param {string} [a.atomId]
 * @param {string} [a.interviewId]
 * @param {string} [a.packageId]
 * @param {string} [a.inboxItemId]
 * @param {string} [a.model]                    LLM model id, when the action ran one
 * @param {number} [a.inputTokens]
 * @param {number} [a.outputTokens]
 * @returns {Promise<{ok: boolean, skipped?: string, status?: number}>}
 *   Best-effort and still never throws — but the OUTCOME is now reported so a
 *   caller whose ledger row is a measurement instrument (approval-escalation's
 *   nudge record) can surface a silent write failure instead of it looking, four
 *   weeks later, exactly like "this never happened". Existing callers ignore the
 *   return value and are unaffected.
 */
export async function recordAgentAction({
  workspaceId, kind, title, detail, producerConfig, actor,
  contentItemId, atomId, interviewId, packageId, inboxItemId,
  model, inputTokens, outputTokens,
}) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return { ok: false, skipped: 'no_credentials' }
  if (!workspaceId || !kind || !title) return { ok: false, skipped: 'missing_fields' }
  try {
    // Gate: caller-supplied config avoids a read; undefined → look it up.
    let cfg = producerConfig
    if (cfg === undefined) cfg = await fetchProducerConfig(workspaceId)
    if (!cfg?.enabled) return { ok: false, skipped: 'producer_disabled' }

    const body = {
      workspace_id:    workspaceId,
      actor:           actor || 'bernard',
      kind,
      title:           String(title).slice(0, 300),
      detail:          detail ?? null,
      content_item_id: contentItemId ?? null,
      atom_id:         atomId ?? null,
      interview_id:    interviewId ?? null,
      package_id:      packageId ?? null,
      inbox_item_id:   inboxItemId ?? null,
      model:           model ?? null,
      input_tokens:    Number.isFinite(inputTokens) ? inputTokens : null,
      output_tokens:   Number.isFinite(outputTokens) ? outputTokens : null,
    }
    const r = await sb('agent_actions', {
      method: 'POST',
      headers: { Prefer: 'return=minimal' },
      body: JSON.stringify(body),
    })
    if (!r.ok) {
      console.error(`[agentActions] insert failed: ${r.status} ${(await r.text().catch(() => '')).slice(0, 200)}`)
      return { ok: false, status: r.status }
    }
    return { ok: true }
  } catch (e) {
    console.error('[agentActions] threw:', e?.message)
    return { ok: false, error: e?.message }
  }
}
