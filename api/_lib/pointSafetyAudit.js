// api/_lib/pointSafetyAudit.js
//
// Phase 2b of "Make a point" (.claude/make-a-point-spec.md) — the advisory
// safety-flag chip. Phase 2's pointContentFraming.js applies non-diagnostic
// FRAMING at generation time (long-form point content may hedge a mechanism,
// short-form may not). This module is the VERIFICATION layer: an independent
// judge checks whether the generated draft actually held that framing, the
// same "validate the validator" relationship voiceAudit.js has to generation
// — it does not re-decide what's allowed, it checks whether the model
// complied with what was already decided.
//
// Scope: LONG-FORM point content only (blog, newsletter, series parts) — see
// pointContentFraming.js for why short-form has no mechanism-claim surface to
// check in the first place. Triggered from the same two real call sites
// voiceAudit.js already has (InterviewSession.jsx generate,
// blog-regen-finalize.js), gated on isPoint. Never wired into short-form atom
// drafting.
//
// Structurally mirrors voiceAudit.js (generateObject + zod, patch-on-
// content_items, never throws — every failure path records a marker and
// returns a structured result so callers can fire-and-forget). Persists to
// its OWN columns (point_safety_score / point_safety_audit), never
// voice_fidelity_score/voice_audit — this is a different axis (does the
// content overclaim a mechanism or get prescriptive) from voice fidelity
// (does it sound like the clinician), and conflating the two columns would
// be exactly the kind of validator drift this codebase has been burned by.
//
// The rubric prompt itself is getPointSafetyAuditSystemPrompt in
// src/lib/prompts.js — same split as voiceAudit.js/getVoiceAuditSystemPrompt:
// this file orchestrates (fetch, call, persist), prompts.js owns the rubric
// text, so the prompt stays testable without a DB or a model call.

import { generateObject } from 'ai'
import { z } from 'zod'
import { getPointSafetyAuditSystemPrompt } from '../../src/lib/prompts.js'
import { supabaseRest } from './supabaseRest.js'

const MODEL = 'anthropic/claude-sonnet-4-6'
const GATE_THRESHOLD = 75 // matches ANSWER_GATE (7.5/10) — same calibrated bar, same stakes

const sb = (path, init = {}) => supabaseRest(path, init, { contentType: 'application/json', prefer: 'return=representation' })

const pointSafetySchema = z.object({
  safety_score: z.number().int().min(0).max(100),
  red_flag: z.string().describe("The exact offending sentence, quoted verbatim, or 'none' if the draft is safe."),
})

async function patchItem(wsId, contentItemId, patch) {
  return sb(`content_items?id=eq.${contentItemId}&workspace_id=eq.${wsId}`, {
    method: 'PATCH',
    body: JSON.stringify(patch),
  }).catch((err) => {
    console.error('[pointSafetyAudit] patchItem network error:', err?.message || err)
    return null
  })
}

/**
 * Audit one long-form point-content draft and persist the result.
 * Workspace-scoped. Never throws — every failure path records a marker.
 * @param {{ id: string }} ws
 * @param {string} contentItemId
 * @returns {Promise<{ ok: boolean, audited: boolean, score?: number, gate?: string, reason?: string }>}
 */
export async function auditPointContentSafety(ws, contentItemId) {
  if (!ws?.id) return { ok: false, audited: false, reason: 'no_workspace' }
  if (!contentItemId) return { ok: false, audited: false, reason: 'no_content_item' }
  const wsFilter = `workspace_id=eq.${ws.id}`

  const itemRes = await sb(`content_items?id=eq.${contentItemId}&${wsFilter}&select=id,content`)
  if (!itemRes.ok) return { ok: false, audited: false, reason: 'item_fetch_failed' }
  const itemRows = await itemRes.json().catch(() => [])
  if (!itemRows.length) return { ok: false, audited: false, reason: 'item_not_found' }
  const item = itemRows[0]
  if (!item.content?.trim()) return { ok: false, audited: false, reason: 'empty_content' }

  const { instructions, user } = getPointSafetyAuditSystemPrompt(item.content)

  let result = null
  try {
    const { object } = await generateObject({
      model: MODEL,
      schema: pointSafetySchema,
      instructions,
      messages: [{ role: 'user', content: user }],
      temperature: 0.2,
    })
    result = object
  } catch (e) {
    console.error(`[pointSafetyAudit] model call failed for ${contentItemId}: ${e?.message}`)
    await patchItem(ws.id, contentItemId, {
      point_safety_score: null,
      point_safety_audit: { gate: 'unscored', error: 'audit_failed', audited_at: new Date().toISOString() },
    })
    return { ok: false, audited: false, reason: 'audit_failed' }
  }

  const gate = result.safety_score >= GATE_THRESHOLD ? 'passed' : 'held'
  const pointSafetyAudit = {
    gate,
    threshold: GATE_THRESHOLD,
    red_flag: result.red_flag,
    model: MODEL,
    audited_at: new Date().toISOString(),
  }

  const upd = await patchItem(ws.id, contentItemId, {
    point_safety_score: result.safety_score,
    point_safety_audit: pointSafetyAudit,
  })
  if (!upd || !upd.ok) {
    console.error(`[pointSafetyAudit] persist failed for ${contentItemId}`)
    return { ok: false, audited: false, reason: 'persist_failed' }
  }

  return { ok: true, audited: true, score: result.safety_score, gate }
}
