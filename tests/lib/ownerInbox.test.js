import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { buildOwnerInbox, ownerHeadline, rankTone, teamPhrase, OWN_KIND_RANK } from '../../src/lib/ownerInbox.js'

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')

// Shaped on Move Better's real /api/producer/checkpoints payload, 2026-11-09.
function checkpoints(over = {}) {
  return {
    summary: { checkpoints: 4, decisions: 15, backlog: 149 },
    queue: [
      { type: 'approved_unscheduled', tier: 2, title: '4 approved posts never went out', why: 'Never scheduled.', ctaHref: '/stories?status=approved', ctaLabel: 'Review approved →', count: 4 },
      { type: 'post_approvals', tier: 3, title: 'Approve this week’s posts — 10 waiting', why: 'Approving schedules them.', ctaHref: '/week', ctaLabel: 'Review on Your week →', count: 10 },
      { type: 'video_packages_complete', tier: 3, title: 'Approve 1 finished video package', why: 'Cut and captioned.', ctaHref: '/moments', ctaLabel: 'Open Moments →', count: 1 },
      { type: 'clips_proposed', tier: 4, title: 'Clip review backlog — 149 proposed cuts', why: 'Nothing is blocked.', ctaHref: '/moments?tab=video', ctaLabel: 'Review clips →', count: 149 },
    ],
    waitingOnClinicians: [
      { staffId: 'aj', name: 'Aj Adams', answersToReview: 0, wordsApprovals: 1, blogDrafts: 3, supersessions: 0 },
      { staffId: 'zach', name: 'Zach Cullen', answersToReview: 4, wordsApprovals: 0, blogDrafts: 0, supersessions: 0 },
      { staffId: 'tyler', name: 'Tyler Hoang', answersToReview: 1, wordsApprovals: 0, blogDrafts: 1, supersessions: 0 },
      { staffId: 'sophie', name: 'Sophie Kaplan', answersToReview: 0, wordsApprovals: 0, blogDrafts: 2, supersessions: 0 },
    ],
    health: {
      channels: [
        { platform: 'gbp', daysIdle: 68, status: 'stalled' },
        { platform: 'linkedin', daysIdle: 66, status: 'stalled' },
        { platform: 'facebook', daysIdle: 64, status: 'stalled' },
        { platform: 'instagram', daysIdle: 61, status: 'stalled' },
        { platform: 'blog', daysIdle: 33, status: 'stalled' },
      ],
    },
    ...over,
  }
}

const own = (kind, key, title = 'Own item') => ({ kind, key, title, meta: `${kind} meta`, to: `/x/${key}`, cta: 'Go' })

describe('buildOwnerInbox — one ranked list', () => {
  it('puts tier 1-3 checkpoints in the list and tier 4 in the backlog', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints() })
    expect(inbox.rows.map((r) => r.key)).toEqual([
      'queue:approved_unscheduled', 'queue:post_approvals', 'queue:video_packages_complete',
    ])
    expect(inbox.backlog.map((b) => b.key)).toEqual(['queue:clips_proposed'])
  })

  it('strips the arrow from server labels, since the row draws its own chevron', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints() })
    expect(inbox.rows[1].cta).toBe('Review on Your week')
    expect(inbox.backlog[0].cta).toBe('Review clips')
  })

  it('ranks a words approval above a tier-3 checkpoint, and below tier 2', () => {
    // Words approval blocks all publishing for its story, so it must not sink
    // under the routine weekly approvals.
    const inbox = buildOwnerInbox({ checkpoints: checkpoints(), ownItems: [own('blog', 'b1'), own('words', 'w1')] })
    expect(inbox.rows.map((r) => r.key)).toEqual([
      'queue:approved_unscheduled', 'w1', 'queue:post_approvals', 'queue:video_packages_complete', 'b1',
    ])
  })

  it('keeps producer rows ahead of the owner’s own at the same rank, in their own order', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints(), ownItems: [own('answer', 'a1'), own('blog', 'b1')] })
    expect(inbox.rows.slice(1).map((r) => r.key)).toEqual(['queue:post_approvals', 'queue:video_packages_complete', 'a1', 'b1'])
  })

  it('ranks an unknown own kind as routine rather than dropping it', () => {
    const inbox = buildOwnerInbox({ ownItems: [own('mystery', 'm1')] })
    expect(inbox.rows).toHaveLength(1)
    expect(inbox.rows[0].rank).toBe(3)
    expect(OWN_KIND_RANK.words).toBe(2)
  })

  it('handles a missing payload without throwing', () => {
    const inbox = buildOwnerInbox({})
    expect(inbox.rows).toEqual([])
    expect(inbox.headline).toBe('Nothing needs you right now.')
  })
})

describe('team — other people’s approvals are folded and uncounted', () => {
  it('totals them, in the server’s order', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints() })
    expect(inbox.teamTotal).toBe(12)
    expect(inbox.team.map((w) => w.name)).toEqual(['Aj Adams', 'Zach Cullen', 'Tyler Hoang', 'Sophie Kaplan'])
  })

  it('never lists the owner as their own teammate', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints(), selfStaffId: 'zach' })
    expect(inbox.team.map((w) => w.staffId)).not.toContain('zach')
    expect(inbox.teamTotal).toBe(8)
  })

  it('drops a teammate whose counts are all zero', () => {
    const cp = checkpoints({ waitingOnClinicians: [{ staffId: 'z', name: 'Z', answersToReview: 0, wordsApprovals: 0, blogDrafts: 0, supersessions: 0 }] })
    expect(buildOwnerInbox({ checkpoints: cp }).team).toEqual([])
  })

  it('says each count once, plural only above one', () => {
    expect(teamPhrase({ answersToReview: 1, blogDrafts: 3, wordsApprovals: 1, supersessions: 2 }))
      .toBe('1 drafted answer, 3 blog drafts, 1 words approval, 2 memory updates')
  })

  it('does not add the team into the headline count', () => {
    expect(buildOwnerInbox({ checkpoints: checkpoints() }).headline.startsWith('3 things need you.')).toBe(true)
  })
})

describe('channels — one line, named properly', () => {
  it('names Google Business, not the raw key', () => {
    const inbox = buildOwnerInbox({ checkpoints: checkpoints() })
    expect(inbox.channels.map((c) => c.label)).toEqual(['Google Business', 'LinkedIn', 'Facebook', 'Instagram', 'Blog'])
    expect(inbox.channelsAlarm).toBe(true)
  })

  it('leaves out channels with no data and stays calm when none are stalled', () => {
    const cp = checkpoints({ health: { channels: [
      { platform: 'gbp', daysIdle: null, status: 'unknown' },
      { platform: 'instagram', daysIdle: 2, status: 'ok' },
    ] } })
    const inbox = buildOwnerInbox({ checkpoints: cp })
    expect(inbox.channels.map((c) => c.platform)).toEqual(['instagram'])
    expect(inbox.channelsAlarm).toBe(false)
  })
})

describe('ownerHeadline', () => {
  const ch = (platform, days, status = 'stalled') => ({ platform, days, status })

  it('quotes the most RECENT social post when every social channel is stalled', () => {
    expect(ownerHeadline(3, [ch('gbp', 68), ch('instagram', 61), ch('blog', 33)]))
      .toBe('3 things need you. No social post has gone out in 61 days.')
  })

  it('says nothing about silence when one social channel is on pace', () => {
    expect(ownerHeadline(3, [ch('gbp', 68), ch('instagram', 2, 'ok')])).toBe('3 things need you.')
  })

  it('ignores the blog, which is not a social channel', () => {
    expect(ownerHeadline(1, [ch('blog', 90)])).toBe('1 thing needs you.')
  })
})

describe('rankTone boundaries', () => {
  it('maps 1 to blocked, 2 to urgent, 3 and up to normal', () => {
    expect(rankTone(1)).toBe('blocked')
    expect(rankTone(2)).toBe('urgent')
    expect(rankTone(3)).toBe('normal')
    expect(rankTone(4)).toBe('normal')
  })
})

describe('GUARD — the owner Home is one inbox', () => {
  const OWNER = read('../../src/pages/OwnerHome.jsx')
  const APP = read('../../src/App.jsx')

  it('owners are routed to OwnerHome', () => {
    expect(APP).toMatch(/EXPERIENCE_OWNER\) return <OwnerHome \/>/)
    expect(APP).not.toMatch(/<CombinedHome|pages\/CombinedHome/)
  })

  it('the page draws from buildOwnerInbox', () => {
    expect(OWNER).toMatch(/buildOwnerInbox\(/)
  })

  it('takes only the owner’s own approvals and the slipping list from the attention rules', () => {
    // Producer kinds (failed, publish, review, draft, channel) come from the
    // checkpoints payload; pulling them from buildAttentionItems too would list
    // the same work twice under two counts.
    expect(OWNER).toMatch(/ownApprovalItems\(/)
    expect(OWNER).toMatch(/buildAttentionItems\(\{ staff \}\)\.byTier\.slipping/)
  })

  it('does not bring back the repeated sections', () => {
    expect(OWNER).not.toMatch(/<CoachingCard|<UpdatesFeed|>All checkpoints<|<AttentionQueue|<HomeStats/)
  })
})
