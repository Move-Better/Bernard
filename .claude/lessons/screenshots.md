# Staff-update screenshots

Read this before merging a user-visible UI change (the screenshot is a ship-time step), or running `scripts/capture-screenshot.mjs`. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## Staff-update routine — capturing screenshots for the PDF

The Bernard staff summary (`.claude/scheduled-tasks/bernard-staff-summary-3wk/SKILL.md`, rebuilt 2026-08-27 to run every ~3 weeks — see that file's "Rebuild note" for why the old weekly version went silent) produces a combined PDF with plain-language bullets + embedded screenshots, plus a Gmail draft pointing to it. **Screenshot capture is a ship-time responsibility — not a separate task**, and the routine itself deliberately never triggers a capture (it only reads existing `captions.jsonl` entries) — the capture pipeline depends on a 1Password mount read that's documented in `housekeeping.md` as occasionally hanging indefinitely, which is exactly the kind of dependency a headless scheduled task should not carry.

**When to capture:** Any time you merge a UI change to `main`. Backend-only changes, refactors, CI/test updates, and docs changes need no screenshot.

**What to capture — ZOOMED CROPS, never full pages.** Grab a tight crop of just the ONE component the change is about (a card, a control, a few table rows), not the whole screen. A full-page screenshot downscaled to fit the PDF becomes an unreadable blur — this is the #1 failure mode (hit 2026-07-16: the first Bernard PDF captured whole-`main` pages and had to be fully redone as element-level crops at `scale: 2`). The quality bar is the Deep Thought reference PDF (`/Users/qbook/Claude Projects/Deep Thought/.staff-update-screenshots/`): a colored title + tight per-feature crops (its "My voice" card, its Cmd-K box, its two thumb buttons). `--selector` (plus `--hide` for stray distractions) at `--scale 2`+ produces exactly this — do NOT point `--selector` at `main` and capture the page wholesale. One representative element per bullet; for a long table hide all but the first ~5 rows, for a card grid capture 2–3 cards, for a form keep the input + the new control and hide the rest.

**How to capture — use `scripts/capture-screenshot.mjs` (local Playwright). Do NOT use the Chrome MCP for this.** This overrides the global `~/.claude/lessons/browser.md` rule that screenshots of a signed-in app come only from Q's real Chrome: for Bernard staff-update screenshots, this script wins (Q, 2026-11-12).

The whole Chrome-MCP capture pipeline (html2canvas → blob URL → `~/Downloads` → `cp`) is **dead in the agent environment** and cannot be fixed from the page side — see "Why the Chrome-MCP pipeline can't work here" below. The working path drives a **local headless Chromium via Playwright**, which writes files directly with `fs`, needs no downloads/clipboard/network bridge, and authenticates with the same Clerk sign-in-ticket trick as `tests/e2e/auth.setup.ts`. Verified end-to-end 2026-07-22 (authed `/week` + a Library media tile → PNG on disk → embedded in a PIL PDF).

```bash
cd "/Users/qbook/Claude Projects/Bernard" && T=$(mktemp) && cat .env.bernard.1pw > "$T" && export CLERK_SECRET_KEY="$(awk -F= '/^CLERK_SECRET_KEY=/{print substr($0,index($0,"=")+1)}' "$T" | tr -d '\r')" && rm -f "$T" && node scripts/capture-screenshot.mjs \
  --url https://movebetter.withbernard.ai/library \
  --selector 'button.rounded-lg.overflow-hidden:has-text("used ×")' \
  --scale 4 --delay 4000 \
  --out ".staff-update-screenshots/$(date +%F)_PR0000_slug.png"
```

Flags: `--url` `--out` (required); `--selector` (CSS or Playwright `:has-text()`; omit for a viewport shot); `--last` (pick the innermost `:has-text` match — ancestors match too); `--click 'sel,sel'` (click a tab/filter first); `--hide 'sel,sel'` (`display:none` distractions — this replaces the old manual DOM-isolation walk); `--wait-for`; `--delay`; `--scale` (default 2); `--width`/`--height`; `--full-page`; `--email` (defaults to the `e2e@movebetter.co` fixture user).

Notes that matter in practice:
- **Pick `--scale` so the raw crop is ≥ 950px wide**, the PDF's `MAX_IMAGE_WIDTH`. A 256px-CSS tile at `--scale 2` is only 512px and gets *upscaled* (soft) in the PDF; `--scale 4` gives 1024px. Widen `--width` to change how many grid columns render.
- **Only `CLERK_SECRET_KEY` is needed.** The fixture account resolves as `--email` → `E2E_TEST_USER_EMAIL` → the hardcoded `e2e@movebetter.co`, so a capture works whether or not the env var is exported. (The 1Password `E2E_TEST_USER_EMAIL` entry held a 15-char random string rather than an address until Q fixed it on 2026-07-22; the script now validates the address shape up front so a bad value fails loudly instead of surfacing as a confusing "No Clerk user found".)
- The script suppresses the first-visit help overlays (`pagehelp:*` **and** the Library's separate `mediahub:welcomed:v1`) and presses Escape. If a new overlay ever paints over a crop, add its key there — the symptom is a capture showing a numbered "How it works" list instead of your component.
- rAF animations (NumberTicker) run correctly here, because the page is genuinely visible to its own browser — this sidesteps the documented backgrounded-tab ticker freeze entirely.
- It signs in as a **fixture user, not Q**, so it is safe to run repeatedly; but it is a real authenticated session, so the read-only discipline still applies — don't point `--click` at Approve/Publish/Delete.
- **The `e2e@movebetter.co` fixture is a Clerk `org:admin`, so it CANNOT prove any authz branch gated on `isOrgAdmin` (or `permission_tier`) — its minted token carries `org_role: "org:admin"`, so `requireRole` resolves `auth.isOrgAdmin === true` and it sails through the org-admin allow before ever reaching a role/tier check.** Verified 2026-08-14 while confirming PR #2629 (producers can approve a story's words): the fixture returned a clean `200`, but through the pre-existing `isOrgAdmin` branch — NOT the new `role === 'admin'` clause the fix added, so it proved deploy+wiring, not the fix. The faithful subject for an internal-plan-`role:'admin'`-but-not-org-admin branch (the producer/clinician case) is an actual non-admin member like Philip — and minting a *real named person's* session to test as them is impersonation the auto-mode classifier blocks (correctly). So: to prove an `isOrgAdmin`-gated branch on prod you need a subject that is `isOrgAdmin:false`, which the shared fixture is not and a real human shouldn't be impersonated to supply — fall back to the local proof stack (OLD-vs-NEW persona harness + a mutation-tested unit guard on the extracted decision) plus a live `200` that at least confirms the deployed handler + auth stack execute end-to-end. Don't read the fixture's `200` as proof of the specific branch you changed; decode the token's `org_role` (`atob` the JWT payload) to see which allow path it actually took.

**Why the Chrome MCP can't produce this file:** see `~/.claude/lessons/browser.md`, "Which browser you are in: the agent pane is hidden" — the MCP tab's `visibilityState` is permanently `hidden`, so every file-out route (blob-download, `save_to_disk`, clipboard, a local receiver) fails silently. Two Bernard-specific gotchas found on top of that root cause: a receiver on `socketserver.TCPServer` is single-threaded and **wedges permanently** once a browser opens a keep-alive connection (even `curl` then times out, which looks like "server never started" — use `ThreadingHTTPServer` with `daemon_threads`); and `computer` `zoom`'s `region` doesn't map reliably to screenshot pixels (~60px off), so prefer a generous region.

**Don't re-litigate this.** The blocker is the tab's visibility, which the page cannot change. Playwright is better regardless (element crops at arbitrary scale, no CDN dependency, no CSP surface, scriptable from Bash). When the user only wants to *see* a screenshot, the `computer` tool is still fine — it renders in the transcript and needs no filesystem.

**Storage convention:**

- **Directory:** `.staff-update-screenshots/` (gitignored, not in repo)
- **Filename pattern:** `YYYY-MM-DD_PR###_short-slug.png` (e.g. `2026-07-17_PR2185_stories-table-sort.png`)
- **Index:** `captions.jsonl` in the same directory (one JSON line per screenshot):
  ```json
  {"file":"2026-07-17_PR2185_stories-table-sort.png","date":"2026-07-17","pr":2185,"caption":"the Stories list now shows a dense sortable table with search"}
  ```

**Caption:** One plain-language sentence describing what the user sees / what changed / why it matters. No jargon, no "PR #2185 fixed…" — just the user-visible fact. This caption is what matches bullets in the weekly summary PDF.

**First-time setup:**
- Create `.staff-update-screenshots/` folder manually (or let the routine create it).
- Add to `.gitignore`: `.staff-update-screenshots/`
- Document in a README in that folder (for future sessions) if you'd like.

**Gotchas & testing:**
- The Playwright script needs the repo's `node_modules` (`@playwright/test`, `@clerk/backend`). A session worktree has no `node_modules` of its own, but Node resolves upward and finds the project root's — so running it from a worktree works. Playwright's Chromium is already installed in `~/Library/Caches/ms-playwright`.
- A capture that comes back showing a numbered "How it works" list instead of your component means a first-visit help overlay auto-opened for the fixture user; add its localStorage key to the suppression block in the script.
- On some Pillow/PIL installs, `image.save(..., "PDF")` throws `KeyError: 'JPEG'` even though JPEG save works. The routine includes a workaround; only matters when building the PDF.
- Screenshots are not required for the routine to work — if a bullet has no matching screenshot, the PDF just renders the text. Capture what's relevant; don't force every change.
