-- Global (non-tenant-scoped) app config — a single source for values that must
-- be editable WITHOUT a redeploy. Intentionally NOT workspace-scoped: these are
-- platform-wide defaults shared by every tenant.
--
-- First use: `cadence_defaults` — the cold-start posting-cadence prior
-- (posts/week per atom platform). When a workspace is on Auto, the Strategist
-- computes its per-channel cadence from enabled_outputs × this prior, so adding
-- a channel to enabled_outputs gives it a sensible cadence with no code change.
-- Editing a number here re-tunes the cold-start default for every tenant
-- instantly. Phase 2 (adaptive feedback loop) will auto-recompute per-tenant
-- cadence from engagement_snapshots; this row remains the zero-history fallback,
-- and can later itself be recomputed from fleet-wide aggregates.
-- See .claude/adaptive-cadence-spec.md.

CREATE TABLE IF NOT EXISTS public.app_config (
  key        text PRIMARY KEY,
  value      jsonb NOT NULL DEFAULT '{}'::jsonb,
  updated_at timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.app_config TO service_role;

-- Best-practice posting frequency per atom platform (organic, local/clinic
-- accounts, 2025-26 consensus). instagram = feed+reels (one capacity bucket in
-- the atom plan); instagram_story is its own bucket.
INSERT INTO public.app_config (key, value) VALUES
  ('cadence_defaults', '{
    "instagram": 4,
    "instagram_story": 5,
    "linkedin": 3,
    "facebook": 3,
    "gbp": 2,
    "tiktok": 3,
    "twitter": 4,
    "threads": 4,
    "bluesky": 3,
    "mastodon": 3
  }'::jsonb)
ON CONFLICT (key) DO NOTHING;
