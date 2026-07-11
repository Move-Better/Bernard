// Ground truth for the "link in bio" article claim in atomPrompts.js — is
// THIS interview's blog piece actually live? A caption promising "full
// article at the link in bio" is only true when a published, resolved-URL
// blog content_item exists for the same interview_id.
//
// `sb` is the caller's own Supabase REST fetch wrapper (workspace_id scoping
// is the caller's responsibility, same as every other lib in this file).
export async function hasPublishedBlogArticle(sb, workspaceId, interviewId) {
  if (!workspaceId || !interviewId) return false
  const r = await sb(
    `content_items?workspace_id=eq.${workspaceId}&interview_id=eq.${interviewId}` +
    `&platform=eq.blog&status=eq.published&resolved_url=not.is.null&select=id&limit=1`,
  )
  if (!r.ok) return false
  const rows = await r.json().catch(() => [])
  return Array.isArray(rows) && rows.length > 0
}
