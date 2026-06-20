# Overnight Sprint — Carousel/Photo Phases 2b-3→6 + Video Editor Mockups

**Authorized by Q 2026-06-20 (auto mode). Auto-ship each phase on green.**
Re-read this after every context compaction. Worktree: `.claude/worktrees/determined-gates-87505e`. Branch per phase off fresh `origin/main`. Prod verify = poll `curl -s https://withbernard.ai/version.json` vs `git rev-parse origin/main`.

## ⚠️ VERIFICATION REALITY (decides auto-ship vs stage) — read first
Two renderers:
- **CLIENT canvas `renderFreeformSlide` (overlayTemplates.js)** → used by the CAROUSEL editor preview + carousel publish bake (renderSlides.js) + carousel ad export. Uses `document`/canvas → **CANNOT node-harness; only Q's Chrome verifies pixels.** So carousel-visible changes (2b-3 photo-forward, the in-editor live grade preview, Settings page UI) are **built + lint/build green + STAGED as PRs (NO auto-merge)** with a morning note for Q to Chrome-check then merge. Design is pre-approved (mockup), but faithful-render + "looks right" is Q's call.
- **SERVER Sharp compositor (api/_lib/brandRender.js renderEditorialPhoto, whoopTemplates.js)** → single editorial photos. Node-runnable (no Clerk) → **node-harness reads JPEGs → AUTO-SHIP.**
Grade engine = format-agnostic param SCHEMA + emitters: a **Sharp emitter** (server, auto-shippable) and a **canvas emitter** (client, Chrome-staged). Same params, two targets (ffmpeg emitter later = video).

## Ground rules
- **Auto-ship on green**: lint (0 warnings) + build + **node-harness render verification (read the JPEGs)** → commit → push → `gh pr create` → `gh pr merge <n> --auto --squash` → poll prod SHA. One PR per phase.
- **No fake/half-built.** If a phase needs an external dep (key) I don't have, wire it + gate OFF + leave a note; do NOT auto-ship a fake. If node-harness can't confirm pixels, don't ship.
- **Chrome look-checks are Q's morning job** — I queue them, don't block on them. (Authed app is Clerk-prod-locked; only Q's logged-in Chrome can see it.)
- Renderer changes affect the **published bake** (renderFreeformSlide is shared by editor + bake + ad export) — verify every theme/layout variant in a node harness before shipping.
- No new npm deps if avoidable (worktree node_modules is symlinked to root; adding a dep breaks all worktrees). Sharp is installed; Bria/AI-gateway are HTTP (fetch) — no dep.
- Keep grade-param schema FORMAT-AGNOSTIC (shared module, Sharp emitter now, ffmpeg emitter later for video).

## SHIPPED already this session
- 2b-1 shell (#1439), click-select fix (#1440), 2b-2 real-render theme thumbnails (#1441). All live.

## Carousel/photo phases (DO IN ORDER)
- [ ] **2b-3 photo-forward renderer** — update `renderFreeformSlide`/`drawWhoopLayout` (overlayTemplates.js) so split/claim/badge render the PHOTO + editorial bottom scrim + headline lower-third (per mockup `carousel-editor-v2.html`), not a flat navy panel. Neutral for photoless slides. Verify: node harness renders all 6 themes × cover/explainer to /tmp, read JPEGs. Affects bake — confirm ad-export + publish still composite.
- [ ] **Phase 3 AI Photo Editor (Sharp grade engine)** — new shared module `api/_lib/gradeParams.js`: `applyGradeParams(sharp, params)` with exposure/contrast/saturation/warmth/tint/hue/highlights/shadows/clahe, all neutral-by-default (legacy rows render identically). Wire into `renderEditorialPhoto` + whoopTemplates. Store params in `content_items.photo_treatment`. Build the editor's Photo inspector to the mockup: vibe chips + Brightness/Warmth/Contrast/Vibrance/Depth sliders (functional, live preview via the SAME params) + Replace + "★ Brand look". Verify: node harness, read JPEGs at each slider extreme.
- [ ] **Phase 4 brand house look + Settings + auto-apply** — migration `workspaces.photo_grade_preset jsonb` (+ GRANT). Settings → Brand Look page (build mockup `colorist-brand-look.html`): describe-the-vibe + fine-tune sliders + save. Auto-apply preset at bake to every photo; per-photo override + reset. Subject-safe clamps server-side. Verify: consistency grid harness.
- [ ] **Phase 5 describe-a-look (Claude vision)** — `proposeGradeParams` via AI gateway (existing AI_GATEWAY_API_KEY) + structured-output JSON schema → pre-filled sliders for review before save. Model proposes, Sharp applies, store params (never re-call on re-render). Verify: probe a few prompts, read JPEGs.
- [ ] **Phase 6 subject-safe background grading (Bria)** — NEEDS BRIA API KEY. If absent: wire `api/_lib/segment.js` (Bria RMBG) behind a gated flag, mask cached per asset, differential grade (bg graded, subject composited back untouched), but DEFAULT OFF + leave "add BRIA_API_TOKEN" note. Do NOT fake. Verify only if key present.

## Video editor — RESEARCH + MOCKUPS ONLY (morning sign-off, NO build)
Q requirements: (1) voice-synced captions that follow the spoken audio in clips, AS WELL AS (2) regular manual text overlays; (3) the SAME AI visual editor as the photo colorist, for video frames; (4) good bones, NOT a full CapCut suite; (5) research heavily — see how competitors (CapCut, Descript, Opus Clip, Submagic, Veed, Kapwing, Captions.ai, Canva video, Adobe Express) handle captions + overlays + grade. Mirror the approved carousel v2 editor (left rail, scaling canvas, layer selection, contextual inspector) + a time axis/clip rail/trim.
- [ ] Competitive research doc `.claude/video-editor-research.md`
- [ ] Mockup(s) `.claude/mockups/video-editor-v1.html` (+ variants) — interactive, Bernard tokens, real-ish clip. Serve + screenshot to verify renders before handing over.

## DIAGNOSIS 2026-06-20 (carousel "flat navy" is NOT a bug)
Probed live canvas in Q's Chrome: bitmap 1080x1080 square, all navy+white-text, zero photo pixels. Theme minis (now real-render) prove: **Claim themes are intentionally photoless** (flat navy/cream editorial card); **Badge & Split ARE photo-forward** (drawWhoopLayout already draws the photo + scrim). This deck is on **dark-claim** → that's why no photo. So 2b-3 "photo-forward renderer" is mostly unnecessary — the renderer already does photo-forward for badge/split. Real 2b-3 work = (a) maybe a photo-backed claim variant, (b) scrim polish to match mockup — both CLIENT-CANVAS + SUBJECTIVE → **do WITH Q in Chrome, do NOT auto-ship.**

## REVISED ship/stage split (the honest one)
**AUTO-SHIP tonight (server Sharp, node-harness verified):**
- Grade engine `api/_lib/gradeParams.js` (format-agnostic schema + Sharp emitter + canvas emitter). 
- Wire grade into SERVER editorial photo compositor (brandRender.renderEditorialPhoto + whoopTemplates). 
- Phase 4 server: `workspaces.photo_grade_preset` migration + resolve + apply at editorial bake. 
- Phase 5 server: `proposeGradeParams` (AI gateway) → params (if AI_GATEWAY_API_KEY present).
**STAGE as PRs for Q's morning Chrome check (NO auto-merge):**
- Carousel in-editor AI Photo Editor panel + canvas grade emitter; 2b-3 photo-forward defaults/scrim; Settings Brand Look page UI.
**GATE/skip:** Phase 6 Bria (needs BRIA_API_TOKEN).
**MORNING for Q:** video research+mockups; Chrome-check + merge staged PRs; the 2b-3 taste call.

## ☀️ MORNING SUMMARY FOR Q (read this first)
Overnight sprint outcome. The colorist work split into: 1 thing LIVE, 1 staged PR for your Chrome, 2 mockups to sign off, 2 phases teed up for us to do together.

**LIVE on prod (auto-shipped, node-harness verified, zero visible change yet):**
- **#1442 — colorist grade engine** (`api/_lib/gradeParams.js`). Format-agnostic param schema + Sharp emitter wired into the editorial photo compositor. Legacy renders byte-identical (proven). It's the foundation everything else uses. No-op until UI sets params.

**STAGED PR — needs your ~3-min Chrome check, then merge (do NOT auto-merge):**
- **#1443 — carousel AI Photo Editor** (the colorist IN the editor). Click a carousel photo → AI Photo Editor: describe-a-look box (→ Claude proposes params), 4 one-tap vibes, 5 sliders (Brightness/Warmth/Contrast/Vibrance/Depth). Grades the photo only (panels/text clean); editor preview == publish bake. Also fixes a latent bug (bake ignored reframe/grade). Verify steps are in the PR body. The describe-a-look needs a live click (no AI key locally).

**MOCKUPS to sign off (then I build):**
- **Video editor** — `.claude/mockups/video-editor-v1.html` (verified renders). Mirrors the photo editor + a timeline: left layers rail (Video clip/Frame grade/Captions/Overlays + Transcript tab), 9:16 canvas-as-preview, bottom clip/captions/overlays timeline, contextual inspector. Captions = auto karaoke from the clip's Whisper transcript (editable via Transcript); overlays = manual text with in/out; **Frame grade = the photo colorist reused** (one schema, Sharp for photo / ffmpeg for video). Research: `.claude/video-editor-research.md` — KEY FINDING: Bernard already has the hard parts (Whisper word-timestamps, karaoke `buildKaraokeAss`, per-channel ffmpeg render, trim bar) → video editor is a re-IA + reskin, NOT greenfield. 8 open questions at the end of the research doc.
- (Carousel v2 editor already approved + 2b-1/2b-2 shipped earlier this session.)

**TEED UP — do WITH you (need your eye / a key), NOT auto-shipped:**
- **Phase 4 brand house look** ("set once, applies to every photo"): migration `workspaces.photo_grade_preset` + server auto-apply at bake + a Settings → Brand Look page + the "★ Save as brand look" button. The Settings page is UI → wants your sign-off (mockup `colorist-brand-look.html` exists). Small, clean follow-up.
- **2b-3 carousel photo-forward**: NOT a bug — the deck is on the photoless *claim* theme; *badge/split* already show the photo. It's a taste call (default theme / scrim) best made in 5 min in your Chrome.
- **Phase 6 subject-safe background grading**: needs a BRIA_API_TOKEN. Give me the key and I'll wire it gated.

**Est. spend tonight:** ~$8–14 (Opus build + 2 research/mockup subagents). -- Opus, Large

## Progress log (append as I go)
- (start) plan written.
- diagnosed carousel claim-vs-photo; revised split above. Next: build server grade engine (Phase 3 server).
- ✅ Phase 3 server grade engine shipped #1442 (auto-merge): api/_lib/gradeParams.js (schema + Sharp + canvas emitters) wired into renderEditorialPhoto, legacy byte-identical, node-harness verified. NO-OP in prod until a caller sets gradeParams.
- REFRAME: colorist value needs UI → Chrome → the rest is STAGED PRs + mockups for Q's morning, not blind prod ships. Building now: (a) carousel AI Photo Editor (client: PhotoInspector vibe+5 sliders+describe box; renderFreeformSlide applies gradeToCanvasFilter so preview==bake; src/lib/gradeParams.js mirrors api copy) — STAGED; (b) Phase 5 proposer endpoint (bundled w/ a); (c) brand look server+Settings + migration applied — STAGED; (d) video mockup (subagent). Phase 6 Bria gated.
