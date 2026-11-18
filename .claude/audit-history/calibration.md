# Audit Calibration

Maintained automatically by `/audit` and `/auditfull` (Phase 3 synthesis). This file is
**force-tracked** (`git add -f`) despite living inside the gitignored
`.claude/audit-history/` directory — audit *reports* stay local/ephemeral per-developer
(existing convention), but this one file needs to survive into a fresh worktree so the
audit gets sharper each run instead of re-litigating the same ground. Same pattern as
force-tracking a signed-off mockup out of the otherwise-gitignored `.claude/mockups/`.

Every agent prompt in Phase 2 is given this file's contents before it starts.

## Known false positives / intentional design

<!-- Entries here tell agents "don't re-flag this unless the code changed." Format:
- [agent] file:line — what was flagged — why it's not actually a problem (YYYY-MM-DD)
Add an entry when a finding is reviewed and judged not-a-bug (intentional pattern,
accepted risk, dead code path that can't execute, etc). Remove an entry if the cited
code is later touched in a way that could reintroduce the issue. -->

- [ui-reviewer] src/pages/Usage.jsx:118,141 — `bg-primary/45` flagged as a bare-fraction
  compile failure by ui-reviewer's own (incomplete) safe-fraction list — DISPROVEN by
  direct compiled-CSS check (`grep -o 'bg-primary\/45{...}' dist/assets/*.css` finds it,
  full background-color rule present). `/45` compiles fine; the bug is specifically
  `/6`, `/8`, `/11`, `/12`, `/13` (see the P1 finding). Don't re-flag `/45`, `/55`, `/65`,
  or `/85` — all four were checked against the real build this run and all compile.
  (2026-07-31)

- [ui-reviewer] src/pages/Analytics.jsx:284-304 — SEO "Total clicks"/"Branded clicks"
  rendering smaller than "Non-branded clicks" is DELIBERATE HIERARCHY, confirmed by Q
  (2026-08-08): non-branded organic traffic is the SEO signal that means something;
  total and branded are supporting context and are meant to read as secondary. Flagged
  independently by two audits (07-31, 08-08) before being settled — do not report the
  size difference again. A finding here is only real if the EMPHASIS INVERTS (branded
  or total rendered larger than non-branded) or the non-branded stat loses its
  prominence entirely. (2026-08-08)

## Chronic / recurring (flagged 2+ audits running, still unresolved)

<!-- Auto-appended by Phase 3 synthesis when a finding matches an entry in "Findings
snapshot" below and wasn't fixed in between. Format:
- [agent] file:line — problem — first flagged YYYY-MM-DD, seen again YYYY-MM-DD (Nx)
Remove an entry once the finding stops appearing (i.e. it got fixed). -->

- [bug] api/_lib/aspectVariants.js:95,156 — saveAspectVariant find-then-insert race (two
  near-simultaneous reframes of one source+channel insert duplicate variants) — first flagged
  2026-07-31, seen again 2026-08-08 and 2026-11-18 (3x). Blocked on migration
  203_aspect_variant_unique.sql being applied to prod plus a 23505-tolerant insert; filed to
  the Needs-you inbox 2026-11-18 because it needs a prod migration sign-off.

## Findings snapshot (for next run's recurrence check)

<!-- Auto-overwritten every run by Phase 3 synthesis with a flat list of THIS run's P0/P1
findings (file:line + one-line problem + date). Audit reports themselves are gitignored
and don't survive into a fresh worktree, so this snapshot — inside the one force-tracked
file — is what the NEXT run diffs against to detect recurrence. After comparing, the next
run overwrites this section with its own snapshot. -->

From the 2026-11-18 FULL run (report: 2026-11-18-full.md in the primary checkout, sha
3ea172d9, scheduled by audit-when-due). Items marked FIXED shipped in the audit PR with a
test watched failing first; if one reappears, that is a regression, report at P1 minimum.
From the 2026-08-08 snapshot: the 3 FIXED bug items were not re-flagged; the OnHandTab
MomentExcerpt pencil is FIXED (outline Button + aria-label, #2591/#2687); aspectVariants
recurred and moved to Chronic.

- [bug] api/_routes/billing/webhook.js:173 — checkout.session.completed PATCH filtered on
  stripe_customer_id=eq.<new customer>; a first-time subscriber has NULL there, so the
  workspace was never activated — 2026-11-18 (FIXED: or=(is.null,eq) for checkout only;
  tests/lib/billingWebhookFirstCheckout.test.js)
- [bug] api/_lib/longformEngine.js:162 — stale reclaim reset dead 'rendering' pieces to
  'pending' with no attempts cap, so a piece killed by the 300s wall looped forever —
  2026-11-18 (FIXED: staleReclaimRequests fails exhausted pieces first)
- [bug] src/components/story-detail/SlideEditor.jsx:441 — autosave whitelist dropped
  objects (logo layer), scrim and rendered_url/rendered_sig — 2026-11-18 (FIXED: moved to
  src/lib/slideSave.js; test pins SlideEditor to it)
- [bug] api/publish/website.js:383 — uploadMedia fetched client-supplied image URLs with a
  bare redirect-following fetch (SSRF, readable via WordPress) — 2026-11-18 (FIXED:
  api/_lib/ssrfGuard.js fetchPublic, shared with scan-website)
- [bug] api/_routes/producer/retry-publish.js:151 — publish-now retry wrote 'published'
  ahead of bundle — 2026-11-18 (FIXED: built on dispatchCommitFields)
- [tenant] api/_routes/media/[id].js:197 — PATCH stored thumbnailUrl/renderedUrl unchecked;
  both later reach blob del() in a store shared by every tenant — 2026-11-18 (FIXED:
  isWorkspaceBlobUrl; the blobDel call sites themselves still trust stored URLs)
- [bug] src/pages/VideoEditor.jsx:103,228 — restore reads a cached (up to 5 min) asset row,
  so a reopen can restore an older video_edit_draft and autosave writes it back — 2026-11-18
  (OPEN, inbox: no component-test harness to prove a fix)
- [bug] api/_lib/aspectVariants.js:95,156 — see Chronic (OPEN, inbox)
- [bug] api/_lib/dispatchContentItem.js:157 — server dispatch sends every media item to GBP;
  the editor path sends one — 2026-11-18 (OPEN, inbox: whether bundle rejects multi-media GBP
  is unverified)
- [bug] api/_routes/publish/social.js:76-97 — GBP fan-out partial failure discards the posts
  already made, so a retry re-posts those locations (auto-publish keeps a posted-set) —
  2026-11-18 (OPEN, inbox)
- [bug] api/_routes/webhooks/twilio-recording.js:189 — completion PATCH unchecked; a failed
  write strands the interview in 'processing' — 2026-11-18 (OPEN, inbox)
- [ui] WeeklyRecapPanel.jsx:241,262,301,321 and ProducerSettings.jsx:180 — Link rows inherit
  the teal link colour (no text-foreground) — 2026-11-18 (OPEN, needs a mockup)
- [ui] PhotoTemplates.jsx:751, BrandAnchorsEditor.jsx:120, PointCapture.jsx:188,
  StoryDetail.jsx:156, Book.jsx:362 — action controls visible only on hover, unreachable on
  touch — 2026-11-18 (OPEN, needs a mockup; same pattern as the fixed OnHand kebab/pencil)
- [live] T4 video_segments.discard_reasons — carried; not re-checked this run (no prod read)

## Escaped (found after an audit)

Bugs that staff, Sentry or feedback reported inside code an audit had covered (added 2026-11-16, Q). One line each: date found, file, the shape of the bug, and which audit covered it. A pattern that appears here twice becomes a named bug shape in the agent prompts. Empty so far.

## Notes for agents

- If a finding below is listed under "Known false positives," don't re-report it unless
  the cited file has materially changed since the note was written — check `git log
  --oneline -- <file>` for commits after the note's date before trusting the note.
- If a finding is listed under "Chronic," treat it as at least P1 regardless of your own
  read of severity. Recurrence across multiple audits without a fix is itself a signal —
  it means the finding isn't getting picked up, not that it's low priority.
