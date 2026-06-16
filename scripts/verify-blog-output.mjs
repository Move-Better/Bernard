#!/usr/bin/env node
// Acceptance test for the blog output-hygiene helpers (src/lib/blogOutput.js)
// and the three publish-path lints they back: deterministic/non-duplicating
// slugs (§1), exactly one <h1> per article (§2), and ≤60-char SEO titles (§3).
//
// These guard the fixes from the 2026-06 "Fix Bernard blog output" brief — the
// generator-side defects (multiple H1s, overlong <title>, duplicate slugs) that
// a June 2026 SEO audit traced to Bernard's output, not hand-authoring.
//
// Run: node scripts/verify-blog-output.mjs   (exit 0 = all pass)

import {
  slugifyTitle,
  findSlugPrefixCollision,
  deriveSeoTitle,
  composePageTitle,
  cleanBlogMarkdown,
  findBodyH1,
  SEO_TITLE_MAX,
} from '../src/lib/blogOutput.js'

let pass = 0
let fail = 0
function check(name, got, want) {
  const ok = JSON.stringify(got) === JSON.stringify(want)
  if (ok) {
    pass++
  } else {
    fail++
    console.error(`FAIL  ${name}`)
    console.error(`   got : ${JSON.stringify(got)}`)
    console.error(`   want: ${JSON.stringify(want)}`)
  }
}

// ── §1 deterministic, non-duplicating slugs ───────────────────────────────────
const discTitle = 'Surgery Isn’t Your Only Option for a Disc Herniation, and Here’s Why'
check('slug is deterministic (same in → same out)', slugifyTitle(discTitle), slugifyTitle(discTitle))
check('slug capped at <=60', slugifyTitle(discTitle).length <= 60, true)
check('slug cuts on a word boundary', slugifyTitle(discTitle), 'surgery-isn-t-your-only-option-for-a-disc-herniation-and')
check('short title untouched', slugifyTitle('Hello World'), 'hello-world')

// the live duplicate the audit found: …-your-only vs …-your-only-option
check('prefix collision fires (shorter then longer)',
  findSlugPrefixCollision('surgery-isnt-your-only-option', ['surgery-isnt-your-only']),
  'surgery-isnt-your-only')
check('prefix collision fires (longer then shorter)',
  findSlugPrefixCollision('surgery-isnt-your-only', ['surgery-isnt-your-only-option']),
  'surgery-isnt-your-only-option')
check('no false collision on unrelated slugs',
  findSlugPrefixCollision('knee-pain', ['low-back-pain', 'neck-pain']), null)
check('no collision when not at a hyphen boundary',
  findSlugPrefixCollision('cars', ['car']), null)
check('exact match skipped (handled by existence check)',
  findSlugPrefixCollision('foo-bar', ['foo-bar']), null)

// ── §3 title length <=60 ──────────────────────────────────────────────────────
const longHeadline = 'How to Fix Chronic Low Back Pain Without Surgery, Injections, or Endless Physical Therapy Appointments'
check('derived SEO title <= 60', deriveSeoTitle(longHeadline).length <= SEO_TITLE_MAX, true)
check('derived SEO title front-loads the headline',
  deriveSeoTitle(longHeadline), 'How to Fix Chronic Low Back Pain Without Surgery')
check('short headline returned verbatim',
  deriveSeoTitle('Why we breathe wrong'), 'Why we breathe wrong')
check('page title keeps brand suffix when it fits',
  composePageTitle('Why we breathe wrong', ' · Move Better', 60), 'Why we breathe wrong · Move Better')
check('page title drops brand suffix on overflow',
  composePageTitle('How to Fix Chronic Low Back Pain Without Surgery', ' · Move Better', 60),
  'How to Fix Chronic Low Back Pain Without Surgery')

// ── §2 exactly one <h1> (body never carries one) ──────────────────────────────
const rawBody = [
  '# The Real Reason Your Back Hurts',
  '',
  'Intro paragraph here.',
  '',
  '## What we see in clinic',
  '',
  'Stuff.',
  '',
  '# A stray top-level heading',
  '',
  'More.',
].join('\n')
const cleaned = cleanBlogMarkdown(rawBody)
check('headline extracted from leading #', cleaned.headline, 'The Real Reason Your Back Hurts')
check('leading headline stripped from body', cleaned.body.startsWith('Intro paragraph'), true)
check('stray body h1 demoted to h2', cleaned.body.includes('## A stray top-level heading'), true)
check('## sections preserved', cleaned.body.includes('## What we see in clinic'), true)
check('cleaned body carries no h1', findBodyH1(cleaned.body).length, 0)

// lint rejects a body that still contains a "# " heading (the publish-path gate)
check('lint catches a real body h1', findBodyH1('# real heading\ntext').length, 1)
check('lint ignores a # inside a fenced code block',
  findBodyH1('```\n# not a heading\n```').length, 0)
const fenced = '# Title\n\n```\n# shell comment\n```\n\nBody.'
check('clean leaves fenced # intact', cleanBlogMarkdown(fenced).body.includes('# shell comment'), true)

console.log(`\nblog-output acceptance: ${pass} passed, ${fail} failed`)
process.exit(fail ? 1 : 0)
