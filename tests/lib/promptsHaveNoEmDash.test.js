import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAtomSystemPrompt, buildModelExemplarsBlock } from '../../api/_lib/atomPrompts.js'
import { lengthLine, briefLengthLine } from '../../api/_lib/socialLengthTargets.js'
import { pointContentFraming } from '../../src/lib/pointContentFraming.js'

// GUARD — a "never do X" prompt rule is a no-op while the prompt's own text
// DOES X. The model copies what it is shown far more reliably than what it is
// told, so an instruction that is contradicted by the prose stating it gets
// imitated, not obeyed.
//
// #2396 added "No em-dashes or spaced hyphens used as connectors" to the atom
// prompt and the tell kept shipping. The reason was visible in the same string:
// the built prompt carried 11-17 em-dashes of its own, plus en-dash numeric
// ranges ("3-5 slides", "45-60 second") that train number-adjacent dashes. The
// worst single line was not even in atomPrompts.js: lengthLine() is injected
// into EVERY atom prompt and contributed three dashes by itself.
//
// This guard is the check that would have caught #2396 shipping inert. It
// asserts on the BUILT string, which is the only thing the model actually sees,
// so a dash reintroduced anywhere in the graph (atomPrompts, socialLengthTargets,
// pointContentFraming, prompts.js) fails here regardless of which file it lives in.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const ATOM_SRC = readFileSync(
  fileURLToPath(new URL('../../api/_lib/atomPrompts.js', import.meta.url)),
  'utf8',
)

const DASHES = /[—–]/g

// Parse the platform/angle pairs out of the `const instructions = { … }` block
// rather than hardcoding them, so a newly added angle is covered automatically
// instead of silently escaping the guard.
function platformAngles(src) {
  const start = src.indexOf('const instructions = {')
  expect(start).toBeGreaterThan(-1)
  const block = src.slice(start, src.indexOf('\n  }\n', start))
  const pairs = []
  let platform = null
  for (const line of block.split('\n')) {
    const p = line.match(/^ {4}([a-z_0-9]+): \{/)
    if (p) { platform = p[1]; continue }
    const a = line.match(/^ {6}([a-z_0-9]+): `/)
    if (a && platform) pairs.push([platform, a[1]])
  }
  return pairs
}

const WS = {
  display_name: 'Move Better',
  website: 'https://movebetter.co',
  location_keyword: 'Portland',
  location_hashtag: '#PortlandPT',
  brand_hashtag: '#MoveBetter',
  brand_voice: 'Plain, direct, curious. We explain the why.',
  social_length_dial: 3,
}

describe('atom prompt: the built string contains no em/en-dash', () => {
  const pairs = platformAngles(ATOM_SRC)

  it('parses the platform/angle map (a rotted regex would pass vacuously)', () => {
    expect(pairs.length).toBeGreaterThanOrEqual(15)
    // Pin known members so an empty/garbage parse can't slip through.
    expect(pairs).toContainEqual(['instagram', 'hook'])
    expect(pairs).toContainEqual(['gbp', 'local_authority'])
    expect(pairs).toContainEqual(['tiktok', 'myth_buster'])
  })

  it.each(pairs)('%s/%s is dash-free in every mode', (platform, angle) => {
    for (const voiceMode of ['practice', 'personal']) {
      for (const isPoint of [false, true]) {
        for (const hasArticle of [false, true]) {
          const prompt = getAtomSystemPrompt(
            WS, 'Philip Abraham', 'sciatica', platform, angle, voiceMode,
            'smart', 'Keep it concrete.', 'KEY MESSAGES: movement first',
            [{ phrase: 'the joint is not the problem' }],
            null, null,
            '\nCAMPAIGN FOCUS: free seminar on August 11th\n',
            '', hasArticle, '', '', isPoint,
          )
          expect(prompt, `${platform}/${angle} returned null`).toBeTruthy()
          // Non-vacuity: a trivially short prompt would pass the dash check
          // while proving nothing about the real instruction text.
          expect(prompt.length).toBeGreaterThan(800)
          const found = prompt.match(DASHES) || []
          expect(
            found,
            `${platform}/${angle} voice=${voiceMode} point=${isPoint}: ` +
            `${found.length} dash(es) in the prompt sent to the model`,
          ).toEqual([])
        }
      }
    }
  })
})

describe('prompt fragments that feed the atom prompt are dash-free', () => {
  it('lengthLine (injected into EVERY atom prompt) has no dash', () => {
    const lines = []
    for (const [platform, angle] of platformAngles(ATOM_SRC)) {
      const l = lengthLine(platform, angle)
      if (l) lines.push([`${platform}/${angle}`, l])
    }
    // Non-vacuity: lengthLine returns '' for unknown combos, and a guard over
    // an empty list passes trivially.
    expect(lines.length).toBeGreaterThanOrEqual(15)
    for (const [label, l] of lines) {
      expect(l.match(DASHES) || [], `lengthLine ${label}: ${l}`).toEqual([])
    }
  })

  it('briefLengthLine (the write-once brief path) has no dash', () => {
    const built = ['instagram', 'linkedin', 'facebook', 'gbp', 'twitter']
      .map((p) => briefLengthLine(p)).filter(Boolean)
    expect(built.length).toBeGreaterThanOrEqual(4)
    for (const l of built) expect(l.match(DASHES) || [], l).toEqual([])
  })

  it('pointContentFraming has no dash in either format', () => {
    for (const format of ['short', 'long']) {
      const block = pointContentFraming({ isPoint: true, format })
      expect(block.length).toBeGreaterThan(100)
      expect(block.match(DASHES) || [], `pointContentFraming ${format}`).toEqual([])
    }
  })

  it('buildModelExemplarsBlock has no dash (its reason/note join used one)', () => {
    const block = buildModelExemplarsBlock([
      { content: 'A caption that landed well.', model_reasons: ['hook', 'voice'], model_note: 'the opener did the work' },
    ])
    expect(block.length).toBeGreaterThan(50)
    expect(block.match(DASHES) || [], block).toEqual([])
  })
})
