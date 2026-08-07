# "Make a Point" — feature spec

**Status:** Phase 1 LIVE on prod (merged #2565, deployed `b28de351`, verified in Chrome). Phase 2 LIVE on prod (merged #2569, deployed `313ce70f`). Phase 3 built (this PR).
**Origin:** design + prototype session 2026-08-06 (Q + Claude). Decisions log entry same date.

---

## The job

Bernard's interviews are clinical-topic *extractions* — a good interviewer pulls tacit knowledge out of an expert. But sometimes Q doesn't want to answer a preset topic; he has a **specific point to make** from his own experience (canonical example: "months of broken deep sleep, then two 10-minute runs fixed it — and it's specifically running, a hard hike didn't do it"). That is a different modality: the person already *has* the thesis; the interviewer's job is to **sharpen** it, not extract it.

The literal ask ("create a topic") already existed — the interview topic is free text. The real gap the code confirmed: the interviewer has **one stance** (clinical extraction, a hardcoded "WHAT TO COVER" checklist), and the user's **angle is never injected anywhere**. So "Make a point" is a second interviewer mode, not a new topic field.

## Key decisions (all Q, 2026-08-06)

| Decision | Choice | Why |
|---|---|---|
| Modality | **Interview to sharpen** (not dictate-to-draft) | The person has the point; value is drawing out proof + significance + specifics. |
| Scope | **Rooted in your world** (movement/health/practice) | Keeps the moat + non-diagnostic guardrails coherent; not a general content tool. |
| Interview model | **Dynamic podcast-host**, not a fixed checklist | Q: a real interview pivots, follows energy, pounces on a big deal, injects knowledge to ask sharper questions. |
| Host knowledge | Serves **extraction/reaction, never authorship** | The take stays the user's; the AI must not hand them a thesis. Protects the voice moat. |
| Claim posture | **Experiential + light mechanism**, guardrail at the **publish layer** | Frees the host to be smart/reactive; content is calibrated where it's generated, not by muzzling the interview. |
| Dynamism scope | **Pilot in the point-interviewer only** first | Greenfield, contained; graft onto clinical interviews later if it proves out. |
| Capture | **Both** — record now (P1) + quick-capture-later (P3) | A good point strikes when you can't record. |
| P2 enforcement | **Framing + advisory flag** (reuse safety rubric), not blocking | Q reviews every draft; a fail-closed gate he'd override adds friction. Blocking earns its keep when others use it. |
| P2 claims | **Channel-aware** | Short formats (IG/GBP): experiential only, no mechanism. Long (blog): experiential + hedged mechanism + n=1 caveat. Sidesteps "the caveat is the tail and short formats truncate it." |
| P3 data home | **Parked interview** (`kind='point'`, `status='parked'`) | A parked point *is* a pending interview; reuses P1 schema, no new table, no clinical/personal mixing. The status transition to `completed` is the whole lifecycle — no separate link step. |
| P3 capture | **Just the point** (one field, voice defaults to I/me) | Friction is the thing capture removes. |

## The dynamic host interviewer (validated before build)

Lives in `getPointInterviewSystemPrompt(workspace, staffName, point, _pastInterviews, opts)` (`src/lib/prompts.js`). Selected in `InterviewSession.jsx` when `interview.kind === 'point'`; the clinical prompt is byte-identical otherwise.

The prompt briefs a podcast host who: builds an outline *from the point* (not a fixed checklist), follows the energy and pivots, **pounces on the striking result**, brings knowledge to ask sharper questions but never authors the thesis, **mirrors the guest's own facts** (never substitutes a plausible detail), takes corrections cleanly, keeps mechanism an *open question* not a fact, and **lands the plane** (secures proof + significance + takeaway before wrapping). The opener instruction is included only on the first turn (`opts.isFirstMessage`).

**Validated turn-by-turn against Q's real story** (2026-08-06), on the production model (`claude-sonnet-4-6`, 1024-tok cap — same as live interviews):

| Behavior | Result |
|---|---|
| Reflect point + name ROI up front, skip warm-up | ✓ |
| Dynamic pivot (used "on a whim" / "tried everything" to raise stakes) | ✓ |
| Pounce on the big deal (bloodwork, decade of data, ABA-reversal, running-specificity) | ✓ |
| Cross-turn synthesis (pulled strength-training forward to triangulate) | ✓ |
| Take a live correction ("ran" not "walked") | ✗ then ✓ |
| **Fact fidelity** | drifted once → added the mirror-the-facts rule → drift gone |
| Mechanism as question, never authored (held under direct bait) | ✓ |
| Land the plane (secured proof + significance + takeaway + caveat) | ✓ |

The one flaw (host drifted "ran"→"walked") was the highest-value finding — it produced the fact-fidelity + correction-handling rules now in the prompt. **Watching it on real data surfaced a risk no amount of design discussion would have.**

## Phase 1 — Core (BUILT, PR #2565)

- `interviews.kind` (`'topic'`|`'point'`) + `interviews.point` — migration `206_interview_kind_point.sql`, **applied to prod**, snapshot refreshed.
- `getPointInterviewSystemPrompt` + `InterviewSession` branch on `kind`.
- `db/interviews.js` POST: accepts `kind`/`point`; for a point, derives the `topic` title server-side from the point (Storyboard needs a title). Read select includes `kind,point`.
- New Interview: mode toggle (**Cover a topic** / **Make a point**); point mode swaps the clinical Topic field for a "What's the point you want to make?" seed box, hides clinical chips, defaults voice to personal. Signed-off mockup: `.claude/mockups/make-a-point-mode.html`.
- Clinical interviews byte-identical; point interviews reuse the whole Storyboard → Publish spine (transcript = grounding, so the no-fabrication moat holds).

## Phase 2 — Publish guardrail (BUILT — framing; safety-flag chip deferred)

Register is already free: point interviews default to `voice_mode='personal'`, and the generators already preserve first-person + append a brand signature in that mode (`prompts.js:300-313`) — so the personal story is never rewritten to clinic "we" voice.

**Built:**
1. `src/lib/pointContentFraming.js` — single shared helper, channel-aware: `format:'short'` (social atoms) forbids any mechanism/causal claim outright (nothing to hedge, nothing to truncate); `format:'long'` (blog/newsletter) allows a hedged mechanism ("generally-accepted or open", never asserted as fact) plus a woven — not tacked-on — n=1 caveat. Returns `''` when `isPoint` is false, so every non-point path is byte-identical.
2. `isPoint` threaded as a trailing optional param (default `false`) through `getAtomSystemPrompt`, `getBlogPostSystemPrompt` (+ its `getGeneralBlogPostSystemPrompt` delegate), and `getNewsletterSystemPrompt` — and into **every one of their 8 call sites**: `draftAtom.js` ×2 (first draft + GBP location variant), `content-items/regenerate.js`, `content-items/blog-regen-prepare.js`, `CaptureReview.jsx`, `InterviewSession.jsx` ×2 (blog + newsletter), and `outboundCall.js`/`twilio-recording.js` (F1 outbound call — always `false` in practice today since that flow never produces `kind='point'`, threaded for correctness/future-proofing). Two interview SELECTs (`regenerate.js`, `blog-regen-prepare.js`, `twilio-recording.js`) needed `kind` added.
3. `tests/lib/pointContentFraming.test.js` — 12 tests, mutation-verified (a `return ''` mutation reddened exactly the 7 "framing present" tests, left the 5 byte-identical tests green — proves the guard actually guards, not just that it exists).

**Not built (tracked gap):** the multi-part blog SERIES generator (`getSeriesClusterSystemPrompt`/`getSeriesPartSystemPrompt`) was out of the mapped 8-caller surface and does not yet get the framing — low-risk (a point interview splitting into a multi-part series is an edge case) but real; thread it the same way if that path is used for point content. The **advisory safety flag** (adapting `answerFidelityRubric.js`'s GENERAL TEACHING vs INDIVIDUAL INSTRUCTION dimension, surfaced as an approval-panel chip) is designed but not built — deferred as its own follow-up (needs a mockup for the chip surface, per mockup-first).

## Phase 3 — Quick-capture door (BUILT)

A parked point *is* an interview row (`kind='point'`, `status='parked'`, `point` set, no messages). **Correction from the original design**: grounding at build time found `interviews.status` has **no DB CHECK constraint** (unlike assumed) — it's a plain `text` column, so adding `'parked'` was purely an app-layer change (`api/_routes/db/interviews.js`'s status-handling), no migration needed. It also found `staff_id` is hard-required everywhere (POST, and the session route itself is `/interview/:staffId/:interviewId`), so capture **silently auto-resolves the speaker to the logged-in user** (same self-detection `NewInterview.jsx` uses) rather than deferring staff assignment — "no pickers" means no *visible* picker, not no staff.

**Built:**
- **Capture** (`src/components/home/PointCapture.jsx`, mounted at the top of Home, ahead of the hero cascade): one textarea + Save. `getOrCreateStaff` (self, idempotent — repeat captures never duplicate the staff row) → `createInterview({ kind:'point', point, status:'parked', voiceMode:'personal' })`.
- **API**: `db/interviews.js` POST accepts `status:'parked'` (only legal client-selectable creation status; guarded to `kind==='point'` only). New GET mode `?parked=1` lists `kind=eq.point&status=eq.parked` rows — the only read path that surfaces them.
- **Exclusion from every other view, at the single upstream source**: `db/staff.js`'s two `staff?...,interviews(...)` embeds (the shared source behind `useStories`/`useStaffSummaries` → Stories, Home's resume/overdue/topic-gap calcs) both got `&interviews.status=neq.parked`. One fix, every downstream consumer protected — confirmed via grounding that all the polluted-view risks traced to this one query shape.
- **"Points to record" strip**: renders only when non-empty (hidden otherwise, matching `ResumeStrip`), amber/action palette so it never visually blurs with the primary-teal Resume strip. **Dismiss** (×) added beyond the original spec — PATCHes `status:'abandoned'` (already a valid PATCH target, zero new plumbing).
- **Record now**: PATCH `status: 'parked' → 'in_progress'` (must happen explicitly and *before* the session starts, not deferred to completion — otherwise the parked-exclusion filter would hide an actively-recording session from Stories/Home too), then navigate to `/interview/:staffId/:interviewId` with **no `micChecked` nav state** — `InterviewSession`'s own in-session mic-check gate already fires for any direct link lacking that state, so this needed zero new mic-check plumbing.
- Mockup: `.claude/mockups/point-capture.html`, signed off 2026-08-06 (top placement, near the greeting, ahead of the hero cascade).

**Fast-follows (not v1):** dictate-to-capture; a "N unrecorded points" nudge reusing existing nudge infra.

## Verification approach

Every phase is verified with an **OLD-vs-NEW harness on the real sleep/running transcript** (imports the real function, reverts only the edit for OLD, feeds the captured production input, diffs for the specific defect) — the method that validated the Phase 1 prompt. Phase 2: prove short = no mechanism claim, long = hedged mechanism + woven caveat, advisory flag fires on an overclaim probe. Authed UI changes get the post-deploy Chrome verification.

## Sequencing & status

All three phases are built. Shipped in order 1 → 2 → 3 (all three merged and deployed 2026-08-06/07, PRs #2565, #2569, and this one). Phase 1 shipped behind a GitHub Actions major outage — auto-merge carried it through once Actions recovered.

**Remaining open items**, both already flagged in their phase sections above: the Phase 2 advisory safety-flag chip (needs its own mockup), and the multi-part blog series generator not yet getting Phase 2's framing.
