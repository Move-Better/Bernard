# Bernard — Frontier Product Panel (No-Boundaries "Push It" Audit)

**Created:** 2026-06-20 · **Owner:** Q · **Status:** living doc — re-run on cadence, Q marks up
**Purpose:** the unbounded sibling of the Expert Product Panel. Where that one asks *"is the app a delight to use day-to-day,"* this one asks **"what is the most ambitious version of Bernard, and what would the best people and the best technology in the world do to get there?"** This is a **thought output with no boundaries** — its job is to push the edges and keep the product evolving, not to ship something cheap this week.

## The prime stipulation (read first — this is what makes this panel different)

> **Time and cost are NOT constraints in this audit.** Neither the user's time nor Claude's output budget is a factor in any recommendation. Do **not** rank, soften, trim, or reject an idea because it is expensive, slow, large, or "a lot of Claude." Decisions are optimized for **improvement and ambition only** — never for saving time or money. If a move would take a month and a fortune in tokens but makes Bernard meaningfully better, it belongs at the *top* of the list, not the bottom.

The pragmatic panel (`product-panel-audit.md`) deliberately ranks by Est. Days + Est. Claude Cost and picks 1–3 cheap wins. **This panel does the opposite on purpose.** Keep both; they answer different questions. Use this one when you want to expand the ceiling, not optimize the floor.

**Where it sits among the instruments:**
- `/audit` · `/checkup` → **code & bug layer** (does it work / is it safe).
- `blindspot-audit*.md` → **strategy & direction layer** (are we building the right thing).
- `product-panel-audit.md` → **product & experience layer, pragmatic** (is it a delight to use, cheaply improved).
- **This doc** → **frontier layer, unbounded** (what is the most ambitious Bernard, and how do we keep evolving toward it).

---

## 0. How to use this (the ritual)

A **waypoint**, not a one-off. Re-run on a cadence, append the new findings, diff against the last pass — the trend (is the ceiling rising?) is the product.

### Rule 1: ground in the LIVE app first — *then* go unbounded
Before convening the panel, read the *real, current* components (dispatch an `Explore` agent over `src/` + `api/`). Ideas must be **specific to what exists** — name the real component, the real route, the real rough edge — and *then* propose the boldest possible evolution of it. Generic blue-sky is worthless; a frontier idea anchored to a real file is gold. Ground first so the ambition has teeth; never critique from memory or strategy docs alone.

### Rule 2: look OUTWARD — every expert, plus a dedicated scout
This panel is explicitly licensed to reach outside Bernard. Every expert is instructed to bring in:
- **Features from other products** worth stealing or surpassing (best-in-class editors, capture tools, social schedulers, creator tools, CRMs).
- **Capabilities from other AI/LLM systems** — frontier models and modalities (realtime voice, native video/image generation, long-context agents, computer-use, on-device models, multi-model routing). Name them concretely (e.g. "a realtime voice model would collapse the interview form into a phone call").
- **Adjacent paradigms** — what would a world-class team at a frontier lab or a top creative tool build if handed this problem.

Plus a **dedicated 7th seat (the Frontier scout)** whose entire job is this outward scan.

### The panel (the reusable cast — keep stable so runs are comparable)

| Expert | What they catch | Their outward mandate |
|---|---|---|
| 🎨 **Principal product designer (IA)** | Surface sprawl, inconsistent editors, status-vs-action labels, navigation legibility | Best-in-class IA & editor paradigms from other tools |
| 🧠 **Behavioral scientist (habit & motivation)** | Is using it *rewarding* — payoff loop, activation, why people don't return | Habit/retention mechanics from the stickiest products |
| 🎙️ **Conversation / voice UX designer** | The capture magic — does talking to it feel effortless; mobile/offline | Frontier voice & realtime-conversation models and UX |
| 🤖 **AI / ML engineer** | How much the model does *for* the user vs. assembly work; retrieval; proactivity | Frontier model capabilities, multi-model routing, agents |
| 🔧 **Reliability engineer** | Trust — "did it actually work?"; limbo/stale states; lost work; notifications | How the most-trusted async products signal state |
| 🔁 **Workflow / ops designer** | Multi-person reality — capture→review→schedule→publish handoffs | Collaboration paradigms from the best team tools |
| 🛰️ **Frontier scout** *(7th seat — this panel only)* | What's the most ambitious move available right now | Competitive features, other products, other LLMs/modalities to incorporate or leapfrog |

### Schemes (ambition-first — no cost dimension)
**Upside (how much it advances the product):** 🚀 transformative (changes what Bernard *is*) · ⬆️ strong step-change · ✨ meaningful improvement
**Status:** `Open` (unexamined) · `Aware` (known, no action) · `Building` (in progress) · `Closed` (shipped or consciously dropped)
**No severity, no Est. Days, no Est. Claude Cost** — those belong to the pragmatic panel. Rank **boldest / highest-upside first**, never by feasibility.

### Re-run cadence
Every 6–8 weeks, OR after a frontier-model release that could unlock a new surface, OR whenever the product feels like it's plateauing. To re-run: re-ground in the live app → re-convene the seven experts → append a new dated panel block (§3) + ambition register (§4) → fill the drift log (§5). **Append, never overwrite.**

### Output format (every run produces)
1. **Panel reads** — each expert: their sharpest read + their boldest move, with at least one concrete *outside* reference (a product or a model capability).
2. **The converged verdict** — the single most ambitious through-line the panel agrees on.
3. **The ambition register** — bold moves as a table ranked by upside (see §4 columns). No cost column.
4. **The frontier bet** — name the one move that, if pursued, most changes what Bernard is. (Ambition is the filter, not feasibility.) You may still sketch a sequence, but never drop a bold idea to make the list "shippable."

---

## 1. Fixed reference — what the app IS today

So each pass attacks the same target. Update when the app materially changes. (Fuller surface map: `ux-current-state.md`; shares the reference with `product-panel-audit.md` §1.)

- **The core loop:** voice interview / capture → AI spawns content (blog, per-channel social, carousels, clips, email) → review & approve → publish (bundle.social / GBP / WordPress / Beehiiv).
- **The surfaces:** Home, Overview, Stories, Storyboard, Library, Book, Write, Pre-Visit, Slate, + the unified/video editors. (Sprawl is itself a standing finding.)
- **Capture modes** (`/new`): Interview (AI chat + STT), Voice Memo, Photos & Video (PWA), Live Interview (WebRTC), Patient Handout, Import (URL), Seminar/Talk.
- **Who uses it:** Q (all 3 workspaces) + the Move Better team (Whitney, AJ, Alli, Cullen, …), mostly non-technical clinicians; external tenants self-onboard.

---

## 2. Runs

### ⟳ Run — 2026-06-20

**Grounding:** thorough `Explore` sweep of the live `src/` + `api/` (real components/routes) + an outward scan (web-verified competitor & frontier-model landscape, late-2025 / early-2026). Honest caveat (§5) stands: expert *simulation*, not staffer *observation* — weight "very likely the right direction," not "proven."

**The target, from the live read.** Bernard today is a production-grade **tool the clinician operates**: capture (7 modes via `CapturePicker.jsx`) → a **hardcoded 4-week × 8-platform atom grid** (`atomPlan.js` + `ContentPlanPanel.jsx`) → mostly-manual compose across **three editors** (carousel `SlideEditor.jsx`, video `SlateClipEditor.jsx` + beta `VideoEditor.jsx` at `/slate/clip/:id/edit`, plus `TextPostStudio.jsx`) → publish (bundle.social / GBP / WordPress / Beehiiv via `publishPiece.js`). The model **drafts text**; the human does nearly all the *production* (trim, attach photo, lay out slides, pick template, schedule). The single most important finding: **the most ambitious capabilities already exist and are switched off** — realtime-voice intake (`PhoneCall.jsx` + `/api/realtime-session`, gated by `workspace.realtime_voice_enabled`), the brand-voice-as-judge (`captionFidelityRubric.js`, not wired to gate anything), and the RAG practice brain (`/api/corpus/*`, a stub) are scaffolds waiting to be promoted, not green-field.

#### Panel reads

**🎨 Principal product designer (IA)** — *Sharpest read:* the surface count is the disease — ~40 routes, **three** editors that don't share a mental model, and overlapping queues (`Storyboard` /publish, `ReviewInbox`, `Overview`). A clinician can't hold the map in their head. *Boldest move:* collapse to **one canonical editor and one feed** — carousel, reel, text post, email all open in the *same* surface with the same gestures; format is a *property*, not a different app. *Outside reference:* **Canva Magic Switch** (one design auto-reformats to every size) and **Notion** (one editor, many block types). Target: "one thing you edit, many shapes it takes," not nine pages.

**🧠 Behavioral scientist** — *Sharpest read:* the payoff loop is **back-loaded and invisible** — the reward (engagement) lands days later via the Buffer sync; in the moment the clinician just sees more work. Nothing compounds *visibly*: the practice brain learns silently (`practiceMemory.js`), the `Book` grows unannounced. *Boldest move:* make value **immediate and compounding** — a "look what your 6-minute conversation became" reveal the instant generation finishes (a whole quarter materializing), a weekly "your practice in content" recap, and a felt "your brain got smarter — here's what I learned about how you talk" moment. *Outside reference:* **Spotify Wrapped** (compounding-data-as-reward) and **Duolingo** celebration/streak mechanics. Turn the silent moat into a felt one.

**🎙️ Conversation / voice UX designer** — *Sharpest read:* the front door is still mostly **typing** — `InterviewSession.jsx` is a chat box with STT, and the genuinely magical mode (the WebRTC realtime call in `PhoneCall.jsx`) is hidden behind a flag. The highest-leverage capture is gated off by default. *Boldest move:* make a **natural spoken conversation the default and only required input** — tap once (or Bernard *calls you* on the drive home), talk for five minutes, everything downstream is produced from that. *Outside reference:* **Gemini Live** (native audio in/out with *free* transcripts — exactly what Bernard needs anyway), **OpenAI Realtime** (300–500 ms, adaptive follow-ups), **ElevenLabs Conversational AI** (voice quality). It should feel like talking to a sharp producer, not filling a form.

**🤖 AI / ML engineer** — *Sharpest read:* the model does **drafting, not production**, and its memory is shallow — generation is per-atom on-demand (`/api/generate`); the "practice brain" is *top-6-recent-interviews string injection* (`practiceMemory.js`), not retrieval (the `corpus/*` RAG endpoints are a stub); the voice judge (`captionFidelityRubric.js`) gates nothing; the plan is a hardcoded grid, not a strategy. *Boldest move:* a **multi-agent autonomous pipeline** — a strategist plans a real quarter from the conversation + engagement history, drafter agents fan out every format, a **brand-voice-compliance judge** (promote the existing rubric) gates output, a producer agent assembles media — on long-horizon Claude with a true embeddings-backed, supersession-aware brain. *Outside reference:* **Claude Opus long-horizon agents** (30+ hr sustained work, memory tool, self-improving in ~4 iterations) and **HubSpot Breeze / Salesforce Agentforce** multi-agent decomposition. The human approves *judgment calls*, never assembles posts.

**🔧 Reliability engineer** — *Sharpest read:* trust is held together with **polling and toasts** — state lives in `refetchInterval` + `pipelinePending()` + 60 s hard caps + the `MediaDetail` refresh contract; there's no persistent notification center, no push, no "did my post actually go out?" ledger. Async failures (transcode lag, a failed Buffer dispatch, an atom-gen timeout) are easy to miss; the email digest is the only out-of-app signal. *Boldest move:* a **control tower** — one activity feed showing every async job's true state end-to-end (capture → transcribe → generate → bake → schedule → publish → engagement), with **web-push / SMS** the instant content is ready or a publish fails, and one-tap recovery. *Outside reference:* how **Linear / Vercel / Stripe** make async state legible; **Knock / Resend** for the notification layer. For an async product, *believable state* is the feature.

**🔁 Workflow / ops designer** — *Sharpest read:* it's a **single-player flow wearing a team's clothes** — one clinician per interview, one approver per piece; `permission_tier` (owner/producer/clinician) and `ReviewInbox` gesture at a team but there's no assignment, no ownership, no concurrent-edit safety, no "whose turn is it." The producer is a human doing queue management a machine should do. *Boldest move:* make Bernard the **content operating system of the practice** *and* the ops manager running it — multi-clinician campaigns, assignment, and an **ops agent** that chases approvals, balances the calendar across clinicians, and hands each person the one thing they need to do. *Outside reference:* **Linear** (cycles, assignment, "what's mine") and **Figma** multiplayer. The pitch becomes "the marketing coordinator you hired," not "software you operate."

**🛰️ Frontier scout** — *Sharpest read:* the category is racing toward the **"AI marketing employee,"** and Bernard already owns the two hardest layers everyone else is bolting on — **voice-native intake** and a **brand-voice practice brain** — while leaving its own most-ambitious scaffolds dark. The direct competitor, **Blaze.ai**, sells *exactly* Bernard's bundle (Brand Kit auto-built; "Autopilot" generates ~2 months of content and auto-posts to 8 socials + GBP + email + blog at optimal times) to *exactly* Bernard's SMB buyer for $79–149/mo — but it starts from **website scraping** where Bernard starts from the clinician's **actual spoken voice**. That origin is the moat. *Boldest move:* go all the way to a **"CMO-in-a-box"** — one weekly conversation in, a fully-produced, multi-modal, self-publishing, self-improving quarter out, with the production gaps filled by frontier media models. *Outside references (the buildable gap list):* **Submagic "Magic B-rolls"** + **Veo 3.1** (GA API, no waitlist) for generated b-roll; **HeyGen Avatar 5** (15-sec selfie → talking-head twin) + **ElevenLabs v3** (cloned voice, emotional tags) so a camera-shy clinician ships video without filming; **Nano Banana Pro** (9-reference brand-lock) + **Recraft V4** for on-brand graphics that beat hand-built SVG compositing. Bernard has 4 of the 6 layers; the missing 2 are realtime-voice intake and generative media, plus the analytics→self-improvement loop that closes it.

#### The converged verdict

**Bernard should stop being a *tool the clinician operates* and become a *colleague the clinician talks to*.** All seven reads converge from different sides on one through-line: **collapse the input to a conversation, collapse the surfaces to a feed + one editor, and push the *production* work off the human and onto agents + frontier media models — so the clinician spends their time on judgment (approve / steer / veto), never on assembly.** And the live read's gift: the boldest version is **already half-built and gated** (`PhoneCall.jsx`, `captionFidelityRubric.js`, `corpus/*`). The ceiling isn't distant — it's switched off.

#### The frontier bet

**"The Weekly Call → a published quarter."** The one move that most changes what Bernard *is*: the clinician's *entire* required input becomes a single ~6-minute spoken conversation (inbound tap or an outbound call Bernard places), and the entire output — strategy, every channel's posts, carousels, **generated-b-roll/avatar reels in their own cloned voice**, on-brand graphics, the email — is produced autonomously by a multi-agent pipeline, gated by the practice-brain voice judge, published on best-time schedules, and **fed by engagement back into next week's plan**. The human's only job is the weekly conversation and a stream of yes/no/steer judgments. The seven surfaces and three editors become optional power-tooling *under* an autonomous default — not the path itself.

*A sketchable sequence (ambition preserved, nothing dropped to be "shippable"):* (1) promote realtime voice to the default front door [**F1**]; (2) wire the voice judge + an embeddings practice brain so generation is gated and retrieval-grounded [**F6** + part of **F2**]; (3) stand up the strategist→drafter→judge→producer agent loop that turns one call into a planned quarter [**F2**]; (4) add generative video/avatar/voice-clone + prompt-native graphics so the media produces itself [**F3**, **F5**]; (5) close the loop with a control tower + best-time autonomous scheduling + engagement-driven self-improvement [**F7**, **F10**]. Each stage ships independently, but the *bet* is the whole arc: a colleague, not a tool.

---

## 3. The ambition register

*(Carried forward and re-ranked each run. Boldest / highest-upside first. Columns:)*

| ID | Bold move | Lens | Upside | Status | Outside reference / note |
|---|---|---|---|---|---|
| **F1** | **The Weekly Call** — natural realtime-voice conversation as the default & only required input (inbound tap or outbound call Bernard places) | 🎙️ Voice UX | 🚀 | **Exists** — `PhoneCall.jsx` + `/api/realtime-session` live, gated by `realtime_voice_enabled`. Next: promote to default front door, remove gate. | Gemini Live / OpenAI Realtime / ElevenLabs Conversational AI. |
| **F2** | **Autonomous marketing teammate** — multi-agent strategist→drafter→voice-judge→producer pipeline turns one call into a self-publishing, self-improving quarter | 🤖 AI/ML | 🚀 | Open | Claude Opus long-horizon agents; Blaze.ai Autopilot; Agentforce multi-agent. Replaces hardcoded `atomPlan.js` grid; wires `captionFidelityRubric.js` as the gate. |
| **F3** | **Generative video studio** — auto-b-roll + avatar in the clinician's cloned voice; a script becomes a finished Reel without filming | 🛰️ Frontier | 🚀 | Open | Submagic Magic B-rolls + Veo 3.1 (GA API); HeyGen Avatar 5; ElevenLabs v3. Extends `SlateClipEditor` / `/api/ads/render-video`. |
| **F4** | **One canonical edit-by-text editor** — collapse SlideEditor + the two video editors into a single transcript-driven surface; format is a property | 🎨 IA | ⬆️ | Open | Descript Underlord (runs on Claude); Canva Magic Switch. Merges `SlideEditor.jsx`, `SlateClipEditor.jsx`, `VideoEditor.jsx`, `renderFreeformSlide`. |
| **F5** | **Prompt-native on-brand graphics** — multi-reference brand-locked image gen replaces hand-built SVG compositing | 🎨 IA / 🛰️ | ⬆️ | Open | Nano Banana Pro (9-ref brand lock); Recraft V4. Supersedes `overlayTemplates.js` / `brandRender.js` / `whoopTemplates.js`; reads `brand_style`. |
| **F6** | **True retrieval practice brain** — embeddings over all interviews + published content + engagement outcomes, supersession-aware; grounds generation + an "ask your practice" surface | 🤖 AI/ML | ⬆️ | Open | Bernard's own supersession moat + RAG. Promotes `corpus/*` stub; upgrades `practiceMemory.js` from top-6 strings to retrieval. |
| **F7** | **Compounding payoff + proactive presence** — instant "look what your call became" reveal, weekly recap, visible learning, push/SMS on ready/failed | 🧠 Behavioral / 🔧 Reliability | ⬆️ | Open | Spotify Wrapped; Duolingo; Knock/Resend push. Builds on `Overview` recap + `engagement-digest` cron; upgrades `toast.js` → notification center. |
| **F8** | **Content OS for the practice** — multi-clinician campaigns, assignment, an ops agent that chases approvals & balances the calendar | 🔁 Workflow | ⬆️ | Open | Linear cycles/assignment; Figma multiplayer. Extends `ReviewInbox`, `permission_tier`, `campaigns.target_staff_ids`. |
| **F9** | **Quality/virality scoring on every asset** — each auto-clip & post scored against the practice's own engagement history; review strongest-first | 🛰️ / 🧠 | ✨ | Open | OpusClip virality score; Vizard. Layers on Slate segment detection + `engagement/top-performers.js`. |
| **F10** | **Best-time autonomous scheduling + ideation seeds** — AI peak-time posting; seeds from URL / calendar / holidays / trending | 🔁 / 🛰️ | ✨ | Open | Hootsuite OwlyWriter best-time; Buffer AI. Extends `auto-publish` cron + `scheduled_at`. |

---

## 4. Drift log

*Append each run. The question that matters: is the ceiling rising — is Bernard becoming a more ambitious product, and did the last frontier release open a new move?*

| Date | What changed since last pass |
|---|---|
| 2026-06-20 | Panel created. Unbounded sibling of the pragmatic product panel: time/cost are non-constraints, ranked by ambition, 7th Frontier-scout seat + outward mandate on all experts, grounds-in-live-app-then-goes-unbounded. No runs yet. |
| 2026-06-20 | **Run 1 executed.** First panel convened against the live app. Converged verdict: shift Bernard from *tool you operate* → *colleague you talk to*. Frontier bet named: **"The Weekly Call → a published quarter."** Key live-read finding — the three most ambitious moves (realtime voice `PhoneCall.jsx`, voice-judge `captionFidelityRubric.js`, RAG `corpus/*`) are **already scaffolded but gated/stubbed**; the ceiling is switched *off*, not absent. Register seeded F1–F10 (3 × 🚀 transformative). Outward scan named **Blaze.ai** as the direct competitor; Bernard's voice-native intake + practice-brain are the wedge. Baseline for "is the ceiling rising?" — next run diffs against this. |

---

## 5. The honest caveat (always)

This panel is **expert *simulation*, not user *observation*** — sharp at "what would the best people and best tech obviously do," blind to "what real clinicians actually trip on." And ambition without grounding is just noise: the live-app read is what keeps the boldness specific. Weight findings as "very likely the right direction," not "proven." The only ground truth remains a real staffer using the app.

---

*Keep file (human-authored instrument — treat like source, per the `.claude/` scratch-vs-keep convention). Sibling: `product-panel-audit.md` (pragmatic). Run via `/frontier-panel`.*
