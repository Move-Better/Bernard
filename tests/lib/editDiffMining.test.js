import { describe, it, expect } from 'vitest'
import { computeEditDiff, summarizeEditDiff } from '../../api/_lib/editDiffMining.js'

// Two of the three real edit pairs pulled from movebetter content_items
// (Supabase MCP, 2026-07-21) that grounded this module's design — an
// Instagram caption with a sentence trimmed + a word-level phrase swap, and a
// Facebook post with a stray CTA link removed before publish. Exact prod
// text, not fabricated — see .claude/decisions.md T4 scoping entry.
const IG_ORIGINAL = `Your bicep tendon actually connects onto your shoulder blade. Not your arm bone. Your shoulder blade.

Most people picture the bicep as an arm muscle — it curls things, it lives between your shoulder and your elbow, end of story. But the long head of the biceps tendon anchors right into the labrum at the front of the shoulder blade. Which means every time your shoulder blade can't retract properly — because your thoracic spine is stiff, because you don't have the active external rotation strength to hold your bench press setup — that tendon is being compressed. All day long.

So when patients come in telling us they've been stretching it, resting it, waiting it out — we have to reframe the whole thing. As Dr. Sophie puts it: resting or stretching it does nothing to increase the actual capacity of the tendon. It's a capacity problem. And the fix is progressive load, not less of it.

That's why our team starts with the shoulder blade. And the thoracic spine. And sometimes, yeah — the ankle.

Full article at the link in bio 👆

#BicepTendinopathy #ShoulderPain #MoveBetter #PortlandChiropractor #ShoulderHealth #MovementIsMedicine #ProgressiveOverload #KineticChain #TrainSmart #PDXFitness`

const IG_EDITED = `Your bicep tendon actually connects onto your shoulder blade. Not your arm bone. Your shoulder blade.

Most people picture the bicep as an arm muscle — it curls things, it lives between your shoulder and your elbow, end of story. But the long head of the biceps tendon anchors right into the labrum at the front of the shoulder blade. Which means every time your shoulder blade can't move properly — because your thoracic spine is stiff, because you don't have the active external rotation strength to hold your bench press setup — that tendon is being compressed and compromised.

So when patients come in telling us they've been stretching it, resting it, waiting it out — we have to reframe the whole thing. As Dr. Sophie puts it: resting or stretching it does nothing to increase the actual capacity of the tendon. It's a capacity problem. And the fix is progressive load, not less of it.

Full article at the link in bio 👆

#BicepTendinopathy #ShoulderPain #MoveBetter #PortlandChiropractor #ShoulderHealth #MovementIsMedicine #ProgressiveOverload #KineticChain #TrainSmart #PDXFitness`

const FB_ORIGINAL = `I watched four people run across a parking lot yesterday and it told me everything.

One runner was too flicky in the feet — you could see the whole bottom of the foot coming up behind them. Another was too springy, too bouncy, way up in the air. And then there was one who was just... running. Free upper body, not thinking about it, just going. Everyone else was trying to run. She was running.

That's the thing I keep coming back to with people in Portland who want to move better — most of us are too linear. Running becomes about the legs and the rest of the body is just along for the ride. There's no ability to navigate the stress of torque, to be twisted and anti-twist, or to create twist.

The fix isn't a drill. It's just — stop being in the way of your own body. Use all of you to run, not just your legs.

We do these running seminars locally for exactly this reason. Come run, get watched, feel where the pattern actually lives.

https://rosehaven.org/helping/financial-gifts/

If you're a runner in Portland — what's the one thing you've been told to fix about your form? Drop it below.

#MoveBetter #Portland`

const FB_EDITED = `I watched four people run across a parking lot yesterday and it told me everything.

One runner was too flicky in the feet — you could see the whole bottom of the foot coming up behind them. Another was too springy, too bouncy, way up in the air. And then there was one who was just... running. Free upper body, not thinking about it, just going. Everyone else was trying to run. She was running.

That's the thing I keep coming back to with people in Portland who want to move better — most of us are too linear. Running becomes about the legs and the rest of the body is just along for the ride. There's no ability to navigate the stress of torque, to be twisted and anti-twist, or to create twist.

The fix isn't a drill. It's just — stop being in the way of your own body. Use all of you to run, not just your legs.

We do these running seminars locally for exactly this reason. Come run, get watched, feel where the pattern actually lives.

If you're a runner in Portland — what's the one thing you've been told to fix about your form? Drop it below.

#MoveBetter #Portland`

describe('computeEditDiff', () => {
  it('returns the empty/unchanged shape for identical text', () => {
    expect(computeEditDiff('same', 'same')).toEqual({
      changed: false, lengthDelta: 0, lengthDeltaPct: 0,
      removedPhrases: [], addedPhrases: [],
      hashtags: { removed: [], added: [] }, links: { removed: [], added: [] },
    })
  })

  it('returns the empty shape when either side is missing', () => {
    expect(computeEditDiff(null, 'x').changed).toBe(false)
    expect(computeEditDiff('x', undefined).changed).toBe(false)
    expect(computeEditDiff('', '').changed).toBe(false)
  })

  it('captures a whole-sentence trim + word-level phrase swap (real IG edit)', () => {
    const diff = computeEditDiff(IG_ORIGINAL, IG_EDITED)
    expect(diff.changed).toBe(true)
    expect(diff.lengthDelta).toBeLessThan(0) // net shorter
    // the dropped closing sentence should surface as a removed phrase
    expect(diff.removedPhrases.some((p) => p.includes('And sometimes, yeah'))).toBe(true)
    // "retract" -> "move" phrase swap should surface on both sides
    expect(diff.removedPhrases.some((p) => p.includes('retract'))).toBe(true)
    expect(diff.addedPhrases.some((p) => p.includes('move'))).toBe(true)
    // hashtags were untouched in this edit
    expect(diff.hashtags.removed).toEqual([])
    expect(diff.hashtags.added).toEqual([])
  })

  it('captures a removed CTA link with the rest of the caption untouched (real FB edit)', () => {
    const diff = computeEditDiff(FB_ORIGINAL, FB_EDITED)
    expect(diff.changed).toBe(true)
    expect(diff.links.removed).toEqual(['https://rosehaven.org/helping/financial-gifts/'])
    expect(diff.links.added).toEqual([])
    expect(diff.hashtags.removed).toEqual([])
  })

  it('detects hashtag adds/removes independent of body text', () => {
    const diff = computeEditDiff('Great tip today #old #shared', 'Great tip today #new #shared')
    expect(diff.hashtags.removed).toEqual(['#old'])
    expect(diff.hashtags.added).toEqual(['#new'])
  })

  it('ignores whitespace/punctuation-only diffs as noise', () => {
    const diff = computeEditDiff('Hello there friend', 'Hello there, friend')
    expect(diff.removedPhrases).toEqual([])
    expect(diff.addedPhrases).toEqual([])
  })
})

describe('summarizeEditDiff', () => {
  it('returns null when nothing changed', () => {
    expect(summarizeEditDiff({ changed: false })).toBeNull()
  })

  it('summarizes the real FB link-removal edit in one line', () => {
    const diff = computeEditDiff(FB_ORIGINAL, FB_EDITED)
    const summary = summarizeEditDiff(diff)
    expect(summary).toContain('1 link removed')
  })
})
