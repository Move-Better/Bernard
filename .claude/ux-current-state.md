# Bernard — Strategy & UX Plan of Record

**Created:** 2026-06-01 · **Status:** plan of record (Q to mark up) · **Owner:** Q
**Origin:** started as a Slate (slateteams.com) evaluation; turned into the project's strategic lens + action plan.

> **North star — bet against slop.**
> Easy, decent-looking output is the *floor* everyone pays. The win is the **outcome loop**. The voice stays *fixed and real* — a library of your actual words — and only the *aiming* gets smarter. As AI-generated voice-mimicry floods the internet and becomes worthless, verifiably-real + relevant content is the scarce premium. We bet against slop while everyone else mass-produces it.

---

## ⏱ Status log

**2026-06-02 (overnight build) — P0 + P1 already shipped; verified, nothing new built.**
- **P0 (Slate ↔ Library) — DONE & VERIFIED on prod.** Fixed by `#1146 fix(slate): reconnect source videos — mediaData shape + missing API fields`. Two causes, both handled: (a) Slate read `mediaData.assets` off a bare-array response (`/api/media/list` returns a flat array — every other consumer treats it as one); (b) the `staff_id` field was missing from the API SELECT. Prod `084f0b0` includes it (confirmed ancestor). **Browser-verified** on `movebetter-people`: Slate now shows **99 "Needs cutting" + 1 "In progress"**, real clips, with staff names + filter chips working. Independently re-diagnosed + **DB-confirmed 254 non-archived videos** before discovering the fix already existed — so the diagnosis is sound and the verification is real, not assumed.
- **P1 (3→1 pipeline vocabulary) — DONE.** Shipped as `#1147 chore(ia): unify pipeline stage vocabulary across Stories, Storyboard, Overview`. The "three stage languages" finding is resolved upstream.
- **Voice metric — NOT a grader bug (Q's call, correct).** Scores read low because content-generation guidelines changed since those pieces were made; the fix is **regenerating old content against current guidelines**, not touching the grader. Sign-off-required + not-reversible-cheap → deferred, not auto-run.
- **Remaining work is gated, so the overnight run correctly shipped nothing new.** Library-by-meaning indexing (P2) and the Studio consolidation are non-trivial UI → **mockup-first per the rule**. Regeneration needs sign-off. Manufacturing a risky autonomous build to "have something to show" would have violated the garbage-filter — so it wasn't done.

---

## The two filters (run on EVERY build call)

1. **Plumbing or product?** Would a clinician pay for this, or is it commodity infra they'd never see? → *rent the plumbing, always.*
2. **Deepens the real-voice library / outcome loop, or table-stakes parity?** → *fund the former; ship-but-don't-overbuild the latter.*

Backstop — the 5-question garbage filter (fail two → don't build):
1. Plumbing or product? 2. Wedge or sprawl? 3. Mine or theirs (do *I* need it, or does a competitor just have it)? 4. With the grain (AI-first) or against it? 5. What dies when this ships?

---

## TL;DR

1. **The chrome isn't the problem.** One consistent shell already exists (`Layout.jsx`). Re-skinning won't fix the feeling.
2. **The problem is surface proliferation + reorg sediment.** 9 nav destinations, 4 parallel editors, redirects from ~5 past reorganizations. It feels illogical because it *is* five designs layered on each other.
3. **The deeper problem is paradigm.** Bernard is AI-first (the interview is a conversation), but a manual *visual editor* got bolted on against that grain. Fix: make instruction-and-approve the primary surface; demote visual editing to a fallback.
4. **Output is the floor, not the moat.** Provide good photo/video (mandatory for years) — but rent the muscle, never build the render plumbing. The moat is the outcome loop + the real-voice library.

---

## The 5-year thesis: bet against slop

When **AI-does-a-thing** and **easy-to-use** both commoditize — and they're commoditizing now — they stop being differentiators and become table stakes. As foundation models improve, the generic-capability gap between Bernard and a funded competitor *shrinks* (everyone rents the same model). So differentiation can't live in anything rentable.

**What can't be copied, bought, or cold-started:**

| Candidate | Durable? | Why |
|---|---|---|
| Better AI / model | ❌ | Rented by everyone |
| Easier UX | ❌ | Table stakes; AI makes good UX cheap |
| The editor / render | ❌ | Commodity APIs |
| **Per-practice real-voice library + outcome-tuned aiming** | ✅✅ | Compounds per clinician; non-transferable; can't cold-start |
| **Vertical depth** (hands-on clinical, the boundaries) | ✅ | Too narrow for horizontal players to bother |
| **Founder-market fit** (Q *is* the customer) | ✅ | Funded generic teams can't fake the credibility |

**The corpus only matters if the output does something — patients and community.** A moat around an empty castle is worthless. So the thesis is outcome-bound:

- **Output = floor.** A shitty post buries great words; good-looking output is mandatory. But everyone has it → it's the cost of admission, not the win.
- **Outcome loop = wedge.** Everyone converges on "makes good content." Nobody closes the loop from content → attention → patients/community, with the outcome signal fed back into what gets made next. That loop is per-practice, compounding, and unbuyable.
- **Voice stays fixed and real; outcome tunes the AIM, not the voice.** The corpus is a library of things Q actually said. Outcome optimizes *which real piece → which person → which moment* — never the voice itself. Tuning voice on engagement is how every voice rots into clickbait. Bernard is a **librarian of your real voice, not a ghostwriter**: generation becomes curation/retrieval. Guard the seams — arranging real words is fidelity; generating connective glue is where fabrication leaks back in. The fidelity grader polices the seams.

**Two honest edges:**
- The library must be *rich* before the aiming has leverage → keep the interview/practice-memory engine as **priority one** (it fills the library; selection is worthless without depth).
- We can't fully *own* conversion (algorithm, local market, intake). The claim is "oriented toward and measured on outcome," not "guarantees patients." Measure cheap proxies; don't oversell.

---

## The paradigm reframe: instruction-first, not a visual editor

Three layers, often conflated:

| Layer | What it is | Who lives here |
|---|---|---|
| **1. Intent** | "Tell it what to do" — natural language + guidelines | Descript Underlord · **Bernard's interview already** |
| **2. Decision** | Intent + source + guidelines → a concrete edit/content plan | **Bernard's transcript→voice engine already** |
| **3. Execution** | Render the plan to a file | Remotion · Shotstack · ffmpeg (deterministic, no AI) |

Descript spans all three. **Remotion is *only* layer 3** — the muscle, not the brain. Bernard already owns layers 1+2 (the hard, modern part). The struggle came from *also* building an old-school visual editor on top of an AI-first product — two paradigms that don't sit together, which is a real source of the "illogical."

**The fix:** the "Studio" surface is an **instruction-and-approve** experience (AI's draft + a box to say what to change + guidelines holding the line), with manual visual controls as the *fallback* for the ~20% pixel-nudge cases — not a timeline as the main event. Honest temper: the frontier is "AI draft → light human nudge → guidelines guardrail," not magic chat. You still need a manual layer — as the safety net, not the headline.

**Can we build a Remotion?** No. It's ~5 years of horizontal infra (deterministic frame render, audio sync, preview parity, Lambda orchestration) with zero clinical value. Canonical buy-before-build. And you may not even need it yet — **ffmpeg (already in the stack) covers trim / 9:16 / caption-burn.** Remotion earns its place only when *designed, animated, branded* compositions are the real ask. Its one bonus when you get there: its preview component *is* the render, which structurally kills the documented "preview ≠ published" bug class.

> ⚠️ All render/clip API keys are **Sensitive** (Vercel env only). Cloud-render and clipping APIs send media off-infra — a data-residency consideration for clinical content; ffmpeg + Remotion-on-your-own-functions keep it in-house.

---

## Current-state surface map

A full-capability clinician sees **9 primary nav destinations** (`NAV_SECTIONS` in `Layout.jsx`), plus a `/new` hub.

| Surface | Route | Job | Honest read |
|---|---|---|---|
| Home | `/` | Personal dashboard | Fine |
| Overview | `/overview` | Clinic-wide board | Fine; thin (98 ln), editor-gated |
| **Stories** | `/stories` | "Words" | ⚠️ label needs subtitle "Words" to explain itself |
| **Storyboard** | `/storyboard → /:piece → /publish` | "Media · Publish" | ⚠️ 3-route flow; runs **edge-to-edge while everything else is width-capped** |
| Library | `/library` (`MediaHub.jsx`, 698 ln) | Media pool | ✅ richer than expected — collections, search, filters, multi-select, bulk actions, Drive import. Problem is likely legibility, not features |
| **Slate** | `/slate → /slate/clip/:id` | Clip workshop | ⚠️ own `videos`/`coverage` tab model |
| Book | `/book` | Workspace book | Separate editor |
| Write | `/write` | AuthorMode | Separate editor |
| Pre-Visit | `/pre-visit` | Patient message | Separate surface |

---

## Why it feels "illogical" — 3 root causes (code evidence)

1. **Surface proliferation.** 9 top-level nouns with fuzzy boundaries (Stories vs Storyboard vs Slate vs Write vs Book). The nav carries subtitles — when a label needs a subtitle, it isn't carrying its weight. Peers expose ~3–4 destinations with *one* editor.
2. **Reorg sediment.** Redirects from ≥5 past reorganizations:
   `/hub→/stories  /calendar→/stories?view=calendar  /strategy→/  /media→/library  /review→/stories  /needs-media→/storyboard  /output→/stories  /review-queue→/?bucket=review  /phone-call→/new/live-interview`. It's not one design — it's five layered.
3. **Four parallel editors, no shared editing shell.** Slate / Storyboard / Write / Book each invented their own layout + view-state (Storyboard even runs `fullBleed` while others are `.container`-capped). The user re-learns the page each time. The industry converged on one editor for exactly this reason.

---

## Build-vs-Buy: the API landscape (condensed)

Three non-interchangeable flavors:

- **Render APIs** (Remotion ★, Shotstack, Creatomate, Json2Video) — *you* decide the edit, they return the MP4. **Right fit** — keep the brain, rent the muscle. Remotion = React-native, preview=render, self-hosted. ffmpeg already covers v1.
- **AI clipping APIs** (Opus Clip, Vizard) — they decide *what* to clip via a generic virality model. **Wrong fit** — that decision is the moat (transcript-anchored, clinical), and they do it worse for this content. (Sieve pivoted to a dataset lab — no longer relevant.)
- **Descript API** — automates *Descript's* workspace as a pipeline step (clean audio, rough cut), draws from your plan credits. Useful as a step; not an in-app editor. Gives the paradigm, not your domain brain — so adopt the paradigm, keep the brain, rent the render.

---

## The competitor teardown (reference)

How each *feels*: Descript = text-is-the-editor; Opus = paste-link → ranked clip grid (triage, never blank); Submagic = pick caption style from a visual gallery; CapCut = template gallery over progressively-disclosed NLE; Canva = stable left-rail IA + one-click Brand Kit; Slate = enter through a Brand Hub, create inside brand guardrails. The repeatable moves: never-blank-canvas · promote-one-surface · AI-drafts-human-triages · rank-the-output · choose-by-seeing · one-IA-shell · loud-status.

---

## Plan of action

| Phase | What | Est. Days | Est. Claude Cost |
|---|---|---|---|
| **0. Lock the strategy** ✅ *(in progress 2026-06-01)* | This doc + the two filters + a memory entry so it survives the session | 0.25d | $1–2 (Sonnet) |
| **1. Ground it** | Walk the **live app** together vs. the rubric. Q drives (Clerk prod-locked); I score + fill the open questions | 0.5d | $2–4 (Sonnet) |
| **2. The spec** | **Instruction-first** consolidation mockup: 9→5 surfaces, one "Studio," AI-draft-and-approve primary / visual editing as fallback. Sign-off before code | 1–2d | $4–8 (Opus — design) |
| **3. Output floor** | Confirm ffmpeg covers v1 (trim / 9:16 / caption-burn); **defer Remotion** until "make it look produced" is real | 0.5d | $2–4 (Sonnet) |
| **4. Build the consolidation** | Implement against the mockup in trial-able phases; every phase passes the filters | 2–4 wk | $40–80 (extended) |
| **★ North star (threads through)** | Outcome loop: cheap signals (Buffer/Meta engagement + intake "how'd you hear?") → wired back into content **selection**, never voice | ongoing | integrate, don't build |

Near-term (0–3) is fast and cheap. Phase 4 is the real build. The outcome loop is the *test* layered into every phase, not a separate sprint.

## What we're explicitly NOT doing (the subtraction)

- ❌ Building a Remotion / render engine / any plumbing
- ❌ Copying Slate's Brand Hub because Slate has one
- ❌ A timeline/manual visual editor as the *primary* surface
- ❌ A marketing-analytics/CRM platform for the outcome loop — measure cheap, integrate, feed back
- ❌ Tuning voice on engagement. Ever.

---

## Open questions — verify on LIVE screens (Phase 1)

- [ ] Which surface is the worst offender in practice?
- [ ] Do the editor surfaces' **empty states** drop the user into "now what?" (rubric #1)
- [ ] Is the Library's pain **visual legibility** or actual workflow?
- [ ] How loud is **pipeline status** on Slate/Storyboard? (CLAUDE.md flags stale-poll history)
- [ ] Does the clip workshop **promote one clip** or show a tool-shed of equal-weight panels?
