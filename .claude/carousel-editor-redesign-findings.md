# Carousel / Slide Publish Editor — Redesign Findings

_Generated 2026-06-19 by the carousel-editor-redesign-research workflow (18 agents: code map → 6 competitor products → 6-lens adversarial critique → synthesis). Read-only research. This is the spec basis for the mockup._

## Is this a Post or a Reel?

Definitively: this piece is a CAROUSEL (Instagram, no video) — `isCarousel = piece.platform === 'instagram' && !isInstagramReel(piece.media_urls)` (StoryboardPublish.jsx:72-73). It would only be a Reel if any media_urls entry were a video. The "1 media attached / 5 slides" contradiction is real and by-design in the data model, NOT a bug in the count itself: the header prints `mediaCount = piece.media_urls.length` (line 74) — the number of SOURCE PHOTOS — while the editor renders one card per `piece.slides[]` entry, a separate JSONB array. A slide references a photo by `slide.photo_idx`, so 5 slides can all reuse the same 1 photo → "1 media attached" sits beside 5 slide cards. The header is reporting the INPUT unit (photos) while the working surface shows the OUTPUT unit (slides), and the words "Carousel"/"Reel"/"Post" never appear anywhere (meta.label is hardcoded "Instagram" in contentMeta.js:20; isReel/isCarousel are computed only to gate which section renders). PRESCRIPTION: surface a persistent named format badge in the editor chrome driven by the existing isReel/isCarousel logic, and count in SLIDES not media. Show "Instagram Carousel · 5 slides · 1:1" (or "Instagram Reel · 0:47" / "Instagram Post"). Lead with `piece.slides.length`; demote the source-photo count to an optional sublabel ("5 slides from 1 photo") or drop it. Add a live slide counter ("Slide 2 of 5") in the filmstrip/canvas. This single change resolves both the literal string bug and the format-clarity confusion. Format must also be derived ONCE in a shared helper (e.g. postFormat(piece) in mediaEntry.js) consumed by both the page gate and PostPreview — today PostPreview re-derives format independently (renders SlidesCarousel whenever slides exist, with no reel check), so a piece can preview as a carousel while publishing as a Reel.

## Problems (deduped, severity-ordered)

### 1. [P0] WYSIWYG broken: 'Live preview' is neither live nor theme-accurate (4 render paths, 2 state sources)

> The LIVE PREVIEW carousel (left) does NOT match the slides being edited (right) — WYSIWYG is broken.

**Root cause:** Two compounding bugs plus structural duplication. (1) StoryboardPublish.jsx:129 feeds PostPreview `piece.slides` — the last-SAVED React Query DB snapshot — while SlideEditor.jsx:839 holds its own local `slides` useState that is never lifted to the parent. So every unsaved keystroke/reposition/theme-pick/add/delete is invisible to the left preview until Save. (2) PostPreview.jsx:62-67 SlideCanvas calls renderFreeformSlide({sourceUrl, slide, brandStyle, canvas}) with NO `theme` argument — confirmed in source — so even after Save it renders the un-themed fallback, while SlideEditor's SlidePreview (line ~329) passes theme correctly. On top of that there are FOUR render paths for one slide: SlidePreview card canvas (themed), PostPreview SlideCanvas (un-themed), FullPreviewOverlay (SlideEditor.jsx:604-723, plain HTML/CSS text over a dimmed photo — shares no code with renderFreeformSlide), and the publish bake ensureRenderedSlides (renderSlides.js, themed). The renderer is shared and correct; the INPUTS and the extra HTML path are the divergence.

**Competitor precedent:** Open-Carrusel uses the identical wrapSlideHtml() function for both the iframe preview and the Puppeteer export — 'what you see is exactly what you export.' Canva/Pitch/Figma Slides collapse editor and preview into ONE surface (the canvas IS the preview; no second pane). Canva's own App SDK guidance: an approximate preview MUST carry a disclaimer or users distrust the tool.

**Options:**

- Minimal patch: pass resolved `theme` into PostPreview's SlideCanvas (one-line correctness fix) AND lift SlideEditor's local slides+themeId to the parent via onChange so PostPreview consumes live editor state — keeps the two-column layout but makes the left pane genuinely live.

- Collapse to one surface (recommended): make the slide being edited the single large active canvas that IS the preview (Canva model); replace the separate left column with an on-demand 'Preview as Instagram' phone-frame modal. One render path, one state source, zero drift possible.

- Keep two columns but render BOTH from the same shared component instance + live state, and route FullPreviewOverlay through renderFreeformSlide too (kill the HTML text path) so all four surfaces become one.

**Recommendation:** Go with option 2 for the redesign (single active canvas = preview, on-demand phone-frame for in-feed context), but ship the option-1 one-line theme fix immediately since it's a pure correctness bug that helps even before the rebuild. Whatever the layout, enforce ONE render path: every surface that shows a slide must call renderFreeformSlide with theme — delete the FullPreviewOverlay HTML text renderer.

### 2. [P0] Format is invisible and mislabeled: 'Instagram · 1 media attached' next to 5 slide cards

> Cannot tell if this is a Post or a Reel (header says '1 media attached' but shows 5 carousel slides).

**Root cause:** StoryboardPublish.jsx:74 mediaCount = piece.media_urls.length (source photos); line ~101 renders '{meta.label} · {mediaCount} media attached' where meta.label is hardcoded 'Instagram' (contentMeta.js:20) with no carousel/reel axis. isReel/isCarousel (lines 72-73) are computed but consumed only to gate section visibility — never surfaced. Slides (piece.slides[]) are a separate JSONB array; a slide references a photo via slide.photo_idx, so N slides can reuse 1 photo. The header reports the input unit; the editor shows the output unit; the format word never appears. Worse, format is re-derived independently in PostPreview (renders SlidesCarousel whenever slides exist, no reel check) so the page gate and the preview can disagree.

**Competitor precedent:** CapCut/Adobe Express/CarouselMaker/LinkPreviewAI all keep a persistent named format badge in the editor chrome ('Carousel · 10 slides max · 1:1'). Instagram native shows a live '3/20' slide counter in the canvas. Canva/Figma/Pitch are explicitly faulted in the research for HIDING format once inside the editor — Bernard has their bug without their excuse.

**Options:**

- Read-only format badge: a pill in the top bar driven by existing isReel/isCarousel — 'Instagram Carousel · 5 slides · 1:1' / 'Instagram Reel · 0:47' / 'Instagram Post'; count from piece.slides.length, not media_urls.length; add 'Slide 2 of 5' counter in the filmstrip.

- Badge + format switcher: same pill but clickable to convert Post↔Carousel↔Reel here, adapting the composer (needs rules for what happens to slides when switching to a reel).

- First-class format selector before media (Planoly/ContentStudio model): pick Post/Carousel/Reel as a named type up front, which constrains aspect ratio and slide count — bigger IA change.

**Recommendation:** Ship option 1 now — it's ~10 lines, resolves the literal string bug and the orientation confusion at once, and is pure win. Extract a single postFormat(piece) helper in mediaEntry.js consumed by BOTH the page gate and PostPreview so format can never be re-derived inconsistently. Defer the switcher (option 2) to the open question on mixed-format support.

### 3. [P0] Per-slide theme override is silently destroyed on Save — the feature LOOKS built but is dead end-to-end

> 'Change the look' theme/template applies to ALL slides at once; Q wants template PER SLIDE.

**Root cause:** Confirmed in source: handleSave (SlideEditor.jsx:929-933) rebuilds each slide as `{ photo_idx, template, blocks }` — it OMITS `template_id`. That `cleaned` array is the only input to both ensureRenderedSlides (so the bake never sees the override) and the DB patch `{ slides: toPersist, photo_template_id: themeId }` (so it's never persisted). Yet the data model carries slide.template_id, the resolver honors it (SlideCard resolveTheme(slide.template_id || globalThemeId), line ~352), and the bake reads slide.template_id (renderSlides.js:96). So a user picks 'Dark Badge' on slide 3, sees it in the live card, clicks Save — and the baked/published image AND the reloaded editor both revert to global. This is almost certainly the actual mechanism behind 'theme applies to ALL slides': per-slide does nothing the moment you persist. Compounding it, the only UI for the override is an 80px-truncated unlabeled dropdown reading 'Global' crammed in the 280px card header (lines ~428-438), and 'Change the look' (ChangeTheLookPanel) writes only the global themeId.

**Competitor precedent:** Pitch: a locally-overridden slide shows a brush-with-blue-dot badge plus an explicit Update/Reset popover — the override is a real, persisted, visible state, never a control that resets on save. Canva: right-click thumbnail 'Copy Page Style / Paste Page Style' + contextual 'Apply to all pages'. Gamma: separate global Theme Editor vs per-card styling popup.

**Options:**

- One-line unblock: add `template_id: s.template_id ?? null` to the cleaned map (SlideEditor.jsx:929-933) so it flows to bake + persist — converts a 75%-built feature (model+resolver+bake already support it) into a working one.

- Promote per-slide to a first-class, legible affordance: a proper named/swatch theme picker per slide (not a truncated dropdown) writing slide.template_id, plus an explicit 'Apply to all slides' secondary action and an override indicator (dot/ring) on filmstrip thumbnails that deviate from global.

- Give 'Change the look' a scope toggle ('This slide' vs 'All slides') so the prominent control can also target one slide.

**Recommendation:** Do option 1 immediately (highest leverage in the whole nightmare; verify per-slide override survives a reload via a node harness on ensureRenderedSlides then post-deploy in Q's Chrome), then build options 2+3 into the redesign so per-slide is the discoverable default and global is an explicit push. Rename the two axes so 'Layout' (slide.template: cover/explainer/cta) and 'Theme/Style' (slide.template_id: dark-split etc.) are never both called 'template'.

### 4. [P1] Slide cards are an information-density disaster: 280px cards do navigation + canvas + full inspector at once

> Text on the slide cards is a nightmare — cramped, overlapping, hard to read.

**Root cause:** SlideCard is fixed w-[280px] (SlideEditor.jsx:396) and renders ALL slides side-by-side in a horizontal scroll (no single-active mode; activeSlideIdx is computed but the card row ignores it — no isActive prop, no scrollIntoView). Each card crams 5 controls into one non-wrapping header row at text-3xs (10px): move-left/right + 'Slide N' + a Layout select + an 80px-truncated theme select + an X delete. Then a 280px square canvas (1080px content scaled ~26% so 84px hook text displays ~21px, 44px body ~11px), then photo-bind, then N dense BlockRows (up/down arrows + role chip + position button + X + textarea), then 'Add text block'. The card is asked to be the navigator, the canvas, and the full inspector in a thumbnail's footprint.

**Competitor precedent:** Pitch 'bubble bar' / Canva context toolbar show controls ONLY for the current selection, at readable sizes, in a dedicated panel — never crammed into the thumbnail. CapCut/Adobe Express put per-slide actions (duplicate/delete) as hover icons on the thumbnail. Instagram/Canva/Gamma all edit ONE large active slide, with the others demoted to a thin strip.

**Options:**

- Single large active canvas (≥50% of the right column at true crop) + a context inspector panel for the selected slide/block — controls get full width and normal text-xs/text-sm sizes; eliminate text-3xs on this surface.

- Keep horizontal cards but widen them dramatically and move reorder/delete/theme out to a hover menu + inspector, reducing the header to just 'Slide N' + Layout.

- Accordion of full-width slide rows (one expanded at a time) — each expanded row is roomy; collapsed rows are thumbnails.

**Recommendation:** Option 1. The single-active-canvas pattern simultaneously fixes the cramping (one card gets full width), the redundant-filmstrip P1 (filmstrip becomes the sole navigator), and gives the format/slide-counter a natural home. Move reorder + delete onto the filmstrip thumbnail; move Layout + Theme + blocks into a context panel.

### 5. [P1] Filmstrip duplicates the card row — same slides drawn twice, and filmstrip selection is dead

> The 'SLIDES · click to edit' filmstrip at top is redundant with the per-slide editor cards below it.

**Root cause:** SlideEditor.jsx:1025-1032 renders SlideFilmstrip (60px raw-photo thumbnails, no canvas, no rendered text — so it ALSO doesn't match output) directly above the full SlideCard row (lines 1066-1099) which renders every slide too. Both scroll horizontally, both have Add. The filmstrip's only job is onSelect→setActiveSlideIdx, but the card row never consumes activeSlideIdx (no isActive, no scrollIntoView), so clicking a filmstrip thumb does nothing visible. Pure dead chrome eating ~75-90px of vertical space above the editing area.

**Competitor precedent:** Research explicitly names 'using thumbnails as a secondary editing surface' as THE anti-pattern, and converges on one read-only navigation strip + one active canvas. Figma Slides makes the two views mutually exclusive (filmstrip OR grid, never both). No researched tool shows two parallel all-slides surfaces.

**Options:**

- Keep the filmstrip as the sole navigator (move it to the BOTTOM, render REAL renderFreeformSlide thumbnails with slide numbers + override rings + drag-to-reorder), delete the per-card horizontal row in favor of one active canvas.

- Keep the cards, delete the filmstrip, add a slide counter to the section header (cards-only).

- Grid view toggle: filmstrip becomes a full-grid reorder mode (Canva/Figma) that's mutually exclusive with edit mode.

**Recommendation:** Option 1, paired with the single-active-canvas change. The filmstrip becomes the one navigator with rendered thumbnails (finally matching output) at the bottom; clicking a thumb swaps the active canvas. This deletes the duplication and gives every slide real editing room.

### 6. [P1] Text overlaps and silently truncates: no collision detection, no auto-fit, no overflow warning

> Text spills over at the top of the lower slides (headline overlaps body in slide thumbnails).

**Root cause:** Two layered defects. (1) Silent truncation: wrapLines (overlayTemplates.js:~92) hard-caps each block at roleTypography maxLines (hook=4, body=5, caption=3) and does .slice(0, maxLines) with NO ellipsis and NO warning, while the BlockRow textarea shows the FULL text — input promises more than the renderer delivers. (2) Collision: roleTypography sets fixed sizes (hook 800 84px / lineH96 / maxLines4 = up to 384px tall); resolvePosition maps presets to absolute anchors (top=96 grow-down, center=540 grow-up, bottom=1016) with zero inter-block gap checking; drawFreeformBlock draws blocks sequentially with no second pass. The default 'explainer'/'cta' pairing (hook='top', body='center') physically interpenetrates in the canvas middle band at realistic line counts. At the 280px card scale this overlap reads as an illegible smear.

**Competitor precedent:** Adobe Express 'dynamic text box' (font scales DOWN to fit a fixed region, never overflows); Google Slides 'Shrink text on overflow' (default on placeholders, identical in editor and at render); PostNitro enforces per-role minimum-size floors so text can't go below a readable size. Google Slides/Keynote role-typed placeholder slots occupy fixed non-overlapping regions so two roles can't share pixels.

**Options:**

- Auto-fit then warn: shrink font in steps to a per-role floor (e.g. hook 48px, body 28px on 1080) before truncating; if still overflowing at floor, render a visible ellipsis + a red 'text clipped' badge on the BlockRow and the filmstrip thumbnail.

- Role-ordered vertical stacking pass: for preset (non-custom) positions, measure each block's wrapped height and lay blocks out top→bottom within the safe zone with a minimum gap, so a lower block's top can never cross an upper block's bottom (custom {x,y} drags stay exempt).

- Re-tune TEMPLATE_DEFAULT_POSITIONS so the default block set never pairs collision-prone anchors, as a stopgap.

**Recommendation:** Do options 1 AND 2 together (auto-fit handles the common case with no user effort; the stacking pass guarantees no overlap for preset layouts), plus option 3's default re-tune. Add a toggleable safe-zone overlay (dashed ~60px inset + top/bottom Instagram-chrome bands + 1012px profile-grid crop) on the edit canvas, default ON — a market-wide gap and a differentiator.

### 7. [P1] ~200px of stacked header chrome buries the canvas before the user sees a slide

> Lots of wasted vertical space at the top — Back to media, post title, Instagram label, Edit words could be compacted/relocated so the visual dominates.

**Root cause:** StoryboardPublish.jsx:77-112 stacks (space-y-5, py-6): PipelineStepper (the THIRD repeat of the same Interview→Words→Media→Publish indicator), a 3-crumb Breadcrumb, then a header block with BackLink + h1 + 'platform · N media' subtitle + 'Edit words' button. Then INSIDE SlideEditor a SECOND header (lines ~994-1023: 'On-screen text — per slide' label + 2-line description + Full preview + Save/Reset), then the redundant filmstrip, then the ChangeTheLook accordion, then the theme chip row — six labeled bands before the first slide card at line 1066. Plus the left preview column is pinned at a fixed 380px (minmax(0,380px), sticky) consuming a third of the width for a stale reference.

**Competitor precedent:** Universal across research: top bar ≤48-56px with ONLY back + title + format badge + share/export; tools/inspector are context-on-demand, not permanent rows; canvas gets ≥70% of the viewport. Figma moves creation tools to a bottom toolbar; Pitch uses a floating bubble bar; Gamma gives >90% to the card.

**Options:**

- Aggressive: single ~48px top bar (back + editable title + format badge + Save/Schedule); drop PipelineStepper on this leaf page; move 'Edit words' to an overflow menu; fold ChangeTheLook + theme row into the per-slide context panel; replace the 380px preview column with an on-demand phone-frame modal. Target ≥70% canvas.

- Moderate: collapse the stepper to a one-line 'Publish — step 3 of 3', merge breadcrumb into the back affordance, keep a slim preview column but make it collapsible.

- Conservative: keep all bands but tighten spacing and shrink the preview column to ~300px.

**Recommendation:** Option 1, paired with the single-active-canvas move. The canvas is what Q says should dominate; everything else is context-on-demand. Keep stage context as a thin inline breadcrumb, not the full badge row.

### 8. [P2] Slide delete is instant, unconfirmed, and permanent after Save

> Q can delete slides (capability exists / wants to confirm delete UX).

**Root cause:** The X in each card header (SlideEditor.jsx:439-446) calls removeSlide (line ~879) which filters local state immediately with no confirm. The only undo is the Reset button (easy to miss), and it's destroyed the moment Save runs ensureRenderedSlides and persists. So an accidental click is a one-click, hidden-undo, soon-permanent data loss of that slide's block text.

**Competitor precedent:** Canva, Google Slides, Pitch, Figma all put delete (+ Duplicate) on the slide thumbnail via hover/right-click and pair destructive actions with an inline undo rather than a blocking confirm.

**Options:**

- Inline undo: delete immediately but show a 'Slide deleted — Undo' toast for ~5s (no modal, stays fast) — keep an in-session undo stack so a mis-click recovers even after later edits.

- Lightweight confirm popover on the X.

- Move delete onto the filmstrip thumbnail hover menu alongside a new Duplicate action (duplicating a styled slide is the most common carousel move and is currently absent).

**Recommendation:** Option 1 + option 3: move delete (and add Duplicate) to the filmstrip thumbnail hover menu, and replace silent removal with an undo toast. This satisfies 'confirm the delete UX' without adding friction to every delete.

## Proposed direction (mockup spec)

A canvas-dominant, single-truth carousel editor. TOP BAR (~48px, the only persistent chrome): back arrow, editable piece title, a PERSISTENT FORMAT BADGE driven by the existing isReel/isCarousel logic ('Instagram Carousel · 5 slides · 1:1' / 'Reel · 0:47' / 'Post'), and a primary Save/Schedule action. The PipelineStepper collapses to a thin inline 'Publish — step 3 of 3'; 'Edit words' moves to an overflow menu. CENTER: ONE large active-slide canvas rendered at the true crop (the chosen aspect ratio), which IS the live preview — it renders from the SAME local editor state and the SAME renderFreeformSlide(...theme) call as the publish bake, so there is exactly one render path and zero drift. A toggleable safe-zone overlay (dashed ~60px inset + top/bottom Instagram-chrome bands + profile-grid crop) sits on the canvas, default ON. A 'Preview as Instagram' button opens an on-demand phone-frame modal (swipe dots, caption truncation) rendering the actual baked output for the final in-feed check — replacing the old permanent 380px left column. RIGHT (context inspector, appears for the selection): when nothing is selected it shows slide-level controls — Layout (cover/explainer/cta, renamed from 'template') and a proper named/swatch Theme picker writing slide.template_id, with an explicit 'Apply to all slides' secondary action; when a text block is selected it shows just that block's role, position, and a roomy textarea at readable sizes (no more text-3xs). Text auto-fits (shrinks to a per-role floor) and a role-ordered stacking pass guarantees preset layouts never overlap; if text still overflows at the floor, a red 'clipped' badge appears on the block and its thumbnail. BOTTOM: a single read-only FILMSTRIP of numbered thumbnails rendered via renderFreeformSlide (so they finally match output), with drag-to-reorder, a hover menu for Duplicate + Delete (delete shows an Undo toast), an override ring on any slide whose theme deviates from the deck, and 'Slide 2 of 5' context. This collapses four render paths and two state sources into one, makes per-slide theme the discoverable default (and actually persists it by including template_id in handleSave's cleaned map), kills the filmstrip/card duplication, names the format unmistakably, and gives the visual the ≥70% of the viewport Q asked for.

## Open questions for Q

### Q1 [Layout model] Should the editor become a single large active-slide canvas (with a thin bottom filmstrip navigator), or keep the horizontal row of per-slide cards?

_Why it matters:_ This is the central IA fork — it determines whether we FIX the filmstrip/card duplication and the WYSIWYG sync, or REMOVE the duplication entirely. Guessing wrong means rebuilding the whole editing surface twice. Every researched best-in-class tool (Instagram, Canva, Gamma, CapCut, Figma) uses one active canvas + one strip.

- **Active canvas + filmstrip** **(recommended)** — One dominant edit canvas = the preview; other slides demoted to a read-only bottom filmstrip (drag-reorder, delete, override rings). Fixes cramping, redundancy, and WYSIWYG in one move.

- **Keep cards, fix sync** — Retain the horizontal card row but widen cards, lift state for live preview, and de-clutter headers. Less disruptive, but keeps two competing slide lists.

- **Accordion rows** — Full-width slide rows, one expanded at a time; collapsed rows act as the strip.

### Q2 [Preview pane] Keep a permanent left 'Live preview' column, or replace it with an on-demand 'Preview as Instagram' phone-frame modal?

_Why it matters:_ The separate column is exactly what created the WYSIWYG drift (two surfaces, two state sources) and pins a third of the viewport to a stale reference. If the active canvas becomes the preview, a permanent second pane is redundant — but you may want in-feed context (swipe dots, caption truncation, profile-grid crop) visible while editing.

- **On-demand modal** **(recommended)** — Active canvas IS the live preview; a 'Preview as Instagram' button opens a phone-frame mockup at true pixels for the final in-feed check. Maximum canvas space, zero drift.

- **Collapsible drawer** — Keep an in-feed reference but as a collapsible right drawer, not a pinned 380px column.

- **Keep the column** — Retain a permanent side preview (now rendering live state + theme). Familiar, but spends a third of the width on reference.

### Q3 [Theme inherit] When the deck (global) theme changes, should non-overridden slides re-theme live, or should each slide snapshot the theme at creation time?

_Why it matters:_ This defines the per-slide theme model Q is explicitly asking for. Live inheritance keeps a carousel cohesive and lets 'Change the look' globally re-skin in one action; snapshot makes each slide independent but means a later global change touches nothing. Wrong choice means the override/reset UX and the 'Apply to all' button behave opposite to expectation.

- **Live inheritance** **(recommended)** — Slides inherit the deck theme by default; changing the deck re-themes all non-overridden slides; per-slide override breaks inheritance for that slide (Canva/Gamma/Google Slides cascade).

- **Snapshot at creation** — Each slide copies the current theme when created and is thereafter independent; global changes don't touch existing slides.

### Q4 [Single image] Should a single-photo Instagram piece (no extra slides) enter the carousel composer at all, or be a simpler 'Single Post' surface?

_Why it matters:_ Today isCarousel = instagram && !isReel, so ANY non-video Instagram piece — even one photo — is forced into the slide composer and labeled nothing. This is a real format-clarity decision: if single-image posts should support on-photo overlay text, keep them in the composer but label them 'Post'; if not, give them a caption-only surface.

- **Post w/ overlay text** **(recommended)** — Single photo stays in the composer (so you can add on-photo text) but is clearly labeled 'Post', not 'Carousel'; becomes a carousel only when a 2nd slide is added.

- **Simple single post** — Single photo gets a caption-only surface with no slide composer; carousel is an explicit opt-in.

### Q5 [Format switch] Should the format badge be read-only (derived from attached media) or a clickable switcher that converts Post/Carousel/Reel in place?

_Why it matters:_ A switcher is cleaner mental-model-wise but forces us to define what happens to existing slides when you switch a carousel to a Reel (slides are meaningless for a Reel). Read-only is safe and ships now; a switcher is a scope expansion that touches the data model.

- **Read-only badge now** **(recommended)** — Persistent 'Instagram Carousel · 5 slides · 1:1' pill derived from media; defer switching. Lowest risk, resolves the P0 today.

- **Badge + switcher** — Clickable pill to convert format in-place, with defined rules for slides-on-switch. More power, more scope.

### Q6 [Aspect ratio] Keep authoring carousels at 1:1 (1080×1080, the current SIZE constant), or move to 4:5 portrait (1080×1350), Instagram's best-practice feed size?

_Why it matters:_ This is upstream of the safe-zone overlay math, the canvas shape, the renderer's SIZE constant, and every template's default positions. Choosing 4:5 gives more vertical room (which also eases the text-overlap problem) but is a renderer-wide change; 1:1 is the status quo. The safe-zone bands depend on which ratio publishes.

- **Keep 1:1** — No renderer change; simplest. Carousels stay square.

- **Move to 4:5** **(recommended)** — Switch the carousel canvas to 1080×1350 for more vertical space and best in-feed real estate; re-tune SIZE, safe zones, and template defaults.

- **Let user choose** — Offer 1:1 and 4:5 as a per-carousel format option with matching safe-zone overlays.
