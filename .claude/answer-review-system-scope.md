# In-app answer review system — scope (Bernard side)

**Date:** 2026-07-03 · **Status:** scoped + mockup approved-pending · **Mockup:** `.claude/mockups/answer-review-inapp-v1.html` (Artifact published)

## The ask (Q, 2026-07-03)
Make the answer-library review a **repeatable, in-app workflow** — not manual emails. Bernard generates answers → each lands in the **owning clinician's in-app queue** (home-screen nudge) → they **approve or edit** → on approval it **publishes to movebetter.co**. Do this continuously as the practice brain grows.

## It extends patterns Bernard already has (verified 2026-07-03)
- **Per-clinician review nudge on Home** already exists: `Home.jsx:190` "blog review nudge" — opted-in clinicians see posts *awaiting their read* (`yourReview` from `week-summary.js`, gated on `blog_review_enabled`). Answer-review is the same shape.
- **The publish pipeline is live**: `api/_routes/publish-blog.js` + `src/lib/blogOutput.js` already POST to Movebetterco's real `api/publish.ts` webhook (the `/go-deeper` blog pipeline). Publish-on-approval reuses it, extended for the `answers` collection.
- **Review/revise loop exists**: the Standing Producer's change_request→revise (`reviseContentItem.js`) + /week approve flow. "Ask Bernard to revise" reuses it.
- **Grounded generation exists**: `draftAtom.js` (per-`staff_id` practice-memory grounding). A Q&A variant drafts answers in the owning clinician's voice.
- **Clinician↔user mapping**: `staff.user_id = clerkUserId` (used across the app) resolves the logged-in doctor's staff row → their queue.

## Architecture
- **`answers` table (Bernard)** — new migration. `{ workspace_id, staff_id (owning clinician), question, answer_lead, body, condition, slug, status, review_notes, grounding_source, published_at, movebetterco_ref }`. Status: `drafting → needs_review → (changes_requested ↔ needs_review) → approved → published`. It becomes the system of record; movebetter.co is an output.
- **Generation** — `draftAnswer({ ws, staffId, question })`: grounds in that clinician's practice_memory (like draftAtom), writes `needs_review` assigned to them. Sourced from `seo_tracked_questions`; best-fit clinician chosen by expertise + practice-memory coverage (the DATA-based mapping — see `answer-library-scope.md`).
- **Home nudge** (per clinician) — mirrors the blog-review nudge: "N answers ready for your review" → the review surface. Renders only when that clinician has `needs_review` answers.
- **Review surface** — the doctor reads each; actions: **Publish** (→ approved → publish-on-approval to movebetter.co), **Edit inline** (→ approved), **Ask Bernard to revise** (→ change request, Bernard re-drafts in-voice, back to needs_review). Every answer shows its grounding ("from your interview X").
- **Publish-on-approval** — approved → `publish-blog.js`-style POST to Movebetterco `/api/publish` (answers collection) → Vercel rebuild → live + QAPage schema (the site side is already built: PR #98).

## Standing Producer integration
This is naturally a new **Producer lane** (`author_answers`, default-off): Bernard proactively drafts answers for scoreboard questions it isn't cited on, routes them to the right clinician's queue — closing the flywheel end-to-end (scoreboard gap → grounded draft → clinician sign-off → live → cited), with the human review gate intact. Reuses agent-tick + the lane/cap/kill machinery.

## Phases
- **P1** — `answers` table + `draftAnswer` lib + home nudge + review surface (approve/edit/revise) + publish-on-approval. Seed from the tracked questions; backfill the 13 existing PR-#98 answers as `needs_review` (so they route through the real flow instead of the manual packet).
- **P2** — Standing Producer `author_answers` lane (auto-draft uncovered questions → clinician queues).
- **P3** — the movebetter.co searchable/ask KB (search shipped on PR #98; "ask" layer = buy-vs-build, deferred).

## Decisions (recommended; confirm the big one)
- **New `answers` table** (not overloading content_items — answers are a distinct public-KB entity). 
- **Both edit modes** (inline + ask-to-revise). 
- **Auto-publish on approval** (the clinician's yes = live). 
- **Generation = Producer-driven** (the "repeatable without emailing" ask) — but that means Bernard autonomously drafting medical content to review queues (spend + autonomy). Default-off lane, human gate intact. ← the one to confirm.

## Effort
| Phase | Est. Days | Est. Claude Cost |
|---|---|---|
| P1 (table + gen + home nudge + review surface + publish-on-approval) | 3–5d | $10–25 (Sonnet; Opus for the publish/migration seams) |
| P2 (Producer author_answers lane) | 2–3d | $6–14 |
| P3 (ask layer) | buy-first | — |
