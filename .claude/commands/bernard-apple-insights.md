---
description: Import Apple Business Connect monthly Insights for Move Better's two locations from the recap emails in drq@movebetter.co into Bernard's apple_insights table.
---

# /bernard-apple-insights — import the monthly Apple recap

Apple emails one **Insights recap per location** early each month, covering the
PRIOR month. This reads those emails out of `drq@movebetter.co` and upserts one
`apple_insights` row per (workspace, location, month), which is what the
Insights → Apple panel and the Settings → Integrations card render.

Run it around the **7th**. Default is last month; pass a month to target one:
`/bernard-apple-insights 2026-09`.

**This also runs automatically** as the scheduled task
`bernard-apple-insights-monthly` (9am on the 7th), which executes these same
steps against the same endpoint. Use this command to run it early, re-run a
month, or debug a failed run — not as the only path.

---

## Read this before running

- **The recap email is the source of truth. The Apple Business Connect dashboard
  is NOT.** Apple suppresses any bucket below a reporting threshold, and the
  suppression applies to whatever the chart's interval bins by. On 2026-09-03 the
  dashboard reported **22** place-card views for Portland in July where the recap
  PDF — already in Bernard — says **172**. June agreed (142 vs 143), so this is
  not a systematic offset you can correct for. Never scrape the dashboard to fill
  a month. Full findings: memory `project-apple-business-insights`.
- **Never invent a number.** If a metric will not parse, leave it null and say so.
  A plausible-looking wrong figure here silently corrupts a trend nobody re-checks.
- **The recaps only started arriving at `drq@` after 2026-09-03.** Earlier months
  went to `admin@movebetter.co` and were deleted. Months before September 2026
  are not recoverable by this route.

## Locations

| Location | `workspace_locations.id` | Apple address |
|---|---|---|
| Portland | `c56db6c4-d7d1-44fa-8a0b-4dd8f325a419` | 237 NE Broadway, Portland, OR 97232 |
| Vancouver | `0c68e67b-f8b0-4039-82a7-1e1d1300d322` | 10303 NE Fourth Plain Blvd, Vancouver, WA |

Apple also lists **7902 NE St Johns Rd, Vancouver** ("In Review"). Q confirmed
2026-09-03 it is a **move/duplicate** — it has no Bernard row and must not get
one. If a recap arrives for that address, stop and ask; do not guess which
Bernard location it belongs to.

---

## Step 1 — find the recaps

```
search_threads  query: subject:Insights from:apple.com newer_than:45d
```

Apple's subject looks like *"Your August Insights for Move Better, 237 NE
Broadway."* Expect **two** messages, one per location. If you find zero, say so
plainly and stop — do not fall back to the dashboard. If you find one, import it
and report the missing location rather than silently doing half the job.

## Step 2 — read each message as text

```
get_message  messageId: <id>  messageFormat: PLAIN_TEXT
```

**Check the body actually contains the numbers** — it must carry both
`Insights Summary` and `PLACE CARD VIEWS`. The parser is label-anchored, so
layout does not matter, but those labels must be present.

**If they are not, the numbers live only in the PDF attachment — STOP.** The
Gmail connector returns attachment ids, never bytes, and there is no
download-attachment tool (`get_message` `RAW` would push the whole base64 PDF
through context, which is not a routine). In that case tell Q to upload the PDF
through **Settings → Integrations → Apple Business Insights**, which already
works and uses the same parser. Then record in memory that the email-body route
is unavailable, so the next run does not retry it.

## Step 3 — preview (writes nothing)

Post to **`POST /api/cron/apple-import`** with `Bearer CRON_SECRET`. That route
exists so this works headlessly — no browser, no Clerk session — and it shares
every line of parsing, the location check, the row shape and the upsert with the
Settings upload card via `api/_lib/appleImport.js`. Do NOT post from Q's Chrome
to the Clerk endpoint; that was the original shape and it would drift from what
the scheduled run actually does.

`preview: true` **parses without saving**. It is the safe half of this routine
and must always run first.

Load the secret in the same command that uses it (the mount is a FIFO; never
`Read` it — it holds every secret — and never echo the value):

```bash
cd "/Users/qbook/Claude Projects/Bernard" && T=$(mktemp) && cat .env.bernard.1pw > "$T" && chmod 600 "$T" && CRON_SECRET="$(awk '/^CRON_SECRET=/{sub(/^CRON_SECRET=/,""); print}' "$T" | tr -d '\r')" && rm -f "$T" && [ -n "$CRON_SECRET" ] && echo "secret loaded" || echo "SECRET MISSING"
```

If the mount reads empty or hangs, stop and ask Q to fully quit and reopen the
1Password app — do not retry in a loop.

(The awk deliberately uses `sub()` rather than awk's whole-record variable. A
dollar sign immediately followed by a digit is a POSITIONAL ARGUMENT slot in a
command body, substituted at load time — and this command takes a month
argument, so it would be silently replaced and the secret read would break with
no error and no warning. Never write that character pair anywhere in this file,
including in a comment explaining it: the explanation corrupts itself.)

Then per location, with the JSON written to a temp file (the body carries quotes
and newlines, so do not inline it in the shell):

```json
{ "locationId": "<uuid>", "emailText": "<PLAIN_TEXT body>",
  "sentAt": "<message date, ISO>", "subject": "<subject>", "preview": true }
```

## Step 4 — sanity-check BEFORE saving

Compare each previewed figure against the previous month:

```sql
select period_month, location_id, place_card_views, taps_from_search,
       directions, photos, website, call
from apple_insights order by period_month desc limit 8;
```

Portland has run roughly **101–184** place-card views a month across the last
year. A figure an order of magnitude outside its own recent band is a parse
failure or a threshold artifact, not a real collapse — do not save it, report it.

## Step 5 — save

Re-post the identical body with `preview` removed. The upsert is keyed on
(workspace, location, month), so re-running is safe and idempotent — it corrects
a row rather than duplicating it.

Report the month, both locations, the six metrics, and any `warnings` the parser
returned. A non-empty warnings array means a metric was missing — surface it.

---

## Status — the email path is UNVERIFIED as of 2026-09-03

`prepareRecapEmailText` + the endpoint's text branch are unit-tested and
mutation-tested, and `parseAppleRecapText` is the same function that produced
Bernard's correct June (143) and July (172) figures from real recap PDFs.

But **no real Apple recap EMAIL has ever been parsed** — the ones that would
have proven it were deleted from `admin@`, and `drq@` was only added to the
Apple Business account on 2026-09-03. So the open question is narrow and
specific: *does Apple's email body carry the metric labels, or only a PDF?*

Step 2 answers that on the first real run. Whichever way it goes, write the
answer into memory `project-apple-business-insights` so the next run starts from
a fact instead of this caveat.

**Also outstanding:** August 2026 was never imported and cannot be recovered by
this route. Bernard's last Apple row is July 2026.
