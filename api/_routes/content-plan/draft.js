// POST /api/content-plan/draft  { atom_id }
// Generates content for one atom from the interview transcript (primary
// source) with the approved blog post passed in as editorial context.
// Creates a content_item and marks the atom as drafted.
export const config = { runtime: 'nodejs', maxDuration: 120 }

// The generation + voice-judge core AND the GBP per-location fan-out both moved
// into api/_lib/producer/draftAtom.js (P3 extraction) so the pre-draft cron path
// shares one implementation. This route keeps its req/res/auth/DB-write concerns.
import { waitUntil } from '@vercel/functions'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { recordAgentAction } from '../../_lib/agentActions.js'
import { draftAtom, buildGbpLocationVariants } from '../../_lib/producer/draftAtom.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey:        SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer:        'return=representation',
      ...init.headers,
    },
  })
}

const ok  = (res, data, status = 200) => res.status(status).json(data)
const err = (res, msg, status = 400)  => res.status(status).json({ error: msg })

export default async function handler(req, res) {
  if (req.method !== 'POST') return err(res, 'Method not allowed', 405)

  const ws = await workspaceContext(req)
  if (!ws) return err(res, 'Workspace not resolved', 400)

  const auth = await requireRole(req, EDITOR_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) {
    return res.status(auth.reason === 'forbidden' ? 403 : 401).json({ error: auth.reason })
  }

  if (!(await enforceLimit(req, res, 'ai', ws.id))) return

  const wsFilter = `workspace_id=eq.${ws.id}`

  const { atom_id } = req.body || {}
  if (!atom_id) return err(res, 'Missing atom_id')
  const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i
  if (!UUID_RE.test(atom_id)) return err(res, 'Invalid atom_id', 400)

  // Fetch the atom
  const atomRes = await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}&select=*`)
  if (!atomRes.ok) return err(res, 'Database error', 500)
  const atomRows = await atomRes.json()
  if (!atomRows.length) return err(res, 'Atom not found', 404)
  const atom = atomRows[0]

  if (!atom.interview_id) return err(res, 'This atom has no linked interview — backlog atoms must be linked to an interview before drafting', 422)
  if (atom.status === 'drafted') return err(res, 'Already drafted')
  if (atom.status === 'skipped') return err(res, 'Atom is skipped — reset to pending first')
  if (atom.status === 'drafting') return err(res, 'Already in progress', 409)

  // Mark drafting so concurrent clicks don't double-generate.
  // Filter on status=eq.pending so two simultaneous requests can't both claim the atom.
  const claimRes = await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}&status=eq.pending`, {
    method: 'PATCH',
    body: JSON.stringify({ status: 'drafting', updated_at: new Date().toISOString() }),
  })
  if (!claimRes.ok) return err(res, 'Database error', 500)
  const claimRows = await claimRes.json()
  if (!claimRows.length) return err(res, 'Already in progress', 409)

  let insertedContentPieceId = null

  try {
    // Fetch the interview (transcript = primary source; blog = editorial context)
    const ivRes = await sb(
      `interviews?id=eq.${atom.interview_id}&${wsFilter}&select=outputs,topic,tone,voice_mode,staff_id,location_id,created_at,messages,audience,story_type,region,theme`
    )
    if (!ivRes.ok) throw new Error('Could not fetch interview')
    const ivRows = await ivRes.json()
    if (!ivRows.length) throw new Error('Interview not found')
    const interview = ivRows[0]

    // Generation + voice-judge core (Standing Producer P3): extracted verbatim
    // into api/_lib/producer/draftAtom.js so the pre-draft cron path shares ONE
    // implementation. Behavior-identical to the prior inline block — same
    // grounding, model ids, and generateText params. The route keeps its own
    // req/res/auth/DB-write concerns (the atom claim above, the content_item
    // insert + GBP variants + agent-action below); `gbpContext` carries the
    // resolved grounding straight into buildGbpLocationVariants below.
    const {
      caption,
      slides,
      voiceScore,
      voiceAudit,
      voiceAttempts,
      staffName,
      aiMessages,
      gbpContext,
    } = await draftAtom({ ws, atom, interview })

    // Create the content_item. scheduled_at stays null until a reviewer
    // approves and picks a time — the prior "anchor + (slot-1) weeks"
    // pre-fill made every draft look committed to a calendar date before
    // anyone had agreed to it.
    const itemPayload = {
      workspace_id:   ws.id,
      interview_id:   atom.interview_id,
      staff_id:   interview.staff_id,
      staff_name: staffName,
      topic:          interview.topic,
      // Inherit the body-region / theme tag classified at interview completion
      // so the balance engine can account for this piece (see topicRegion.js).
      region:         interview.region ?? null,
      theme:          interview.theme ?? null,
      platform:       atom.platform,
      content:        caption,
      ai_original_content: caption,
      slides,
      overlay_text:   null,
      status:         'draft',
      media_urls:     [],
      location_id:    interview.location_id ?? null,
    }
    const itemRes = await sb('content_items', {
      method: 'POST',
      body: JSON.stringify(itemPayload),
    })
    if (!itemRes.ok) {
      const body = await itemRes.text()
      throw new Error(`Could not create content item: ${body}`)
    }
    const itemRows = await itemRes.json()
    const contentPiece = itemRows[0]
    insertedContentPieceId = contentPiece.id

    // Persist voice-judge score so /week can surface low-fidelity cards.
    // Non-blocking: a score failure never aborts the draft. `voiceAudit` (with
    // its 'passed'/'held'/'soft' gate tier) is computed in draftAtom — identical
    // to the prior inline computation.
    if (voiceScore) {
      waitUntil(
        sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({
            voice_fidelity_score: Math.round(voiceScore.overall * 10),
            voice_audit: voiceAudit,
            updated_at: new Date().toISOString(),
          }),
          headers: { Prefer: 'return=minimal' },
        }).catch((e) => console.warn('[draft] voice score persist failed:', e.message))
      )
    }

    // For GBP atoms: generate a per-location variant for every workspace_location
    // that has a gbp_location_id configured, so Google sees genuinely distinct
    // local copy per listing. Extracted into buildGbpLocationVariants (P3) so the
    // pre-draft path fans out identically. Failures are non-blocking (canonical kept).
    if (atom.platform === 'gbp') {
      const overrides = await buildGbpLocationVariants({
        ws, atom, interview, staffName, aiMessages, gbpContext,
      })
      if (Object.keys(overrides).length > 0) {
        await sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
          method: 'PATCH',
          body: JSON.stringify({ location_overrides: overrides, updated_at: new Date().toISOString() }),
          headers: { Prefer: 'return=minimal' },
        })
        contentPiece.location_overrides = overrides
      }
    }

    // Mark the atom as drafted
    const updatedAtomRes = await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({
        status:           'drafted',
        content_piece_id: contentPiece.id,
        updated_at:       new Date().toISOString(),
      }),
    })
    if (!updatedAtomRes.ok) throw new Error(`atom status update failed: ${updatedAtomRes.status}`)
    const updatedAtomRows = await updatedAtomRes.json()
    if (!updatedAtomRows.length) throw new Error('atom status update matched 0 rows — concurrent modification or workspace filter mismatch')

    // Workday ledger (Standing Producer Phase 0) — narrate the draft Bernard
    // just made. Gated on producer_config.enabled inside the helper; no-op when
    // the workspace hasn't hired Bernard. Never blocks the response.
    const draftScore = voiceScore ? Math.round(voiceScore.overall * 10) : null
    waitUntil(recordAgentAction({
      workspaceId:     ws.id,
      producerConfig:  ws.producer_config,
      kind:            'draft_created',
      title:           `Drafted "${interview.topic || 'a piece'}" for ${atom.platform}${draftScore !== null ? ` — voice ${draftScore}/100` : ''}`,
      detail:          { platform: atom.platform, angle: atom.angle, score: draftScore, attempts: voiceAttempts },
      contentItemId:   contentPiece.id,
      atomId:          atom.id,
      interviewId:     interview.id,
      model:           'anthropic/claude-haiku-4-5',
    }))

    return ok(res, {
      atom:          updatedAtomRows[0] ?? { ...atom, status: 'drafted', content_piece_id: contentPiece.id },
      content_piece: contentPiece,
    })
  } catch (e) {
    // Delete any content_items row inserted in this request before resetting the
    // atom — otherwise a partial failure (insert succeeded, later step failed)
    // leaves an orphaned draft row that permanently pollutes Stories/Library.
    let cleanupFailed = false
    if (insertedContentPieceId) {
      const deleteRes = await sb(`content_items?id=eq.${insertedContentPieceId}&${wsFilter}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      if (!deleteRes.ok) {
        cleanupFailed = true
        console.error('[content-plan/draft] cleanup delete failed', insertedContentPieceId, deleteRes.status)
      }
    }
    // Only reset the atom to pending when no orphan was left behind. If the cleanup
    // DELETE failed, resetting to pending would let the user retry and insert a
    // SECOND orphan content_items row; leaving the atom non-pending blocks the
    // retry until the stranded row is reconciled.
    if (!cleanupFailed) {
      await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
        method: 'PATCH',
        body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
        headers: { Prefer: 'return=minimal' },
      })
    }
    console.error('[content-plan/draft]', e.message)
    return err(res, 'draft_generation_failed', 500)
  }
}
