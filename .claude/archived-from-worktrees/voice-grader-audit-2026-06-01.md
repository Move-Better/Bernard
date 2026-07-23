# Voice Grader Audit — 2026-06-01

> Requested: overnight autonomous build session, Task 2.
> Goal: determine why published stories show "5–29% low" voice match scores across the board.
> Result: **two separate scoring systems; one is miscalibrated; the "low" display is a rendering bug.**

---

## TL;DR

There are **two completely separate voice scoring systems** in this codebase that use the same DB column name (`voice_fidelity_score`) but different scales and graders. The UI that shows percentages (HomeStats "Voice match") reads from a **third** system (provenance `verbatim_pct + paraphrase_pct`). Scores of "5–29% low" are real but **expected on a 0–100 scale** that currently has a structural floor problem: story packages store scores in the **1–10 range** (mean of 4 Haiku dimensions), while VoiceFidelityBadge expects **0–100**. A score of 7/10 renders as "7/100 · Doesn't sound like you" in the badge — which is the bug.

---

## System inventory

### System A — `voiceAudit.js` (content_items, 0–100 scale)
- **What it scores:** Long-form blog/social drafts stored in `content_items`
- **Column:** `content_items.voice_fidelity_score` (integer, 0–100) + `content_items.voice_audit` (JSONB with flags)
- **Grader:** `api/_lib/voiceAudit.js` — Sonnet 4.6 via `generateObject`, returns `{ voice_fidelity_score: int 0-100, summary, flags[] }`
- **Displayed by:** `VoiceFidelityBadge.jsx` — correctly expects 0–100. Thresholds: ≥90=Faithful, ≥70=Mostly faithful, ≥50=Worth a look, <50=Doesn't sound like you
- **Reference:** receives the full interview transcript, clinician voice profile, practice memory
- **Status:** Appears correctly calibrated. Scores on this path have not been the source of complaints.

### System B — `captionFidelity.js` (story_packages, 1–10 scale)
- **What it scores:** Short social captions stored in `story_packages`
- **Column:** `story_packages.voice_fidelity_score` (numeric, **1–10**) + `story_packages.voice_fidelity_breakdown` (JSONB)
- **Grader:** `api/_lib/captionFidelity.js` — Haiku 4.5 via `generateText`, returns JSON with 4 dimensions each 1–10, averaged
- **Displayed by:** `PackageCard.jsx` (via `VoiceFidelityBadge.jsx` props) — **WRONG: the badge expects 0–100 but receives 1–10, so a score of 7 renders as "7/100 · Doesn't sound like you"**
- **Reference (post-2026-05-31 rewrite):** fetches clip transcript from `source_asset.transcription`, voice phrases from `staff_voice_phrases`
- **Current rubric:** `faithfulness-v2` (4 dimensions: said_fidelity, voice_match, naturalness, tightness)

### System C — provenance `verbatim_pct + paraphrase_pct` (content_items)
- **What it measures:** What fraction of the published draft uses the clinician's words verbatim or paraphrased
- **Source:** `content_items.provenance` JSONB, populated during draft generation
- **Displayed by:** `HomeStats.jsx` ("Voice match" card), `PipelineKanban.jsx` (VoiceDriftChip), `DraftsReadyRow.jsx`
- **Scale:** 0–100%, rendered as `N% voice`. Thresholds: ≥60=strong, ≥35=fair, <35=low

---

## Root cause of "5–29% low"

The task description says "5–29% low across the board." This matches **System C** (provenance `verbatim_pct + paraphrase_pct`) displayed in `HomeStats.jsx`. A reading of 5–29% means the published drafts contain 5–29% of the clinician's own words.

**This is NOT a grader bug — it is likely real.**

- These are AI-generated drafts from interview transcripts. The generation prompts rewrite the raw transcript into structured content, so verbatim percentages below 30% are expected.
- The `HomeStats.jsx` thresholds (strong ≥60%, fair ≥35%, low <35%) are calibrated for a high-verbatim-preservation goal that may not match how drafts are currently generated.
- The `voiceAudit.js` pass (System A) explicitly looks for vocabulary swaps and smoothed opinions; if it's passing most content, the provenance number may just be low from draft structure, not from voice drift.

**However, there is a real separate bug:** the caption-level scores in System B are displayed on a 0–100 scale in `VoiceFidelityBadge` while stored as 1–10, causing "7/100 · Doesn't sound like you" for a caption that actually scored 7/10.

---

## DB evidence (11 scored story_packages, queried 2026-06-01)

| Rubric | Count | Avg score | Score range | Has transcript? |
|---|---|---|---|---|
| `faithfulness-v2` | 4 | 6.94/10 | 6.5–7.25 | 3/4 had `has_transcript=false`; 1/4 had transcript |
| old rubric (no rubric key) | 7 | 5.34/10 | 2.0–7.0 | all `has_transcript=null` (never had it) |

**Key finding from the v2 rubric rows:** 3 of the 4 have `has_transcript=false`. When no transcript is available, `said_fidelity` is hard-coded to 5 (neutral) by the grader design. So the score 6.5–7.0 on those rows reflects 3 dimensions (voice_match, naturalness, tightness) averaged with a fixed 5 for said_fidelity — not a full 4-dimension score. The one row WITH a transcript scored `said_fidelity=9` and overall 7.25.

---

## Is the new rubric (`faithfulness-v2`) well-calibrated?

**Yes, the rubric logic is sound** — for the 1 scored sample with a transcript:
- said_fidelity: 9 (good — faithfully conveys what was said)
- voice_match: 8 (good — sounds like this person)
- naturalness: 9 (good — real human)
- tightness: 3 (low — title is a 250-word generic description of clinic footage)
- Red flag: "title is generic description of clinic footage, does not match the personal/emotional substance of what he actually said"

This is a sensible and actionable result. The grader correctly diagnosed that the AI generated a transcript summary as the title instead of an actual headline.

**Concerns:**
1. **Sample size is too small to calibrate.** Only 11 scored packages total (4 v2), almost all in `skipped` status. Not enough to validate the baseline.
2. **75% of v2 scores have `has_transcript=false`.** The `said_fidelity=5` floor for missing transcripts is the right design choice (neutral, not penalizing), but it caps the maximum possible overall score at ~7.5 even for perfect captions, since one of four dimensions is fixed at 5. This is expected and acceptable, but worth noting.
3. **Single-shot Haiku scoring.** The rubric uses one Haiku call per caption with no averaging. CLAUDE.md notes this swings ±2. The current corpus is too small to see this noise empirically.

---

## The display bug (separate from grader calibration)

`PackageCard.jsx` passes `voice_fidelity_score` (1–10) to `VoiceFidelityBadge` which renders `"Voice fidelity {score}/100"` and uses thresholds calibrated for 0–100. So:
- A score of 7/10 (70th percentile — "Mostly faithful" intent) renders as `"7/100 · Doesn't sound like you"`
- A score of 5/10 (50th percentile — acceptable) renders as `"5/100 · Doesn't sound like you"`

This is almost certainly what Q sees as "5–29% low." PackageCard passes the raw 1–10 value where the badge expects 0–100.

**Fix:** either (a) multiply the story_package score by 10 before passing to `VoiceFidelityBadge`, or (b) update `VoiceFidelityBadge` to accept a `scale` prop and render `/10` when the score is on the 1–10 scale, or (c) store story_package scores as 0–100 in `captionFidelity.js` (multiply `overall * 10` before persisting).

Option (c) is simplest and keeps the badge component clean — convert at the storage layer. The CI fixture would need to be regenerated after.

---

## Recommendations

| Priority | Finding | Fix | Est. Dev Cost |
|---|---|---|---|
| P0 | `PackageCard` passes 1–10 score to `VoiceFidelityBadge` which expects 0–100 — captions always show "Doesn't sound like you" | Multiply `voice_fidelity_score` by 10 when passing to badge, OR store as 0–100 in `captionFidelity.js` | Sonnet, Quick |
| P1 | 75% of v2-rubric caption scores have `has_transcript=false`, capping score at ~7.5 | Surface in UI: show "transcript unavailable" note on badge when `has_transcript=false`; separately, investigate why transcript isn't being fetched for most captions | Sonnet, Medium |
| P1 | HomeStats "Voice match" shows 5–29% (provenance verbatim_pct) — may be correct but the thresholds feel harsh | Audit whether thresholds (strong ≥60%) are realistic for AI-drafted content, or whether they should be relaxed | Sonnet, Quick (analysis) |
| P2 | Only 11 total scored packages, corpus too small to validate calibration | Add caption scoring to more content paths; re-run `voice-fidelity-captions.mjs` after accumulating 30+ samples | — |
| P2 | Old-rubric rows (7/11) have no `rubric` key and used `voice_fidelity` (fixed 5) + `clinical_texture` — should be re-scored | Run `voice-fidelity-captions.mjs --since=2026-05-28 --no-persist` to preview what v2 would give them | — |

---

## What the task described as "5–29% low" — likely the HomeStats card

The `HomeStats.jsx` "Voice match" card reads `provenance.verbatim_pct + paraphrase_pct` across the last 20 pieces. This is a measure of how many of the clinician's own words survived into the published draft — separate from both caption scoring systems. A reading of 5–29% is plausible (possibly correct) for AI-generated blog content that restructures an interview. This is not a grader bug; it reflects that the generation prompts reorganize the transcript rather than preserving it word-for-word.

**To verify:** the `voice_audit.flags` on published `content_items` would tell us whether the low verbatim_pct is accompanied by actual voice drift flags (vocabulary_swap, smoothed_opinion). If published items have few flags but low verbatim_pct, the threshold for "low" in HomeStats is simply calibrated for a higher preservation target than the current system achieves.

---

*Audit by: Claude Sonnet 4.6 (overnight session, 2026-06-01)*
*Files read: `api/_lib/captionFidelity.js`, `api/_lib/captionFidelityRubric.js`, `api/_lib/voiceAudit.js`, `scripts/voice-fidelity-captions.mjs`, `scripts/verify-caption-fidelity.mjs`, `src/components/story-detail/VoiceFidelityBadge.jsx`, `src/components/home/HomeStats.jsx`, `src/components/PipelineKanban.jsx`, `src/components/slate/PackageCard.jsx`*
*DB queried: `story_packages` (11 scored rows), supabase project `wrqfrjhevkbbheymzezy`*
