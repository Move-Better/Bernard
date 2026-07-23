# Competitor UI/UX Benchmark — Bernard vs. Narrate (trynarrate.com) & Narrato (narrato.io)

**Date:** 2026-06-06
**Author:** Claude (investigation + recommendation only — no code changed)
**Trigger:** Q felt both competitors' landing pages AND in-app UI look "a good bit better" than Bernard's current experience.

**How this was gathered:**
- **Narrate / Narrato landing + app:** live-rendered SPAs, pricing pages, Product Hunt / G2 / Capterra listings, feature pages, YouTube tutorial titles. App internals for Narrate came partly from its **no-login live demo at `/demo/recording`** (the real app shell); Narrato app internals are reconstructed from feature pages + reviews (labeled where inferred).
- **Bernard:** driven live through Q's logged-in Chrome against **prod** (`movebetter-people.withbernard.ai`), read-only — screenshots of Overview, Stories, Library, New/Create, Review Inbox, Slate, onboarding step 1. Public landing copy via WebFetch.
- **One gap:** `withbernard.ai` redirects a logged-in user straight to `/onboard`, so I captured the **full landing copy + section structure** but not the **rendered landing visual**. To screenshot the marketing hero as a prospect sees it, do it from a logged-out browser/incognito. Everything else is first-hand.

---

## TL;DR — the three things that actually matter

1. **Narrate's whole site is one promise, shown literally.** Hero shows *voice in → finished post out* in a single glance, the demo needs no login, and every section reinforces one outcome. Bernard's landing copy is genuinely strong ("One conversation. A month of content — in your actual voice.") but we don't (yet) **show the transformation visually** the way Narrate does, and our authed app opens onto a **dense 12-item sidebar** instead of one obvious next action.
2. **Narrate's polish is editorial and consistent** (Fraunces serif + warm cream, identical look in marketing and app). Bernard already shares Narrate's warm-neutral instinct (orange accent, cream surfaces) but has **visible polish gaps**: a **blank Home page**, **missing/grey media thumbnails in Library**, and a **heavier, busier IA**.
3. **Narrato's lesson is structural, not visual:** one content object seen through four synchronized lenses (folder / calendar / board / workflow-status), and an **AI "Content Genie" that lands drafts in a reviewable queue** — which is exactly Bernard's Review Inbox / Overview-queue pattern, validated at scale. Steal Narrato's IA discipline, not its "does-everything" breadth (that breadth is the slop Bernard is betting against).

---

# 1. Narrate (trynarrate.com) — teardown

**What it actually is:** not a general voice→content tool — it is laser-focused on **one job: 60-second voice note → polished LinkedIn post → scheduled to LinkedIn.** Sharper positioning than expected, and the single biggest strategic takeaway.

## 1a. Landing page

**Hero**
- Eyebrow pill: "● Loved by creators, job seekers & professionals"
- **H1:** "Build Your Professional Brand on LinkedIn—Without Writing"
- **Subhead:** "Speak for sixty seconds. We turn it into a crafted post with hooks, narrative, and CTA. Publish in minutes instead of weekends."
- **Primary CTA:** "🎙 Start recording now" (solid near-black pill, white text, leading mic icon)
- **Secondary CTA:** "Try Demo First →" (ghost outline)
- Reassurance under CTAs: "No login required—experience the workflow instantly."
- **The hero's right column is the killer element:** an animated product mock showing **🎙 YOU SPEAK** (live audio waveform + transcript line) → **→ AI WRITES →** → **YOUR POST READY** (a real, formatted LinkedIn post + "✅ Ready in 90 seconds"). Input→output in one glance, zero abstraction.
- Three stat cards under CTAs (big Fraunces serif number + caption): **8 hrs** saved/week · **12k+** avg impressions/post · **2 min** idea→scheduled.

**Section order:** Hero → "See Narrate in Action" (scrollytelling 3-step stepper: Record/Generate/Schedule) → "From Thought to Post in 3 Steps" (each step time-chipped 30s/60s/15s) → "Why Professionals Who Post Consistently Win" (6 stat-led benefit cards) → "Real Examples" (3 **pixel-faithful fake LinkedIn cards** with full engagement bars: 247 likes / 23 comments / 12 shares) → "Why 90% Fail at LinkedIn" (emoji pain cards) → "Narrate vs. Agencies" (6 comparison cards: "$3,000–10,000/month vs. $17/month") → urgency interstitial → 10-item objection-handling FAQ → footer.

**Pricing:** two cards only — Pro Monthly **$17/mo** ("Most Popular") and Pro Yearly **$156/yr** ("Best Value", green "Save $48"). Free trial is the funnel.

**Typography / color / motion**
- **Headings: Fraunces** (high-contrast editorial serif, 600) — deliberately *not* the category-default sans, reads "writing/craft tool." Body: Inter.
- **Palette (sampled):** warm cream bg `#fbfaf9`, card `#fcfcfb`, ink `#24211c`, buttons near-black `#24211c`, borders `#dfdedc`. Accents: **green** (value/success), **coral/pink** (record-button halo). Near-monochrome, generous whitespace, hairline-bordered rounded cards.
- **Motion:** animated waveform; typewriter reveal on "post ready"; scroll-driven stepper with progress bar + dots; accordion FAQ.

## 1b. App UI (from the live `/demo/recording` shell — real product, not a mock)

- **IA is 3 surfaces + 1 persistent action:** top nav `Dashboard · Record · Posts` + an always-present dark **🎙 Record** button top-right. The product has a strong opinion: capture is the one recurring action, reachable from anywhere.
- **Record screen:** centered Fraunces "Speak your mind" → big `00:00` timer → **a rotating prompt chip that cycles every few seconds** ("💼 Share a professional insight…" / "🎯 Describe your expertise…") → large dark circular mic button with a coral halo. Calm, single-action, lots of breathing room. The rotating prompt *is* the empty-state — it solves "I'm staring at a live mic with nothing to say."
- **Onboarding = the funnel:** "Try Demo First" runs the real core loop with **zero signup**; the demo loads the real app shell so trial→paid is seamless.
- **Editor (inferred from copy/FAQ/pricing, not directly seen):** generated post in LinkedIn short-line format, inline edit/refine, Schedule + post-to-LinkedIn. "Posts" = library of drafts/scheduled.

## 1c. What Narrate does better — concrete, stealable

1. **Ruthless single-outcome focus** — voice → LinkedIn post → scheduled. Copy never hedges.
2. **Show input→output literally in the hero** (waveform → "AI writes" → rendered post). The transformation *is* the visual.
3. **Social proof as output demonstration** — pixel-faithful example posts with engagement bars beat a logo wall for an early product.
4. **No-login live demo of the core loop** that loads the real app.
5. **Rotating prompt chip on the empty record screen** — cheap, high-leverage anti-blank-mic nudge.
6. **Quantified, time-stamped claims everywhere** (8 hrs, 8x, 73%, "trained on 1,000+ viral posts", 30s/60s/15s chips).
7. **Editorial serif + warm cream** = differentiates from the generic blue/purple "AI tool" look.
8. **Anchors against the expensive incumbent** ($3k–10k agencies, ChatGPT) — picks the flattering comparison.
9. **Persistent primary action** in the nav on every screen.
10. **Problem→agitation→solution copy arc**, scannable emoji pain cards.

---

# 2. Narrato (narrato.io) — teardown

**Status:** live site leads with a retirement banner (shutdown **June 15, 2026**) + Typeface-acquisition notice. Positioning is the opposite of Bernard: breadth ("does everything") vs. a sharp wedge.

## 2a. Landing page

- **H1:** "The only AI content platform that does everything you need"
- **Subhead:** "Ideate, Create, Collaborate and Publish - All in one place"
- **CTAs:** "Get Started Free" + "Get a Demo" (self-serve + sales-assist pair).
- **Structural trick worth stealing:** the subhead's four verbs (Ideate/Create/Collaborate/Publish) become the four mid-page sections become the four product pillars — the page teaches the IA before signup.
- **Section order:** retirement notice → acquisition notice → hero → G2/Product Hunt badges → 4 workflow benefits → AI Content Assistant (100+ templates) → AI Content Genie (autopilot) → workflow & collaboration → content planning/SEO → publishing → 3 customer stat blocks → ~18-logo wall → 4 use-cases → ~10 named testimonials → repeat-CTA → footer.
- **Social proof, layered by type** (each does a different job): stats ("2-5x productivity", "100s hours saved", "80% lower cost") → logo wall (Chargebee, Zepto, Rocketlane, MasterControl…) → G2 + Product Hunt badges → named quotes → PH 4.9/5. Note the stats are round/unsourced — confident but soft.
- **Type/color:** clean modern sans, strong size hierarchy; primary **blue/teal** on white, gray accents (exact hex not exposed). Screenshot-per-pillar. Motion not confirmed.
- **Pricing:** Free ($0, genuinely usable: 25 items/mo) → Pro (+$9/extra seat) → Business ("🔥 Most Popular", unlimited AI writing, +$19/seat) → Enterprise. **Per-seat with character/credit budgets** — a legible metering model (though power users find credits frustrating).

## 2b. App UI (text-derived; internals inferred)

- **The strongest, most stealable part — one object, four synchronized views:** an explicit **"drive-like structure"** (Projects → Folders → Subfolders → Content items) acting as a content repository, with cross-cutting **Content Calendar** (per-project **and** a **Global Calendar = all projects at once**), **Lists**, **Boards** (kanban), and **custom color-coded workflow statuses** that drive both visual progress AND automation (stage change → auto-assign/notify/publish). One content item is simultaneously a file, a dated event, a kanban card, and a workflow row.
- **Two entry paths:** template-first (100+ AI templates → editor) and brief-first (AI topic generator → auto SEO brief → editor).
- **Editor:** **inline AI assistant on text selection** (summarize/simplify/rewrite/shorten) + a docked **AI Chat** panel, with a **live SEO scoring rail** (keywords + score update as you type), grammar/readability/plagiarism checks. AI lives *where the writing happens*, not on a separate route.
- **AI Content Genie (autopilot):** per-site/theme "Genie projects" generate weekly + on-demand, then **serve a feed of channel-optimized drafts with inline image recommendations** to review → edit → schedule. Autopilot output lands as a **reviewable approval queue**, not auto-posted.
- **Onboarding (from reviews):** "intuitive" first-action, but the documented con is **feature-overload learning curve** — breadth taxes mastery.

## 2c. What Narrato does better — stealable

1. **One content object, four synchronized lenses** (folder/calendar/board/workflow). Maps directly to a Bernard story/atom carrying folder-home + scheduled-date + pipeline-status without duplicate records. The **Global Calendar (all projects/locations at once)** especially fits multi-location workspaces.
2. **Status color = the state machine made visible** (and the automation trigger), never decoration.
3. **AI assistant inline-in-editor + docked chat**, not a separate "AI page."
4. **Live SEO/quality scoring rail** docked beside the editor — the target is always visible.
5. **Autopilot-as-review-queue with inline media recommendations** — don't make the user go hunt for media separately.
6. **Marketing→product structural mirror** (verb-spine → section-spine → pillar-spine).
7. **Proof layered/segmented by type**, not dumped in one band.

**Do NOT copy:** breadth-as-pitch (→ feature overload), credit metering friction, shallow generic generation. That "everything tool" surface area is precisely the slop Bernard differentiates against.

---

# 3. Bernard — current live UI teardown (prod, authed)

## 3a. Landing page (copy/structure captured; visual not — logged-in redirect)

- **Title:** "Bernard — One conversation. A month of content. In your actual voice."
- **H1:** "One conversation. A month of content — in your actual voice."
- **Subhead:** "Talk for fifteen minutes about your work. Bernard turns it into a month of blog, social, email, and Google posts — written from what you actually said, in a voice that sounds like you."
- **CTAs:** "Claim a founding spot →", "Watch it work ↓", "See pricing".
- **Sections:** See it work → How it works → Why it's different → "Stop staring at a blank page. Just talk." → Newsletter.
- **Key phrases:** "15 min of talking — that's your whole job", "30+ finished posts every month", "Other tools start from a blank box. This one starts from you."
- **Social proof:** founder quote (Dr. Q) + 3 Move Better clinics.
- **Assessment:** the **copy is excellent** — arguably sharper than Narrate's and clearly differentiated ("starts from you, not a blank box"). The likely gap vs. Narrate is **visual execution of the hero**: Narrate *shows* voice→post in an animated mock above the fold; we have a "Watch it work" link and a "See it work" section, which is one click of indirection. (Confirm by screenshotting the rendered hero from a logged-out browser.)

## 3b. Authed app — IA

Left sidebar (expanded), grouped: **Create** (primary orange button) · Home · Overview *(Clinic)* · Analytics *(Performance)* · **PRODUCE:** Review *(Approve & schedule)* / Stories *(Words)* / Storyboard *(Media · Publish)* · **LIBRARY:** Library · **TOOLS:** Book / Pre-Visit / Slate *(new)* · Knowledge synthesis · Settings · My profile.

- **~12 primary nav items** vs Narrate's 3 and Narrato's view-based shell. Several names are non-obvious without their gray subtitle (Overview=Clinic, Stories=Words, Storyboard=Media·Publish, Review=Approve&schedule). This is the **single biggest contrast** with Narrate's "one obvious action" shell.

## 3c. Surface-by-surface

| Surface | State | Notes |
|---|---|---|
| **Home** (`/home`) | ⚠️ **Renders blank** | Content pane stayed empty across a fresh nav + reload. Either a render-wedge or an unbuilt page. Overview is the de-facto home. **This is the first screen a confused user lands on — high-impact bug.** |
| **Overview** (`/overview`) | ✅ **Strongest surface** | Warm-orange "Your queue: 4 posts ready… Work the inbox →" CTA banner; "This week at the clinic" recap (orange gradient, 4 stats: went live / scheduled / waiting / captured); "Went live" list + "Going out next" + "Needs the team"; dark "All time" card (19 posts, 16 stories, 5 teammates, ≈$9.82 run cost); "The team" streaks. Genuinely good — recap-driven, warm, narrative. |
| **Stories** (`/stories`) | ✅ Good | Card grid, status badges (Published/Scheduled/Drafting/Capture), author chips, platform pills (GBP/LI/FB/IG/Blog), campaign tags. Filter row = 5 tabs + **6 dropdown filters** (Real moments/Campaign/Platform/Stage/Location/Archetype) — powerful but heavy. |
| **Library** (`/library`) | ⚠️ Polish gap | Media grid, status badges (Approved/Tagged), Collections expander, Upload/Import from Drive. **Several photo thumbnails render blank-grey** — visible quality gap vs. competitors' clean grids. |
| **New / Create** (`/new`) | ✅ Clean | 6 capture cards (Interview · Write a newsletter · Voice Memo · Photos & Video · Live Interview BETA · Import writing) + iOS Shortcut + "Seminar/Talk — coming soon". Clear, well-organized capture hub. |
| **Review Inbox** (`/review-inbox`) | ✅ Good | Approve-queue: "One queue for everything… review the words, then approve and schedule." Platform-tagged rows, "Needs media" status, media counts, Open, Select all, Producer view. This is Bernard's version of Narrato's Content-Genie queue + Narrate's schedule step — conceptually ahead. |
| **Slate** (`/slate`) | ✅ Good | "Turn raw video into clips." Tabs (Needs cutting 77 / Clips to review 21 / In progress 2 / Coverage), video grid with author + "consent ok" + "Cut a clip" + duration. Dense but purposeful. |
| **Onboarding** (`/onboard`) | ✅ Good | Step 1 of 8 "Let's start with your website" — scan-first, clear progress bar, reassurance copy ("nothing is published until you finish"), skip option. Solid, on-brand. |

**Palette:** warm — orange primary (`#e8855a`-ish), cream/off-white surfaces, near-black ink. **Same family as Narrate's warm-cream instinct.** Identity is consistent across surfaces (good), but type is standard sans throughout — no editorial-serif differentiation like Narrate's Fraunces.

---

# 4. Side-by-side — what they do better than Bernard *specifically*

| Dimension | Narrate | Narrato | Bernard today | Gap |
|---|---|---|---|---|
| **Hero shows the transformation** | ✅ animated voice→post above fold | screenshot-per-pillar | "Watch it work" link; "See it work" is a section below | **Show input→output visually above the fold** |
| **One obvious action** | ✅ persistent 🎙 Record everywhere; 3-item nav | view-based | **12-item sidebar**, blank Home | **Collapse IA; make capture the unmistakable primary** |
| **No-login demo** | ✅ real app at `/demo/recording` | free tier | founding-spot gate | **Add a no-login "try the loop" demo** |
| **Empty-state coaching** | ✅ rotating prompt chips on mic | template-led | onboarding good; in-app empty states unverified | **Rotating prompt chips on capture screens** |
| **Editorial visual identity** | ✅ Fraunces + cream | generic blue | warm orange, standard sans | **Add a display serif for headings** |
| **Output-as-proof on landing** | ✅ fake LinkedIn cards w/ engagement | logos+quotes | founder quote + clinics | **Render real example outputs on landing** |
| **Synchronized object views** | n/a | ✅ folder/calendar/board/status | Stories(cards)+Review(queue)+Slate separate | **Unify into shared views incl. a global calendar** |
| **In-editor inline AI + live score** | n/a | ✅ selection AI + SEO rail | per-piece edit exists; inline AI/score unverified | **Inline AI + live voice/AIM-fidelity rail in the words editor** |
| **Polish (thumbnails, no blank pages)** | ✅ consistent | ✅ | ⚠️ blank Home, grey thumbnails | **Fix blank Home + Library thumbnails** |

**Where Bernard already wins (keep/lean in):** sharper differentiated copy ("starts from you, not a blank box"); multi-staff/multi-location model; the Overview recap + run-cost transparency; a real approve-then-schedule **producer queue** that Narrate lacks and Narrato only partially has; voice-fidelity as the core bet.

---

# 5. Prioritized punch list

> Each item ties to a competitor pattern and (where identifiable) the file/component. Component paths are best-guess from the documented architecture — grep to confirm before building. **No code was changed in this task.**

## P0 — credibility / first-impression breakers

- **P0-1 — Fix the blank Home page.** First authed screen renders empty (persisted across reload). Either route `/home` → `/overview`, or build/repair Home. Pattern: Narrate/Narrato never show a blank shell. *Touches:* `src/App.jsx` route for `/home` + the Home page component; check for an OrgGate/render-wedge (cf. `feedback_orggate_wedged_render_live_token_gate`). **-- Opus, Medium** (diagnose first).
- **P0-2 — Fix Library blank/grey thumbnails.** Several photo tiles render with no thumbnail — reads as broken next to competitors' clean grids. *Touches:* Library grid component (`src/components/` Library*/AssetsPane) + thumbnail pipeline (`api/_lib/thumbnail.js`); verify `web_blob_url` population + the detail-drawer refresh contract. **-- Sonnet, Medium**
- **P0-3 — Capture the rendered landing visual & close the hero gap.** From a **logged-out** browser, screenshot `withbernard.ai` hero; then add an **above-the-fold input→output visual** (waveform/transcript → finished post card), mirroring Narrate's hero mock, instead of relying on a "Watch it work" link. Copy is already strong — this is purely visual. *Touches:* landing/marketing hero component. **-- Sonnet, Medium**

## P1 — high-leverage UX wins

- **P1-1 — Collapse the 12-item sidebar.** Narrate ships 3 nav items; we have ~12 with cryptic primary labels (Overview/Stories/Storyboard). Group under fewer top-level homes (e.g. Capture · Produce · Library · Insights), and make **Create** the visually dominant, persistent action. *Touches:* sidebar/nav component (`src/components/` SidebarNav / AppShell). **-- Sonnet, Medium**
- **P1-2 — No-login demo of the core loop.** Narrate's `/demo/recording` lets a prospect feel the product with zero signup and loads the real shell. Add a sandboxed "talk for 60s → see a draft" demo. *Touches:* new route + a guarded demo capture flow. **-- Opus, Large**
- **P1-3 — Rotating prompt chips on capture screens.** Narrate's cycling "💼 Share a professional insight…" defeats the blank-mic freeze — and matches our own "Stop staring at a blank page" landing promise. Add to Voice Memo / Interview / Live Interview empty states. *Touches:* capture screen components (InterviewSession / Voice Memo / `/new` sub-flows). **-- Sonnet, Quick–Medium**
- **P1-4 — Output-as-proof on the landing.** Replace/augment the founder quote with **rendered real example outputs** (a blog card, an IG post, a GBP post produced by the tool) the way Narrate shows example LinkedIn cards. *Touches:* landing page sections. **-- Sonnet, Medium**
- **P1-5 — Editorial display serif for headings.** Adopt a high-contrast serif (Fraunces-like) for H1/H2 on landing + key app headers to escape the generic-sans "AI tool" look and signal "real voice / craft." *Touches:* `src/index.css` font tokens + heading classes. **-- Sonnet, Quick** (design decision first).

## P2 — structural / longer-horizon

- **P2-1 — Global calendar across locations/staff.** Narrato's "all projects in one view" calendar fits our multi-location workspaces. A scheduling calendar lens over Stories/Review items. *Touches:* new calendar view reading `content_items` scheduled dates. **-- Opus, Large**
- **P2-2 — Synchronized views over one content object.** Let a story/atom appear as card (Stories), queue row (Review), and calendar event without duplicate records — Narrato's single-object/four-lens model. *Touches:* shared data layer + view components. **-- Opus, Large** (architecture review first).
- **P2-3 — Inline AI + live voice-fidelity rail in the words editor.** Narrato docks inline selection-AI + a live SEO score; our analog is a **live voice/AIM-fidelity score** (we already have `captionFidelity` infra). Surface it as a docked rail in the editor. *Touches:* words/Stories editor + `api/_lib/captionFidelity.js`. **-- Opus, Large**
- **P2-4 — Tighten Stories filter density.** 6 dropdowns + 5 tabs is heavy. Demote rarely-used filters behind a "More filters" control. *Touches:* Stories filter bar. **-- Sonnet, Quick**
- **P2-5 — Quantified, time-stamped claims on landing.** Borrow Narrate's specificity (we already say "15 min", "30+ posts/month" — make them stat cards with proof). *Touches:* landing. **-- Sonnet, Quick**

---

## Appendix — sources
- Narrate: `trynarrate.com` (home, `/pricing`, live `/demo/recording`). No dedicated Product Hunt/demo-video found for *this* product; teardown is from the live site/app. Several "Narrate"/"narrate-app" results are unrelated products.
- Narrato: `narrato.io` (home, `/pricing`, feature pages for AI assistant / workflow / planning / publishing, `ai-content-genie`), Product Hunt, G2, Capterra; YouTube "Guide To Narrato Workspace" playlist (titles only). Exact hex, motion, in-app screenshots, and Pro/Business dollar prices not retrievable.
- Bernard: live prod via Q's authed Chrome — `/overview`, `/stories`, `/library`, `/new`, `/review-inbox`, `/slate`, `/onboard`; landing copy via WebFetch (`withbernard.ai`). Rendered landing visual NOT captured (logged-in redirect to `/onboard`) — capture from a logged-out session.
