# Bernard content pipeline audit — interview → published post

Read-only map of the current flow, written to drive a **one unified editor screen** redesign.
Owner's goal: collapse *edit words → choose media → compose → publish/export* into ONE screen where you
"attach media to the words, modify everything (text size/color/font, add/swap photos, the colorist
look) to make it look right, then click a button to publish or export for ads."

All paths are absolute under the worktree
`/Users/qbook/Claude Projects/Bernard/.claude/worktrees/determined-gates-87505e`.

---

## 0. TL;DR (the two questions that gate the build)

1. **Is text size/color/font a renderer change or just UI?** → **Mostly UI, not a renderer change.**
   The canvas renderer `drawFreeformBlock` (`src/lib/overlayTemplates.js:590`) already reads
   `fontSize / fontWeight / color / uppercase / shadow / background / bgColor` **per block role** —
   but those values come from the **theme** (`theme.blocks[role]`, `src/lib/photoTemplates.js:61`), not
   from the text block itself. The only *per-block* override that exists today is `block.width`
   (wrap width, `overlayTemplates.js:650`). So per-block size/color/weight is a **small data + plumbing
   change** (add optional `block.fontSize/color/...` to the slide-block shape; have `roleTypography`
   prefer the block override over the theme value) — the drawing code, the font px map
   (`FONT_SIZE_PX`, `photoTemplates.js:22`), and the weight map are already there. **Font *family*** is
   the one genuinely-limited axis: it's hard-locked to `brandStyle.heading_font` / `body_font`
   (`overlayTemplates.js:23` `brandFonts`), chosen by role (hook/cta=heading, else body). Per-block font
   *picking* would need a font registry + `@font-face` loading that doesn't exist yet — bigger lift.

2. **Is media-add reusable from the choose-media screen?** → **Yes, almost entirely.** Everything the
   unified editor needs already exists as self-contained pieces on `StoryboardPiece.jsx`
   (`/publish/:pieceId`): `<MediaPicker multi>` (`src/components/MediaPicker.jsx`, Library + Upload tabs),
   the AI suggestions grid (`useMediaSuggestions` → `CandidateCard`), the "describe the shot" free-text
   search (`/api/content-items/suggest-media`), and `<TextPostStudio>`. Attach/remove/swap are three
   tiny mutations over `media_urls` via `useUpdateContentItem` (`StoryboardPiece.jsx:294-337`). The
   **photo-bind** the SlideEditor already does (`PhotoInspector`, `SlideEditor.jsx:533`) only re-points a
   slide at an *already-attached* `media_urls` index — it cannot *add* media. So the unified screen =
   SlideEditor shell + lift the StoryboardPiece media panel into it.

---

## 1. Screen graph (interview → live post)

```
                 ┌─────────────────────────────────────────────────────────────────────────────┐
                 │  PipelineStepper spine (presentational only):                                 │
                 │  Interview → Words → Media → Publish   (src/components/PipelineStepper.jsx)    │
                 └─────────────────────────────────────────────────────────────────────────────┘

  /interview/:staffId/:interviewId          InterviewSession.jsx
        │  (conversational capture → on wrap, server generates content_items from the interview)
        │  "View output" / auto-redirect
        ▼
  /stories                                  Stories.jsx        ── list of interviews (stories)
        │  click a story card
        ▼
  /stories/:storyId   (storyId = INTERVIEW uuid)   StoryDetail.jsx  ─────────► "EDIT WORDS" lives HERE
        │   Layout: TranscriptPane | AssetsPane (Plan)  /  rail | AssetsPane (Edit)
        │   AssetsPane.ContentEditor  = the words textarea (per content_item / "piece")
        │   ?piece=<contentItemId>  deep-links straight into Edit mode for one piece
        │
        │   Handoffs OUT of AssetsPane:
        │     • ContentEditor footer link  "Open in Publish →"  →  /publish/:pieceId   (AssetsPane.jsx:423)
        │     • ApprovalPanel mode="workflow": send-for-review / approve / request-changes (no publish here)
        ▼
  /publish                                  Storyboard.jsx (component name kept; route renamed)
        │   The QUEUE. Two sections:
        │     - "Draft" (NEEDS_MEDIA: media_urls empty)  card → /publish/:pieceId
        │     - "Ready to distribute" (has media)        card → /publish/:pieceId/schedule
        ▼
  /publish/:pieceId          StoryboardPiece.jsx ──────────────────────────►  CHOOSE MEDIA  (+ photo compositor)
        │   Left: post preview (platform header + media area + caption strip).
        │   Right: "Change the look" AI chat, "Adjust by hand", Media panel (attached + AI picks +
        │          MediaPicker swap + "describe the shot" + TextPostStudio), per-post schedule CTA.
        │   Single-photo compositor (treatment → /api/editorial/compose-photo, baked into media_urls).
        │
        │   Handoffs:
        │     • "Edit words"            → /stories/:interview_id?piece=:id
        │     • "Continue to publish"   → /publish/:pieceId/schedule   (disabled until hasMedia)
        │     • "Schedule this post"    → /publish/:pieceId/schedule
        │     • "Next draft (N left)"   → /publish/:nextPieceId
        ▼
  /publish/:pieceId/schedule  StoryboardPublish.jsx ───────────────────────►  COMPOSE + PUBLISH
        │   Branches on format (mediaEntry.postFormat / isInstagramReel):
        │   ── isCarousel (IG, no video) → FULL-BLEED  <SlideEditor>  (the editor) + Schedule modal
        │   ── all other formats         → two-column: <PostPreview> (left) | <ApprovalPanel mode="publish"> (right)
        │
        │   Handoffs:
        │     • "Back to media"  → /publish/:pieceId
        │     • "Edit words"     → /stories/:interview_id?piece=:id
        │     • SlideEditor top bar: Preview · Ads (AdCarouselExportModal) · Save · Schedule(modal)
        │     • ApprovalPanel: schedule / add-to-Buffer-queue / publish-now / export(copy+download)
        ▼
  LIVE POST  (Buffer/bundle.social dispatch via publishPieceToBuffer, or blog webhook, or export-copy)
```

Legacy redirects feeding this graph (`src/App.jsx`): `/storyboard/:pieceId`→`/publish/:pieceId`,
`/storyboard/:pieceId/publish`→`/publish/:pieceId/schedule`, `/needs-media`→`/publish`,
`/output/:staffId/:interviewId`→`/stories/:interviewId`, `/review/:itemId`→`/stories/:itemId`
(`App.jsx:547-554, 599-601, 626-629`).

**Two entities, easy to confuse:**
- `storyId` in `/stories/:storyId` = **interview** uuid (the story = interview + all its pieces).
- `pieceId` in `/publish/:pieceId` = **content_item** uuid (one platform draft).
- "Edit words" round-trips piece→interview: `/stories/:interview_id?piece=:pieceId`.

---

## 2. Data model hops

### Interview → content_items
The interview (`interviews` row, conversational transcript) is turned into one or more
`content_items` rows server-side at interview wrap / generation (atoms per channel). The browser never
sees that conversion in the screens above; by the time you hit `/stories/:id`, the pieces already exist.
`useStory(storyId)` returns `{ ...interview, pieces: content_items[] }`.

### content_items — the key columns (SELECT list authority: `api/_routes/db/content.js:67`)
```
id, interview_id, brief_id, staff_id, staff_name, topic, platform,
content,            -- THE WORDS (markdown/plain string). "Edit words" mutates this.
overlay_text,       -- derived burn-in markers (from [ON SCREEN TEXT:] in body)
slides,             -- JSONB [] : the carousel per-slide overlay model (see §4/§5)
text_card,          -- JSONB : Text Post Studio state (branded text-only card)
status,             -- draft | in_review | approved | scheduled | published  (CHECK-constrained)
scheduled_at, published_at,
media_urls,         -- JSONB [] of ENTRY OBJECTS (see shape below). The attached media.
photo_treatment,    -- JSONB : single-photo compositor spec (headline/grade/scrim/templateId/…)
photo_composite_url,-- the last baked single-photo composite (== what ships for a 1-photo post)
photo_template_id,  -- deck-level theme id (WHOOP built-in slug or custom uuid) for slides+compositor
location_overrides, target_locations, location_id,
buffer_update_id, buffer_metrics, performed_well, provenance, voice_fidelity_score, …
```

### Where "words" live + how "Edit words" mutates them
- Words = `content_items.content` (a string). Rendered/edited in
  `AssetsPane.ContentEditor` (`src/components/story-detail/AssetsPane.jsx:224`).
- Save path: `useUpdateContentItem().mutateAsync({ id, patch: { content: value, overlayText? } })`
  (`AssetsPane.jsx:296`). If the body has `[ON SCREEN TEXT: …]` markers it also derives `overlay_text`;
  if markers were removed it nulls it (`AssetsPane.jsx:287-295`).
- Side effects of a words save (`useUpdateContentItem`, `queries.js:362`): writes the row into the
  detail cache, invalidates content/stories/plan lists, and (since words changed) re-ranks media
  suggestions by invalidating the `mediaSuggestions(id)` key (`queries.js:381`). Plus a fire-and-forget
  `/api/editorial/learn-from-edit` voice-learning call (`AssetsPane.jsx:308`).
- The caption on the choose-media screen (`StoryboardPiece.jsx` `caption` state, seeded from
  `piece.content`) is a **local** textarea — **note: it is not wired to a save mutation** on that page
  (it feeds the compositor headline default only). The authoritative words edit is on StoryDetail.

### media_urls shape (canonical — `src/lib/mediaEntry.js`)
`[{ url, type:'image'|'video', kind, thumbnailUrl, mediaAssetId, name, duration_s?, sourceUrl?, composed?, treatment? }]`
— **never bare strings** (CLAUDE.md rule). Constructors: `clipToMediaEntry` (suggestions),
`pickerItemToMediaEntry` (Library/upload), identity key `mediaEntryKey` = `mediaAssetId || url`
(`mediaEntry.js:15-48`). Per-entry compositor extras (`sourceUrl/composed/treatment`) let the
single-photo compositor keep the original and bake per carousel image (`StoryboardPiece.jsx:248-253`).

### slides shape (carousel overlay model — `SlideEditor.normalizeSlide`, `SlideEditor.jsx:31`)
`slides: [{ photo_idx, template, template_id, photo_zoom?, photo_offset?,
            blocks:[{ role, text, position, width? }], rendered_url?, rendered_sig? }]`
- `photo_idx` indexes into the **photo-only** filtered media list (videos excluded), see
  `slidePhotos()` (`renderSlides.js:23`) and `SlideEditor.jsx:842`.
- `template` = block-set hint (cover/explainer/quote/cta/custom; `SLIDE_TEMPLATES`,
  `overlayTemplates.js:711`). `template_id` = per-slide **theme** override (else inherits deck
  `photo_template_id`).
- `block.role` ∈ `hook|body|caption|cta|attribution|page` (`BLOCK_ROLES`, `overlayTemplates.js:458`) —
  **drives typography**. `block.position` = preset string or `{x,y}` fraction (drag). `block.width` =
  optional wrap-width fraction (the only per-block style override today).
- `rendered_url`/`rendered_sig` = the baked image + an input hash so unchanged slides don't re-upload.

---

## 3. Media attachment — the capability that must move INTO the editor
Source: `src/pages/StoryboardPiece.jsx` (`/publish/:pieceId`). All of this is self-contained and
liftable:

- **AI picks** — `useMediaSuggestions(pieceId, {kind,k:12})` → `CandidateCard` grid
  (`StoryboardPiece.jsx:228, 1078`). Re-ranks when words change. Backed by
  `/api/content-items/suggest-media`.
- **Describe the shot** — free-text query into the same suggest-media brain
  (`runShotSearch`, `StoryboardPiece.jsx:266`; POST `/api/content-items/suggest-media` with `query`).
- **Library + Upload** — `<MediaPicker multi onSelect={handlePicked}>` (`StoryboardPiece.jsx:1173`).
  MediaPicker (`src/components/MediaPicker.jsx`) has two tabs (Library = `listMedia`/media_assets +
  collections; Upload = `uploadMedia` into the same library). Returns picker items normalized via
  `pickerItemToMediaEntry`.
- **Text post** — `<TextPostStudio>` makes a branded text-only card, uploads it, and attaches it as a
  photo entry (`StoryboardPiece.jsx:1177-1193`), also persisting `text_card`.
- **Attach / remove / swap** — thin mutations over `media_urls`:
  `attachEntry` (`:294`), `removeEntry` (`:308`), `handlePicked` (`:320`), all
  `useUpdateContentItem().mutateAsync({ id, patch:{ mediaUrls } })` with kind-mismatch guards
  (`isKindMismatch`, `platformMediaKind.js`).

API routes involved: `/api/content-items/suggest-media`, `/api/media/*` (list/upload via
`mediaLib.js`/`collectionsLib.js`), `/api/editorial/upload-slide`, `/api/editorial/compose-photo`.

---

## 4. The editor (SlideEditor) — what it can / cannot do

**File:** `src/components/story-detail/SlideEditor.jsx`. Hosted full-bleed only on the carousel branch of
`StoryboardPublish.jsx:84-127` (`-mx-4 -my-8 … h-[100dvh]`). Shape: top bar + left **slide rail** +
center **scaling canvas** + right **contextual inspector** (Layers list + selection body).

### CAN do today
- **Layer model** with a Layers list + canvas selection: `{type:'slide'} | {type:'photo'} | {type:'text',idx}`
  (`SlideEditor.jsx:863, 282-322`). Click a layer row OR click the photo/text on the canvas to select.
- **Slide management:** add / delete (with Undo toast) / reorder slides; left vertical rail thumbnails;
  add slide auto-binds the next unbound photo (`addSlide`, `:916`).
- **Photo (per slide):**
  - **Bind** the slide to an *already-attached* `media_urls` photo (`PhotoInspector`, `:533`; dropdown of
    attached photos + "No photo").
  - **Reframe**: drag-to-pan + scroll/slider zoom (`photo_offset`/`photo_zoom`), applied in the shared
    renderer so preview==publish==ad-export (`SlidePreview` pointer handlers `:137-168`; `drawCover` zoom/offset
    `overlayTemplates.js:122`).
- **Text (per slide, per block):**
  - **Add** a text block by role (hook/body/caption/cta/attribution/page) — `SlideInspector` "Add text
    block" (`:494`).
  - **Edit** the block's text + change its **role** (`BlockRow`/`TextInspector`, `:69, 634`).
  - **Position** it: drag the box freely on the canvas (`TextDragLayer`, `:212`; writes
    `block.position={x,y}`). Presets exist in the data model but the editor is drag-first.
- **Theme (deck + per-slide):** swatch grid of built-in + custom themes, each tile a **real rendered
  miniature** of the current slide (`MiniSlideCanvas`, `:329`). "Same as deck" (inherit) vs per-slide
  `template_id`; "Apply this theme to all slides" (`:485, handleApplyThemeToAll :941`).
- **Layout** (block-set template): cover/explainer/quote/cta/custom segmented control (`:408`).
- **Preview:** full-screen Instagram-style overlay (`FullPreviewOverlay`, `:715`), safe-zone overlay
  toggle on the canvas.
- **Save:** bakes each changed slide to a JPEG via `ensureRenderedSlides` (shared renderer) and uploads,
  then persists `slides` + `photo_template_id` (`handleSave`, `:948`; bake `renderSlides.js:79`).
- **Export for ads:** `<AdCarouselExportModal>` re-bakes every slide at a chosen ad aspect
  (`renderCarouselAds`, `renderSlides.js:123`).
- **Schedule/publish:** folded into the top-bar "Schedule" button → modal hosting the
  `scheduleNode` (= `<ApprovalPanel mode="publish">` passed down from StoryboardPublish, `:1049`).

### CANNOT do today (the redesign gaps)
- **Text size / color / font / weight** — no UI knobs. Size/color/weight are theme-driven only; the
  editor cannot override them per block (only role + theme decide). Font family is brand-locked.
- **Add NEW media / upload / swap a photo** — `PhotoInspector` only *rebinds* to existing attached
  photos. There is no MediaPicker, no upload, no AI suggestions, no "describe the shot" inside the editor.
  (Those all live one screen back on StoryboardPiece.)
- **Edit the words (caption/body)** — the editor only touches slide *overlay* text blocks. The post
  caption (`content`) is edited on StoryDetail; from the editor you must leave via "Edit words".
- **Colorist / AI photo grade** — explicitly a "next update" teaser line in `PhotoInspector`
  (`SlideEditor.jsx:624`). The single-photo compositor (`/api/editorial/compose-photo`,
  `brandRender.js`/`whoopTemplates.js`) and the "Change the look" AI chat (`/api/editorial/restyle`)
  live on StoryboardPiece, **not** in the SlideEditor.
- **Non-carousel formats** — SlideEditor is carousel-only; Reel/FB/LinkedIn/GBP never see it (see §7).

---

## 5. Text styling — exactly where size/color/font are decided

Two layers, both in the **shared** renderer `renderFreeformSlide` (`src/lib/overlayTemplates.js:883`),
which is used by preview (SlideEditor canvas), publish bake (`renderSlides.ensureRenderedSlides`), and
ad export — so any change here is automatically WYSIWYG end-to-end.

1. **`roleTypography(role, brandStyle, themeBlock)`** (`overlayTemplates.js:469`) computes the final
   `{ font, lineH, color, uppercase, shadow, background, bgColor, maxWidthFrac, pill }`:
   - **No theme block** → hard-coded per-role defaults (hook `800 84px heading`, body `600 44px body`,
     caption `italic 500 36px body`, cta `700 42px heading` pill, attribution `500 30px body`, page
     `600 28px body`) — `overlayTemplates.js:475-496`.
   - **With a theme block** (`theme.blocks[role]`) → size from `FONT_SIZE_PX[themeBlock.fontSize]`
     (`photoTemplates.js:22`), weight from `FONT_WEIGHT_CSS[themeBlock.fontWeight]`
     (`photoTemplates.js:33`), `color`, `uppercase`, `shadow`, `background`('none'|'pill'|'rect'),
     `bgColor` (`overlayTemplates.js:504-524`). **This is the data model that already supports
     size/color/weight/bg per role.** It's just sourced from the *theme*, not the block.
   - **Font family** = `brandFonts(brandStyle)` → `heading_font`/`body_font` with Inter fallback
     (`overlayTemplates.js:23`), chosen by role (hook/cta=heading, else body). **No per-block family.**
2. **`drawFreeformBlock`** (`overlayTemplates.js:590`) draws it: WHOOP panel auto-zoning, the **only**
   per-block override `block.width` (wrap width, `:650`), pill/rect backgrounds, shadow, multi-line
   wrap. WHOOP layout geometry (`drawWhoopLayout`, `:748`) + theme families in
   `photoTemplates.BUILTIN_THEMES` (`:61`): dark/light × claim/badge/split, each a full
   `blocks[role]` style map.

### Verdict for the redesign
- **Per-block size / color / weight / uppercase / shadow / bg** = **expose-existing**, with a small
  plumbing change: add optional `block.fontSize/color/fontWeight/...` to the slide-block shape and make
  `roleTypography` prefer `block.<x> ?? themeBlock.<x> ?? roleDefault`. The px map, weight map, draw
  code, the save signature (`renderSlides.slideSignature` would need the new fields added so re-bakes
  trigger — `renderSlides.js:44`), and `normalizeSlide` (`SlideEditor.jsx:31`) are the touch points.
  No new renderer.
- **Per-block font *family*** = **net-new** (needs a font registry + `@font-face`/loading; today only the
  two brand fonts exist). Recommend deferring; offer "brand heading / brand body" as the only two
  choices first (already free), full font picker later.
- The single-photo compositor (`StoryboardPiece` treatment) has its own **separate** size model
  (`headlineSize: 's'|'m'|'l'` → server `renderEditorialPhoto`/`renderWhoopPhoto`), independent of the
  slide block typography. Unifying these two text models is a design decision the redesign must make.

---

## 6. Publish + export — what the buttons actually do

### Publish (`ApprovalPanel mode="publish"`, `src/components/story-detail/AssetsPane.jsx:1222`)
`handlePublish({scheduledAt?, useQueue?, bypassMediaCheck?})` (`AssetsPane.jsx:1326`):
- Soft media gate (warn, allow override) if no media (`:1330`).
- **Blog** → synchronous website webhook (`publishBlogToWebsite`) + optional Beehiiv draft.
- **Social** → `publishPieceToBuffer(piece, {scheduledAt, useQueue, userEmail, workspace, themes})`
  (`src/lib/publishPiece.js`, `AssetsPane.jsx:1406`). This helper is the single source of truth for the
  Buffer/bundle.social path **including carousel slide-baking** (it returns `renderedSlides`, which the
  page persists back to `slides`, `:1424-1429`). Then PATCHes status →
  `scheduled`/`published` + approver audit + `scheduled_at` (`:1433`).
- Schedule UI: suggested-time CTA (`suggestScheduleTime`), "pick a time" datetime-local with
  conflict-warning, "add to Buffer queue", "publish now" (`WhenToPublishCard`, `:1013`).
- **Export** (`ExportCard`, `:948`): the DEFAULT for any channel with no wired direct-publish — copy
  markdown/HTML/caption + download image. "Direct publishing unlocks once an integration is connected."

How carousel overlay text reaches the live post: the baked slide images. On Save (eager) via
`ensureRenderedSlides` (`SlideEditor.handleSave`) and/or on publish (lazy) inside `publishPieceToBuffer`;
`publishMediaUrls` = the slides' `rendered_url`s in order (`renderSlides.js:104`). For a single-photo
post, the composite lives directly in `media_urls[i].url` (compose-photo writes it back), so it ships
as-is.

### Export for ads
- **Single photo:** `<AdExportModal>` (`StoryboardPiece.jsx:1195`) — re-renders the baked
  headline/treatment into Meta/Google ad sizes from the ORIGINAL photo.
- **Carousel:** `<AdCarouselExportModal>` (`SlideEditor.jsx:1035`) — `renderCarouselAds` bakes every
  slide at one chosen aspect (`AD_CAROUSEL_DIMS` 1:1/4:5/9:16, `renderSlides.js:113`) and uploads each.

---

## 7. Non-carousel formats — how the unified screen must handle them
`StoryboardPublish.jsx` branches on `mediaEntry.postFormat` / `isInstagramReel` (`mediaEntry.js:65, 82`):
- **isCarousel** = Instagram **and not** a reel (no video attached) → the full-bleed `<SlideEditor>`.
- **Everything else** (Reel, Facebook, LinkedIn, GBP, IG-single-photo, IG-with-video) → the two-column
  fallback: `<PostPreview>` (read-only channel mock) on the left, `<ApprovalPanel mode="publish">`
  (schedule/publish/export) on the right (`StoryboardPublish.jsx:172-233`). A Reel shows an explainer
  ("posts as a Reel; on-screen text is baked into the clip"; `:195`).

Implication for the unified screen: the rich layer/text/photo editor (SlideEditor) is **only** meaningful
for photo carousels/single-photo composites. For Reels and text-only channels the "compose" surface is
minimal (caption + schedule). The unified IA needs a **format-aware editor body**: full layer editor for
photo/carousel; a slim caption+media+schedule body for Reel/blog/GBP/etc. The single-photo compositor
(`StoryboardPiece` treatment) should fold into the same editor for 1-photo posts.

---

## Capability matrix (which current screen offers each — what the unified screen must absorb)

| Capability | StoryDetail `/stories/:id` (Edit words) | StoryboardPiece `/publish/:id` (Choose media) | SlideEditor (carousel) `/publish/:id/schedule` | StoryboardPublish non-carousel |
|---|---|---|---|---|
| **Edit words (caption/body `content`)** | ✅ `ContentEditor` (authoritative) | ⚠️ local caption textarea, **not saved** | ❌ | ❌ |
| **Attach media (AI picks)** | ❌ | ✅ `useMediaSuggestions`→`CandidateCard` | ❌ | ❌ |
| **Attach media (Library/Upload picker)** | ❌ | ✅ `<MediaPicker multi>` | ❌ | ❌ |
| **Attach media (describe-the-shot search)** | ❌ | ✅ `/suggest-media` query | ❌ | ❌ |
| **Add text-only card** | ❌ | ✅ `<TextPostStudio>` | ❌ | ❌ |
| **Swap / remove a photo** | ❌ | ✅ remove/handlePicked over `media_urls` | ⚠️ **rebind only** (existing attached) | ❌ |
| **Text role** | ❌ | ❌ | ✅ per block (`BLOCK_ROLES`) | ❌ |
| **Text SIZE** | ❌ | ⚠️ compositor `headlineSize` s/m/l (single photo only) | ❌ (theme-only) | ❌ |
| **Text COLOR** | ❌ | ⚠️ scrim navy/brand (not text color) | ❌ (theme-only) | ❌ |
| **Text FONT (family)** | ❌ | ❌ (brand-locked) | ❌ (brand-locked) | ❌ |
| **Text position (drag)** | ❌ | ❌ | ✅ `TextDragLayer` | ❌ |
| **Photo reframe (pan/zoom)** | ❌ | ⚠️ aspect "reframe" preview only | ✅ `photo_zoom/offset` | ❌ |
| **Theme (look)** | ❌ | ⚠️ scrim/template chips (compositor) | ✅ full swatch grid + per-slide | ❌ |
| **Colorist / AI photo grade** | ❌ | ✅ "Change the look" chat + compositor grade | ❌ (teaser only) | ❌ |
| **Publish / schedule** | ❌ (workflow approve only) | ⚠️ CTA → schedule page | ✅ Schedule modal (`ApprovalPanel`) | ✅ `ApprovalPanel` |
| **Export for ads** | ❌ | ✅ `AdExportModal` (single photo) | ✅ `AdCarouselExportModal` | ❌ |

✅ has it · ⚠️ partial/adjacent · ❌ missing. The unified screen must pull **every ✅/⚠️ into one place**:
words (from StoryDetail), all media-add (from StoryboardPiece), text styling (mostly new UI over an
existing renderer), colorist (from StoryboardPiece), publish/export (already in ApprovalPanel + the two ad
modals).

---

## What's net-new vs expose-existing

**Expose-existing (UI/plumbing over code that already works):**
- **Per-block text size/color/weight/uppercase/shadow/bg** — renderer already reads these per role from
  the theme; add optional per-block override fields and a `block.<x> ?? theme.<x>` precedence in
  `roleTypography`. Add the fields to `normalizeSlide`, `handleSave`'s `cleaned` map, and
  `slideSignature` (so re-bake triggers). ~1 file of renderer plumbing + an inspector panel.
- **Media-add inside the editor** — lift the StoryboardPiece media panel wholesale: `<MediaPicker>`,
  `useMediaSuggestions`+`CandidateCard`, describe-the-shot, `<TextPostStudio>`, and the
  attach/remove/swap mutations. All are self-contained and operate on `media_urls` via
  `useUpdateContentItem`. The SlideEditor's `PhotoInspector` "bind" then gains a "swap from library /
  upload / suggestions" action that *adds* to `media_urls` and rebinds `photo_idx`.
- **Photo grade / colorist** — `/api/editorial/compose-photo` + "Change the look"
  (`/api/editorial/restyle`) already exist on StoryboardPiece; move the panel into the editor's Photo
  inspector (the teaser line at `SlideEditor.jsx:624` is already a placeholder for it).
- **Publish/schedule/export** — `ApprovalPanel mode="publish"` and both ad-export modals already mount
  inside SlideEditor's top bar; reuse verbatim.
- **Caption editing** — reuse `ContentEditor`'s save shape (`useUpdateContentItem` patch `{content}`);
  the StoryboardPiece caption textarea is the seam — wire it to a save.

**Net-new:**
- **Per-block font *family* picker** — needs a font registry + web-font loading; today only
  `brandStyle.heading_font/body_font` exist. Defer; ship "brand heading / brand body" toggle first.
- **Format-aware editor body** — one screen that shows the full layer editor for photo/carousel but a
  slim caption+media+schedule body for Reel/blog/GBP/text-only. (Today these are two different
  `StoryboardPublish` branches.)
- **Unifying the two text models** — slide-block typography vs single-photo compositor `headlineSize` are
  separate systems; the unified editor needs one of them to win (recommend the slide-block model, and
  route 1-photo posts through a single-slide carousel so the compositor's `headlineSize` retires).
- **Words ↔ overlay relationship** — decide whether editing the caption/body in the unified screen also
  reseeds slide hook text, or stays independent (today `content` and `slides.blocks` are unrelated after
  generation).

---

## Risks / seams

- **React Router `*` catch-all (App.jsx).** All authed routes flow through `<Route path="*">` →
  `ProtectedAppWithProvider`. A unified screen is just another inner `<Route>`; **do not** add an outer
  exemption (the descendant-`<Routes>` matching trap, CLAUDE.md "Router conventions"). Keep
  `/publish/:pieceId/...` (or a new `/edit/:pieceId`) inside the inner block.
- **Carousel-vs-other-format split.** SlideEditor is carousel-only by construction
  (`StoryboardPublish.jsx:84`; `SlideEditor` filters videos out of `mediaUrls` at `:842`). Unifying must
  not assume slides exist — Reel/blog/single-photo paths have no `slides`.
- **`media_urls` object shape.** Always `[{url,type,kind,...}]`; never bare strings (a bare string
  publishes video as a broken image). Use `clipToMediaEntry`/`pickerItemToMediaEntry`. `photo_idx`
  indexes the **photo-only** filtered list, not raw `media_urls` — keep `slidePhotos()` the single
  filter (`renderSlides.js:23`).
- **One-render-path / preview==publish rule (CLAUDE.md).** The bake MUST reuse `renderFreeformSlide`
  (it does today, via `ensureRenderedSlides`). Any new per-block style field must be added to
  `slideSignature` (`renderSlides.js:44`) or stale `rendered_url`s ship the old look. The client canvas
  renderer uses `document`/`window` so it can't be node-harnessed — design sign-off is post-deploy in
  Chrome (CLAUDE.md "Mockup-first").
- **Status CHECK constraint.** `content_items.status` is CHECK-constrained
  (draft/in_review/approved/scheduled/published). A unified flow that adds any new status needs a
  migration (`<table>_status_check`); reuse the existing values.
- **Single-photo compositor writes `media_urls` in place.** `compose-photo` overwrites the image entry's
  `url` with the composite and stashes the original in `sourceUrl` (`compose-photo.js`,
  `StoryboardPiece.jsx:1199-1206`). The db SELECT must keep `photo_treatment`/`photo_composite_url`
  (memory: a SELECT once dropped `photo_treatment` and the compositor "forgot" the bake on reload).
- **Two save buttons / dirty models.** SlideEditor has its own dirty/Save (slides+theme);
  ContentEditor has its own (content); StoryboardPiece compositor bakes immediately. A unified screen
  needs one coherent save/dirty story across words + media + slides + treatment.
- **`useUpdateContentItem` invalidations.** A words change re-ranks suggestions
  (`queries.js:381`); a unified screen editing words inline should keep that invalidation so the AI
  picks update live.

---

## First-cut unified IA proposal (reuse the SlideEditor shell)

Make the **SlideEditor full-bleed shell the host** (top bar + left rail + scaling canvas + right
inspector). Route: keep `/publish/:pieceId/schedule` (or introduce `/edit/:pieceId`) — `StoryboardPiece`
collapses into it; `/publish` queue still links in.

- **Top bar** (already there): back · format badge · Preview · Ads · Save · **Publish/Schedule** (modal
  = existing `ApprovalPanel mode="publish"`). Add a single coherent dirty/Save spanning words + slides +
  media + treatment.
- **Left rail** (already there): slide thumbnails for carousels; for single-photo/Reel/blog it collapses
  to one "card" (the post) — no rail clutter.
- **Center canvas** (already there): the live `renderFreeformSlide` render = exactly what publishes.
  Drag text, drag/zoom photo. For Reel, show the clip + baked-caption note (read-only compose).
- **Right inspector — contextual `selection`, extend the existing 3 tabs:**
  - **Words** (NEW tab/section) — the caption/body editor (reuse `ContentEditor`'s save shape). For
    carousels this is the post caption; slide overlay text stays on the Text layer.
  - **Slide** (exists) — layout + theme grid + add-text.
  - **Photo** (exists, EXTEND) — bind (exists) **+ Swap/Add: MediaPicker + Upload + AI suggestions +
    describe-the-shot** (lift from StoryboardPiece) **+ Colorist/grade** (lift compose-photo + restyle
    chat; the teaser at `SlideEditor.jsx:624` becomes real).
  - **Text** (exists, EXTEND) — text + role (exist) **+ size / color / weight / uppercase / bg**
    (expose-existing renderer knobs via new per-block override fields) **+ "brand heading/body" font
    toggle** (free; full font picker later).
- **Format-aware body:** photo/carousel → full editor; Reel/blog/GBP/text-only → slim body (caption +
  media attach + schedule), still inside the same shell so "one screen, one Publish button" holds.
- **Net-new build:** per-block style override fields + precedence in `roleTypography` (+ signature +
  normalize/save), the format-aware body switch, folding the single-photo `headlineSize` compositor into
  the slide-block model (route 1-photo through a single-slide carousel), and (later) a real font picker.
  Everything else is lifting existing, working components into the SlideEditor shell.
