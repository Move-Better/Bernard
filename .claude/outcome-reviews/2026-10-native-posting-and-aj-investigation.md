# Investigation — native-posting bypass + AJ activation (2026-10-01)

Follow-up to the Week-1 / September close-out chip in `2026-10.md` (gap #1). Read-only pass against prod DB, Clerk, PostHog, and the live IG/FB profiles in Q's Chrome. **This feeds the staffing decision — it does not change anything.**

## The short version

Two assumptions in the review were too strong, and correcting them changes the decision:

1. **The "native posting bypass" is one post, not a trend.** Exactly **one** hand-made Instagram post went up that Bernard didn't create — the **09-09 "$100-to-charity, leave us a Google review" reel**. It auto-cross-posted to Facebook. That single reel is what drove the Facebook reach spike (~20k → ~113k) and most of the follower growth. **There are no paid ads or boosts** (Facebook Ad Center: 0 ads in 60 days) — the reach is entirely organic. The review's "+3 Instagram posts" is a measurement artifact of a noisy Instagram post-count (it already read 217 on 09-13 and has not moved since); no Instagram post exists after 09-09.

2. **AJ is not inactive — AJ is active and bypassing the queue.** AJ logs into Bernard regularly (today, and six times across September), is fully permissioned to publish, and on **09-17 personally opened the two Instagram/Facebook drafts** that then expired unapproved on 09-28. The blocker is **not** login, account, or permission. It's behavioral: AJ looks at the queue and doesn't approve — and at least one post went out by hand instead.

So the churn signal is real but milder than framed, and the staffing question is sharper: the designated successor is engaged with the product but won't pull the trigger inside it.

## 1. What actually went up on the profiles

**Method:** pulled every IG/FB post code off the live grid in Q's Chrome and matched each against every `resolved_url` Bernard ever produced for movebetter.

- **Instagram (`movebetterclinics`, 217 posts, 663 followers):** of the 24 newest grid posts, **all but one** are Bernard's. The only recent non-Bernard post is the **09-09 reel** (`instagram.com/movebetterclinics/reel/DdE_gfTPs9E/`, posted 09-09 12:34 PM PDT) — a clinician-to-camera piece offering $100 to a charity for a monthly Google review. Bernard has only ever made 2 reels (08-25, 09-04), so this one is hand-made. The 3 pinned posts above it are old (March 2026 and earlier). **Nothing on the grid is newer than 09-09.**
- **Facebook (page `179427498591846`, 19 followers):** the newest page post is that **same 09-09 reel, "Published by Instagram"** — i.e. the IG→FB auto-cross-post, not a separately hand-written FB post. No native FB-only post after Bernard's last (09-06).
- **Ads/boosts:** Facebook **Ad Center → "0 ads · Last 60 days", "You have not created any ads yet", Reach 0 / engagements 0 / link clicks 0.** The IG reel shows a "Boost reel" button (not "View results"), i.e. not currently boosted. **The reach spike is organic**, consistent with a reel out-performing static posts.

**On the "+3 native IG posts":** the raw `social_channel_snapshots` rows are very noisy (on 09-04 alone, post_count readings swing 200–212 across captures). The stable reading is: 213 on 09-06, **converging to 217 by 09-13** (that day's captures already include 217), and flat at **217 through 09-20, 09-27, and live today.** The count stopped moving once Bernard's last posts (through 09-09) finished being counted. The "214 → 217" delta the review cited is two picked points inside that flux, not three new posts.

**Follower/reach growth is real and organic:** IG followers ~638 → ~663 over the month, continuing through the silence; FB reach ~20k → ~113k, all traceable to the one cross-posted reel plus the existing catalog. No bot/ad signature.

## 2. AJ's activation — end to end, fully green

| Layer | Finding |
|---|---|
| **Clerk account** | `user_3DaM77u4L0T8AXJRiZNwwCGHDAF`, `aj@movebetter.co`. Not banned, not locked, password enabled. |
| **Has signed in?** | **Yes, repeatedly.** 15 lifetime sessions. Last sign-in **today, 10-01 19:02 UTC**. September logins: 09-03, 09-04, 09-05, 09-14, 09-17, 09-24. This is not a dormant account. |
| **Did AJ reach the queue?** | **Yes.** PostHog (project 473748): AJ viewed `/week`, `/producer`, `/overview`, `/analytics`, `/seo`, `/moments`, `/stories` through September. On **09-17 AJ opened three `/publish/…` pages** — two of which were the IG draft `c0f27f30…` and the FB draft `35523161…` that the planner then **archived unapproved on 09-28**, plus one approved blog. |
| **Staff row + permission** | `Aj Adams`, tier **producer**, overrides `content.publish:true`, `campaigns.edit`, `moments.generate`. **Fully permissioned to approve and publish.** |

**Single blocker: none technical.** AJ is activated, permissioned, and has personally looked at the exact drafts that later expired. Zero approvals is a behavioral/adoption gap, not an access gap.

**Who else could approve (for the staffing call):**
- Alli Madsen — producer tier — **last login 08-03** (dormant ~2 months).
- Whitney Phillips — clinician + `content.publish` override — **last login 08-06** (dormant).
- Zach Cullen — clinician (no publish override) — last login **09-30** (active, but can't publish).
- Dr Q — owner — active.

So among publish-capable staff, **AJ is the only one both active and permissioned.** The approval queue depends entirely on AJ choosing to use it.

## What this means for the decision

- The "someone is running our social by hand around Bernard" framing overstates it: it's **one engagement/review-ask reel**, and the person who made it is the obvious right approver.
- The real, narrower problem: **the designated successor logs in, browses, opens drafts — and doesn't approve.** That's a workflow/onboarding or willingness question about AJ specifically, not a broken account and not a swarm of native marketing replacing the pipeline.
- Q's call: confirm AJ owns the queue and walk them through the one approve→publish action, or reassign. Reassignment options are thin — the other two publish-capable staff haven't logged in since early August.

## Verification trail (identifiers)

- movebetter workspace `76faa447-b1f4-4038-babc-4d86536b049d`; IG `movebetterclinics`, FB page `179427498591846` (new-style id `61554449978363`).
- Native IG reel: `DdE_gfTPs9E` (09-09), absent from all Bernard `content_items.resolved_url`. Bernard's last IG = `DdEk3qtjW1b` (09-09), last FB = `…_122265393770148332` (09-06).
- Expired drafts AJ viewed 09-17: `c0f27f30-e762-4e5e-b7f6-f3ef7a1e0d41` (IG), `35523161-2eda-448f-b33b-fbd8439a3196` (FB) — both `archived` 09-28, `approved_at` null.
- FB Ad Center (`/61554449978363/ad_center/`): 0 ads, 60 days. Chrome FB admin session is under the name "Michael" (the personal account with page-admin rights).
- Clerk sign-in / PostHog pageviews as tabled above. Read-only throughout; no approve/publish/delete actions, no content mutations.
