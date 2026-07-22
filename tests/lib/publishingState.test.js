import { describe, it, expect } from 'vitest'
import { isPublishing, statusMetaFor } from '@/lib/contentMeta'

const at = (msFromNow) => new Date(Date.now() + msFromNow).toISOString()
const MIN = 60_000

describe('isPublishing — the in-flight window after a publish-now', () => {
  // bundle accepts the post and schedules it ~60s out, then posts it and
  // confirms by webhook. That minute is in flight, not queued.
  it('is true for a post due about a minute from now', () => {
    expect(isPublishing({ status: 'scheduled', scheduled_at: at(60 * 1000) })).toBe(true)
  })

  it('is true just after the due time, while the webhook is still landing', () => {
    expect(isPublishing({ status: 'scheduled', scheduled_at: at(-30 * 1000) })).toBe(true)
  })

  it('is false for a genuinely scheduled post later today', () => {
    expect(isPublishing({ status: 'scheduled', scheduled_at: at(4 * 60 * MIN) })).toBe(false)
  })

  // A long-overdue post is late, possibly stuck — claiming it is "publishing"
  // would hide exactly the problem someone needs to see.
  it('is false for a long-overdue post rather than claiming it is publishing', () => {
    expect(isPublishing({ status: 'scheduled', scheduled_at: at(-3 * 24 * 60 * MIN) })).toBe(false)
  })

  it('only ever applies to scheduled rows', () => {
    expect(isPublishing({ status: 'published', scheduled_at: at(10 * 1000) })).toBe(false)
    expect(isPublishing({ status: 'draft', scheduled_at: at(10 * 1000) })).toBe(false)
    expect(isPublishing({ status: 'failed', scheduled_at: at(10 * 1000) })).toBe(false)
  })

  it('tolerates a missing or unparseable timestamp', () => {
    expect(isPublishing({ status: 'scheduled', scheduled_at: null })).toBe(false)
    expect(isPublishing({ status: 'scheduled' })).toBe(false)
    expect(isPublishing({ status: 'scheduled', scheduled_at: 'not a date' })).toBe(false)
    expect(isPublishing(null)).toBe(false)
  })
})

describe('statusMetaFor — the chip a user reads while watching a post go out', () => {
  it('says Publishing… during the in-flight window', () => {
    expect(statusMetaFor({ status: 'scheduled', scheduled_at: at(45 * 1000) }).label).toBe('Publishing…')
  })

  it('says Scheduled for a real future slot', () => {
    expect(statusMetaFor({ status: 'scheduled', scheduled_at: at(6 * 60 * MIN) }).label).toBe('Scheduled')
  })

  it('leaves every other status exactly as before', () => {
    expect(statusMetaFor({ status: 'published' }).label).toBe('Published')
    expect(statusMetaFor({ status: 'failed' }).label).toBe('Failed')
    expect(statusMetaFor({ status: 'draft' }).label).toBe('Draft')
    expect(statusMetaFor({ status: 'approved' }).label).toBe('Ready to publish')
  })

  it('falls back readably for an unknown status', () => {
    expect(statusMetaFor({ status: 'weird_new_status' }).label).toBe('weird_new_status')
    expect(statusMetaFor({}).label).toBe('—')
  })
})
