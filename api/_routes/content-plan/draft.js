// POST /api/content-plan/draft  { atom_id }
// Generates content for one atom from the interview transcript (primary
// source) with the approved blog post passed in as editorial context.
// Creates a content_item and marks the atom as drafted.
export const config = { runtime: 'nodejs', maxDuration: 120 }

import { generateText } from 'ai'
import { workspaceContext } from '../../_lib/workspaceContext.js'
import { requireRole } from '../../_lib/auth.js'
import { EDITOR_ROLES } from '../../_lib/roles.js'
import { enforceLimit } from '../../_lib/ratelimit.js'
import { getAtomSystemPrompt } from '../../_lib/atomPrompts.js'
import { getContextBlock } from '../../_lib/conceptRetrieval.js'
import { resolveOwnHistoryBlock, buildRagQuery } from '../../_lib/practiceMemory.js'
import {
  loadCurrentTentpole,
  getTentpolePromptContext,
  resolveCampaignSubjectLocation,
  buildTentpoleGbpLocationBlock,
} from '../../_lib/tentpoleCampaignContext.js'
import { extractProvenanceBlock } from '../../../src/lib/provenance.js'
import { buildFidelityPrompt, parseFidelity } from '../../_lib/captionFidelityRubric.js'

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
      `interviews?id=eq.${atom.interview_id}&${wsFilter}&select=outputs,topic,tone,voice_mode,staff_id,location_id,created_at,messages,audience,story_type`
    )
    if (!ivRes.ok) throw new Error('Could not fetch interview')
    const ivRows = await ivRes.json()
    if (!ivRows.length) throw new Error('Interview not found')
    const interview = ivRows[0]

    const blogPost = interview.outputs?.blogPost || null

    const turns = Array.isArray(interview.messages) ? interview.messages : []
    if (!turns.length) throw new Error('Interview transcript missing — cannot generate atom')

    // Fetch clinician name + voice substrate
    let staffName = ''
    let voiceNotes    = ''
    let voicePhrases  = []
    const [clinRes, phrasesRes] = await Promise.all([
      sb(`staff?id=eq.${interview.staff_id}&${wsFilter}&select=name,voice_notes`),
      sb(
        `staff_voice_phrases?staff_id=eq.${interview.staff_id}&${wsFilter}` +
        `&select=phrase&order=weight.desc,last_seen_at.desc&limit=8`,
      ),
    ])
    if (clinRes.ok) {
      const clinRows = await clinRes.json()
      staffName = clinRows[0]?.name ?? ''
      voiceNotes    = clinRows[0]?.voice_notes ?? ''
    }
    if (phrasesRes.ok) {
      voicePhrases = await phrasesRes.json()
    }

    // Augment with learned practice knowledge from the concept graph (non-blocking).
    const conceptBlock = await getContextBlock({ workspaceId: ws.id, topic: interview.topic })

    // Resolve audience + story_type keys to display labels for prompt injection.
    // Prefer the workspace's current slot object (admin may have renamed the label)
    // over the raw key string.
    const audienceLabel = interview.audience
      ? (Array.isArray(ws.audience_options) ? ws.audience_options.find(s => s.key === interview.audience) : null)?.label ?? interview.audience
      : null
    const storyTypeLabel = interview.story_type
      ? (Array.isArray(ws.story_type_options) ? ws.story_type_options.find(s => s.key === interview.story_type) : null)?.label ?? interview.story_type
      : null

    // Active tentpole campaign flows into derivative content only. Picks the
    // highest-weighted active campaign in this workspace (event proximity
    // weighting per api/_lib/activeCampaigns.js → campaignWeight). Returns
    // null when nothing is active → empty campaignContext → atoms use their
    // default per-platform CTAs. Blog generation does NOT call this; blogs
    // are intentionally evergreen.
    // Pass staff_id so per-clinician-targeted campaigns are honored —
    // a campaign with non-empty target_staff_ids only applies to atoms
    // produced for clinicians on its target list.
    const activeCampaign = await loadCurrentTentpole(ws.id, interview.staff_id || null)
    const campaignContext = await getTentpolePromptContext(activeCampaign, ws)

    // A2 — GBP cross-promo. Resolve the active campaign's subject location ONCE
    // so the per-listing GBP loop below can tailor each Google listing
    // (we're-here vs sister-clinic cross-promo) without an N+1 fetch. Null when
    // the campaign has no location aim → the GBP loop keeps today's per-listing
    // local copy.
    const gbpSubjectLocation = await resolveCampaignSubjectLocation(activeCampaign, ws)

    // Phase 5 Feature 2 — this clinician's prior thinking block, shared
    // across the canonical atom call below AND any per-location GBP variant
    // calls that follow. Resolved once to avoid N+1 Supabase round-trips
    // when a workspace has many GBP locations.
    const ownHistoryBlock = interview.staff_id
      ? await resolveOwnHistoryBlock({
          workspaceId:        ws.id,
          staffId:        interview.staff_id,
          excludeInterviewId: interview.id,
          query:              buildRagQuery(interview),
        })
      : ''

    // Build the focused atom prompt
    const systemPrompt = getAtomSystemPrompt(
      ws,
      staffName,
      interview.topic,
      atom.platform,
      atom.angle,
      interview.voice_mode || 'practice',
      interview.tone || 'smart',
      voiceNotes,
      (ws.brand_guidelines || '') + conceptBlock,
      voicePhrases,
      audienceLabel,
      storyTypeLabel,
      campaignContext,
      ownHistoryBlock,
    )
    if (!systemPrompt) throw new Error(`No prompt defined for ${atom.platform}/${atom.angle}`)

    // Replay the interview as the original conversation, then ask for the atom.
    // The transcript is the primary source of truth; if a blog post exists it is
    // included as editorial context only (thematic alignment, not wording source).
    const editorialBlock = blogPost
      ? `\n\nHere is the editorial summary that has already been written on this topic:\n\n` +
        `<editorial-summary>\n${blogPost}\n</editorial-summary>\n\nUse it only for thematic alignment — pull voice, examples, and specifics from our conversation above.`
      : ''
    const aiMessages = [
      ...turns.map((m) => ({ role: m.role, content: m.content })),
      {
        role: 'user',
        content:
          `Now write the ${atom.platform} piece (angle: ${atom.angle}) per the instructions in the system prompt. ` +
          `Pull voice, examples, and specifics from our conversation above — that is the source of truth.` +
          editorialBlock,
      },
    ]

    // Call the AI — first attempt
    const { text: rawText1 } = await generateText({
      model: 'anthropic/claude-sonnet-4-6',
      system: systemPrompt,
      messages: aiMessages,
      maxOutputTokens: 1000,
    })

    if (!rawText1?.trim()) throw new Error('AI returned empty content')

    // Voice-judge gate: score the draft against the interview transcript + voice
    // profile. If below threshold, try once more with the red_flag as coaching.
    const HAIKU = 'anthropic/claude-haiku-4-5'
    const GATE  = 6.5
    const clinicianSaid = turns
      .filter((t) => t.role === 'user')
      .map((t) => t.content)
      .join('\n\n')
      .slice(0, 2500)
    const caption1 = extractProvenanceBlock(rawText1.trim()).content.split('---SLIDES---')[0].trim()

    let rawText      = rawText1
    let voiceScore   = null
    let voiceAttempts = 1

    try {
      const ep1 = buildFidelityPrompt({
        topic: interview.topic, caption: caption1,
        transcript: clinicianSaid, phrases: voicePhrases,
        staffName, workspaceName: ws.name || ws.slug || 'practice',
      })
      const { text: evalRaw1 } = await generateText({
        model: HAIKU, system: ep1.system,
        messages: [{ role: 'user', content: ep1.user }],
        maxOutputTokens: 240,
      })
      voiceScore = parseFidelity(evalRaw1, {
        model: HAIKU, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(),
      })
    } catch (e) {
      console.warn('[draft] voice-judge eval-1 failed:', e.message)
    }

    if (voiceScore && voiceScore.overall < GATE) {
      const redFlag = voiceScore.breakdown?.red_flag || 'voice drift from transcript'
      try {
        const { text: rawText2 } = await generateText({
          model: 'anthropic/claude-sonnet-4-6',
          system: systemPrompt,
          messages: [
            ...aiMessages,
            { role: 'assistant', content: rawText1.trim() },
            {
              role: 'user',
              content: `That draft was flagged: "${redFlag}". Please rewrite it, staying much closer to the actual words and speaking style from our conversation. Don't smooth or professionalize — capture what was actually said.`,
            },
          ],
          maxOutputTokens: 1000,
        })
        if (rawText2?.trim()) {
          voiceAttempts = 2
          rawText = rawText2
          const caption2 = extractProvenanceBlock(rawText2.trim()).content.split('---SLIDES---')[0].trim()
          const ep2 = buildFidelityPrompt({
            topic: interview.topic, caption: caption2,
            transcript: clinicianSaid, phrases: voicePhrases,
            staffName, workspaceName: ws.name || ws.slug || 'practice',
          })
          const { text: evalRaw2 } = await generateText({
            model: HAIKU, system: ep2.system,
            messages: [{ role: 'user', content: ep2.user }],
            maxOutputTokens: 240,
          })
          const score2 = parseFidelity(evalRaw2, {
            model: HAIKU, rubric: 'faithfulness-v2', scored_at: new Date().toISOString(),
          })
          if (score2) voiceScore = score2
        }
      } catch (e) {
        console.warn('[draft] voice-judge regen failed:', e.message)
        rawText = rawText1  // keep first attempt on regen failure
      }
    }

    // Split slides block from caption on the final rawText. Instagram prompts
    // append a ---SLIDES--- JSON section; other platforms don't. Also strip
    // the <PROVENANCE> trailer — it's metadata, not body copy.
    const [captionRaw, slidesRaw] = extractProvenanceBlock(rawText.trim()).content.split('---SLIDES---')
    const caption = captionRaw.trim()

    let slides = null
    if (slidesRaw) {
      try {
        const jsonStr = slidesRaw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
        const parsed = JSON.parse(jsonStr)
        if (Array.isArray(parsed) && parsed.length > 0) {
          slides = parsed
            .filter((s) => s && typeof s === 'object')
            .map((s) => ({
              photo_idx: null,
              template: typeof s.template === 'string' ? s.template : 'custom',
              blocks: Array.isArray(s.blocks)
                ? s.blocks
                    .filter((b) => b && typeof b === 'object' && typeof b.text === 'string' && b.text.trim() !== '')
                    .map((b) => ({
                      role: typeof b.role === 'string' ? b.role : 'body',
                      text: b.text.trim(),
                      position: b.position ?? 'center',
                    }))
                : [],
            }))
            .filter((s, idx) => idx === 0 || s.blocks.length > 0 || s.template === 'demonstration')
          if (slides.length === 0) slides = null
        }
      } catch (e) {
        console.warn('[draft] Failed to parse ---SLIDES--- JSON:', e.message)
        slides = null
      }
    }

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
    // Non-blocking: a score failure never aborts the draft.
    if (voiceScore) {
      sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
        method: 'PATCH',
        body: JSON.stringify({
          voice_fidelity_score: Math.round(voiceScore.overall * 10),
          voice_audit: { ...voiceScore.breakdown, attempts: voiceAttempts },
          updated_at: new Date().toISOString(),
        }),
        headers: { Prefer: 'return=minimal' },
      }).catch((e) => console.warn('[draft] voice score persist failed:', e.message))
    }

    // For GBP atoms: generate a per-location variant for every workspace_location
    // that has a gbp_location_id configured. Each variant uses the same interview
    // conversation but a location-patched system prompt (different location_keyword /
    // city), so Google sees genuinely distinct local copy on each listing rather
    // than the same text fanned out. Failures are non-blocking — canonical is kept.
    if (atom.platform === 'gbp') {
      const locsRes = await sb(
        `workspace_locations?workspace_id=eq.${ws.id}&status=eq.active&gbp_location_id=not.is.null` +
        `&select=id,label,city,location_keyword`,
      )
      const locations = locsRes.ok ? ((await locsRes.json()) ?? []) : []
      if (locations.length > 0) {
        const variantEntries = await Promise.all(
          locations.map(async (loc) => {
            try {
              const locWs = { ...ws, location_keyword: loc.location_keyword ?? loc.city }
              // A2 — tailor the campaign focus block for THIS listing when the
              // active campaign promotes a location: the subject's own listing
              // gets "we're here" copy, every other listing cross-promotes the
              // sister clinic. Falls back to the shared workspace-wide block
              // when there's no location aim.
              const locCampaignContext = gbpSubjectLocation
                ? buildTentpoleGbpLocationBlock({
                    campaign: activeCampaign,
                    workspace: ws,
                    publishingLocation: loc,
                    subjectLocation: gbpSubjectLocation,
                  })
                : campaignContext
              const locPrompt = getAtomSystemPrompt(
                locWs,
                staffName,
                interview.topic,
                'gbp',
                atom.angle,
                interview.voice_mode || 'practice',
                interview.tone || 'smart',
                voiceNotes,
                (ws.brand_guidelines || '') + conceptBlock,
                voicePhrases,
                audienceLabel,
                storyTypeLabel,
                locCampaignContext,
                ownHistoryBlock,
              )
              if (!locPrompt) return null
              const { text: locText } = await generateText({
                model: 'anthropic/claude-sonnet-4-6',
                system: locPrompt,
                messages: aiMessages,
                maxOutputTokens: 1000,
              })
              if (!locText?.trim()) return null
              return [loc.id, {
                content:       extractProvenanceBlock(locText.trim()).content,
                location_name: loc.label ?? loc.city,
                generated_at:  new Date().toISOString(),
              }]
            } catch (locErr) {
              console.error('[content-plan/draft] location variant failed', loc.id, locErr.message)
              return null
            }
          }),
        )
        const overrides = Object.fromEntries(variantEntries.filter(Boolean))
        if (Object.keys(overrides).length > 0) {
          await sb(`content_items?id=eq.${contentPiece.id}&${wsFilter}`, {
            method: 'PATCH',
            body: JSON.stringify({ location_overrides: overrides, updated_at: new Date().toISOString() }),
            headers: { Prefer: 'return=minimal' },
          })
          contentPiece.location_overrides = overrides
        }
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

    return ok(res, {
      atom:          updatedAtomRows[0] ?? { ...atom, status: 'drafted', content_piece_id: contentPiece.id },
      content_piece: contentPiece,
    })
  } catch (e) {
    // Delete any content_items row inserted in this request before resetting the
    // atom — otherwise a partial failure (insert succeeded, later step failed)
    // leaves an orphaned draft row that permanently pollutes Stories/Library.
    if (insertedContentPieceId) {
      const deleteRes = await sb(`content_items?id=eq.${insertedContentPieceId}&${wsFilter}`, {
        method: 'DELETE',
        headers: { Prefer: 'return=minimal' },
      })
      if (!deleteRes.ok) console.error('[content-plan/draft] cleanup delete failed', insertedContentPieceId, deleteRes.status)
    }
    // Reset atom to pending so the user can retry
    await sb(`content_plan_atoms?id=eq.${atom_id}&${wsFilter}`, {
      method: 'PATCH',
      body: JSON.stringify({ status: 'pending', updated_at: new Date().toISOString() }),
      headers: { Prefer: 'return=minimal' },
    })
    console.error('[content-plan/draft]', e.message)
    return err(res, e.message || 'Draft generation failed', 500)
  }
}
