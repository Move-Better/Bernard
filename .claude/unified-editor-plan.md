# Unified one-screen editor — APPROVED build plan (Q 2026-06-20)

Mockup signed off: `.claude/mockups/unified-editor.html`. Audit: `.claude/pipeline-audit.md`.

> **NOTE for a fresh worktree (e.g. the spawned U3–U5 task):** `.claude/mockups/` is **gitignored** (`.gitignore:28`), so the mockup HTML files do NOT exist in a new worktree — only in the original session's worktree. This plan + `pipeline-audit.md` (both committed) describe the design in full; build from them. If you need the exact mockup pixels, ask Q to re-open `unified-editor.html` / `carousel-editor-v2.html` / `video-editor-v1.html`, or regenerate from the spec here.
Goal: collapse 4 screens (Edit words → Choose media → Compose → Publish) into ONE — the full-bleed SlideEditor shell hosts words + media attach/swap + text styling + colorist + publish/export.

## Locked decisions
- **Build phased**, ship + Chrome-verify each phase (client-canvas → Q's Chrome is the only real verify).
- **Single photo → one text model**: route a 1-photo post through a single-slide carousel; retire the compositor's `headlineSize` S/M/L. One per-block text editor everywhere.
- **Words ↔ overlay = independent + "use as hook" button**: caption (`content`) and slide overlay text stay separate; a one-tap pushes caption→hook. No silent clobber.
- **Font** (my default, Q didn't object): ship **Brand heading / Brand body** toggle first; real font-family picker later (needs a font registry — net-new).
- **One unified Save** spanning words + slides + media + grade.

## Phases (in order)
- [ ] **U1 — Text styling** (per-block size/color/weight/uppercase/font). Mostly expose-existing: add optional `block.fontScale/color/fontWeight/uppercase/font` override fields; `roleTypography` precedence `block.x ?? theme.x ?? roleDefault`; add to `normalizeSlide` + `handleSave` cleaned map + `slideSignature` (renderSlides.js:44) so re-bakes trigger. Text inspector UI: Size slider, Colour swatches, Weight segmented, Uppercase toggle, Font heading/body. CLIENT-CANVAS → ship + Chrome-verify with Q.
- [ ] **U2 — Media add/swap in editor**: lift StoryboardPiece's `<MediaPicker>` + `useMediaSuggestions`/`CandidateCard` + describe-the-shot + Upload into the Photo inspector (SWAP/ADD tabs); attach to `media_urls` + rebind `photo_idx`. Merge the staged colorist (#1443) as the Photo grade panel.
- [ ] **U3 — Words in editor**: a Caption/words layer at top of the inspector; reuse `ContentEditor` save (`useUpdateContentItem` patch {content}, keep the suggestion re-rank invalidation); "use as hook" button (caption→slide hook).
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
- NEXT: U3 (words in editor) → U4 (collapse the 4 screens) → U5 (format-aware body).
