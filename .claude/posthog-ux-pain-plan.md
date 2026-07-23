# PostHog — Automatic UX Pain Detection & Recommendation Engine

**Status:** Planning complete, awaiting Phase 0 (2026-06-16)
**Owner:** Q (operations@movebetter.co)
**Session type:** Planning / Architecture

## Goal

Automatically detect UI pain points from real usage and turn them into prioritized,
component-level fix recommendations — then confirm each fix actually worked. PostHog
captures the behavioral signals; a scheduled Claude routine interprets them against
Bernard's component tree and emits an `/audit`-style punch list. Closed loop.

## The honest model — a 5-stage loop

| Stage | Who | What |
|---|---|---|
| 1. Capture | PostHog (auto) | Every click, pageview, input, error, load time via autocapture |
| 2. Signal | PostHog (auto) | Rage clicks, dead clicks, funnel drop-offs, error-clicks, slow routes; **Alerts** fire on threshold breach |
| 3. Interpret + recommend | **Claude routine** | Pull signals via API → map selector/route → component → P0/P1/P2 fix list + chips |
| 4. Fix | Claude / Q | Ship the change |
| 5. Validate | PostHog (auto) | Did the targeted signal drop after deploy? |

Stages 1, 2, 5 are genuinely automatic. Stage 3 is the differentiated layer — PostHog
knows *where* it hurts; Claude knows *which component* and *how to fix it*.

## Locked decisions

- **Install:** PostHog via **Vercel Marketplace** (US Cloud) — unified billing, auto-injected env, Marketplace-first rule. Free tier (1M events + 5k recordings/mo) covers Bernard's volume at ~$0.
- **Recommendation layer:** **Hybrid** — native dashboards/replays for daily eyeballing + the scheduled Claude routine for the repo-aware punch list.
- **Replay:** on for marketing surfaces, **all inputs masked globally**, sensitive routes fully excluded. Draft-editing surfaces = replay-on with text masked.

## Existing state (grounded in the repo, 2026-06-16)

- `@vercel/analytics` already mounted at `src/App.jsx:858` — pageviews only. PostHog is a superset; may coexist (keep Vercel Speed Insights) but PostHog owns product analytics.
- **Identify/group hook point already exists:** `src/App.jsx:696-697` runs `setSentryUser(user?.id)` + `setSentryWorkspace(ws?.slug)` in `ProtectedApp`. PostHog `identify()` + `group()` mount in the *same two effects* — same Clerk user id, same workspace. No new plumbing.
- Existing `FeedbackWidget` (`src/components/FeedbackWidget.jsx`) — qualitative channel; PostHog Surveys optional, don't duplicate.
- Sentry observability stack already shipped (#1329). PostHog = behavioral/product layer; Sentry stays the exception/stack layer. Error-clicks cross-reference Sentry issues — no overlap.

## Phase 0 — Install + instrument  *(Sonnet, Medium)*

1. **Q installs** the PostHog Vercel Marketplace integration (account-level; see install click-path at bottom). Provisions the PostHog project + injects env vars.
2. **Reconcile env vars to `VITE_` prefix** (Vite only exposes `VITE_*` to the client). Mirror the injected values into `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST`.
3. **Add posthog-js** and init in a small `src/lib/posthog.js`:
   ```js
   posthog.init(import.meta.env.VITE_POSTHOG_KEY, {
     api_host: import.meta.env.VITE_POSTHOG_HOST,
     person_profiles: 'identified_only',   // cost control — no anon profiles
     autocapture: true,                     // breadth: heatmaps + rage/dead clicks
     capture_pageview: 'history_change',    // SPA virtual pageviews (React Router)
     session_recording: {
       maskAllInputs: true,
       maskTextSelector: '.ph-no-capture',
     },
   })
   ```
4. **identify + group** in the existing `ProtectedApp` effects (`src/App.jsx:696-697`):
   ```js
   useEffect(() => { if (user?.id) posthog.identify(user.id) }, [user?.id])
   useEffect(() => {
     if (ws?.id) posthog.group('workspace', ws.id, { slug: ws.slug, name: ws.app_name })
   }, [ws?.id])
   ```
   Group key = `ws.id` (immutable, per the blob-namespacing lesson — never key on the mutable slug); slug carried as a property for cross-reference with Sentry.

## Phase 1 — Replay gating + named events  *(Sonnet, Medium)*

- **`REPLAY_EXCLUDE` route gating:** on route change, `posthog.stopSessionRecording()` when entering a hard-exclude path, `startSessionRecording()` on safe paths. Add `.ph-no-capture` to transcript/draft-content containers.
- **Named events** for the 4 funnels (fire from the relevant success mutations / route mounts).

### Replay exclusion list (from the real route tree)

| Tier | Routes | Replay |
|---|---|---|
| **Hard-exclude** (transcripts / PHI-ish / secrets) | `/interview/:s/:i`, `/onboard/interview`, `/new/live-interview`, `/new/voice-memo`, `/capture/:s/:i/review`, `/settings/workspace*`, `/settings/integrations`, `/settings/workspace/billing`, `/account/*` | **Off** |
| **Mask-text, replay on** (generated-content drafts) | `/write`, `/synthesis`, `/stories/:id`, `/book` | On, text masked |
| **Full replay** (marketing surfaces — most pain lives here) | `/`, `/new`, `/stories`, `/library`, `/publish` + `/publish/:id*`, `/slate` + `/slate/clip/:id`, `/overview`, `/analytics`, `/review-inbox` | On, inputs masked |

### Funnels & events

| Funnel | Steps (route → event) | Catches |
|---|---|---|
| Capture → Story | `/new` → `capture_started` → `interview_completed` → `story_generated` | Core value-loop leaks |
| Story → Publish | `/stories/:id` → `piece_opened` → `publish_scheduled` → `published` | Whether stories ship |
| Slate review | `slate_opened` → `clip_edited` → `clip_approved` | Review-first Slate flow |
| Onboarding | `/onboard` → `onboard_interview_done` → `onboard_complete` | Self-serve activation |

## Phase 2 — Replay on + dashboards + alerts  *(Sonnet, Quick)*

- Turn on session replay (honoring the exclusion list).
- Frustration dashboard: rage clicks, dead clicks, error-clicks, slow routes — segmented by workspace group.
- **Alerts** on funnel-conversion drop and rage-click spikes → these are the event triggers for the Claude routine.

## Phase 3 — Claude recommendation routine  *(Opus, Large)*

Scheduled cloud routine (`/schedule`) — **alert-triggered + weekly digest**:

1. **Pull** via PostHog API / **HogQL**: top rage-click selectors, dead-click selectors, funnel drop steps, error-click pages, slowest routes — per workspace group.
2. **Map** selector/route → React component (e.g. `/publish/:id` → `StoryboardPiece.jsx`, `/slate` → `Slate.jsx`).
3. **Cross-reference Sentry** — error-click → its exception/stack.
4. **Emit** a prioritized P0/P1/P2 list to `.claude/audit-history/`-style output + **spawn one-click fix chips** (same mechanism as `/audit`).
5. **Validate** — after a fix deploys, confirm the targeted signal dropped.

### Signal → recommendation mapping

| Signal | Meaning | Recommendation |
|---|---|---|
| Rage clicks on X | Unresponsive / slow / confusing | Add loading state, fix handler, enlarge hit target |
| Dead clicks on X | Looks clickable, isn't | Make interactive, or restyle |
| Funnel drop at step N | Flow too hard/long | Simplify, cut fields, add guidance |
| Form field abandonment | Field intrusive/confusing | Make optional, help text, change input type |
| Error-clicks | JS error on interaction | Bug fix (link Sentry issue) |
| Slow route load | Perf | Code-split, lazy-load, optimize query |
| U-turns / back-nav | Wrong page / lost | IA / nav fix |

## Env vars (with sensitivity)

| Var | Tier | Where |
|---|---|---|
| `VITE_POSTHOG_KEY` (project write key) | **Mildly sensitive** — public by design (ships in client JS), write-only ingest | Vercel + client |
| `VITE_POSTHOG_HOST` | **Not sensitive** | Vercel + client |
| `POSTHOG_PERSONAL_API_KEY` (read key for routine) | **Sensitive** — read access to all project data; server-only (no `VITE_`); 1Password (Bernard vault) | Vercel server env + routine (Phase 3 only) |

## Optional hardening

- **Reverse proxy** PostHog through Bernard's domain (Vercel rewrite `/ingest/*` → PostHog) so ad-blockers don't drop events. Improves data completeness; not required for v1.

## Non-goals

- Not replacing Sentry (complementary).
- Not expanding the thin e2e smoke suite (Chrome-tab + this are the verification layers).
- Not auto-applying fixes — the routine recommends + chips; a human/Claude ships.

## Vercel Marketplace install click-path (Q's step)

**Where:** Vercel dashboard, signed in to the account that owns the `movebetter` team.

1. Open `https://vercel.com/marketplace/posthog`
2. Click **Install** (top-right).
3. Vercel scope → select the **`movebetter`** team.
4. Connect project → choose **`bernard`** (not "All projects").
5. **Create a new PostHog account** (or link existing), region **US**.
6. Plan → the **free** tier is fine (1M events + 5k recordings/mo).
7. Authorize. Vercel writes PostHog env vars into the `bernard` project (Production + Preview + Development).

After install, Claude reconciles the injected var names into `VITE_POSTHOG_KEY` / `VITE_POSTHOG_HOST` and begins Phase 0.
