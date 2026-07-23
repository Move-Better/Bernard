# Bernard — Development Roadmap
_Created 2026-05-13. Updated 2026-05-14 — Phases 1–3 + Billing complete._

## North Star
The only end-to-end staff storytelling → clinical content pipeline. Not a general content tool. Not a research tool. The specific intersection of structured prompted capture + voice-faithful AI drafting + vertical context depth — for healthcare and professional clinical settings.

## Competitive Advantages to Defend
1. **Cross-staff contrasting-opinion mechanic** — real-time, mid-interview. No competitor does this.
2. **Practice vs. personal voice distinction** — no competitor makes this separation.
3. **End-to-end pipeline** in one login — topic → interview → content → GBP/Instagram.
4. **Diff view (AI draft vs. human edit)** — ahead of every comparable (PR #360).
5. **Vertical context depth** — patient archetypes, condition banks, workspace JSONB config.

## What NOT to Build
| Thing | Reason |
|-------|--------|
| Scheduling/analytics infrastructure | Buffer Analyze does this. Building it is 6 months to land behind an established product. |
| AI avatar or talking face | Outset's own research: 69% prefer no avatar. Bernard persona is correct. |
| Patient testimonial capture | Different consent workflow, different positioning, different sales motion. |
| Native mobile app | High cost, low early leverage. Responsive web for now; revisit at 50+ tenants. |
| Compete on interview engine depth vs. Outset | They have $30M Series B. The moat is the pipeline + vertical, not the interview engine alone. |
| General-purpose content tool features | Every step toward general-purpose is a step away from the defensible vertical position. |

---

## Phase 1 — Revenue Foundation ✅ COMPLETE (2026-05-14)

### IA Refactor (PRs #370–376)
- ✅ 2-item nav (Home / Stories) + Library + Settings as header icons
- ✅ Home = task queue (Ready for content / Awaiting review / Hasn't interviewed in a while) + right rail
- ✅ Stories = unified surface with Cards / Pipeline / Calendar / Themes view toggles
- ✅ Story Detail = consolidated transcript + every derived asset + ask-Bernard panel
- ✅ All legacy routes redirect cleanly; lint ratchet lowered 79 → 60

### Content Approval Workflow (PR #377)
- ✅ Role-split: staff submit for review, admin/editor approve or request changes
- ✅ Two-click approve, one-click reject with inline comment thread
- ✅ Approved posts route to Buffer queue
- ✅ Audit trail: approved_by + approved_at on every piece
- ✅ `content_item_comments` table with kind: comment | change_request
- ✅ `workspaces.skip_review` escape hatch for single-user workspaces

### UX Improvements (PRs #369, #374)
- ✅ Smart defaults on New Interview (zero-config path)
- ✅ Mic check gate before session starts
- ✅ Completion card + slide output panel at INTERVIEW_COMPLETE
- ✅ "+ New Interview" CTA persistent across all pages

### Interview Pause/Resume (PR #378)
- ✅ Session state persisted to `interviews.session_state` JSONB
- ✅ Auto-save on message change (debounced 3s)
- ✅ sendBeacon on tab hide/close for zero-loss saves
- ✅ "Pause & save" button navigates to Home
- ✅ ResumeStrip on Home shows genuinely paused sessions

**Success metric:** First external tenant pays and completes ≥2 interviews in 30 days.

---

## Phase 2 — The Clinical Moat ✅ COMPLETE (2026-05-14)

### Transcript Highlight → Route-to-Format (PR #380)
- ✅ Select any transcript text → floating popover → Social / GBP / Verbatim Quote
- ✅ Creates new content_item draft instantly; AssetsPane refreshes

### Transcript Export (PR #379)
- ✅ PDF export via browser print (no library dependency)
- ✅ TXT download via Blob API
- ✅ Disabled with tooltip when transcript not yet available

### Cross-Staff Synthesis — Themes view (PR #381)
- ✅ 4th toggle on Stories page (Cards · Pipeline · Calendar · Themes)
- ✅ Groups stories by shared topic across clinicians
- ✅ Contrasting perspectives row per theme
- ✅ Stage-distribution dots; "Build content from this theme →" CTA

### Geo-Local Topic Intelligence (PR #382)
- ✅ AI-generated patient questions per workspace specialty (Claude API)
- ✅ 7-day server-side cache in `workspaces.ai_topics_cache`
- ✅ Clickable chips navigate to `/new?topic=…`
- ✅ Refresh button busts server cache

### Media Library Redesign (PR #383)
- ✅ Visual grid (Apple Photos / Figma feel) — 5-column responsive
- ✅ Hover overlay with asset name + quick actions
- ✅ Clinician initial badge (bottom-left per cell)
- ✅ Filter chips: Type / Clinician / Purpose (URL-persisted)
- ✅ Bulk selection bar with download + delete

**Success metric:** External tenants publish ≥4 pieces/month; admin retention at 60 days ≥70%.

---

## 60-Day Validation Gate
Before committing further investment, answer with real data:
1. Do external tenants complete ≥2 interviews in the first 30 days?
2. Do they publish content from those interviews?
3. Do they renew after month 1?

If no to any of these, something earlier in the funnel is the problem — not missing features.

---

## Phase 3 — Retention & Expansion ✅ COMPLETE (2026-05-14)

### Buffer Analyze Integration (PR #384)
- ✅ `/api/buffer-analytics` fetches per-item metrics from Buffer API
- ✅ `buffer_metrics` JSONB cached on content_items (30-min TTL)
- ✅ BufferMetricsRow shows Reach / Engagement / Clicks inline on Story Detail
- ✅ Refresh button per piece

### Performance → Topic Feedback Loop (PR #385)
- ✅ `/api/topic-suggestions` enriched with top-performing posts as Claude context
- ✅ "What's working" card in Home right rail (top 3 by reach)
- ✅ New workspaces with zero metrics fall back to generic prompt

### Self-Serve Onboarding + 14-Day Trial (PR #386)
- ✅ Trial columns on workspaces: `trial_started_at`, `trial_ends_at` (14 days), `onboarding_steps_done`, `plan`
- ✅ 4-step activation checklist (complete profile → interview → generate post → publish)
- ✅ `/api/onboarding/progress` auto-detects completion from real DB state
- ✅ TrialBanner: X days remaining, amber when ≤3 days, dismissible per session
- ✅ In-context empty state coaching on Stories page for new workspaces

### Multi-Location Support (PR #388)
- ✅ `/api/db/locations` endpoint — workspace-scoped location list
- ✅ Location filter chips on Stories (URL-persisted `?location=`)
- ✅ Per-location theme grouping in Themes view
- ✅ Admin Locations overview card in Home right rail (2+ locations)

**Success metric:** Net Revenue Retention ≥100% (expansion revenue offsets churn).

---

## Billing ✅ COMPLETE (2026-05-14) — PR #391

### Stripe Integration
- ✅ 3 tiers: Solo $149/mo (1–3 staff), Practice $299/mo (4–10), Multi-location $499/mo
- ✅ Self-serve checkout via Stripe hosted checkout (`/api/billing/checkout`)
- ✅ Stripe Billing Portal for plan changes, card updates, cancellation (`/api/billing/portal`)
- ✅ Webhook handler with HMAC-SHA256 verification (`/api/billing/webhook`)
- ✅ PricingCards component in WorkspaceSettings Billing section
- ✅ UsageGate component — soft upsell nudge for plan-gated features
- ✅ Themes view gated at Practice plan
- ✅ `billing=success` toast on return from Stripe checkout
- ✅ TrialBanner "Upgrade now" links to billing section

### Env vars to configure in Vercel dashboard (not yet set)
| Var | Sensitivity |
|-----|-------------|
| `STRIPE_SECRET_KEY` | **Sensitive** |
| `STRIPE_WEBHOOK_SECRET` | **Sensitive** |
| `STRIPE_PRICE_SOLO` | Not sensitive |
| `STRIPE_PRICE_PRACTICE` | Not sensitive |
| `STRIPE_PRICE_MULTI` | Not sensitive |

### Stripe webhook to register
URL: `https://withbernard.ai/api/billing/webhook`
Events: `checkout.session.completed`, `customer.subscription.updated`, `customer.subscription.deleted`

---

## Exemplar Feedback Loop ✅ SHIPPED (parallel to Phase 3)
Not in the original May 13 plan but landed alongside Phase 3. A second engagement path that feeds the regenerate prompt rather than the topic-suggestion prompt.

### Tier 1 — Manual exemplar flag (PR #274)
- ✅ `content_items.performed_well` boolean (migration 020)
- ✅ Thumbs-up affordance on published items in ContentHub / Story Detail
- ✅ `fetchTopExemplars` + `getExemplarsBlock` inject flagged rows into ReviewPost regenerate context (PR #281)

### Tier 2 — Buffer-source auto-flagging (PRs #282, #283)
- ✅ `engagement_snapshots` table (migration 021) — point-in-time stats history, source-pluggable
- ✅ Manual refresh button + `/api/engagement/refresh` (#282)
- ✅ Daily `/api/cron/refresh-engagement` (#283) — walks recent Buffer-published items, writes snapshots, auto-flips `performed_well` against a workspace+platform median × 2 with a 5-sample gate

### Tier 3 — GA4 source for website-published content (PR #291)
- ✅ `content_items.resolved_url` + `workspaces.ga4_property_id` (migration 022)
- ✅ `workspace_credentials.service='ga4'` carries the service-account JSON
- ✅ `api/_lib/ga4.js` — dependency-free GA4 Data API client (self-signed JWT → `runReport`)
- ✅ Cron extended with parallel GA4 walker; separate pageviews-only median + 50-pageview absolute floor

---

## Open technical loose end — Engagement-systems reconciliation
Two engagement-data paths shipped in parallel and haven't been unified:

| Path | Storage | Surfaces | Use |
|---|---|---|---|
| **Exemplar loop** (Tiers 1/2/3) | `engagement_snapshots` + `content_items.performed_well` | (orphaned) `ReviewPost.EngagementPanel` — `ReviewPost` was retired by the IA refactor (#373) | Auto-flagging exemplars for the **regenerate** prompt |
| **Buffer Analyze** (#384) | `content_items.buffer_metrics` + `buffer_metrics_fetched_at` (denormalized cache) | `BufferMetricsRow` on `StoryDetail` (current canonical UI) | Inline performance + input to **topic-suggestion** feedback (#385) |

The Phase 3 topic-feedback loop reads `buffer_metrics`, not `performed_well`. The GA4 snapshots (Tier 3) write to `engagement_snapshots` but nothing live currently reads from there — so website-published content doesn't participate in "What's working" yet.

**Reconciliation work (probably one PR, not urgent):**
1. Decide canonical store. Likely `engagement_snapshots` — source-pluggable, multi-row historical, already carries GA4.
2. Either migrate `BufferMetricsRow` to read from `engagement_snapshots`, or keep `buffer_metrics` as a denormalized cache fed by the snapshot writer.
3. Have the topic-suggestion enrichment (#385) draw from the same store the exemplar auto-flag does — so the two halves of the loop reinforce each other instead of using divergent signals.
4. Wire GA4 snapshots into the topic-feedback loop so website-published content participates in "What's working."
5. Either delete the orphan `ReviewPost.EngagementPanel` or remount its GA4-aware version inside `AssetsPane` on `StoryDetail`.

---

## Pricing
| Tier | Price | Who |
|------|-------|-----|
| Solo | $149/mo | 1–3 staff, single location |
| Practice | $299/mo | 4–10 staff, approval workflow + cross-staff synthesis + multi-location |
| Multi-location | $499/mo | Unlimited staff, aggregate dashboard |

Outset/Listen Labs are at $3K+/mo for enterprise. Bernard isn't competing there yet — but the pricing architecture leaves room to move up.

---

## What's Next
The full roadmap is shipped. Priorities from here:

1. **Configure Stripe** — set the 5 env vars + register webhook to make billing live
2. **First paid tenant** — target a real external practice, walk them through onboarding, validate the 30-day interview completion metric
3. **60-day validation gate** — before building anything new, answer the three retention questions above with real data
4. **Engagement-systems reconciliation** — the one remaining technical debt item (see section above). Not urgent — both paths work standalone — but worth doing before more work lands on top of either store.
5. **Revisit roadmap** — based on what the data says, either double down on retention (onboarding refinements, Bernard coaching) or expansion (more locations, more clinicians per workspace)
