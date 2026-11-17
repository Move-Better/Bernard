---
description: Bernard only — run the Expert Product Panel ("Make-It-Better" audit) - re-ground in the live app, convene the six experts, append a dated block to .claude/product-panel-audit.md.
---

# /bernard-product-panel — the Expert Product Panel

Run the **Expert Product Panel** defined in `.claude/product-panel-audit.md` in the
Bernard repo. That file is the living instrument and the source of truth for the
ritual: read it in full first, then execute the run exactly as its §0 and §6
describe. If you are not in the Bernard repo (no `.claude/product-panel-audit.md`
on `origin/main`), stop: this command is Bernard-specific.

The one question this answers: **"how do we make Bernard a genuinely better tool
for the Move Better team to use, day to day?"** Product and experience layer only.
NOT code or bugs (`/bernard-audit`, `/bernard-checkup`) and NOT strategy
(`.claude/blindspot-audit*.md`).

## Run procedure (follow the doc; this is the checklist)

1. **Re-ground in the LIVE app first. Do not skip.** Dispatch an `Explore` agent
   (medium to very thorough) over `src/` and `api/` to read the *real, current*
   components, routes and surfaces, from a checkout synced to `origin/main`.
   Critique from real code, never from memory or strategy docs: specificity from
   live code is the entire value of a run. Note what has shipped since the last
   dated block so the panel reacts to reality.

2. **Re-convene the six fixed experts** (keep the cast stable so runs are
   comparable): 🎨 Principal product designer (IA) · 🧠 Behavioral scientist
   (habit and motivation) · 🎙️ Conversation/voice UX designer · 🤖 AI/ML engineer ·
   🔧 Reliability engineer · 🔁 Workflow/ops designer. Each gives their sharpest
   read and one headline fix, grounded in named components and routes.

3. **Converge** on the one through-line the panel agrees on.

4. **Re-rank the roadmap register.** Carry forward open IDs (P1 to Pn), update each
   status (Open / Aware / Building / Closed), add any new findings. Use the
   options-table format with **Est. Days and Est. Claude Cost** per Q's format rule,
   ranked by impact on daily team use. Use the severity and status schemes already
   in the doc.

5. **Append, never overwrite.** Add a new dated `## ⟳ Re-run — <YYYY-MM-DD>` block
   plus a Drift-log row (§5: is the loop's capture-in / payoff-out smoothing? did
   the last feature help or add sprawl?). Then **pick 1 to 3 next actions, one per
   pass**, and for any non-trivial UI or flow change, mockup first before code
   (Q's mockup-first rule in `~/.claude/CLAUDE.md`; quiet-lane polish excepted).

One pass per invocation: do NOT self-iterate to "improve" the report. Always carry
the honest caveat: this is expert *simulation*, not real-staffer *observation*
(blindspot Lens D). Weight findings "very likely right", not "proven".

$ARGUMENTS
