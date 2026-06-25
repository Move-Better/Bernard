import { describe, it, expect } from 'vitest'
import {
  slugifyTitle,
  findSlugPrefixCollision,
  smartTruncate,
  deriveSeoTitle,
  composePageTitle,
  cleanBlogMarkdown,
  findBodyH1,
  SLUG_MAX,
  SEO_TITLE_MAX,
} from '../../src/lib/blogOutput.js'

// ── slugifyTitle ─────────────────────────────────────────────────────────────

describe('slugifyTitle', () => {
  it('lowercases and collapses non-alphanumerics to hyphens', () => {
    expect(slugifyTitle('Hello World!')).toBe('hello-world')
  })

  it('trims leading and trailing hyphens', () => {
    expect(slugifyTitle('  --Hello-- ')).toBe('hello')
  })

  it('returns the slug unchanged when it fits within SLUG_MAX', () => {
    const short = 'short-title'
    expect(slugifyTitle(short)).toBe(short)
    expect(slugifyTitle(short).length).toBeLessThanOrEqual(SLUG_MAX)
  })

  it('caps at SLUG_MAX on a word boundary', () => {
    // 80-char title — must produce a slug ≤ 60 chars ending cleanly
    const title = 'Why Your Low Back Pain Keeps Coming Back And The Movement Shift That Changes It'
    const slug = slugifyTitle(title)
    expect(slug.length).toBeLessThanOrEqual(SLUG_MAX)
    expect(slug).not.toMatch(/-$/)
  })

  it('same title always yields the same slug (deterministic)', () => {
    const title = 'Breathing vs Bracing: What Your Body Is Missing'
    expect(slugifyTitle(title)).toBe(slugifyTitle(title))
  })

  it('handles empty / nullish input', () => {
    expect(slugifyTitle('')).toBe('')
    expect(slugifyTitle(null)).toBe('')
    expect(slugifyTitle(undefined)).toBe('')
  })

  it('does not produce a slug longer than SLUG_MAX regardless of title length', () => {
    const veryLong = 'A'.repeat(200) + ' some words at the end'
    expect(slugifyTitle(veryLong).length).toBeLessThanOrEqual(SLUG_MAX)
  })
})

// ── findSlugPrefixCollision ───────────────────────────────────────────────────

describe('findSlugPrefixCollision', () => {
  it('detects when the candidate is a prefix of an existing slug', () => {
    const existing = ['surgery-isnt-your-only-option', 'other-post']
    expect(findSlugPrefixCollision('surgery-isnt-your-only', existing)).toBe('surgery-isnt-your-only-option')
  })

  it('detects when an existing slug is a prefix of the candidate', () => {
    const existing = ['surgery-isnt-your-only', 'other-post']
    expect(findSlugPrefixCollision('surgery-isnt-your-only-option', existing)).toBe('surgery-isnt-your-only')
  })

  it('returns null for an exact match (handled by existence check)', () => {
    const existing = ['exact-slug']
    expect(findSlugPrefixCollision('exact-slug', existing)).toBeNull()
  })

  it('returns null when there is no collision', () => {
    const existing = ['low-back-pain', 'sciatica-treatment']
    expect(findSlugPrefixCollision('shoulder-pain', existing)).toBeNull()
  })

  it('returns null for empty inputs', () => {
    expect(findSlugPrefixCollision('', [])).toBeNull()
    expect(findSlugPrefixCollision(null, null)).toBeNull()
  })
})

// ── smartTruncate ─────────────────────────────────────────────────────────────

describe('smartTruncate', () => {
  it('returns the string unchanged when it fits', () => {
    expect(smartTruncate('Short text', 50)).toBe('Short text')
  })

  it('cuts on a word boundary and strips trailing punctuation', () => {
    const result = smartTruncate('Movement-based care for Portland, Oregon', 30)
    expect(result.length).toBeLessThanOrEqual(30)
    expect(result).not.toMatch(/[,;:.!?\-–—]$/)
  })

  it('handles empty input', () => {
    expect(smartTruncate('', 60)).toBe('')
    expect(smartTruncate(null, 60)).toBe('')
  })
})

// ── deriveSeoTitle ────────────────────────────────────────────────────────────

describe('deriveSeoTitle', () => {
  it('returns short headlines verbatim', () => {
    expect(deriveSeoTitle('Shoulder pain')).toBe('Shoulder pain')
  })

  it('truncates long headlines to SEO_TITLE_MAX', () => {
    const long = 'Why Your Low Back Pain Keeps Coming Back And The Movement Shift That Finally Changes It'
    const result = deriveSeoTitle(long)
    expect(result.length).toBeLessThanOrEqual(SEO_TITLE_MAX)
  })

  it('handles nullish input', () => {
    expect(deriveSeoTitle(null)).toBe('')
  })
})

// ── composePageTitle ──────────────────────────────────────────────────────────

describe('composePageTitle', () => {
  it('appends suffix when the combined string fits', () => {
    expect(composePageTitle('Shoulder Pain', ' · Move Better', 60)).toBe('Shoulder Pain · Move Better')
  })

  it('omits suffix when combined string would exceed maxLen', () => {
    const base = 'A'.repeat(55)
    expect(composePageTitle(base, ' · Move Better', 60)).toBe(base)
  })
})

// ── cleanBlogMarkdown ─────────────────────────────────────────────────────────

describe('cleanBlogMarkdown', () => {
  it('extracts the leading h1 as headline and removes it from body', () => {
    const md = '# My Headline\n\nFirst paragraph.\n'
    const { headline, body, strippedLeadingH1 } = cleanBlogMarkdown(md)
    expect(headline).toBe('My Headline')
    expect(strippedLeadingH1).toBe(true)
    expect(body).not.toContain('# My Headline')
    expect(body).toContain('First paragraph.')
  })

  it('demotes a stray body h1 to h2', () => {
    const md = '# Headline\n\nSome text.\n\n# Stray H1\n\nMore text.\n'
    const { body, demotedCount } = cleanBlogMarkdown(md)
    expect(demotedCount).toBe(1)
    expect(body).toContain('## Stray H1')
    expect(body).not.toMatch(/^# Stray H1/m)
  })

  it('does not modify h1 inside a fenced code block', () => {
    const md = '# Headline\n\n```\n# not a heading\n```\n'
    const { body } = cleanBlogMarkdown(md)
    expect(body).toContain('# not a heading')
  })

  it('handles markdown with no leading h1', () => {
    const md = 'Just a paragraph, no heading.\n'
    const { headline, strippedLeadingH1 } = cleanBlogMarkdown(md)
    expect(headline).toBe('')
    expect(strippedLeadingH1).toBe(false)
  })

  it('drops blank lines left at the top after stripping the headline', () => {
    const md = '# Headline\n\n\n\nFirst paragraph.\n'
    const { body } = cleanBlogMarkdown(md)
    expect(body).not.toMatch(/^\n/)
  })
})

// ── findBodyH1 ────────────────────────────────────────────────────────────────

describe('findBodyH1', () => {
  it('returns hits for each body h1 outside fenced code blocks', () => {
    const md = '# First\n\nText.\n\n# Second\n'
    const hits = findBodyH1(md)
    expect(hits).toHaveLength(2)
    expect(hits[0].line).toBe(1)
  })

  it('ignores h1 inside fenced code blocks', () => {
    const md = '```\n# inside fence\n```\n\n# outside\n'
    const hits = findBodyH1(md)
    expect(hits).toHaveLength(1)
    expect(hits[0].text).toBe('# outside')
  })

  it('returns empty array when there are no h1 headings', () => {
    expect(findBodyH1('## h2 only\n\nParagraph.\n')).toHaveLength(0)
  })

  it('handles empty / nullish input', () => {
    expect(findBodyH1('')).toHaveLength(0)
    expect(findBodyH1(null)).toHaveLength(0)
  })
})
