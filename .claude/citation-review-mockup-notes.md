# Citation review panel — mockup notes (DRAFT, pending Q's sign-off)

Mockup: `.claude/mockups/citation-review-panel.html`. Built to my best judgment
against `.claude/blog-research-citations-spec.md` since no live human was
available to sign off in this session — **treat this as a draft**, not a
locked design. The React component (`src/components/CitationReviewPanel.jsx`)
follows this mockup closely so it can be swapped/restyled cheaply once Q has
actually looked at it.

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

## Open questions flagged IN the mockup for Q (unresolved judgment calls)

1. **Where does an approved citation land in the published post?** This
   build inserts approved citations as a "Further reading" list appended
   after the body (see `api/_lib/citations/insertCitations.js`, Phase 4)
   rather than attempting inline substring-matching into voice-fidelity
   prose, which is fragile (the model may have rephrased the claim's exact
   wording by the time a citation is approved) and risks corrupting content
   this whole project treats as sacred (see CLAUDE.md's voice-fidelity
   doctrine). This is a judgment call I made given the ambiguity in the
   spec's "inserted with descriptive anchor text" language — flagging it
   explicitly rather than presenting it as settled.
2. **Is a confidence percentage useful to a clinician reviewer, or noise?**
   Easy to drop from the card if Q says it doesn't earn its place.

## What's NOT mocked

- The "Re-check" button's confirmation/loading transition (mocked as two
  separate static states, not an animated transition) — trivial to wire once
  built.
- Mobile/narrow-viewport layout — not checked at <768px. Per this project's
  full-bleed-everything rule, the panel is a simple vertical stack with no
  fixed widths, so it should reflow fine, but this needs a real device/viewport
  check before calling it done, not just an assumption.

## Status

**Backend (Phases 1-2, the retrieval/verification/storage/API layer) does
NOT depend on this mockup being finalized** and should be treated as fully
shipped and correct regardless of how the UI evolves. The UI (Phase 3, this
mockup + its React implementation) is the one piece of this feature that
explicitly wants a human design pass before being called final.
