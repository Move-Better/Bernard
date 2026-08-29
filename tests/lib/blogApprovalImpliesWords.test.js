import { test, expect } from 'vitest'
import {
  blogApprovalImpliesWords,
  blogApprovalSatisfiesWordsGate,
} from '../../api/_lib/blogApprovalImpliesWords.js'

// The rule that collapses blog to ONE approval (Q, 2026-08-29). It decides
// whether approving a piece also stamps the parent story's words_approved_at,
// so every branch here is a real product boundary: a false positive silently
// clears the clinician's truth-check for a channel that was supposed to keep
// it, and a false negative brings back the exact contradiction Philip reported.

const blog = { platform: 'blog', interview_id: '11111111-1111-1111-1111-111111111111' }

test('a blog approve implies the story words approval', () => {
  expect(blogApprovalImpliesWords(blog, 'approved')).toBe(true)
})

test('social approvals never imply words approval', () => {
  // The whole reason the gate exists: these fan out 2-3 posts per story, so the
  // once-per-story check is what they amortise. One caption is not a superset
  // of the story, and must never clear it.
  for (const platform of ['instagram', 'linkedin', 'facebook', 'gbp', 'instagram_story']) {
    expect(blogApprovalImpliesWords({ ...blog, platform }, 'approved'), `${platform} must not imply words approval`).toBe(false)
  }
})

test('only an approve implies it — no other status transition does', () => {
  for (const status of ['draft', 'in_review', 'rejected', 'scheduled', 'published', 'failed']) {
    expect(blogApprovalImpliesWords(blog, status), `status=${status} must not imply words approval`).toBe(false)
  }
})

test('a blog with no parent story implies nothing', () => {
  // Moment-Miner package rows carry interview_id null and are gated by package
  // approval instead (see wordsApprovalGate.js) — there is no story to stamp.
  expect(blogApprovalImpliesWords({ ...blog, interview_id: null }, 'approved')).toBe(false)
  expect(blogApprovalImpliesWords({ platform: 'blog' }, 'approved')).toBe(false)
})

test('is total — never throws on absent or malformed input', () => {
  // Called inline on the approve path; a throw here would 500 a successful
  // approve, which is strictly worse than the gate it replaces.
  expect(blogApprovalImpliesWords(null, 'approved')).toBe(false)
  expect(blogApprovalImpliesWords(undefined, 'approved')).toBe(false)
  expect(blogApprovalImpliesWords(blog, null)).toBe(false)
  expect(blogApprovalImpliesWords(blog, undefined)).toBe(false)
  expect(blogApprovalImpliesWords({}, 'approved')).toBe(false)
})

// ── the stateless half: does an approved blog satisfy the publish gate? ──────
// This is what makes the policy true for rows approved BEFORE it shipped.
// Without it, the editor (which no longer shows the words step for blog) offers
// an enabled Publish button that the server 403s — worse than the contradiction
// it replaced. Exactly one live row was in that state: the piece Philip reported.

test('an approved blog satisfies the words gate even with words_approved_at null', () => {
  expect(blogApprovalSatisfiesWordsGate({ platform: 'blog', status: 'approved' })).toBe(true)
})

test('a blog that moved past approved still satisfies it', () => {
  // A republish/retry must never retroactively fail the gate.
  expect(blogApprovalSatisfiesWordsGate({ platform: 'blog', status: 'scheduled' })).toBe(true)
  expect(blogApprovalSatisfiesWordsGate({ platform: 'blog', status: 'published' })).toBe(true)
})

test('an UNAPPROVED blog still needs the story words — the gate is not removed', () => {
  for (const status of ['draft', 'in_review', 'rejected', 'failed']) {
    expect(blogApprovalSatisfiesWordsGate({ platform: 'blog', status }), status).toBe(false)
  }
})

test('social never satisfies the gate this way, at any status', () => {
  for (const platform of ['instagram', 'linkedin', 'facebook', 'gbp', 'instagram_story']) {
    for (const status of ['approved', 'scheduled', 'published']) {
      expect(
        blogApprovalSatisfiesWordsGate({ platform, status }),
        `${platform}/${status}`,
      ).toBe(false)
    }
  }
})

test('blogApprovalSatisfiesWordsGate is total', () => {
  expect(blogApprovalSatisfiesWordsGate(null)).toBe(false)
  expect(blogApprovalSatisfiesWordsGate(undefined)).toBe(false)
  expect(blogApprovalSatisfiesWordsGate({})).toBe(false)
  expect(blogApprovalSatisfiesWordsGate({ platform: 'blog' })).toBe(false)
})
