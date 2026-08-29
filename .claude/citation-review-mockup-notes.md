# Citation review panel — mockup notes

Mockup: `.claude/mockups/citation-review-panel.html`. Originally built to my
best judgment (no live human available to sign off in that session); Q has
since reviewed it live and both open questions below are resolved. Two rounds
of feedback applied on top of the original: (1) more color — the panel leaned
too heavily on Bernard's own product blue, which "falls flat" in a review UI
that should feel distinct from app chrome; (2) the two design questions,
answered below. `src/components/CitationReviewPanel.jsx` has been updated to
match both rounds (2026-08-29 — see the "Shipped" section below).

## What it is

Rendered and screenshotted in both light and dark mode (Bernard's real CSS
custom properties, copied from `src/index.css`) via the local mockup-server
convention (`python3 -m http.server` from inside `.claude/`). Both themes read
clean with no contrast issues at a glance.

Five scenarios, framed as **NEW** (there's no existing citations UI to diff
against — this is the first version of the surface, so it's shown in full
rather than as a TODAY→CHANGE diff):

1. Suggestions waiting for review — the common case right after a blog/series
   draft is created and enrichment has run automatically.
2. A mix already decided — one approved, one rejected, both shown (rejected
   struck through, not hidden) as the audit trail the spec calls for.
3. Checked, found nothing — explicitly framed as a correct outcome per the
   spec's "0-3 per post, never count-filled," not an error state.
4. Never checked yet — the on-demand "Find supporting research" trigger
   (Phase 5's backfill affordance for the ~14 pieces #2665 stripped links
   from).
5. Mid-check (loading) — since real retrieval + an LLM judge across multiple
   claims can genuinely take tens of seconds.

## Placement decision

Inside `ApprovalPanel` (`src/components/story-detail/AssetsPane.jsx`), right
after the voice-drift scorecard row and before the "when to publish" card —
gated on `piece.platform === 'blog'` (this also covers series parts, which
are `platform:'blog'` with `series_id` set). Shown across draft AND approved
status, per the spec's "before Approve/Schedule/Publish."

## Design elements that reflect real data, not decoration

- **Tier chips** (Peer-reviewed / Major institution / Professional guidelines
  / Health-ed) map 1:1 to `api/_lib/citations/allowlist.js`'s
  `CITATION_SOURCE_TIERS` keys.
- **Confidence bar** is the judge's real `confidence` field (0-1, formatted as
  a percentage) — never a value invented for the mockup beyond formatting.
- **Rejected rows stay visible** (struck through, muted, "who decided" shown)
  rather than disappearing on decision, matching the audit-trail requirement.

## Resolved — Q's answers (2026-08-28)

1. **Where does an approved citation land in the published post?** — **Both.**
   Hyperlinked inline in the body, at the exact sentence it supports, AND
   listed again in the "Further reading" footer with its own link. Q: "The
   redundancy adds clarity." This overrides Phase 4's footer-only ship
   (`api/_lib/citations/insertCitations.js`), which deliberately avoided
   inline insertion because the extracted `quote` can go stale if the body is
   hand-edited between enrichment and approval (voice-fidelity prose is
   treated as sacred in this codebase — see CLAUDE.md). That risk is real and
   Q's answer doesn't remove it, so the locked design in
   `.claude/blog-research-citations-spec.md` ("Link placement" section) keeps
   the safety property: inline insertion only happens on an EXACT,
   case-sensitive, single-occurrence substring match checked fresh at publish
   time; anything else (quote drifted, quote now ambiguous/repeated)
   gracefully degrades to footer-only for that one citation rather than
   guessing. The review panel needs a live per-citation indicator of which
   outcome the reviewer is about to get — mocked as a small state note under
   the source row (see the updated mockup); wired to the real, live
   `willInlineLink` field as of 2026-08-29 (below).
2. **Is a confidence percentage useful to a clinician reviewer, or noise?**
   — **Keep it.** Q: "Confidence is very useful." No changes needed here —
   the confidence bar was already reading the judge's real `confidence`
   field, not a decorative value.

## What's NOT mocked

- The "Re-check" button's confirmation/loading transition (mocked as two
  separate static states, not an animated transition) — trivial to wire once
  built.
- Mobile/narrow-viewport layout — not checked at <768px. Per this project's
  full-bleed-everything rule, the panel is a simple vertical stack with no
  fixed widths, so it should reflow fine, but this needs a real device/viewport
  check before calling it done, not just an assumption.

## Shipped (2026-08-29)

Both rounds of feedback are now live in `src/components/CitationReviewPanel.jsx`:

- **Color pass:** citation title links + the "Re-check"/"Checking…" controls
  moved from `--primary` (Bernard's product blue) to `--scheduled` (violet —
  "content in a queued/processing state," a real token already used
  elsewhere, not invented for this). The "Major institution" tier chip moved
  from `--primary` to `--success` (green). "Find supporting research" (the
  first-ever check on a post) is now a solid `--action` (amber) CTA, matching
  this project's established "act now" pattern; the "Find more research for
  this post →" affordance is now a real clickable amber link, not static text.
- **Live outcome indicator:** each suggested citation card now shows a
  green-check "Will link inline + Further reading" row or an amber-warning
  "Text changed since suggested — Further reading only" row, sourced from the
  `willInlineLink` boolean `api/_routes/content-items/citations-list.js`
  computes fresh on every read (never a stale enrichment-time flag) — see
  `api/_lib/citations/quoteMatch.js`, the one shared implementation of the
  exact-match rule behind both this indicator and the actual publish-time
  insertion.
- Backend Phases 1-2 (retrieval/verification/storage/API) and the inline+footer
  insertion (`api/_lib/citations/insertCitations.js`) are fully shipped —
  confirmed via `tests/lib/citationQuoteMatch.test.js` and
  `tests/lib/citationInsertCitations.test.js`, mutation-tested by hand.
- Separately, a real retrieval bug found while running the shipped pipeline
  against real content is fixed — see the spec's "Known retrieval bug, fixed
  2026-08-29" section (PubMed abstract pages returning a cookie-consent wall
  to a plain fetch, plus stripping a `?utm_source=openai` tracking param from
  every web-search result). The run that found it is preserved as
  `.claude/mockups/citation-review-real-preview.html` — not a design mockup,
  a record of the actual pipeline (no mocks) against two real pending Move
  Better blogs, including the real judge output and the real before/after
  post body for the one citation that survived verification.
