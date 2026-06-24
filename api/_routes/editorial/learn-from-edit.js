// POST /api/editorial/learn-from-edit
//
// Phase 8 — AI learns from clinician direct edits.
//
// When a clinician edits a blog or caption in the editor and saves, the
// changed phrases are captured into staff_voice_phrases so future drafts
// lean toward how they actually phrase things.
//
// Body: { original: string, edited: string, staff_id: string, piece_id: string }
//
// Response 200: { captured: number }
// This endpoint is best-effort: errors are logged but not surfaced to the user.
// The save flow must NEVER be blocked or failed by this call.

export const config = { runtime: 'nodejs' }

import { requireRole } from '../../_lib/auth.js'
import { ALL_KNOWN_ROLES } from '../../_lib/roles.js'
import { workspaceContext } from '../../_lib/workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY
const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i

// Max phrases to capture per save — keeps noise low and prevents flooding the
// voice library when a user pastes in a whole new document.
const MAX_PHRASES_PER_SAVE = 5

// Minimum sentence length to consider. Short fragments ("OK", "Yes") aren't
// useful as voice exemplars.
const MIN_SENTENCE_CHARS = 20

// Minimum total character diff to trigger capture at all. If they only fixed
// a typo, skip it.
const MIN_DIFF_CHARS = 10

function sb(path, init = {}) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
      ...init.headers,
    },
  })
}

/**
 * Split text into sentences on . ! ? boundaries.
 * Tolerates multi-paragraph content; returns non-empty trimmed strings only.
 */
function splitSentences(text) {
  return text
    .split(/(?<=[.!?])\s+/)
    .map((s) => s.trim())
    .filter((s) => s.length > 0)
}

/**
 * Normalize a phrase for dedup: lowercase, strip leading/trailing whitespace
 * and terminal punctuation. Matches the unique index on phrase_normalized.
 */
function normalizePhrase(phrase) {
  return phrase.toLowerCase().trim().replace(/[.!?,;:]+$/, '').trim()
}

/**
 * Rough content-diff: count characters that appear only in one string.
 * Measures actual rewrite depth, not just length delta — so "foo bar" → "bar baz"
 * (same length, completely different content) registers as a real change.
 * Uses a character-frequency bag approach: extra chars in either string are diff.
 */
function charDiff(a, b) {
  if (a === b) return 0
  const freq = {}
  for (const c of a) freq[c] = (freq[c] || 0) + 1
  for (const c of b) freq[c] = (freq[c] || 0) - 1
  return Object.values(freq).reduce((sum, v) => sum + Math.abs(v), 0)
}

/**
 * Find sentences in `edited` that are meaningfully new relative to `original`.
 * A sentence is "new" if:
 *   - it is NOT a substring of the original text (the whole sentence isn't already there)
 *   - the original is NOT a substring of it (it didn't just get minor punctuation added)
 *   - it is at least MIN_SENTENCE_CHARS chars long
 */
function findNewSentences(original, edited) {
  const sentences = splitSentences(edited)
  return sentences.filter((sentence) => {
    if (sentence.length < MIN_SENTENCE_CHARS) return false
    // Inclusion check — if the sentence already appeared in original verbatim, skip
    if (original.includes(sentence)) return false
    // Reverse inclusion — if the sentence is essentially the original sentence with
    // a word added, the original sentence would be a substring of it
    const inOriginalSentences = splitSentences(original).some(
      (orig) => orig.length >= MIN_SENTENCE_CHARS && sentence.includes(orig),
    )
    if (inOriginalSentences) return false
    return true
  })
}

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const ws = await workspaceContext(req)
  if (!ws) return res.status(404).json({ error: 'no_workspace' })

  const auth = await requireRole(req, ALL_KNOWN_ROLES, { orgId: ws.clerk_org_id })
  if (!auth.ok) return res.status(401).json({ error: auth.reason })

  const { original, edited, staff_id, piece_id } = req.body ?? {}

  // Validate required fields
  if (typeof original !== 'string' || typeof edited !== 'string') {
    return res.status(400).json({ error: 'original and edited must be strings' })
  }
  if (!staff_id) {
    return res.status(400).json({ error: 'staff_id is required' })
  }
  if (!UUID_RE.test(staff_id)) {
    return res.status(400).json({ error: 'invalid staff_id' })
  }

  // Verify staff_id belongs to this workspace — prevents poisoning another
  // tenant's voice library by supplying a cross-workspace staff UUID.
  const staffChk = await sb(`staff?id=eq.${encodeURIComponent(staff_id)}&workspace_id=eq.${ws.id}&select=id&limit=1`)
  const staffRows = staffChk.ok ? await staffChk.json() : []
  if (!staffRows.length) {
    return res.status(403).json({ error: 'staff_not_in_workspace' })
  }

  // Skip if identical or trivially different
  if (original === edited) {
    return res.status(200).json({ captured: 0 })
  }
  if (charDiff(original, edited) < MIN_DIFF_CHARS) {
    return res.status(200).json({ captured: 0 })
  }

  // Find new sentences in the edited text
  const candidates = findNewSentences(original, edited).slice(0, MAX_PHRASES_PER_SAVE)

  if (candidates.length === 0) {
    return res.status(200).json({ captured: 0 })
  }

  // Insert each candidate phrase into staff_voice_phrases.
  // ON CONFLICT DO NOTHING so duplicate phrases aren't re-added.
  // The unique index is on (workspace_id, staff_id, phrase_normalized).
  let captured = 0
  for (const phrase of candidates) {
    const normalized = normalizePhrase(phrase)
    if (!normalized) continue

    const row = {
      workspace_id:     ws.id,
      staff_id,
      phrase:           phrase.trim(),
      phrase_normalized: normalized,
      source:           'edit',
    }

    const r = await sb(
      'staff_voice_phrases?on_conflict=workspace_id,staff_id,phrase_normalized',
      {
        method: 'POST',
        body: JSON.stringify(row),
        headers: { Prefer: 'return=minimal,resolution=ignore-duplicates' },
      },
    )

    if (r.ok || r.status === 409) {
      // 201 = inserted; 204 = no content (Prefer: return=minimal); 409 = conflict (dup, skip)
      if (r.status !== 409) captured++
    } else {
      const body = await r.text().catch(() => '')
      console.error(
        `[editorial/learn-from-edit] phrase insert failed — supabase ${r.status}: ${body.slice(0, 300)}`,
        { staff_id, piece_id, phrase: phrase.slice(0, 60) },
      )
    }
  }

  return res.status(200).json({ captured })
}
