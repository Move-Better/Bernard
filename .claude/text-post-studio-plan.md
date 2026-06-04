# Text Post Studio (Option B) — Implementation Plan

Build the "Text post studio" mockup (`.claude/mockups/text-template-b.html`): a layout
gallery + block editor that bakes a branded text-only image and attaches it to a post.

## Grounding in the real machinery (already exists, reuse)
- **Renderer**: `renderFreeformSlide({ sourceUrl, slide, brandStyle, canvas, theme })` in
  `src/lib/overlayTemplates.js`. Draws blocks `[{role,text,position}]` onto a canvas.
  - ⚠️ HARD-CODED 1080×1080 (`SIZE`). All positioning math uses `SIZE`.
  - ⚠️ No-photo path = fixed slate gradient (#475569→#1e293b), NOT brand-colored.
  - ⚠️ SHARED with live carousels → coordinate refactors risk regressing carousels.
- **Themes**: `src/lib/carouselThemes.js` — role→style maps. `brand` theme uses brand colors.
- **Bake+upload**: `ensureRenderedSlides()` (`src/lib/renderSlides.js`) →
  `POST /api/editorial/upload-slide` (needs `{pieceId, idx, sig, dataUrl}`) → Blob JPEG.
- **Attach**: result is `[{url, type:'photo'}]` written to `content_items.media_urls`
  (the existing publish contract — no carousel semantics needed for a single image).
- **Brand**: `workspaces.brand_style` { accent_color, secondary_colors, heading_font, body_font }.
- **Launch point**: `src/pages/StoryboardPiece.jsx` "Text template" button (currently a stub
  that opens the media picker).

## Architecture decisions
1. **A text card is just a baked photo.** Bake ONE image, attach as a normal `media_urls`
   photo entry. Do NOT route through carousel/slides publish (avoids touching that path).
2. **Re-editable state** lives in a NEW column `content_items.text_card` (JSONB):
   `{ template, blocks, theme_id, background, logo }`. The studio re-opens from this;
   `media_urls` drives publish. (migration + service_role grant)
3. **Saved templates**: NEW table `workspace_text_templates`
   `(id, workspace_id, name, config jsonb, created_at)` + service_role grants.
4. **Background**: extend `renderFreeformSlide` with an additive optional `background` arg
   (default = current slate gradient → carousels unaffected). Supports solid/gradient from
   brand colors + warm/light/white presets.
5. **Aspect ratio**: ship **1:1** in Phase 1 (renderer's native size, universal IG size).
   4:5 / 9:16 require generalizing the shared renderer to W×H → **Phase 3** (separately
   scoped, carousel-regression-tested). The mockup's aspect toggle ships disabled-with-note
   until then rather than faking it.

## Phases (each independently shippable + trial-able)
- **Phase 1 — Core studio (1:1), no save-templates.**
  - Renderer: additive `background` param + brand-color fill helper.
  - New route/modal `TextPostStudio` launched from "Text template" button.
  - Layout gallery (Quote/Stat/Announcement/CTA + variants) → maps to `SLIDE_TEMPLATES`
    block defaults + theme/background presets.
  - Block editor (headline/subtext/CTA), background swatches (brand kit), headline size,
    text position, logo toggle. Live `<canvas>` preview via `renderFreeformSlide`.
  - "Use this post" → bake (idx 0) → upload → attach to `media_urls` + persist `text_card`.
  - migration: `content_items.text_card jsonb`.
- **Phase 2 — Save & reuse templates.**
  - `workspace_text_templates` table + CRUD API. "Save template" + show saved in gallery.
- **Phase 3 — Multi-aspect (4:5 / 9:16).**
  - Generalize renderer to W×H; regression-test carousels; enable aspect toggle.

## Verification per phase
- typecheck + lint + build; bake a card on prod (Clerk domain-lock → prod-only visual check);
  confirm the baked JPEG actually publishes (not just preview) per the canvas-preview lesson.
