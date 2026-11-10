# Bernard simplicity audit, 2026-11-09

Scope: what a person sees and has to choose between in the signed-in app, on the `movebetter` workspace. Read-only. No code changed. A sibling session ("Role-based screens") owns who-sees-what; this report owns what should exist at all.

## The short version

1. **The simple clinician screen already exists and is switched off by a bug.** Every clinician and producer at Move Better lands on the owner's Home ("You're the gate for 15 things today") with the owner's full sidebar. Fixing one failed lookup gives clinicians the capture-first Home that was built for them.
2. **Three screens do two thirds of the work.** Your week, Home and the post editor took 68% of all page views in 90 days. 34 of the 60 signed-in screens were not opened once.
3. **The owner Home is 4.8 screens long and says the same thing three times.**
4. **One person is shown six different "waiting on you" numbers**: 15, 149, 12, 8, 1 and 163.
5. **There are seven ways to start something and one is used.** All 6 interviews in 90 days were the live voice interview.
6. **Settings has 17 menu pages and got 7 visits in 90 days.** Worth leaving alone for now.

## How this was measured

| Source | What it gave | Limits |
|---|---|---|
| Route table in `src/App.jsx`, sidebar in `src/components/Layout.jsx` | The inventory: 60 signed-in screens (redirects and the 5 public pages excluded), 15 sidebar targets for an owner, 17 settings menu pages | Checkout was 0 commits behind `origin/main` |
| PostHog page views, 90 days to 2026-11-09, e2e user excluded | About 730 views by 9 real people, per screen and per person | Counts path changes only, so a tab switch inside a page is invisible. Volume is thin and one former producer made 347 of the 730 views |
| PostHog click events on Home | Which buttons clinicians actually pressed | Text of the clicked element only |
| Prod database (read-only) | Staff tiers and login links, interviews and content rows for 90 days | `movebetter` workspace only |
| Q's logged-in Chrome on prod, plus one capture as the test user | Screen length, headings, control counts, the live text of Home, Your week, Stories, Library, Moments, New, Settings, Bernard's workday, Overview, Insights | Desktop width only (1280). The post editor was not walked. No real clinician login was observed directly |

## Finding 1. The role fork is built but not running

What was observed:

- `GET /api/workspace/me` returns `current_user_tier: null` for Q, whose `staff` row says `owner` and is linked to his login.
- All four clinicians clicked "Review approved →" on Home in the last 90 days (08-27, 09-10, 10-05, and four times up to 10-07). That button exists only on the owner and producer queue. One also clicked the "Your queue" jump link that only the combined owner Home has.
- Clinicians clicked Analytics, Insights, Ads and Tools in the sidebar.
- The test user, whose `staff` row is tier `clinician`, renders the combined owner Home.

Cause, from reading the code (the failed request itself was not observed): `api/_routes/workspace/me.js` asks `staff` for a column, `producer_onboarded_at`, that does not exist in prod. The migration file `093_clinicians_producer_onboarded_at.sql` exists but the column is in neither prod nor `supabase/expected-schema.json`. The lookup fails, the tier comes back empty for everyone, and `HomeRouter` in `src/App.jsx` treats "no tier, and admin" as owner. On an `internal` plan `src/lib/useUserRole.js` makes every member admin.

What it means: the per-person Permissions screen (`/settings/access`) and the producer sidebar rules have no effect on what anyone sees. Not verified: whether the server still enforces those permissions, which would produce buttons that are visible and then refused.

Why this is a decision and not a quiet fix: once the lookup works, clinicians drop to the capture Home, and the two producers lose Stories, Book, Write and Pre-Visit from the sidebar. One producer ran 3 of the 6 interviews in the window. Handed to the role session.

## Finding 2. Usage is concentrated in four screens

| Screen | Views (90d) | People |
|---|---|---|
| Your week `/week` | 176 | 9 |
| Home `/` | 163 | 9 |
| Post editor `/publish/:id` | 160 | 5 |
| Library `/library` | 51 | 6 |
| Insights `/analytics` | 25 | 5 |
| Overview `/overview` | 24 | 3 |
| Stories `/stories` | 23 | 7 |
| Bernard's workday `/producer` | 14 | 6 |
| Ads `/ads` | 13 | 5 |
| Moments `/moments` | 11 | 5 |
| Words approval `/stories/:id/words` | 11 | 3 |
| New `/new` | 9 | 5 |
| SEO `/seo` | 8 | 4 |
| Live interview `/new/live-interview` | 8 | 5 |
| Everything else that was opened (12 screens) | 33 | |

Never opened in 90 days (34 screens): 15 of the settings pages; the typed interview, newsletter, voice memo and handout capture modes and the capture review page; Book, Write and Pre-Visit; What's new (`/updates`); Voice training; Bernard's settings (`/producer/settings`); the standalone video editor route; Admin; Account; the internal test page; and four onboarding pages that an established team would not revisit anyway.

The four clinicians together made 108 views and ran 3 interviews in 90 days. Five blogs created in the window are still waiting for a clinician's approval, the newest since 10-07.

## Finding 3. The owner Home repeats itself

Measured live: 3,259 px tall on a 680 px window (4.8 screens), 9 headings, 23 buttons and links. In order it shows: a ranked queue of 4 items; 4 "waiting on your clinicians" rows; an "All checkpoints" grid of 10 tiles that restates the queue's counts (10, 149, 1); 5 channel tiles; a paragraph from Bernard that restates the same three counts and the same channel gaps a third time; a product changelog (5 entries, 50 to 62 days old, written for engineers); a "Make a point" field; the weekly call card; two "coming soon" chips for features that do not exist; a second list titled "8 things need you"; two "Fixed, you reported" banners, one of them a test row from July; and a stats line.

## Finding 4. Six "waiting on you" numbers

On one day, signed in as the owner: Home says "gate for 15 things", "a further 149 in the backlog", "your clinicians are sitting on 12 more", then lower down "8 things need you". Your week says "Needs you 1". Bernard's workday says "Needs you 1". Moments says "163 to go". Each is correct about its own slice. Nothing tells the reader they are slices, and Moments' 163 does not appear on Home at all.

Underneath this sit 11 kinds of approval: post approvals, clip review, video packages, publish failures, escalated captions, media consent, answer reviews, words approvals, blog drafts, memory updates, and moment review.

## Finding 5. Seven ways to start, one used

`/new` offers Interview, Post, Write a newsletter, Voice memo, Photos & video, Import writing and Record from your phone, plus a "Seminar / Talk, coming soon" card that still says "available shortly after the June 25 capture". Home adds a third and fourth start point (the weekly call button and the "Make a point" field) beside the sidebar's Create button. Every interview in the window was the live voice interview.

## Finding 6. Sidebar and names

An owner's sidebar has 15 targets. Nine of them lead to screens that drew 14 views or fewer each in 90 days (Create, Bernard, Moments, Ads, Tools, Knowledge synthesis, Settings, My profile, Account). Six places report "how are we doing": Home's channel tiles, Overview, Insights, SEO, Usage and Bernard's workday.

The same thing carries several names. The sidebar says "Bernard", the page says "Bernard's workday", the address says `/producer`, and "producer" is also a person's role and the label on Home ("as the producer"). The sidebar group "Analytics" opens a page titled "Insights". Home's "clip review backlog" is the Moments tab "New from video". Settings has "Clinic knowledge" and the sidebar has "Knowledge synthesis".

## Finding 7. Settings

17 pages in the settings menu, 3 more settings screens outside it (Bernard's settings, Voice training, Account). 7 page views in 90 days. It is rarely visited, so it adds little to the daily feeling of clutter. Regrouping it is real work for little return right now.

## Small things that are simply wrong

- A deactivated team member is listed under "8 things need you" as "Never interviewed" with a Start button.
- The "Seminar / Talk" card on `/new` refers to June 25 as a future date.
- A "Fixed, you reported: Testing the feedback email" banner from July is still on Home.
- Channel tiles read "Gbp" where every other screen says "Google Business".
- Two "coming soon" chips on Home advertise features that are not built.

## Recommended order

| Option | Description | Est. Days | Est. Claude Cost |
|---|---|---|---|
| A. Turn the role fork on | Fix the tier lookup so clinicians get the capture Home and producers the queue. Needs Q's ruling on what producers keep. Owned by the role session | 0.5 to 1 | USD 3 to 8 (Sonnet) |
| B. One inbox on Home | Home becomes the ranked queue plus "waiting on others". Remove the checkpoint grid, the restating note, the changelog, the coming-soon chips and stale banners. Target 1.5 screens. Mockup first | 1 to 2 | USD 8 to 15 (Opus for the mockup) |
| C. One start button | "Talk to Bernard" as the single primary action; the other six modes behind "Other ways". Mockup first | 0.5 | USD 3 to 6 (Sonnet) |
| D. Sidebar to about six items | Home, Your week, Stories, Library, Results, Settings. Low-use screens move under "More" and keep their addresses. Mockup first. Wait for A, since A changes who sees the sidebar | 1 | USD 5 to 10 (Sonnet) |
| E. One name per thing | A rename table for sign-off, then a copy sweep | 0.5 to 1 | USD 3 to 6 (Sonnet) |
| F. Fix the small wrong things | The five items above, one PR each | 0.5 | USD 2 to 5 (Sonnet) |
| G. Regroup settings | 17 pages into about 5 | 2 to 3 | USD 10 to 20 (Sonnet) |

Recommendation: A, then B and F, then C. Hold D until A has landed. Skip G for now.

The case against doing any of this: usage is thin, and a tidier screen does not by itself get 6 blogs approved or 15 owner items cleared. A and B are worth doing because they sit directly on that approval path. D, E and G are tidiness, and should wait until the path is moving.

## Not covered

The post editor (third most used screen; it opens one of four different editors, or a read-only receipt, depending on the post type, and was counted, not walked). Phone width. The story detail page. The new-tenant onboarding flow. What a real clinician sees was inferred from clicks and the test user, not watched.
