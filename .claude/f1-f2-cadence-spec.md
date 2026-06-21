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

## Open items (decide before/while building F2)
- Approval routing by altitude (who signs off the digest vs per-capture content) — roles exist, UX undefined.
- Weekly-plan review surface (how the producer sees + adjusts the composed week).
- Backlog model (a `held`/`scheduled_for` concept vs just "unscheduled approved").
- Multi-feed UI beyond one feed.
