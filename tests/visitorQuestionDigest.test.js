import { describe, it, expect, vi } from 'vitest'
import { readFileSync } from 'node:fs'

vi.mock('../api/_lib/notifyAdmin.js', () => ({ sendEmail: vi.fn() }))
vi.mock('../api/_lib/workspaceOwner.js', () => ({ alertRecipientEmails: vi.fn() }))

const { runVisitorQuestionDigest, visitorQuestionEmail, countByWorkspace } = await import('../api/_routes/cron/visitor-question-digest.js')

const WS_A = { id: 'a', slug: 'movebetter', display_name: 'Move Better' }
const WS_B = { id: 'b', slug: 'other', display_name: 'Other Clinic' }

describe('visitorQuestionEmail (Monday, count only, approved 2026-11-16)', () => {
  it('two questions: plural wording, the count, and the Topics link', () => {
    const e = visitorQuestionEmail({ wsName: 'Move Better', count: 2, topicsUrl: 'https://movebetter.withbernard.ai/topics' })
    expect(e.subject).toBe('2 new visitor questions — Move Better')
    expect(e.text).toContain("2 visitors asked a question on your website this week that you don't have a published answer for yet.")
    expect(e.text).toContain('They’re waiting in Topics')
    expect(e.text).toContain('Open Topics: https://movebetter.withbernard.ai/topics')
    expect(e.html).toContain('href="https://movebetter.withbernard.ai/topics"')
    expect(e.text).toContain("a visitor's words never travel by email")
  })
  it('one question: singular wording', () => {
    const e = visitorQuestionEmail({ wsName: 'Move Better', count: 1, topicsUrl: 'https://x/topics' })
    expect(e.subject).toBe('1 new visitor question — Move Better')
    expect(e.text).toContain('1 visitor asked a question')
    expect(e.text).toContain('It’s waiting in Topics')
  })
})

describe('runVisitorQuestionDigest', () => {
  const NOW = new Date('2026-11-23T16:00:00Z')
  const harness = (rows, workspaces = [WS_A, WS_B]) => {
    const sent = []
    const asked = {}
    return {
      sent, asked,
      deps: {
        now: NOW,
        listQuestions: async (since) => { asked.since = since; return rows },
        listWorkspaces: async (ids) => { asked.ids = ids; return workspaces.filter((w) => ids.includes(w.id)) },
        recipients: async (ws) => [`owner@${ws.slug}.test`],
        send: async (m) => { sent.push(m) },
      },
    }
  }

  it('nothing new this week: no email, no workspace lookup', async () => {
    const h = harness([])
    const s = await runVisitorQuestionDigest(h.deps)
    expect(s).toMatchObject({ questions: 0, workspacesEmailed: 0 })
    expect(h.sent).toEqual([])
    expect(h.asked.ids).toBeUndefined()
  })

  it('asks for the last 7 days only', async () => {
    const h = harness([])
    await runVisitorQuestionDigest(h.deps)
    expect(h.asked.since).toBe('2026-11-16T16:00:00.000Z')
  })

  it("each workspace gets its own count and its own Topics link, and only its owner", async () => {
    const h = harness([{ workspace_id: 'a' }, { workspace_id: 'a' }, { workspace_id: 'b' }])
    const s = await runVisitorQuestionDigest(h.deps)
    expect(s).toMatchObject({ questions: 3, workspacesEmailed: 2, errors: 0 })
    const toA = h.sent.find((m) => m.to[0] === 'owner@movebetter.test')
    const toB = h.sent.find((m) => m.to[0] === 'owner@other.test')
    expect(toA.subject).toBe('2 new visitor questions — Move Better')
    expect(toA.text).toContain('https://movebetter.withbernard.ai/topics')
    expect(toB.subject).toBe('1 new visitor question — Other Clinic')
    expect(toB.text).toContain('https://other.withbernard.ai/topics')
  })

  it('a workspace with no reachable owner is skipped, and one failing send does not stop the rest', async () => {
    const h = harness([{ workspace_id: 'a' }, { workspace_id: 'b' }])
    h.deps.recipients = async (ws) => (ws.id === 'a' ? [] : ['owner@other.test'])
    expect((await runVisitorQuestionDigest(h.deps)).workspacesEmailed).toBe(1)
    const h2 = harness([{ workspace_id: 'a' }, { workspace_id: 'b' }])
    h2.deps.send = async (m) => { if (m.to[0] === 'owner@movebetter.test') throw new Error('resend down'); h2.sent.push(m) }
    const s = await runVisitorQuestionDigest(h2.deps)
    expect(s).toMatchObject({ workspacesEmailed: 1, errors: 1 })
  })

  it('countByWorkspace ignores rows with no workspace', () => {
    expect([...countByWorkspace([{ workspace_id: 'a' }, {}, null, { workspace_id: 'a' }])]).toEqual([['a', 2]])
  })
})

describe('the live query and the schedule', () => {
  const src = readFileSync(new URL('../api/_routes/cron/visitor-question-digest.js', import.meta.url), 'utf8')
  it('reads only pending visitor questions, never their text', () => {
    expect(src).toMatch(/topic_backlog\?source=eq\.vigil_signal&status=eq\.pending&created_at=gte\./)
    expect(src).toMatch(/&select=workspace_id&/)
  })
  it('runs Mondays from vercel.json', () => {
    const vercel = JSON.parse(readFileSync(new URL('../vercel.json', import.meta.url), 'utf8'))
    expect(vercel.crons).toContainEqual({ path: '/api/cron/visitor-question-digest', schedule: '0 16 * * 1' })
  })
})
