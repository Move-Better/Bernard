import { describe, it, expect } from 'vitest'
import { pickablePictured } from '../src/lib/activeStaff.js'

const list = [
  { id: 'a', name: 'Aj Adams' },
  { id: 'f1', name: 'E2E Smoke Staff' },
  { id: 'f2', name: 'E2E Smoke Clinician' },
  { id: 'f3', name: 'e2e' },
  { id: 'x', name: 'Left Person', deactivated_at: '2026-01-01' },
]

describe('pickablePictured', () => {
  it('hides e2e fixtures and deactivated people', () => {
    expect(pickablePictured(list).map((s) => s.id)).toEqual(['a'])
  })
  it('keeps an already-selected fixture or departed person visible', () => {
    expect(pickablePictured(list, ['f1', 'x']).map((s) => s.id)).toEqual(['a', 'f1', 'x'])
  })
  it('does not hide names that merely contain e2e', () => {
    expect(pickablePictured([{ id: 'b', name: 'Bree Kee2ex' }]).length).toBe(1)
  })
})
