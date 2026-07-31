import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'
import {
  CLIP_DISCARD_REASONS,
  CLIP_DISCARD_REASON_KEYS,
  CLIP_DISCARD_REASON_LABEL,
  CLIP_DISCARD_NOTE_MAX,
} from '../../src/lib/clipDiscard.js'
import { MOMENT_RETIRE_REASON_KEYS } from '../../src/lib/momentRetire.js'

// fileURLToPath, not URL.pathname — the repo lives under "Claude Projects" and
// .pathname percent-encodes the space into %20, which readFileSync ENOENTs.
const read = (p) => readFileSync(fileURLToPath(new URL(p, import.meta.url)), 'utf8')

const PATCH_ROUTE = read('../../api/_routes/editorial/segments/[id].js')
const LIST_ROUTE = read('../../api/_routes/editorial/segments.js')
const MIGRATION = read('../../supabase/multitenant/migrations/202_video_segments_discard_reasons.sql')

describe('clip discard reasons — the vocabulary', () => {
  it('is a non-empty set of unique keys with labels', () => {
    expect(CLIP_DISCARD_REASONS.length).toBeGreaterThan(0)
    const keys = CLIP_DISCARD_REASONS.map((r) => r.key)
    expect(new Set(keys).size).toBe(keys.length)
    for (const r of CLIP_DISCARD_REASONS) {
      expect(r.label, `${r.key} needs a label`).toBeTruthy()
      expect(CLIP_DISCARD_REASON_LABEL[r.key]).toBe(r.label)
      expect(CLIP_DISCARD_REASON_KEYS.has(r.key)).toBe(true)
    }
  })

  it('says something the quote vocabulary cannot', () => {
    // The whole reason this is a separate list (Q, 2026-07-30): a clip can be a
    // fine quote and still unusable because the audio or picture is bad. If
    // this ever becomes a subset of the moment keys, the split has lost its
    // point and the two should be merged instead.
    const clipOnly = [...CLIP_DISCARD_REASON_KEYS].filter((k) => !MOMENT_RETIRE_REASON_KEYS.has(k))
    expect(clipOnly.length).toBeGreaterThan(0)
    expect(clipOnly).toContain('quality')
  })
})

// GUARD — a column you can WRITE must also be one you can READ (CLAUDE.md,
// #2505). `format` shipped in the PATCH allowlist but not the SELECT, so every
// reader got undefined and the feature was inert while lint, typecheck, build
// and the whole suite stayed green. These columns are new, so pin both ends.
describe('discard columns are readable, not just writable', () => {
  it('the migration creates both columns', () => {
    expect(MIGRATION).toMatch(/add column if not exists\s+discard_reasons\s+text\[\]/i)
    expect(MIGRATION).toMatch(/add column if not exists\s+discard_note\s+text/i)
  })

  it('the PATCH route writes both columns', () => {
    expect(PATCH_ROUTE).toMatch(/discard_reasons:/)
    expect(PATCH_ROUTE).toMatch(/discard_note:/)
  })

  it('the list route SELECTs both columns', () => {
    // A `select=` that omits these makes the editor unable to show what a denied
    // clip was denied for — write-only, inert, silent.
    const select = LIST_ROUTE.match(/&select=([^`'"]+)/g)?.join(' ') || ''
    expect(select).toContain('discard_reasons')
    expect(select).toContain('discard_note')
  })

  it('validates reason keys server-side against the shared vocabulary', () => {
    // An unrecognised key must 400 rather than land in the column as a value no
    // reader will ever map to a label.
    //
    // `.has(` — the CALL, not the bare name. Matching the name alone passed on
    // the import statement even with the whole validation block deleted, which
    // is the mention-vs-use trap in CLAUDE.md; proven by mutation.
    expect(PATCH_ROUTE).toMatch(/CLIP_DISCARD_REASON_KEYS\.has\(/)
    expect(PATCH_ROUTE).toMatch(/invalid_discard_reasons/)
  })

  it('clears the reasons when a segment is un-denied', () => {
    // Leaving them attached would mark a segment nobody is rejecting any more.
    expect(PATCH_ROUTE).toMatch(/discard_reasons: null/)
  })

  it('caps the free-text note', () => {
    expect(CLIP_DISCARD_NOTE_MAX).toBeGreaterThan(0)
    expect(PATCH_ROUTE).toMatch(/CLIP_DISCARD_NOTE_MAX/)
  })
})

// The report was "there is no denial button", and a Discard link DID exist —
// buried in the Moments side panel, used once across 172 segments. The fix is
// the header affordance, so pin that it's there and that it's a verdict button
// (red), not brand teal, per the standing rule that teal reads as navigation.
describe('the Deny button is in the editor header', () => {
  const EDITOR = read('../../src/pages/VideoEditor.jsx')

  it('renders a Deny control wired to the reasons picker', () => {
    expect(EDITOR).toMatch(/ClipDiscardReasons/)
    // Element text content: `<ThumbsDown … />Deny</Button>` — the `\s*` spans the
    // newline+indent between the label and the closing tag.
    expect(EDITOR).toMatch(/\/>Deny\s*</)
  })

  it('denies through the segment status write, not a bespoke path', () => {
    expect(EDITOR).toMatch(/updateSegment\(selectedSegmentId, 'discarded'/)
  })

  it('uses destructive colour on the trigger, not the brand primary', () => {
    // Standing rule: verdict buttons take semantic colour — approve=green,
    // reject=red — because brand teal reads as navigation.
    //
    // Both tokens in ONE className, because the trigger is what this pins. A
    // bare /text-destructive/ passed even with the trigger repainted teal, since
    // the popover's confirm button carries text-destructive-foreground; proven
    // by mutation.
    expect(EDITOR).toMatch(/border-destructive\/40[^"]*text-destructive/)
  })
})
