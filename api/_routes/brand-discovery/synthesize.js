// Synthesizer for the brand-discovery interview. Reads a `completed` row, runs
// the transcript through Claude with the brand-brief synthesis prompt, and
// writes the result to workspaces.brand_brief. Mirrors api/_routes/onboarding/
// synthesize.js (atomic claim + dry-run + revert-on-failure).
//
// Synchronous (no queue). Typical run: ~15–30s on Sonnet. Well within 300s.
export const config = { runtime: 'nodejs', maxDuration: 300 }

import { randomUUID } from 'node:crypto'
import { generateText } from 'ai'
import { workspaceContext, invalidateWorkspaceCacheById, invalidateWorkspaceCacheBySlug } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import {
  getBrandSynthesisSystemPrompt,
  BRAND_SYNTHESIS_PROMPT_VERSION,
} from '../../../src/lib/brandSynthesisPrompt.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const MODEL_ID = 'claude-sonnet-4-6'

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

async function dbErr(res, r, msg = 'Database error', status = 500) {
  const body = await r.text().catch(() => '')
  console.error(`[brand-discovery/synthesize] ${msg} — supabase ${r.status}: ${body.slice(0, 500)}`)
  return res.status(status).json({ error: msg })
}

// Strip a leading ```json fence some models emit despite instructions.
function stripFences(text) {
  const trimmed = String(text || '').trim()
  if (!trimmed.startsWith('```')) return trimmed
  return trimmed.replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
}

// Validate the parsed brief has the right SHAPE (not content — that's the
// model's job). Throws on missing/empty required fields; returns a normalized
// object so downstream code doesn't re-defend.
function validateBrief(parsed) {
  if (!parsed || typeof parsed !== 'object') throw new Error('Brief output not an object')

  const territory = Array.isArray(parsed.territory)
    ? parsed.territory.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim()).slice(0, 3)
    : []
  if (territory.length === 0) throw new Error('territory missing or empty')

  const notThis = Array.isArray(parsed.notThis)
    ? parsed.notThis.filter((s) => typeof s === 'string' && s.trim()).map((s) => s.trim())
    : []

  const emotionalPromise = typeof parsed.emotionalPromise === 'string' ? parsed.emotionalPromise.trim() : ''
  if (!emotionalPromise) throw new Error('emotionalPromise missing or empty')

  const tension = typeof parsed.tension === 'string' ? parsed.tension.trim() : ''

  const visualAnchors = Array.isArray(parsed.visualAnchors)
    ? parsed.visualAnchors
        .filter((a) => a && typeof a.reference === 'string' && a.reference.trim())
        .map((a) => ({
          reference: a.reference.trim(),
          why: typeof a.why === 'string' ? a.why.trim() : '',
        }))
        .slice(0, 3)
    : []

  return { territory, notThis, emotionalPromise, tension, visualAnchors }
}

// Serialize the transcript as Founder/Bernard turns for the prompt.
function formatTranscript(messages, founderName) {
  return messages
    .filter((m) => m && (m.role === 'user' || m.role === 'assistant'))
    .map((m) => {
      const speaker = m.role === 'user' ? founderName : 'Bernard'
      return `${speaker}:\n${String(m.content || '').trim()}`
    })
    .join('\n\n')
}

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, ['admin'], { orgId: ws.clerk_org_id })
  if (!auth.ok) return err(res, auth.reason, auth.reason === 'forbidden' ? 403 : 401)

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  if (!process.env.AI_GATEWAY_API_KEY) {
    return err(res, 'AI_GATEWAY_API_KEY is not set on this deployment', 500)
  }

  const { id, founderName, dryRun } = req.body || {}
  if (!id) return err(res, 'Missing id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(id)) return err(res, 'Invalid id')
  const isDryRun = dryRun === true

  // Load the interview row. Workspace filter is the multi-tenant fence.
  const loadR = await sb(
    `brand_discovery_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&select=id,staff_id,owner_id,messages,status`
  )
  if (!loadR.ok) return dbErr(res, loadR, 'Load failed')
  const interview = (await loadR.json())[0]
  if (!interview) return err(res, 'Not found', 404)
  if (interview.owner_id !== auth.userId) return err(res, 'Forbidden', 403)

  const allowedStatuses = isDryRun ? ['completed', 'synthesized'] : ['completed']
  if (!allowedStatuses.includes(interview.status)) {
    return err(res, 'interview_not_synthesizable', 409)
  }

  const messages = Array.isArray(interview.messages) ? interview.messages : []
  if (messages.length < 2) return err(res, 'Transcript too short to synthesize', 422)

  // ── Atomic claim (real runs only) ──────────────────────────────────────
  // Flip status 'completed' → 'synthesizing' with a conditional PATCH so
  // concurrent callers can't both run Claude and both clobber brand_brief.
  if (!isDryRun) {
    const claimR = await sb(
      `brand_discovery_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&status=eq.completed`,
      {
        method: 'PATCH',
        body: JSON.stringify({ status: 'synthesizing', updated_at: new Date().toISOString() }),
      }
    )
    if (!claimR.ok) return dbErr(res, claimR, 'Claim failed')
    const claimRows = await claimR.json()
    if (!claimRows.length) {
      return err(res, 'Another synthesis is already in flight or has already completed', 409)
    }
  }

  // Revert status to 'completed' on failure BEFORE the brand_brief write
  // succeeds, so the user can retry. Never revert after the write lands.
  const revertClaim = async () => {
    try {
      await sb(
        `brand_discovery_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}&status=eq.synthesizing`,
        {
          method: 'PATCH',
          body: JSON.stringify({ status: 'completed', updated_at: new Date().toISOString() }),
        }
      )
    } catch (e) {
      console.error('[brand-discovery/synthesize] revert claim failed:', e?.message)
    }
  }

  // Load the founder's staff name + workspace display name for the prompt.
  const fname = (founderName || '').trim() || 'Founder'
  const [staffR, wsR] = await Promise.all([
    interview.staff_id
      ? sb(`staff?id=eq.${interview.staff_id}&workspace_id=eq.${ws.id}&select=id,name`)
      : Promise.resolve({ ok: true, json: async () => [] }),
    sb(`workspaces?id=eq.${ws.id}&select=display_name,brand_brief`),
  ])
  if (!staffR.ok) { await revertClaim(); return dbErr(res, staffR, 'Staff load failed') }
  if (!wsR.ok)    { await revertClaim(); return dbErr(res, wsR,    'Workspace load failed') }

  const staffMember = (await staffR.json())[0] || null
  const wsRow = (await wsR.json())[0] || {}
  const wsForPrompt = { display_name: wsRow.display_name || ws.display_name }
  const founderDisplayName = staffMember?.name || fname

  // Run synthesis.
  const systemPrompt = getBrandSynthesisSystemPrompt(wsForPrompt, founderDisplayName)
  const userContent = `TRANSCRIPT:\n\n${formatTranscript(messages, founderDisplayName)}`

  let rawText
  try {
    const { text } = await generateText({
      model: `anthropic/${MODEL_ID}`,
      instructions: systemPrompt,
      messages: [{ role: 'user', content: userContent }],
      maxOutputTokens: 2048,
    })
    rawText = text
  } catch (e) {
    console.error('[brand-discovery/synthesize] generateText failed:', e?.message)
    await revertClaim()
    return err(res, 'synthesis_failed', 502)
  }

  let parsed
  try {
    parsed = JSON.parse(stripFences(rawText))
  } catch {
    console.error('[brand-discovery/synthesize] JSON parse failed; raw (first 1000):', String(rawText).slice(0, 1000))
    await revertClaim()
    return err(res, 'Synthesizer returned non-JSON output', 502)
  }

  let brief
  try {
    brief = validateBrief(parsed)
  } catch (e) {
    console.error('[brand-discovery/synthesize] validation failed:', e?.message, 'parsed:', JSON.stringify(parsed).slice(0, 1000))
    await revertClaim()
    return err(res, 'synthesis_validation_failed', 502)
  }

  // Tag interview-derived anchors and PRESERVE any user-curated ones (added via
  // /api/brand-discovery/anchors) so a retake never wipes uploaded references.
  const prevAnchors = Array.isArray(wsRow.brand_brief?.visualAnchors) ? wsRow.brand_brief.visualAnchors : []
  const userAnchors = prevAnchors.filter((a) => a && (a.source === 'user' || a.imageUrl))
  const interviewAnchors = brief.visualAnchors.map((a) => ({ id: randomUUID(), ...a, source: 'interview' }))
  brief.visualAnchors = [...interviewAnchors, ...userAnchors]

  const briefPayload = {
    ...brief,
    model: MODEL_ID,
    prompt_version: BRAND_SYNTHESIS_PROMPT_VERSION,
    synthesized_at: new Date().toISOString(),
  }

  // ── DRY RUN: short-circuit before any writes ────────────────────────────
  if (isDryRun) {
    return ok(res, { ok: true, dryRun: true, brief: briefPayload })
  }

  // ── Write the brief to the workspace ────────────────────────────────────
  const patchR = await sb(`workspaces?id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({ brand_brief: briefPayload }),
  })
  if (!patchR.ok) { await revertClaim(); return dbErr(res, patchR, 'Workspace update failed') }
  invalidateWorkspaceCacheById(ws.id)
  invalidateWorkspaceCacheBySlug(ws.slug)

  // ── Mark synthesis complete on the interview row ────────────────────────
  // Do NOT revert here — the brand_brief write already landed.
  const markR = await sb(`brand_discovery_interviews?id=eq.${encodeURIComponent(id)}&workspace_id=eq.${ws.id}`, {
    method: 'PATCH',
    body: JSON.stringify({
      status: 'synthesized',
      synthesized_at: new Date().toISOString(),
      synthesis_result: briefPayload,
      updated_at: new Date().toISOString(),
    }),
  })
  if (!markR.ok) {
    console.error(`[brand-discovery/synthesize] markR failed after brief write — interview ${id} stuck in synthesizing. Manual fix: UPDATE brand_discovery_interviews SET status='synthesized' WHERE id='${id}'`)
    return dbErr(res, markR, 'Brand brief saved but interview status update failed — your brief is ready. Contact support if this persists.')
  }

  return ok(res, { ok: true, brief: briefPayload })
}
