import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

const read = (rel) => {
  const raw = readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
  // Live code only — a label left behind in a comment must not count.
  return raw.replace(/\/\*[\s\S]*?\*\//g, ' ').replace(/(^|[^:])\/\/[^\n]*/g, '$1')
}

const keeper = read('../../src/components/story-detail/ModelPostRating.jsx')
const winner = read('../../src/components/story-detail/WinnerToggle.jsx')
const receipt = read('../../src/components/story-detail/PublishedReceipt.jsx')

// The two signals do different jobs — one is the author's read of the craft and
// feeds the exemplar pool, the other is the audience's response and feeds topic
// resurfacing. They were both phrased as verdicts on quality ("this one's a
// keeper" / "mark as winner"), which made them indistinguishable on screen.
describe('the two ratings say which one they are', () => {
  it('the craft signal names the whole composition, not just the words', () => {
    expect(keeper).toContain('The post came together')
  })

  it('the audience signal names the audience', () => {
    expect(winner).toContain('The audience responded')
  })

  it('drops the interchangeable quality verdicts', () => {
    expect(keeper).not.toContain('a keeper')
    expect(keeper).not.toContain('A model post')
    expect(winner).not.toContain('Mark as winner')
    expect(winner).not.toMatch(/'Winner'/)
  })

  // The labels alone still leave "what happens next" unstated, which is the
  // other half of the confusion. The receipt carries the consequence.
  it('the receipt states what each one changes', () => {
    expect(receipt).toContain('style example in future drafts')
    expect(receipt).toContain('this topic back sooner')
  })

  it('frames the pair as teaching rather than scoring', () => {
    expect(receipt).toContain('Teach Bernard from this post')
    expect(receipt).not.toContain('Your call on this one')
  })

  it('keeps the audience half published-only — there is no audience before that', () => {
    expect(receipt).toMatch(/isPublished\s*&&\s*\([\s\S]{0,200}<WinnerToggle/)
  })

  // --action is amber-600, documented in index.css as the act-now/caution
  // signal. A positive judgment is not a caution, and colouring it amber made
  // the pair read as a warning.
  it('uses no caution colour on either rating control', () => {
    for (const src of [keeper, winner]) {
      expect(src).not.toMatch(/bg-action|text-action|border-action/)
    }
  })

  // Muted text on a muted fill read as "unavailable" rather than "not chosen".
  it('does not render the unset audience signal as disabled-looking grey', () => {
    expect(winner).not.toContain('bg-muted/50 text-muted-foreground')
    expect(winner).toContain('text-foreground')
  })

  it('turns emerald only once actually set', () => {
    expect(winner).toContain('bg-success/10 text-success')
    expect(keeper).toContain('bg-success/10')
  })

  // A full-width bar beside a pill read as a truncated, half-broken control.
  it('gives the two controls the same shape in the receipt', () => {
    expect(receipt).toContain('variant="row"')
    expect(winner).toContain("variant = 'chip'")
    expect(winner).toMatch(/isRow[\s\S]{0,300}w-full/)
  })

  it('leaves the compact chip variant intact for the Stories row', () => {
    expect(winner).toContain('rounded-full')
  })

  it('leaves the craft half available on a scheduled post too', () => {
    const winnerAt = receipt.indexOf('<WinnerToggle')
    const keeperAt = receipt.indexOf('<ModelPostRating')
    expect(keeperAt).toBeGreaterThan(-1)
    // Rendered before, and outside, the isPublished branch that wraps the other.
    expect(keeperAt).toBeLessThan(winnerAt)
  })
})
