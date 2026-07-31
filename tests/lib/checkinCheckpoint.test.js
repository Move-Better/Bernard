import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (r) => readFileSync(fileURLToPath(new URL(r, import.meta.url)), 'utf8')
const CHECKPOINTS = read('../../api/_routes/producer/checkpoints.js')
const DONE = read('../../api/_routes/producer/checkin-done.js')
const HOME = read('../../src/pages/ProducerHome.jsx')
const ANALYTICS = read('../../src/pages/Analytics.jsx')
const CARD = read('../../src/components/producer/CheckInCard.jsx')

describe('ProducerHome stays "what do I need to do"', () => {
  it('no longer renders the standing data cards', () => {
    // They competed with the checkpoint queue that IS the work — and the P5
    // finding was that the bottleneck is reviewer ATTENTION.
    expect(HOME).not.toMatch(/<LearningPanel\s*\/>/)
    expect(HOME).not.toMatch(/<CheckInCard\s*\/>/)
  })

  it('does not keep dead imports for them', () => {
    expect(HOME).not.toContain("from '@/components/producer/LearningPanel'")
    expect(HOME).not.toContain("from '@/components/producer/CheckInCard'")
  })

  it('reaches the owner as a DUE checkpoint instead', () => {
    // A check-in nobody is prompted to do is not a check-in. Moving it off the
    // home page without this would have quietly killed the loop.
    expect(CHECKPOINTS).toContain("type: 'learning_checkin'")
    expect(CHECKPOINTS).toContain('/analytics#checkin')
  })
})

describe('the checkpoint only appears when it can say something', () => {
  it('requires a minimum of published work, not just elapsed time', () => {
    // A clinic with three posts does not need a trend review, and a checkpoint
    // that fires before it has anything to show teaches people to skip the queue.
    expect(CHECKPOINTS).toContain('CHECKIN_MIN_PUBLISHED')
    expect(CHECKPOINTS).toMatch(/published >= CHECKIN_MIN_PUBLISHED/)
  })

  it('treats never-checked-in as due once there IS enough to review', () => {
    // NULL last_checkin_at must not mean "wait 30 days from a date nobody set".
    expect(CHECKPOINTS).toMatch(/last == null \|\| daysSince >= CHECKIN_INTERVAL_D/)
  })

  it('states plainly that it blocks nothing', () => {
    // Every other checkpoint says "you are the checkpoint". This one must not
    // imply publishing is held, or it will be treated as urgent and resented.
    expect(CHECKPOINTS).toContain('Nothing is blocked by this')
  })
})

describe('completing a check-in', () => {
  it('is the only write, and it is just a timestamp', () => {
    // Assert on the PATCH BODY, not the whole file: the header comment
    // legitimately discusses graduation and trust while explaining why neither
    // is written here, and a file-wide regex flagged that prose as the defect.
    const body = DONE.match(/body: JSON\.stringify\(([^)]*)\)/)?.[1] || ''
    expect(body).toContain('last_checkin_at')
    expect(body).not.toMatch(/trust|graduat|auto_publish/i)
  })

  it('refreshes the checkpoint queue so the item actually disappears', () => {
    expect(CARD).toContain("queryKey: ['producer-checkpoints']")
  })

  it('is role-gated and workspace-scoped like every other producer write', () => {
    expect(DONE).toContain('requireRole')
    expect(DONE).toContain('EDITOR_ROLES')
    expect(DONE).toMatch(/workspaces\?id=eq\.\$\{ws\.id\}/)
  })
})

describe('Analytics is where the reflection lives', () => {
  it('renders both cards with an anchor the checkpoint can link to', () => {
    expect(ANALYTICS).toContain('<LearningPanel />')
    expect(ANALYTICS).toContain('<CheckInCard />')
    expect(ANALYTICS).toContain('id="checkin"')
  })
})
