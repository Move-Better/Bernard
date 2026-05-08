// Newsletter dispatcher for the content_pieces publish loop.
//
// TrustDrivenCare (TDC) is NarrateRx's email-send platform and has no public
// API in this codebase — newsletter sending is a copy-paste-into-TDC workflow
// driven by the Content Hub's PostPreview iframe. So "publish to newsletter"
// here means: format the content_piece into the section-marker format that
// src/components/PostPreview.jsx parses, persist it as a content_items row
// with platform='email' status='approved', and hand the editor off to the
// existing newsletter copy-paste UI.
//
// The content_items row is the handoff artifact. published_target_id on the
// content_piece points at it, so the audit trail joins both tables.

import { brand } from '../../src/lib/brand.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

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

function firstSentence(s, max = 120) {
  if (!s) return ''
  const trimmed = String(s).trim()
  // Split on sentence-end or 1.5 lines, whichever comes first.
  const m = trimmed.match(/^[\s\S]+?[.!?](?=\s|$)/)
  const candidate = m ? m[0] : trimmed
  return candidate.length > max ? candidate.slice(0, max - 1).trim() + '…' : candidate
}

function deriveSubject(piece) {
  const caption = piece.final_caption || piece.ai_caption || ''
  const first = firstSentence(caption, 70).replace(/[.!?]+$/, '').trim()
  if (first) return first
  if (piece.source_quote) return firstSentence(piece.source_quote, 70).replace(/[.!?]+$/, '').trim()
  return `New from ${brand.name}`
}

function derivePreviewText(piece) {
  const caption = piece.final_caption || piece.ai_caption || ''
  const sentence = firstSentence(caption, 90)
  if (sentence) return sentence
  return brand.linkPreviewBlurb || 'A short note from the clinic.'
}

function deriveBodyParagraphs(piece) {
  const caption = (piece.final_caption || piece.ai_caption || '').trim()
  // Split caption on blank lines, then promote the first three blocks into
  // paragraphs 1–3. Editor refines in TDC if needed.
  const blocks = caption.split(/\n{2,}/).map((b) => b.trim()).filter(Boolean)
  const p1 = blocks[0] || caption || ''
  const p2 = blocks[1] || (piece.ai_reasoning ? piece.ai_reasoning : '')
  const p3 = blocks.slice(2).join('\n\n') || (piece.notes ? piece.notes : '')
  return { p1, p2, p3 }
}

// Build a content_items.content string in the section-marker format that
// src/components/PostPreview.jsx → parseEmailSections() recognizes. Empty
// sections are intentionally omitted so the parser ignores them.
function buildSectionedContent(piece) {
  const parts = []
  const push = (key, value) => {
    if (!value || !String(value).trim()) return
    parts.push(`---${key}---`)
    parts.push(String(value).trim())
    parts.push('')
  }

  const { p1, p2, p3 } = deriveBodyParagraphs(piece)
  const ctaUrl  = piece.final_cta_url || brand.prompt?.bookingUrl || brand.website

  push('SUBJECT LINE',    deriveSubject(piece))
  push('PREVIEW TEXT',    derivePreviewText(piece))
  push('HEADLINE',        firstSentence(piece.source_quote || p1, 100))
  push('PULL QUOTE',      piece.source_quote)
  push('BODY PARAGRAPH 1', p1)
  push('BODY PARAGRAPH 2', p2)
  push('BODY PARAGRAPH 3', p3)
  push('CTA TEXT',        piece.final_cta_text || 'Book a visit')
  push('CTA URL',         ctaUrl)

  return parts.join('\n').trim()
}

// Insert one content_items row staged for TDC copy-paste. Returns the new
// row id which the caller stores in content_pieces.published_target_id.
export async function publishPieceToNewsletter({ piece, finalAsset }) {
  const content = buildSectionedContent(piece)
  if (!content) throw new Error('Newsletter publish requires at least a caption or quote')

  const mediaUrls = []
  if (finalAsset?.blob_url) {
    mediaUrls.push({
      url:  finalAsset.blob_url,
      name: finalAsset.filename || 'final',
      type: finalAsset.kind === 'video' ? 'video' : 'image',
      kind: finalAsset.kind,
    })
  }

  // content_items predates the per-row brand column; brand-scoping is
  // implicit via the deployment's SUPABASE_URL. status='approved' surfaces
  // the row in the existing /content "Approved" view for TDC paste.
  const row = {
    interview_id:   null,
    clinician_id:   null,
    clinician_name: null,
    topic:          firstSentence(piece.source_quote || piece.final_caption || piece.ai_caption || 'Newsletter', 80),
    platform:       'email',
    content,
    status:         'approved',
    media_urls:     mediaUrls,
    notes:          `Auto-staged from content_pieces.${piece.id} on ${new Date().toISOString()}`,
  }

  const ins = await sb('content_items', { method: 'POST', body: JSON.stringify(row) })
  if (!ins.ok) {
    const text = await ins.text()
    throw new Error(`content_items insert failed: ${text}`)
  }
  const data = await ins.json()
  const created = data?.[0]
  if (!created?.id) throw new Error('content_items insert returned no row')

  return {
    ok: true,
    contentItemId: created.id,
    targetId: `content_items:${created.id}`,
  }
}
