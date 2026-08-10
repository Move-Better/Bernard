import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import { getAtomSystemPrompt, buildModelExemplarsBlock } from '../../api/_lib/atomPrompts.js'
import { lengthLine, briefLengthLine } from '../../api/_lib/socialLengthTargets.js'
import { pointContentFraming } from '../../src/lib/pointContentFraming.js'
import { stripAiDashes } from '../../api/_lib/stripAiDashes.js'
import {
  getBlogPostSystemPrompt,
  getSeriesPartSystemPrompt,
  getNewsletterSystemPrompt,
} from '../../src/lib/prompts.js'

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

// The system prompt is only half of what the model is shown. The USER message
// demonstrates the style just as loudly, and draftAtom/regenerate both carried
// em-dash connectors there ("from our conversation above — that is the source
// of truth") on every single draft. Several sibling builders had the same
// problem, and two of them (regradeContentItem, copy-to-platforms) had no
// em-dash rule at all while still generating draft text.
//
// This scans the model-facing string literals of each builder rather than
// calling them, because their entry points need a DB and a live model. Comment
// lines are excluded (they never reach the model) and so are the human-facing
// error/notification strings listed per file.
const BUILDERS = {
  'api/_lib/producer/draftAtom.js': [],
  'api/_routes/content-items/regenerate.js': [],
  'api/_lib/captionGen.js': [],
  'api/_lib/producer/regradeContentItem.js': [
    // Human-facing producer notifications, not model input.
    'it clears the voice check now',
    "couldn't get it over the bar",
    'needs you',
  ],
  'api/_routes/content-items/copy-to-platforms.js': [],
  'api/_lib/briefPrompts.js': [],
  // The blog and long-form builder. #2597 fixed the social path and recorded
  // this file as a known gap: it exported NO_EM_DASH_RULE while its own
  // instruction strings carried 302 dashes, so the rule was competing with 302
  // counter-examples. Cleared in the follow-up. Its 47 remaining dashes all sit
  // in comments, which the filter below drops, so this needs no allowlist.
  'src/lib/prompts.js': [],
}

// Error strings thrown/logged to humans. A dash here is fine; it is never shown
// to the model, so excluding them keeps the guard honest rather than noisy.
const HUMAN_FACING = [
  'console.error', 'console.warn', 'console.info', 'console.log',
  'throw new Error', 'return err(', 'Error(',
]

// Strip comments by TRACKING BLOCK STATE, not by guessing from a line's first
// character. The original filter skipped any line whose trimmed form began with
// "*", which is right for a JSDoc continuation and wrong for markdown: prompt
// templates are full of lines like `*${seriesTitle}, Part ${partNum}*` and
// `**vocabulary_swap**: …`. That hole hid a real em-dash in the clinical
// series-part footer from every source scan; only the built-string suite below
// caught it. A guard that silently skips the lines it should read is worse than
// no guard, so the state machine replaces the heuristic.
//
// "//" only counts as a comment at line start or after whitespace, so the "//"
// in an https:// URL does not truncate the line.
function codeOnlyLines(src) {
  const out = []
  let inBlock = false
  src.split('\n').forEach((raw, i) => {
    let line = raw
    if (inBlock) {
      const end = line.indexOf('*/')
      if (end === -1) { out.push([i + 1, '']); return }
      inBlock = false
      line = line.slice(end + 2)
    }
    // Closed /* … */ pairs on this line.
    line = line.replace(/\/\*[^*]*\*+([^/*][^*]*\*+)*\//g, '')
    const open = line.indexOf('/*')
    if (open !== -1) { inBlock = true; line = line.slice(0, open) }
    line = line.replace(/(^|\s)\/\/.*$/, '')
    out.push([i + 1, line])
  })
  return out
}

function modelFacingDashLines(rel) {
  const src = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')
  const allowed = BUILDERS[rel]
  return codeOnlyLines(src)
    .filter(([, line]) => {
      if (!DASHES.test(line)) { DASHES.lastIndex = 0; return false }
      DASHES.lastIndex = 0
      if (HUMAN_FACING.some((h) => line.includes(h))) return false
      if (allowed.some((a) => line.includes(a))) return false
      return true
    })
    .map(([n, line]) => `${rel}:${n} ${line.trim().slice(0, 120)}`)
}

describe('every draft-generating prompt builder is dash-free in its model-facing strings', () => {
  it('reads all the builders (a bad path would pass vacuously)', () => {
    for (const rel of Object.keys(BUILDERS)) {
      const src = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')
      expect(src.length, `${rel} looks empty`).toBeGreaterThan(1000)
    }
  })

  it.each(Object.keys(BUILDERS))('%s', (rel) => {
    expect(modelFacingDashLines(rel)).toEqual([])
  })

  // The comment stripper is the part of this guard most able to fail open: if
  // it over-matches, whole prompt bodies stop being scanned and every file
  // passes vacuously. These pin both directions.
  it('the comment stripper reads markdown lines and drops real comments', () => {
    const scanned = codeOnlyLines([
      '/* block — one */',
      '/** jsdoc',
      ' * continuation — two',
      ' */',
      'const a = 1 // trailing — three',
      "const url = 'https://movebetter.co/a—b'",
      '*${seriesTitle}, Part ${partNum}*',
      '- **vocabulary_swap**: the draft',
    ].join('\n')).map(([, l]) => l)

    // Comments are gone, in every shape.
    expect(scanned[0].trim()).toBe('')
    expect(scanned[1].trim()).toBe('')
    expect(scanned[2].trim()).toBe('')
    expect(scanned[3].trim()).toBe('')
    expect(scanned[4]).toBe('const a = 1')
    // A URL keeps its "//" and everything after it.
    expect(scanned[5]).toContain('movebetter.co')
    // Markdown lines survive: these are model input, not comments. This is the
    // exact case the old first-character heuristic threw away.
    expect(scanned[6]).toContain('Part ${partNum}')
    expect(scanned[7]).toContain('vocabulary_swap')
  })

  // A stripper that fails open takes this ratio to roughly zero while every
  // dash assertion above keeps passing. Measured today the builders run from
  // 0.586 (captionGen, heavily commented) to 0.919 (briefPrompts), so 0.4 has
  // real headroom for a comment-heavier file and still catches a collapse.
  it('scans the bulk of each builder (an over-matching stripper would not)', () => {
    for (const rel of Object.keys(BUILDERS)) {
      const src = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')
      const kept = codeOnlyLines(src).filter(([, l]) => l.trim()).length
      const total = src.split('\n').filter((l) => l.trim()).length
      expect(kept / total, `${rel}: only ${kept}/${total} lines scanned`).toBeGreaterThan(0.4)
    }
  })

  it('the two builders that had no em-dash rule now carry the shared one', () => {
    for (const rel of ['api/_lib/producer/regradeContentItem.js',
                       'api/_routes/content-items/copy-to-platforms.js']) {
      const src = readFileSync(fileURLToPath(new URL(`../../${rel}`, import.meta.url)), 'utf8')
      expect(src, `${rel} does not import the shared rule`).toMatch(/import \{[^}]*NO_EM_DASH_RULE[^}]*\} from/)
      // A real interpolation, not just an import someone left unused.
      expect(src, `${rel} imports the rule but never interpolates it`).toMatch(/\$\{NO_EM_DASH_RULE\}/)
    }
  })
})

// Source scanning catches a dash typed into prompts.js. It cannot catch one
// arriving through the interpolation graph (pointContentFraming, the length
// line, the provenance block). These build the real long-form prompts and
// assert the string the model is actually handed, the same way the atom suite
// above does. WS_CLEAN is deliberately dash-free so anything found is template
// text rather than tenant data.
const WS_CLEAN = {
  display_name: 'Move Better',
  location: 'Portland',
  location_keyword: 'Portland',
  website: 'https://movebetter.co',
  booking_url: 'https://movebetter.co/book',
  brand_voice: 'Plain, direct, curious. We explain the why.',
  cta_heading: 'Ready to Move Better?',
  internal_links_markdown: '[Low back pain](https://movebetter.co/low-back-pain)',
}

const LONG_FORM = [
  ['blog', (ws, vm) => getBlogPostSystemPrompt(ws, 'Philip Abraham', 'sciatica', 'smart', vm)],
  ['newsletter', (ws, vm) => getNewsletterSystemPrompt(ws, 'Philip Abraham', 'sciatica', vm)],
  ['series-part', (ws, vm) => getSeriesPartSystemPrompt(
    ws, 'Philip Abraham', 'sciatica', 'smart', vm, null, '', [], null,
    { title: 'Why the disc is rarely the story', brief: 'One thread.', anchorMoments: ['the soccer player'] },
    [{ part: 2, title: 'What changes by week four' }], 'The sciatica series',
  )],
]

describe('long-form prompts are dash-free in the BUILT string', () => {
  for (const [label, build] of LONG_FORM) {
    for (const promptMode of ['clinical', 'general']) {
      for (const voiceMode of ['practice', 'personal']) {
        it(`${label} (${promptMode}, ${voiceMode})`, () => {
          const ws = { ...WS_CLEAN, prompt_mode: promptMode === 'general' ? 'general' : undefined }
          const prompt = build(ws, voiceMode)
          expect(prompt, `${label} returned nothing`).toBeTruthy()
          // Non-vacuity: a short or empty prompt would pass the dash check
          // while proving nothing about the real instruction text.
          expect(prompt.length).toBeGreaterThan(800)
          const found = prompt.match(DASHES) || []
          expect(
            found,
            `${label}/${promptMode}/${voiceMode}: ${found.length} dash(es) in the prompt sent to the model`,
          ).toEqual([])
        })
      }
    }
  }
})

// The personal-voice builders instruct a closing signature line. That line used
// to be "— Name, Clinic", and stripAiDashes rewrites a leading dash into a
// comma, which welds the signature onto the end of the previous sentence:
//   "...moving well.\n\n— Philip Abraham"  ->  "...moving well., Philip Abraham"
// Every blog write path runs the sanitizer (#2597), so the instruction has to
// name a signature that survives it. A dash-free instruction is necessary but
// not sufficient on its own, so this asserts the round trip rather than just
// the absence of a dash.
describe('the instructed signature survives the sanitizer', () => {
  const PERSONAL = [
    ['blog', (ws) => getBlogPostSystemPrompt(ws, 'Philip Abraham', 'sciatica', 'smart', 'personal')],
    ['series-part', (ws) => getSeriesPartSystemPrompt(
      ws, 'Philip Abraham', 'sciatica', 'smart', 'personal', null, '', [], null,
      { title: 'T', brief: 'B', anchorMoments: [] }, [], 'S',
    )],
  ]

  // Not every builder instructs a signature: the clinical series part
  // deliberately closes with a series footer instead. Collect whatever exists
  // and assert on that, with a count check so a regex that stops matching
  // cannot turn this suite into a no-op.
  const found = []
  for (const [label, build] of PERSONAL) {
    for (const promptMode of ['clinical', 'general']) {
      const ws = { ...WS_CLEAN, prompt_mode: promptMode === 'general' ? 'general' : undefined }
      const m = build(ws).match(/signature(?: line)?[:,] "([^"]+)"/)
      if (m) found.push([`${label}/${promptMode}`, m[1]])
    }
  }

  it('finds the signature instructions (a rotted regex would pass vacuously)', () => {
    expect(found.length).toBeGreaterThanOrEqual(3)
    expect(found.map(([k]) => k)).toContain('blog/clinical')
  })

  it.each(found)('%s is sanitizer-stable', (_label, signature) => {
    // Round trip through the real sanitizer, as it would run on the model's
    // output, with a preceding sentence so a leading dash has something to
    // weld onto. Unchanged means the signature reaches the reader intact.
    const asWritten = `The whole point is moving well.\n\n${signature}`
    expect(
      stripAiDashes(asWritten),
      `sanitizer rewrites the instructed signature "${signature}"`,
    ).toBe(asWritten)
  })
})
