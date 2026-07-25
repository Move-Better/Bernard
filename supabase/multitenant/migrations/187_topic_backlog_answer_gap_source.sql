-- 187 — allow topic_backlog rows sourced from a published-over-flag answer.
--
-- When a clinician publishes an answer over a "not in the source material"
-- faithfulness flag, that passage is by definition teaching Bernard has NOT
-- captured yet — the judge can't tell "the AI invented this" from "the doctor
-- just taught something new", and after a human edit it is nearly always the
-- latter. Rather than discard that signal, we queue it as an interview topic so
-- the practice-memory corpus catches up and future drafts stop re-flagging it.
--
-- 'answer_gap' is a distinct source (not folded into 'ai_suggested') so the
-- flywheel is measurable: how often does the clinician out-teach the corpus, and
-- do those topics actually get interviewed?

ALTER TABLE public.topic_backlog DROP CONSTRAINT IF EXISTS topic_backlog_source_check;
ALTER TABLE public.topic_backlog ADD CONSTRAINT topic_backlog_source_check
  CHECK (source = ANY (ARRAY['manual'::text, 'ai_suggested'::text, 'vigil_signal'::text, 'answer_gap'::text]));

-- Existing table, but grants are restated per the self-sufficient-migration rule.
GRANT SELECT, INSERT, UPDATE, DELETE ON public.topic_backlog TO service_role;
