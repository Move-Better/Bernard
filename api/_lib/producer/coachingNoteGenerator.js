// Core logic for the weekly "Bernard's note for this week" coaching card
// (P4 of ProducerHome — .claude/decisions.md 2026-07-29). Shared by the
// weekly cron (api/_routes/cron/generate-coaching-note.js) and the local
// dry-run script (scripts/generate-coaching-note.mjs).
//
// One note per workspace per week: reads what shipped (product_updates,
// last 7 days) + the workspace's live checkpoint/health state, and asks the
// model to write ONE short paragraph of guidance — not a changelog, not a
// status dump. Same engine for every tenant.
import { generateText } from 'ai'

const MODEL = 'anthropic/claude-sonnet-4-6'
const DAY_MS = 24 * 60 * 60 * 1000

function sb(path, init = {}) {
  return fetch(`${process.env.SUPABASE_URL}/rest/v1/${path}`, {
    ...init,
    headers: {
      apikey: process.env.SUPABASE_SERVICE_KEY,
      Authorization: `Bearer ${process.env.SUPABASE_SERVICE_KEY}`,
      'Content-Type': 'application/json',
      ...init.headers,
    },
  })
}

function mondayOf(d = new Date()) {
  const day = (d.getUTCDay() + 6) % 7
  const monday = new Date(d)
  monday.setUTCDate(d.getUTCDate() - day)
  return monday.toISOString().slice(0, 10)
}

async function countRows(path) {
  const r = await sb(`${path}${path.includes('?') ? '&' : '?'}select=id`, {
    headers: { Prefer: 'count=exact', Range: '0-0' },
  })
  if (!r.ok) return 0
  const cr = r.headers.get('content-range') || ''
  return Number(cr.split('/')[1]) || 0
}

async function workspaces(onlySlug) {
  const filter = onlySlug ? `&slug=eq.${encodeURIComponent(onlySlug)}` : ''
  const r = await sb(`workspaces?status=eq.active&select=id,slug,app_name,cadence_policy${filter}`)
  if (!r.ok) throw new Error(`workspaces fetch failed: ${r.status}`)
  return r.json()
}

async function stateFor(ws) {
  const [posts, stalePosts, clips, packages, failures] = await Promise.all([
    countRows(`content_items?workspace_id=eq.${ws.id}&status=in.(draft,in_review)&platform=neq.blog`),
    (async () => {
      const since = new Date(Date.now() - 14 * DAY_MS).toISOString()
      return countRows(`content_items?workspace_id=eq.${ws.id}&status=in.(draft,in_review)&platform=neq.blog&created_at=lt.${since}`)
    })(),
    countRows(`video_segments?workspace_id=eq.${ws.id}&status=eq.proposed`),
    countRows(`story_packages?workspace_id=eq.${ws.id}&status=eq.complete`),
    (async () => {
      const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
      return countRows(`agent_actions?workspace_id=eq.${ws.id}&kind=eq.publish_failed&created_at=gte.${since}`)
    })(),
  ])

  const lastPubR = await sb(
    `content_items?workspace_id=eq.${ws.id}&status=eq.published&published_at=not.is.null` +
    `&select=platform,published_at&order=published_at.desc&limit=500`,
  )
  const lastPub = lastPubR.ok ? await lastPubR.json() : []
  const seen = new Set()
  const idle = []
  for (const row of lastPub) {
    if (seen.has(row.platform)) continue
    seen.add(row.platform)
    const days = Math.floor((Date.now() - Date.parse(row.published_at)) / DAY_MS)
    if (days >= 7) idle.push(`${row.platform} (${days}d)`)
  }

  return { posts, stalePosts, clips, packages, failures, idleChannels: idle }
}

async function recentUpdates() {
  const since = new Date(Date.now() - 7 * DAY_MS).toISOString()
  const r = await sb(`product_updates?created_at=gte.${since}&select=summary,roles&order=created_at.desc&limit=15`)
  if (!r.ok) return []
  const rows = await r.json()
  return rows.filter((u) => !u.roles?.length || u.roles.includes('producer'))
}

async function draftNote(ws, state, updates) {
  const prompt = `You are Bernard, an AI content-production platform for a chiropractic clinic ("${ws.app_name || ws.slug}"). Write a short weekly coaching note (2-4 sentences, plain language, no headers, no bullet emoji) for the PRODUCER — the person who approves posts, reviews video clips, and monitors publishing. The note should:
- Mention the most relevant product change from the last week, if any, and what it means for their workflow.
- Point out anything in their current queue worth flagging (a stale backlog, an idle channel) — coach them on what to do, don't just restate numbers.
- Skip anything with a zero/clear count. Don't pad with filler if there's little to say.

This week's shipped changes:
${updates.length ? updates.map((u) => `- ${u.summary}`).join('\n') : '(nothing new this week)'}

Current state: ${state.posts} posts awaiting approval (${state.stalePosts} over two weeks old), ${state.clips} clips awaiting review, ${state.packages} video package(s) finished awaiting approval, ${state.failures} publish failure(s) this week, idle channels: ${state.idleChannels.join(', ') || 'none'}.

Write only the note text, no preamble.`

  const { text } = await generateText({ model: MODEL, prompt, maxOutputTokens: 400 })
  return text?.trim() || null
}

/**
 * @param {{ dryRun?: boolean, onlySlug?: string }} opts
 * @returns {Promise<{ workspaces: number, written: number, notes: Array<{slug:string, note:string}> }>}
 */
export async function generateCoachingNotes({ dryRun = false, onlySlug = null } = {}) {
  const week = mondayOf()
  const updates = await recentUpdates()
  const wss = await workspaces(onlySlug)

  const notes = []
  for (const ws of wss) {
    const state = await stateFor(ws)
    const note = await draftNote(ws, state, updates)
    if (!note) continue
    notes.push({ slug: ws.slug, note })
    if (dryRun) continue
    const r = await sb('workspace_coaching_notes?on_conflict=workspace_id,week_monday', {
      method: 'POST',
      headers: { Prefer: 'resolution=merge-duplicates,return=minimal' },
      body: JSON.stringify({ workspace_id: ws.id, week_monday: week, note }),
    })
    if (!r.ok) console.error(`[coachingNoteGenerator] upsert failed for ${ws.slug}:`, r.status, (await r.text()).slice(0, 300))
  }

  return { workspaces: wss.length, written: dryRun ? 0 : notes.length, notes }
}
