import { describe, it, expect } from 'vitest'
import {
  findOverdueApprovals, hasRecentNudge, pieceUrl,
  OVERDUE_WINDOW_DAYS, NUDGE_KIND,
} from '../../api/_lib/producer/approvalEscalation.js'
import { buildEscalation, overdueLabel } from '../../api/_lib/approvalEscalationEmail.js'

const WS = '11111111-1111-4111-8111-111111111111'
const P1 = '22222222-2222-4222-8222-222222222222'
const P2 = '33333333-3333-4333-8333-333333333333'
const NOW = new Date('2026-07-28T18:00:00Z')

const ok = (rows) => ({ ok: true, json: async () => rows })
const bad = (status) => ({ ok: false, status, json: async () => [], text: async () => '' })

/** Fake PostgREST that routes by table name and records every path it saw. */
function fakeSb({ atoms = [], items = [], actions = [], fail = null } = {}) {
  const calls = []
  const fn = async (path) => {
    calls.push(path)
    if (fail && path.startsWith(fail)) return bad(500)
    if (path.startsWith('content_plan_atoms')) return ok(atoms)
    if (path.startsWith('content_items')) return ok(items)
    if (path.startsWith('agent_actions')) return ok(actions)
    throw new Error(`unexpected path: ${path}`)
  }
  fn.calls = calls
  return fn
}

const atom = (o) => ({
  id: 'a-' + o.content_piece_id, platform: 'gbp', format: null,
  scheduled_at: o.scheduled_at, content_piece_id: o.content_piece_id,
})

describe('findOverdueApprovals — what counts as a missed slot', () => {
  it('returns a drafted piece whose slot has passed', async () => {
    const sb = fakeSb({
      atoms: [atom({ content_piece_id: P1, scheduled_at: '2026-07-27T15:00:00Z' })],
      items: [{ id: P1, topic: 'Sciatica', platform: 'gbp' }],
    })
    const out = await findOverdueApprovals({ workspaceId: WS, sb, now: NOW })

    expect(out).toHaveLength(1)
    expect(out[0].pieceId).toBe(P1)
    expect(out[0].topic).toBe('Sciatica')
    expect(out[0].daysPast).toBeCloseTo(1.125, 2)

    // Non-vacuity: prove the query actually ran and was workspace-scoped, so a
    // future refactor that silently stops querying can't leave this green.
    expect(sb.calls.some((p) => p.includes(`workspace_id=eq.${WS}`))).toBe(true)
    // Only drafts are candidates — the status filter is the whole exclusion of
    // archived/approved/published rows.
    expect(sb.calls.some((p) => p.startsWith('content_items') && p.includes('status=eq.draft'))).toBe(true)
  })

  it('ignores an atom with no drafted piece (nothing to approve, nothing to link to)', async () => {
    // The majority of past-slot atoms across non-movebetter workspaces are this
    // shape: pending, content_piece_id null. Emailing about them would be noise.
    const sb = fakeSb({
      atoms: [atom({ content_piece_id: P1, scheduled_at: '2026-07-27T15:00:00Z' })],
      items: [], // the piece is not a draft (approved/published/archived, or absent)
    })
    expect(await findOverdueApprovals({ workspaceId: WS, sb, now: NOW })).toEqual([])
  })

  it('orders most-overdue first and de-dupes several atoms pointing at one piece', async () => {
    const sb = fakeSb({
      atoms: [
        atom({ content_piece_id: P2, scheduled_at: '2026-07-26T15:00:00Z' }),
        atom({ content_piece_id: P2, scheduled_at: '2026-07-27T15:00:00Z' }),
        atom({ content_piece_id: P1, scheduled_at: '2026-07-27T19:00:00Z' }),
      ],
      items: [{ id: P1, topic: 'A', platform: 'instagram' }, { id: P2, topic: 'B', platform: 'gbp' }],
    })
    const out = await findOverdueApprovals({ workspaceId: WS, sb, now: NOW })

    expect(out.map((o) => o.pieceId)).toEqual([P2, P1])
    // Earliest slot wins for a duplicated piece, so the reported age is honest.
    expect(out[0].scheduledAt).toBe('2026-07-26T15:00:00Z')
  })

  it('bounds the query to the overdue window rather than nagging forever', async () => {
    const sb = fakeSb({ atoms: [], items: [] })
    await findOverdueApprovals({ workspaceId: WS, sb, now: NOW })
    const floor = new Date(NOW.getTime() - OVERDUE_WINDOW_DAYS * 86_400_000).toISOString()
    expect(sb.calls[0]).toContain(encodeURIComponent(floor))
    expect(sb.calls[0]).toContain('content_piece_id=not.is.null')
  })

  it('returns empty (never throws) when a read fails', async () => {
    const sb = fakeSb({ fail: 'content_plan_atoms' })
    expect(await findOverdueApprovals({ workspaceId: WS, sb, now: NOW })).toEqual([])
  })
})

describe('hasRecentNudge — the one-per-day cap', () => {
  it('is true when a nudge exists inside the cooldown', async () => {
    const sb = fakeSb({ actions: [{ id: 'x' }] })
    expect(await hasRecentNudge({ workspaceId: WS, sb, now: NOW })).toBe(true)
    expect(sb.calls[0]).toContain(`kind=eq.${NUDGE_KIND}`)
  })

  it('is false when the ledger is clear', async () => {
    expect(await hasRecentNudge({ workspaceId: WS, sb: fakeSb({ actions: [] }), now: NOW })).toBe(false)
  })

  it('fails CLOSED when the ledger read fails — never double-email real people', async () => {
    const sb = fakeSb({ fail: 'agent_actions' })
    expect(await hasRecentNudge({ workspaceId: WS, sb, now: NOW })).toBe(true)
  })
})

describe('buildEscalation — the email is a set of one-tap links', () => {
  const workspace = { slug: 'movebetter', display_name: 'Move Better', cadence_policy: { timezone: 'America/Denver' } }
  const items = [
    { pieceId: P1, platform: 'gbp', topic: 'Sciatica relief', scheduledAt: '2026-07-27T15:00:00Z', daysPast: 1.1 },
  ]

  it('links every row straight to that piece, not to a generic /week', () => {
    const { html, text } = buildEscalation({ workspace, items })
    const deep = `https://movebetter.withbernard.ai/publish/${P1}`
    expect(html).toContain(deep)
    expect(text).toContain(deep)
    // The whole premise is removing navigation friction, so the per-piece link
    // must exist even though a week-level link is also offered as a secondary.
    expect(pieceUrl('movebetter', P1)).toBe(deep)
  })

  it('counts the full backlog in the subject even when the list is truncated', () => {
    const { subject, html } = buildEscalation({ workspace, items, totalCount: 8 })
    expect(subject).toBe('8 posts waiting on you — Move Better')
    expect(html).toContain('and 7 more waiting')
  })

  it('says how to turn it off', () => {
    const { html } = buildEscalation({ workspace, items })
    expect(html).toContain('/producer')
    expect(html).toMatch(/Email me when something needs me/)
  })

  it('escapes topic text into both the html and the subject path', () => {
    const { html } = buildEscalation({
      workspace,
      items: [{ ...items[0], topic: '<script>alert(1)</script>' }],
    })
    expect(html).not.toContain('<script>alert(1)</script>')
    expect(html).toContain('&lt;script&gt;')
  })

  it('does not use the retired Move-Better orange as its accent', () => {
    // engagementDigestEmail.js still falls back to #e36525; api/_lib sits
    // outside the bernard/no-hardcoded-brand-color rule's scope, so this is the
    // only thing stopping the retired brand colour spreading to a new sender.
    const { html } = buildEscalation({ workspace: { slug: 's' }, items })
    expect(html.toLowerCase()).not.toContain('e36525')
    expect(html).toContain('#0C7580')
  })
})

describe('overdueLabel', () => {
  it('reads as a human, not as arithmetic', () => {
    expect(overdueLabel(0.01)).toBe('due now')
    expect(overdueLabel(0.5)).toBe('12h ago')
    expect(overdueLabel(1.2)).toBe('yesterday')
    expect(overdueLabel(3.7)).toBe('3 days ago')
  })
})
