# "Post" composer — the orphaned-drafts fix (Posts tab)

**Status:** built, gates green, ready for PR. Design signed off by Q 2026-07-16.
**Mockup (spec):** `.claude/mockups/posts-list-mockup.html` → https://claude.ai/code/artifact/b2f1570f-47aa-4cd5-8c6d-e81bcaeca2ea

## Context — the composer already shipped; this fixes a live gap in it
The manual-first "Post" composer (as-written/adapt toggle, post-now/schedule/draft, photo+video) shipped as **#2164** and is live in prod. But it had no *home*: a Post has `interview_id: null`, and `buildStories()` (`src/lib/stories.js:106`) drops interview-less rows, so **every Post surface in the app is blind to it**. Live impact: "Save as draft" was a dead end (unreachable), "Schedule" fired externally but was invisible in-app, "Post now" left no in-app record. One real orphaned row sat stranded in prod for 15 days (`569bd729…`, an IG-story draft).

## Decisions (design interview, 2026-07-16)
- Home = a **Posts tab on Stories** (option B) — not folded into `buildStories()`, not a separate nav item.
- **One row per Post**, channels shown as chips (grouped by `brief_id`).
- **Keep the name "Post"** + clarify with copy (Buffer/Hootsuite convention: one composed post → channel chips). One post → the channels you pick.
- Each row opens the existing `/publish/:id` editor + publish spine (works by raw id, interview-agnostic).

## What this PR does
| File | Change |
|---|---|
| `api/_routes/db/content.js` | New `origin=post` GET filter → `&brief_id=not.is.null` (validated allowlist). Precise, server-side, scales past the fetch limit. |
| `src/lib/publish.js` | `fetchContentItems` passes `origin` through. |
| `src/components/stories/PostsTableView.jsx` (new) | `useContentItems({origin:'post'})` → group per-channel rows back into one row per Post (by `brief_id`), section by lifecycle (Draft/Scheduled/Published), row → `/publish/:id`. Matches the real `StoriesTableView` look. |
| `src/pages/Stories.jsx` | Stories \| Posts top-level tab (`?tab=posts`); Posts branch renders `PostsTableView` + a "New post" button. |
| `src/pages/NewBrief.jsx` | Redirect after create → `/stories?tab=posts` (was `?source=brief`, which showed nothing). Subtitle clarifier: "One post → the channels you pick." |

The orphaned prod row is **not swept** — it simply becomes visible/editable in the new Drafts section (the fix un-orphans it), so no destructive action.

## Verified
typecheck ✓ · lint ✓ (0 warnings) · build ✓ · verify-bundles ✓ (252/252). Data path validated against the real orphaned row via Supabase (filter returns it; shape renders as a Draft/Story/photo row). Authed UI (Stories page) verifies post-deploy in Q's Chrome — Clerk `pk_live` is domain-locked, no localhost auth.

## Known limitations → follow-ups (NOT in this PR — kept focused on reachability)
1. **Multi-channel editing:** clicking a grouped Post opens the primary (draft-first) channel's editor; editing/publishing one channel doesn't propagate to siblings. → per-channel actions or a row-level "publish all" later.
2. **Text-post editor routing:** a text-only Post opens the *visual* (photo) editor — `resolveArchetype()` maps facebook/gbp/etc → `visual`. Functional (OPTIONAL media tier + words rail) but not ideal → route text-only to a doc/text editor.
3. **FB/GBP + video misroute:** `resolveArchetype()` only refines instagram for video, so a facebook/gbp video → `visual` → SlideEditor filters the video out (it vanishes in the editor). Real but narrow → refine `visual`+video → a video archetype.
4. **Calendar chip:** scheduled Posts show in the Posts tab's Scheduled section; the Overview calendar still derives from interview-grouped stories → widen that query later (precedent: `StoriesCalendarView.jsx:71`).
