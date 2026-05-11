# NarrateRx — Deep UX & Architecture Review

**Audit date:** 2026-05-10
**Method:** Seven parallel deep-read passes across save/feedback patterns, onboarding/first-run, content creation flow, Media Hub, global UX, settings/workspace, and architecture/code health. P0 claims spot-checked against the actual code.
**Per-area reports (long form):** `/tmp/narraterx-audit-{save-feedback,onboarding,content-flow,media-hub,global-ux,settings,architecture}.md`

---

## TL;DR

The app is solid in its core flows but is missing the connective tissue every modern SaaS has — a toast system, an error boundary, an HTTP client with real error handling, and responsive chrome. Your gut feeling was right. There are also **three real security bugs** that should jump the queue ahead of UX work.

Three findings together account for ~80% of the "feels unfinished" perception:

1. **No global toast/notification system.** Every Save reinvents inline feedback differently. `ClinicianProfile` even falls back to `window.alert()`.
2. **No top-level ErrorBoundary** and the HTTP client (`src/lib/api.js`) is 7 lines with no retry, no 401/403/5xx handling, no offline detection. Every flaky network call shows as a white screen or a swallowed error.
3. **Empty states are inconsistent.** Dashboard has a thoughtful empty state; MediaHub and ContentCalendar show literally nothing when empty.

Underneath those, three security issues need fixing before the next external tenant is onboarded.

---

## 🚨 Security — fix before next external tenant (half-day total)

These are not UX; they're real.

### S1 — `api/db/*` routes are unauthenticated and not workspace-scoped
Files: [api/db/interviews.js](api/db/interviews.js), [api/db/clinicians.js](api/db/clinicians.js), [api/db/content.js](api/db/content.js), [api/db/settings.js](api/db/settings.js)

`api/db/interviews.js:32` runs `?id=eq.${id}&select=...` against Supabase as `service_role` with **no workspace filter and no auth check**. The `x-user-id` header is read but never used. Anyone authenticated to any tenant can GET any interview/clinician/content row by ID. Topic search (`:46`) is also cross-tenant.

The pattern violates the rule already in `CLAUDE.md`: *"Every API route that touches tenant-scoped tables must call `workspaceContext(req)` … the workspace_id filter the same way you'd treat an authorization check."*

**Fix:** require Clerk auth, derive `workspace_id` from `workspaceContext(req)`, add `&workspace_id=eq.${ws.id}` to every query. Half day.

### S2 — `/api/generate` and `/api/stream` are unauthenticated
[api/generate.js:11](api/generate.js), [api/stream.js:11](api/stream.js)

No auth, no rate limit. Anyone who finds the URL can drain the AI Gateway budget. Rate limiting is also missing app-wide.

**Fix:** require Clerk session, add `@upstash/ratelimit` (one Upstash KV in Marketplace, ~30 min wiring). Total ~2 hours.

### S3 — `WorkspaceProvider` silently falls back to static workspace on fetch failure
[src/lib/WorkspaceContext.jsx:49-57](src/lib/WorkspaceContext.jsx)

When `/api/workspace/me` fails, the provider falls back to the build-time static workspace without telling the user. On a tenant subdomain that means they see somebody else's brand. Low likelihood of triggering, high blast radius.

**Fix:** show an error banner and keep the user out of mutating actions until resolved.

---

## 🔥 P0 — The "this feels unfinished" cluster (1–3 days)

### U1 — No global toast/notification system
Audit found zero `sonner` / `react-hot-toast` / Radix Toast. The word "toast" appears only in a code comment ([src/components/BulkActionBar.jsx:136](src/components/BulkActionBar.jsx)). Every Save handler reinvents inline saving/saved/error UI — and that's *why* clicking Save feels inert. [ClinicianProfile.jsx:60](src/pages/ClinicianProfile.jsx) uses `window.alert()` for delete errors.

**Fix:** `npm i sonner`, mount `<Toaster richColors position="top-right" />` in `App.jsx`, build a `useSaveAction(fn, { successMessage })` hook, ship a `<SaveButton saving saved />` component. One PR replaces five different inline implementations.

### U2 — No top-level ErrorBoundary; api.js is 7 lines
[src/main.jsx:6-10](src/main.jsx), [src/lib/api.js:1-8](src/lib/api.js)

Any unhandled throw = white screen. `apiFetch` has no 401/403/5xx handling, no retry, no abort, no offline detection, no automatic `x-user-id` / Clerk session injection. Every caller duplicates header construction.

**Fix:** ErrorBoundary at root with a useful fallback. Rewrite `api.js` with typed errors, auto-inject auth, retry on 5xx/network, 204 handling, and an `onError` hook that pipes into the toast system from U1.

### U3 — Empty states are missing on key surfaces
- [MediaHub.jsx:298-322](src/pages/MediaHub.jsx) — empty library renders nothing under the filters. Verified.
- [ContentCalendar.jsx:128-180](src/pages/ContentCalendar.jsx) — empty month grid with no coaching.
- ContentHub when no briefs.
- Strategy.jsx is purely static education copy — no CRUD despite the page name.

Dashboard, by contrast, has a thoughtful `EmptyState` ([Dashboard.jsx:751-808](src/pages/Dashboard.jsx)) — copy that pattern.

### U4 — Header is not responsive, no document titles, no OG tags
[src/components/Layout.jsx:18-58](src/components/Layout.jsx) — single flex row with 4 links + chip + button + 2 icons + UserButton, no hamburger, no breakpoints. Breaks on phones. [App.jsx:236-238](src/App.jsx) sets document title once on mount — every route shows the same title in the tab. [index.html:1-14](index.html) has no `meta description` or OG tags.

**Fix:** `<Sheet>` mobile nav (shadcn), `useDocumentTitle(title)` hook per page, fill in `index.html` head.

### U5 — Save = silent
A few of the worst offenders, all verified:
- [MediaDetail.jsx:112-125](src/components/MediaDetail.jsx) Save auto-closes drawer on success with no toast. Exact thing you complained about.
- [InterviewSession.jsx:304-308](src/pages/InterviewSession.jsx) `handlePause` cancels speech and navigates away mid-utterance with no confirmation — silent data discard.
- [ReviewPost.jsx:108](src/pages/ReviewPost.jsx) autosave failure is swallowed by `catch {}`.
- [ContentBriefDetail.jsx:86-92](src/components/ContentBriefDetail.jsx) status transitions (Accept/Reject/In progress/Archive) have no feedback.
- [WorkspaceSettings.jsx:242](src/pages/WorkspaceSettings.jsx) "Saved" pill disappears in 3s on a 1,171-line scroll page — invisible if you're not looking.

U1's toast system fixes most of these in one shot. U5 is really the *consequence* of U1.

---

## P1 — Big quality-of-life wins (1 day each)

### Topic management is genuinely broken (your "add new topics" complaint)
Three disconnected topic systems exist:

| System | Field | Surface | Add-new UI |
|---|---|---|---|
| Interview suggestions | `workspaces.topic_suggestions` JSONB | NewInterview chips | **None — DB-only** |
| Free-text topic | `interviews.topic` | Everywhere downstream | Anyone types |
| Website publish category | `workspaces.publish_topics` JSONB | Blog publish dropdown | Inline admin (shipped in 582b44c) |

The 582b44c affordance works — but only on the blog publish step inside [InterviewOutput.jsx:764-814](src/pages/InterviewOutput.jsx). It's missing from NewInterview, ContentHub filter, ReviewPost, and Strategy. The two workspace topic fields don't sync: adding a publish topic does not add it to the interview suggestion chips.

**Fix:** add a Topics card to `/settings/workspace` that edits both JSONB fields, surface "Add to suggestions" inline in NewInterview for admins, and add a topic filter to ContentHub.

### Member management does not exist in-app
[WorkspaceSettings.jsx:222-492](src/pages/WorkspaceSettings.jsx) has no invite/list/change-role/remove UI. [useUserRole.js:25-27](src/lib/useUserRole.js) *reads* role from Clerk metadata but nothing in-app *sets* it. External tenants who self-onboard at `/onboard` cannot add a teammate.

**Fix:** mount Clerk `<OrganizationProfile />` at `/settings/members` and `<UserProfile />` at `/account` — single PR, biggest settings gap.

### Onboarding wizard ends on a spinner, not a celebration
[Onboarding.jsx:824-845](src/pages/Onboarding.jsx) auto-redirects to `/settings/workspace` after success — splits the "I made a workspace" moment from the `/welcome` flow that fires on the next page load. Also blank-screen flicker during `OrgGate` ([App.jsx:66](src/App.jsx)) and `WelcomeGate` ([App.jsx:131](src/App.jsx)) returning `null`. New sign-ins can see 1–3 unbranded blanks before anything renders. **Fix:** branded loader component, success celebration step in the wizard, redirect to `/` (Dashboard) not `/settings/workspace`.

Other onboarding gaps worth fixing same-PR:
- [Dashboard.jsx:76](src/pages/Dashboard.jsx) greets with brand name, not user name. `useUser()` is imported but unused.
- [Dashboard.jsx:184-196](src/pages/Dashboard.jsx) — getting-started items 3 & 4 hard-code `done: false`. Never tick off.
- [App.jsx:68-87](src/App.jsx) — "No access to this workspace" tells user "ask your admin" with no email, mailto, or request-access affordance.
- [App.jsx:196-211](src/App.jsx) — Sign-in screen is text-only. For invited team members this is the entire welcome.
- Welcome `ANNOUNCEMENTS` is a static module array — Animals tenants see Move Better's "patient" copy.

### `confirm()` / `prompt()` / `alert()` for destructive actions
Multiple sites:
- [ContentBriefDetail.jsx:87, :91](src/components/ContentBriefDetail.jsx) — `confirm()` and `prompt()`.
- [BulkActionBar.jsx:213](src/components/BulkActionBar.jsx), [MediaDetail.jsx:190](src/components/MediaDetail.jsx), [CollectionsBar.jsx:83](src/components/CollectionsBar.jsx), [WorkspaceSettings.jsx:713, :1026](src/pages/WorkspaceSettings.jsx), [Integrations.jsx:358](src/pages/Integrations.jsx) — `window.confirm`.

[ClinicianProfile.jsx:168-200](src/pages/ClinicianProfile.jsx) already shows the right shadcn AlertDialog pattern — generalize and apply everywhere. Add "type the workspace name to confirm" for credential removal and workspace delete.

### Regenerate is one-click destructive with no undo
[ReviewPost.jsx:246-316](src/pages/ReviewPost.jsx) overwrites manual edits. **Fix:** stash the previous version, show an "Undo regenerate" toast for 30 s.

### Speech recognition auto-submits on `end`
[InterviewSession.jsx:285-302](src/pages/InterviewSession.jsx) — Chrome glitches that fire `onend` mid-sentence get sent as final answers. **Fix:** require explicit Send unless silence > 2 s.

### Blog generation has no streaming
[InterviewSession.jsx:310-345, :517-529](src/pages/InterviewSession.jsx) — opaque 60-120 s spinner using non-streaming `generateContent` while `streamMessage` is already imported and works. Free upgrade.

### Media Hub gaps
- No upload progress: [mediaLib.js:165-184](src/lib/mediaLib.js), [MediaUploader.jsx:51-62](src/components/MediaUploader.jsx) don't pass `onUploadProgress`. 200 MB video shows the same spinner as a 2 MB JPG.
- No file-type/size guardrails before upload kicks off.
- No `loading="lazy"` on grid images ([MediaGrid.jsx:14, :21](src/components/MediaGrid.jsx)).
- No keyboard nav (arrow keys, Esc-to-close, no focus trap on detail drawer).
- No shift-click range select ([MediaHub.jsx:155-159](src/pages/MediaHub.jsx)).
- HEIC transcode is silent and main-thread blocking ([mediaLib.js:126-140](src/lib/mediaLib.js)).
- No alt-text field; `alt={asset.filename}` is useless for screen-reader users and publish quality.
- MediaPicker is single-select only ([MediaPicker.jsx:21,:82-96](src/components/MediaPicker.jsx)) — blocks carousel posts.

### Settings & credentials
- No "Test connection" button on any credential — first sign of a bad token is a failed publish.
- Binary "Configured/Not set" status — no last-validated, last-used, or expired states.
- Credential UI is **duplicated** in WorkspaceSettings and Integrations with drift. Pick one home (probably Integrations).
- 1,171-line linear scroll on WorkspaceSettings — split into `/settings/{general,brand,voice,locations,integrations,members,danger}`.
- **Real bug:** [WorkspaceSettings.jsx:937-943](src/pages/WorkspaceSettings.jsx) `emptyLocationDraft()` omits `gbp_location_id`, so new locations silently drop GBP ID on POST.
- No Danger Zone (rename, archive, delete, transfer-ownership). [api/workspace/me.js:13-30](api/workspace/me.js) deliberately excludes slug/clerk_org_id/status with no alternate route.
- No audit log surface despite `api/_lib/audit.js` existing (it's media-only).

### No unsaved-changes protection anywhere
No `beforeunload` / `useBlocker` / `usePrompt` anywhere in the codebase. WorkspaceSettings, MediaDetail, ContentBriefDetail, and Onboarding all silently lose edits on tab close or back-button.

### Bundle/perceived performance
Only `Welcome` is lazy-loaded ([App.jsx:16](src/App.jsx)) — every other route eager-imports into the initial bundle. Lazy-load all routes; should cut TTI by half on cold loads. No `lucide-react` tree-shaking concern check.

---

## P2 — Polish

- **Active nav state is too subtle** ([Layout.jsx:68-77](src/components/Layout.jsx)) — `text-foreground` vs `text-muted-foreground` is the only signal; no underline, no bg, no `aria-current`.
- **Icon-only buttons use `title` not `aria-label`** ([Layout.jsx:50, :54](src/components/Layout.jsx)) — screen readers don't get them.
- **No skip-link** for keyboard users.
- **`darkMode: 'class'` is set in Tailwind config but `index.css` has no `.dark` token block** — half-implemented dark mode. Commit or remove.
- **`a:hover { opacity-80 }` reads as "disabled"** in `index.css`.
- **No `prefers-reduced-motion` honored** — Dialog animations always run.
- **No command palette (cmd+K)** — modern SaaS staple.
- **No workspace switcher in chrome** despite `useOrganizationList` already being used in `App.jsx`.
- **No scroll restoration** on route change.
- **No keyboard shortcuts** anywhere: no cmd+S, no Escape on modals, no arrow nav between media items, no enter-submit on most forms.
- **No breadcrumbs** — every page has a single hard-coded back arrow.
- **No skeletons** — every loading state is a centered spinner.
- **Raw enum error strings leak to UI**: `'db-error'`, `'forbidden'`, `'city-required'` ([WorkspaceSettings.jsx:239, :803, :896, :1077](src/pages/WorkspaceSettings.jsx)).
- **No URL/color/JSON validation** in settings forms.
- **Non-admins are redirected home** instead of read-only-with-banner ([WorkspaceSettings.jsx:207-209](src/pages/WorkspaceSettings.jsx)) — Integrations.jsx does this correctly.
- **TZ bug:** [ContentCalendar.jsx:14, :61](src/pages/ContentCalendar.jsx) uses `toISOString().slice(0,10)` for local dates — off-by-one near midnight in PT.
- **Hardcoded geo copy:** [NewInterview.jsx:363](src/pages/NewInterview.jsx) "Popular in the Pacific Northwest" shouldn't ship to Animals/Equine tenants.
- **Mega-components:** WorkspaceSettings (1171), InterviewOutput (878), Onboarding (857), Dashboard (809), ReviewPost (747).
- **No Sentry / analytics**.
- **No tests, no `.github/workflows`** — no CI.
- **Email-preview iframe** at [PostPreview.jsx:580](src/components/PostPreview.jsx) uses `sandbox="allow-same-origin"` which negates most sandbox protection. Currently safe because values are escaped, but it's a footgun.

---

## Suggested sequencing

Each row is roughly one shippable PR.

| # | PR | Wins | Effort |
|---|---|---|---|
| 1 | **Lock down `api/db/*` + `api/generate|stream`. Add `@upstash/ratelimit`.** | Closes S1, S2. | 0.5–1 day |
| 2 | **WorkspaceContext error-banner on fetch failure.** | Closes S3. | 1 hr |
| 3 | **Sonner + `useSaveAction` + `<SaveButton>` + ErrorBoundary + rewrite `api.js`.** Replace all `alert()`/`confirm()`/`prompt()` with AlertDialog. | Closes U1, U2, half of U5, kills the "feels inert" perception. | 1 day |
| 4 | **Empty states on MediaHub, ContentCalendar, ContentHub, Strategy.** Branded loader for OrgGate/WelcomeGate blanks. | Closes U3 + onboarding-flicker. | 1 day |
| 5 | **Responsive header (Sheet) + per-route document titles + `useDocumentTitle` + OG tags + skip link + `aria-label`s + `aria-current`.** | Closes U4 + accessibility quick wins. | 1 day |
| 6 | **Topics unification PR.** Settings tab edits both JSONB fields; ContentHub topic filter; NewInterview admin "Add to suggestions". | Closes the topic complaint. | 1 day |
| 7 | **Mount Clerk `<OrganizationProfile />` and `<UserProfile />`.** | Closes member-management + account-settings gaps. | 0.5 day |
| 8 | **Onboarding finale + dashboard personalization.** Wizard "success" step → `/`; Dashboard greets user; getting-started items 3 & 4 actually track. Per-tenant welcome announcements. | First-run polish. | 1 day |
| 9 | **Media Hub batch:** upload progress, `loading="lazy"`, alt-text field, keyboard nav, shift-click range, HEIC "Converting…" status. | Closes most Media Hub gripes. | 1–2 days |
| 10 | **Settings split into sub-routes** + per-card save + Test-connection on credentials + credential health pills. Fix `gbp_location_id` drop bug. | Settings becomes navigable. | 2 days |
| 11 | **Adopt TanStack Query.** Replace `useEffect + fetch` everywhere. Stale-on-mutation goes away. | Architectural payoff. | 2 days |
| 12 | **Unsaved-changes guard + cmd+S + Esc + Regenerate undo + InterviewSession.handlePause confirm + stream the blog generation.** | Closes the rest of the content-flow P1s. | 1–2 days |
| 13 | **Sentry + minimal CI workflow (typecheck via `checkJs` + Vite build on PR).** | Observability + safety net. | 0.5 day |

Items 1–5 alone (~4 days) close the security holes and ~70% of the "feels unfinished" perception. Items 6–8 (~2.5 days) close every specific complaint you raised at the start of this session.

---

## What's actually good (don't regress)

- The onboarding wizard ([Onboarding.jsx](src/pages/Onboarding.jsx)) is genuinely strong: capacity gate, progress bar, website-scan, live slug check, multi-location, favicon-probe redirect.
- The `welcome-v1` 4-card intro is polish-worthy — it just needs to be per-workspace, not per-user.
- Dashboard's `EmptyState` and `GettingStarted` are the right shape — they just need to live-track and to be copied to other surfaces.
- HEIC transcode, AI tagging promote/dismiss, 30-day purge cooldown with typed-confirm, drag-thumbnail-to-other-tab, bulk concurrency throttle, role-gated actions in Media Hub.
- No `dangerouslySetInnerHTML` anywhere. Clean.
- `OrgGate` correctly waits for `session.lastActiveOrganizationId` (the fix from `213`) — don't unwind that.
- The per-card save pattern in `WorkspaceSettings` Locations and Credentials sections is the right pattern; apply it to the rest of the page rather than removing it.

---

*Sub-reports with full file:line tables and longer rationale live in `/tmp/narraterx-audit-*.md` (not committed). Pull whichever section you want to dive into in the morning.*
