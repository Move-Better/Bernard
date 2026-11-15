# Weekly marketing read: how to use it

A key-checked, read-only route that gives one finished week's marketing numbers for the Move Better
workspace. It exists so Deep Thought's weekly Scorecard can pre-fill four marketing metrics instead of
a person typing them. This note is the contract the reader is written against.

## The request

```
GET https://movebetter.withbernard.ai/api/insights/weekly-marketing?week_ending=2026-11-08
Authorization: Bearer <WEEKLY_MARKETING_KEY>
```

- **Host:** the Move Better workspace host, `movebetter.withbernard.ai`. The apex `withbernard.ai` answers
  404, and so does any other workspace.
- **Key:** env var `WEEKLY_MARKETING_KEY` (**Sensitive**). It lives in Bernard's `bernard` 1Password
  Environment and in Vercel production; the reader keeps its own copy in its own secret store. Never log it.
- **`week_ending`** (required): a Sunday as `YYYY-MM-DD`, strictly before today in Pacific time. The week
  is that Sunday and the six days before it, Monday to Sunday. Anything else is refused with 400.
- GET only. The route writes nothing, anywhere. Rate limited at 60 requests a minute per workspace.

| Status | Body `error` | Meaning |
|---|---|---|
| 200 | none | the week, as below |
| 400 | `invalid_week_ending` | not a real `YYYY-MM-DD` Sunday |
| 400 | `week_not_finished` | the Sunday is today or later (Pacific) |
| 401 | `unauthorized` | key missing, wrong or not set on the server |
| 404 | `no_workspace`, `not_found` | wrong host, or a workspace outside the allowlist |
| 405 | `method_not_allowed` | anything but GET |
| 429 | `rate_limited` | slow down; `Retry-After` is set |

## The response

A real answer, taken from production data on 2026-11-15:

```json
{
  "workspace": "movebetter",
  "week_ending": "2026-11-08",
  "week_start": "2026-11-02",
  "timezone": "America/Los_Angeles",
  "computed_at": "2026-11-15T18:46:42.877Z",
  "numbers": {
    "website_sessions":          { "value": 541,  "reason": null },
    "book_now_clicks":           { "value": 34,   "reason": null },
    "search_impressions":        { "value": 1548, "reason": null },
    "non_branded_search_clicks": { "value": 5,    "reason": null }
  },
  "data_status": { "website": "complete", "search": "complete" },
  "components": {
    "posts_published_by_platform":   { "value": {}, "reason": null },
    "interviews_by_kind_and_status": { "value": [], "reason": null }
  }
}
```

### What each number means

| Field | Plain words | Scorecard metric it fills |
|---|---|---|
| `website_sessions` | Google Analytics sessions on the whole website, every page, for the 7 calendar days. | Total website sessions |
| `book_now_clicks` | Google Analytics `click` events on links to the booking site (`booking_url` host, Jane). Only links off the website domain are counted. | Book Now button clicks |
| `search_impressions` | Google Search Console impressions for the site, all queries, summed day by day over the 7 days. | Organic search impressions |
| `non_branded_search_clicks` | Search Console clicks from queries that do NOT match `move ?better`, summed day by day. | Non-branded search clicks |

For the week ending 2026-10-04 through 2026-11-08, all four equalled the typed Scorecard values exactly,
in every one of the six weeks.

### Components (Bernard's own records, not Scorecard numbers)

- `posts_published_by_platform`: content items Bernard published that week (`status = published`, by
  `published_at` as a Pacific calendar date), counted per platform, `blog` and `gbp` included.
- `interviews_by_kind_and_status`: interviews Bernard started that week (by `created_at`, Pacific date),
  counted per `kind` and `status`.

**Do not write either component straight into the Scorecard.** They are raw counts, and neither is the
Scorecard's metric.

Q's definitions (2026-11-15):

- **Posts published** is social media posted through Bernard. That excludes `blog`.
- **Blogs published** counts a blog when it is published through Bernard. It is the Scorecard metric that
  used to be called "Bernard Interviews" (renamed 2026-11-15), so its first 16 weekly entries are interview
  counts, not blog counts. The `blog` key in `posts_published_by_platform` is that count.

Measured for the six weeks ending 2026-10-04 to 2026-11-08, Posts published cannot be filled from Bernard
and Blogs published has no comparable typed history, so both stay typed by hand and the route does not
return them as numbers:

- Bernard published no social post in any of the six weeks (nothing since late September); the Scorecard
  has 1 in the week ending 10-04.
- Bernard published one blog, on 2026-10-07 (week ending 10-11). The typed values for this metric are the
  old interview counts (0 at 10-04, 5 at 10-18), so they cannot be compared with it. A Thursday fill would
  move the blog to 10-04.

Revisit when Bernard is publishing again: the components give the reader the rows to apply the
definitions to, but re-measure against the typed values before relying on them.

### Not here, on purpose

**Total Views** and **Total Engagement** are not returned. Bernard only holds reach and engagement for
posts Bernard itself published, so the account-level totals typed into the Scorecard cannot be derived
from it.

## What `null` means

Every number and component is `{ "value": ..., "reason": ... }`. When the source is not connected or the
read failed, `value` is `null` and `reason` says why. **`null` never means zero**, and the reader must not
file a pending entry for it. A real zero is `"value": 0`.

| `reason` | Meaning |
|---|---|
| `ga4_not_connected`, `gsc_not_connected` | no property / site set, or no active credential |
| `ga4_fetch_failed`, `gsc_fetch_failed` | Google answered with an error or did not answer |
| `ga4_credential_fetch_failed`, `ga4_credential_decrypt_failed` (and `gsc_…`) | the stored credential could not be read |
| `no_booking_url` | the workspace has no booking link to match clicks against (Book Now only) |
| `db_read_failed` | Bernard's own database read failed (components only) |

Fetch failures are transient: ask again later.

## Has Google finished reporting the week?

`data_status` is `complete` or `may_be_incomplete` for `website` and `search`.

- `search`: `complete` only when Search Console returned a row for the Sunday itself. Data usually lags
  two or three days.
- `website`: Google Analytics' API does not say, so this is a clock rule: a week that ended two days ago or
  less is `may_be_incomplete`, otherwise `complete`. Analytics can still revise numbers slightly afterwards.

File a pending entry only when the status is `complete`; otherwise ask again later in the week.

## Week boundaries

Posts and interviews are cut at midnight Pacific (Monday 00:00 to the next Monday 00:00, daylight saving
included). Google's reports are by calendar date, as the property and site report them. The route never
looks at "now" to choose the week, and the Insights page's UTC weeks are unchanged.

## For maintainers

- Route: `api/_routes/insights/weekly-marketing.js`; tests: `tests/weeklyMarketing.test.js`.
- Allowlist: `WEEKLY_MARKETING_WORKSPACES` (Move Better only). A second tenant needs the key and allowlist
  moved onto `workspace_credentials` first.
- Sessions come from one total-range query, not the sum of GA4's by-date report that the Insights trend
  strip uses: the by-date sum was off by one in four of the six weeks checked.

## Second reader: the website's interview count (2026-11-15)

`GET https://movebetter.withbernard.ai/api/insights/interview-count` with the same `WEEKLY_MARKETING_KEY`
returns `{ "workspace": "movebetter", "completed_interviews": 24, "computed_at": "…" }`: every completed
interview in the workspace, all time. The Move Better website's build reads it for the homepage's "Doctor
interviews" stat and hides the stat if the call fails. Same statuses as above (401, 404, 405, 429), plus
502 `db_read_failed`. The website keeps its own copy of the key as `BERNARD_STATS_KEY` (**Sensitive**) in
its Vercel project; rotate both readers' copies together.
