---
description: Run the Expert Product Panel ("Make-It-Better" audit) — re-ground in the live app, convene the six experts, append a dated block to product-panel-audit.md.
---

Run the **Expert Product Panel** defined in `.claude/product-panel-audit.md`.
That file is the living instrument and the source of truth for the ritual — read
it in full first, then execute the run exactly as §0 and §6 describe.

The one question this answers: **"how do we make Bernard a genuinely better tool
for the Move Better team to use, day to day?"** Product & experience layer only —
NOT code/bug (`/audit`, `/checkup`) and NOT strategy (`blindspot-audit*.md`).

## Run procedure (follow the doc; this is the checklist)

1. **Re-ground in the LIVE app first — do not skip.** Dispatch an `Explore` agent
   (medium–very thorough) over `src/` + `api/` to read the *real, current*
   components, routes, and surfaces. Critique from real code, never from memory or
   strategy docs — specificity from live code is the entire value of a run. Note
   what has shipped since the last dated block so the panel reacts to reality.

2. **Re-convene the six fixed experts** (keep the cast stable so runs are
   comparable): 🎨 Principal product designer (IA) · 🧠 Behavioral scientist
   (habit & motivation) · 🎙️ Conversation/voice UX designer · 🤖 AI/ML engineer ·
   🔧 Reliability engineer · 🔁 Workflow/ops designer. Each gives their sharpest
   read + one headline fix, grounded in named components/routes.

3. **Converge** on the one through-line the panel agrees on.

4. **Re-rank the roadmap register** — carry forward open IDs (P1–Pn), update each
   status (Open/Aware/Building/Closed), add any new findings. Use the options-table
   format with **Est. Days + Est. Claude Cost** per Q's format rule, ranked by
   impact on daily team use. Use the severity/status schemes already in the doc.

5. **Append, never overwrite** — add a new dated `## ⟳ Re-run — <YYYY-MM-DD>` block
   plus a Drift-log row (§5: is the loop's capture-in / payoff-out smoothing? did the
   last feature help or add sprawl?). Then **pick 1–3 next actions, one per pass** —
   and for any non-trivial UI/flow, mockup-first before code (project rule).

One pass per invocation — do NOT self-iterate to "improve" the report. Always carry
the honest caveat: this is expert *simulation*, not real-staffer *observation*
(blindspot Lens D) — weight findings "very likely right," not "proven."

$ARGUMENTS
