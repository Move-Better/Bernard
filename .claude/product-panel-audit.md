# Bernard — Expert Product Panel ("Make-It-Better" Audit)

**Created:** 2026-06-04 · **Owner:** Q · **Status:** living doc — re-run on cadence, Q marks up
**Purpose:** a repeatable way to answer one question — **"how do we make Bernard a genuinely better *tool for the Move Better team to use, day to day*?"** A simulated panel of top experts (design, behavioral psychology, voice/conversation, AI, reliability, team-workflow) reviews the *actual app* and returns a prioritized list of improvements. This is the instrument Q wanted from the start: not strategy, not bug-hunting — **product and experience quality for our own team.**

**Where it sits among the instruments:**
- `/audit` · `/auditfull` · `/checkup` → **code & bug layer** (does it work / is it safe).
- `blindspot-audit.md` / `blindspot-audit-inhouse.md` → **strategy & direction layer** (are we building the right thing / is it worth the time).
- **This doc** → **product & experience layer** (is the app a *delight to use* for our clinicians, and what would world-class experts change).

---

## 0. How to use this (the ritual)

This is a **waypoint**, not a one-off. Re-run it on a cadence, append the new findings, and diff against the last pass — the trend (are we closing UX gaps or opening them?) is the product.

### The one rule that makes a run good: **ground in the LIVE app first**
Before convening the panel, read the *real, current components* (or have Claude do it — dispatch an Explore agent over `src/` + `api/`). **Do not critique from strategy docs or memory** — that produces a worse copy of what already exists and recommends things already shipped. This is the project's own hard-won lesson (`feedback_mockup_must_diff_real_app`, "Verify feature wiring before scoping changes"). The entire value of a run is *specificity from real code* — component names, real routes, actual button behaviors, real rough edges. A generic critique is worthless; a specific one is gold.

### The panel (the reusable cast)
Six experts, each catching a different class of product gap. Keep the cast stable across runs so findings are comparable.

| Expert | What they catch |
|---|---|
| 🎨 **Principal product designer (IA)** | Surface sprawl, inconsistent editors, status-vs-action labels, navigation legibility |
| 🧠 **Behavioral scientist (habit & motivation)** | Whether using it is *rewarding* — the payoff/dopamine loop, activation energy, why people don't come back |
| 🎙️ **Conversation / voice UX designer** | The capture magic — does talking to it feel effortless; mobile/offline; the interview-as-homework risk |
| 🤖 **AI / ML engineer** | How much the model does *for* the user vs. leaving them assembly work; retrieval; proactivity |
| 🔧 **Reliability engineer** | Trust — "did it actually work?"; limbo/stale states; lost work; notifications on async results |
| 🔁 **Workflow / ops designer** | The multi-person reality — capture → review → schedule → publish handoffs; producer vs. clinician |

### Honesty about the lenses (read this)
The panel is **me reasoning from the real code + general product expertise.** It's a strong bias-reduction forcing function — but it is **not** the same as watching a real clinician use the app cold. The experts predict what an experienced person would obviously flag; they cannot find the unknown-unknowns that only a real staffer stumbling through the app reveals. **The true test is Lens D from the blindspot audit: sit Whitney/AJ/Cullen down and watch.** Weight panel findings as "very likely right," not "proven."

### Schemes (identical to the blindspot docs, so the instruments line up)
**Severity (impact on daily team use):** 🔴 blocks or erodes daily use · 🟡 friction that compounds · 🟢 polish worth knowing
**Status:** `Open` (unexamined) · `Aware` (known, no action) · `Building` (in progress) · `Closed` (shipped or consciously dropped)

### Re-run cadence
Every 4–6 weeks, OR after any meaningful feature ships (to check it didn't add sprawl), OR whenever a real staffer hits friction. To re-run: re-ground in the live app → re-convene the six experts → append a new dated panel block (§3) + roadmap (§4) → fill the drift log (§5). **Append, never overwrite.**

### Output format (every run produces)
1. **Panel reads** — each expert: their sharpest read + their headline fix.
2. **The converged verdict** — the one through-line the panel agrees on.
3. **A prioritized roadmap** — improvements as an options table with **Est. Days + Est. Claude Cost** (per Q's format rule), ranked by impact on daily team use.
4. **Pick 1–3** — and for any non-trivial UI/flow, **mockup-first before code** (project rule). A run that yields 12 to-dos yields zero; sequence them.

---

## 1. Fixed reference — what the app IS for the team today

So each pass attacks the same target. Update when the app materially changes. (Fuller surface map: `ux-current-state.md`.)

- **The core loop:** voice interview / capture → AI spawns content (blog, per-channel social, carousels, clips, email) → review & approve → publish via Buffer / GBP / WordPress / Beehiiv.
- **The surfaces (~7–9):** Home (`/`), Overview (`/overview`, editor-only), Stories (`/stories`), Storyboard (`/storyboard`), Library (`/library`), Book (`/book`), Write (`/write`), Pre-Visit (`/pre-visit`), Slate (`/slate`, flag-gated). A `PipelineStepper` shows Interview→Words→Media→Publish (presentational only).
- **Capture modes** (`/new`): Interview (AI chat, voice via STT), Voice Memo (record/upload, any length ≤25 MB), Photos & Video (PWA), Live Interview (WebRTC, beta), Patient Handout (beta), Import (URL), Seminar/Talk (was disabled — being wired now).
- **Who uses it (the real users):** Q (all 3 brands), Whitney (all 3; mobile equine), AJ (People, on-camera), Alli (People, Producer), Cullen (People), Sophie/Tyler/Philip (People). Most are non-technical and busy with patients.
- **Usage reality (D0, 2026-06-04):** genuinely multi-user — 4 non-Q clinicians ran their own captures in the last 30 days — but all <30 days old (onboarding wave, not yet a proven habit); Animals & Equine still run mostly through Q. *This is why the retention/payoff findings below matter most.*

---

## 2. The through-line — the converged verdict (run 2026-06-04)

> **The generation core is genuinely good. What will make Bernard a better tool for the team isn't more generation — it's the two *ends* of the loop, which are rough: getting words *in* (capture friction, lost recordings) and seeing them *pay off* (no published moment, invisible handoffs, no "did it work?").**

A team keeps using a tool that's effortless to feed and rewarding to finish. Today the middle (turning a transcript into faithful multi-format content) is polished, and both ends have grit. Every panel finding below is an instance of this: invest in the *edges* of the loop, not the already-good center.

---

## 3. The panel — run 2026-06-04

Grounded in a full read of the live `src/` + `api/` (Explore sweep). Each expert: their read, then their headline fix.

- 🎨 **Principal product designer (IA).** ~7–9 destinations and *five different editing shells* (Stories edits inline, Storyboard uses a sidebar, Write is dual-pane, Book/Slate are their own worlds) — users re-learn the page per tool. Labels describe *status* ("Ready for content," "Awaiting review") when a busy clinician needs *verbs*. **Fix:** one predictable editing shell; relabel the app around the next *action*.
- 🧠 **Behavioral scientist.** Usage is real but all <30 days old — an onboarding wave, not a habit, because there's no *reward*. When a piece publishes: no toast, no "it's live," no "200 people saw it." The dopamine that brings Whitney back Tuesday never fires. **Fix:** make publishing feel like *landing a shot* — a visible "it's live" moment, and later "here's who it reached," surfaced to whoever captured it.
- 🎙️ **Conversation / voice designer.** The interview is the magic but starts with a *form* and is a 2,000-line two-panel chat. On mobile (Whitney's equine visits) a backgrounded tab silently kills the recording and the audio is lost — a trust-killer, and likely why Animals/Equine still route through Q. **Fix:** ruthless, forgiving capture — one tap to talk, audio buffered so it *never* gets lost, resumable, Shortcut surfaced as the fast path.
- 🤖 **AI / ML engineer.** The model does the easy 40% (draft text) and leaves humans the assembly (find media, attach, pick time, schedule). But the AI *has* the Library, vision, and Slate clips — it could assemble the *finished* post and hand over an "approve or nudge" decision. Retrieval could be proactive ("you said this about sciatica in March — revisit?"). **Fix:** push from *AI-drafts-text* → *AI-assembles-the-finished-package*.
- 🔧 **Reliability engineer.** For a team tool, "did it work?" is everything — and there's limbo everywhere: Slate polls 5 min then stops on "detecting…"; Book spins past 60s; the org-gate can wedge on a blank screen. And **no notifications** — Whitney sends a draft for review and can't tell if Alli ever saw it. Silence reads as broken. **Fix:** every async job ends in a clear terminal state; every handoff fires a real signal (in-app + email).
- 🔁 **Workflow / ops designer.** A single-player app for a multi-player team. The real flow is *clinician captures → Alli reviews & schedules → publishes*, but the handoff is invisible: Alli has no review inbox, no bulk-approve, no shared calendar; Whitney has no "my work & where it stands" view. **Fix:** model the actual team — producer review-inbox with bulk actions, a personal tracker for clinicians, one shared "when do our posts go live" calendar.

---

## 4. The roadmap register — run 2026-06-04

The prioritized output you **diff** each run. Ranked by impact on daily team use. (Recommended sequence: cheap wins first; big rebuilds mockup-first.)

| ID | Improvement | Lens | Sev | Est. Days | Est. Claude Cost | Status |
|---|---|---|---|---|---|---|
| **P1** | **Affordance cleanup** — remove dead "Seminar (coming soon)" button, kill limbo polling states (Slate/Book → terminal done/failed), active labels ("Awaiting review"→"Review now," "Edit words"→"Edit text"), consistent action verbs. | 🎨🔧 | 🟡 | 1–2d | $1–3 (Sonnet) | **Building** — Seminar lane being wired (2026-06-04) |
| **P2** | **Close the loop** — published "🎉 it's live" moment + notifications (in-app + email) on capture→review→publish handoffs + a personal "My work & where it stands" view. *The retention lever.* | 🧠🔁 | 🔴 | 3–6d | $5–12 (Sonnet) | Open |
| **P3** | **Bulletproof capture** — offline/background-safe audio buffering (never lose a recording), resumable sessions, surface the iOS Shortcut. Unblocks Whitney's mobile equine + Animals. | 🎙️🔧 | 🔴 | 3–6d | $4–10 (Sonnet) | Open |
| **P4** | **Producer review-inbox** — one surface for Alli: review queue + bulk approve/schedule + shared "when do posts go live" calendar. Collapses the 3 approve→publish paradigms. | 🔁🎨 | 🟡 | 5–10d | $8–18 (Sonnet; Opus for IA) | Open |
| **P5** | **AI assembles the package** — pre-attach best media + write caption + propose schedule → human approves/nudges. Removes ~3 manual steps per piece. | 🤖 | 🟡 | 5–12d | $10–25 (Opus design + Sonnet build) | Open |
| **P6** | **One editing shell** — replace the 5 editors with a single instruction-first surface (preview + instruct + guardrails). Biggest learnability win, biggest effort/risk. | 🎨 | 🟡 | 2–4wk | $40–80 (extended) | Open |

**Shape of the board:** the two 🔴s (P2, P3) are both *ends of the loop* (payoff out, capture in) — exactly the §2 through-line. P1 is cheap and already underway. **Recommended order: P1 (cheap, in progress) → P2 → P3, then mockup-first for P4–P6.** Do one slice at a time, with Q feedback between each (Q's stated cadence: "slow and with feedback").

---

## ⟳ Re-run — 2026-06-05

**Re-grounded in the live app** (project root on `main`; full `src/`+`api/` sweep). A large batch merged in ~24 hours — and **three of the four targeted roadmap items shipped.** The panel's central bet held: investing in the loop-ends paid off.

**Updated verdict.** The **payoff end (OUT) is now genuinely closed** — you can see your posts go live (`PostsLiveCard`), where your own work stands (`MyWorkCard`), and the team's cadence (`WeeklyRecapPanel`: streaks + "due" nudges + run-cost). The **producer middle got materially better** — one `ReviewInbox` with bulk approve/schedule + a shared calendar, collapsing the old 3-surface juggle. But **two specific holes remain — the sharp findings of this run:**
1. **Capture got fixed on the easy lane and skipped the hard one.** VoiceMemo is now crash-safe (`audioCaptureDb.js` IndexedDB persistence + recovery), but the hour-long **interview** — where losing work hurts most — is *still* not persisted; an iPhone background/kill strands the whole session. The most valuable capture is the one still unprotected.
2. **Handoffs are silent.** The payoff exists but isn't *pushed*: nothing tells you when your draft is approved or goes live — you only see it if you happen to look. P2's reward landed; its *notification* half never shipped.

And surfaces keep accreting (nav ~7–9 → **~11**; still **7 separate editing shells**), which makes **P6 (one editing shell) the increasingly-overdue structural item**, not a someday-nice-to-have.

**Panel re-convened (reacting to what shipped):**
- 🎨 **IA:** Consolidation happened at the *board* level (Overview + ReviewInbox absorbed scattershot surfaces) but *not* the editor level — 7 shells remain, nav grew to ~11. P6 is now the biggest unbanked win. (Minor: nav says "Analytics," page says "Insights.")
- 🧠 **Behavioral:** The reward loop shipped and *lands* — live-posts moment + streaks + "due" nudges are exactly the habit machinery. The miss: it's *pull*, not *push*. Silent handoffs mean people must come look; notifications would turn a nice dashboard into a habit trigger.
- 🎙️ **Voice:** Bulletproofing the *short* memo while leaving the *long* interview unprotected is backwards — the interview is the magic and the expensive thing to lose. Finish P3 on the lane that matters.
- 🤖 **AI:** Seminar slice ① (bounded-concurrency chunked transcription, `seminarTranscribe.js`) is clean. But P5 (AI assembles media+schedule) is untouched — still the biggest untapped leverage — and the seminar "Learn By Doing" multi-piece treatment (slice ③) is the AI-design piece still owed.
- 🔧 **Reliability:** New backend paths shipped *with* good hygiene (seminar cooperative-cancel + a stuck-row sweep cron). The two trust gaps left are both about *the user knowing*: silent handoffs (stale state across surfaces) and recoverable-capture-but-not-for-interviews.
- 🔁 **Workflow:** ReviewInbox is a real team win — Alli gets one queue + bulk actions instead of three surfaces. The remaining team friction is the silent handoff between people.

**Register — re-run 2026-06-05** (🔴 cluster shrank {P2, P3} → {P3 interview-lane only}):

| ID | Item | Sev | Status | Current finding |
|---|---|---|---|---|
| **P2** | Close the loop | 🔴→🟡 | **Closed (core)** | Payoff shipped & lands (#1199/#1203/#1205). Residual = handoff **notifications** never shipped → the loop is pull, not push. |
| **P3** | Bulletproof capture | 🔴→🟢 | **Closed (#1228)** | DONE 2026-06-05: interview voice-clone audio now crash-safe + recoverable (flush-on-hide + wake-lock + 4s slice + orphan re-upload, ported from VoiceMemo). Confirmed finding: the interview *transcript* was ALREADY safe (localStorage mirror + session_state flush + Home resume); only the background *audio* was exposed — narrower than the audit's "whole session strands." Gap B (in-flight unsent answer) + PhoneCall.jsx (server-only transcript) left as follow-ups. iPhone kill→recover device test = the real acceptance. |
| **P4** | Producer review-inbox | 🟡→🟢 | **Closed** | ReviewInbox + bulk approve/schedule + calendar (#1198/#1202/#1204). Collapsed the 3-paradigm sprawl. Well-built. |
| **P1** | Affordance cleanup / Seminar | 🟡 | **Building** | Seminar transcription backend solid (#1201). **Card still disabled** — slice ② upload UI pending (`feat/seminar-lane-transcription` worktree active). Nav label drift (Analytics/Insights) new. |
| **P5** | AI assembles the package | 🟡 | **Open** | Untouched. Biggest untapped AI leverage; seminar slice ③ treatment is the related design piece. |
| **P6** | One editing shell | 🟡 | **Open (overdue)** | 7 editing shells unchanged; nav crept to ~11. Sprawl accreting → now the top structural item. |

*New, minor (rough edges this batch introduced):* no "My newsletters" home surface (newsletter drafts invisible, unlike `MyWorkCard`); Analytics/Insights nav-label mismatch; Seminar card still visible-but-disabled ("coming soon").

**Pick one next (one per pass):** **finish P3 on the interview lane** — wire the existing `audioCaptureDb` persistence + recovery into `InterviewSession.jsx`. It's the only remaining 🔴, a data-loss/trust risk on the highest-value capture, and the pattern already exists in VoiceMemo (a port, not an invention). Runner-up: ship handoff **notifications** to convert P2's dashboard from pull to push.

---

## 5. Drift log

*Append each run. The question that matters: are the loop's two ends getting smoother, and did shipped features add or remove sprawl?*

| Date | What changed since last pass |
|---|---|
| 2026-06-04 | Baseline established (P1–P6) from a full live-app read. Through-line: strong generation core, rough loop-ends (capture in / payoff out). 🔴s = P2 (payoff) + P3 (capture trust). P1 started (Seminar lane). |
| 2026-06-05 | **Re-run after a big merge batch.** 3 of 4 targeted items SHIPPED: **P2** close-the-loop (#1199/#1203/#1205) → core **Closed** (payoff lands); **P4** producer-inbox (#1198/#1202/#1204) → **Closed** (collapsed the 3-surface sprawl); **P3** (#1200/#1212) → **Building** (VoiceMemo crash-safe, but InterviewSession still unprotected — the hard lane skipped); **P1** Seminar (#1201) → **Building** (transcription backend solid, card still disabled). **🔴 cluster shrank {P2,P3} → {P3 interview-lane}.** New holes: silent handoffs (notifications never shipped — P2's other half), interview-capture loss, nav crept ~7–9→~11 (P6 more overdue), newsletter unsurfaced, Analytics/Insights label drift. **Verdict: payoff end closed, producer middle better; capture-IN fixed the easy lane, not the hard one.** Next action: finish P3 on InterviewSession. |
| 2026-06-05 | **P3 interview lane SHIPPED (#1228)** — the re-run's "pick one next" is done. Ported VoiceMemo crash-safety (flush-on-hide `requestData`, screen wake-lock, 4s slice) into the interview voice-clone capture + `recoverOrphanedAudio` (silent re-upload on reopen) + lane-filtered `listRecoverable(source)` so interview orphans stop surfacing in VoiceMemo's card. **Key finding (contra the audit):** the interview *transcript* was already crash-safe (localStorage mirror + session_state keepalive flush + Home ResumeStrip) — only the background *audio* was exposed, so the fix was narrower than "the whole session strands." Q scoped it to audio-only; Gap B (in-flight unsent answer) + PhoneCall.jsx (server-only transcript) are noted follow-ups. Bug-hunter pass hardened 3 edges. Verified: gates + IDB recover-contract 11/11 in a real browser; iPhone kill→recover device test is the remaining real acceptance. **🔴 cluster now empty.** Open: P5 (AI assembles), P6 (one editing shell), P2's notification half, + the two P3 follow-ups. |

---

## 6. How to re-run this (so it stays a waypoint)

1. **Re-ground in the live app** — Explore sweep over `src/` + `api/`. Do NOT skip this; it's the whole value.
2. **Re-convene the six experts (§3)** against the *current* state — ask Claude to run the panel.
3. **Re-rank the roadmap (§4)** — carry forward open IDs, add new ones, update status (Closed = shipped).
4. **Fill the drift log (§5)** — is the loop smoothing? Did the last feature help or sprawl?
5. **Pick 1–3, mockup-first for UI** — and remember the only ground truth is a real staffer using it (blindspot Lens D). A run that produces 12 to-dos produces zero.

> **The honest caveat, always:** this panel is expert *simulation*, not user *observation*. It's sharp at "what would a great team obviously change," blind to "what real clinicians actually trip on." Pair it with watching one real non-Q staffer, and weight accordingly.

---

*Keep file (human-authored instrument — treat like source, per the `.claude/` scratch-vs-keep convention). Related: `blindspot-audit-inhouse.md` · `ux-current-state.md` · `feedback_mockup_must_diff_real_app` · `project_bet_against_slop_strategy`. Natural next step if this earns its place: wrap as a `/panel` skill so a run is one command that re-grounds, re-convenes, and appends a dated block.*
