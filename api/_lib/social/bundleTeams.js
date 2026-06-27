// Shared bundle.social Team provisioning — the ensure-team + self-heal-on-404 +
// persist logic used by BOTH the brand connect (workspaces.bundle_team_id, for
// Instagram/Facebook) and the per-location connect (workspace_locations.
// bundle_team_id, for that location's Google Business listing).
//
// bundle allows one active GBP per Team, so a multi-location clinic needs one
// Team per location (Option B, see memory/project-bundle-social.md). This module
// centralizes the create-on-first-use + recreate-if-deleted discipline so both
// connect paths stay identical and self-healing (a tenant can delete a Team
// out-of-band in the bundle dashboard, leaving a stored id pointing at a 404).
//
// teamId is an AUTHORIZATION boundary: every id created here is persisted on the
// row resolved via workspaceContext / a workspace-scoped location query — never
// from client input. Callers pass an already-validated workspace + location row.
import { invalidateWorkspaceCacheById } from '../workspaceContext.js'

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

// A deleted / unknown bundle Team surfaces as a 404 "No team found" from the SDK
// (teams can be deleted out-of-band in the bundle dashboard). Shared so the
// connect endpoints detect the same recreate trigger.
export function isMissingTeam(e) {
  const status = e?.status ?? e?.statusCode ?? e?.body?.statusCode
  let blob = e?.message || ''
  try { blob += ' ' + JSON.stringify(e?.body) } catch { /* non-serializable */ }
  return status === 404 || /no team found/i.test(blob)
}

async function patchRow(table, id, body) {
  if (!SUPABASE_URL || !SUPABASE_KEY) return false
  const r = await fetch(`${SUPABASE_URL}/rest/v1/${table}?id=eq.${encodeURIComponent(id)}`, {
    signal: AbortSignal.timeout(10_000),
    method: 'PATCH',
    headers: {
      apikey: SUPABASE_KEY,
      Authorization: `Bearer ${SUPABASE_KEY}`,
      'Content-Type': 'application/json',
      Prefer: 'return=minimal',
    },
    body: JSON.stringify(body),
  })
  return r.ok
}

/**
 * Ensure the workspace has a live bundle brand Team (Instagram/Facebook). Creates
 * + persists on workspaces.bundle_team_id on first use, and mutates
 * workspace.bundle_team_id so a subsequent publisher.connect() resolves it.
 * @param {Object} workspace Resolved workspaces row.
 * @param {import('./bundlePublisher.js').BundlePublisher} publisher Any bundle publisher (createTeam ignores teamId).
 * @returns {Promise<string>} the bundle Team id.
 */
export async function ensureWorkspaceTeam(workspace, publisher) {
  const { teamId } = await publisher.createTeam({ name: workspace.display_name || workspace.slug })
  if (!teamId) throw Object.assign(new Error('team-create-failed'), { code: 'team-create-failed', status: 502 })
  if (!(await patchRow('workspaces', workspace.id, { bundle_team_id: teamId }))) {
    throw Object.assign(new Error('team-persist-failed'), { code: 'team-persist-failed', status: 500 })
  }
  workspace.bundle_team_id = teamId
  invalidateWorkspaceCacheById(workspace.id)
  return teamId
}

/**
 * Ensure a single location has its own live bundle Team (its Google Business
 * listing). Creates + persists on workspace_locations.bundle_team_id, and
 * mutates location.bundle_team_id so a subsequent location-scoped
 * publisher.connect() resolves it.
 * @param {Object} workspace Resolved workspaces row (for the team name).
 * @param {Object} location  workspace_locations row already validated to belong to the workspace.
 * @param {import('./bundlePublisher.js').BundlePublisher} publisher Any bundle publisher.
 * @returns {Promise<string>} the bundle Team id.
 */
export async function ensureLocationTeam(workspace, location, publisher) {
  const brand = workspace.display_name || workspace.slug || 'Bernard'
  const { teamId } = await publisher.createTeam({ name: `${brand} — ${location.label}` })
  if (!teamId) throw Object.assign(new Error('team-create-failed'), { code: 'team-create-failed', status: 502 })
  if (!(await patchRow('workspace_locations', location.id, { bundle_team_id: teamId }))) {
    throw Object.assign(new Error('team-persist-failed'), { code: 'team-persist-failed', status: 500 })
  }
  location.bundle_team_id = teamId
  return teamId
}
