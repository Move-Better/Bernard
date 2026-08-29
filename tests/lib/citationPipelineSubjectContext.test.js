import { describe, it, expect } from 'vitest'
import { runCitationEnrichment } from '../../api/_lib/citations/pipeline.js'
import { judgeCandidate } from '../../api/_lib/citations/verify.js'
import { buildVerifyPrompt } from '../../api/_lib/citations/verifyRubric.js'
import { buildClaimExtractionPrompt } from '../../api/_lib/citations/claimExtraction.js'

// ─────────────────────────────────────────────────────────────────────────────
// Bernard runs ONE citation pipeline across human (movebetter), equine
// (movebetter-equine), and small-animal (movebetter-animals) workspaces. This
// suite proves the SECOND axis of "does this source genuinely support this
// claim" — not fabrication (a source that's real but unrelated), but SUBJECT
// mismatch (a source that's real and topically adjacent but about a different
// population: a human study cited for a horse claim, an equine study cited
// for a dog claim, etc). Before this, neither the claim extractor nor the
// verify judge had any concept of which population a claim was written for.
//
// Same discipline as citationPipelineAntiFabrication.test.js: every guard
// here is checked against what would happen WITHOUT it (a judge/prompt that
// doesn't carry subjectContext at all), so a regression that silently drops
// the wiring shows up as a red test, not a green one that never tested
// anything.
// ─────────────────────────────────────────────────────────────────────────────

const okContent = () => ({ content: 'x'.repeat(200), title: 'Real Title', fetchOk: true })

function oneClaimExtractor(claimText = 'spinal mobility affects coordinated movement') {
  return async () => [{ claim_text: claimText, quote: 'some quote' }]
}

describe('runCitationEnrichment — subjectContext threading (backward compatibility)', () => {
  it('defaults subjectContext to "" when the caller omits it entirely — every existing caller keeps working unchanged', async () => {
    let extractArgs = null
    let judgeArgs = null
    await runCitationEnrichment({
      draftBody: 'a blog post',
      // subjectContext deliberately omitted
      extractClaimsFn: async (body, subjectContext) => { extractArgs = { body, subjectContext }; return oneClaimExtractor()() },
      retrieveFns: [async () => [{ source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'x', abstract: 'real content long enough to pass the length check' }]],
      fetchContentFn: okContent,
      judgeFn: async (args) => { judgeArgs = args; return { support: true, confidence: 0.9, why: 'x' } },
    })
    expect(extractArgs.subjectContext).toBe('')
    expect(judgeArgs.subjectContext).toBe('')
  })

  it('threads an explicit subjectContext into BOTH extractClaimsFn and judgeFn for every candidate considered', async () => {
    const SUBJECT = 'Move Better Animals: AVCA-certified animal chiropractic practice treating dogs, cats, and small animals.'
    let extractArgs = null
    const judgeCalls = []
    await runCitationEnrichment({
      draftBody: 'a blog post',
      subjectContext: SUBJECT,
      extractClaimsFn: async (body, subjectContext) => { extractArgs = { body, subjectContext }; return oneClaimExtractor()() },
      retrieveFns: [async () => [
        { source: 'pubmed', url: 'https://pubmed.ncbi.nlm.nih.gov/1/', title: 'x', abstract: 'real content long enough to pass the length check' },
        { source: 'web', url: 'https://www.mayoclinic.org/x', title: 'y' },
      ]],
      fetchContentFn: okContent,
      judgeFn: async (args) => { judgeCalls.push(args); return { support: true, confidence: 0.9, why: 'x' } },
    })
    expect(extractArgs.subjectContext).toBe(SUBJECT)
    expect(judgeCalls.length).toBeGreaterThan(0)
    for (const call of judgeCalls) {
      expect(call.subjectContext).toBe(SUBJECT)
    }
  })
})

describe('runCitationEnrichment + REAL judgeCandidate/buildVerifyPrompt — the actual prompt the model would see', () => {
  // This is the strongest proof available without a live model call: run the
  // REAL pipeline.js orchestration through the REAL verify.js judgeCandidate
  // and the REAL verifyRubric.js buildVerifyPrompt (only the network-calling
  // generateText is faked), and inspect the literal `instructions` string
  // that would be sent to Sonnet. If this text doesn't carry both the
  // workspace's real subject AND the hard-rejection rule, no live model could
  // ever apply it — so this is the necessary (not sufficient, since model
  // compliance still needs a live check) condition for the fix to work.
  it('a candidate for an animal-workspace claim is judged with a prompt that names the real clinic_context AND states the hard cross-species rejection rule', async () => {
    const SUBJECT = 'Move Better Animals: AVCA-certified animal chiropractic practice treating dogs, cats, and small animals.'
    let capturedInstructions = null
    const fakeGenerate = async ({ instructions }) => {
      capturedInstructions = instructions
      // Simulate a judge that WOULD rubber-stamp on topic-similarity alone —
      // this doesn't prove the real model rejects it (that needs a live call),
      // but proves the instructions it's given contain the rule that would
      // make rejection correct if followed.
      return { text: '{"support": true, "confidence": 0.8, "why": "mechanism sounds similar"}' }
    }

    await runCitationEnrichment({
      draftBody: 'Spinal mobility affects coordinated movement.',
      subjectContext: SUBJECT,
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{
        source: 'pubmed',
        url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
        title: 'Spinal mobility and gait coordination in human adults',
        abstract: 'This study examined spinal mobility and coordinated movement in a cohort of 40 human adults with chronic low back pain.',
      }]],
      fetchContentFn: okContent,
      judgeFn: (args) => judgeCandidate(args, { generateTextFn: fakeGenerate }),
    })

    expect(capturedInstructions).not.toBeNull()
    expect(capturedInstructions).toContain(SUBJECT)
    expect(capturedInstructions).toMatch(/HARD rule/i)
    expect(capturedInstructions).toMatch(/different population/i)
    expect(capturedInstructions).toMatch(/human clinical study cited to support a claim written for horses/i)
  })

  it('the identical wiring with NO subjectContext produces a prompt with none of the species-mismatch language — proves the block is conditional, not always-on boilerplate', async () => {
    let capturedInstructions = null
    const fakeGenerate = async ({ instructions }) => {
      capturedInstructions = instructions
      return { text: '{"support": true, "confidence": 0.8, "why": "x"}' }
    }

    await runCitationEnrichment({
      draftBody: 'Spinal mobility affects coordinated movement.',
      // subjectContext omitted — the movebetter (human) workspace has no
      // clinic_context language that would produce one today, so this is the
      // real default path.
      extractClaimsFn: oneClaimExtractor(),
      retrieveFns: [async () => [{
        source: 'pubmed',
        url: 'https://pubmed.ncbi.nlm.nih.gov/1/',
        title: 'A real paper',
        abstract: 'This study examined spinal mobility and coordinated movement in a cohort of 40 human adults with chronic low back pain.',
      }]],
      fetchContentFn: okContent,
      judgeFn: (args) => judgeCandidate(args, { generateTextFn: fakeGenerate }),
    })

    expect(capturedInstructions).not.toBeNull()
    expect(capturedInstructions).not.toMatch(/SUBJECT OF THIS CONTENT/)
    expect(capturedInstructions).not.toMatch(/HARD rule/i)
  })
})

describe('buildVerifyPrompt — the hard cross-species/population rejection rule (unit-level, exact text)', () => {
  it('adds no subject/species language at all when subjectContext is absent — byte-for-byte backward compatible', () => {
    const before = buildVerifyPrompt({ claimText: 'x', candidateTitle: 'y', candidateContent: 'z', sourceType: null })
    expect(before.instructions).not.toMatch(/SUBJECT OF THIS CONTENT/)
    expect(before.instructions).not.toMatch(/HARD rule/i)
  })

  it('states the rule as a HARD rule, not a soft suggestion, and names the specific cross-population examples the spec is protecting against', () => {
    const { instructions } = buildVerifyPrompt({
      claimText: 'x',
      candidateTitle: 'y',
      candidateContent: 'z',
      sourceType: null,
      subjectContext: 'Move Better Equine: A mobile equine chiropractic practice.',
    })
    expect(instructions).toContain('Move Better Equine: A mobile equine chiropractic practice.')
    expect(instructions).toMatch(/HARD rule, not a judgment call/i)
    expect(instructions).toMatch(/rule support:false/)
    expect(instructions).toMatch(/human clinical study cited to support a claim written for horses/i)
    expect(instructions).toMatch(/equine study cited to support a claim about human patients or about dogs\/cats/i)
    expect(instructions).toMatch(/small-animal \(dog\/cat\) study cited to support an equine claim/i)
  })

  it('the rule survives alongside the existing reputable_health_ed skepticism block — both conditional blocks coexist', () => {
    const { instructions } = buildVerifyPrompt({
      claimText: 'x',
      candidateTitle: 'y',
      candidateContent: 'z',
      sourceType: 'reputable_health_ed',
      subjectContext: 'a horse practice',
    })
    expect(instructions).toMatch(/health-education/i)
    expect(instructions).toMatch(/HARD rule/i)
  })
})

describe('buildClaimExtractionPrompt — subject-aware claim phrasing (unit-level)', () => {
  it('adds no subject language when subjectContext is absent — byte-for-byte backward compatible', () => {
    const { instructions } = buildClaimExtractionPrompt('Some blog post about disc herniation.')
    expect(instructions).not.toMatch(/SUBJECT OF THIS CONTENT/)
  })

  it('instructs the model to make the species/population explicit in claim_text when subjectContext is present', () => {
    const { instructions } = buildClaimExtractionPrompt(
      'A blog post about spinal mobility, written for a horse-owner audience but not explicitly saying "horse" in every sentence.',
      'Move Better Equine: A mobile equine chiropractic practice.',
    )
    expect(instructions).toContain('Move Better Equine: A mobile equine chiropractic practice.')
    expect(instructions).toMatch(/in horses/i)
    expect(instructions).toMatch(/even if the sentence it's drawn from doesn't spell it out/i)
  })
})
