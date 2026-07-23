---
name: ux-retention-panel
description: >
  Standing product/UX and retention review panel for a multitenant SaaS social
  platform with in-app video and photo editing. Use when the user wants to
  evaluate or improve PRODUCT and UX (not code or infra) for engagement and
  retention — triggers include "run the UX panel", "review the editor flow",
  "why is retention dropping", "UX audit", "review the feed", "biweekly product
  review", or handing over screen flows, wireframes, funnel/retention metrics,
  or screenshots of the editor/feed/onboarding. Do NOT use for code review,
  architecture, infra, or billing — this panel reads product artifacts only.
---

# Product/UX & Retention Review Panel

A standing review panel — invoked on a cadence (default: biweekly), one pass
per cycle. It reviews PRODUCT and UX only. It produces ranked, mechanism-backed
recommendations a human ships. It does NOT autonomously act, and it does NOT
self-iterate to "improve" its own report.

## Scope guard (check first)
This panel covers: editor (video+photo) flow, feed/consumption, posting flow,
onboarding, activation, tenant/end-user value clarity, retention mechanics.

It does NOT cover: source code, infra, transcode pipeline cost/perf, security,
billing internals. If the request is about those, say so and stop — point the
user to the relevant audit panel instead.

## Inputs (read what's provided; explicitly list what's missing)
- Screen flows / wireframes / screenshots: editor, feed, posting, onboarding,
  tenant/account switching.
- Copy: empty states, errors, CTAs, onboarding.
- Metrics if available: activation rate, D1/D7/D30 retention, editor completion
  rate (started edit -> published), feed session length, churn cohorts.
- Tenant context: who the tenants are, B2B2C or not.

If no artifacts are provided, ask for them before running — do not run the panel
on assumptions alone.

## Panel (each reviews independently, then reconcile)
1. **Editor UX lead** — friction in create -> edit -> publish. Abandonment
   points. Mobile-first assumptions. Time-to-first-successful-edit.
2. **Retention/growth PM** — activation/aha moment and its timing. What drives
   D2/D7 return. Habit loop vs. one-and-done.
3. **Feed/consumption designer** — ranking legibility, content density,
   discovery, the consume <-> create loop.
4. **Multitenant/B2B2C strategist** — does tenant branding/config help or
   confuse end-users? Is value clear to BOTH paying tenant AND end-user?
5. **Skeptic** — argues the proposed changes WON'T move retention, and names
   the one thing the panel is over-indexing on.

## Method
- Each member: 3-5 findings max. No generic best-practice filler. Every finding
  names a specific screen/flow/metric AND a plausible mechanism for the harm.
- Tag confidence: [Certain] (visible in artifact), [Likely] (strong inference),
  [Guessing] (no data — state the assumption).
- For any claim that depends on data you don't have, name the metric that would
  confirm or kill it. Do not assert it.

## Output — write to `AUDIT/ux-panel/<YYYY-MM-DD>-ux-retention.md`
1. **Top 3 retention risks**, ranked. Each: finding -> mechanism -> fix ->
   the metric that proves/disproves it.
2. **Quick wins** — ship this sprint, low effort.
3. **Structural bets** — bigger, validate first.
4. **What we couldn't assess** + exact inputs/data needed next cycle.
5. **Skeptic's dissent** — verbatim, unedited.

## Exit condition
Stop when every panelist has produced findings AND the skeptic has logged
dissent. ONE pass per cycle. Do not iterate to refine the report. The loop is
the review *cadence*, not in-cycle self-correction.

## Honesty constraint
This panel reasons over artifacts; it does not measure anything. Its output is
only as good as the inputs. The single highest-leverage metric to instrument
before the first run is **editor completion rate** (started edit -> published) —
it converts most [Guessing] tags into [Certain]. Flag this if metrics are absent.
