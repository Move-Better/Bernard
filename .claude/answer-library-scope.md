# Public Answer Library — scope (for sign-off, not yet built)

**Date:** 2026-07-03 · **Status:** scoped, awaiting Q's decision · **Mockup:** `.claude/mockups/answer-page-v1.html` (Artifact published)

## The idea (Q's, 2026-07-03)
Put the "answer graph" **on movebetter.co for patients to actually use** — not the internal `/seo` scoreboard. Concretely: publish Move Better's authoritative answers to real patient questions as pages on the public site.

## Why this is the right move (the strategic fit)
The `/seo` **citation scoreboard measures** whether AIs cite you ("are you the answer?" — today 2/12). It doesn't *change* the number. This is the **supply side**: AIs and Google cite pages that **publicly, authoritatively answer the question**. Today aafp.org / mayoclinic.org win those citations because their answers exist on the open web and Move Better's don't. Publish your answers → become citable → the scoreboard moves.

**It closes the flywheel we already half-built:**
```
/seo scoreboard finds a gap ("How do I know if I have sciatica?" — not cited)
   → routes to "→ Monday's interview" (already shipped)
      → clinician answers it in a capture (Bernard interview)
         → Bernard drafts the answer in their voice (same engine as pre-draft)
            → published to movebetter.co/answers  ← THIS is the missing piece
               → AIs crawl + cite it → scoreboard flips to "✓ You"
```
Right now that chain dead-ends at "interview." The answer library is the output that makes the whole scoreboard actionable.

## Architecture — reuses proven pipes (verified in the repos 2026-07-03)
Two-repo system already in place:
- **Public site** = `Movebetterco` (Astro SSG, `/Users/qbook/Claude Projects/Movebetterco`). Brand: warm orange `#E36525` + grey `#6E7072` + black/white, bold sans (NOT the Bernard app's Blue Spruce). Has content collections (`blog`→`/go-deeper`, `conditions`, `team`), a `conditions/[slug].astro` template (standardized sections + `conditionPageSchema` + uniform booking CTA + related rail), `author`/`authorSlug` fields + author pages, and `src/lib/schema.ts` for schema.org markup.
- **Generator** = Bernard. Its `/api/publish` webhook already feeds the Movebetterco `blog` collection (that's how `/go-deeper` works — see `Movebetterco/src/content.config.ts`).

**So the answer library = a new content type on the SAME rails:**
1. New Astro collection `answers` in Movebetterco + `answers/[slug].astro` (mirror the `conditions` template — it's already answer-shaped).
2. New `answerPageSchema()` in `schema.ts` emitting **`QAPage`/`FAQPage`** JSON-LD (the machine-readable "this page IS the answer" signal — the core AI-citation lever).
3. Bernard generates each answer from the practice brain + interviews (the same grounded engine that pre-drafts), targeting the `/seo` scoreboard's tracked questions first, then expanding. Publishes via the existing `/api/publish` contract (extended for the `answers` collection).
4. Per-clinician **byline** on every answer (`author`/`authorSlug`) → E-E-A-T authority signal + directly satisfies Q's earlier "include all clinical staff, not just Dr. Q."

## Content model (per answer)
`question` (H1, real patient phrasing) · `answerLead` (~45-word direct answer — the extractable snippet) · body (voice-matched depth) · `author`+`authorSlug` (owning clinician) · `condition`/`topic` (taxonomy + internal linking) · `updatedAt` · educational disclaimer + booking CTA (template-rendered, uniform).

## Phasing
- **P1 — one answer live, hand-seeded.** Add the `answers` collection + `[slug].astro` + `answerPageSchema()`; publish ONE answer (e.g. sciatica) by hand to prove the template + schema + build. Verify it renders + validates in Google's Rich Results test.
- **P2 — Bernard generates the tracked 12.** Extend `/api/publish` for `answers`; generate answers for the `/seo` scoreboard's 12 questions, voice-judged + **human-approved before publish** (same gate as all content). Ship the batch.
- **P3 — per-clinician bylines + author pages.** Route each question to its owning clinician; wire author bylines + `/answers/by/[clinician]`.
- **P4 — index + interlinking + sitemap.** `/answers` hub, related-question graph, sitemap entry, and a link from each `/conditions` page to its related answers.

## Risks / guardrails
- **Medical-advice liability** — answers are **educational, not diagnosis**. Uniform disclaimer + red-flag safety note + "book a visit" CTA (see mockup). This is the #1 reason to do **static published answers** rather than a live chatbot that gives personalized advice.
- **Accuracy / voice** — every answer runs the voice-fidelity judge + **human approval before publish** (never auto-publish, same invariant as the Standing Producer).
- **SEO hygiene** — canonical URLs, no thin/duplicate pages, real depth per answer.

## Buy-vs-build (for the *interactive* flavor only — deferred)
If you later want a live "Ask Move Better" widget (visitor types any question → RAG answer): look at **Kapa.ai**, **Algolia AskAI**, **Intercom Fin** before building — they handle the API/moderation/hosting. But it's a layer *on top of* the static library (the published answers become its corpus), and it carries the medical-advice liability the static pages avoid. **Static-first is the right sequence.**

## Effort / cost

| Option | Description | Est. Days | Est. Claude Cost |
|---|---|---|---|
| P1 — template + schema + 1 answer live | Prove the pattern end-to-end on the real site | 1–2d | $2–6 (Sonnet) |
| P1+P2 — + Bernard generates the tracked 12 | The scoreboard's 12 questions, published & bylined | 3–5d | $8–20 (Sonnet; content gen + `/api/publish` extension) |
| Full P1–P4 | Index, per-clinician author pages, interlinking, sitemap | 6–9d | $15–35 (Sonnet; Opus only for the publish-contract design) |
| Interactive widget (later) | Live ask-box — evaluate buy-first | +5–10d | $15–40 + ongoing per-query |

**Recommendation:** P1 first (1–2 days) — one real answer live on movebetter.co, so you can see it in context and validate it wins the Rich Results / citation test, before committing to the batch.

---

## Expansion — the searchable, growing knowledge base (Q's vision, 2026-07-03)

Q's bigger idea: the answer library isn't a static set of pages — it's the visible surface of a **living, compounding knowledge base** patients can search and *ask*, that grows every time a clinician does a Bernard interview. Vision mockup: `.claude/mockups/answer-kb-vision-v1.html` (Artifact published).

**The flywheel:** clinician interviews → Bernard's practice brain grows (per clinician) → best answers reviewed + published → the public answer surface deepens → more citations + more patients self-serving → shows what to interview next ↺. Defensible: no competitor can copy *your doctors' accumulated thinking*. This is the Practice Answer Graph, made public.

**The safety refinement (non-negotiable for a medical site):** two bodies of knowledge —
- **Raw practice brain** (interview transcripts/chunks) = clinicians thinking out loud, unreviewed. Great for *generating*; NOT for serving patients directly.
- **Published answer library** = the slices a doctor read + approved. Vetted, attributable, safe.
The searchable/ask surface serves the **reviewed library only** — never the raw brain. Every reply traces to a real, bylined, doctor-approved answer, and it says "I don't know → see a doctor" when there's no vetted answer (demoed in the mockup via "Should I get an X-ray?").

**Growth phases (each builds on the last):**
1. **Grow the published library** — P1/P2 above. This IS the corpus everything else searches.
2. **Search + browse** over `/answers` — as answers accumulate, add search + filter (by condition / clinician). Low risk (only reviewed content).
3. **Natural-language "ask"** — a box that answers from the reviewed library, with red-flag routing + no personalized diagnosis. **Buy-vs-build here:** Kapa.ai / Inkeep / Algolia AskAI already do grounded-answer search over your published content; the library is the corpus they'd point at.

**Key point:** static library first isn't the small version — it's the *foundation the interactive version requires*. You can't safely "ask the clinic anything" until there's a vetted corpus to answer from.

Per-clinician grounding is real: as of 2026-07-03, Q (6 interviews/204 chunks), Zach (5/132), Sophie (2/40), Tyler (2/26), Whitney (1/35) all have genuine voice data. AJ + Sharon have none — they need a Bernard interview before they can be authentically bylined.
