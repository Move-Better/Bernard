# Content items and publishing

Read this before changing a `content_items` column or `api/_routes/db/content.js`, the publish lock, a publish path or provider (bundle.social), a per-platform limit, or anything that previews a post. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## A column you can WRITE must also be a column you can READ

`api/_routes/db/content.js` keeps two independent lists: the PATCH allowlist (camelCase →
snake_case) and the `SELECT` string. Adding to one and not the other produces a **write-only
column** — the PATCH succeeds, the row updates, and every reader gets `undefined`. Nothing errors.
The feature is inert, not broken, which is much harder to notice.

That is exactly how `format` shipped in #2467: the picker wrote `content_items.format` correctly,
but SELECT omitted it, so the control never showed its own selection, the badge never changed, and
`publishPiece`'s `piece.format` was undefined — meaning the explicit format never reached the
publish payload either. lint, typecheck, build, 902 unit tests and route-smoke were all green;
only driving the real authed page in prod found it (#2468).

`tests/lib/contentSelectCoversPatch.test.js` now parses both lists out of the route and asserts they
cover each other, with a non-vacuity check so a rotted regex can't pass by matching nothing. It has
already paid for itself: adding `media_source` in #2479 tripped it in CI within seconds, catching in
one test run what had previously cost a full prod debugging session. **When adding a column here,
add both halves in the same edit — and if that guard goes red, it is telling you the truth.**

## A committed post is read-only — and a new content column must be added to the freeze list

`scheduled` and `published` pieces never open an editor. `src/lib/publishLock.js` is the single
source of truth, imported by BOTH the client router (`src/pages/StoryboardPublish.jsx`) and the API
handler (`api/_routes/db/content.js`) — one copy on purpose, so the screen and the server cannot
disagree. Every route into an editor funnels through `/publish/:pieceId`, so the router branch is a
real choke point rather than one door of several.

Content freezes (caption, media, slides, aspect, format, SEO, locations, schedule); judgment stays
live (the keeper rating, winner toggle, notes, comments). `scheduled` gets one escape —
"Unschedule to edit" returns it to `approved` — because without it a typo caught after scheduling
would be unfixable until the post went live. `published` is terminal. `failed` is NOT locked: you
need the editor to fix and retry.

**The maintenance hazard: adding a new content-shaped column means adding its camelCase patch key to
`FROZEN_PATCH_FIELDS`.** Miss it and that one field stays editable on a published post — no error,
no failing test, exactly the silent-drift this exists to stop. Same shape as the write-only-column
trap above: two lists that must be extended together.

Why it matters at all: editing a committed post changes nothing on the network (the payload already
left), so the only thing an edit alters is our record of what shipped — which metrics attribution,
the exemplar pool (`is_model_post` → `fetchTopExemplars`) and the learning loop all read.

The server checks the STORED status, never `patch.status`, so a body claiming `draft` cannot unlock
itself in the same request; blocked writes return 409. The publish pipeline is unaffected —
`social.js` and `dispatchContentItem.js` write via `sb()` directly and never pass through this route.

**That same sb()-direct bypass is also a client-cache hole, not just a server one.** The router's
`isPieceLocked(piece)` gate (`StoryboardPublish.jsx`) reads the React Query cache, which inherits the
global `staleTime: 30_000`. A status flip written by `sb()` directly (cron auto-publish, a sibling
device) never invalidates that cache — so a stale non-locked copy could keep the editor mounted over a
row that's actually locked, with every save silently 409ing until the reactive self-heal in
`useUpdateContentItem`'s `onError` (an `isLockRejection` catch that force-refetches) finally kicked in
on the first failed write. Fixed in #2662 by forcing `refetchOnMount: 'always'` on `useContentItem` for
the publish route, so the gate re-reads status on every open instead of trusting a cache the write
pipeline never told to update. Any other surface that gates on `isPieceLocked`/similar off a cached
query needs the same override — a reactive self-heal on write-failure is not the same as preventing the
stale-render window in the first place.

## A preview is not the published artifact

When a feature renders something to a `<canvas>` (or any in-memory/preview-only surface) and the user can *see* it, that is NOT evidence the same artifact ships at publish/export. The render and the publish are different code paths. This codebase has several preview-vs-output surfaces — carousel on-screen text (`renderFreeformSlide`), the email-template iframe, image/video overlays — and they're easy to get wrong in the same way: the preview looks perfect, the live output is raw.

The 2026-05-29 carousel bug (PR #980) was exactly this: per-slide overlay text (`content_items.slides`) was drawn to a preview canvas via `renderFreeformSlide` but never turned into an image file or uploaded; publish sent the raw `media_urls` photos, so the on-screen text vanished from the live post.

Rule: for any feature that renders a derived artifact (overlay image, composited graphic, baked text, watermark), grep the renderer's callers. If it's called only in `*Preview` / `*Editor` components and never in a publish/upload/export path, the published output is stale or raw — the renderer needs a real produce-and-upload step on the publish path (reuse the SAME renderer so it stays WYSIWYG), not just a canvas. Confirm the live output, not the editor preview, before calling it done.

## Buffer vs bundle.social publish paths: platform-specific limits don't auto-share

*(Historical — the file is now `api/_routes/publish/social.js` and the Buffer fork was deleted in #2488, so the divergence described here no longer exists. The LESSON is what survives: two hand-synced paths for one job silently diverge, and that is why they were collapsed.)*

`api/_routes/publish/buffer.js` routed every publish through one of two provider paths — the original Buffer path, or `handleBundlePublish` for workspaces on `publish_provider='bundle'`. The bundle path's own comment calls it "byte-for-byte identical" to the Buffer path for non-GBP platforms, which reads as if platform-specific rules (character caps, media limits) are shared — they are NOT. Each path independently re-implements any provider constraint, so a rule enforced in one silently doesn't exist in the other unless someone copies it over by hand.

Found 2026-07-07: the Buffer GBP branch already truncated captions to Google's 1500-char cap (`rawText.slice(0, 1500)`, line ~297) — but `handleBundlePublish`'s GBP branch never did. Any workspace on the bundle.social provider publishing a caption over 1500 chars got a 502 `bundle_gbp_post_failed` with no indication why (bundle.social's real error — a 400 "String must contain at most 1500 character(s)" — was swallowed into the opaque error key per the no-`detail`-in-error-response rule; only visible via `vercel logs --status-code 502 --expand`).

Rule: when adding or auditing a platform-specific constraint (length cap, media-count cap, format requirement) in one publish provider path, grep the sibling path for the same platform and confirm the constraint is mirrored there too — don't assume "byte-for-byte identical" claims in code comments have stayed true as the paths evolved independently. `src/lib/contentMeta.js`'s `CAPTION_LIMITS` map is the client-side mirror of these same caps (surfaced as an editor warning, added in #1960 as a follow-up) — keep it in sync with whatever the server paths actually enforce.

**Same root cause recurs at the UI-copy layer, not just server dispatch.** When the original single-provider integration (Buffer) grew a second provider (bundle.social), the *server* dispatch logic was audited for provider-specific branching, but ~12 UI strings across `AssetsPane.jsx`, `WorkspaceSettings.jsx`, `YourWeek.jsx`, `ReviewInbox.jsx`, `AutoPublishSettings.jsx`, `ChannelsSettings.jsx`, `Onboarding.jsx`, `ProducerOnboarding.jsx`, `ContentBriefDetail.jsx`, and `BufferMetricsRow.jsx` kept hardcoding "Buffer" — including "Published to Buffer" and "Scheduled on Buffer" — regardless of `publish_provider`. Went unnoticed for weeks because **movebetter, the flagship live workspace, is the only workspace on `'bundle'`** (confirmed via `SELECT slug, publish_provider FROM workspaces`) — every other seed/test workspace is still `'buffer'`, so the mislabel was invisible in casual testing. Fixed 2026-07-08 (#1988) by making the copy provider-neutral ("Add to queue", "Scheduled", "Published") rather than dynamically branching every string on the workspace's provider — matches bundle.social's own onboarding pitch of "no third-party tool to manage." Also caught bundle.social missing from the Privacy Policy sub-processor table — a live, undisclosed sub-processor. Rule: when a feature is generalized from single- to multi-provider, grep user-facing copy for the old provider's literal name (`grep -rn "Buffer" src/pages src/components`) as a separate pass from auditing server logic — and check `SELECT DISTINCT publish_provider FROM workspaces` to know which provider is actually live on which tenant before judging blast radius.

**A quality FIX to a shared prompt-building call needs the same "grep every caller" sweep as a security gate — a UI action that looks like it reuses the primary path can be a separate hand-rolled reimplementation.** Shipping sibling-caption dedup into `draftAtom.js` (the core used by first-draft generation, #2270), the natural next question was "does regenerating an existing draft from the UI get this fix too?" It did not: `api/_routes/content-items/regenerate.js` — what the UI's "Regenerate" button actually calls — never imports `draftAtom.js` at all. It's a separate, hand-written `getAtomSystemPrompt(...)` call that had silently drifted from the canonical path (missing the sibling-dedup param that didn't exist yet when it was written, same as the Buffer/bundle divergence above). Caught only because the fix's own follow-up asked "does the recovery path for the bug this fixes actually get the fix" — not by a general audit. Confirmed via `grep -rn "getAtomSystemPrompt(" api/` that there were exactly 3 call sites total, not by trusting that draftAtom.js was the only caller. Rule: after fixing a bug in a shared generation/prompt-building function, grep every call site of that function's *public entry point* (not just the file you edited) before calling the fix complete — a second reimplementation of "the same" prompt call is exactly where a fix silently doesn't apply. (#2278, 2026-07-22.)

**A "hard gate, enforced at every publish path" claim is only as complete as the list of paths you audited — and a route-by-route sweep misses any path that dispatches server-to-server without going through an HTTP route at all.** Shipping the Phase 3 words-approval gate (`api/_lib/wordsApprovalGate.js`), the plan was to enforce it in every publish handler — audited by tracing the client's network calls: `publishItem()` → `/api/publish/buffer`, `publishBlogToWebsite()` → `/api/publish/website`, `sendBlogToBeehiiv()` → `/api/publish/beehiiv`, plus the manual `/api/producer/retry-publish` route. All four got the gate, all four verified green, and the PR description said "enforced in every publish path." That was false: `api/_lib/dispatchContentItem.js` is a **fifth dispatch entry point** — server-side auto-publish for the Standing Producer's "approve from /week" flow (`api/_routes/content-plan/approve.js`) — that calls `BundlePublisher.publish()` directly with no HTTP round-trip and no gate check at all. It was invisible to a client-network-call audit because there IS no client call to trace; the server calls the publisher itself. Found by accident one phase later, while adding unrelated bulk-lane warning copy, not by a deliberate audit — and it was live and reachable on `movebetter` (the one tenant on `publish_provider='bundle'`) the whole time the gate was "done." Rule: when a security-relevant gate needs to cover "every publish path," don't enumerate HTTP routes from the client side — grep for every caller of the underlying dispatch primitives instead (`BundlePublisher.publish`, `runBufferPublish`, `runBundlePublish`, and equivalents for any other external-send call), since a server-internal dispatch helper with no route of its own won't show up any other way. Treat "enforced everywhere" as an unverified claim until you've done that grep, not just until the known routes pass.

**Writing a new invariant into ARCHITECTURE.md does NOT make existing code comply — sweep for violations in the same PR, or you have documented a bug rather than fixed one.** The two sweeps above both fire when you *change code*. This one fires when you only *write a rule*, which feels like documentation and therefore safe. It is the more dangerous case: the rule now reads as settled, so the next person greps ARCHITECTURE.md, finds the contract stated plainly, and assumes the codebase honors it. (2026-07-22, #2272: the media-suggestion picker started returning videos, and ARCHITECTURE.md gained "a video's `blobUrl` is the raw `.mov`/`.mp4` and is **never** a valid `<img src>` … guard it with `isVideoEntry()`." Correct, and written as a *consequence for any surface that may now receive both* — i.e. framed forward, at new code. Four live sites in `PostPreview.jsx` were already violating it right then: every video post in the product previewed as a black rectangle, because an `<img>` pointed at an `.mp4` fails to load and the `onError` handler hides it. A user reported it **the next day** (#2308); the fix was a shared `VideoFrame` component, and the same PR found a fifth latent hole where a render branch tested `m.type === 'video'` instead of the canonical `isVideoEntry()`.) **Rule: when you add an invariant to a doc, immediately grep for the anti-pattern it forbids and either fix or explicitly inventory the existing violators in that PR.** The grep is usually trivial and mechanical — here, `grep -rn "thumbnailUrl" src/` surfaced all four in one call. **Corollary for reading a bug report: its list of affected sites is a lower bound, not the scope.** This report named three; there were four, and the missing one (`MediaCarousel`, the Facebook/LinkedIn path) was the most-used. Grep the *pattern*, never trust the enumeration.

## bundle.social's `upload/from-url` endpoint — no declared size cap, but a ~100s gateway timeout

Building the Library's YouTube publish lane (#2545), a bundle.social blog post claimed "resumable
uploads for videos up to 1GB." Their actual API reference page states no number at all — only that
"platform-specific size limits, codecs, and duration caps still apply at post creation time." The blog
figure was simply wrong, and would have blocked half the real interview library from a feature that
had no real size problem.

**Measured directly against the live endpoint 2026-08-03:** a 2.26 GB 4K mp4 POSTed to
`/api/v1/upload/from-url` returned 200 in 90s, correct metadata, uploaded object confirmed via a
follow-up `GET /api/v1/upload/`. A 5.9 GB file on the same route returned a Cloudflare 524 at 125s —
and a follow-up list call confirmed nothing landed; it is a genuine failure, not a slow success. The
constraint is a **~100s gateway timeout on the endpoint itself**, not a declared byte ceiling — at the
observed ~25 MB/s ingest that puts the practical wall near **2.5 GB**. If bundle ever moves `from-url`
ingestion onto the SDK's separate chunked `init`/`finalize` upload path, re-measure — that path is
architecturally different and may not share this timeout.

`api/_lib/youtubeCopy.js`'s `YOUTUBE_MAX_UPLOAD_BYTES` constant is the canonical value; re-derive it
from a fresh measurement rather than copying this paragraph's number forward indefinitely.
