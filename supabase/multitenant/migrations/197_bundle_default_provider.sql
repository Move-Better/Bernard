-- 197_bundle_default_provider.sql — bundle.social becomes the only provider a
-- new tenant is given.
--
-- Migration 133 defaulted publish_provider to 'buffer', which was right at the
-- time. It is now a live defect: a tenant onboards, gets 'buffer', has no
-- Buffer credentials AND no bundle_team_id, and cannot publish at all until
-- someone flips them by hand.
--
-- The evidence for consolidating (prod, 2026-07-30): NO workspace has ever
-- meaningfully published through Buffer. The rows that look like it are
-- imported history — movebetter-animals' newest "published" post is dated
-- 2021-03-26 and carries no buffer_update_id. The single live tenant
-- (movebetter, 50 posts, publishing today) is on bundle.
--
-- Two paths that must be hand-kept in lockstep have already produced real
-- incidents: the GBP 1500-char clamp existed only on the Buffer path (opaque
-- 502s on the live tenant), and ~12 UI strings said "Buffer" to a workspace
-- publishing via bundle. The 2026-07-30 format work (mixed carousels, explicit
-- Reel/Story) is structurally bundle-only, so keeping Buffer would ship a
-- two-tier product where some tenants silently lack it.
--
-- The six dormant 'buffer' workspaces are migrated here. This does not change
-- what they can do: with no Buffer credentials they already got a 503 from the
-- Buffer path, and with no bundle_team_id they get a 503 from the bundle path.
-- Same outcome, one fewer code path, and a clearer error.
--
-- The CHECK still permits 'buffer' so the column can be read and rolled back
-- during the code retirement; it is tightened once that lands.

ALTER TABLE public.workspaces ALTER COLUMN publish_provider SET DEFAULT 'bundle';

UPDATE public.workspaces
   SET publish_provider = 'bundle'
 WHERE publish_provider = 'buffer';

COMMENT ON COLUMN public.workspaces.publish_provider IS
  'Outbound social provider. bundle.social is the only supported value for new tenants (migration 197); buffer remains in the CHECK only until the Buffer code path is deleted.';
