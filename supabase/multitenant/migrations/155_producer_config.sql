-- 155 — workspaces.producer_config: the Standing Producer's per-workspace switch.
--
-- Phase 0 (see .claude/standing-producer-sprint.md). Off by default for every
-- workspace: an empty object means "Bernard hasn't been hired here", so the
-- member card, the /producer nav entry, the feed, and (later) every autonomous
-- action stay dark until an owner flips `enabled`.
--
-- Shape (all optional; defaults applied in code):
--   { "enabled": bool,            -- master switch (default false)
--     "enabled_at": timestamptz,  -- when hired
--     "paused_at": timestamptz,   -- pause without un-hiring (Phase 4)
--     "daily_ai_call_cap": int,   -- spend guardrail (Phase 1+; default 40)
--     "max_items_per_tick": int } -- work-per-tick guardrail (Phase 1+; default 3)
--
-- No CHECK/typing on the JSONB — the shape grows across phases and every reader
-- treats missing keys as their default.

ALTER TABLE public.workspaces
  ADD COLUMN IF NOT EXISTS producer_config jsonb NOT NULL DEFAULT '{}'::jsonb;
