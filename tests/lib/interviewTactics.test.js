import { describe, it, expect } from 'vitest'
import {
  buildTacticLibraryBlock,
  buildStyleMemoryBlock,
  INTERVIEW_TACTICS,
  LEAD_TACTICS,
  isTacticId,
} from '../../src/lib/interviewTactics.js'

describe('interviewTactics', () => {
  it('the tactic library block lists every tactic', () => {
    const block = buildTacticLibraryBlock()
    expect(block).toContain('QUESTION TACTICS')
    for (const t of INTERVIEW_TACTICS) expect(block).toContain(t.label.toUpperCase())
  })

  it('splits lead vs core; mechanism_push is core, not a tracked lead tactic', () => {
    expect(LEAD_TACTICS.length).toBeGreaterThan(4)
    expect(LEAD_TACTICS.find((t) => t.id === 'mechanism_push')).toBeUndefined()
    expect(isTacticId('steelman')).toBe(true)
    expect(isTacticId('not_a_tactic')).toBe(false)
  })

  it('buildStyleMemoryBlock returns empty string without usable history', () => {
    expect(buildStyleMemoryBlock({})).toBe('')
    expect(buildStyleMemoryBlock({ styleMemory: null })).toBe('')
    expect(buildStyleMemoryBlock({ styleMemory: {} })).toBe('')
    expect(buildStyleMemoryBlock({ styleMemory: { sessions: [] } })).toBe('')
  })

  it('buildStyleMemoryBlock surfaces recent LEAD tactics + avoid instruction, ignores core moves', () => {
    const block = buildStyleMemoryBlock({
      staffName: 'Dr. Smith',
      styleMemory: {
        sessions: [{ tactics: ['steelman', 'whats_changed', 'mechanism_push'], angles: ['glute med inhibition'] }],
        registerCeiling: 'peer',
      },
    })
    expect(block).toContain('Dr. Smith')
    expect(block).toContain('DIFFERENT lead tactics')
    expect(block).toContain('Steelman')            // lead label surfaced
    expect(block).not.toContain('Mechanism-push')  // core move never tracked for anti-repeat
    expect(block).toContain('peer level')          // register ceiling nudge
    expect(block).toContain('glute med inhibition')
  })
})
