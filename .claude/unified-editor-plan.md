# Unified one-screen editor — APPROVED build plan (Q 2026-06-20)

Mockup signed off: `.claude/mockups/unified-editor.html`. Audit: `.claude/pipeline-audit.md`.

> **NOTE for a fresh worktree (e.g. the spawned U3–U5 task):** `.claude/mockups/` is **gitignored** (`.gitignore:28`), so the mockup HTML files do NOT exist in a new worktree — only in the original session's worktree. This plan + `pipeline-audit.md` (both committed) describe the design in full; build from them. If you need the exact mockup pixels, ask Q to re-open `unified-editor.html` / `carousel-editor-v2.html` / `video-editor-v1.html`, or regenerate from the spec here.
Goal: collapse 4 screens (Edit words → Choose media → Compose → Publish) into ONE — the full-bleed SlideEditor shell hosts words + media attach/swap + text styling + colorist + publish/export.

## Locked decisions
- **Build phased**, ship + Chrome-verify each phase (client-canvas → Q's Chrome is the only real verify).
- **Single photo → one text model**: route a 1-photo post through a single-slide carousel; retire the compositor's `headlineSize` S/M/L. One per-block text editor everywhere.
- **Words ↔ overlay = independent + "use as hook" button**: caption (`content`) and slide overlay text stay separate; a one-tap pushes caption→hook. No silent clobber.
- **Font** — SUPERSEDED 2026-06-20: REMOVE the per-block Font picker from the editor (it takes users off-brand). Font binds to the **Brand Kit** by section type (Hook/CTA/Body); font-family *selection* lives in the Brand Kit, not the editor.
- **One unified Save** spanning words + slides + media + grade.

## 2026-06-20 — Q click-through feedback + decisions (session: nice-beaver)
**Architecture = Option A** (Q approved): keep our slides + publish-bake pipeline; use proven libs for painful primitives (react-easy-crop *only if* the framing UX needs it — `drawCover` already does cover+zoom/offset), inline coloured text in OUR renderer. NOT a Fabric re-platform, NOT Polotno ($9,990/yr). Revisit Fabric later only if we outgrow the renderer.

**Photo model** (mockup `mockups/photo-experience-v1.html` signed off):
- **Per-slide photo**: pick (AI picks / library / upload / describe) → lands on the slide (attach + bind in ONE step). `media_urls` stays as storage (it's the publish payload for single-photo/non-carousel), but the redundant "Use an attached photo" dropdown is REMOVED.
- **New slide = blank** "Add a photo" canvas (stop auto-binding the next pool photo).
- **Reuse across slides = OK**; **deleting a slide drops its photo** from the post (unless reused).
- **Bulk multi-select = PARKED** (long carousels later; make "a few slides" great first).
- **Photo full-bleed by DEFAULT** — photo owns the whole slide, text overlaid w/ scrim. The navy "claim-card" (Dark/Light Claim WHOOP panel) is what read as "scaled to fit" → becomes an *optional* layout, not the default. (`drawCover` already does cover+zoom; the bug was the panel-theme default.)

**Preview**: replace the fullscreen `FullPreviewOverlay` (a CSS approximation that didn't match the render — a real preview≠publish bug) with a **phone mockup** rendering the REAL slide. Phone/Desktop toggle where consumed both ways (LinkedIn/FB); IG phone-only.

**Format labels**: output type **explicit & switchable** — "Instagram Post / Story / Reel", same for every platform with multiple output types (`postFormat` only partially handles Story today).

**Text styling** (→ U2.2): DROP **Case** + **Font**; KEEP/ADD colour + **bold / italic / underline**, plus **inline styled runs** (white text + one orange word in a line — net-new in the canvas renderer; add `runs` to slideSignature). Fix the **selection-highlighter misalignment**.

## Phases (in order)
- [ ] **U1 — Text styling** (per-block size/color/weight/uppercase/font). Mostly expose-existing: add optional `block.fontScale/color/fontWeight/uppercase/font` override fields; `roleTypography` precedence `block.x ?? theme.x ?? roleDefault`; add to `normalizeSlide` + `handleSave` cleaned map + `slideSignature` (renderSlides.js:44) so re-bakes trigger. Text inspector UI: Size slider, Colour swatches, Weight segmented, Uppercase toggle, Font heading/body. CLIENT-CANVAS → ship + Chrome-verify with Q.
- [ ] **U2 — Media add/swap in editor**: lift StoryboardPiece's `<MediaPicker>` + `useMediaSuggestions`/`CandidateCard` + describe-the-shot + Upload into the Photo inspector (SWAP/ADD tabs); attach to `media_urls` + rebind `photo_idx`. Merge the staged colorist (#1443) as the Photo grade panel.
- [ ] **U2.1 — Photo experience** (NEW, gates U3; Q held U3 until "photos are dialed in"). Built against `mockups/photo-experience-v1.html`. Sub-phases (PR each, Chrome-verify):
  - **U2.1a** — unify the photo control (remove the "Use an attached photo" dropdown; one panel = slide photo + Replace) + per-slide model (new slide = blank "Add a photo"; delete-slide drops its photo) + **fix the broken attach** (AI-picks loaded empty live — trace suggest-media on verify).
  - **U2.1b** — full-bleed photo as the default look (claim-card optional) + framing polish.
  - **U2.1c** — phone-mockup Preview rendering the REAL slide (retire `FullPreviewOverlay`'s CSS approximation); Phone/Desktop toggle.
  - **U2.1d** — explicit + switchable output-type selector (IG Post/Story/Reel; same for other platforms).
- [ ] **U2.2 — Text styling revision** (after photos): drop Case + Font picker; add bold/italic/underline + inline coloured runs; fix selection-highlighter; font→Brand Kit by section.
- [ ] **U3 — Words in editor** (HELD until U2.1 done): a Caption/words layer at top of the inspector; reuse `ContentEditor` save (`useUpdateContentItem` patch {content}, keep the suggestion re-rank invalidation); "use as hook" button (caption→slide hook).
- [ ] **U4 — Collapse the screens**: editor becomes the entry; `/publish/:pieceId` (choose media) folds in / redirects to the editor; drop "Back to media"/"Edit words" detours. Single-photo routes through single-slide carousel. One coherent dirty/Save. Mind the `*` router catch-all (CLAUDE.md).
- [ ] **U5 — Format-aware body**: Reel/blog/GBP/text-only get a slim caption+media+schedule body in the SAME shell (the deep Reel editor = the separate `video-editor-v1.html`, pending its own sign-off).

## Guardrails (CLAUDE.md)
- One render path: bake reuses `renderFreeformSlide`; **every new per-block style field MUST be added to `slideSignature`** or stale baked images ship.
- `media_urls` object shape `[{url,type,kind,...}]`; `photo_idx` indexes the photo-only filtered list (`slidePhotos()`).
- Keep `photo_treatment`/`photo_composite_url` in the SELECT.
- Router `*` catch-all; status CHECK constraint (reuse existing values).
- Lint 0-warnings; `useAppMutation`/`apiFetch`; workspace scoping on any new API route.

## Progress
- Plan approved. Starting U1 (text styling).
- ✅ **U1 SHIPPED + prod-verified** 2026-06-20 (#1449): per-block Size/Colour/Weight/Case/Font in the Text layer; renderer `roleTypography` decomposed w/ block>theme>role precedence (byte-identical when no overrides); persisted via normalizeSlide/handleSave/slideSignature. Verified in Chrome: Size 150% + Bold + Orange all restyle the canvas live.
- NOTE: staged **#1443 colorist** (AI Photo Editor) still pending Q's Chrome-check — it's the Photo-layer grade panel of the unified vision; merge it as part of U2. It + U1 both touch slideSignature → trivial both-add merge.
- ✅ **U2 SHIPPED + prod-verified** 2026-06-20 (#1450): Photo layer "Swap / add a photo" (AI picks + describe-the-shot + Library/Upload via MediaPicker) + kept rebind; `attachPhoto` mutates media_urls via useUpdateContentItem + rebinds photo_idx. Colorist (#1443) rebased onto main + folded in (gradeParams + AI Photo Editor + propose-grade); #1443 closed as superseded. Verified in Chrome: AI picks grid + Library + colorist sliders all present in the Photo layer.
- 2026-06-20 click-through (Q): triaged feedback → architecture **Option A**, photo-experience mockup signed off. NEW order: **U2.1 (photos) → U2.2 (text revision) → U3 (words, HELD) → U4 → U5**.
- ✅ Mockup `mockups/photo-experience-v1.html` approved + `git add -f` tracked 2026-06-20.
- ✅ **U2.1a SHIPPED + prod-verified** (#1453): unified per-slide photo control (current photo + Replace/Remove; redundant "Use an attached photo" dropdown removed); new slide = blank "Add a photo"; reuse a photo across slides. "Broken attach" = slow first-paint of AI picks (they load; describe-the-shot + Library work) — perceived, not a logic bug.
- ✅ **U2.1b SHIPPED + prod-verified** (#1454): clean full-bleed "Full Photo" `photo` layout (edge scrims only, no dim/rule) as the DEFAULT for un-themed carousels (the "scaled to fit" fix). `DEFAULT_DECK_THEME`. Explicit-themed decks untouched.
- ✅ **U2.1b.1 SHIPPED** (#1455): publish path resolves null deck → full-bleed default too (centralized `DEFAULT_DECK_THEME`, `resolveTheme(null)`), so an un-saved deck publishes full-bleed (preview==publish). Self-heals pre-U2.1b bakes via sig change.
- ✅ **U2.1c SHIPPED + prod-verified** (#1456): phone-mockup Preview rendering the REAL slide (retired the fullscreen CSS approximation = a preview≠publish gap); bottom-anchored text on full-bleed (`whoopTextZone`/`blockFraction` `photo` zone [0.58,0.92]).
- U2.1d finding: output-type LABEL already explicit (`postFormat` → "Instagram Carousel/Post/Reel/Story" in editor top bar + publish header). The remaining value is (a) prominence polish, (b) a true Post↔Story↔Reel SWITCHER = U4 scope (editor must host each format). 
- NEXT (Q to steer): U2.2 (text styling: drop Case/Font, add bold/italic/underline + inline colour runs, fix selection-highlighter) vs U2.1d label-prominence polish.
