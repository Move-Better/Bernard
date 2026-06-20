# Build Plan — Carousel Editor Redesign + AI Colorist (+ Video parity)

## STATUS (2026-06-20)
- ✅ **Phase 1** — per-slide theme persistence (save + load), shared `postFormat` badge, WYSIWYG theme-in-preview, delete-undo. Merged (#1433).
- ✅ **Phase 2 slice 1** — photo reframe (drag-pan + zoom), one render path. Merged/auto-merging (#1434).
- ✅ **Phase 2 slice 2** — active-canvas IA restructure. First pass (#1436) kept it boxed in the page → Q flagged it didn't match the mockup. Rebuilt as the full-bleed dedicated editor (#1438): single top bar (back/title/format badge/Preview/Ads/Save/Schedule), Schedule folds into a modal, Layout=segmented, Theme=visual swatch grid + inherit row + apply-to-all, safe-zone toggle + slide counter, bottom filmstrip. Prod-verified in Chrome 2026-06-20. Deferred to later phases (noted): AI Colorist section (Phase 3), interactive ratio switch (aspect sub-phase), editable title.
- ⏳ **Phase 3** — colorist Sharp grade engine. **Phase 4** — brand house look + Settings + auto-apply.
- NOTE: `main` already shipped per-slide text drag/resize (Moveable popover), per-slide theme, and renderer width/height params — Phase 2's delta is smaller than originally scoped (see reconciliation in chat 2026-06-20).

_2026-06-19. Consolidates: [carousel-editor-redesign-findings.md](carousel-editor-redesign-findings.md), [colorist-concept-brief.md](colorist-concept-brief.md), [video-editor-parity.md](video-editor-parity.md), and the two mockups in `.claude/mockups/`. Trial-able phases, each independently shippable and verifiable. No code starts until Q approves a phase._

## Carousel editor v2 — APPROVED SPEC (2026-06-20)
Mockup: `.claude/mockups/carousel-editor-v2.html` (Q signed off the direction + left rail). Supersedes the #1438 in-page editor — Q: "not close to top-tier UI, not true to the mockup."
- **Big scaling canvas**: fills the stage, fit-to-window + zoom controls; photo-forward (photo + editorial bottom scrim + headline lower third), NOT a flat navy panel.
- **Left vertical slide rail** (replaces the bottom filmstrip — Q: bottom row wastes space). Real rendered thumbnails, numbers, add, override dot.
- **Direct layer selection**: click the photo or any text on canvas → selection chrome (ring / dashed box + handles). Plus a Layers list at the top of the inspector. Contextual right inspector = the selected layer's editor (Canva/Figma/Pitch model).
- **Inspector states**: (slide) Layout + Theme as REAL miniature renders + Apply-to-all; (photo) **AI Photo Editor** = describe-the-look + vibe chips + Brightness/Warmth/Contrast/Vibrance/Depth + Replace + ★Brand look (REPLACES the old "Change the look" restyle chips); (text) role + text + size + drag-to-place.
- **STATUS**: ✅ 2b-1 SHIPPED + prod-verified 2026-06-20 (#1439 shell, #1440 click-select fix): left rail, scaling canvas, Layers list + contextual inspector (slide/photo/text), selection rings, old "Change the look" removed, no fake grade controls. Layers-list selection confirmed on prod; direct canvas-click-to-select is wired but unconfirmed via automation (Q to try). NEXT: 2b-2 real-render thumbnails → 2b-3 photo-forward renderer → Phase 3 AI Photo Editor (functional grading).
- **Build phasing**: (2b-1) layout shell — left rail + scaling canvas + contextual inspector + layer selection, existing renderer; (2b-2) real-render thumbnails (reuse renderFreeformSlide into mini canvases); (2b-3) photo-forward renderer update — **changes the shared `renderFreeformSlide` → affects the published bake**, verify via node harness + prod; AI Photo Editor sliders become functional grading in **Phase 3** (the panel UI lands in 2b).

## Locked decisions (from the design interview)
- **Editor IA:** one large active-slide canvas that *is* the live preview + bottom filmstrip navigator + right context inspector. No separate preview pane (on-demand phone-frame modal instead).
- **Aspect ratio:** renderer parameterized (1:1 / 4:5 / 9:16); Instagram carousels default **4:5**.
- **Per-slide theme:** inherit deck by default; per-slide override breaks inheritance (amber ring). Live inheritance cascade.
- **Text placement:** free **drag** (x/y), not top/middle/bottom presets.
- **Photo:** drag-to-pan + scroll/slider **zoom** (reframe), stored per slide.
- **AI Colorist:** set up once in **Settings → Brand Look**; **auto-applies** to every baked photo; **one** house look + per-photo override; **describe-the-vibe** is the primary intent mode (match-references secondary); **light manual** = Brightness / Warmth / Contrast / Vibrance / Depth with AI doing the full grade underneath.
- **v1 honesty:** grading is **whole-frame, subject-safe by clamps** (saturation ≤1.20, hue ±8°, near-identity). True background-only isolation is a later (segmentation) phase.
- **Video:** mirror the photo editor + a time axis, later. Keep schema format-agnostic now.

## Phases (recommended order)

### Phase 1 — Free carousel P0 fixes (no design risk)
Pure bug fixes surfaced by the audit; ship first, helps immediately.
- **Per-slide theme save-bug:** `handleSave` (SlideEditor.jsx ~929) drops `template_id` — it's wired everywhere else, so per-slide themes are silently discarded today. Include it in the `cleaned` map + persist. (~1 line + verify.)
- **Format badge:** a shared `postFormat(piece)` helper in `mediaEntry.js` (Carousel / Reel / Post + slide count + ratio), consumed by BOTH `StoryboardPublish` and `PostPreview` so they can't disagree. Count slides, not source photos.
- **WYSIWYG one render path:** pass resolved `theme` into `PostPreview`'s `SlideCanvas` (it currently renders un-themed); render the preview from live editor state; delete the `FullPreviewOverlay` HTML text path so every surface calls `renderFreeformSlide`.
- **Delete-with-undo:** slide delete shows an undo toast instead of silent/instant removal.
- _Verify:_ per-slide theme survives reload (node harness on `ensureRenderedSlides` + post-deploy Chrome); preview matches publish.

### Phase 2 — Carousel editor redesign (the IA)
Build the approved mockup (`mockups/carousel-editor.html`) as the real editor.
- Active-canvas + bottom filmstrip; right inspector (Layout / Theme / Colorist / Photo / blocks); ~52px top bar; phone-frame preview modal; safe-zone overlay.
- **Aspect-ratio parameterization:** replace the fixed `SIZE` constant in the compositor with a ratio param (default 4:5); re-tune safe zones + template defaults.
- **Free-drag text** (store `x`/`y` per block) replacing position presets.
- **Photo reframe:** drag-pan + zoom (`photoOff`, `photoZoom` in `content_items.photo_treatment` / slide).
- Migration: slide schema gains `x`/`y`, `photoOff`, `photoZoom` (additive, neutral defaults; legacy rows unaffected). GRANT inline per migration rules.
- _Verify:_ mockup is the spec; post-deploy Chrome on prod.

### Phase 3 — Colorist engine (deterministic Sharp grade) — "colorist without the model"
- Replace the single `grade` scalar in `renderEditorialPhoto` (+ the two `whoopTemplates` presets) with `applyGradeParams(sharp, params)`: exposure, contrast, saturation, warmth(WB), tint, hue, levels, clahe, + a ~30-line 1D curve helper for highlights/shadows. Every param neutral-by-default so legacy rows re-render identically.
- Store the param object in `photo_treatment`. Non-destructive (original blob untouched).
- _Verify:_ node harness renders every variant to `/tmp`, read the JPEGs (per the Sharp rule). $0/image.

### Phase 4 — Brand house look + Settings + auto-apply
Build `mockups/colorist-brand-look.html` as the real Settings → Brand Look page.
- `workspaces.photo_grade_preset` JSONB (migration + GRANT). Resolve through the workspace JSONB chain; cache-invalidate on save.
- Describe-the-vibe (primary) + match-references (Reinhard Lab stats from 3–5 photos). Bake one brand `.cube` LUT; apply via JS trilinear interp as the final pre-overlay step; two-pass normalize→stamp so one look survives varied lighting.
- **Auto-apply** at bake to every photo; per-photo override + reset in editors. Subject-safe clamps enforced server-side.
- _Verify:_ consistency grid (varied → uniform) on real workspace photos.

### Phase 5 — Describe-a-look intent (multimodal)
- `proposeGradeParams` via Claude vision + structured-output JSON schema (refs cached in the system prompt). Text box → reviewed pre-filled sliders before save. Model proposes, Sharp applies; store params, never re-call on re-render. ~$0.01–0.05/look.

### Phase 6 — Subject-safe background-only grading (segmentation)
- Bria RMBG 2.0 at upload (IP-indemnified), mask cached per asset. Differential grade: full grade on background, original subject composited back untouched. Mask-preview QA gate. Delivers the literal "never alter the clinician."

### Phase 7 — Generative background replace (optional, demand-driven)
- Bria `/replace_background` behind an explicit toggle; async `waitUntil` + hard-capped poll; seed + model-version pinned. Only if owners ask.

### Later — Video / Reel composer
- The photo editor + a time axis (see video-parity doc). Reuses the grade schema (ffmpeg emitter), overlay/block model, aspect-ratio param, and Slate's cut clips. Keep those three format-agnostic during Phases 2–5 so this is cheap.

## Phasing summary

| Phase | Deliverable | Est. Days | Est. Claude Cost |
|---|---|---|---|
| 1 | Free carousel P0 fixes (save-bug, format badge, WYSIWYG, undo) | 1–2d | ~$3–6 (Sonnet) |
| 2 | Carousel editor redesign (active-canvas IA, drag/zoom, 4:5) | 4–6d | ~$15–30 |
| 3 | Colorist engine (deterministic Sharp grade) | 1–2d | ~$3 |
| 4 | Brand house look + Settings + auto-apply + LUT | 2–3d | ~$5–10 |
| 5 | Describe-a-look (Claude vision → params) | 2–3d | ~$5–10 |
| 6 | Subject-safe background-only (Bria segmentation) | 3–5d | ~$8–15 + API |
| 7 | Generative background replace (optional) | demand | demand |
| Later | Video / Reel composer (reuses everything) | — | — |

## Guardrails to honor (from CLAUDE.md)
- Migrations: additive, neutral defaults so legacy `photo_treatment`/`slides` rows re-render identically; `GRANT … TO service_role` inline.
- One render path: editor canvas, filmstrip thumbs, phone preview, and the publish bake all call the SAME renderer with the SAME params — the preview-≠-publish bug class is the top risk.
- Sharp/native-dep: verify with a node harness (read the JPEGs); exercise the cold-start path before declaring done.
- Format-agnostic now: grade param schema (shared module, Sharp + future ffmpeg emitters), overlay/block model (free x/y, leave room for in/out), aspect-ratio param — so video drops in later.
- Lint/typecheck/build green; `useAppMutation` / `apiFetch`; `workspaceContext` + `workspace_id` filter on any new tenant-scoped route; blob paths namespaced by `ws.id`.

## Recommended first slice
**Phase 1 now** (free, no design risk, fixes a live data-loss bug), then **Phase 2** (the editor redesign people actually feel), then the colorist Phases 3→4 (engine → brand look). 5/6/7 and video follow on demand.
