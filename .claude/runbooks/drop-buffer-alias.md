# Runbook — drop the Buffer compatibility alias

**Scheduled for 2026-08-06.** A cloud routine fires on that date and follows this
file. It is also fine to do by hand any time after the 6th — just work through it.

## Why the shim exists

On 2026-07-31 the publish route was renamed `/api/publish/buffer` →
`/api/publish/social` (#2495). Bernard is a PWA: the service worker can keep
serving a cached JS bundle after a deploy, and the update banner is
**dismissable and sticky** — a tab that dismissed it never re-prompts for that
SHA. So a tab could sit on the old bundle, POST to the old path, and read the
old response field, for longer than "everyone reloads eventually" suggests.

Publish is the one path where a 404 costs a **real post** rather than a
re-render, which is why the shim was worth a week and why the preconditions
below are not optional.

## Preconditions — STOP and report instead of proceeding if any hold

1. **`api/_routes/publish/buffer.js` is already gone.** The work is done; say so
   and stop.
2. **That file is not a thin re-export.** It should be essentially one
   `export { default } from './social.js'` line plus comments. Real handler
   logic means something changed since this was written.
3. **Real code imports it.** Check with
   `grep -rn "publish/buffer" api/ src/ tests/` — ignore
   `_manifest.generated.js` (generated) and comments. An actual import means a
   caller would break.
4. **Client code still reads the legacy fields.** Check with
   `grep -rn "bufferId" src/ tests/` and `grep -rn "bufferUpdateId" src/ tests/`.
   If a client still reads either, deleting them breaks it.

For 3 and 4 the cost of being wrong is a lost post. Do not guess — report and
let a human decide.

## Steps

1. **Set the commit author.** Vercel gates its preview check on the commit
   *author*, not the pusher, so a different identity fails CI:
   ```bash
   git config user.name "Dr Q" && git config user.email "drq@movebetter.co"
   ```
2. **Branch off current main:**
   ```bash
   git fetch origin && git checkout -b chore/drop-buffer-alias origin/main
   ```
3. **Delete `api/_routes/publish/buffer.js`.** Nothing imports it — the manifest
   generator discovers routes from the filesystem, so deleting the file is what
   unregisters `/api/publish/buffer`.
4. **Edit `api/_routes/publish/social.js`:**
   - Delete the two response fields commented `legacy alias — drop with
     ./buffer.js`. Keep the `postId:` line above each.
   - In the `DELETE` branch, read the id from `body.platformPostId` only —
     remove the `|| body.bufferUpdateId` fallback and the comment block above it
     that explains why the fallback existed.
   - Fix the file header and the `handleBundlePublish` docblock. Both describe
     the shim and the retained `bufferId`, and both become false.
5. **Regenerate the route table:**
   ```bash
   node scripts/build-api-manifest.mjs
   ```
   Then confirm `api/_routes/_manifest.generated.js` no longer contains
   `"/api/publish/buffer"` and still contains `"/api/publish/social"`.
6. **Run every gate.** Do not proceed past a failure:
   `npm run lint` (0 warnings) · `npm run typecheck` · `npm run build` ·
   `npm run verify-bundles` · `npm run verify-api-manifest` · `npx vitest run`
7. **Review `git diff` in full** before staging, and confirm nothing unrelated
   is included.
8. **Open the PR.** Explain it is the scheduled removal of the one-week
   compatibility window opened by #2495, and note the preconditions were checked.
   Arm auto-merge only if every gate passed:
   ```bash
   gh pr merge <num> --auto --squash
   ```
   If any gate failed, open the PR as a **draft** describing the failure and do
   not arm auto-merge.

## After it merges

Publishing is the highest-consequence path in the product, and green gates do
not exercise it. Confirm the live route still works — `/api/publish/social`
should answer (405 to a bare GET, since it is POST/DELETE only) and
`/api/publish/buffer` should now be 404:

```bash
for p in /api/publish/social /api/publish/buffer; do printf "%s " "$p"; curl -s -o /dev/null -w "%{http_code}\n" "https://withbernard.ai$p"; done
```

A real Publish click from the app is the only complete proof; ask for one if
anything looks off.

## Delete this runbook

Once the alias is gone and verified, this file has no further use — remove it in
the same PR or a follow-up.
