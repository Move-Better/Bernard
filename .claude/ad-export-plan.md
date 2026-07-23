# Ad-creative export — phased build plan

**Goal:** turn already-edited Bernard media (photos, carousels, video clips) into
ad-ready creative — every ad size, a healthcare-policy guardrail, organized by
campaign — so it can be downloaded and dropped into Meta Ads Manager / Google Ads /
paid social. Bernard is the *creative production* tool; targeting/budget/launch stay
in the ad platforms (no ad-platform API push — deliberately out of scope; see
"Explicitly out of scope").

Entry points (Q's decision): **both** a Library/Slate "Export for ads" action (the
on-ramp) **and** a dedicated **Ads** surface (the destination), sharing one export
modal. Creative is **grouped by campaign**. Guardrail is a **self-attest checkbox**.

Mockups: `.claude/mockups/ad-export.html` (v1 — per-piece), `.claude/mockups/ad-export-v2.html`
(v2 — Library action + Ads surface + campaign tag). v2 is the approved shape.

---

## Ad sizes (the whole matrix)

| Aspect | Px | Where it's used |
|---|---|---|
| 1:1 | 1080×1080 | Meta feed, LinkedIn feed |
| 4:5 | 1080×1350 | Meta feed (max real estate) |
| 9:16 | 1080×1920 | IG/FB Stories & Reels, TikTok, YouTube Shorts |
| 16:9 | 1920×1080 | YouTube in-stream, Google Display |

**Google LSAs need no creative** (assembled from Google Business Profile) — nothing to export there.

---

## Reuse map (what already exists, grounded in source)

- **Photo renderer primitives** — `renderEditorialPhoto(workspace, sourceUrl, treatment)`
  in `api/_lib/brandRender.js` and `renderWhoopPhoto(...)` in `api/_lib/whoopTemplates.js`
  return a JPEG buffer; smart-crop + contrast-aware text. Aspect→px maps live at
  `brandRender.js:287` (`EDITORIAL_ASPECTS`) and `whoopTemplates.js:27` (`WHOOP_ASPECTS`),
  today only `4:5 / 9:16 / 1:1`.
- **Video renderer** — `renderVideoChannel({videoUrl, channel, ...})` in
  `api/_lib/brandRenderVideo.js`; `VIDEO_CHANNEL_SPECS` already defines per-aspect
  specs (1:1, 4:5, 9:16, 16:9). ffmpeg: scale+crop → brand overlay → burn subs → H.264.
- **Download mechanics** — `downloadFromUrl()` in `src/components/MediaDetail.jsx:411`
  (anchor + `download`); Vercel Blob URLs are public + CORS-enabled, so direct
  browser download works with no proxy.
- **Campaigns** — real `campaigns` table + `api/campaigns/list.js`. No reverse link
  from a content piece / asset → campaign exists yet (that's the only net-new data model).
- **Nav** — `NAV_SECTIONS` in `src/components/Layout.jsx:35`; Produce group =
  Stories / Slate / Publish / Review Inbox. New **Ads** item slots in after Publish.
- **Routing** — everything authed flows through the `*` catch-all →
  `ProtectedAppWithProvider` descendant `<Routes>` (App.jsx). `/ads` is a descendant
  route; **do not** add an outer exemption.

---

## Phase table

| Phase | Scope | Net-new data model? | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **1 · Photo export (MVP)** | Shared export modal + Library "Export for ads" button. Photos only, 4 sizes, self-attest guardrail, download. | No | 2–3d | $6–12 (Sonnet) |
| **2 · Video export** | "Export for ads" on Slate clips / video assets. On-demand per-size ffmpeg re-encode (9:16 native + 1:1 default, 16:9 opt-in). | No | 2–3d | $8–14 (Sonnet; Opus for ffmpeg edge cases) |
| **3 · Ads surface + campaign grouping** | New `/ads` page grouped by campaign; `ad_creatives` table; modal "save to campaign". | **Yes** (`ad_creatives`) | 3–4d | $10–18 (Sonnet) |
| **4 · Multi-size carousels** | Refactor slide renderer off the hard-wired 1080² so carousels export at all aspects. | No | 2–3d | $6–12 (Sonnet) |

Each phase is independently shippable behind its own PR. Phase 1 alone is the full
"Option 2" value (make creative → download). Phases stack; none blocks daily use.

---

## Phase 1 — Photo export (MVP)

**Outcome:** from a Library photo (or any baked piece), click "Export for ads" →
modal → pick sizes → check the policy box → download the rendered set.

**New files**
- `src/lib/adFormats.js` — aspect → `{px, label, platforms}` map (the size matrix above).
- `src/lib/download.js` — extract `downloadFromUrl` from MediaDetail into a shared util
  (+ `downloadMany` sequential helper).
- `src/components/AdExportModal.jsx` — the shared modal: size checkboxes, live previews,
  healthcare guardrail + self-attest checkbox gating download, "Copy caption", "Download
  pack". Uses `useAppMutation` + `apiFetch` (lint rules `no-raw-use-mutation`,
  `no-raw-api-fetch`).
- `api/ads/render-pack.js` — **Node handler** `(req,res)`. Body
  `{ sourceUrl, treatment, templateId, aspects:[...] }`. Loops the requested aspects,
  calls `renderEditorialPhoto` / `renderWhoopPhoto` per aspect, uploads each to
  `media/ads/<ws.id>/<uuid>-<aspect>.jpg`, returns `[{aspect,url,width,height}]`.
  `workspaceContext(req)` + `requireRole(EDITOR_ROLES)` + `enforceLimit(req,res,'ai')`.
  **Does NOT mutate `content_items`** — ad export is read-only against the source asset
  (key difference from `compose-photo`, which writes back to a piece). 4 renders ≈ 8s,
  well under the 300s budget. Respond with `res.status(200).json(...)` — never
  `new Response` (api-handler-shape rule).

**Edits**
- `api/_lib/brandRender.js:287` — add `'16:9': [1920, 1080]` to `EDITORIAL_ASPECTS`.
- `api/_lib/whoopTemplates.js:27` — add `'16:9': [1920, 1080]` to `WHOOP_ASPECTS`.
- `src/components/MediaDetail.jsx` — add an "Export for ads" button beside the existing
  Download; opens `AdExportModal` seeded with the asset URL + any `photo_treatment`.
  Refactor its local `downloadFromUrl` to import from `src/lib/download.js`.

**Decision needed:** zip vs. sequential downloads. Sequential anchor downloads = zero
deps (recommended for P1). A true `.zip` needs JSZip (client) or `archiver` (server) —
adds a dependency installed at the project root (breaks worktrees until root
`npm install`); defer unless you want one-click zip now.

**Guardrail:** pure client. Reminder copy (no before/after; no personal-attribute
language; restricted health targeting) + a checkbox that gates the download button.
No backend, never blocks — informational self-attestation.

**Verification:** renderer is pure transform → node harness renders all 4 aspects to
`/tmp/*.jpg`, read them to eyeball crop/text per the project's local-render rule. Then
post-deploy, drive Q's Chrome on prod to confirm the Library button + modal + download.

**Definition of Done:** typecheck/lint/build green; `verify-bundles` passes (new handler
loads); modal uses `useAppMutation`/`apiFetch`; handler is `workspaceContext`-scoped;
no `text-[..px]` / hardcoded brand hex.

---

## Phase 2 — Video export

**Outcome:** "Export for ads" on a Slate clip or video asset → render the sizes that
matter, one at a time, with progress; download each.

**New files**
- `api/ads/render-video.js` — Node handler. Body `{ videoUrl, aspect, captionText, ... }`.
  Maps aspect → `VIDEO_CHANNEL_SPECS` entry, calls `renderVideoChannel`, streams the
  download to disk (`pipeline(Readable.fromWeb(...), createWriteStream(...))` — the
  large-file rule; never `arrayBuffer()`), uploads MP4 to `media/ads/<ws.id>/...`,
  returns `{aspect,url}`. **One aspect per call** (each is a full ffmpeg encode; 4-in-one
  risks the 300s wall). 9:16 reuses the already-rendered clip when present (instant).

**Edits**
- `AdExportModal.jsx` — video mode: render-on-demand per size with a progress state;
  9:16 + 1:1 selected by default, 16:9 opt-in. If made async, any status polling gets a
  **time-based hard cap** (no infinite poll — project rule).
- Slate clip output + `MediaDetail.jsx` (video assets) — add the "Export for ads" entry.

**Verification:** node harness renders each aspect to `/tmp/*.mp4`, spot-check frames
with ffmpeg; exercise the cold-start path (fontconfig/native dep) before declaring done.

---

## Phase 3 — Ads surface + campaign grouping

**Outcome:** `/ads` page listing exported creative grouped by campaign; the modal can
"save to campaign"; re-download anytime.

**Migration** — `supabase/multitenant/migrations/NNN_ad_creatives.sql`:
```sql
CREATE TABLE public.ad_creatives (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  workspace_id uuid NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  campaign_id  uuid REFERENCES public.campaigns(id) ON DELETE SET NULL,  -- null = ungrouped; SET NULL so deleting a campaign never destroys creative
  source_asset_id uuid,            -- media_assets.id (nullable)
  source_piece_id uuid,            -- content_items.id (nullable)
  media_type   text NOT NULL DEFAULT 'photo',  -- 'photo' | 'video'
  treatment    jsonb,              -- the render spec, for re-render
  sizes        jsonb NOT NULL,     -- [{aspect,url,width,height}]
  caption      text,
  created_by   text,
  created_at   timestamptz NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.ad_creatives TO service_role;
GRANT USAGE ON ALL SEQUENCES IN SCHEMA public TO service_role;
CREATE INDEX ad_creatives_ws_campaign_idx ON public.ad_creatives (workspace_id, campaign_id);
```
Apply via `node scripts/apply-multitenant-migrations.mjs` (or paste into Studio) BEFORE
merging code that reads it. `campaign_id` uses `ON DELETE SET NULL` so a campaign delete
never cascade-destroys ad creative (cf. the staff-cascade lesson).

**New files**
- `api/ads/list.js` — returns `ad_creatives` for the workspace, joined to campaigns,
  grouped client-side. `workspaceContext` + `workspace_id` filter.
- `api/ads/upsert.js`, `api/ads/delete.js` — save / remove a pack. Workspace-scoped.
- `src/pages/Ads.jsx` — the surface: per-campaign sections of creative cards + "New ad
  creative" (opens the picker → modal). Reuses `api/campaigns/list` for the dropdown.

**Edits**
- `src/components/Layout.jsx:51` — add `{ to:'/ads', label:'Ads', icon: Megaphone, ... }`
  to the Produce group (after Publish).
- `src/App.jsx` ProtectedAppWithProvider descendant `<Routes>` — add `/ads` (no outer
  exemption; respect the catch-all convention).
- `AdExportModal.jsx` — add the campaign `<select>` + "save to campaign" (writes an
  `ad_creatives` row on download).
- If any E2E-covered label/route changes, update specs in the same PR.

---

## Phase 4 — Multi-size carousels (later)

Carousel slides render in a **client-side canvas hard-wired to 1080²**
(`SIZE` in `src/lib/overlayTemplates.js`, `renderFreeformSlide`). Multi-size carousels
need: parameterize `renderFreeformSlide` with width/height, adapt text/vignette layout
for non-square aspects, loop per aspect in `src/lib/renderSlides.js`. Until then, **v1
carousels export at 1:1 only** (a valid ad format). Client-canvas only → verify
post-deploy in Chrome (can't node-harness `document`/`window`).

---

## Explicitly out of scope (buy-before-build)

- **Direct Meta Marketing API / Google Ads API push.** Heavy (per-tenant OAuth, ad-account
  linking, creative upload) and you still finish the ad in their manager. Saves one
  file-upload; costs weeks + an ongoing maintenance surface. The ad platforms are the
  tool for targeting/budget/launch.
- **Active policy scanning** (auto-detecting before/after or personal-attribute language).
  Possible later; v1 is self-attest.
- **Google LSAs** — no creative to export.

---

## Cross-cutting conventions to honor

- API handlers: Node `(req,res)`, `res.json`, never `new Response`; `workspaceContext` +
  `workspace_id` filter on every tenant-scoped query; validate UUIDs before PostgREST
  interpolation.
- Client: `useAppMutation` (not raw `useMutation`); `apiFetch`/`apiFetchResponse` (not raw
  `fetch`), set `Content-Type: application/json` on POSTs the Node handler must parse;
  no `text-[..px]` (use `text-2xs`/`text-3xs`); no hardcoded brand hex (use tokens —
  `--action` amber for the ad CTAs, `--primary` Blue Spruce for brand).
- Blob paths namespaced by `ws.id` (immutable), not slug.
- Migrations self-sufficient with `GRANT … TO service_role`; apply to prod before merge.
- `verify-bundles` must pass (every new `api/**` handler loads at import).
- Each phase: one PR, rebased on `origin/main`, `gh pr merge --auto --squash`.
