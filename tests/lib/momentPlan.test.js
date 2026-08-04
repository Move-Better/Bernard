// Pure-function coverage for the moment-bank planning layer (P3):
// api/_lib/momentPlan.js (window + ranking) and the bank-mode composition in
// api/_lib/strategist.js (candidate shaping + atom materialization).
//
// The window is the fabrication boundary of the one-source-anchor decision —
// generation and the fidelity judge both see EXACTLY this slice, so its
// contiguity, budget, and excerpt-survival guarantees are load-bearing.

import { describe, it, expect } from 'vitest'
import {
  momentWindow,
  rankExemplarMoments,
  MAX_PER_INTERVIEW,
  MOMENT_WINDOW_MAX_CHARS,
} from '../../api/_lib/momentPlan.js'
import { shapeBankCandidates, composeWeeklyPlan, anglePalette, allocateToCadence } from '../../api/_lib/strategist.js'
import { planToDbOps } from '../../api/_lib/strategistPlan.js'

// ── momentWindow ────────────────────────────────────────────────────────────

const MSGS = [
  { role: 'assistant', content: 'Tell me about knees.' },                  // 0
  { role: 'user', content: 'Knees love load. Really they do.' },           // 1
  { role: 'assistant', content: 'Why is that?' },                          // 2
  { role: 'user', content: 'Cartilage adapts to gradual stress over months.' }, // 3
  { role: 'assistant', content: 'What should a runner do?' },              // 4
  { role: 'user', content: 'Build up mileage slowly, ten percent a week.' }, // 5
]

describe('momentWindow', () => {
  it('returns a contiguous window centered on the anchored turn, question included', () => {
    const win = momentWindow(MSGS, { msg_idx: 3, char_start: 0, char_end: 9 })
    expect(win).not.toBeNull()
    // Small transcript fits entirely in the default budget → whole conversation.
    expect(win.messages).toHaveLength(6)
    expect(win.messages[0]).toEqual({ role: 'assistant', content: 'Tell me about knees.' })
    expect(win.clinicianText).toContain('Cartilage adapts')
    expect(win.clinicianText).not.toContain('Tell me about knees')
    // anchorIndex points at the anchored turn inside the returned window.
    expect(win.anchorIndex).toBe(3)
    expect(win.messages[win.anchorIndex]).toEqual({ role: 'user', content: 'Cartilage adapts to gradual stress over months.' })
  })

  it('reports anchorIndex — the anchored turn\'s position WITHIN the window, not its raw msg_idx', () => {
    // Full window: the anchor keeps its natural index.
    expect(momentWindow(MSGS, { msg_idx: 3 }).anchorIndex).toBe(3)
    // Anchor at the very start of the transcript → index 0.
    const w0 = momentWindow(MSGS, { msg_idx: 0 })
    expect(w0.anchorIndex).toBe(0)
    expect(w0.messages[w0.anchorIndex].content).toBe('Tell me about knees.')
    // Contiguous truncation drops earlier turns, so the anchor's position in
    // the WINDOW (1) differs from its msg_idx (3) — a caller that highlighted
    // by msg_idx would mark the wrong turn.
    const msgs = [
      { role: 'assistant', content: 'Q1?' },
      { role: 'user', content: 'x'.repeat(500) },
      { role: 'assistant', content: 'Q2?' },
      { role: 'user', content: 'anchored moment here' },
    ]
    const win = momentWindow(msgs, { msg_idx: 3 }, { maxChars: 40 })
    expect(win.anchorIndex).toBe(1)
    expect(win.messages[win.anchorIndex].content).toBe('anchored moment here')
  })

  it('budgets expansion but ALWAYS includes the anchored turn', () => {
    const win = momentWindow(MSGS, { msg_idx: 3 }, { maxChars: 50 })
    expect(win).not.toBeNull()
    const contents = win.messages.map((m) => m.content)
    expect(contents).toContain('Cartilage adapts to gradual stress over months.')
    // 50 chars fits the anchor (47) and nothing else.
    expect(win.messages).toHaveLength(1)
  })

  it('keeps the window contiguous — never skips a large middle turn to grab a later one', () => {
    const msgs = [
      { role: 'assistant', content: 'Q1?' },
      { role: 'user', content: 'x'.repeat(500) }, // too big for the budget below
      { role: 'assistant', content: 'Q2?' },
      { role: 'user', content: 'anchored moment here' },
    ]
    const win = momentWindow(msgs, { msg_idx: 3 }, { maxChars: 40 })
    const idxs = win.messages.map((m) => m.content)
    // Expansion stops at the oversized turn; 'Q2?' (adjacent) fits first.
    expect(idxs).toEqual(['Q2?', 'anchored moment here'])
  })

  it('center-slices an oversized anchored turn around the excerpt range', () => {
    const big = 'a'.repeat(5000) + 'THE EXCERPT SENTENCE' + 'b'.repeat(5000)
    const msgs = [{ role: 'user', content: big }]
    const win = momentWindow(msgs, { msg_idx: 0, char_start: 5000, char_end: 5020 }, { maxChars: 1000 })
    expect(win).not.toBeNull()
    expect(win.messages[0].content).toContain('THE EXCERPT SENTENCE')
    expect(win.messages[0].content.length).toBeLessThanOrEqual(1000)
  })

  it('returns null for unresolvable anchors (time-coded, out-of-range, bad content)', () => {
    expect(momentWindow(MSGS, { t_start: 1.5, t_end: 9.0 })).toBeNull()   // no msg_idx
    expect(momentWindow(MSGS, { msg_idx: 99 })).toBeNull()
    expect(momentWindow(MSGS, { msg_idx: -1 })).toBeNull()
    expect(momentWindow([{ role: 'user', content: 42 }], { msg_idx: 0 })).toBeNull()
    expect(momentWindow(null, { msg_idx: 0 })).toBeNull()
  })

  it('default budget constant is what draftAtom relies on for the judge reference', () => {
    expect(MOMENT_WINDOW_MAX_CHARS).toBeGreaterThan(0)
  })
})

// ── rankExemplarMoments ─────────────────────────────────────────────────────

const NOW = '2026-07-27T00:00:00.000Z'
const mk = (id, iv, score, { usage = 0, ageDays = 100 } = {}) => ({
  id, interview_id: iv, score, usage_count: usage,
  created_at: new Date(new Date(NOW).getTime() - ageDays * 86_400_000).toISOString(),
})

describe('rankExemplarMoments', () => {
  it('penalizes usage and boosts freshness', () => {
    const out = rankExemplarMoments([
      mk('worn', 'iv1', 90, { usage: 3 }),   // 90 − 24 = 66
      mk('fresh', 'iv2', 70, { ageDays: 5 }), // 70 + 12 = 82
      mk('plain', 'iv3', 75),                 // 75
    ], NOW)
    expect(out.map((m) => m.id)).toEqual(['fresh', 'plain', 'worn'])
  })

  it('caps any one interview at MAX_PER_INTERVIEW slots', () => {
    const seminar = Array.from({ length: 20 }, (_, i) => mk(`s${i}`, 'seminar', 95 - i))
    const other = [mk('o1', 'iv2', 60), mk('o2', 'iv3', 55)]
    const out = rankExemplarMoments([...seminar, ...other], NOW, 10)
    expect(out.filter((m) => m.interview_id === 'seminar')).toHaveLength(MAX_PER_INTERVIEW)
    expect(out.map((m) => m.id)).toContain('o1')
    expect(out.map((m) => m.id)).toContain('o2')
  })

  it('respects the overall limit', () => {
    const many = Array.from({ length: 30 }, (_, i) => mk(`m${i}`, `iv${i}`, 80))
    expect(rankExemplarMoments(many, NOW, 12)).toHaveLength(12)
  })
})

// ── shapeBankCandidates ─────────────────────────────────────────────────────

const MOMENTS = [
  { id: 'aaaaaaaa-0000-0000-0000-000000000001', interview_id: 'iv-1', region: 'knee' },
  { id: 'aaaaaaaa-0000-0000-0000-000000000002', interview_id: 'iv-2', region: null },
]
const palette = anglePalette()
const igAngle = palette.instagram[0].angle

describe('shapeBankCandidates', () => {
  const ctx = {
    moments: MOMENTS,
    channels: ['instagram'],
    palette,
    promoMomentIds: new Set([MOMENTS[0].id]),
  }

  it('attaches interview_id/region/isPromo from the moment and repairs whitespace-corrupted ids', () => {
    const out = shapeBankCandidates([
      { moment_id: ` ${MOMENTS[0].id} `, platform: 'instagram', angle: igAngle, brief: 'Knees love load' },
    ], ctx)
    expect(out).toHaveLength(1)
    expect(out[0]).toMatchObject({
      moment_id: MOMENTS[0].id,
      interview_id: 'iv-1',
      region: 'knee',
      isPromo: true,
    })
  })

  it('drops unknown moments, disabled channels, and off-palette angles', () => {
    const out = shapeBankCandidates([
      { moment_id: 'not-a-real-moment', platform: 'instagram', angle: igAngle, brief: 'x' },
      { moment_id: MOMENTS[1].id, platform: 'tiktok', angle: igAngle, brief: 'x' },
      { moment_id: MOMENTS[1].id, platform: 'instagram', angle: 'invented_angle', brief: 'x' },
    ], ctx)
    expect(out).toEqual([])
  })

  it('enforces one piece per moment (one-source-anchor: no double-draw in a plan)', () => {
    const out = shapeBankCandidates([
      { moment_id: MOMENTS[0].id, platform: 'instagram', angle: igAngle, brief: 'first' },
      { moment_id: MOMENTS[0].id, platform: 'instagram', angle: igAngle, brief: 'second' },
    ], ctx)
    expect(out).toHaveLength(1)
    expect(out[0].brief).toBe('first')
  })
})

// ── composeWeeklyPlan, bank mode ────────────────────────────────────────────

describe('composeWeeklyPlan (bank mode)', () => {
  const cadence = { instagram: { target_per_week: 2, enabled: true } }
  const moments = [
    { id: 'bbbbbbbb-0000-0000-0000-000000000001', interview_id: 'iv-1', region: null, excerpt: 'e1', hook: 'h1', created_at: NOW },
    { id: 'bbbbbbbb-0000-0000-0000-000000000002', interview_id: 'iv-2', region: null, excerpt: 'e2', hook: 'h2', created_at: NOW },
    { id: 'bbbbbbbb-0000-0000-0000-000000000003', interview_id: 'iv-3', region: null, excerpt: 'e3', hook: 'h3', created_at: NOW },
  ]
  const generateBank = async () => moments.map((m, i) => ({
    moment_id: m.id, platform: 'instagram', angle: igAngle, brief: `brief ${i + 1}`,
  }))

  it('materializes moment_id onto atom rows, drops surplus instead of banking held rows', async () => {
    const plan = await composeWeeklyPlan({
      workspaceId: 'ws-1',
      interviews: [],
      cadence,
      moments,
      generateBank,
      weekMonday: '2026-07-27',
    })
    expect(plan.stats.bankMode).toBe(true)
    expect(plan.thisWeek).toHaveLength(2) // capped at cadence target
    for (const row of plan.thisWeek) {
      expect(row.moment_id).toMatch(/^bbbbbbbb-/)
      expect(row.interview_id).toMatch(/^iv-/)
      expect(row.planned_by).toBe('strategist')
    }
    // The 3rd candidate is DROPPED (the bank keeps it), never a held atom.
    expect(plan.held).toEqual([])
  })

  it('counts already-committed (non-replaceable) atoms toward the weekly target', async () => {
    // The week already has 2 drafted instagram atoms a replan won't replace —
    // target 2 is met, so the compose must add ZERO new instagram pieces
    // (this is the double-planned-week bug caught on movebetter's first live
    // bank replan: 11 drafted + 15 freshly composed in one week).
    const plan = await composeWeeklyPlan({
      workspaceId: 'ws-1',
      interviews: [],
      cadence,
      moments,
      generateBank,
      weekMonday: '2026-07-27',
      existingFilledByChannel: { instagram: 2 },
    })
    expect(plan.thisWeek).toHaveLength(0)
    expect(plan.held).toEqual([])
  })

  it('partial baseline leaves exactly the remaining gap', () => {
    const cands = [1, 2, 3].map((i) => ({ platform: 'instagram', brief: `b${i}`, region: null }))
    const { thisWeek, held } = allocateToCadence(cands, { instagram: { target_per_week: 3, enabled: true } }, [], {}, 0, { instagram: 2 })
    expect(thisWeek).toHaveLength(1)
    expect(held).toHaveLength(2)
  })

  it('planToDbOps bank mode re-holds replaced LEGACY atoms and deletes only moment atoms', () => {
    const existing = [
      { id: 'legacy-1', platform: 'instagram', planned_by: 'strategist', status: 'pending', content_piece_id: null, moment_id: null },
      { id: 'moment-1', platform: 'instagram', planned_by: 'strategist', status: 'pending', content_piece_id: null, moment_id: 'm-1' },
      { id: 'drafted-1', platform: 'instagram', planned_by: 'strategist', status: 'drafted', content_piece_id: 'cp-1', moment_id: 'm-2' },
    ]
    const plan = { thisWeek: [], held: [], promoted: [] }
    const bank = planToDbOps(plan, existing, { reholdLegacy: true })
    expect(bank.toDelete).toEqual(['moment-1'])
    expect(bank.toRehold).toEqual(['legacy-1'])
    // Legacy mode: unchanged pre-P3 behavior — both pending atoms deleted.
    const legacy = planToDbOps(plan, existing)
    expect(legacy.toDelete.sort()).toEqual(['legacy-1', 'moment-1'])
    expect(legacy.toRehold).toEqual([])
  })

  it('legacy mode still banks surplus as held rows (no regression)', async () => {
    const interviews = [{ id: 'iv-9', topic: 'knees', summary_text: 's', region: null, campaign_id: null }]
    const generate = async () => [1, 2, 3].map((i) => ({
      interview_id: 'iv-9', platform: 'instagram', angle: igAngle, brief: `b${i}`,
    }))
    const plan = await composeWeeklyPlan({
      workspaceId: 'ws-1',
      interviews,
      cadence,
      generate,
      weekMonday: '2026-07-27',
    })
    expect(plan.stats.bankMode).toBeUndefined()
    expect(plan.thisWeek).toHaveLength(2)
    expect(plan.held).toHaveLength(1)
    expect(plan.thisWeek[0].moment_id).toBeNull()
  })
})
