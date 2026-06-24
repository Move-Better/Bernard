# Unified editor shell — morning checklist (overnight sprint, 2026-06-24)

Q greenlit "Everything, Phases 0–4." Honest status: **Phase 0 shipped to prod; Phase 1 built + held for your Chrome-verify; Phases 2–4 spec'd for verified execution** (not built blind — they restructure the two main editors' layouts, which the deterministic gates can't verify, so building them while you slept would have risked a large diff you can't trust + likely rework). Reasoning in each section below.

What auto-merged overnight (safe): the docs/mockups (#1667) and the **Story editor (#1668)** — additive, real bug fix. Everything structural is held for your eyes.

---

## 1. ✅ Phase 0 — Story editor (SHIPPED to prod, #1668) — VERIFY

The original ask. `instagram_story` had no editor and dumped raw `LINK_STICKER_TEXT:` text. Now it has a real composer + 9:16 preview.

**Verify in your Chrome (the standard authed-prod procedure):**
1. Confirm live SHA: `curl -s https://withbernard.ai/version.json | grep sha` should match `git rev-parse origin/main`.
2. PWA cache: if the UI looks stale, the service worker is serving the old bundle — hard-bust per CLAUDE.md (unregister SW + clear caches + `location.replace('…?fresh='+Date.now())`).
3. Open the same Story piece from the screenshot: `movebetter.withbernard.ai/publish/f74a5aef-d88c-4baa-b593-d520eb87266a`
4. **Expect:** a 9:16 phone-frame Story preview (branded card since 0 media) with the overlay headline + a "Reserve Your Seat ›" link-sticker pill — **NOT** the raw `LINK_STICKER_TEXT:` text. Right side: Media (pick photo/video), Overlay text, Link sticker fields, Schedule.
5. Click **Pick photo or video** → attach a photo → it fills the frame, text overlays. Attach a video → play badge shows. Edit overlay text → preview updates on blur.

If anything's off, it's isolated to: `src/lib/storyFields.js`, `PostPreview.jsx` (`InstagramStoryPreview`), `StoryComposer.jsx`, `StoryboardPublish.jsx` story branch.

---

## 2. ⏳ Phase 1 — Shared EditorChrome + archetype backbone (HELD PR #1669) — VERIFY then MERGE

Built, all gates green (typecheck/lint/build/bundle-smoke 207/207), **held — not auto-merged** because it changes the carousel editor's top bar (visible UI on the team's main editor) and gates can't see pixels.

**What it does:**
- `src/lib/editorArchetype.js` — the 9-archetype matrix + `resolveArchetype()` (the backbone Phases 2–4 consume).
- `src/components/editor/EditorChrome.jsx` — shared top bar, extracted verbatim from SlideEditor's header.
- SlideEditor renders its top bar through `EditorChrome`; StoryboardPublish routes via `resolveArchetype()`.

**Verify (Chrome, after merging to prod OR on the PR's Vercel preview if it builds authed — it won't, so verify post-merge):**
1. Open any **carousel** piece: `…/publish/<carousel-piece-id>`. The top bar (back · title · "Instagram Carousel · N slides" badge · 1:1/4:5/9:16 aspect seg · Preview · Save · Schedule) should look + behave **identically** to before. Aspect toggle still switches; Save still saves; Schedule modal still opens.
2. Open a **reel** (video) Instagram piece and a **carousel** — confirm routing is unchanged (reel note vs carousel editor).
3. If identical → `gh pr merge 1669 --squash`. If any pixel/behavior drift → it's all in `EditorChrome.jsx` (compare against the pre-change header markup in git history).

**Why this is safe to merge after a 1-min look:** the header markup was moved 1:1 into `EditorChrome`; the only intended change is *where the JSX lives*, not what it renders.

---

## 3. 📋 Phases 2–4 — spec'd, execute WITH Chrome in the loop

Full spec: **`.claude/unified-shell-phases-2-4-spec.md`** (code-grounded — exact files, components, diffs, risks). Summary of why each needs you in the loop:

- **Phase 2 — VideoEditor adopts EditorChrome + `EditorSurface` mount-switch.** VideoEditor's controls currently live *inside its left inspector*, not a top bar. Giving it the shared chrome **moves controls into a new top bar** — a real layout change. Must be Chrome-verified (the reel editor is Clerk-prod-locked; no node harness). Do it as one PR, verify the reel editor end-to-end, merge.
- **Phase 3 — Unified IconRail + media-tier states.** One rail filtered by the archetype matrix; the text-only canvas state for media-optional channels (X/LinkedIn/etc.) + Google-Ads copy-only. Net-new UI per the `unified-shell-all-channels.html` mockup — mockup-first, then build.
- **Phase 4 — Single entry route.** `/publish/:pieceId` resolves archetype → mounts the right surface; fold in `/slate/clip/:assetId`. **Router `*` catch-all footgun** (CLAUDE.md / PR #729) — highest-risk; do last, verify deep-link routing.

Recommended order: verify+merge Phase 1 → Phase 2 (one PR, Chrome-verify reel) → Phase 3 (mockup→build) → Phase 4 (router, careful).

---

## TL;DR
- **Shipped + live:** Story editor (#1668). Verify it solves your original question.
- **Built, awaiting your 1-min Chrome-verify + merge:** Phase 1 shared chrome (#1669).
- **Ready to execute fast, verified:** Phases 2–4 (`.claude/unified-shell-phases-2-4-spec.md`).
- Nothing structural was merged to prod unverified.
