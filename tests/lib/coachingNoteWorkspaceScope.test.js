import { describe, it, expect } from 'vitest'
import { readFileSync } from 'node:fs'
import { fileURLToPath } from 'node:url'

// GUARD — the weekly coaching-note generator was the one workspace-fanout
// job in the codebase missing `status=eq.active` on its `workspaces?...`
// query (every sibling cron in api/_routes/cron/*.js scopes by active
// status; this one iterated every workspace ever created). Left unfixed,
// a trial-expired/cancelled/never-activated workspace gets a real, billed
// AI generation call every week and an upsert into workspace_coaching_notes
// that api/_routes/producer/coaching-note.js — which filters only by
// workspace_id, not status — will happily serve to anyone who can still
// reach that workspace's ProducerHome. No error, no signal; found by audit.
const SRC = readFileSync(
  fileURLToPath(new URL('../../api/_lib/producer/coachingNoteGenerator.js', import.meta.url)),
  'utf8',
)

describe('coachingNoteGenerator only fans out over active workspaces', () => {
  it('the workspaces() query is scoped to status=eq.active', () => {
    const match = SRC.match(/await sb\(`workspaces\?([^`]*)`\)/)
    expect(match).not.toBeNull()
    expect(match[1]).toMatch(/status=eq\.active/)
  })
})
