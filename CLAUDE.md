# Bernard — Project Notes

Bernard is Move Better's multi-tenant content SaaS. It interviews clinicians (voice or chat) and turns
what they said into posts, reels, carousels, blogs and answers for each workspace's channels, published
through bundle.social. One shared Vercel deployment serves every workspace by subdomain
(`<slug>.withbernard.ai`).

This file loads into every session in this repo, so it holds only the standing rules, the stack and an
index. The detail lives in topic files under `.claude/lessons/`; read the matching one before work in
that area (table at the end). Subsystem design is in [ARCHITECTURE.md](ARCHITECTURE.md). Q's
cross-project rules (challenge gate, design interview, mockup-first and the quiet lane, verify feature
wiring, re-verify before fixing) are in `~/.claude/CLAUDE.md`, and the generic lessons are in
`~/.claude/lessons/` (judges in `ai.md`, guards in `testing.md`, the hidden agent tab in `browser.md`).
This file does not restate them.

Code comments and older docs cite sections as `CLAUDE.md "<heading>"`. Those sections moved, headings
unchanged, into the topic files on 2026-11-11: `grep -rn "<heading>" .claude/lessons/` finds one.

## Product strategy lives in Vigil — read it before big packaging/tiering changes

Bernard's SaaS-productization strategy (plan tiers, pricing, managed-vs-BYO analytics, onboarding/activation, what's tenant-product vs Move-Better-private) is tracked in the **Vigil** repo, not here: `specs/bernard-saas-productization.md` (plus follow-on specs `specs/bernard-tier-assignment.md` and `specs/bernard-onboarding-path.md` as they land). Vigil is the read-only oversight layer that authors these specs and hands them to Bernard. Key decisions as of 2026-07-11: per-location flat pricing + free trial; jobs-based tiers (Get Found → Grow → Scale/Pro); base-tier analytics is *managed* (OAuth channel data + bought SEO data), never make a clinic wire up GA4/GSC/PostHog. Before building anything tiering-, pricing-, onboarding-, or feature-gating-shaped, read that spec so you don't build against the plan.

## Standing rules

- **Every screen is full-bleed (Q, 2026-07-07, repeated).** A page root never narrows itself with
  `mx-auto max-w-*`; use the width with side rails and multi-column grids. The exceptions (legal pages,
  text measure on a `<p>`, centered empty states) are in `frontend.md`.
- **Bernard's product colours never enter tenant content, and a tenant's colours never enter app
  chrome (Q, repeatedly).** Blue Spruce `#0C7580` (`BERNARD_PRIMARY`) and amber `#d97706`
  (`BERNARD_ACTION`) are app chrome only. A tenant's own colour, from its `workspaces` row (Move Better is
  orange `#E36525`, live), is for its published content only, so an orange Move Better caption is
  on-brand. Lint enforces both walls (`bernard/no-hardcoded-brand-color`,
  `bernard/no-product-brand-in-content`); detail in `media.md`.
- **Templates are authored in the real editors (Q, 2026-07-25).** A look is saved with "Save as …
  template" from VideoEditor's Captions panel or SlideEditor's Theme panel. The settings pages
  (`/settings/photo-templates`, `/settings/video-templates`) are libraries, not editors: never add style
  controls there (`media.md`).
- **Verify an authed UI change on prod, in Q's logged-in Chrome (Q, 2026-06-04).** Merge → the GitHub
  integration auto-deploys → confirm the live SHA → drive Q's Chrome and look. Never call a UI change
  verified off localhost, a preview URL or a green build, and never report an authed surface as
  "blocked by Clerk". Keep the Playwright e2e suite thin (`verify.md`).
- **Driving prod is read-only, and a page load or a `fetch()` can write.** Never click Approve, Publish,
  Schedule, Delete or Send. Before opening an editor or calling a "render"/"compose"/"generate" route
  against a real row, check whether it persists on mount or on call (`verify.md`).
- **Staff-update screenshots come from `scripts/capture-screenshot.mjs` (Q, 2026-11-12).** For these,
  Bernard's local Playwright script wins over the global "real Chrome only" screenshot rule
  (`screenshots.md`).
- **GBP Analytics "location detection failed" is a dead end (Q closed it 2026-07-22).** Never suggest
  retrying it; the shared Google project's quota is 0 and Basic API Access was denied
  (`integrations.md`).
- **An approved mockup is force-added (Q, 2026-06-20, "Option A").** `.claude/mockups/` stays gitignored
  for drafts; `git add -f` a mockup the moment Q signs off on it (`housekeeping.md`).
- **In-app feedback is the `feedback` table, never the inbox**, and `resolved_at`, not the
  open-time `triage_note`, says whether it is fixed. Resolving emails the reporter, so confirm before
  resolving (`housekeeping.md`).
- **This repo's instruments are `bernard-`-prefixed:** `/bernard-audit` (`full` for the whole
  codebase), `/bernard-checkup`, `/bernard-outcome-review`, `/bernard-triage-feedback`. A same-named
  command can load a sibling project's body (`housekeeping.md`).

## Process discipline (Bernard's additions to the global rules)

- **Challenge gate: decisions log.** Bernard's decisions log (kill criteria, revisit dates, for the
  global adversarial brief) is `.claude/decisions.md` (tracked). `/bernard-outcome-review` reads it and
  stamps revisit-by dates on every run; its scheduled run (`bernard-monthly-outcome-review`) fires weekly,
  on Fridays. Worked example of a signal with no consumer: `verify.md`.
- **Re-verify a reported bug** with the cheap staleness checks: `git fetch && git log --oneline -8 origin/main -- <suspect file>` (did someone just touch it?) and `curl -s https://withbernard.ai/version.json` vs `git rev-parse origin/main` (is the fix already deployed?). 2026-06-02: an overnight "fix Slate (empty video grid)" task was nearly a from-scratch rebuild of a fix (`mediaData.assets` shape mismatch + missing `staff_id` SELECT field) that had already shipped as #1146 and was live on prod — caught only by these two checks plus the worktree re-read rule (an 87-line diff between the stale branch and `origin/main`).
- **Verify feature wiring along this repo's chain:** the `src/` page → `apiFetch` → the handler under
  `api/` (most live in `api/_routes/`, registered in the generated `api/_routes/_manifest.generated.js`)
  → Supabase REST → the screen, job or publisher that reads it back. Dead-scaffold precedents:
  `verify.md`.
- **Code minimalism — YAGNI gate before building.** Before writing code, run the ladder: (1) **does this need to exist at all?** — don't add unrequested abstractions, parameters no caller passes, or dead scaffolds (the global "Verify feature wiring before scoping changes"); (2) does stdlib / a native platform feature / an already-installed dep already cover it? use it, add no new dependency; (3) can it be one small function? Prefer deletion over addition, fewest files. Mark any intentional shortcut with a `ponytail:` comment stating its limit and upgrade path.
  **Hard carve-out — never trim a check to be lean.** This bias is wrong for trust-boundary code, where Bernard's bugs come from the *missing* check, not excess abstraction. On any tenant-scoped API handler, `workspaceContext(req)` + the `workspace_id` filter + `requireRole` + `enforceLimit` are non-optional even for a read-only count endpoint — `workspaceContext` resolves the tenant from the Host header, which is **not** authentication. When in doubt, keep the check and apply the ladder only to the logic around it.

## Stack

- **Client:** React 18 SPA built with Vite 5; React Router 6; TanStack Query 5; Tailwind 3 with Radix
  primitives; a PWA (a service worker serves a cached shell, which matters when verifying, `verify.md`).
- **Server:** Vercel Node functions under `api/`, Express-style `(req, res)` handlers, one shared
  deployment for every tenant. Edge only where a handler says so (`api.md`).
- **Auth:** Clerk; each workspace is a Clerk Organization.
- **DB:** Supabase Postgres, read and written through PostgREST with the service role. No RLS, by
  design: isolation is the `workspace_id` filter in every handler (ARCHITECTURE.md, `data.md`).
- **Storage:** Vercel Blob (store `bernard-prod`); Mux for video transcoding.
- **AI:** the AI SDK (`ai` 7) through the Vercel AI Gateway (Claude models); OpenAI Realtime for voice
  interviews; ElevenLabs for voice cloning and transcription.
- **Publishing:** bundle.social (`bundlesocial`); Resend for email; Twilio for outbound calls.
- **Observability:** Sentry, PostHog, Vercel Analytics. Rate limits: Upstash.
- **Tests:** Vitest (`tests/`); a thin Playwright smoke (`tests/e2e/`) that runs after each deploy.

## Run / build / test

```bash
npm run dev                  # Vite dev server; authed pages can't load locally (Clerk pk_live is domain-locked, verify.md)
npm run build                # prebuild writes version.json, the blog and the API route manifest, then vite build
npm test                     # Vitest
npm run lint                 # ESLint at --max-warnings 0 (the ratchet only goes down, git-deploy.md)
npm run typecheck            # tsc --noEmit
npm run verify-bundles       # imports every api/ handler to catch load-time crashes (api.md)
npm run verify-api-manifest  # the generated route manifest is in sync
npm run schema:verify        # committed schema snapshot vs live prod columns (data.md)
npm run e2e                  # Playwright smoke
```

**Deploys:** every merge to `main` auto-deploys to `withbernard.ai` in about 2 minutes. Do not run
`npm run deploy:prod` after your own merge; it is for emergencies, from the project root on a synced
`main` only. Confirm a deploy with a cache-busted `curl -s "https://withbernard.ai/version.json?cb=$(date +%s)"`
and an ancestry check (`git-deploy.md`).

## Architecture in brief

- **Tenancy:** `workspaceContext(req)` resolves the workspace from the Host subdomain (not
  authentication); every tenant-scoped query filters by `workspace_id`. Tenant config lives on the
  `workspaces` row; publish credentials in `workspace_credentials`, encrypted with
  `WORKSPACE_CREDENTIALS_KEY` (**Sensitive**) (`data.md`).
- **Content:** a post is a `content_items` row. `media_urls` holds `[{url, type, kind, …}]` objects,
  never bare strings (`media.md`). `scheduled` and `published` posts are frozen by
  `src/lib/publishLock.js` (`publish.md`).
- **Mirror pairs:** several render decisions exist twice, a server bake and a client preview; a fix to
  one is not a fix to the other (`media.md`, "Client/server mirror pairs").
- **Migrations:** `supabase/multitenant/migrations/`, applied by hand with no tracker;
  `supabase/expected-schema.json` is the committed snapshot (`data.md`).

## Conventions every change follows

- **A new `/api` route** follows the seven-rule checklist in `api.md`: no `detail:` in error responses,
  `UUID_RE` on every filter param, `workspaceContext` → `requireRole` → `enforceLimit` in that order,
  `timingSafeEqual` for signatures, `waitUntil()` for post-response work, `:id` from the pathname, and a
  JSON body from DELETE. The Node handler shape is `(req, res)` with `res.status().json()`.
- **The client** calls `/api` through `apiFetch`/`apiFetchResponse` and mutates through
  `useAppMutation` (both lint-enforced, `frontend.md`).
- **A new `content_items` column** goes into both the PATCH allowlist and the `SELECT` in
  `api/_routes/db/content.js`, and its camelCase key into `FROZEN_PATCH_FIELDS` if it is content
  (`publish.md`).
- **A new table, view or function** carries `GRANT … TO service_role` in the same migration; take the
  migration number from `ls supabase/multitenant/migrations | tail -1` (`data.md`).
- **Blob keys** are namespaced by `ws.id`, never `ws.slug` (`media.md`).
- **One worktree per session.** The project root (`/Users/qbook/Claude Projects/Bernard`) is only for
  `git pull` on `main` and `npm run deploy:prod` (`git-deploy.md`).
- **The 1Password mount** is `/Users/qbook/Claude Projects/Bernard/.env.bernard.1pw` (**Sensitive**),
  in the primary checkout only; never read `.env.local.1pw`, which hangs (`housekeeping.md`).

## Definition of Done
Every PR must satisfy this checklist before merging. The triage on 2026-05-14 traced 12+ bugs to exactly these gaps being skipped.

### Code quality
- [ ] `npm run typecheck` exits 0 — no new implicit-any or JSDoc contract violations
- [ ] `npm run lint` exits 0 at or below the current ratchet ceiling — never raises it without an equal offset
- [ ] `npm run build` exits 0

### Logic
- [ ] Every new `useMutation` call uses `useAppMutation` (not raw TanStack `useMutation`) — enforced by the `bernard/no-raw-use-mutation` ESLint rule
- [ ] Every new `fetch()` to an `/api` route uses `apiFetch` or `apiFetchResponse` — enforced by `bernard/no-raw-api-fetch` (detail: `frontend.md`)
- [ ] Every new API handler that touches a tenant-scoped table calls `workspaceContext(req)` and filters by `workspace_id`
- [ ] 401 / 403 branches are handled on `err?.status`, not `err?.message` string matching

### New API routes
- [ ] The handler shape matches the runtime (`(req, res)` for Node, `(req: Request)` for Edge)
- [ ] The Supabase table/column exists on prod before the PR is merged (verify with Studio SQL Editor or `scripts/apply-multitenant-migrations.mjs`)
- [ ] New tables include `GRANT … TO service_role` in the same migration file

### Testing
- [ ] **Job-level done, not component-done**: if the PR produces an artifact or output a user acts on, the artifact demonstrably reaches the surface where the user consumes it (the draft appears in /week, the rendered file lands on the content item, the published post is live). "The function returns correct bytes" is component-done. The recurring failure class this gates: render-segments baking reels into a b-roll graveyard, carousel overlay text previewed but never published, drafts born without media — working parts, broken job.
- [ ] Feature used in-browser at least once before the PR is opened (the step most often skipped)
- [ ] Any page with a horizontal tab/filter row doesn't overflow at ~390px (`frontend.md`)
- [ ] For large-surface features: run `npm run e2e` or manually smoke the relevant page on the Vercel preview URL
- [ ] A changed label, heading, button name or default route on a page an E2E spec covers updates that spec in the same PR (`git-deploy.md`)

### Merge hygiene
- [ ] Branch rebased on current `origin/main` (`git fetch && git rebase origin/main`) immediately before opening the PR
- [ ] `gh pr merge <num> --auto --squash` set on open so CI gates the merge

## Topic files

Read the matching file in `.claude/lessons/` before work in that area; several can apply to one task.

| File | Read before |
|---|---|
| `api.md` | adding or changing a route under `api/`, a handler's runtime or shape, post-response async work, a media download, the function-bundle check |
| `data.md` | a migration; a new table, column or status value; a query on tenant data; a staff delete or merge; a lookup keyed on a workspace |
| `publish.md` | a `content_items` column or `api/_routes/db/content.js`, the publish lock, a publish path or provider, a per-platform limit, a post preview |
| `media.md` | a renderer or compositor, the video or slide editors and templates, captions, grades, thumbnails, `media_urls`, the blob store, the email template, any colour in tenant content |
| `frontend.md` | a page layout, making something clickable, a route or back link, client polling, an ESLint rule, a Tailwind token, a brand-colour sweep, a mockup |
| `ai.md` | a prompt or `src/lib/prompts.js`, streaming chat, the realtime voice session, an LLM judge or rubric, a tactic classifier, image generation |
| `integrations.md` | Search Console, GBP Analytics, GA4, the citation probe, decrypted `workspace_credentials`, a rebrand, retiring a domain |
| `verify.md` | scoping a change to an "existing" feature, verifying an authed UI change on prod, driving Q's Chrome, calling a live API from the browser |
| `screenshots.md` | merging a user-visible UI change (the staff-summary screenshot), running `scripts/capture-screenshot.mjs` |
| `git-deploy.md` | a worktree or branch, a rebase, opening or merging a PR, a red check or E2E smoke, the lint ceiling, a deploy |
| `housekeeping.md` | an audit or checkup, triaging or resolving feedback, deleting or committing under `.claude/`, the memory index, the 1Password mount |

## Where a lesson lives (this repo)

- **A Bernard lesson** goes into the matching topic file above as one bullet or short section: a bold
  one-sentence rule, the detail, a source note (date, PR). Rewrite a corrected lesson in place; never
  append a correction under it. Search the file for the same trap before adding.
- **A standing rule Q states for this repo** goes in this file, short.
- **A lesson true in every project** goes into the matching `~/.claude/lessons/` file instead.
