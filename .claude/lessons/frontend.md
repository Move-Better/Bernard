# Frontend (`src/`)

Read this before a page layout, making something clickable, a route or back link, client polling, an ESLint rule, a Tailwind token, a brand-colour sweep, or a mockup. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## Mockup-first — Bernard's serving recipe + worked examples

Serve mockups with `python3 -m http.server <port>` from inside `.claude/` — NOT `npx serve` (it 301-redirects `foo.html`→`/foo` then 404s, and hides dot-directories so a worktree-root `serve .` can't reach `.claude/mockups`). Files need a full `<!doctype html><head><meta charset="UTF-8">` skeleton — a bare fragment defaults to no charset header and the preview browser mangles emoji/em-dashes into mojibake. Drive the Claude_Preview tools at an **explicit wide width (1360)** — the "desktop" preset reverts to a narrow size that hides the md-breakpoint sidebar. Full preference + how-to: `memory/feedback_mockup_first_for_ui.md`.

**Prefer the `Artifact` tool over the local-server flow for single-component before/after mockups** — redeploying to the same call updates the URL in place for fast iteration, and it sidesteps the charset footgun above. Reserve `.claude/mockups/` + local-server for multi-screen flow prototypes needing live interaction wiring (toggles, view switches, `sendPrompt`-style state).

Worked examples of the global mockup-first rules (`~/.claude/CLAUDE.md` "Mockup-first", and `~/.claude/lessons/product.md`), for institutional memory:
- **Read real components first:** 2026-06-02, two mock rounds reinvented channels-as-a-checkbox and the words editor, overwriting shipped atoms-per-channel and per-piece "Edit words" — built without reading `ContentPlanPanel.jsx` / `atomPlan.js` / `StoryboardPiece.jsx` first.
- **Screenshot before code:** 2026-06-21, "sidebar too wide" cost 4 PRs of guessing pixel values before a screenshot showed the real cause was ~45px of dead padding in `Layout.jsx`.
- **Subjective polish still needs a mockup:** 2026-06-16, a photo-template render-tweak session shipped six PRs straight to prod before Q stopped it — the trap was treating the client canvas renderer (`renderFreeformSlide` in `overlayTemplates.js`, uses `document`/`window`, can't be node-harnessed) as covered by the node-harness exception, which is for render *correctness*, not *design sign-off*.
- **Hand-drawn conditional state:** 2026-07-22, the `/week` schedule strip mock (#2257) drew one amber chip by eyeball where the stated rule (`!isPast && got < target`) actually lights three on the same real week — required a follow-up PR (#2260).
- **Borrow the platform's vocabulary:** the T3 mockup labeled Instagram's format mix "Post/Carousel · Reel · Story," a taxonomy Meta and `bundlePublisher.js` (`type: 'POST'|'REEL'|'STORY'`, no carousel type) don't have — grep `api/_lib/social/bundlePublisher.js` for the real outbound enum before naming a platform concept.

## Every screen is full-bleed — page roots must not self-narrow

Q's standing rule (repeated, frustrated — 2026-07-07): **all screens must be full-bleed; screen space is used fully and wisely.** A page centered in a narrow column with big empty side gutters reads as broken to Q — it's his single most recurring visual complaint, so treat full-bleed as the default, not a per-request ask.

The Layout shell is ALREADY full-bleed: `src/components/Layout.jsx` has `const fullBleed = true` → `<main className="px-4 sm:px-6 lg:px-8 py-8">` with no max-width. Narrowness only ever comes from a **page** wrapping its own root in `mx-auto max-w-*`. So:

- A new/edited page's root fills the width — just padding (e.g. `py-6`), never `mx-auto max-w-3xl`.
- "Fully AND wisely" ≠ stretch one column to 1900px. Use the width: side rails (`AnswerReview` = answer + sticky "Up next" queue rail, #1938), multi-column card grids (interview primers = `grid sm:grid-cols-2`, #1941), CTAs `w-full sm:w-auto` (no full-width button bar).
- On a review/queue screen that advances to the next item on action, `window.scrollTo({ top: 0 })` when the active item id changes — else a new item loads under the old scroll position and it's invisible that anything happened (#1938).
- **Legitimate exceptions (leave centered):** legal reading pages (Privacy/Terms — readable measure), `max-w-*` on a `<p>` for text measure, and centered `text-center py-16` empty/loading states. Those are correct, not offenders — don't strip them.
- Daily drivers (Home, Stories, StoryDetail, Library, Slate, YourWeek, Analytics, MediaHub, Settings, Overview) are already full-bleed — verify a new page matches them, don't reintroduce a centered column.

## Making a static element clickable — it inherits anchor color, and a DOM assertion won't catch it

Wrapping a previously-static `<div>` in a `<Link>`/`<a>` to add a click affordance silently repaints its text: the anchor inherits the global link color (Blue Spruce `--primary`, `rgb(12,115,126)`) instead of `text-foreground` (`rgb(11,17,30)`). Nothing errors, lint and build pass, and the element genuinely works — it's just a different color than the design called for. (2026-07-22, #2236 → #2239: linking the `/week` cadence tiles repainted all four channel labels teal, which then competed with the teal progress bars the strip uses to carry its actual signal.) **Fix: put `text-foreground` on the `Link` when the element wasn't link-colored before.**

Two things make this worth its own rule right now:

- **A passing DOM assertion is blind to it.** The prod probe confirmed 4 links, correct `href`s, correct `aria-label`s, hover class, focus ring — all green — while the visual regression was live. Only the screenshot showed it. When a change converts an element's *tag*, assert on `getComputedStyle(el).color` against `document.body`'s, not just on structure and classes.
- **This conversion is happening a lot.** T3's slot work, #2244, #2245 and #2236 all made previously-static cards/tiles clickable in the same week. Expect it on any "make X clickable" fix.

The inverse is the same bug from the other side, and both shipped in the same week: **don't add a hover-lift (`hover:shadow-md`) without a click handler, and don't add navigation without a visible hover/focus affordance.** A card that lifts but doesn't navigate produced ~9 of `/week`'s 22 dead clicks in the 2026-07-22 UX sweep (#2245). Ship the affordance and the behavior together, or neither.

## Router conventions (App.jsx)

The outer `<Routes>` in `src/App.jsx` has a deliberately minimal shape:

```jsx
<Route path="/privacy" element={<PrivacyPolicy />} />
<Route path="/terms" element={<TermsOfService />} />
<Route path="/onboard" element={<OnboardingShell />} />
<Route path="*" element={<ProtectedAppWithProvider />} />
```

Every authenticated app route — including deep paths like `/onboard/interview` and `/onboard/brand-kit` — flows through the `*` catch-all into `ProtectedAppWithProvider`, which renders a descendant `<Routes>` block matching the actual page. **Do not add explicit outer exemptions** like `<Route path="/onboard/interview" element={<ProtectedAppWithProvider />} />`.

React Router v6 footgun: a parent `<Route>` matched with a fixed path (no `/*` splat) consumes the entire URL. The descendant `<Routes>` rendered inside the parent's element then matches against the EMPTY remainder, and an inner `<Route path="/">` (Home) matches the empty index — so the page silently renders Home at the wrong URL. The `*` catch-all sidesteps this because `*` is splat: the matched parent path is empty, so descendant routes see the full URL. Three PRs in the 2026-05-21 onboarding sprint were burned chasing this; see PR #729.

If you genuinely need an outer exemption (e.g. for a route that must bypass `WorkspaceProvider` or `OrgGate`), use `<Route path="/your-path/*">` with the splat to preserve descendant matching.

### Back navigation — use `useSmartBack`, never a hardcoded `<Link to="/…">`

Any "Back" / breadcrumb-return / close-that-navigates affordance must use the shared `useSmartBack(fallback)` hook (`src/lib/useSmartBack.js`), NOT a hardcoded `<Link to="/stories">` or `onClick={() => navigate('/foo')}`. The hook does `navigate(-1)` when real in-app history exists (`window.history.state?.idx > 0`) and only falls back to the passed route for direct links / a fresh tab. A hardcoded destination is wrong whenever the page is reachable from more than one entry point — the canonical failure was StoryDetail's "Back to Stories" always dumping the user on `/stories` even when they arrived from a Campaign, Staff profile, or Review inbox. `fallback` may be a function for a route-derived default (e.g. VideoEditor: `() => location.pathname.startsWith('/slate') ? '/slate' : '/moments'`). `BackLink` already routes through `useSmartBack`, so its `to` prop is a *fallback*, not the always-destination — prefer `BackLink` for the Stories→Storyboard→Publish spine. (Swept app-wide 2026-07-07, #1939; ~25 pages.) True hierarchy breadcrumbs (`Breadcrumb`) stay hardcoded — they express structure, not history.

## Async pipelines and the detail-drawer refresh contract

When a feature writes meaningful row fields from background work (`waitUntil`, queued jobs, webhook callbacks — anything that PATCHes the row 5+ seconds after the user-facing request returns), the list view's existing refetch-on-upload covers grid/thumbnail freshness but the detail drawer does NOT see the update without help. Without this, users opening the drawer immediately after a triggering action see stale state (e.g. `status='raw'` while the pipeline still runs) and assume the feature is broken.

Rule: any PR that adds a new pipeline-PATCHed column on `media_assets` / `content_items` / `interviews` must also ensure the relevant detail view re-reads the row while the pipeline is still pending. The canonical pattern (see `src/components/MediaDetail.jsx`):

```js
const { data: liveAsset } = useQuery({
  queryKey: ['media-asset', asset.id],
  queryFn: () => getMediaAsset(asset.id),
  initialData: asset,
  refetchInterval: (q) => {
    if (!pipelinePending(q.state.data)) return false
    if (Date.now() - pollStartRef.current.at > 60_000) return false  // hard cap
    return 2000
  },
  refetchOnWindowFocus: false,
})
```

`pipelinePending` is a row-shape predicate (`!web_blob_url` for photos, `transcode_status in ('pending', 'processing')` for videos, etc.). The 60s hard cap matters — silent pipeline failures must not produce an infinite polling loop. Editable form state stays seeded from the original `asset` prop on `asset.id` change so in-progress user edits aren't clobbered by a poll round-trip.

**Hard cap is universal — not just for MediaDetail.** Every `useQuery` with a `refetchInterval` that polls while a status is pending MUST have a time-based hard cap, regardless of where it lives. A Vercel function killed at the 300s wall does not run its `finally` block, so `catch`-based terminal status writes never fire — any "in-progress" status can strand permanently. The `MediaDetail` 60s cap is the reference implementation; page-level polling (Slate packages, ClipFinder segments, Book generation) must apply the same pattern with an appropriate ceiling (60s–5min depending on expected job duration). No cap = silent infinite-poll loop until the tab closes. Found in 2026-05-29 audit: Slate.jsx and ClipFinder.jsx both omitted the cap.

## Custom ESLint rules to know before writing JSX

Three project-specific rules bite hard if you don't know them:

- **`react-hooks/static-components`** — component functions defined **inside** another component's render function (`const Foo = () => ...` inside `function Parent()`) reset their state on every render and trigger this error. Fix: declare all sub-components at **module scope**, outside any other component. Caught on `ProgressDots` in the demo session (2026-06-07).
- **`react-hooks/immutability`** — "Cannot reassign variable after render completes." Fires when you mutate an outer variable *during* a render `.map()` — the classic case is a running accumulator like `let lastMonth = null` reassigned inside the map to draw group/section headers (month dividers, running totals, "first of its kind" flags). Fix: **precompute** the per-row derived data before the JSX (a plain `const rows = items.map((s, i) => ({ ...s, showHeader: i === 0 || key(s) !== key(items[i-1]) }))`), then render from that array — compare against the previous item by index instead of threading a mutable outer var through render. (Caught building the Stories dense table's month-group headers, 2026-07-10 #2080.)
- **`bernard/no-arbitrary-text-size`** — prohibits `text-[10px]`, `text-[11px]`, etc. Use the semantic tokens instead: `text-3xs` (10px) or `text-2xs` (11px). Lint will error at 0-warnings-allowed; the fix is a global replace before committing.
- **`bernard/no-raw-use-mutation`** — use `useAppMutation` not raw TanStack `useMutation`.
- **`bernard/no-raw-api-fetch`** — use `apiFetch`/`apiFetchResponse`, never bare `fetch('/api/...')`.
- **`bernard/no-hardcoded-brand-color`** — bans retired brand-color *literals* (Move-Better orange `#e36525` / hue-20 `hsl(20 …)` / `rgb(227,101,37)`, grey `#6e7072`, evergreen `#1c4d37`, coral `#ff8552`) anywhere in a `src` JS/JSX string. Use the design tokens instead: `bg-primary`/`text-primary`/`hsl(var(--primary))` (emerald brand), `bg-action`/`hsl(var(--action))` (amber act-now signal) — defined in `src/index.css` + `src/lib/brand.js` (the single JS-side brand source). Added #1297 after the #1294 repaint was a multi-file hunt; it immediately caught a `#E36525` a case-sensitive grep had missed. For a genuinely-intentional exception, `eslint-disable-next-line bernard/no-hardcoded-brand-color` with a reason.
- **`bernard/no-temperature-on-opus`** — `temperature`/`top_p`/`top_k` return a 400 on Claude Opus 4.7+ (incl. 4.8). Flags an object literal that sets a sampling param next to a `model` resolving to an Opus 4.7+ id (inline string or same-module const). Registered for `api/**`, `api/_lib/**`, and `src/**`. Added #1699.

**Adding a new `bernard/*` rule? Don't create a fresh config block that overlaps an existing one — flat config errors `Config (unnamed): Key "plugins": Cannot redefine plugin "bernard"`.** `eslint.config.js` already defines the `bernard` plugin in the `api/**` block (which `ignores: ['api/_lib/**']`) and the `src/**` block. A new top-level block whose `files` glob overlaps either of those (e.g. `['api/**/*.js']`) tries to define `bernard` a second time for the same file → the whole lint run dies before checking anything. Fix: register the rule inside the **existing** `api/**` and `src/**` blocks (add to both `plugins.bernard.rules` and `rules`), and only add a *separate* block for files those blocks miss — scoped so it never overlaps (e.g. `files: ['api/_lib/**/*.js']` to cover the helpers the `api/**` block ignores). (#1699 hit this adding `no-temperature-on-opus`.)

## `bg-popover` / `text-popover-foreground` were undefined in `tailwind.config.js` — verify a token compiles before trusting it

`--popover` / `--popover-foreground` are defined in `src/index.css` (opaque white), and `bg-popover`/`text-popover-foreground` are used in several components (`WorkspaceSwitcher`'s dropdown, `SidebarNavLink`'s collapsed tooltip) — but `popover` was never added to `theme.extend.colors` in `tailwind.config.js` (unlike `card`, `accent`, etc., which all have a matching entry). Tailwind silently drops unknown utility classes rather than erroring, so `bg-popover` compiled to **nothing** — those menus/tooltips rendered with zero background and page content showed straight through. This had apparently been live and unnoticed in `WorkspaceSwitcher` before a new sidebar nav flyout (#1895) hit the same bug and made it visible (#1896 fix).

Rule: when using any `bg-<token>`/`text-<token>-foreground` class backed by a CSS custom property in `src/index.css`, confirm the token has a matching entry in `tailwind.config.js`'s `theme.extend.colors` — grep the config, don't assume a var's existence means the utility class works. If you're unsure, check the built CSS (`grep -o "\.bg-<token>{[^}]*}" dist/assets/*.css` after `npm run build`) — a real rule should show `background-color:hsl(var(--<token>))`; an empty/missing match means the utility is a no-op.

## Every `/api` call goes through `apiFetch` (Definition of Done detail)

Every new `fetch()` to an `/api` route uses `apiFetch` or `apiFetchResponse` — never a raw `fetch()` that could miss the Bearer token — enforced by the `bernard/no-raw-api-fetch` ESLint rule. The rule flags a raw `fetch('/api/...')` only when it can prove no `Authorization` header is attached (variable/spread headers get the benefit of the doubt, so authenticated saves don't trip it). A genuinely public endpoint uses `apiFetch(path, { auth: false })` or an inline `eslint-disable-next-line bernard/no-raw-api-fetch` with a reason. This was the PR #1064 class: tokenless loads of `/api/workspace/me` silently got the slim public-branding shape, so saved settings (`enabled_outputs`, `plan`, `locations`, …) reverted on reload.
## A horizontal tab/filter row must not overflow at phone width (Definition of Done detail)

**Any page with a horizontal tab/filter row** → confirm it doesn't overflow at ~390px. A `flex items-center gap-2` row with 3+ buttons + a `w-48 ml-auto` search input totals 600–700px minimum — guaranteed horizontal scroll on mobile, making the site look "not loading." Fix: tabs in `overflow-x-auto` inner div with `shrink-0` buttons; search in `sm:ml-auto` outer row with `w-full sm:w-48`. (Hit on Slate #1316 → fixed #1322, 2026-06-10.)
## Brand-color refresh checklist
Whenever the project's primary brand color or one of the semantic tokens (`--success`, `--warning`, `--info`, `--destructive`, `--verbatim-accent`, `--agreement-signal`, `--contrast-signal`) shifts, audit every place those tokens are used as a **navigation or state color** — not just decorative tinting. These are easy to miss because each page reads as internally consistent until you flip between pages.

Common drift sites to grep for after a refresh:

- **Sidebar / tab active states** — historically `bg-success/10 text-success` (green). Should follow the primary brand color when the active state means "selected" rather than "succeeded." (Caught in SettingsLayout, May 2026 blend rollout.)
- **"Do this now" / publisher-inbox surfaces** — historically `bg-blue-50` / `text-blue-700` (cool blue). All of these — Home Drafts card, PipelineKanban Ready-to-Distribute lane, DraftsReadyRow, LibraryReadyStrip — should share one warm-tint treatment so the user's eye lands on the same color for "act now." (LibraryReadyStrip was the straggler.)
- **Mobile section nav chips** — same active-state lineage as the desktop sidebar; usually live in a separate `MobileNavRail` block.
- **Hover states on cards** — `hover:border-primary/30` or `hover:bg-accent/20` get stale when the accent shifts.
- **Status pills inside content surfaces** — green `success` pills used to label things like "Published" stay correct on a refresh; the bug is when the same green is doing duty as a nav active state.

Quick grep:
```
grep -rn "bg-success/\|text-success\|bg-blue-50\|text-blue-700\|bg-info" src
```

**Hex sweeps MUST be case-insensitive (`grep -ri`).** Hex appears in both cases (`#e36525` vs `#E36525`), and a case-sensitive `grep -o "...e36525..."` silently misses the uppercase ones. The #1294 emerald repaint's final-inventory greps were case-sensitive and left a live `#E36525` brand-accent fallback in `StoryboardPiece.jsx` — caught only later by the `bernard/no-hardcoded-brand-color` lint rule (which is case-insensitive). After any color sweep, re-grep with `-i`, and lean on the lint rule as the real backstop rather than a hand-rolled grep.

**Class-string sweeps are ORDER-sensitive — verify with a per-token AND grep and a live-DOM probe, not the pattern you swept with.** A repeated Tailwind class combo (`bg-success text-white shadow-sm …`) drifts into copies with the same classes in a different order, which a byte-exact `Edit replace_all` (and a grep for the canonical string) silently miss — the sweep "completes" with stragglers still live. (2026-07-15, #2150→#2151: the ConnectedBadge dedup left 2 of 10 copies — one order-variant in the same file, one in a sibling component file — caught only by a prod DOM probe `querySelectorAll` filtering on both class tokens independently.) Rules: (1) after any repeated-class sweep, re-grep order-agnostically — `grep -rn "<tokenA>" src | grep "<tokenB>"` — across ALL of `src/`, not just the file you swept; (2) for an authed surface, close the loop with a DOM probe in Q's Chrome counting old-vs-new class tokens (`[class*=…]`), which proves both bundle freshness and sweep completeness in one call; (3) the durable fix for a badge/chip repeated across files is a shared component (`src/components/ui/`), not a swept string.

After fixing, sanity check by clicking through every major surface (Home, Stories, Library, Settings + subpages, Account) in one sitting and watching for any color that doesn't belong to the new identity. Cross-page review catches what per-page review misses.
