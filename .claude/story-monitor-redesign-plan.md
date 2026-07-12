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

### Phase 3 — Words approval (keystone) screen + HARD gate
The first approval, as a real screen — and it actually blocks publishing.
- New route `/stories/:id/words` — clinician reads the channel-neutral story words,
  edits inline, passive voice-check chip (reuse `voiceFidelity.js`), "compare to
  transcript" (reuse `TranscriptDrawer`), **Approve the words** button.
- Keystone bar on the monitor: pending (CTA → words screen) vs approved (who + when).
- Persist `interviews.words_approved_at` + `words_approved_by`.
- **Gate enforcement point:** server-side, at the trust boundary — inside the publish
  handlers themselves (`api/publish/buffer.js` incl. `handleBundlePublish`,
  `api/publish/website.js`, `api/publish/beehiiv.js`), not just in `useContentWorkflow`.
  Check the piece's parent `interviews.words_approved_at IS NOT NULL` before dispatching;
  403 `words_not_approved` if missing. Enforcing here (not just in the editor's React
  hook) means it applies to EVERY caller automatically — the editor, AND the Phase 4
  bulk lane — with no separate check to remember adding later.
  `EditorWorkflowBar` mirrors the same check client-side so the button is disabled with
  a link back to the words screen, instead of a raw 403 toast.
- **Scope of the gate:** blocks *publish/schedule/retry* only. Drafting, editing words,
  attaching media, approving-to-publish in the editor's own UI all still work pre-gate —
  you just can't make it actually go out. This is what "greenlights the story into posts"
  means in the mockup copy.
- **`workspaces.skip_review` is unrelated — do not let it bypass this.** That flag skips
  the per-*post* "send for review" step before its own approve; the keystone is a new,
  separate, story-level gate that applies regardless of a workspace's skip_review setting.
  Flag this explicitly in the PR description so a future reader doesn't conflate the two.
- **DB + backfill ordering matters:** migration `ALTER TABLE interviews ADD
  words_approved_at timestamptz, words_approved_by text` + GRANT + snapshot, THEN backfill
  (any story with an existing approved/published piece → set `words_approved_at` to that
  piece's `approved_at`) — backfill MUST land and be verified before the server-side hard
  check ships, or every pre-existing story (including live retry cases like the Knee-Pain
  Facebook failure) becomes unpublishable until someone notices and re-approves. Same PR,
  migration-then-backfill-then-gate-code order, not three separate deploys.
- **Files:** new `src/pages/WordsApproval.jsx`, `src/App.jsx` route (mind the `*`
  catch-all — use nested/`ProtectedApp`), `src/lib/queries.js` mutation, keystone bar
  component, `api/publish/buffer.js` / `website.js` / `beehiiv.js` (gate check),
  `src/components/editor/EditorWorkflowBar.jsx` (mirrored client-side disable).
- **Risk:** medium-high (server-side gate touches every publish path — this is exactly
  the kind of change the git-autonomy policy flags for an explicit check-in given the
  blast radius, even though the logic itself is a simple null-check). **Verify:** Chrome —
  pending story blocks a publish attempt with a clear message + link; approving flips the
  bar and unblocks; a pre-existing published story is NOT blocked (backfill held).

### Phase 4 — Bulk lane keeps working, gains a warning
Not a removal — the bulk fast lane in `ReviewInbox.jsx` ("Add N to queue") and
`YourWeek.jsx` (approve+schedule) stays, deliberately, as the automation-forward path.
It still calls `publishPieceToBuffer` directly (no editor round-trip), and is still
subject to the same Phase 3 server-side words-approval gate as everything else — it only
skips the *per-post visual* check (Approval ②), never the *story-level words* check
(Approval ①).
- Add a visible warning on the bulk action itself: "Scheduling N posts without previewing
  them individually" (or per-item, if any are blocked by the words gate — surface which
  ones and why, same 403 code, human copy).
- **Files:** `src/pages/ReviewInbox.jsx`, `src/pages/YourWeek.jsx` (warning copy +
  surfacing blocked items from the Phase 3 gate). **Risk:** low — additive, no path removed.

## Decisions (locked 2026-07-11)

- **A — Comments.** Merged feed at the bottom of the story: all pieces' threads together,
  each comment tagged with its post; composer targets a specific post. No new table,
  Bernard's per-piece revision loop untouched.
- **B — Words gate: HARD.** Blocks publish/schedule/retry until the story's words are
  approved. Requires the backfill-before-gate sequencing above so existing content isn't
  retroactively locked out.
- **C — Bulk lane: KEPT, with a warning.** Deliberate trade for where Bernard is headed —
  once the cheap, once-per-story words check is hard-enforced, loosening the expensive
  per-post visual check for volume is a calculated efficiency move, not a blind one. Same
  reasoning is why B is hard: B is what makes C safe to keep loose.

## Sequencing
1 → 2 → 3 → 4. 1 is the anchor (biggest surface, ships alone). 2 can ship any time after
1 (independent). 3 must ship as one PR internally ordered migration → backfill → gate code
(see above) — do not split backfill from the gate across separate deploys. 4 depends on
3's gate existing and ships last. Each PR: gate-green + prod-verified in Q's Chrome before
the next.
