import { describe, it, expect } from 'vitest'
import { readFileSync, readdirSync, statSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — every path that writes RAW MODEL OUTPUT into content_items.content
// must run it through stripAiDashes first.
//
// The em-dash sanitizer shipped in #2438 and was wired into the paths someone
// thought of at the time. The interview fan-out (api/_routes/db/interviews.js)
// was not one of them, and it is the FIRST content a clinician ever sees for
// every platform. It had no stripAiDashes import at all. Proven in prod
// 2026-08-10: rows whose ai_original_content still carried an em-dash AND
// equalled content, i.e. the model wrote the tell, nothing stripped it, and a
// human had to remove it by hand. That is the complaint behind feedback
// a302197d, reported for the third time.
//
// A route-by-route audit is what missed it, so this guard discovers the writers
// from source instead: any file that touches content_items AND writes a
// `content:` field has to be classified below. A NEW writer fails this test
// until someone decides which side it is on, which is the whole point.
//
// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const API_DIR = fileURLToPath(new URL('../../api', import.meta.url))

function walk(dir) {
  const out = []
  for (const entry of readdirSync(dir)) {
    const full = `${dir}/${entry}`
    if (statSync(full).isDirectory()) out.push(...walk(full))
    else if (entry.endsWith('.js')) out.push(full)
  }
  return out
}

// A file is a candidate writer if it references the table AND assigns a
// `content:` field. This intentionally over-matches (it also catches `content:`
// keys inside model `messages` arrays); the over-matches are pinned below with
// their reason, which keeps the classification honest rather than silent.
function candidateWriters() {
  return walk(API_DIR)
    .filter((f) => {
      const src = readFileSync(f, 'utf8')
      return src.includes('content_items') && /^\s*content:\s*\S/m.test(src)
    })
    .map((f) => f.slice(API_DIR.length + 1))
    .sort()
}

// MUST call stripAiDashes: these write model-generated prose into a draft.
const AI_WRITERS = [
  '_lib/producer/draftAtom.js',              // the atom drafter
  '_lib/producer/regradeContentItem.js',     // AI revise, stripped before the judge scores it
  '_routes/briefs/generate.js',              // write-once brief fan-out
  '_routes/content-items/blog-regen-finalize.js', // regenerated blog prose
  '_routes/content-items/copy-to-platforms.js',
  '_routes/content-items/regenerate.js',
  '_routes/db/interviews.js',                // the interview fan-out (the #2438 miss)
  '_routes/editorial/approve-package.js',    // model-written package caption
  '_routes/webhooks/twilio-recording.js',    // F1 outbound call, same fan-out shape
]

// Deliberately NOT sanitized. Each needs a reason, not just an entry.
const NOT_AI_TEXT = {
  // The clinician's own edit. A dash they typed on purpose is theirs to keep;
  // sanitizing human prose here would be the tool overruling the author.
  '_routes/db/content.js': 'human edit path',
  // Caption arrives from the request body, i.e. already reviewed by a person.
  '_routes/editorial/clip-to-post.js': 'caption supplied by caller',
  '_routes/editorial/youtube-create.js': 'description typed/confirmed in the request body',
  '_lib/clipDraft.js': 'caption passed in by the caller',
  // Caption comes from draftAtom(), which already returns sanitized text.
  '_lib/producer/predraftWeek.js': 'caption from draftAtom (sanitized upstream)',
  '_lib/producer/draftOnTopic.js': 'caption from draftAtom (sanitized upstream)',
  '_routes/content-plan/draft.js': 'caption from draftAtom (sanitized upstream)',
  // `content:` here is a key inside a model `messages` array, not a row write.
  '_routes/content-items/split-into-series.js': 'content: is a chat message, not a column',
  '_routes/content-items/blog-regen-prepare.js': 'content: is a chat message, not a column',
  '_lib/practiceMemoryRag.js': 'content: is a chat message, not a column',
  // Handout body is a separate document pipeline, not a social/blog draft.
  'handout/create.js': 'handout document, not a reviewed content draft',
}

describe('every AI-text writer to content_items sanitizes dashes', () => {
  const found = candidateWriters()

  it('discovers the writers (a rotted scan would pass vacuously)', () => {
    expect(found.length).toBeGreaterThanOrEqual(15)
    // Pin known members so an empty or garbage scan cannot slip through.
    expect(found).toContain('_routes/db/interviews.js')
    expect(found).toContain('_lib/producer/draftAtom.js')
    expect(found).toContain('_routes/db/content.js')
  })

  it('classifies every discovered writer (a new one must pick a side)', () => {
    const unclassified = found.filter(
      (f) => !AI_WRITERS.includes(f) && !(f in NOT_AI_TEXT),
    )
    expect(
      unclassified,
      'New content_items writer(s). Add to AI_WRITERS (and call stripAiDashes) ' +
      'or to NOT_AI_TEXT with a reason.',
    ).toEqual([])
  })

  it('has no stale entries in either list', () => {
    const stale = [...AI_WRITERS, ...Object.keys(NOT_AI_TEXT)].filter((f) => !found.includes(f))
    expect(stale, 'Listed but no longer a content_items writer').toEqual([])
  })

  it.each(AI_WRITERS)('%s actually calls stripAiDashes', (rel) => {
    const src = readFileSync(`${API_DIR}/${rel}`, 'utf8')
    // Require a real CALL, not a mention: a name appearing in a comment would
    // satisfy `includes(name)` while the sanitizer never runs.
    expect(src, `${rel} does not import stripAiDashes`).toMatch(/import \{[^}]*stripAiDashes[^}]*\} from/)
    expect(src, `${rel} imports stripAiDashes but never calls it`).toMatch(/stripAiDashes\(/)
  })
})
