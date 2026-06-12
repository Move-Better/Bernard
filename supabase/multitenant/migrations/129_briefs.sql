-- Briefs: workspace-level written messages that generate channel-adapted content
-- without an interview. Used for event announcements, promotions, updates, etc.
-- content_items.brief_id links generated pieces back to their source brief.

CREATE TABLE public.briefs (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id     uuid        NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  title            text        NOT NULL,              -- internal label, not published
  body             text        NOT NULL,              -- the raw message the user wrote
  event_at         timestamptz,                       -- optional structured event date/time
  location         text,                              -- optional venue/address
  cta_url          text,                              -- optional CTA link (→ IG Story link sticker, FB link, etc.)
  cta_label        text,                              -- optional CTA button label
  media_url        text,                              -- optional single attached media (blob URL)
  selected_outputs text[]      NOT NULL DEFAULT '{}', -- OUTPUT_CHANNELS ids chosen at brief time
  status           text        NOT NULL DEFAULT 'done'
                               CHECK (status IN ('generating', 'done')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);

GRANT SELECT, INSERT, UPDATE, DELETE ON public.briefs TO service_role;

-- Link generated content pieces back to their source brief.
-- Nullable: existing interview-sourced rows stay null.
ALTER TABLE public.content_items
  ADD COLUMN IF NOT EXISTS brief_id uuid REFERENCES public.briefs(id) ON DELETE SET NULL;
