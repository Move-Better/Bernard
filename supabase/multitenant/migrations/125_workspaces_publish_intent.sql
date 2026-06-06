-- Onboarding "How do you publish today?" step (new wizard step before Pick
-- Channels). Captures the tenant's existing publishing tools so we can tailor
-- which integration connect-options are surfaced (hide WordPress for an Astro
-- shop, hide Buffer for a paste-it-myself user) and annotate the channel picker
-- with one-click-ready badges.
--
-- Decoupling is preserved: this NEVER gates a channel (every channel always
-- exports). It only filters *integration* connect cards and drives badges. The
-- one exception is an explicit "no newsletter" answer, which hides the email
-- channel tile in the picker.
--
-- Shape (validated by sanitizePublishIntent in src/lib/outputChannels.js):
--   { "website": "wordpress" | "astro" | "none",
--     "social":  "buffer" | "manual",
--     "newsletter": "beehiiv" | "other" | "skip",
--     "analytics": boolean }      -- analytics is an optional GA4 nudge
--
-- Empty {} = "no intent captured" → all integrations shown (back-compat for
-- every workspace that onboarded before this step existed).

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS publish_intent jsonb NOT NULL DEFAULT '{}'::jsonb;

-- No new GRANT needed: service_role already holds table-level privileges on
-- public.workspaces (a column add inherits them). The REST API reads this via
-- the existing select=* on the workspaces row.
