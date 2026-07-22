# Social Adoption Strategy — why staff don't post through Bernard (2026-07-21)

Planning session with Q. His framing: the 9 complaints below are symptoms, not tickets. Goal: make Bernard the tool staff actually use for IG/FB. Grounded in prod data (movebetter workspace) + 4 code sweeps of origin/main @ 2026-07-21.

## The 9 reported symptoms → root causes

| # | Complaint | Verified finding | Disease |
|---|---|---|---|
| 1 | Too many photos, no Reels | Planner has NO format dimension — atoms are platform+angle only (`api/_lib/atomPlan.js:6-138`); `instagram_post`+`instagram_reel` collapse to one key (`atomPlan.js:155`); drafts born with `media_urls: []`. Zero `instagram_reel` content_items rows have EVER existed. | D2 |
| 2 | IG posts don't render as previewed | 8 concrete divergence mechanisms found (see below). Top: native-aspect media ships while preview shows a fake CSS crop; videos sent as IG `type:'POST'` not `REEL` (`bundlePublisher.js:313-315`); SlideEditor aspect silently re-baked to 4:5 at publish (`publishPiece.js:57-65`); zero post-publish verification. | D1 |
| 3 | No easy way to add content in Your Week | No add affordance exists; backlog drawer is read-only (can't schedule into a day) | D3 |
| 4 | Clicking a post should open it | PlanCards are inert `<div>`s; Approve hidden behind a "Review" expander showing a 4-line excerpt and NO media — staff literally cannot see what they're approving from /week | D3 |
| 5 | True calendar (day/week/month) | Week + day views only; no month; no drag; no add | D3 |
| 6 | Reject button + feedback loop | Nothing captures rejection reasons; pre-approve edits aren't mined; `cadence_policy.trust_stage` exists in data but is static | D4 |
| 7 | + on each day | Same as #3 | D3 |
| 8 | Why quiet weekends? | `cadence_policy.quiet_days = ['sat','sun']`, set by Bernard itself (`provenance:'bernard'`). Editable TODAY at Settings → Channels → Cadence, but only after flipping Auto→Manual — effectively undiscoverable. Posting times are a hardcoded `BEST_HOUR` table (`strategist.js:55`). | D3 |
| 9 | Exceptional at talking-head → karaoke → post | The karaoke engine EXISTS (6 per-word ASS presets, server ffmpeg burn — `karaokeCaptions.js`, `brandRenderVideo.js`). `render-segments.js` already renders captioned reels + auto-captions headlessly — but outputs a Library b-roll asset, not an approvable draft. Publish path can't even mark a video as a Reel. | D2 |

## Prod data (movebetter, pulled 2026-07-21)

- Last 28 days: 63 content items. Instagram: 19 (15 carousels, 1 with video). Facebook: 9 (0 video, 2 failed). Zero `instagram_reel` ever, all-time.
- Video supply is NOT the problem: 217 videos (~118 min) uploaded in 60 days, 463 all-time. Moment-miner detected 172 segments in 60 days → **3 ever rendered** → 2 IG videos ever published. 98% drop-off exactly where the karaoke spine should be.
- This week (Jul 20–26): 2 LinkedIn published; pool = 3 unscheduled IG photo carousels + 1 GBP draft. Cadence target = 17/week (IG 4, FB 3, LI 3, GBP 2, story 5).
- **Facebook token dead since ~Jun 26** (Meta 190:460 session invalidated). No FB item created since Jul 7. Nobody was alerted — connection health has no surface.
- Staff feedback (Phillip, Jul 13, 4 reports in one day): clip export-to-library FAILED; transcript word-edit broken; backlog post scheduled+approved never appeared on weekly screen; auto-caption over character limit.
- `instagram_story`: 6 drafts created Jul 1, none since, none published.

## The four diseases

### D1 — Publishing is open-loop (the trust killer)
Bernard fires media at bundle.social and never looks at what came out. The bundle path does ZERO server-side media prep (`prepareMediaForBuffer` is Buffer-path only — `api/_routes/publish/buffer.js:186` vs `:254-315`). Ranked divergences:
1. Single photos/videos ship at native aspect; preview shows a 1:1/9:16 CSS `object-cover` guess that is not IG's crop. Hits every non-carousel post.
2. Video posts sent as IG `type:'POST'`, never `REEL` (`bundlePublisher.js:313-315`) — a clip previewed full-screen 9:16 lands as a cropped in-feed video. (The legacy Buffer path DID set reel type; bundle path lost it.)
3. SlideEditor's chosen aspect (1:1/9:16) is dropped at publish; slides re-baked to 4:5, text reflows (`publishPiece.js:57-65`, `renderSlides.js:108`).
4. No post-publish read-back: webhook only reads POSTED/ERROR; `resolved_url` never set for IG/FB so "View live post" never appears (`PostStatusRow.jsx:162-164`). A wrong-but-"successful" post is invisible.
5. Font cold-load race in client bake (no `document.fonts.ready` await — `overlayTemplates.js:29-34`): baked carousel text can ship in fallback font with different wrapping.
6. `photo_idx` indexes raw array in preview but filtered array at bake (`renderSlides.js:109,115` vs `PostPreview.jsx:106`) → wrong photo under text when arrays are mixed.
7. IG caption >2200 not clamped server-side (only GBP is) → late hard failure instead of an editor stop. Matches Phillip's report.
8. No reel cover/thumbnail sent (bundle path ignores `thumbnailUrl`) → IG picks first frame.
Parity-safe today: 4:5 carousel pixels (same renderer both sides), brand styling chain, caption text (no hidden transforms), failure emails, double-publish lock.
Also: client marks rows `published` optimistically before bundle confirms; FB token death was silent for 3+ weeks.

### D2 — Format-blind planner + a reel factory that stops one step before done
The planner literally cannot plan a Reel (no format field anywhere in atoms/strategist schema). Drafts are born with no media. Meanwhile every reel primitive exists: Whisper word timestamps persisted, moment detection w/ scores every 10 min, 6 karaoke presets, server ffmpeg burn, headless render+auto-caption (`render-segments.js`) — the output just lands as b-roll instead of a draft, and only the editor's manual "As a post" creates a video content_item (`clip-to-post.js`, editor-only). Gaps ranked by effort: (1) LOW — wire rendered moment → draft; (2) MED — auto-select top-scored moments to fill reel slots (crosses the deliberately-drawn "no auto judgment" line in `auto-detect-clips.js:10-13`); (3) HIGH — native REEL publish w/ cover.
Why it matters (2026 numbers): Reels reach ≈2.25× single images (30.8% reach rate), 55% of reel views come from non-followers (discovery = new patients); carousels win on engagement-rate depth. Bernard's mix today optimizes neither — it's photo-carousel-heavy because that's what the pipeline could produce automatically.

### D3 — /week is a review queue wearing a calendar costume
7-column grid, but: cards not clickable, approve behind an expander with a 4-line excerpt and zero media, no month view, no + on days, backlog drawer read-only, weekend cells render a dead "Quiet" moon with no affordance. Approval from /week is approving semi-blind — which both ships mistakes and makes staff (correctly) distrust the act of approving. Cadence policy (targets, quiet days) is invisible on the calendar and locked behind an Auto/Manual gate in settings.

### D4 — No learning loop
Rejection is silent deletion; edits before approve (the richest, free signal) aren't captured as preference data; `trust_stage` never graduates. The planner makes the same mistakes weekly and staff conclude "it doesn't get us."

## Strategic direction (the challenge section)

1. **The competitor isn't Buffer — it's the front desk posting natively from a phone.** Native IG posting takes ~3 min and is 100% WYSIWYG. Bernard must beat that on speed AND certainty, with better words. Feature parity with scheduling tools is not the bar.
2. **Trust is asymmetric — one bad render erases ten good posts.** Sequence reliability before capability. And make reliability VISIBLE: post-publish verification with a "live ✓ view post" receipt, connection-health banners (FB token!), a monthly "14/14 rendered as previewed" stat. Receipts rebuild trust; promises don't.
3. **Don't build iCal — build a posting schedule (slots).** At 5–15 posts/week, month-grid-first calendars are agency furniture. The Buffer-style primitive unifies #3/#5/#7/#8: per-channel weekly slots (Tue 12:15 IG reel, Sat 9:00 IG story…), planner fills slots, empty slot = the + affordance, quiet day = merely a day with no slots (user-ownable, no Auto/Manual gate). Week board stays primary; month becomes a light overview; drag = reschedule.
4. **Make the clinician-reel spine the golden path** (upload → auto karaoke-captioned reel + short description → approvable draft in a reel slot; zero editor opens; <5 min staff time). Photos/carousels demote to secondary lanes. This is also the moat — the interview/voice system means Bernard's captions are in the clinician's words, which no generic tool can do.
5. **Approve where the full post is visible.** Card click → full post (words + all media + platform-true preview) → approve there. Keep /week cards as status chips. Design the trust ladder (instrument edit-rate per lane so `trust_stage` can graduate to lighter review later) rather than hard-wiring heavy review forever.
6. **Learning loop: capture explicit rejects (enum + note) AND mine implicit signals** (edit-diffs, ignored drafts). Weekly visible digest — "you rejected 3 stock-photo looks; I'm shifting IG to clinic photos + reels" — the loop must be seen to be believed.

## Roadmap

| Track | What ships | Est. Days | Est. Claude Cost |
|---|---|---|---|
| T1 Closed-loop publishing | REEL type + cover via bundle; honor editor aspect at publish; photo_idx + font fixes; pre-approve caption caps; platform-true preview crops; post-publish permalink verification + "View live ✓"; connection-health alerts (FB token day-0, not week-3) | 3–5 | $25–50 (Sonnet; Opus for pipeline forensics) |
| T2 Reel spine | render-segments → draft wiring; reel format dimension in planner; auto-fill reel slots from top-scored moments (pending Q's autonomy call); footage-ask ("film 30s on X") when supply thin; fix export-to-library + word-edit bugs | 4–6 | $40–80 (Sonnet) |
| T3 Calendar + slots | Posting-schedule primitive over cadence_policy; clickable cards → full-post approve; + on every day (backlog or new); month overview; drag reschedule; quiet-day inline edit. Mockup-first. | 4–6 | $30–60 (Sonnet) |
| T4 Learning loop | Reject w/ reason enum+note; edit-diff mining into planner/voice weights; weekly "Bernard learned" digest; trust_stage graduation metrics; **day/time cadence learning** — extend cadenceAdaptive.js from "how many" to "when" (day-of-week × hour engagement from engagement_snapshots, same guardrails) + exploration slots (~1/wk into unproven windows, e.g. Sat noon) so quiet-day defaults stop being self-sealing; Auto proposes schedule changes with evidence, user accepts | 4–6 | $30–60 (Sonnet) |

Recommended sequence: **T1 first** (small and it gates everything), then T2, then T3 (mockup first), T4 woven in after. Immediate ops item independent of all tracks: **reconnect the Facebook token in bundle.social** and decide whether Saturday stays quiet.

## Decisions taken (2026-07-21, Q via AskUserQuestion)

1. **Sequence: T1 + T2 in parallel** (trust track and reel spine together as the first wave; T3 then T4 after).
2. **Calendar model: slots + week board + month overview** (Buffer-style posting-schedule primitive over `cadence_policy`; quiet day = slot-free day; no Auto/Manual gate). T3 is mockup-first per house rules.
3. **Reel autonomy: auto-draft Reels approved.** Bernard may auto-select top-scored moments and render karaoke-captioned reels into Reel slots as DRAFTS. This deliberately crosses the "detection-only" line in `auto-detect-clips.js:10-13`. Humans still approve every publish (trust_stage stays approve_all for now).
4. **Learning loop: full scope** — reject-with-reason AND pre-approve edit-diff mining, with a visible weekly "Bernard learned" digest. Ships as T4 (reject UI can ride with T3's full-post approve screen).

**Track boundaries for the parallel wave:** T1 owns `api/_lib/social/bundlePublisher.js` + publish routes + PostPreview/publishPiece/renderSlides. T2 owns render-segments→draft wiring, planner format dimension (atomPlan/strategist), moment auto-select, and the two staff-reported clip bugs. T2 must NOT touch the publish path — the REEL-type flag lands in T1.

5. **(added later 2026-07-21) Days/times learning added to T4.** Finding: "Auto" cadence is three layers — per-channel counts are genuinely adaptive (`cadenceAdaptive.js`, ±1/wk from 8wk engagement_snapshots, prior in `app_config.cadence_defaults`), but `quiet_days` is a frozen authored default and posting hours are the hardcoded `BEST_HOUR` constant (`strategist.js:55`). Quiet days are self-sealing: no weekend inventory → no weekend data → Auto can never learn weekends. T4 now covers learning WHEN (not just how many) + exploration slots + propose-with-evidence UX. FB was reconnected by Q 2026-07-21.

**Q's personal ops items:** (a) reconnect Facebook in bundle.social (Meta token invalidated ~Jun 26 — re-auth the Facebook account in the bundle.social dashboard); (b) optional: unquiet Saturday now via Settings → Channels → Cadence → switch to Manual → toggle Sat (or wait for T3 slots to make this a calendar-native edit).
