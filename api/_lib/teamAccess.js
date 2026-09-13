// Team access: switching off someone who left, handing their OPEN work to a
// successor, and reading the Role + Access an invite carried.
//
// Deactivation keeps the Clerk login, the staff row, its tier and every past
// stamp. It only switches access off (the gate in api/_lib/auth.js) and moves
// work that is still somebody's to do. Never merge_staff a departure: merge
// rewrites a person's history under someone else's name. (Philip, 2026-09-13.)

export const INVITE_TIERS = ['producer', 'clinician', 'viewer']
export const STAFF_TYPES = ['clinician', 'non_clinical_staff']

// content_items still in flight. Published, archived and scheduled posts are
// the record of what shipped, so they keep the original name.
export const OPEN_CONTENT_STATUSES = ['draft', 'in_review', 'approved', 'failed']
// answers.status check constraint minus the terminal published / retracted.
export const OPEN_ANSWER_STATUSES = ['drafting', 'needs_review', 'changes_requested', 'approved']

/**
 * Role + Access an invitation carried. Clerk copies an organization
 * invitation's public_metadata onto the membership it creates, so the same
 * keys are read from either. Unknown values are dropped rather than trusted:
 * this is caller-influenced data landing in an authorization column.
 * @param {Record<string, unknown>|null|undefined} md
 * @returns {{ tier: string|null, staffType: string|null }}
 */
export function inviteAccessFromMetadata(md) {
  const tier = INVITE_TIERS.includes(/** @type {string} */ (md?.bernard_tier)) ? /** @type {string} */ (md.bernard_tier) : null
  const staffType = STAFF_TYPES.includes(/** @type {string} */ (md?.bernard_staff_type)) ? /** @type {string} */ (md.bernard_staff_type) : null
  return { tier, staffType }
}

/** staff columns to write for an invite's access; only the keys it set. */
export function staffColumnsFromInvite({ tier, staffType } = {}) {
  const cols = {}
  if (tier) cols.permission_tier = tier
  if (staffType) cols.staff_type = staffType
  return cols
}

/** Replace one id in a campaign's target list, without creating a duplicate. */
export function swapCampaignTarget(ids, fromId, toId) {
  const out = []
  for (const id of Array.isArray(ids) ? ids : []) {
    const next = id === fromId ? toId : id
    if (!out.includes(next)) out.push(next)
  }
  return out
}

const inList = (xs) => `(${xs.join(',')})`

async function rowsOrThrow(r, label) {
  if (!r.ok) {
    const body = await r.text?.().catch(() => '') ?? ''
    throw new Error(`${label} ${r.status}: ${String(body).slice(0, 200)}`)
  }
  const rows = await r.json()
  if (!Array.isArray(rows)) throw new Error(`${label}: bad response shape`)
  return rows
}

/**
 * Everything that moves when this person is deactivated. Read-only.
 * @param {(path: string, init?: object) => Promise<Response>} sb
 * @param {{ workspaceId: string, staffId: string }} args
 */
export async function planHandover(sb, { workspaceId, staffId }) {
  const ws = `workspace_id=eq.${workspaceId}`
  const [content, answers, sentBackMoments, campaigns] = await Promise.all([
    sb(`content_items?${ws}&staff_id=eq.${staffId}&status=in.${inList(OPEN_CONTENT_STATUSES)}&archived_at=is.null&select=id`)
      .then((r) => rowsOrThrow(r, 'content_items')),
    sb(`answers?${ws}&staff_id=eq.${staffId}&status=in.${inList(OPEN_ANSWER_STATUSES)}&select=id`)
      .then((r) => rowsOrThrow(r, 'answers')),
    // A quote sent back to its speaker for review. The quote stays theirs (they
    // said it); the hold is released so it isn't stuck waiting on someone gone.
    sb(`moments?${ws}&staff_id=eq.${staffId}&status=eq.banked&sent_back_at=not.is.null&select=id`)
      .then((r) => rowsOrThrow(r, 'moments')),
    sb(`campaigns?${ws}&target_staff_ids=cs.%7B${staffId}%7D&select=id,target_staff_ids`)
      .then((r) => rowsOrThrow(r, 'campaigns')),
  ])
  return { content, answers, sentBackMoments, campaigns }
}

export function summarizePlan(plan) {
  return {
    content: plan.content.length,
    answers: plan.answers.length,
    sentBackMoments: plan.sentBackMoments.length,
    campaigns: plan.campaigns.length,
  }
}

/**
 * Move the planned work to the successor. Idempotent: every write is filtered
 * by the departing staff_id, so a retry after a partial failure only touches
 * what is still left. Throws on the first failed write.
 * @param {(path: string, init?: object) => Promise<Response>} sb
 * @param {{ workspaceId: string, staffId: string, successor: { id: string, name?: string }, plan: ReturnType<typeof planHandover> extends Promise<infer P> ? P : never }} args
 */
export async function applyHandover(sb, { workspaceId, staffId, successor, plan }) {
  const ws = `workspace_id=eq.${workspaceId}`
  const patch = async (path, body, label) => {
    const r = await sb(path, { method: 'PATCH', body: JSON.stringify(body) })
    if (!r.ok) {
      const text = await r.text?.().catch(() => '') ?? ''
      throw new Error(`${label} ${r.status}: ${String(text).slice(0, 200)}`)
    }
  }

  if (plan.content.length) {
    // staff_name is denormalized onto content_items; keep it matching staff_id.
    await patch(
      `content_items?${ws}&staff_id=eq.${staffId}&id=in.${inList(plan.content.map((c) => c.id))}`,
      { staff_id: successor.id, staff_name: successor.name ?? null },
      'content_items',
    )
  }
  if (plan.answers.length) {
    await patch(
      `answers?${ws}&staff_id=eq.${staffId}&id=in.${inList(plan.answers.map((a) => a.id))}`,
      { staff_id: successor.id },
      'answers',
    )
  }
  if (plan.sentBackMoments.length) {
    await patch(
      `moments?${ws}&staff_id=eq.${staffId}&id=in.${inList(plan.sentBackMoments.map((m) => m.id))}`,
      { sent_back_at: null, sent_back_by: null, sent_back_note: null, sent_back_notified_at: null },
      'moments',
    )
  }
  for (const c of plan.campaigns) {
    await patch(
      `campaigns?${ws}&id=eq.${c.id}`,
      { target_staff_ids: swapCampaignTarget(c.target_staff_ids, staffId, successor.id) },
      'campaigns',
    )
  }
  return summarizePlan(plan)
}
