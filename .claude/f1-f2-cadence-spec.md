# F1 + F2 — The Weekly Call & the Cadence-Governed Teammate (build spec)

**Status:** model signed off by Q 2026-06-21. Built from the 2026-06-20 Frontier Panel (F1/F2/F3) + the cadence design conversation. Mockups are the visual spec; this doc is the data/flow spec. See also memory `project-output-governance`.

## The one-line model
**Captures fan _IN_ to a weekly practice plan → Bernard produces _OUT_ to a recommended, self-tuning cadence → the human steers by exception.** Default is smart (no social expertise needed); control is always a tap away; autonomy grows as Bernard earns trust.

## Signed-off mockups (the visual spec)
- `.claude/mockups/phase-a-call-first-home.html` — call-first Home (hero = the call) + the post-call reveal, as a labelled diff of the real `Home.jsx`.
- `.claude/mockups/cadence-plan.html` — "Here's the week I'd run for you" (propose/dispose) + the **corrected** reveal (paced output + backlog + digest contribution).
- `.claude/mockups/frontier-f1-f2-f3.html` — the broader F2 teammate + F3 video studio (already versioned, PR #1522).

## Output altitude (already half-exists — do NOT regress)
`api/_lib/atomPlan.js` already splits outputs:
- **Per-capture atoms** (multi-slot, scale with each interview): instagram, linkedin, facebook, gbp, tiktok, twitter, threads, bluesky, instagram_story.
- **Single-output / one-shot** (excluded from the atom grid): blog, **email/newsletter**, landing_page, youtube, ads. The newsletter is its own deliberate `NewNewsletter.jsx` flow — NOT auto-emitted per interview.

The cadence layer governs BOTH: atoms are produced into a paced backlog; digests (newsletter, blog cadence) are assembled at the practice level.

## The cadence-policy data shape
New `workspaces.cadence_policy` (jsonb). Bernard recommends + self-tunes it; the user overrides in plain language; every producer/scheduler reads it.

```jsonc
{
  "version": 1,
  "provenance": "bernard",          // 'bernard' (recommended) | 'user' (edited)
  "trust_stage": "approve_all",     // 'approve_all' | 'approve_exception' | 'manage_by_goals'
  "last_tuned_at": "2026-06-21T00:00:00Z",
  "quiet_days": ["sat", "sun"],
  "channels": {                      // per-channel weekly target; surplus -> backlog
    "instagram": { "target_per_week": 4, "enabled": true },
    "linkedin":  { "target_per_week": 3, "enabled": true },
    "gbp":       { "target_per_week": 3, "enabled": true },
    "blog":      { "target_per_week": 2, "enabled": true }
    // facebook/tiktok/twitter/threads default enabled:false
  },
  "digests": [                       // multi-feed; ASSEMBLED, not per-capture
    { "id": "patients", "label": "Patients", "channel": "email",
      "frequency": "monthly",        // 'weekly'|'biweekly'|'monthly'|'quarterly' — default conservative (email fatigue)
      "enabled": true, "audience": "patients", "next_send": "2026-07-01" }
    // { "id":"referrers", "label":"Referrers", "frequency":"monthly", "enabled":false }
  ],
  "goals": []                        // future (manage_by_goals): e.g. {"metric":"new_patient_leads","dir":"up"}
}
```

Sensitivity: not secret. Lives on the `workspaces` row (tenant-scoped — read via `workspaceContext`/`useWorkspace`).

## Production flow (multi-clinician safe)
1. **Capture** (any clinician, any mode incl. the weekly call) → independent `interviews` row + per-capture atoms. No collision at capture.
2. **Weekly planning pass** (practice-scoped Strategist; cron or triggered) batches the week's captures → composes ONE plan: dedupe overlapping topics, fill each channel to `target_per_week`, hold surplus as **backlog** (unscheduled approved items), and route capture highlights into the active **digests**.
3. **Review by altitude** (roles exist — `permission_tier`): each clinician approves THEIR content's voice; owner/producer approves the practice calendar + the digest. *(Exact approval routing = open item.)*
4. **Schedule** to cadence (best-time, quiet_days respected). Digests send on their frequency, assembled from the period's best material — one newsletter per period per feed, never one-per-call.

## The trust ladder (control vs automation, future-proofed)
`trust_stage` advances as Bernard earns it; the user touches the policy LESS over time:
- `approve_all` (Day 1): smart recommended cadence + approve everything.
- `approve_exception`: Bernard auto-approves what the user reliably greenlights; surfaces only judgment calls.
- `manage_by_goals`: user sets outcomes ("more leads", "fewer emails"); Bernard runs + proves the cadence.

## Phase A scope (ships first — promotion, not rebuild)
1. Flip `realtime_voice_enabled` default true + enable in onboarding; fix the stale gate in `CapturePicker.jsx` (tile renders unconditionally today, 403s when off).
2. Call-first Home hero (`Home.jsx`) — keep the greeting; full picker stays reachable.
3. Post-call reveal on the existing `?wrap=1` auto-gen handoff (`PhoneCall.jsx` → `InterviewSession.jsx:1512`), showing paced output + backlog + digest contribution.
4. Prompt-caching the interview system prompt (~4× realtime cost win).
5. Seed `cadence_policy` with a sensible recommended default per workspace; the reveal + scheduler read it. (Full weekly-planning Strategist + backlog = F2, builds on this.)

Runtime cost (Phase A): no new paid services — reuses OpenAI `gpt-realtime` (~$1–3 per 6-min call uncached, ~$0.30–0.60 cached; 60-min/day cap already shipped). New services (Twilio/Vapi telephony, ElevenLabs clone) are Phases C/D only.

## F2 decisions (resolved 2026-06-21 by Q)
- **Approval routing = two-tier by altitude.** Clinician approves *their own content's voice* (light, per-capture: "does this sound like me?"); producer/owner approves the *practice calendar + digests*. At `approve_all` both gates active; as `trust_stage` → `approve_exception`, the clinician voice-gate auto-clears for reliably-greenlit content and only judgment calls surface. Maps onto the existing `permission_tier` (owner/producer/clinician).
- **Weekly-plan review surface = calendar/kanban "proposed week."** Per-channel lanes + backlog drawer + digest-contribution view, with inline approve/swap/hold/reschedule. The `cadence-plan.html` propose/dispose model. This is THE F2 control surface (replaces operating the nine pages).
- **Backlog model = explicit `held` state + nullable `scheduled_for`** (not just "unscheduled approved"). A queryable banked queue the scheduler pulls from when a slot opens or a week's captures are thin; powers a "you have N banked" count that feeds the F7 compounding-payoff reveal. Needs a migration + status CHECK constraint (per the schema rules).

## Still open (decide while building F2)
- Multi-feed digest UI beyond one feed.
- Strategist trigger: pure weekly cron vs. triggered off the weekly call's `?wrap=1` handoff vs. both.
- Voice-judge gate threshold + escalation UX (how a persistent below-threshold draft reaches a human).

## F2.3 — the proposed-week surface (signed off 2026-06-21)

**Visual spec:** `.claude/mockups/proposed-week-v2.html` (signed off). The earlier `proposed-week.html` is the superseded first cut.

### Three layers (this is the mental model — do NOT collapse them)
The proposed-week screen is **layer 1 only**. Approving from it never publishes, and it is *not* where caption/visual/accuracy get checked.

1. **The plan (the week screen).** What / when / which channel + each piece's status. A map, not the proof. This is the new surface; it upgrades the flat `ReviewInbox.jsx` list.
2. **The piece (the drill-in).** Click any card → the full per-piece review: the real caption, the actual baked visual, and Bernard's per-dimension self-check (voice / visual / accuracy / timing). This is where you verify, edit, and approve *this one piece*. Reuses the existing per-piece editors/preview — it is the review surface; the calendar just links into it.
3. **Publishing (the scheduler).** Fires at the scheduled slot, **only** for individually-approved pieces. **Approve ≠ publish** — approving clears a piece for its slot; it can still be held or pulled before then.

### The graduation model (what advances `cadence_policy.trust_stage`)
The trust ladder is **graduated exposure to confidence** — never set-and-go from day 1.

- **Signal = agreement, not time.** A piece shipped *unchanged* is a vote of confidence; an edit/reject/reschedule is a correction. Time is incidental (it's just how long evidence takes to accumulate), never the trigger.
- **Granular: per dimension × per channel.** Bernard can earn "voice is reliably in-voice" long before "trust my visual picks," and earn GBP/LinkedIn (low-stakes) before Instagram Reels (high-stakes). A single card can be half-trusted: `voice ✓ auto` / `visual · your eye`. Above a minimum sample floor per (dimension, channel) before a promotion is even possible.
- **Bernard asks; the user grants.** Never silent auto-promotion. ("Your last 12 GBP captions shipped with no edits — stop asking on GBP voice?")
- **Thermostat, not ratchet.** If the user starts editing/rejecting again (Bernard drifts, or the practice changes), it drops back a rung and asks more. Trust can go *down*.
- **Engagement is a different signal.** How posts *perform* tunes *what Bernard makes more of* (topics/formats) — it does NOT gate trust. Mixing them would let "this went viral" override "you didn't like it."

### One surface, progressive disclosure (NOT a UI per stage)
The same screen gets **quieter** as trust grows — the user never relearns a UI, the lightening *is* the felt reward, and regression is smooth:
- **Stage 0 — Day one:** every card "Open to review," grey gate pills, **no batch button**; week locks only when all pieces are individually cleared.
- **Stage 1 — Assisted:** per-card confidence scores; strong ones recede, flagged ones stand out; "approve the ones I've opened" appears; Bernard surfaces promotion asks.
- **Stage 2 — By exception:** all-confident pieces collapse into an "auto-cleared & scheduled" summary (still openable to override); only judgment calls remain as cards.
- **Stage 3 — By goals:** the week becomes a running digest of outcomes; the user nudges goals, not pieces.

### Data implications (for F2.1 build)
- Per-piece, per-dimension scores already have a home: promote `captionFidelityRubric.js` (voice) and add visual/accuracy/timing checks the producer agent emits.
- Trust state needs a per-(dimension, channel) agreement tally + the current `trust_stage` (already on `cadence_policy`). An "approved unchanged vs edited" signal must be captured at approve time (diff the served draft vs the shipped piece).
- Approval routing stays two-tier (clinician voice / producer calendar+digest) per the decisions above; the drill-in is where the clinician voice-gate lives.

## F2.1 — the Strategist (architecture decided 2026-06-21)

The keystone. A **practice-level weekly planner** — a different altitude from today's per-interview grid.

**Decisions (Q, 2026-06-21):**
- **Replace the grid, don't layer.** The Strategist composes the week from scratch; atoms become its *output*, not its input. `api/_lib/atomPlan.js` (`buildPlanRows`, the per-interview hardcoded angle grid fired on blog-save) is **retired** once the Strategist is live. (Today it seeds a fixed hook→story→insight→CTA set per interview regardless of what was said — the opposite of practice-level planning.)
- **Weekly cron trigger.** One planning pass per week batches all the week's captures into ONE plan. (Not per-capture re-planning — that re-shuffles a plan the producer may already be reviewing. Possible light re-plan on new captures is a later refinement, not v1.)
- **Curated angle palette.** Keep `atomPlan.js`'s angle library as a *menu* the Strategist selects from + can override — preserves the proven scaffolding and keeps output QA-able. Not free-form angle invention.

**What it reads:** `cadence_policy` (targets, quiet days, digests, trust_stage) + the practice brain (`practiceMemory.js` already does vector search — `searchPracticeMemory` / `buildTopicScopedHistoryBlock`; usable day one, no F6 dependency) + engagement history (`engagement/top-performers.js`).

**What it does:** batch week's `interviews` → dedupe overlapping topics → pick angles from the palette → fill each channel to `target_per_week` → surplus gets `held_at = now()` (migration 138, the backlog) → route capture highlights into active digests. **Drafters are unchanged** — the existing generation path still writes the text; the Strategist decides *what / how-many / which-angle / now-vs-banked*.

**Open for the build pass:** the plan-object shape (does the Strategist emit `content_items` rows directly, or a plan record that fans out to drafters?); cron isolation + idempotency (re-running the weekly pass mustn't double-plan); how `held_at` items get *promoted* into a thin future week.

### Build order (each ships independently)
1. ✅ **Backlog foundation** — `held_at` + index (migration 138, applied to prod 2026-06-21, PR #1535).
2. **Strategist (headless)** — the weekly planning pass; retires `atomPlan.js`.
3. **Voice-judge gate** — promote `captionFidelityRubric.js` to gate drafts.
4. **F2.3 surface** — the signed-off proposed-week calendar (`proposed-week-v2.html`).
5. **Producer + scheduler** — best-time placement, quiet-days, digest assembly, backlog pull.
