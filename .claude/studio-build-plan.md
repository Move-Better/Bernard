# Bernard — Studio/Edit/Slate Build Plan

**Created:** 2026-06-02 · **Status:** approved direction, ready to build · **Owner:** Q
**Source of truth:** the locked mockups in `.claude/mockups/` — each is the page-specific spec. Build to match them closely (side-by-side check per page). Strategy: [[project_bet_against_slop_strategy]]; product truths: [[project_studio_consolidation_product_truths]].

## Ground rules (apply to every phase)

1. **The mock is the spec.** Each PR's page must match its locked mock closely — same layout, same tokens (the mocks already use the real `src/index.css` HSL vars), same interactions. Do a literal side-by-side before opening the PR. Page-specific fidelity is a Definition-of-Done item, not a nice-to-have.
2. **Don't reinvent — diff the real app.** Every page maps to existing components (mapped below). Re-skin/extend them; don't greenfield. ([[feedback_mockup_must_diff_real_app]])
3. **Keep what's confirmed fixed:** Home/landing stays **as-is**; the **Create** button keeps its **current `/new` options** (Interview · Voice memo · Handout · Live interview · Import).
4. **No trial gating** (Q's call) — drop feature-flags/trial periods. But still ship **one prod-safe PR per phase**, rebased on `origin/main`, ≤3 unmerged in flight (CLAUDE.md branch workflow). Each phase is independently shippable.
5. **Buy-before-build the heavy bits:** visual re-render = the existing render pipeline (`renderSlides.js` / `brandRenderVideo` / ffmpeg), not a new engine; outcome signals = integrate Buffer/Meta + intake, not a new analytics platform. (Strategy: rent execution, own the loop.)

---

## Phase table

| Phase | What | New vs re-skin | Est. Days | Est. Claude Cost | Model |
|---|---|---|---|---|---|
| **0. Stabilize** | Triage current breakage before building (`/checkup` + `/audit`, fix P0s) | — | 0.5–1d | $3–8 | Sonnet/Opus |
| **1. Flow framing + the Switch** | Two-act framing on Stories→Storyboard; the "words validated → out the door" transition screen; blog-only validate surface | mostly re-skin + 1 new screen | 1–2d | $4–8 | Sonnet |
| **2. Single-post visual editor** | `StoryboardPiece`/content editor → the `single-post-edit` mock: visual hero, words=caption strip, manual media controls, per-post schedule, new-tenant media fallback, campaign band (display) | re-skin + extend | 2–4d | $8–18 | Sonnet (Opus for render glue) |
| **3. Carousel editor** | `SlideEditor` → the `carousel-post-edit` mock: slides chooser, edge-to-edge full preview, per-slide editor, change-look-across-slides (manual) | re-skin + extend | 2–3d | $8–15 | Sonnet |
| **4. "Change the look" — AI visual conversation** | NEW: natural-language → render-param changes (font size, brand colors, brightness, layout) via existing render pipeline. Powers posts + carousels + slate. "AI turns the same knobs." | **new capability** | 4–7d | $20–40 | Opus |
| **5. Slate clean treatment** | `Slate.jsx` + `SlateClipEditor` → the `slate-clean` mock: clean workshop grid, hero clip, transcript grounding, "Polish this clip" conversation (auto-suggest elevated onto P4), manual trim/caption, two output sinks, consent gate | re-skin + extend | 2–3d | $8–15 | Sonnet |
| **6. Portfolio views** | Stories Cards/Pipeline/Calendar/Campaigns + Overview → the `portfolio` mock: publisher-inbox highlight, role-aware "what needs me" banner, filters, by-story cards | re-skin (most exists) | 1.5–3d | $6–12 | Sonnet |
| **7. Outcome loop (campaign = driver, AI = engineer)** | NEW wedge: campaign drives aim; AI works the goal in background (run·measure·tweak); cheap signals (Buffer/Meta engagement + intake "how'd you hear") fed back into content **selection/aim**, never voice | **new capability** | 5–10d | $25–60 | Opus |
| **8. AI-learns-from-edits** | NEW: diff the clinician's direct blog/caption edits → voice-library signal (today phrases come from approval only) | new (small) | 1.5–3d | $6–14 | Sonnet |

**Near-term, faithful, low-risk:** 0 → **1a** → 1 → 2 → 3 → 5 → 6 (re-skins of pages to match mocks + the Switch).
**The two big bets (heavier, do after surfaces exist):** 4 (AI visual conversation) and 7 (outcome loop) — the actual moat. 8 slots in whenever edit surfaces are live.

### ★ Phase 1a — Publisher clarity (PULLED TO FRONT — the live acute pain)
**Why first:** checkup 2026-06-02 came back all-green on build/tests/prod — the real problem is UX, not bugs. Q: *"It's just functionally not good. Publisher not sure what to do on it."* The Publisher lands in the app with **no clear job**. This is the single most acute failure and one of the cheapest fixes — pull the publisher-facing pieces of Phase 6 forward and ship them first.
- **Real files:** `Layout.jsx` (tier-based default landing — `producer`/publisher tier already drives "producer-restricted UX (nav filtering + default landing)"), `Overview.jsx` / `Stories.jsx` + `PipelineKanban.jsx`, `roles.js` tiers.
- **Build:** (1) **Publisher/producer default landing = the "out the door" inbox** (the Ready-to-Distribute lane), not a generic page. (2) The **role-aware "what needs me" banner** from the `portfolio` mock ("7 posts ready to go out the door — review & schedule each"). (3) **Publisher-inbox warm highlight** on the Ready-to-Distribute lane so the eye lands on "do this now." (4) One obvious primary action per inbox card → opens the post editor.
- **Fidelity check:** the banner + publisher-inbox lane in `portfolio.html`; the "out the door" framing in `two-act-flow.html` / `walkthrough.html`.
- **Est:** 1–2d · $5–10 · Sonnet. Mostly role-aware landing + banner + inbox treatment on surfaces that already exist.

---

## Per-phase detail

### Phase 0 — Stabilize ("Narrate is a little broken")
Don't build new surface on a broken base. Run `/checkup full` + `/audit`, fix P0/P1 blockers (the things actually broken right now), get lint/typecheck/build/verify-bundles green, confirm prod health. Output: a short "what was broken / what's fixed / what's deferred" note. **This is the immediate next action — I can run it now.**

### Phase 1 — Flow framing + the Switch
- **Real files:** `src/pages/Stories.jsx`, `StoryDetail.jsx`, `ContentPlanPanel.jsx`, `PipelineStepper.jsx` (exists), `Storyboard.jsx`.
- **Re-skin:** Validate surface = the keystone blog shown **alone** as the approve moment (today it's `KeystoneHeroCard` stacked above 12 atom rows — defer the atoms until after approval). Vocab already unified (#1147).
- **New:** the **Switch** screen (`two-act-flow` mock) — after blog approval, the calm-ink→ship-orange transition into "out the door."
- **Fidelity check:** `two-act-flow.html` (Act 1 + Switch + Act 2).

### Phase 2 — Single-post visual editor
- **Real files:** `StoryboardPiece.jsx`, `StoryboardPublish.jsx`, `story-detail/AssetsPane.jsx`, `platformMediaKind.js`.
- **Re-skin to mock:** visual hero (the post preview), **words = caption strip under it** (AssetsPane's always-editable body, shrunk), manual media controls (reframe/trim/caption — partly exist via render-clip), **per-post singular schedule**, **new-tenant media fallback** (interview frame / text template / upload), **campaign-as-driver band** (display only in P2; tuning lands P7).
- **Defer to P4:** the "Change the look" AI conversation (manual controls ship first; mock degrades gracefully).
- **Fidelity check:** `single-post-edit.html`.

### Phase 3 — Carousel editor
- **Real files:** `story-detail/SlideEditor.jsx`, `lib/renderSlides.js`, `lib/carouselThemes.js`, `content_items.slides`.
- **Re-skin to mock:** slides chooser **above** controls, **left = pure preview**, **edge-to-edge Full preview**, per-slide editor (on-slide text + role + photo), caption distinct from on-slide text. "Change the look across slides" = manual in P3, AI in P4.
- **Fidelity check:** `carousel-post-edit.html`. Preview must equal published (renderSlides bakes — kills preview≠publish bug class).

### Phase 4 — "Change the look" (AI visual conversation) — the new editor capability
- **What:** natural language ("bigger headline", "brand navy", "brighter", "match brand book", "tighten to 4 slides") → mapped by AI (Gateway) to **render parameters**, applied via the **existing** render pipeline (`renderSlides` for slides, `brandRenderVideo`/ffmpeg for video/caption). The manual knobs from P2/P3 are the param surface; the AI just sets them → "talk to it OR grab the knob."
- **Real files:** new `api/editorial/restyle.js` (instruction→params), `renderSlides.js`, `render-clip.js`, brand-book/theme resolution.
- **Build-vs-buy:** do **not** build a Remotion. ffmpeg + renderSlides cover v1; revisit only when "designed/animated" compositions are the real ask.
- **Powers:** single post, carousel, and Slate clip "Polish."
- **Fidelity check:** the "Change the look" panels across `single-post-edit` / `carousel-post-edit` / `slate-clean`.

### Phase 5 — Slate clean treatment
- **Real files:** `Slate.jsx`, `SlateClipEditor.jsx`, `api/editorial/render-clip.js`, `clip-to-post.js`, `clip-counts.js`.
- **Re-skin to mock:** workshop grid (source videos, consent up front, clip counts), hero clip + Full preview, **transcript grounding** ("what he actually said"), **"Polish this clip" conversation** (elevate the existing auto-suggest onto P4's engine), manual trim/caption, **two output sinks** (As-a-post → Storyboard / As-b-roll → Library), consent gate blocks output. Slate never publishes.
- **Honor the contract:** caption **size/position deferred** (one band, template position) per [[project_slate_rework_clip_workshop]].
- **Fidelity check:** `slate-clean.html`.

### Phase 6 — Portfolio views
- **Real files:** `Stories.jsx` + `components/stories/*` (Cards/Pipeline/Calendar/Themes views, ViewToggle, Filters, CampaignProgressStrip), `PipelineKanban.jsx`, `Overview.jsx`.
- **Re-skin to mock:** "Ready to Distribute" = warm **publisher inbox**, **role-aware "what needs me" banner** (clinician=blogs to approve / publisher=posts to ship), staff/campaign filters, by-story Cards with keystone + child stage-breakdown. Most already exists — this is alignment + the banner + inbox treatment.
- **Fidelity check:** `portfolio.html`.

### Phase 7 — Outcome loop (the moat)
- **What:** the Campaign is the driver; the AI works the goal continuously in the background (run·measure·tweak·spin). Pull **cheap** signals — Buffer/Meta engagement (partly integrated) + intake "how'd you hear?" — and feed them back into **which real piece → which audience → which moment** (selection/aim), **never the voice**.
- **Real files:** `campaignAllocation.js`, `atomPlan.js`, `CampaignsSettings.jsx`, AI Gateway, engagement integrations.
- **Build-vs-buy:** integrate signals, don't build a CRM/analytics platform. **Measure before over-investing** (Phase 2 of the Slate-style "ship then measure" rule).
- **Fidelity check:** the campaign band ("AI tuning live / run the numbers") in `single-post-edit` + the Campaigns view in `portfolio`.

### Phase 8 — AI-learns-from-edits
- **What:** diff the clinician's direct edits to blog/caption → voice-library signal, so next drafts lean toward how they actually phrase things. Today voice phrases come from approval/capture only.
- **Real files:** `AssetsPane` save path, `captionGen`/voice-phrase pipeline, `prompts.js` voice grounding.
- **Fidelity check:** the "AI learns from your edits" note in `single-post-edit`.

---

## Sequencing & PR hygiene
- One branch/PR per phase off current `origin/main`; rebase before each; `gh pr merge --auto --squash`; ≤3 unmerged in flight.
- Phases 2/3/5/6 each touch different page trees → low conflict; can parallelize after Phase 1.
- Phase 4 is a shared dependency for the "AI conversation" parts of 2/3/5 — those ship manual-first, then 4 lights up the conversation across all three.
- After each merge, verify the live SHA (`version.json`) and click the real page against its mock.
