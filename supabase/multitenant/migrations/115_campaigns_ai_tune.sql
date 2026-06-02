-- Phase 7 outcome loop: AI tune state per campaign.
-- Stores the last AI-generated strategic recommendation for a campaign so the
-- Storyboard editor can surface it and the daily cron can refresh it.
-- No new grants needed — service_role already has full access on campaigns
-- from migration 045.

ALTER TABLE public.campaigns
  ADD COLUMN IF NOT EXISTS ai_tune_state jsonb,
  ADD COLUMN IF NOT EXISTS ai_tuned_at timestamptz;
