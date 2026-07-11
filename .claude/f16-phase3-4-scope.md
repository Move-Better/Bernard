# F16 Phase 3 + 4 — scope (Q sign-off 2026-07-11)

## Design decisions (AskUserQuestion, all Recommended)
- **P3 stale-answer behavior:** confirmed supersession → Bernard auto re-drafts the affected published answer in the clinician's now-updated voice, re-runs the voice-fidelity hard gate, drops the fresh draft into their Answer Review queue as `needs_review`. NOTHING re-publishes until they approve. The live .md stays up untouched during re-review.
- **P3 retract:** clinician action only. Sweep surfaces the answer with a **Retract from site** button alongside Approve/Edit/Revise. Bernard never auto-retracts. Retract removes the live .md via a new `kind:'answer-retract'` path in the movebetter.co receiver.
- **P3 sweep matching:** semantic — embed the superseding (new) chunk, match the clinician's published answers by cosine ≥ threshold (reuse pgvector). Only genuinely-related answers get swept.
- **P4 provider:** SerpApi (key already in Vercel prod Preview+Prod). Wire Google AI Overviews as the 3rd engine in citationProbe; promote **citation share** to the hero KPI on /seo (dying-clicks demoted). Feed citation gaps into interview coverage goals.

## Phase 3 build plan (PR 1)
1. **Migration 171** — `answers` gains: `review_reason text` ('superseded'), `superseded_by uuid` (the practice_memory_supersessions.id), `superseded_at timestamptz`. Status enum gains `'retracted'`. GRANT service_role (table already granted; ALTER only).
2. **Sweep** — new `api/_lib/sweepSupersededAnswers.js`: given a confirmed supersession row, fetch new_chunk embedding, load the clinician's `published` answers, embed each (question+lead), cosine ≥ THRESHOLD → affected. For each affected: `draftAnswer` (RAG now suppresses the old chunk) → re-score → PATCH answer {new draft, status:'needs_review', review_reason:'superseded', superseded_by, superseded_at, keep movebetterco_slug}. `waitUntil`. Never throws.
3. **Trigger** — in `supersessions.js` PATCH `action:'confirm'`, after the confirm write, `waitUntil(sweepSupersededAnswers({ws, supersessionId:id}))`.
4. **Retract path** — `publishAnswer.js` gains `retractAnswerFromMovebetter({ws, answer})` → POST `kind:'answer-retract'` {slug}. Movebetter.co `api/publish.ts` gains `handleAnswerRetract` → `githubDeleteFile(src/content/answers/<slug>.md)`. (Movebetterco = 2nd PR/commit in that repo.)
5. **answers.js** — new PATCH `action:'retract'` (owner/admin gate): calls retract, sets status='retracted', clears movebetterco_slug. Only valid when movebetterco_slug set.
6. **AnswerReview.jsx** — superseded banner (amber `--action`, informational: "Your thinking changed — still live, draft below reflects the update") + **Retract from site** destructive action (useConfirm/AlertDialog).

## Phase 4 build plan (PR 2, gated on SerpApi confirmed)
1. `citationProbe.js` — add `probeGoogleAIO(question, location)` via SerpApi google engine (`ai_overview` block references). `availableEngines()` pushes 'google' when SERPAPI_KEY present.
2. `probe-citations.js` cron — probe google engine too.
3. `/seo` (SeoOpportunities.jsx) — promote citation share to hero KPI; dying-clicks below.
4. Citation gaps → interview coverage goals (#1857) — strengthen the existing topic_suggestions "AI answer gap" seam into a tracked coverage goal.
