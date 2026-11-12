import { describe, it, expect } from 'vitest'
import { postTitle, postStoryLine, normalCase, captionOpening } from '../../src/lib/postTitle.js'

// Real Move Better posts from the signed-off mockup (2026-11-11). Each row is
// the exact title Q approved; changing one is a design decision.
const cover = (text) => [{ blocks: [{ role: 'hook', text }] }, { blocks: [{ role: 'body', text: 'second slide' }] }]

describe('postTitle', () => {
  it('a blog uses its article heading, not the story name', () => {
    const p = {
      platform: 'blog',
      topic: 'The Repetition Problem: Why One Motion Didn\'t Hurt You, But a Thousand Did',
      content: '# Repetitive Pain: Why One Motion Didn\'t Hurt You, But a Thousand Did\n\nThe first thing…',
    }
    expect(postTitle(p)).toBe('Repetitive Pain: Why One Motion Didn\'t Hurt You, But a Thousand Did')
    expect(postStoryLine(p)).toBe('From story: The Repetition Problem: Why One Motion Didn\'t Hurt You, But a Thousand Did')
  })

  it('a long blog heading is not cut', () => {
    const h = 'When to Stop Training If You\'re Injured: Red Flags, Yellow Flags, and Ramping Back In'
    expect(postTitle({ platform: 'blog', topic: 'x', content: `# ${h}\n\nbody` })).toBe(h)
  })

  it('a post with slides uses its cover, in normal case', () => {
    expect(postTitle({ platform: 'instagram', topic: 'Low back pain', slides: cover('ONE INCH OFF THE GROUND'), content: 'Your back doesn\'t have a strength problem.' }))
      .toBe('One inch off the ground')
    expect(postTitle({ platform: 'instagram', topic: 'Sciatica', slides: cover('TIGHT GLUTES AREN\'T THE PROBLEM') }))
      .toBe('Tight glutes aren\'t the problem')
    expect(postTitle({ platform: 'instagram', topic: 'x', slides: cover('SCARED TO WALK INTO A GYM?') }))
      .toBe('Scared to walk into a gym?')
  })

  it('any other post uses the caption opening', () => {
    expect(postTitle({ platform: 'facebook', topic: 'Disc herniation', content: 'Most disc herniations aren\'t caused by one bad lift. They\'re caused by the lumbar spine…' }))
      .toBe('Most disc herniations aren\'t caused by one bad lift.')
    expect(postTitle({ platform: 'gbp', topic: 'An Hour Can Change Your Life', content: '"The bar should be higher than manageable." That\'s where our team starts, every time.' }))
      .toBe('"The bar should be higher than manageable."')
  })

  it('a first sentence under five words takes the next one too', () => {
    expect(postTitle({ platform: 'gbp', topic: 'An Hour Can Change Your Life', content: 'Not a waiting list. Not another scan. An actual hour of assessment.' }))
      .toBe('Not a waiting list. Not another scan.')
  })

  it('cuts a long opening at 80 characters on a word boundary', () => {
    const t = postTitle({ platform: 'linkedin', topic: 'Running Seminar', content: 'If your hip extension isn\'t loading your psoas, your running stride is missing its spring.\n\nThis reach…' })
    expect(t).toBe('If your hip extension isn\'t loading your psoas, your running stride is missing…')
    expect(t.length).toBeLessThanOrEqual(80)
  })

  it('falls back to the story name, and then hides the story line', () => {
    const p = { platform: 'instagram', topic: 'Knee pain', content: '', slides: [] }
    expect(postTitle(p)).toBe('Knee pain')
    expect(postStoryLine(p)).toBeNull()
    expect(postTitle(null)).toBe('Untitled draft')
  })
})

describe('normalCase', () => {
  it('keeps known capital terms and I', () => {
    expect(normalCase('YOUR ACL IS FINE')).toBe('Your ACL is fine')
    expect(normalCase('I\'M NOT STRETCHING')).toBe('I\'m not stretching')
  })
  it('starts a new sentence after a question mark, full stop or exclamation', () => {
    // The real published post that showed this bug (2026-11-11).
    expect(normalCase('TIGHT UPPER TRAPS? CHECK THE BREATHING')).toBe('Tight upper traps? Check the breathing')
    expect(normalCase('STOP. BREATHE! THEN LIFT')).toBe('Stop. Breathe! Then lift')
  })
  it('leaves text that already has lowercase alone', () => {
    expect(normalCase('Even your provider has been there.')).toBe('Even your provider has been there.')
  })
})

describe('captionOpening', () => {
  it('reads only the first paragraph', () => {
    expect(captionOpening('We literally did nothing with the neck, and the neck pain was nearly gone.\n\nMore.'))
      .toBe('We literally did nothing with the neck, and the neck pain was nearly gone.')
  })
})
