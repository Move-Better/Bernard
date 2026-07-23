# Campaign location aim + GBP cross-promo — build spec (A1, A2)

Status: **design locked 2026-06-04, awaiting build session.** PR #1215 (B+C cleanup) shipped first.

## Origin / problem

"Location" was doing two conflated jobs:
- **Real GBP publish-routing** — `workspace_locations.gbp_location_id` → per-listing Buffer channel; `api/publish/buffer.js` fans out one post per location. KEEP.
- **A low-value per-piece tag** — `interviews.location_id` / `content_items.location_id`. All 25 interviews + 42 content_items in prod were `null`; the interview-time picker was buried and unused. RETIRED in PR #1215 (B), and the all-zeros Home "Locations" card removed (C).

The genuine need — "we opened a new clinic, direct people there" — is a **campaign aim**, not a per-piece attribute. That's A1/A2.

## Q's product decisions (locked)

1. Per-location only makes structural sense for platforms that actually have locations → **GBP**. Single IG/FB/email accounts aren't geo-split.
2. Location doesn't belong at interview time. It belongs on the **campaign**.
3. **Non-GBP channels** (IG, FB, blog, email, YouTube): no special logic — the campaign just steers messaging like any promotional campaign. One unified brand-wide promo.
4. **GBP**: location-based assets should **cross-promote other locations**. When launching Vancouver:
   - Vancouver's own listing → "we're here / come in" primary copy.
   - Every other listing (Portland, …) → "our new sister clinic in Vancouver" cross-promo, with Vancouver's link **inline** (we send text+image only, no structured CTA button — see buffer.js:256-264).
   - Bounded by the **campaign window** (keeps Google's relevance policy happy; other listings revert to local-only content after the window).

## Existing wiring to build on

- Campaigns are LIVE and inject a "CAMPAIGN FOCUS" block into atom prompts: `api/_lib/tentpoleCampaignContext.js:74-165`; selected by `loadCurrentTentpole()` (:62-72); called from `api/content-plan/draft.js:120-130`.
- Campaign editor UI fully built: `src/pages/settings/CampaignsSettings.jsx` (has staff picker, CTA fields, content_style, time window). Cap gate `CAP_CAMPAIGNS_EDIT` (producers).
- Campaign schema: `045_campaigns.sql` + `095_campaigns_multi.sql` (start_at/end_at/event_at, content_style, cta_*). **No location field yet.**
- Location overlay into prompts: `src/lib/locationOverlay.js` (location/keyword/hashtag/region).
- GBP per-location variant generation: `api/content-plan/draft.js:260-321` writes `content_items.location_overrides` (JSONB keyed by `workspace_locations.id`), consumed at publish by `api/publish/buffer.js:253`.
- GBP fan-out + per-location body override: `api/publish/buffer.js:245-291`; `resolveGbpChannelIds()` :57-76.

## A1 — campaign location aim (all channels)  ~1d, Sonnet Medium

- Migration: `ALTER TABLE campaigns ADD COLUMN target_location_id uuid REFERENCES workspace_locations(id) ON DELETE SET NULL;` (+ service_role grant already covers existing table; verify). Bundle grant per project convention.
- Campaign editor: add a "Promote location" dropdown (options = active `workspace_locations` + "None"). Small addition to existing form — no mockup needed; react on preview.
- Campaign upsert API (`api/campaigns/upsert.js`) + list (`api/campaigns/list.js`): accept/return `target_location_id`.
- Prompt injection: when a campaign has `target_location_id`, overlay that location's keyword/hashtag/visit_url into the campaign focus block (reuse `locationOverlay.js`) so ALL channels lean toward the target location's CTA. This is the broad-but-cheap part.

## A2 — GBP cross-promo split  ~1–1.5d, Sonnet Large (the novel part)

- The GBP override generator (`draft.js:260-321`) becomes **campaign-aware** with a subject-vs-publishing-location split:
  - **publishing location** = the listing the post goes to (the loop var today).
  - **subject location** = `campaign.target_location_id`.
  - When a campaign targets a location and is within window:
    - publishing == subject → primary "we're here" copy.
    - publishing != subject → cross-promo "new sister clinic in {subject.city}" copy, carrying subject's keyword/hashtag/visit_url (inline link).
  - Outside any location-targeted campaign window → today's behavior (each listing = its own local copy).
- No change needed to `buffer.js` fan-out itself — it already sends per-location `location_overrides`. Just the generation content changes.

### Open consideration for A2
- We send GBP as plain text+image (no structured CTA button). Inline URL is fine for launch. If a real "Learn more" button is ever wanted, first verify Buffer's GBP integration exposes a CTA field (publisher-ceiling rule) — out of scope for now.

## Process notes
- A1 dropdown is a single field on a built form → no mockup-first round required.
- Ship A1 and A2 as separate PRs; A1 is independently useful before A2 exists.
