# Plan — Vercel Function Consolidation (172 → ~15)

**Status:** AWAITING SIGN-OFF · **Date:** 2026-06-06 · **Owner:** Q
**Trigger:** Vercel Compute team email (Shohei) — bernard deploys ~160 functions/deploy vs. <10 expected; consuming deployment-artifact storage; risk of paused deploys + future storage charges.

---

## 1. Problem & goal

- **Today:** 172 handler files under `api/` (excluding `api/_lib/`). Vercel builds each `.js` as its **own function = its own bundle every deploy**. This drives build time, artifact storage, and cold-start surface area.
- **Root cause:** This is a **Vite SPA + file-based Vercel functions** project (no Next.js), so Vercel's per-route bundling optimization doesn't apply — every route is a separate function.
- **Goal:** Collapse the light routes into **one framework function**, keep the genuinely-heavy ones separate. Target: **172 → ~15 functions** (Phase 1 alone gets ~172 → ~70, a 60% cut — likely enough to satisfy Vercel).

### Two separable asks from the email
| | Fix | Status |
|---|---|---|
| **#2 Retention policy** | Dashboard: Preview 1d / Prod 7d (last ~10 prod + active-branch previews always kept) | **Q action — do today, independent of this plan** |
| **#1 Function count** | This plan | Below |

---

## 2. Why Express, not Hono (Vercel suggested Hono)

Every one of the 172 handlers is **`runtime: 'nodejs'` + `(req, res)` Express-style** (confirmed: 0 Edge, 112 read `req.body`, 0 use `req.json()`).

- **Express** signature = identical to what we have → handlers mount **almost unchanged**. The `(req,res)` shape, the `bernard/api-handler-shape` ESLint rule, and `res.status().json()` all carry over.
- **Hono** uses Web `Request`/`Response` (the `c` context model) → would require rewriting or shimming all 172 handlers. More work, no benefit here.

**Decision: Express.** Both run natively on Vercel Fluid Compute; Express is the lower-friction fit for this codebase.

---

## 3. Architecture

### 3.1 Group by resource profile (do NOT collapse to one function)
The heavy functions need configs the light ones don't (ffmpeg binary via `includeFiles`, `maxDuration: 300`, `memory: 3009`, streaming responses, raw bodies). Vercel bundles different-config routes separately by design, so:

- **One Express "app" function** (`api/index.js`) absorbs the ~100 light JSON-in/JSON-out routes.
- **~12–15 heavy/special functions stay as their own files** (untouched).

### 3.2 The relocation mechanic (key structural move)
Vercel treats **every** `api/**/*.js` as a function — so a consolidated handler can't just stay in place and be imported (Vercel would still build it as a function). Files/dirs prefixed `_` under `api/` are **ignored** by function detection (that's why `api/_lib/` works).

**→ Move each consolidated handler `api/<dir>/<file>.js` → `api/_routes/<dir>/<file>.js`.** Vercel then sees only: `api/index.js` + the keep-separate functions (+ `_lib`/`_routes` ignored).

- Mechanical: `git mv` mirroring the path, then rewrite relative import specifiers for the **+1 depth** (`../_lib/` → `../../_lib/`). Fully scriptable (migration script), and both smoke tests below catch any broken import.

### 3.3 Routing (`vercel.json`)
Add a catch-all rewrite sending unmatched `/api/*` into the Express app:
```json
{ "source": "/api/(.*)", "destination": "/api" }
```
- **Precedence assumption:** Vercel's `filesystem` phase matches real function files (the keep-separate ones) **before** the rewrite/`miss` phase fires — so heavy functions win and only the rest fall through to `api/index`. **This is the #1 thing to prove in the spike (Phase 1a)** before migrating 100 routes. Belt-and-suspenders fallback: explicit negative-lookahead exclusion of keep-separate paths (mirrors the existing SPA rewrite `/((?!api/).*)`).
- Existing SPA rewrite, 11 crons, headers, and the 7-function `includeFiles` block stay as-is.

### 3.4 The Express app (`api/index.js`)
- Bare Express app, **no `express.json()`** — rely on Vercel's pre-parsed `req.body` (exactly what all 112 handlers already read). Adding body middleware risks a double-read of an already-consumed stream. *(Validate `req.body` is populated under the Express-app export in the spike — fallback: add `express.json()` only if Vercel does NOT pre-parse.)*
- Routes registered from a **generated manifest** (§3.5). Each mounted via `app.all(path, wrap(handler))` so handlers keep doing their own method checks (`if req.method !== 'POST'…`) unchanged.
- **`wrap()` param-normalization shim** (handles both dynamic-param patterns found in the code):
  - `req.query = { ...req.query, ...req.params }` → covers handlers reading `req.query.id` (e.g. `brand-kit/[id].js`).
  - ensure `req.url = req.originalUrl` → covers handlers parsing `url.pathname.split('/').pop()` (e.g. `content-pieces/[id].js`).
- One shared `maxDuration` for the app: set **300** (under Active-CPU pricing a high ceiling costs nothing for fast requests; lets long JSON-AI routes join in Phase 2).

### 3.5 Generated route manifest (recommended over hand-authored)
- `scripts/build-api-manifest.mjs` (added to `prebuild`, alongside `write-version.mjs`/`build-blog.mjs`): walks `api/_routes/**`, emits `api/_generated/manifest.js` with **static `import`s** (so Vercel traces them into the bundle) + `[{ method:'all', path:'/api/...', handler }]`, translating `[id]`→`:id`.
- `_generated/` is gitignored; the generator runs in `prebuild` and as a pretest step for the smoke scripts.
- **Guard test:** assert every `api/_routes/**/*.js` appears in the manifest and isn't in `KEEP_SEPARATE` (prevents a new handler silently not being routed). Alternative considered — hand-authored `api/index.js` with ~100 explicit imports: more transparent but drifts as handlers are added; codegen + guard auto-corrects.

---

## 4. Keep-separate bucket (stay as own functions)

| Reason | Functions |
|---|---|
| **ffmpeg binary + memory** (`includeFiles`) | `media/upload`, `media/tag`, `media/[id]/thumbnail`, `media/[id]/edit` (memory 3009), `media/backfill-thumbnails`, `editorial/render-longform`, `editorial/render-longform-worker`, `editorial/render-clip`, `editorial/render-segments`, `editorial/repurpose-video`, `editorial/rerender-package` |
| **Streaming responses** | `stream`, `realtime-session`, `tts`, `voice-preview`, `voice-memo` |
| **Raw body** (signature verify) | `billing/webhook` (Stripe), `webhooks/mux` (Mux) |
| **Large upload / stream-to-disk** | `capture/upload`, `voice-clone/create`, `integrations/drive/import`, `publish/website`, `interviews/detect-video-offset`, `handout/create` |
| **Heavy JSON-AI** (Phase-2 fold candidates; keep separate at first) | `generate`, `editorial/find-clips`, `editorial/generate-package`, `book/regenerate`, `onboarding/synthesize`, `content-items/split-into-series`, `interviews/cleanup-transcript`, `seminar/transcribe-worker` |
| **Crons** (own invocation + several maxDuration 300) | all 11 `cron/*` |

Everything **not** listed → consolidate into `api/index.js`.

---

## 5. Phasing (each phase independently shippable + revertible)

| Phase | Work | Function count | Effort |
|---|---|---|---|
| **0** | Retention policy (Q, dashboard) + reply to Shohei that consolidation is in progress | 172 | ~0 |
| **1a — Spike** | 2-route proof on a **preview** deploy: confirm (a) filesystem-precedence keeps a real function file winning over the catch-all, (b) `req.body` is populated under the Express-app export. De-risks the two platform unknowns before bulk migration. | 172 | Opus, Quick |
| **1b — Light CRUD** | Build `api/index.js` + manifest generator + `wrap()`; migrate the ~100 light routes into `api/_routes/`; wire the rewrite. | **~70** | Opus+Sonnet, Large |
| **2 — Heavy JSON-AI** | Fold the 8 long-but-not-binary AI routes into the app (shared maxDuration already 300). | **~45** | Sonnet, Medium |
| **3 — Group the rest** | Evaluate grouping webhooks + crons (sub-apps); leave true binary/stream fns separate. | **~15** | Sonnet, Medium |

Stop after any phase if Vercel's concern is satisfied.

---

## 6. Verification & rollback

**The challenge:** authed smoke is prod-only (Clerk domain-locked). So:
- **Bundle smoke** (`verify-function-bundles.mjs`, extended): import `api/index.js` (transitively loads all `_routes` handlers) + each standalone function → catches load-time/import-depth breakage.
- **Route-resolution smoke (new, the Phase-1 acceptance gate):** a script that curls the **preview URL** for every consolidated path with **no auth**, asserting each returns **non-404** (route resolves to handler → handler 401s). A 404 = Express routing miss = bug. Proves the whole routing table without needing Clerk. Run against the preview before merge.
- **Post-merge authed spot-check:** after prod auto-deploy + live-SHA confirm, drive Q's logged-in Chrome through Slate / Library / Settings / a CRUD save per the CLAUDE.md procedure.
- **e2e smoke** (5 routes) runs post-merge as the regression net.

**Rollback:** change is additive + file moves. Heavy functions untouched, so blast radius = the consolidated routes. If routing breaks, **revert the PR** → 172 functions restored. Phase the merges so a bad group is caught in isolation.

---

## 7. Open platform questions (resolve in the 1a spike, not by assertion)
1. Does the `filesystem` phase match a real function file before the `/api/(.*)` rewrite fires? (If no → use negative-lookahead exclusion.)
2. Is `req.body` pre-populated when the default export is an Express app? (If no → add `express.json()` with raw-body carve-outs.)
3. Does `req.url`/`originalUrl` inside an `app.all` handler preserve the full path for the `split('/').pop()` readers? (Covered by `wrap()`, confirm in spike.)

## 8. Risks
- **Touches every prod API endpoint.** This codebase has multiple documented multi-hour outages from handler-shape bugs — hence spike-first + per-phase preview gating + route-resolution smoke.
- **Import-depth rewrite across ~100 files** — scripted + caught by bundle smoke.
- **Shared maxDuration/memory** — light routes inherit 300s ceiling (no cost impact under Active CPU); memory stays default (heavy memory cases are in keep-separate).
- **`memory` in vercel.json invalid under Fluid Compute** — the one `memory:3009` (`media/[id]/edit`) is keep-separate; confirm its config still applies (inline export vs dashboard).

## 9. Out of scope
- Migrating to Next.js (the email's other suggestion) — far larger, no benefit over Express here.
- Touching `middleware.js` (separate Routing Middleware, unaffected).
- Changing any handler's business logic — this is a packaging refactor only.

---

## SPIKE RESULTS (Phase 1a — 2026-06-07, validated on bernard preview)

**Mechanism decided: `vercel.json` rewrite, NOT the `[...path]` catch-all file.**
- The Vercel zero-config (Vite) build compiles `api/[...path].js` to `^/api/([^/]+)$` — **single-segment only** (`[^/]+`), so multi-segment paths 404. The catch-all *file* convention is not a true catch-all here. The rewrite `/api/(.*)` (where `.*` spans slashes) works.
- Rewrite used: `{ "source": "/api/(?!media/[^/]+/)(.*)", "destination": "/api/index" }`.

**Confirmed on preview (`vercel curl`):**
- ✓ Static real functions WIN over the rewrite (filesystem phase runs before rewrites). `GET /api/health` → real 200. So all static keep-separate fns (crons, render-*, webhooks, stream, generate, …) are safe with NO exclusion.
- ⚠️ DYNAMIC real functions do NOT win — the rewrite swallows them. Only dynamic keeps are `api/media/[id]/{edit,thumbnail}` → handled by the `(?!media/[^/]+/)` exclusion. (`/api/media/:id` bare is MIGRATED, so it correctly falls to the app.)
- ✗→✓ `req.body` is NOT pre-parsed under an Express-app export → must use `express.json()` + `express.urlencoded()`. (Plan §3.4 assumption was wrong; corrected.)
- ✓ `req.url` / `req.originalUrl` preserve the full original path through the rewrite (no `...path` pollution), so `url.pathname.split('/').pop()` handlers work.
- ✓ Multi-segment routing, Express `:params`, and querystring all work.

**Operational gotchas found:**
- **Preview deployments have Vercel Deployment Protection** (SSO wall) → smoke must use `vercel curl <path> --deployment <url> -- <curl flags>` (auto-bypasses) or a `VERCEL_AUTOMATION_BYPASS_SECRET`.
- **The Bernard project ROOT `.vercel/` is mis-linked to `movebetterwebsite`** (`prj_Qtsnj…`), not `bernard` (`prj_K91v3tRFYgfUPhmrvgBQi5hZKAaU`). The worktree helper copies it, so worktrees inherit the wrong link. Fixed in this worktree by writing a correct `.vercel/project.json`. **ACTION FOR Q: re-link the root** (`cd root && vercel link --yes --project bernard`) so `npm run deploy:prod` and future worktrees target bernard. Latent because bernard prod ships via GitHub integration, not manual `deploy:prod`.
