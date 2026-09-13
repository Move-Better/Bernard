import { describe, it, expect } from 'vitest'
import {
  inviteAccessFromMetadata, staffColumnsFromInvite, swapCampaignTarget,
  planHandover, summarizePlan, applyHandover,
} from '../../api/_lib/teamAccess.js'
import { isDeactivatedInWorkspace, invalidateDeactivation } from '../../api/_lib/auth.js'

const WS = '11111111-1111-4111-8111-111111111111'
const GONE = '22222222-2222-4222-8222-222222222222'
const NEXT = '33333333-3333-4333-8333-333333333333'
const OTHER = '44444444-4444-4444-8444-444444444444'

const ok = (rows) => ({ ok: true, status: 200, json: async () => rows, text: async () => '' })
const bad = (status) => ({ ok: false, status, json: async () => ({}), text: async () => 'boom' })

/** Fake PostgREST routed by table; records every call. */
function fakeSb(tables = {}, { failOn = null } = {}) {
  const calls = []
  const fn = async (path, init = {}) => {
    calls.push({ path, method: init.method || 'GET', body: init.body ? JSON.parse(init.body) : null })
    const table = path.split('?')[0]
    if (failOn && table === failOn && init.method === 'PATCH') return bad(500)
    return ok(init.method === 'PATCH' ? [] : (tables[table] || []))
  }
  fn.calls = calls
  return fn
}

describe('inviteAccessFromMetadata — the invite decides Role and Access', () => {
  it('reads a valid tier and staff type', () => {
    expect(inviteAccessFromMetadata({ bernard_tier: 'viewer', bernard_staff_type: 'non_clinical_staff' }))
      .toEqual({ tier: 'viewer', staffType: 'non_clinical_staff' })
  })

  it('never lets metadata grant owner or an unknown value', () => {
    expect(inviteAccessFromMetadata({ bernard_tier: 'owner', bernard_staff_type: 'ceo' }))
      .toEqual({ tier: null, staffType: null })
  })

  it('treats a membership with no invite metadata as "leave the row alone"', () => {
    expect(staffColumnsFromInvite(inviteAccessFromMetadata(undefined))).toEqual({})
    expect(staffColumnsFromInvite({ tier: 'producer', staffType: null })).toEqual({ permission_tier: 'producer' })
  })
})

describe('swapCampaignTarget', () => {
  it('replaces the departed id with the successor', () => {
    expect(swapCampaignTarget([OTHER, GONE], GONE, NEXT)).toEqual([OTHER, NEXT])
  })
  it('does not duplicate a successor already targeted', () => {
    expect(swapCampaignTarget([NEXT, GONE], GONE, NEXT)).toEqual([NEXT])
  })
})

describe('planHandover — only OPEN work moves', () => {
  it('scopes every read to the workspace and the departing person', async () => {
    const sb = fakeSb()
    await planHandover(sb, { workspaceId: WS, staffId: GONE })
    expect(sb.calls).toHaveLength(4)
    for (const c of sb.calls) expect(c.path).toContain(`workspace_id=eq.${WS}`)
    const content = sb.calls.find((c) => c.path.startsWith('content_items')).path
    expect(content).toContain(`staff_id=eq.${GONE}`)
    expect(content).toContain('status=in.(draft,in_review,approved,failed)')
    expect(content).toContain('archived_at=is.null')
    // Published and scheduled posts are the record of what shipped.
    expect(content).not.toMatch(/published|scheduled/)
    const answers = sb.calls.find((c) => c.path.startsWith('answers')).path
    expect(answers).not.toMatch(/published|retracted/)
  })

  it('throws instead of reporting nothing when a read fails', async () => {
    const sb = async (path) => (path.startsWith('answers') ? bad(500) : ok([]))
    await expect(planHandover(sb, { workspaceId: WS, staffId: GONE })).rejects.toThrow(/answers 500/)
  })
})

describe('applyHandover', () => {
  const plan = {
    content: [{ id: 'c1' }, { id: 'c2' }],
    answers: [{ id: 'a1' }],
    sentBackMoments: [{ id: 'm1' }],
    campaigns: [{ id: 'k1', target_staff_ids: [GONE, OTHER] }],
  }

  it('moves content and answers to the successor, releases holds, swaps campaign targets', async () => {
    const sb = fakeSb()
    const counts = await applyHandover(sb, { workspaceId: WS, staffId: GONE, successor: { id: NEXT, name: 'Aj Adams' }, plan })
    expect(counts).toEqual({ content: 2, answers: 1, sentBackMoments: 1, campaigns: 1 })

    const byTable = (t) => sb.calls.find((c) => c.path.startsWith(t))
    const content = byTable('content_items')
    expect(content.path).toContain(`staff_id=eq.${GONE}`)
    expect(content.path).toContain('id=in.(c1,c2)')
    expect(content.body).toEqual({ staff_id: NEXT, staff_name: 'Aj Adams' })

    expect(byTable('answers').body).toEqual({ staff_id: NEXT })

    // The quote is still theirs — only the send-back hold is released.
    const moments = byTable('moments')
    expect(moments.body).not.toHaveProperty('staff_id')
    expect(moments.body.sent_back_at).toBeNull()

    expect(byTable('campaigns').body).toEqual({ target_staff_ids: [NEXT, OTHER] })
    for (const c of sb.calls) {
      expect(c.method).toBe('PATCH')
      expect(c.path).toContain(`workspace_id=eq.${WS}`)
    }
  })

  it('writes nothing when there is nothing to move', async () => {
    const sb = fakeSb()
    const empty = { content: [], answers: [], sentBackMoments: [], campaigns: [] }
    expect(await applyHandover(sb, { workspaceId: WS, staffId: GONE, successor: { id: NEXT }, plan: empty }))
      .toEqual(summarizePlan(empty))
    expect(sb.calls).toHaveLength(0)
  })

  it('stops on a failed write so the caller never switches access off', async () => {
    const sb = fakeSb({}, { failOn: 'answers' })
    await expect(applyHandover(sb, { workspaceId: WS, staffId: GONE, successor: { id: NEXT }, plan }))
      .rejects.toThrow(/answers 500/)
  })
})

describe('isDeactivatedInWorkspace — the gate in requireRole', () => {
  it('is true only when a deactivated row exists for this user in this workspace', async () => {
    const seen = []
    const rest = async (path) => { seen.push(path); return ok([{ id: 'x' }]) }
    expect(await isDeactivatedInWorkspace('user_a', WS, rest)).toBe(true)
    expect(seen[0]).toContain('user_id=eq.user_a')
    expect(seen[0]).toContain(`workspace_id=eq.${WS}`)
    expect(seen[0]).toContain('deactivated_at=not.is.null')

    expect(await isDeactivatedInWorkspace('user_b', WS, async () => ok([]))).toBe(false)
  })

  it('fails open on a lookup error and does not cache it', async () => {
    expect(await isDeactivatedInWorkspace('user_c', WS, async () => bad(503))).toBe(false)
    // Next request re-checks rather than trusting the failed read.
    expect(await isDeactivatedInWorkspace('user_c', WS, async () => ok([{ id: 'x' }]))).toBe(true)
  })

  it('caches a result until invalidated, so reactivation takes effect at once here', async () => {
    expect(await isDeactivatedInWorkspace('user_d', WS, async () => ok([{ id: 'x' }]))).toBe(true)
    expect(await isDeactivatedInWorkspace('user_d', WS, async () => ok([]))).toBe(true)
    invalidateDeactivation('user_d', WS)
    expect(await isDeactivatedInWorkspace('user_d', WS, async () => ok([]))).toBe(false)
  })

  it('never gates a request with no user or workspace', async () => {
    const rest = async () => { throw new Error('should not be called') }
    expect(await isDeactivatedInWorkspace(null, WS, rest)).toBe(false)
    expect(await isDeactivatedInWorkspace('user_e', null, rest)).toBe(false)
  })
})
