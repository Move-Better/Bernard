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

*(No runs yet. The first `/frontier-panel` invocation appends `## ⟳ Run — <YYYY-MM-DD>` here: panel reads → converged verdict → ambition register → the frontier bet.)*

---

## 3. The ambition register

*(Carried forward and re-ranked each run. Boldest / highest-upside first. Columns:)*

| ID | Bold move | Lens | Upside | Status | Outside reference / note |
|---|---|---|---|---|---|
| — | *(first run populates this)* | — | — | — | — |

---

## 4. Drift log

*Append each run. The question that matters: is the ceiling rising — is Bernard becoming a more ambitious product, and did the last frontier release open a new move?*

| Date | What changed since last pass |
|---|---|
| 2026-06-20 | Panel created. Unbounded sibling of the pragmatic product panel: time/cost are non-constraints, ranked by ambition, 7th Frontier-scout seat + outward mandate on all experts, grounds-in-live-app-then-goes-unbounded. No runs yet. |

---

## 5. The honest caveat (always)

This panel is **expert *simulation*, not user *observation*** — sharp at "what would the best people and best tech obviously do," blind to "what real clinicians actually trip on." And ambition without grounding is just noise: the live-app read is what keeps the boldness specific. Weight findings as "very likely the right direction," not "proven." The only ground truth remains a real staffer using the app.

---

*Keep file (human-authored instrument — treat like source, per the `.claude/` scratch-vs-keep convention). Sibling: `product-panel-audit.md` (pragmatic). Run via `/frontier-panel`.*
