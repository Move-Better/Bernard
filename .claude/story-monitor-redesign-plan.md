# Story monitor redesign — implementation plan

**Approved mockup:** `.claude/mockups/story-monitor-redesign.html` (locked 2026-07-11) ·
Artifact: https://claude.ai/code/artifact/b6d520b1-1d17-49cf-a6d6-ff5c71923286

## The model (locked)

Two jobs, two screens. Two approvals, one per screen.

- **Review & monitor** = the Story detail page (`/stories/:id`). Validate the words once,
  watch each post, step into the editor to send.
- **Compose & publish** = the editor (`/publish/:pieceId`). This is the ONLY place a
  post can publish, schedule, or retry.

Two approvals:
1. **Approve the words** (keystone) — story-level, once. Voice validation, judged from
   text → lives at the top of the monitor + its own words screen. NEW.
2. **Approve to publish** — per post, in the editor, seeing the finished post. Already
   exists as `EditorWorkflowBar`'s gate; semantics narrow to "OK to send."

Nothing publishes from a wall of raw text again. The per-channel tab console on the
current Story detail screen is retired.

## What already exists (grounded 2026-07-11)

- `content_items.performed_well` (bool) = the winner flag. `WinnerToggle` already flips
  it and already renders only on `status === 'published'`. ✅ published-only is already true.
- `StoriesTableView` already loads `s.pieces[] = {platform, status, …}` and computes
  `hasFailed`. Failure/winner badges are a render change + one extra SELECT field.
- Per-post publish approval + retry already live in the editor (`EditorWorkflowBar`,
  `useContentWorkflow`). No new publish path needed.
- Comments are **per-piece** (`useComments(pieceId)`, `api/_routes/content-item-comments`),
  wired into Bernard's revision loop (auto-reply to change-requests on a specific piece).
- Approval today is **per-piece** (`migration 032_approval_workflow`, `approved_by`). There
  is **no** story-level words approval — the keystone gate is net-new.
- `ApprovalPanel` is shared: rendered by both `AssetsPane` (monitor) AND
  `StoryboardPublish`. Do NOT delete it — just stop rendering it on the monitor.

## Phases

### Phase 1 — Rebuild the monitor (core visual change)
Turn `AssetsPane` from a per-channel publish console into a per-story status list.
- Retire on this screen: the LinkedIn/Facebook/Blog **tab row**, the plain-text caption
  box, `RegenerateButton`, `ApprovalPanel` (per-post approve/publish/schedule), the
  "Retry now" banner, the "Regenerate & preview" mock.
- Add: **post status sub-rows** (new `PostStatusRow`): channel badge · status pill
  (draft/scheduled/published/failed) · preview thumbnail · (published) performance +
  `WinnerToggle` · single **Open in editor** → `/publish/:pieceId`.
- Keep: story header + metadata pills, transcript rail/drawer, "what you covered",
  References. Move the keystone bar to the top (Phase 3 fills its approve wiring; ships
  as a static "approved" state derived from existing per-piece approvals until then).
- Comments: relocate to the bottom of the story (see Open Decision A).
- `postThumb(piece)` helper: baked composite / first media image, else type placeholder.
- **Files:** `src/components/story-detail/AssetsPane.jsx` (major), `src/pages/StoryDetail.jsx`,
  new `src/components/story-detail/PostStatusRow.jsx`, `src/lib/mediaEntry.js` (thumb helper).
- **DB:** none. **Risk:** high (biggest surface). **Verify:** Q's Chrome on movebetter —
  Knee-Pain story shows 3 status rows, no caption console, Open-in-editor works.

### Phase 2 — List badges (failures + winners)
Surface per-post state on the Stories table platform icons.
- Failed post → red platform icon + row tag (partly there via `hasFailed`).
- Winner post → gold star on its platform icon. Add `performed_well` to the list query;
  compute per-platform worst-status + any-winner.
- **Files:** `src/components/stories/StoriesTableView.jsx`, the stories list API/query
  (`api/_routes/db/*` / `src/lib/queries.js`) to SELECT `performed_well`.
- **DB:** none. **Risk:** low. **Verify:** Chrome — Knee-Pain row red FB icon + starred blog.

### Phase 3 — Words approval (keystone) screen + gate
The first approval, as a real screen.
- New route `/stories/:id/words` — clinician reads the channel-neutral story words,
  edits inline, passive voice-check chip (reuse `voiceFidelity.js`), "compare to
  transcript" (reuse `TranscriptDrawer`), **Approve the words** button.
- Keystone bar on the monitor: pending (CTA → words screen) vs approved (who + when).
- Persist `interviews.words_approved_at` + `words_approved_by`.
- **Files:** new `src/pages/WordsApproval.jsx`, `src/App.jsx` route (mind the `*`
  catch-all — use nested/`ProtectedApp`), `src/lib/queries.js` mutation, keystone bar
  component.
- **DB:** migration — `ALTER TABLE interviews ADD words_approved_at timestamptz,
  words_approved_by text` + GRANT + snapshot. **Backfill:** any story with an
  approved/published piece → set `words_approved_at` (they clearly validated).
- **Gate policy:** soft in v1 — surface the gate, don't hard-block publish (see Open
  Decision B). **Risk:** medium. **Verify:** Chrome — pending → words screen → approve
  flips the bar.

### Phase 4 — Strip publish from non-editor surfaces (needs product call)
Enforce "publishing only from the editor" everywhere.
- `ReviewInbox.jsx` (bulk "Add N to queue" → `publishPieceToBuffer` directly) and
  `YourWeek.jsx` (approve+schedule → `publishPieceToBuffer` directly) bypass the editor
  entirely — no visual gate. Route them into the editor's per-post gate.
- **Tension:** bulk-approve is efficient but blind; the model says Approval ② needs the
  visual. Real product decision (see Open Decision C) — CONFIRM before building.
- **Files:** `src/pages/ReviewInbox.jsx`, `src/pages/YourWeek.jsx`. **Risk:** high +
  reshapes the weekly workflow.

## Open decisions (need Q)

- **A — Comments at story bottom.** Comments are per-piece + load-bearing for Bernard's
  revision loop. Recommend: bottom-of-story **merged feed** of all pieces' threads (each
  comment tagged with its post), composer targets a post — no new table, loop preserved.
  Alt: new lightweight story-level thread (separates "team chatter" from per-post revision
  requests, but adds a table + two comment systems).
- **B — Words gate: soft or hard?** Soft (surface, don't block; backfill existing) ships
  safe. Hard (block publish until words approved) is the cleaner model but needs careful
  `skip_review` reconciliation + backfill. Recommend soft v1 → harden later.
- **C — Bulk publish (Phase 4).** Keep bulk-schedule as a power path with a warning, or
  force every post through the editor's visual gate? Determines whether YourWeek /
  ReviewInbox keep a fast lane.

## Sequencing
1 → 2 → 3 independent enough to ship as separate PRs (1 is the anchor; 2 and 3 can follow
in either order). 4 is gated on Decision C and ships last. Each PR: gate-green +
prod-verified in Q's Chrome before the next.
