// Resolves the best Brand Kit logo asset for a given render surface.
//
// Editorial cards composite the logo over a dark scrim footer, so
// `logo_on_dark` (the reversed/white variant) is the right default — it falls
// back through `mark_only` → `logo_on_light` → `primary_logo` so a workspace
// that only assigned one logo role still gets *something* rather than a
// silently-missing mark.

const SUPABASE_URL = process.env.SUPABASE_URL
const SUPABASE_KEY = process.env.SUPABASE_SERVICE_KEY

function sb(path) {
  return fetch(`${SUPABASE_URL}/rest/v1/${path}`, {
    headers: { apikey: SUPABASE_KEY, Authorization: `Bearer ${SUPABASE_KEY}` },
  })
}

const DARK_SURFACE_ROLE_PREFERENCE = ['logo_on_dark', 'mark_only', 'logo_on_light', 'primary_logo']

/**
 * @param {string} workspaceId
 * @returns {Promise<string|null>} blob_url of the best-fit logo, or null if
 *   the workspace has no logo role assigned at all.
 */
export async function resolveWorkspaceLogoForDarkSurface(workspaceId) {
  try {
    const roleList = DARK_SURFACE_ROLE_PREFERENCE.map((r) => `"${r}"`).join(',')
    const res = await sb(
      `brand_kit_roles?workspace_id=eq.${encodeURIComponent(workspaceId)}&role=in.(${roleList})&select=role,brand_assets(blob_url)`,
    )
    if (!res.ok) return null
    const rows = await res.json().catch(() => [])
    for (const role of DARK_SURFACE_ROLE_PREFERENCE) {
      const hit = rows.find((r) => r.role === role)?.brand_assets?.blob_url
      if (hit) return hit
    }
    return null
  } catch (e) {
    console.error('[workspaceLogo] resolve failed:', e?.message)
    return null
  }
}
