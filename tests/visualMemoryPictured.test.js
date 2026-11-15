import { describe, it, expect } from 'vitest'
import { composeEmbeddingText } from '../api/_lib/visualMemoryIndex.js'

describe('composeEmbeddingText', () => {
  it('names everyone pictured on a photo', () => {
    const t = composeEmbeddingText({ kind: 'photo', filename: 'a.jpg', pictured_staff_ids: ['1', '2'] }, 'Aj Adams, Tyler Hoang')
    expect(t).toContain('pictured: Aj Adams, Tyler Hoang')
    expect(t).not.toContain('captured by')
  })
  it('keeps "captured by" for video and for photos with nobody pictured', () => {
    expect(composeEmbeddingText({ kind: 'video', filename: 'v.mp4' }, 'Dr. Q')).toContain('captured by Dr. Q')
    expect(composeEmbeddingText({ kind: 'photo', filename: 'a.jpg', pictured_staff_ids: [] }, 'Dr. Q')).toContain('captured by Dr. Q')
  })
})
