-- Migration 193: correct the engagement_digest_recipients column comment.
--
-- Comment-only. No schema change, no data change, no GRANT needed.
--
-- Migration 094 documented the fallback as "auto-derive from clinicians where
-- permission_tier='producer'". The digest now derives from owner AND producer
-- tiers, matching resolveRecipients() in approval-escalation.js — the two crons
-- mail the same people about the same queue and had silently drifted apart, so
-- an owner received the daily nudge but never the weekly summary.
--
-- Worth a migration rather than leaving it: a stale COMMENT is a fiction stored
-- in the database itself, which is exactly the class of thing that made 094's
-- own columns look real for two months while they had never been applied.

COMMENT ON COLUMN public.workspaces.engagement_digest_recipients IS
  'Clerk user IDs to email. Empty = auto-derive from staff where permission_tier in (owner, producer) — same set as approval-escalation.';
