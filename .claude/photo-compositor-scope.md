# Photo Compositor (B1) — Scope

**Status:** scoping / awaiting design-input decisions + mockup sign-off
**Date:** 2026-06-03
**Owner:** Q

## Goal

Let the AI chat on a **photo post** (StoryboardPiece) execute *whatever it's given — visual or text* — and have it show on the image in the preview **and** ship identically at publish. Quality bar: **above-middle / first-class congruence.** The output must read as premium as the practice it represents — not slop (over-produced fake), not middle (under-sells a first-class system), not the ceiling (motion graphics — out of scope, silly for us).

## Headline finding: the engine ~80% already exists

The investigation (2026-06-03) found near-complete precedents. This is a **reuse + design** job, not a greenfield build.

| Capability | Where it lives | Verdict |
|---|---|---|
| Server-side photo compositor (Sharp crop + SVG text overlay + brand color/font + Blob upload) | `api/_lib/brandRender.js` → `renderPhotoChannel()`, `buildBrandOverlaySvg()`, `resolveBrandColors()` | **Reuse with changes** — this is the core engine, already in prod for clip stills |
| Render + upload + writeback pattern | `api/editorial/render-clip.js` (Blob path, response shape) | Reuse as-is |
| Brand-aware theme/type model (per-role font size/weight/color/shadow/bg) | `src/lib/carouselThemes.js` (`BUILTIN_THEMES`, `FONT_SIZE_PX`, `resolveTheme`) | Reuse as-is; extend block roles |
| In-browser canvas renderer (for live preview) | `src/lib/overlayTemplates.js` → `renderFreeformSlide()`, `src/lib/renderSlides.js`, `src/lib/textCard.js` | Reuse for preview |
| Brand config (accent_color, secondary_colors, heading_font, body_font; auto-extracted from Brand Book) | `workspaces.brand_style` JSONB; `api/brand-kit/*`, `api/_lib/brandFonts.js` | Reuse as-is |
| Post media model + publish dispatch | `content_items.media_urls` `[{url,type,kind,...}]`; `src/lib/publish.js`, `api/publish/buffer.js` | Reuse as-is; bake composite into media_urls |
| Fontconfig/librsvg-on-Vercel setup (the documented gotcha) | `brandFonts.js` `ensureFontconfig()` + embedded @font-face data-URI in SVG | Already solved — fonts embedded in SVG, no fontconfig dependency at composite time |

**Implication:** the earlier 3–8 day estimate was for an engine we mostly already have. The code delta is small. The real long pole is the **above-middle design system** (taste input), exactly as predicted.

## Architecture: one spec, two renderers, parity discipline

```
            ┌─────────────────────────────┐
            │  treatment spec (JSON)       │  ← single source of truth
            │  { crop, grade, overlays[],  │     stored on content_items
            │    templateId, brandRefs }   │
            └─────────────┬───────────────┘
                          │
        ┌─────────────────┴─────────────────┐
        ▼                                   ▼
  PREVIEW renderer                   PUBLISH renderer (bake)
  renderFreeformSlide (canvas)       renderPhotoChannel (Sharp+SVG)
  instant, in-browser                deterministic, server, → Blob
        │                                   │
        └────────── must match ─────────────┘
                  (WYSIWYG contract)
```

- **The expensive/durable part** = the treatment spec + AI-chat mapping + UI. Built once, renderer-agnostic.
- **The renderer behind the spec is swappable.** We start with in-house (Sharp/SVG — already built). If we ever wanted Cloudinary, only the renderer swaps; spec/chat/UI untouched. (We are NOT planning to; clinical photos stay in-house.)
- **The one real risk = preview ≠ publish parity** (bit us on carousel #980). Two renderers (canvas preview, Sharp publish) *can* diverge. Mitigations: (a) drive both from the identical spec + theme constants + `FONT_SIZE_PX`; (b) a CI snapshot test that renders the same spec both ways and diffs; (c) fallback option — render server-side and use that image as the preview too (slower, but parity-guaranteed). Decide in P1.

## The above-middle delta (where design input is REQUIRED before engine work)

The engine emits whatever the templates/spec tell it to. "Above middle" is set entirely by the design system feeding it. These are **design inputs, not code** — needed *before* the engine work to avoid building a premium machine that emits middle output:

1. **Type system** — brand typeface (already resolvable via `brand_style.heading_font`/`body_font`), a deliberate type scale, hierarchy, kerning/leading. *#1 lever for "premium."* `FONT_SIZE_PX` exists but needs a considered scale, not generic.
2. **Color grade / "look"** — a consistent treatment applied to every photo (exposure normalize + subtle grade) so the feed reads as one brand. New: a grade step in the Sharp pipeline (modulate brightness/saturation/tint).
3. **Smart crop** — subject-aware crop, not center-crop. Either Sharp `attention`/`entropy` gravity (cheap, in-house) or a vision call (better, costs).
4. **Contrast-aware text placement** — captions always legible against whatever's behind them (sample region luminance → pick light/dark text or scrim). This is the visible "we're on AI" signal.
5. **2–3 genuinely crafted templates** — not one generic text-on-photo box. Designed layouts (e.g. lower-third, editorial headline, quote card) with real restraint.
6. **Quality gate** — flag photos too low-res/dark/blurry to meet the bar (curation is half of premium).

**Design input options:** (a) Q art-directs via the mockup loop (project rule — Q steers by reacting to visuals); (b) a designer defines type scale + grade + templates once; (c) premium template references as a starting point. Recommend (a)+(c) to start, (b) if it doesn't land.

## Phasing (each independently shippable + trialable)

- **P1 — Grade + smart crop + branded caption band, AI-driven.** Mostly wiring existing `renderPhotoChannel()` + a preview + mapping `restyle` changes (brightness, content) onto the spec. Delivers immediate visible lift; proves the preview→publish pipeline end-to-end. **~2 days.**
- **P2 — Free-form text overlays + the above-middle template system.** New SVG overlay zones, the type scale, the 2–3 crafted templates, contrast-aware placement. **~2–3 days + design input (the gating item).**
- **P3 — Drag-to-position, quality gate, polish.** The UX where days quietly balloon; defer until P1/P2 validate. **~1–2 days.**

**Revised estimate:** ~5–7 engineering days total, but **P1 alone (~2 days) is the honesty fix + visible win.** The schedule is gated by *design input* for P2, not by code.

## Must-not-break (project scars to honor)

- **Preview must equal publish** — reuse ONE renderer path / shared constants; verify the live published image, not just the editor canvas (carousel #980, `feedback_canvas_preview_not_published.md`).
- **Bake-and-upload on the publish path**, wrapped in `waitUntil()` if async; never a bare floating promise.
- **Stream large image downloads** to disk (`pipeline(Readable.fromWeb…)`); `arrayBuffer()` OOMs >500MB.
- **Cold-start native-dep path** (Sharp/librsvg) must be exercised before declaring done — warm instance masks crashes.
- **Blob path uses `ws.id`** (immutable), not slug.
- **AI must not claim success it didn't deliver** — only toast changes actually applied to the spec (this is the original bug that started this thread).

## Open decisions for Q (before P2)

1. Build in-house renderer (recommended; clinical photos stay in-house) vs. ever revisiting a rented compositor.
2. Free-form text-anywhere vs. branded templates first (templates are cheaper + more on-brand; recommend templates first).
3. Smart crop: Sharp gravity (free, decent) vs. vision call (better, per-image cost).
4. Design input source: Q art-direction loop (start here) vs. bring in a designer for the template/type/grade system.
5. Parity strategy: dual-renderer + snapshot test vs. server-render-as-preview.
