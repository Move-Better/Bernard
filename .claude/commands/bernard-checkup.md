---
description: Structured health check of the Bernard app — static checks, tests, code review of recent changes, optional UI smoke, and prod health. Subcommands: quick / ui / full.
---

Run a structured app checkup and produce a **Green / Yellow / Red** report. Auto-fix trivial issues; report the rest.

**Uniquely named on purpose.** Bernard, Deep Thought and Vigil all define health-check instruments, and same-named commands across sibling projects can load the *wrong* project's body. This exact file was previously byte-identical to Deep Thought's copy — which meant Deep Thought's `/checkup` was auditing Bernard's multi-tenancy and Vercel aliases against a single-org Railway app. The `bernard-` prefix makes that class of bug impossible. See global CLAUDE.md, "Same-named commands/skills collide across sibling projects."

## Mode selection (from arguments)

| Argument | Layers run | Approx time | Needs dev server |
|---|---|---|---|
| `/bernard-checkup` (default) | 1, 2, 3, 5 | ~10 min | No |
| `/bernard-checkup quick` | 1, 2 | ~3 min | No |
| `/bernard-checkup ui` | 4 only | ~15 min | Yes |
| `/bernard-checkup full` | 1, 2, 3, 4, 5 (+ optional 6) | ~25 min | Yes |

If the user passes any other text, treat it as default mode and continue.

---

## Output contract — produce this at the end of every run

```
# Checkup Report — <YYYY-MM-DD HH:MM>
Mode: <quick | default | ui | full>
Branch: <git branch> @ <short sha>

## Summary
| Layer | Verdict | Notes |
|---|---|---|
| 1. Static checks  | 🟢/🟡/🔴 | one-line |
| 2. Tests          | 🟢/🟡/🔴 | one-line |
| 3. Code review    | 🟢/🟡/🔴 | one-line |
| 4. UI smoke       | 🟢/🟡/🔴 | one-line (or "skipped") |
| 5. Prod health    | 🟢/🟡/🔴 | one-line (or "skipped") |

## Auto-fixed
- <file:line> — <one-line description of fix>
(or: "None")

## Fixes required (numbered, priority order)
1. <file:line> — <problem> — <suggested fix>
2. …
(or: "None")

## Recommended next steps
- <e.g. "Run /bernard-checkup ui to validate the brand-kit upload UI" or "Open PR, CI is green">
```

Color rules: 🟢 = no issues. 🟡 = non-blocking issues found (warnings, slow paths, minor UI nits). 🔴 = blocking (build broken, test failure, 500s in prod, security issue, tenant-isolation gap).

---

## Layer 1 — Static checks

Run from the repo root:

```bash
npm run lint
npm run build
```

- **Lint**: must pass under the `--max-warnings` ceiling defined in `package.json` (see CLAUDE.md "Lint ratchet" — the ceiling drifts DOWN, never up). If lint fails because of *new* trivial warnings (unused imports, unused vars, missing deps), auto-fix them and re-run. Do not bump the ceiling.
- **Build**: must complete without errors. Bundle-size warnings >500kB → 🟡 with the file noted.

Auto-fix scope (this layer): unused imports, unused locals, simple reorderings ESLint suggests, formatting. Do NOT auto-fix logic changes, API contract changes, or anything in `api/_lib/`.

After auto-fixes, commit them as a single commit (only at end of run, only if other layers are 🟢):

```bash
git add -A && git commit -m "chore(checkup): auto-fixes from /bernard-checkup"
```

If layers 2/3 are red, hold the commit and ask the user.

---

## Layer 2 — Automated tests

```bash
npm test
npm run e2e
```

- **Vitest** unit suite must be green.
- **Playwright** suite (`tests/e2e/`): currently `interview-flow.spec.ts` and `workspace-settings.spec.ts`. The Playwright config spins up its own dev server.
- Flaky test → re-run once. If still failing → 🔴 with the test name + screenshot path. Before writing a failure off as a known flake, spend one cheap check testing that claim — a documented "known flake" is a hypothesis, not a verdict (global CLAUDE.md, Debugging methodology).

If `npm run e2e` requires fixtures, run `npm run e2e:seed` first.

---

## Layer 3 — Recent-change code review

Find what's new since the last release/main merge:

```bash
git log --oneline origin/main..HEAD 2>/dev/null || git log --oneline -10
git diff --stat origin/main..HEAD 2>/dev/null || git diff --stat HEAD~10
```

For each non-trivial commit, run `git show <sha>` and read the diff. Focus on:

1. **Tenant isolation** (CLAUDE.md "Multi-tenant SaaS"): every `/api/*` route that touches a tenant-scoped table MUST call `workspaceContext(req)` (or `workspaceById(id)` for background paths) and filter by `workspace_id`. A missing filter = cross-tenant data leak. Treat this as 🔴.
2. **API runtime conventions** (CLAUDE.md "API handler runtime conventions"): Node-runtime handlers must use `(req, res)` shape and `res.status().json()`. Web-style `return new Response(...)` on Node runtime causes silent 300s hangs → 🔴.
3. **Streaming large files** (CLAUDE.md "Large-file handling"): any new handler that fetches blob URLs must stream via `pipeline(Readable.fromWeb(...), createWriteStream(...))`. `await res.arrayBuffer()` on media → 🟡 unless files are certainly small.
4. **Supabase migrations** (CLAUDE.md "Supabase migrations"): new `CREATE TABLE` / view / function must include `GRANT ... TO service_role` in the same file. If not → 🔴.
5. **Secrets**: scan diff for hardcoded API keys, tokens, URLs with embedded credentials → 🔴.
6. **Error handling at boundaries**: external API calls without try/catch + meaningful error response → 🟡.
7. **Dead code**: removed callers but kept the helper, removed feature flag but kept the branch → 🟡.

Output: bullet list of findings with file:line.

---

## Layer 4 — Manual UI smoke (only in `ui` or `full` mode)

Requires dev server. Start it in the background if not already running:

```bash
npm run dev
```

For each of the three workspaces in the `workspaces` table (movebetter-people, movebetter-equine, movebetter-animals), walk the golden path. Use Chrome MCP tools to script and screenshot; otherwise produce a checklist for the user to run manually. **If you need to produce image files rather than just look at the screen, use `scripts/capture-screenshot.mjs` (local Playwright)** — the agent browser tab is never visible and its file-out routes fail silently (global CLAUDE.md).

**Per-workspace checklist:**

1. Sign in via Clerk on `<slug>.localhost:5173` (or whatever the dev origin is)
2. **Workspace settings** → voice/tone/topics load without errors
3. **Brand Kit**
   - Upload a small PDF brand book → confirm extracted guidelines appear
   - Drop a folder of mixed files → confirm folder traversal works
   - Upload an `.svg` → confirm it's accepted as image (not rejected for MIME)
4. **Media Hub**
   - Upload an image and a small (~10MB) video → confirm thumbnail renders, no perpetual "uploading" spinner
5. **Interview** → start new, answer 2 questions → confirm transcript saves
6. **Content generation** → generate a piece → open Post Preview → email template renders with merge tags filled
7. Watch the **browser console** the entire walkthrough — any red error = 🔴, any yellow warning = 🟡 unless it's known third-party noise (Clerk dev keys, etc.)

Capture screenshots of any failures.

---

## Layer 5 — Production health

```bash
vercel logs --status-code 500 --expand
vercel logs --status-code 502 --expand
vercel logs --status-code 504 --expand
```

- New 5xx patterns in the last 24h vs. baseline → 🟡 or 🔴 depending on volume and which endpoint.
- Use the `dbErr` log pattern (`[db/<file>]` prefix) to root-cause Supabase REST failures.

Confirm prod aliases:

```bash
vercel ls --prod | head -3
```

The latest prod deployment should be aliased to `withbernard.ai` and `*.withbernard.ai`. If not → 🔴. Trust an HTTP probe over `vercel inspect`'s frozen deploy-time metadata.

Hit prod from a browser:
- `https://withbernard.ai/` — loads, no console errors
- `https://movebetter-people.withbernard.ai/` — loads, no console errors

Confirm the deployed SHA matches `git rev-parse origin/main` (fetch first); a mismatch means a deploy was skipped or is still in flight → 🟡.

---

## Layer 6 — Deep code review (optional, only suggest, don't run)

At the end of the report, if Layer 3 found anything non-trivial, recommend:

- `/code-review ultra` — multi-agent cloud review of current branch
- `/security-review` — targeted security pass on the changed files

Do NOT invoke these yourself; they're billable and user-triggered.

---

## When to stop and surface

Stop the checkup and surface to the user immediately if any of these hit:

- Build is broken (`npm run build` fails) — no point continuing other layers
- Tenant isolation gap found — security issue, user needs to know now
- Hardcoded secret found in diff — user needs to rotate before this gets merged/deployed
- Prod is throwing >10 5xx/min on a route — incident, not a checkup

In every other case, run all the layers in mode and produce the single report at the end.

---

## Notes

- **Structure is deliberately aligned with Deep Thought's `/dt-checkup`** (Vigil SOP sync, 2026-07-23): same mode table, output contract, layer structure and stop rules. Only the stack specifics differ — Bernard's multi-tenant/Vercel checks here, DT's single-org/Railway checks there. If you change the *recipe*, mirror it; if you change only Bernard's specifics, don't.
- Sister command: `/bernard-audit` (multi-agent deep review that also fixes what it can).
