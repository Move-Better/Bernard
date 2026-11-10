import { describe, it, expect } from 'vitest'
import { channelName } from '../../src/pages/ProducerHome.jsx'

// The channel-health tiles printed the raw platform key, so Google Business
// read "Gbp" on Home and nowhere else (simplicity audit 2026-11-09).
describe('channel tile names', () => {
  it('uses the shared platform names', () => {
    expect(channelName('gbp')).toBe('Google Business')
    expect(channelName('linkedin')).toBe('LinkedIn')
    expect(channelName('instagram')).toBe('Instagram')
  })
  it('calls the blog channel "Blog", not "Blog Post"', () => {
    expect(channelName('blog')).toBe('Blog')
  })
  it('falls back to the key for an unknown platform', () => {
    expect(channelName('newthing')).toBe('newthing')
  })
})
