// publishAnswer — push an approved answer to the workspace's public site
// (movebetter.co) via the astro_github publish webhook. The answer-library
// counterpart of the blog publish path (publishToAstro), but focused: it takes
// an answers-table row (not an HTTP request) and returns a plain result.
//
// Requires the workspace's `astro_github` credential ({ config:{url}, secret })
// AND the receiver (Movebetterco publish.ts) to understand kind:'answer'. If
// either is missing the publish fails cleanly and the caller keeps the answer
// 'approved' (not live) so it can be retried.

import { getCredential } from './getCredential.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

// "Dr. Q" / "Zach Cullen" / "Whitney Phillips" → { display:'Dr. Zach', slug:'zach' }.
// slug matches the movebetter.co /team/<slug> so the byline links; a mismatch just
// leaves the byline unlinked (the receiver template guards it), never a 404.
function deriveAuthor(name) {
  const first = String(name || '').replace(/^dr\.?\s+/i, '').trim().split(/\s+/)[0] || 'the clinician'
  const slug = first.toLowerCase().replace(/[^a-z0-9]/g, '')
  const display = `Dr. ${first.charAt(0).toUpperCase()}${first.slice(1)}`
  return { display, slug }
}

/**
 * Publish an approved answer to the workspace's public site.
 * @param {object} args.ws      resolved workspace ({ id, ... })
 * @param {object} args.answer  answers-table row (question, slug, answer_lead, body,
 *                              condition, summary, seo_title, chat_prompts, staff_id)
 * @returns {Promise<{ok:true, slug, postUrl}|{ok:false, error}>}
 */
export async function publishAnswerToMovebetter({ ws, answer }) {
  const cred = await getCredential(ws.id, 'astro_github')
  if (!cred?.config?.url || !cred?.secret) {
    return { ok: false, error: 'not_configured' }
  }

  // Author display + slug from the owning clinician's staff row.
  let staffName = ''
  if (answer.staff_id) {
    const r = await sb(`staff?id=eq.${answer.staff_id}&workspace_id=eq.${ws.id}&select=name&limit=1`)
    if (r.ok) staffName = (await r.json())[0]?.name || ''
  }
  const author = deriveAuthor(staffName)

  const nowDate = new Date().toISOString().slice(0, 10)
  const description = answer.summary || String(answer.answer_lead || '').slice(0, 300)
  const payload = {
    kind: 'answer',
    slug: answer.slug,
    title: answer.question,
    question: answer.question,
    answer: answer.answer_lead,
    markdown: answer.body,
    description,
    seoTitle: answer.seo_title || undefined,
    author: author.display,
    authorSlug: author.slug,
    condition: answer.condition || undefined,
    order: Number.isInteger(answer.display_order) ? answer.display_order : undefined,
    chatPrompts: Array.isArray(answer.chat_prompts) && answer.chat_prompts.length ? answer.chat_prompts : undefined,
    pubDate: nowDate,
  }

  let upstream
  try {
    upstream = await fetch(cred.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    })
  } catch (e) {
    console.error('[publishAnswer] network error:', e?.message)
    return { ok: false, error: 'network_error' }
  }

  let data = {}
  try { data = await upstream.json() } catch { /* empty */ }

  if (upstream.status === 200 && data.success) {
    return { ok: true, slug: data.slug || answer.slug, postUrl: data.postUrl || null }
  }
  console.error('[publishAnswer] upstream', upstream.status, JSON.stringify(data).slice(0, 200))
  return { ok: false, error: `upstream_${upstream.status}` }
}

/**
 * Retract a published answer from the workspace's public site — take the live page
 * DOWN (delete the .md), the inverse of publish. Sends kind:'answer-retract' to the
 * same astro_github receiver, which deletes src/content/answers/<slug>.md.
 * Idempotent on the receiver side (already-absent = success).
 * @param {object} args.ws      resolved workspace ({ id, ... })
 * @param {object} args.answer  answers-table row (needs slug / movebetterco_slug)
 * @returns {Promise<{ok:true, slug}|{ok:false, error}>}
 */
export async function retractAnswerFromMovebetter({ ws, answer }) {
  const cred = await getCredential(ws.id, 'astro_github')
  if (!cred?.config?.url || !cred?.secret) {
    return { ok: false, error: 'not_configured' }
  }
  const slug = answer.movebetterco_slug || answer.slug
  if (!slug) return { ok: false, error: 'no_slug' }

  let upstream
  try {
    upstream = await fetch(cred.config.url, {
      method: 'POST',
      headers: { Authorization: `Bearer ${cred.secret}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({ kind: 'answer-retract', slug }),
    })
  } catch (e) {
    console.error('[publishAnswer] retract network error:', e?.message)
    return { ok: false, error: 'network_error' }
  }

  let data = {}
  try { data = await upstream.json() } catch { /* empty */ }

  if (upstream.status === 200 && data.success) {
    return { ok: true, slug }
  }
  console.error('[publishAnswer] retract upstream', upstream.status, JSON.stringify(data).slice(0, 200))
  return { ok: false, error: `upstream_${upstream.status}` }
}
