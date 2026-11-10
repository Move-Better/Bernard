import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// The tier read in /api/workspace/me decides which screen every person gets.
// A single column in its select that does not exist in prod makes PostgREST
// reject the whole read; the handler treats that as "no row", so every user's
// tier becomes null and on an internal plan everyone lands on the owner's
// screen. Nothing errors. That was live from 2026-05-29 to 2026-11-09 because
// the select asked for producer_onboarded_at, which was never created.

const read = (rel) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8')
const ME = read('../../api/_routes/workspace/me.js')
const SCHEMA = JSON.parse(read('../../supabase/expected-schema.json'))

function tierSelectColumns(src) {
  const m = src.match(/export const TIER_ROW_SELECT = '([^']+)'/)
  return m ? m[1].split(',').map((c) => c.trim()).filter(Boolean) : []
}

function staffColumns(schema) {
  const t = schema.staff
  if (Array.isArray(t)) return t
  return t && typeof t === 'object' ? Object.keys(t) : []
}

describe('/api/workspace/me tier read', () => {
  it('selects only columns that exist on staff in the schema snapshot', () => {
    const cols = tierSelectColumns(ME)
    // Non-vacuity: the two columns the screen choice depends on are there.
    expect(cols).toContain('permission_tier')
    expect(cols).toContain('capability_overrides')
    const known = new Set(staffColumns(SCHEMA))
    expect(known.size).toBeGreaterThan(10)
    const missing = cols.filter((c) => !known.has(c))
    expect(missing, `staff columns missing from prod schema: ${missing.join(', ')}`).toEqual([])
  })

  it('the staff query actually uses TIER_ROW_SELECT', () => {
    expect(ME).toMatch(/&select=\$\{TIER_ROW_SELECT\}&limit=1/)
    expect(ME).not.toMatch(/producer_onboarded_at,capability_overrides/)
  })
})
