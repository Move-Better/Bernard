# Bernard — Blindspot Audit, IN-HOUSE LENS (Navigation Waypoint)

**Created:** 2026-06-03 · **Owner:** Q · **Status:** living doc — Q marks up, we re-run on cadence
**Purpose:** the twin of `blindspot-audit.md`, run with one variable changed: **Bernard is evaluated ONLY as an in-house tool for Move Better the practice — never as a SaaS to sell.** Same instrument, different question. The SaaS doc asks *"will the market adopt and pay?"* This one asks *"is this worth Q's finite time, does anyone but Q actually use it, and does it move Move Better's needle?"* Read the two side by side: the §2b table maps exactly which SaaS blindspots **evaporate**, which **persist**, and which **invert** when you stop trying to sell it.

> **How to read this against its twin.** Same severity scheme, same status scheme, same four lenses, same register columns — on purpose, so the rows line up. Where the SaaS doc says "the market," this doc says "Move Better." Where it says "a paying tenant," this says "Q's hours." The pair is a decision aid: *here is what changes if you commit to in-house-forever, and here is what is intrinsic to the build no matter what you decide.*

---

## 0. How to use this (the ritual)

This is not a one-off. It's a **waypoint** — you return to it on a cadence, re-run the lenses, and diff against the last pass. The value isn't any single finding; it's watching whether the practice is *getting more back* from the tool than it *costs you to keep alive* — and whether that ratio is improving over time.

**The four lenses** (each catches a different class of blindspot):
- **A — Adversarial persona panel.** Simulated in-house critics attack from their angle (your own staff, owner-you wearing a CFO hat, an ops consultant, future-you, the patients who see the output).
- **B — Buy-vs-build teardown.** For each off-the-shelf product: what it would cost Move Better in $/mo + Q-hours vs. the homegrown stack, and what is genuinely *lost* by switching.
- **C — First-principles re-derivation.** Re-derive what *the practice* is hiring this tool to do; find the baked-in assumption.
- **D — Real staff cold-use.** The only true unknown-unknown detector. Needs your actual staff, not me — and, uniquely in-house, **its first move is free: a database query you can run today.**

**Honesty about the lenses (read this).** Lenses A–C are *me* reasoning from your docs and general product knowledge. They are a **bias-reduction forcing function, not ground truth** — I share your blindspots (I also only know Move Better through your words, and I have *no idea* whether Whitney or AJ have ever opened the tool unprompted). They're good at "what would a sharp outside observer obviously say"; they are *not* a substitute for watching your own staff use it. **Only Lens D finds the things no simulation predicts** — which is why it's a runnable protocol, not a paragraph I wrote. Weight the lenses accordingly. The in-house twist: Lens D is *cheaper* here than in the SaaS doc, because step one is querying your own prod database, not recruiting strangers.

**Severity:** 🔴 could sink it · 🟡 will bite later · 🟢 worth knowing
**Status:** `Open` (unexamined) · `Aware` (you know, no action yet) · `Building` (actively addressing) · `Closed` (resolved or consciously accepted)

**Re-run cadence:** every 4–6 weeks, or at any fork specific to the in-house frame — a maintenance crisis (an SDK upgrade eats a weekend), a staffing change (someone joins/leaves the roster), or **the moment you decide, for real, whether you're selling this or not** (that decision is what makes this doc apply *instead of* its twin — see IH10). To re-run: re-read §1, re-walk §§3–6, **add a new dated block to §7**, and fill §8 with what moved. Append; never overwrite — drift is the product.

---

## 1. Fixed reference — what Bernard IS today, in-house (the thing under audit)

So each pass attacks the same target. Update this only when the product or the practice materially changes.

- **What:** a **custom content tool Q built and solo-maintains for Move Better.** Core loop is unchanged from the SaaS framing — **voice interview (turn-based STT+TTS) → AI spawns content (blog, per-channel social atoms, carousels, video clips/Slate, email) → approve → publish** via Buffer / Facebook / GBP / WordPress / Beehiiv. The difference is the *unit it serves*: not "tenants," but **one practice with three brands** — Move Better People, Equine, Animals.
- **Who actually uses it:** the real roster. **Q** (owner; all three brands). **Whitney Phillips** (all three; equine is mobile/on-the-road, animals clinic-based). **AJ Adams** (People, on-camera talent). **Alli Madsen** (People, Producer). **Dr. Cullen** (People only). Plus Sophie / Tyler / Philip (People). The *builder, maintainer, and proven power-user* is Q. **Non-Q usage is now measured (D0, 2026-06-04): four other clinicians — Whitney, Sophie, Cullen, Tyler — have each run their own capture sessions, and ≥4 published pieces trace to non-Q-operated sessions.** So it is *not* a Q-only tool. The live residual is *habit vs. onboarding novelty* and *brand coverage* (Animals and Equine still run almost entirely on Q) — see §6.
- **The bet (in-house):** that the content this produces brings **patients and community to the three brands**, and that the value of that exceeds **what it costs Q in solo build + maintenance time** vs. just renting tools or hiring a human.
- **Stage:** in production, used by the practice daily. Multi-tenant SaaS machinery exists — `withbernard.ai/onboard` wizard, Stripe billing (test mode, $149/$299/$499), per-tenant encrypted credentials, tenant-isolation discipline on every API route, self-serve signup — **but serves exactly one practice and generates zero revenue.** A revenue roadmap is on paper (starts Jul 1 2026); whether it's real is itself a finding (IH10).
- **Proof point so far:** "15 days produced more content than the prior 10 years." In-house, that's a **content-velocity** win that's genuinely huge — *and* it is the START of the question (did velocity become patients?), not the end of it.
- **Known-in-flight:** 9→5 surface consolidation (instruction-first Studio); outcome-loop wiring (GA4 config shipped as Slice A, loop still receiving zeros, `ga4_property_id` null on all three workspaces); library-by-meaning indexing. In-house, the outcome loop matters *more*, not less — see §5.

---

## 2. The through-line — read this before the lenses

The SaaS doc's root blindspot was: *"the product is exquisitely tuned to the one user you already have — you,"* and the danger was mistaking **Q for the market.** Drop the SaaS frame and that fear doesn't disappear — it **changes target.** The new root, the hardest one to see from your seat:

> **"It works spectacularly for Q" quietly contains two different bets you've never separated: that Q is not the only user (the rest of Move Better uses it too), and that the hours Q pours into it are cheaper than what the practice gets back (it pays for itself in *patients*, not just in *posts*).**

In-house, **n=1 is fine** — Move Better *is* the only customer, so founder-market fit is just… fit. That's the good news, and it deletes a whole cluster of SaaS anxieties (§2b). But the same sentence that proves the concept ("it's amazing for the builder") now hides a different conflation: **Q is not Move Better.** Move Better is Q + Whitney + AJ + Alli + Cullen + Philip across three brands. If only Q uses it, it is a *beloved personal tool wearing a business system's clothes* — and a personal tool does not justify business-system maintenance cost. Every red finding below is a place where **"Q uses it" got silently upgraded to "the practice uses it," or where the cost side of the ledger (Q's time, much of it spent on SaaS-only overhead) never got written down at all:**

- **adoption** (you use it; does Whitney capture an equine story from the road without you prompting her?),
- **cost** (it's "free" only because you don't bill yourself for the weekends; the practice's scarcest resource is *your hours*, and a large slice of them maintains SaaS plumbing the practice doesn't need),
- **outcome** (you measure content produced and voice fidelity; you measure *patients* for none of the three brands),
- **bus-factor** (you're the only person who can fix it, and the old manual content habit was replaced),
- and the **unstated question of whether you're actually building a startup** and "in-house tool" is the cover story (IH10).

**The trap is symmetrical to the SaaS one.** There, "it pays for itself" was a proof-of-concept signal mistaken for market validation. Here, **"it pays for itself" is a *content-velocity* signal mistaken for *practice ROI* — and the gap between "we publish 100× more" and "the waiting room is fuller" is the most expensive thing a solo clinician-builder can misread**, because the bill is paid in the one currency he can't make more of: his own time. Hold this lens over every finding below.

---

## 2b. What changes vs. the SaaS audit (the decision aid)

The whole point of this twin. Each SaaS blindspot (B1–B12 in `blindspot-audit.md`), and what happens to it when Move Better stays in-house forever. **Evaporates** = the in-house frame deletes it. **Persists** = intrinsic to the build regardless of who you sell to. **Inverts** = it doesn't vanish, it changes into a *different* in-house problem.

| SaaS ID | Verdict | Why (one line) |
|---|---|---|
| **B1** No acquisition engine / no CAC | **Evaporates** | Zero customers to acquire — Move Better already "bought." (Its energy reappears as *internal* adoption → IH1.) |
| **B2** Interview is moat + friction; no lite-capture | **Persists** | Still the cliff — for your *own busy staff*; it's the lever between "Q-tool" and "practice-tool." → IH7 |
| **B3** n=1 validation / founder-market-delusion | **Inverts** | n=1 is *fine* in-house — but re-emerges as "Q ≠ the practice": n=1 *inside* Move Better. → IH1 (the headline) |
| **B4** The wedge has never fired (outcome dark) | **Persists** (intensifies) | In-house the outcome loop is the *only* possible proof the tool works — no paying tenant to stand in. → IH3 |
| **B5** Moat weakest on day 1 (cold-start) | **Evaporates** | No new users to cold-start; Move Better's library is already rich. A pure SaaS-onboarding problem. |
| **B6** Publish is the real bottleneck | **Persists** | If publishing stalls, MB's content doesn't ship no matter who's selling. Unchanged. → IH8 |
| **B7** Single-user in a multi-provider world | **Inverts** | Stops being a TAM cap; *becomes* the core question — MB *is* the multi-provider clinic. → IH1 / IH12 |
| **B8** Willingness-to-pay unvalidated | **Evaporates** | Nobody's paying tiers; the $ question becomes Q's-time-vs-rent opportunity cost. → IH5 |
| **B9** No HIPAA/BAA posture | **Evaporates** | No external compliance gate to hard-block a sale; MB's own "no patient-facing AI content" rule already covers its liability. |
| **B10** Competitor wins day-0 before library compounds | **Evaporates** | No customer to lose. Competitive dynamics don't apply to a tool you don't sell. (Re-forms as buy-vs-build → IH5.) |
| **B11** Surface proliferation = no external-user friction | **Persists** (root permanent) | In-house there is *never* external-user pressure to prioritize — the only forcing function is Q's discipline + staff friction. → IH9 |
| **B12** Done-for-you segment may hold the money + pain | **Inverts** | Becomes "should MB itself *buy* done-for-you instead of Q building it?" The buy-vs-build spine. → IH5 |

**Read the column.** Five evaporate (B1, B5, B8, B9, B10) — every one is a *market/customer* problem, and there's no market. Four persist (B2, B4, B6, B11) — every one is a *build* problem that exists whether or not anyone's buying. Three invert (B3, B7, B12) — and the inversions are the interesting part: they're where a SaaS *growth* concern turns into an in-house *adoption-and-cost* concern. **Net: going in-house-forever deletes the entire go-to-market half of the SaaS audit, and replaces it with a smaller, sharper set about cost (your time), adoption (your staff), and impact (your patients).** That's a better trade — *if* you actually answer the new questions instead of inheriting the old comfort of "we'll validate externally later."

---

## 3. Lens A — Adversarial persona panel

Five critics, none of them strangers — all in-house or downstream. For each: their sharpest critique, then **the one question you currently can't answer** (the actual blindspot).

### 🧑‍⚕️ A non-Q staffer (say, AJ on-camera, or Whitney out on a farm visit)
"Q built this and Q loves it. For me to use it, I have to sit a voice interview, then figure out Stories vs. Storyboard vs. Slate vs. Write, then remember to come back later and approve drafts. I've got clients all day. It's genuinely easier to film a 30-second clip on my phone, text it to Q, and let him run it through the machine — so that's what I do. Which means the 'team' tool is really Q's tool, and I'm a *subject* in it, not a *user* of it."
> **Can't answer:** *In the last 30 days, how many pieces did any non-Q staffer capture **and** publish without Q prompting them?* If the honest answer is "I don't know" or "zero," then the multi-staff roster, per-clinician voice library, and the whole "team-as-talent" principle are serving a usage pattern that isn't actually happening — and a lot of build went into it.

### 👔 Owner-Q, wearing the CFO hat (not the builder hat)
"As the person responsible for this practice's P&L, I have to ask builder-you a question you keep dodging: every weekend you spend shipping PR #11xx is a weekend *not* spent on the things that actually grow a chiropractic practice — seeing more patients, the monthly seminars, hiring, referral relationships, the equine route. The content tool is a marvel. But is it the highest-return use of the single scarcest asset this company has, which is *your hours*? You would never let an employee sink this much time into an internal tool without an ROI number. You've granted yourself an exemption you'd grant no one else."
> **Can't answer:** *What is the practice getting back — in patients or revenue — per hour you put into building and maintaining this, and is that ratio better than your next-best use of the same hour?* You have a content-velocity number (15 days > 10 years). You have no patients-per-build-hour number, for any of the three brands.

### 🛠️ A pragmatic ops consultant, reviewing the stack cold
"I've gone through the architecture. You've built — and now solo-maintain — a genuine multi-tenant SaaS: an onboarding wizard, per-tenant encrypted credentials, tenant-isolation discipline enforced on *every* API route, three-tier Stripe billing, self-serve signup at a public URL. You have **exactly one tenant.** Every one of those systems is pure carrying cost with zero in-house payoff. You're paying the *engineering* price of a platform to get the *value* of a single-practice script. That's a strange thing to do on purpose. So either you're quietly building a company to sell — in which case stop calling it an in-house tool and resource it like a startup — or you should freeze and delete two-thirds of the surface you're maintaining and reclaim those hours."
> **Can't answer:** *Which parts of this codebase exist only to serve future tenants who don't exist — and what would you save in monthly maintenance by freezing or deleting them?* You've never drawn the line between "Move Better needs this" and "a SaaS needs this."

### ⏳ Twelve-months-from-now Q
"It's June 2027. The model you wired in is two generations old. Buffer changed its API again. A Clerk upgrade broke sign-in for a week. A Vercel runtime bump needs every handler touched. I'm still the only person on Earth who can fix any of it. The tool that was supposed to *free up* my time has become a part-time, unpaid SRE job — and on the days it's down, Move Better has **no content pipeline at all**, because we threw away the old manual habit when this replaced it. The 100× multiplier is real. So is the 100% dependency on me."
> **Can't answer:** *If you stopped all feature work today, what is the irreducible maintenance — hours per month — just to keep it running, and who covers it the week you're on vacation, sick, or slammed with patients?* Bus-factor of one, on the practice's entire content pipeline, is completely unpriced.

### 📱 A patient who follows Move Better
"I follow you guys. I've definitely noticed more posts lately — way more than before. Did any of it make me book an appointment? Did it bring my neighbor in? Or is it just… more stuff in my feed that I scroll past on the way to something else? You went from a trickle to a firehose. But a firehose of posts isn't the same thing as a fuller waiting room, and from out here I honestly can't tell which one you got."
> **Can't answer:** *Has the content this tool produces measurably moved any practice metric — new-patient bookings, "how'd you hear about us," rebookings, seminar or event turnout — for People, Equine, or Animals?* Volume is proven beyond doubt. Impact on the actual practice is not measured at all.

**Panel pattern:** the SaaS panel's five critiques were all about the *seams around* the product — get found → first-five-minutes → publish → week-2 habit. **This panel clusters somewhere completely different: cost (Q's time), adoption (non-Q staff), and impact (does it move the practice's needle).** Those are precisely the three things the SaaS frame under-weighted, because it was preoccupied with acquisition. The in-house risk isn't "will strangers adopt and stay" — it's **"is a beloved personal tool quietly miscategorized as a business system, and therefore carrying business-system cost while delivering personal-tool reach?"** Four of five critics would be satisfied by the *same two facts*: a staff-usage number and a patient-impact number. You have neither.

---

## 4. Lens B — Buy-vs-build teardown

Not "what job do competitors serve that we don't" — that's the SaaS question. The in-house question is blunter: **should Move Better just *buy* this off the shelf instead of Q building and maintaining custom code?** For each option: what it replaces, the rough cost to Move Better (dollars **and** Q-hours), and what's genuinely *lost* by switching. Cost estimates are order-of-magnitude, for one small practice.

| Off-the-shelf option | What it replaces in your stack | ~Cost to Move Better | What's genuinely LOST by switching |
|---|---|---|---|
| **Castmagic** (~$49–99/mo) | The multi-format generation engine (recording → blog/social/clips) | ~$49–99/mo, **~0 maintenance hrs** | The "**only words you actually said**" guarantee. Castmagic trains on past posts and will ghostwrite connective glue. You'd keep fast output, lose the *librarian-not-ghostwriter* fidelity and the cross-staff / cross-interview practice memory. |
| **Descript** (~$24–50/mo/seat) | Slate (the clip workshop) + the "instruction-first editing" paradigm (Underlord) | ~$24–50/mo/seat, **~0 maintenance** | Transcript-anchored **clinical** clip selection (Descript's is generic), and having the edit live in the same place as the words. You'd get a vastly better editor than Slate, for free, forever-maintained by Descript — and lose the unified pipeline. |
| **Opus Clip** (~$19–29/mo) | Slate's auto-clip-finding | ~$19–29/mo, **~0 maintenance** | Clinical/transcript-anchored selection — but honestly, for *raw clip-finding* Opus is ~80% there for $19, and the moat-relevant selection logic matters less for clips than for words. This is the weakest thing to keep building. |
| **Buffer** (~$6–30/mo) | *Already rented.* The publish/schedule layer | ~$6–30/mo, **~0 maintenance** | Nothing — you correctly don't own this. Keep it. (The one place the existing instinct is already right.) |
| **A done-for-you agency or a part-time content VA** (~$300–800/mo) | The **entire thing** — capture, generation, scheduling, publishing — done by a human | ~$300–800/mo, **~0 of Q's build/maintenance hours** | The real-voice fidelity (an agency writes in a generic "clinic voice"), Q's editorial control, the compounding library, data residency. **But it is the option that most directly frees Q's time — which is the stated #1 value.** Your relationship-moat thesis says fabricated warmth is the enemy; an agency is maximally fabricated. So this is what you'd lose *most*: authenticity. It's also the cleanest answer to "get it off my plate." |

**The honest synthesis.** Strip the stack down and **exactly one thing doesn't come off a shelf at any price: the per-practice real-voice library + practice memory + outcome-tuned aiming** (the wedge — and you already know it's the only durable asset). *Everything else* — generation, the compositor, the clip workshop, the four editors, scheduling, design — has a cheap, zero-maintenance, venture-funded equivalent that is 80–100% as good for Move Better's purposes. So the question the in-house frame forces, that the SaaS frame let you avoid:

> **Is the real-voice library *alone* worth the maintenance burden of the entire surrounding platform you've wrapped around it?**

And the sharp, almost-heretical follow-on: **you could keep only the capture + voice-library + retrieval core — the genuinely unbuyable part — and rent literally everything downstream** (edit in Descript, clip in Opus, schedule in Buffer, design in Canva, generate first drafts wherever). That would shrink Q's maintenance surface to the one thing that's actually differentiated, and it is **almost the exact opposite of the SaaS-optimal architecture** (which wants to own the whole pipeline to capture margin). In-house, owning the whole pipeline isn't margin — it's *overhead.*

**Latent item (the in-house analogue of the SaaS doc's HIPAA gap):** the off-the-shelf tools get better every month on someone else's venture dollars; the homegrown surfaces get better only when Q spends a weekend. **Every month, the gap between "what Descript/Castmagic ship" and "what a solo maintainer can keep current" widens.** The build *depreciates* unless continuously fed Q's time — and the things you rent *appreciate* for free. 🟡 latent; it doesn't bite on any single day, it bites as a slow, compounding drift you only notice at the 12-month mark (see ⏳ above).

---

## 5. Lens C — First-principles re-derivation

Throw away what's built. **What is *Move Better the practice* actually hiring this tool to do?**

| The real job | What it actually wants | How well the build serves it |
|---|---|---|
| **1. Get patients in the door across three brands** (the economic job) | People / Equine / Animals each findable + credible so people *choose* them | ⚠️ Measured by *content produced* + *voice fidelity* — proxies for the *input*, never closed to the outcome (a booked patient), for *any* of the three brands. |
| **2. Free up Q's time** (the relief job — and the one the tool can *violate*) | Less for the owner to personally do | ⚠️ **Genuinely two-sided.** It removed the writing work (huge). But it *added* a build-and-maintain job that only Q can do. Net time freed is unknown and could be negative on a bad-maintenance month. |
| **3. Capture the *other* people's voices** (the leverage job — the practice is more than Q) | Whitney / AJ / Cullen / Alli stories flowing in without Q | ⚠️ The whole multi-staff machinery exists for this; whether it's *used* this way is unverified (Lens D). Least-proven of the three. |

**The baked-in assumption to re-examine** — and it's the same one the SaaS doc names, but it *bites harder* in-house: **that producing voice-faithful content is the value.** It isn't; it's *your solution*, not the practice's job. The practice doesn't want content — it wants **patients, reputation, relationships.** Content is the means.

Here's why it's worse in-house than in the SaaS framing: as a SaaS, **a paying tenant is itself evidence of value** even when outcomes are dark — "people are paying us, so we must be doing something" papers over the missing outcome proof. **In-house, there are no paying tenants, so that prop is gone.** Outcome is the *only* possible evidence the tool is doing its real job — and it's dark (GA4 unconfigured on all three workspaces, Buffer stats hollow, zero `performed_well` flags, the re-aim consumer unbuilt). **Removing the SaaS frame removes the only thing that was standing in for outcome proof.** So the §2 misallocation — strategy says *outcome* is the prize while the hours go into *output* surfaces (carousels, text-post studio, compositor templates) — is not just a misallocation here; it's the difference between **a tool you can prove earns its keep and one you merely *feel* earns its keep.** And the feeling is doing a lot of load-bearing work right now.

**Second assumption (the central one for this doc):** *that "build an in-house tool" is what's actually happening.* Re-derive it from where the hours go. A pure single-practice tool would never have an onboarding wizard, self-serve signup, or three-tier Stripe billing — those exist *only* to serve tenants who don't exist. Yet a real fraction of the build and maintenance is exactly those SaaS-only systems, and there's a revenue roadmap dated Jul 1 2026 sitting in memory. So one of two things is true, and **you haven't said which:**

- **(a)** You're actually building a startup, and "in-house tool" is the comfortable story. → Then *this whole audit is the wrong instrument* and the SaaS twin applies; resource it like a company, get external validation, stop deferring it.
- **(b)** You're paying startup-grade engineering tax for a single-practice tool *by accident*. → Then two-thirds of the maintained surface should be frozen or deleted, and the buy-vs-build core (§4) is the real architecture.

Both are legitimate. They demand **opposite** decisions about your time. **The single most clarifying thing you could do for this doc is pick (a) or (b) out loud** — because every red finding below reads differently depending on the answer, and right now the tool is being resourced as if it might be either, which is the most expensive posture of the three.

---

## 6. Lens D — Real staff cold-use (protocol — the only true detector)

I can't run this; it's the one lens that finds what no simulation predicts. Treat it as the highest-priority item in this whole doc. The in-house version has a gift the SaaS version doesn't: **its first move is free and needs no recruiting** — the answer is sitting in your prod database.

**D0 — The free move: query before you recruit.** Before anything else, answer the headline question (IH1) from data you already have:

> *In the last 30 (and 60) days, how many `content_items` / `interviews` were **created by a `staff.user_id` that is not Q's**, and how many of those reached **published** — without Q being the one who kicked it off?* Break it down per brand (People / Equine / Animals) and per staffer (Whitney / AJ / Alli / Cullen).

This was run against prod on **2026-06-04**. The schema gave a stronger signal than expected: `interviews.owner_id` records *who was logged in and ran the capture session* (the **operator**), separate from `staff_id` (*who the content is about* — which Q can set as a proxy). So we can measure genuine non-Q *operation*, not merely attribution.

**D0 RESULT — measured 2026-06-04 (three Move Better brands; today's 30-day window opens 2026-05-05):**

| Signal | Count | Detail |
|---|---|---|
| **Capture sessions operated by a non-Q logged-in user** | **8** (all within 30d) | 4 distinct people: **Whitney** (people + equine), **Sophie** (people), **Cullen** (people), **Tyler** (people, latest 2026-06-03). Zero sessions had an unknown/null operator. |
| **Published pieces from a non-Q-operated session** — strongest "captured **and** published by non-Q" | **4** (all 30d) | This is the figure the kill-threshold is measured against. |
| Published pieces *attributed* to non-Q staff (weaker — could be Q-as-proxy) | 5 | Cullen 3 (people), Whitney 1 (equine) + 1 (people). |
| Non-Q people who click **approve** | 3 | Philip, Cullen, Whitney (alongside Q). |
| Per brand — non-Q-operated / total sessions | — | **People 7/13 · Equine 1/1 · Animals 0/5.** |

*(Absolute volume is modest in `content_items`: 35 real items, 23 ever-published, all-time across the three brands. That table likely undercounts total output — carousels are one row; social atoms, Slate b-roll, and books live in other tables — so read the **ratios**, not the totals.)*

**Verdict against the pre-committed threshold.** The gate was: *"if no non-Q staffer captures **and** publishes a piece in 30 days → it's a Q-only tool."* Measured: **4 non-Q-operated published pieces, and 8 non-Q capture sessions by 4 people, all within 30 days.** → **The threshold is NOT triggered. Bernard is genuinely multi-user at Move Better — not a Q-only tool.** IH1's existential case is disproven (🔴 → 🟡).

**Two honest caveats — this is a strong signal, not proof of a habit:**
1. **Operator ≠ unsupervised.** `owner_id` being a non-Q Clerk account proves that person was logged in and ran the session (hard to fake) — but doesn't rule out Q sitting beside them coaching, which is plausible during onboarding. It clears *"can/will anyone but Q use it"*; it does not prove *"they'd do it alone."*
2. **All non-Q usage is < 30 days old** — it began when those staff rows were created in late May. That's consistent with an **onboarding wave**, not yet a proven recurring habit. So the residual question is no longer *cold adoption* (answered: yes) but **retention**: do these four come back next month unprompted? **Re-run D0 ~2026-07-04** and watch whether the non-Q session count holds or decays. And note **Animals is 100% Q-operated (0/5)** and **Equine has exactly one session (Whitney's)** — two of three brands still ride on Q (IH12).

*This retention re-run is now automated: a `launchd` one-shot fires `.claude/d0-rerun.mjs` on **2026-07-04** and writes a dated results file + a ready-to-paste drift row with a held/softened/decayed verdict (generator + uninstall in §9).*

The free move is now spent, and it came back reassuring. The next move (D1, below) costs a little and tests the thing D0 can't: whether the usage is a *habit* or a *novelty*.

**D1 — Cold-use session (mirror the SaaS protocol, but with your own people).**
- **Recruit:** 2–3 of the *actual* non-Q staff who *should* be using it — Whitney (covers all three brands; the highest-leverage recruit), AJ (on-camera, People), Alli (Producer, People), or Cullen (People). **Not Q. Not someone who'll perform enthusiasm to be nice** — the staffer who finds it a hassle is the valuable one.
- **Setup:** sit them down to capture and publish one real piece for their brand, **with no help from Q.** Screen-record + think-aloud. Q's only job is to *shut up and watch.*
- **Five watch-points** (each maps to a 🔴/🟡 below):
  1. **Time-to-first-"oh."** How long until they get why this is worth their time? (adoption)
  2. **The interview moment.** Lean in or check out? Fun, or homework? Do they *finish* it? (IH7 — interview-as-friction for non-Q)
  3. **The publish moment.** Once they have drafts — do they actually publish, or stall? *Where exactly?* (IH8 — the real bottleneck)
  4. **The Tuesday question.** "Would you open this again next Tuesday on your own — and to do what?" (does it survive without Q nudging)
  5. **The coworker-sentence.** "How would you describe this to another Move Better staffer?" Compare to how *you* describe it. (does the value land for them, or only for you)

**What counts as a finding:** every hesitation, every "wait, what do I do," every "why would I, when I can just text Q the clip," every place they did something *other* than what you expected. **Not their compliments** — those are politeness; confusion and avoidance are data.

**Pre-commit the threshold (applied once on 2026-06-04 — D0 passed it; keep it committed for every re-run).** Your own competitive-landscape memory already set the SaaS version: *"60-day external tenant validation gate: if few tenants stick, accept this is a Move Better-only internal tool and stop SaaS feature work."* The in-house version of that gate, stated plainly and committed *now*:

> **If no non-Q staff member captures *and* publishes a piece in 30 days (D0 returns ~zero, and D1 shows them stalling), then it is a Q-only tool — and you make one of two conscious choices: (1) scope and maintain it *as* a personal tool (rip out the multi-staff + SaaS surface, reclaim those hours), or (2) declare the staff-adoption gap priority one and fix it before any new feature.** What you do *not* get to do is keep building team features on the assumption the team uses it, untested.

A gate that can't fail is theater. Writing the number down before you look is what makes D0 real instead of a thing you'll "get to."

---

## 7. The Blindspot Register — 2026-06-03 (first pass)

The synthesized output. This is the table you **diff** on each re-run. Numbered **IH1–IH12** so they sit beside the SaaS doc's B1–B12 (the §2b table maps the lineage). Each row: the blindspot, which lens surfaced it, severity, what you're honestly doing about it today, and status.

| ID | Blindspot | Lens | Sev | Your coverage today (honest) | Status |
|---|---|---|---|---|---|
| **IH1** | **Q-only-tool risk (Q ≠ Move Better) — largely retired by D0.** Measured 2026-06-04: 4 non-Q clinicians (Whitney, Sophie, Cullen, Tyler) ran their own captures (8 sessions/30d); ≥4 published pieces trace to non-Q-operated sessions; Philip/Cullen/Whitney also approve. Not a Q-only tool. | A, C, D | 🟡 | Residual = *habit vs. onboarding novelty* (all non-Q use is <30d old). Re-run D0 ~2026-07-04; see §6 D0 RESULT. | Aware |
| **IH2** | **Maintenance is an unpriced tax on Q's scarcest resource — his hours — justified by no outcome number.** Every build/maintain hour is charged against clinical + practice-growth time; return in patients is unmeasured. | A, C | 🔴 | Free-up-time filter exists as a *rule*; there's no patients-per-build-hour measure. "Pays for itself" is in *content*, not *time or patients*. | Open |
| **IH3** | **The outcome loop is dark — and in-house it's the *only* possible proof the tool works.** No paying tenant to stand in for "is it working." content→patients for MB is unproven. | C, B | 🔴 | Slice A (GA4 config) shipped; loop still receives zeros; `ga4_property_id` null on all 3 workspaces; 0 `performed_well`. Re-aim consumer unbuilt. | Building |
| **IH4** | **You solo-maintain a multi-tenant SaaS to serve one practice.** Onboarding wizard, 3-tier billing, per-tenant creds, tenant-isolation, self-serve — pure carrying cost, zero in-house payoff, all on a bus-factor of one. | A, C | 🔴 | No line drawn between "MB needs this" and "a SaaS needs this." Most actionable item on the board: freeze/delete → reclaim hours immediately. | Open |
| **IH5** | **Buy-vs-build never run on the whole.** Castmagic/Descript/Opus/agency deliver ~80–100% for a fraction of Q's time; only the real-voice library is unbuyable. The in-house-optimal architecture may be "keep the core, rent everything downstream." | B | 🟡 | Buy-before-build is a *stated global rule* applied per-feature (e.g. "don't build Remotion") but never to Bernard-as-a-whole. | Open |
| **IH6** | **Bus-factor of one on the practice's entire content pipeline.** If Q is out (vacation/sick/slammed) or a dependency breaks, MB has *no* pipeline — and the old manual habit was retired when this replaced it. | A | 🟡 | No stated fallback, no runbook, no second maintainer, no "manual mode." Unpriced. | Open |
| **IH7** | **The interview is friction for non-Q staff** — the lever between "Q-tool" and "practice-tool." A busy staffer may never do the deep capture. | A, D | 🟡 | Interview *depth* treated as pure asset (priority-one, correctly, for the library). The friction side, *for other people*, is unexamined. No lite-capture. | Open |
| **IH8** | **Publish is still the real bottleneck, not generation.** review→aim→schedule→publish is where a non-Q staffer stalls, and it partly lives in Buffer. | A, C | 🟡 | Media→content join named as THE bottleneck; pipeline UX redesign shipped; the publish *moment's* friction remains, partly owned by Buffer. | Aware |
| **IH9** | **Surface proliferation has no external forcing function — *ever*.** 9 surfaces, 4 editors. In-house there will never be external-user pressure to prune; only Q's discipline + staff friction can. | C | 🟡 | 9→5 consolidation planned, mockup-first. But the SaaS doc's "external users will force prioritization" cure *never arrives* — the root is structurally permanent in-house. | Building |
| **IH10** | **"Build a SaaS" may be the unstated real project.** A revenue roadmap (Jul 1 2026) + billing + onboarding contradict the pure-in-house premise. Until you pick "selling it" vs "not," resourcing is incoherent — an in-house tool carrying a startup's tax. | C | 🟡 | The roadmap exists on paper; the decision is unmade. **This is the fork the whole doc hinges on** (see §5 (a) vs (b)). | Open |
| **IH11** | **No measure of practice impact, per brand.** Volume is proven; new-patient bookings / "how'd you hear" / event turnout for People, Equine, Animals are unmeasured. Even one intake question would help. | A, C | 🟡 | Outcome loop dark (overlaps IH3); the *measurement-at-the-clinic* angle specifically isn't wired — no intake "how'd you hear about us?" tied back. | Open |
| **IH12** | **Equine & Animals are more Q-dependent than People.** Two of three brands' capture rides almost entirely on Q. | A, D | 🟢 | **Measured 2026-06-04:** Animals = **0 of 5** sessions non-Q-operated (100% Q — confirmed). Equine = its **single** session was Whitney's (softened). People holds the real multi-staff usage (**7 of 13** non-Q-operated). | Aware |

**Shape of the board (updated 2026-06-04, after running D0):** the audit shipped with four 🔴s reducing to one thing — *you can't see either side of the ledger* (the **cost** side = your time; the **justification** side = adoption + outcome). **D0 measured the adoption half, and it came back reassuring** — IH1 dropped 🔴 → 🟡 (four non-Q clinicians genuinely use it; the kill-threshold wasn't triggered). That leaves the red cluster as **IH2 (your time), IH3 (outcome), IH4 (SaaS overhead) — all *cost-and-return*, all still unmeasured.** The board moved exactly as the instrument intended: adoption now has a number; **what the tool costs you, and what it returns in patients, still have none.** The in-house red cluster was never "no external pull has tested the build" (that's the SaaS framing) — it's **"no ledger has been kept on a tool whose only customer is your own time,"** and D0 just wrote the first line of that ledger. **If you act on one thing next: probe a *cost-or-return* question** — either run **D1** (watch a non-Q staffer cold, to test *habit vs. novelty*, since all non-Q use is <30 days old) or stand up a single **outcome** number (IH3/IH11: one GA4 property + one intake "how'd you hear about us?"). The free move is spent; the next one costs a little and answers the half that actually decides whether this is worth your time.

---

## 8. Drift log

*Empty — this is pass 1 of the in-house twin. On each re-run, record what moved: which IHs changed status, which closed, which new ones appeared, and — the question that matters most here — **is the red cluster (cost + justification unmeasured) shrinking?** Specifically: did D0 ever get run? Did a patient-impact number ever appear? Did the SaaS-vs-in-house fork (IH10) get decided? Don't overwrite — append, so the drift is visible.*

| Date | What changed since last pass |
|---|---|
| 2026-06-03 | Baseline established (IH1–IH12). Twin of the SaaS audit's B1–B12; §2b maps the lineage. Headline red = IH1 (Q ≠ Move Better), answerable today via D0. |
| 2026-06-04 | **D0 run against prod (Supabase REST, read-only).** IH1 🔴 → 🟡 (`Open` → `Aware`): 4 non-Q clinicians (Whitney / Sophie / Cullen / Tyler) ran their own captures — 8 sessions in 30d, 0 unknown-operator; ≥4 published pieces from non-Q-operated sessions; Philip/Cullen/Whitney also approve. **Pre-committed kill-threshold NOT triggered — not a Q-only tool.** IH12 🟢 `Open` → `Aware`: Animals 100% Q-operated (0/5), Equine softened (Whitney ran its single session), People holds the multi-staff usage (7/13). **Red cluster shrank 4 → 3 (IH2/IH3/IH4): adoption side now measured; cost + outcome still dark.** Residual IH1 reframed from *cold adoption* → *retention* (all non-Q use <30d old = onboarding wave, not yet a habit). Next: re-run D0 ~2026-07-04 to see if non-Q usage holds; or probe a cost/return number (D1, or one GA4 outcome metric). |

---

## 9. How to re-run this (so it stays a waypoint)

1. **Refresh the reference (§1)** — did the product or the *practice* change? New staffer on the roster? A brand added/dropped? A maintenance crisis? Update the snapshot.
2. **Re-walk the four lenses (§§3–6)** — ask me to re-run A–C against the current state; **you run D, and D0 is free — run the query first.**
3. **Append a new dated register block (§7)** — don't overwrite. Carry forward open IHs, add new ones, update statuses.
4. **Fill the drift log (§8)** — the one question that matters: *is the cost-and-justification red cluster shrinking — i.e., do you now have a staff-usage number and a patient-impact number you didn't have last time?*
5. **Pick exactly one action** — a waypoint that produces 12 to-dos produces zero. One per pass. Pass 1's action (D0) is done; pass 2's natural action is a *cost-or-return* probe — D1 (retention) or one outcome metric (IH3/IH11).

**Automated D0 re-run (installed 2026-06-04).** A `launchd` one-shot — `~/Library/LaunchAgents/co.movebetter.bernard.d0-rerun.plist` — fires `.claude/d0-rerun.mjs --notify --once` on **2026-07-04 at 9:00am**, writes `.claude/d0-rerun-result-2026-07-04.md` plus a desktop notification carrying the held/softened/decayed verdict and a ready-to-paste §8 drift row, then self-disables via the sentinel `.claude/.d0-rerun.once-done`. The script is read-only against prod and is the generator-of-record for the D0 numbers here.
- **Run on demand anytime:** `node ".claude/d0-rerun.mjs"` (from the project root).
- **Re-arm for another month:** delete `.claude/.d0-rerun.once-done`.
- **Remove entirely:** `launchctl bootout gui/$(id -u)/co.movebetter.bernard.d0-rerun && rm ~/Library/LaunchAgents/co.movebetter.bernard.d0-rerun.plist`

> **A note to Q — react here, and tell me where I'm wrong.** This doc is markup-ready: scribble on it. But weight it honestly. **Lenses A, B, and C are *me* reasoning from your own docs — they share your blindspots, because I also only know Move Better through your words.** I genuinely do not know whether Whitney has ever published from the road, whether AJ has touched the tool unprompted, or whether a single new-patient booking traces to a post this thing made — and I refused to invent any of it. **Only Lens D is ground truth**, and in-house its first move costs you nothing but a query. So the most useful thing you can do with this is not agree with it — it's to tell me which of A–C I got wrong *because I'm missing what you can see from inside the practice*, then go run D0 and let the data correct both of us. The whole doc is a frame for one number you can pull this afternoon: **how many people who aren't you actually use the thing.**

> If this twin and its SaaS sibling both prove useful, the natural next step is a `/blindspot` skill that runs *either* lens (`--saas` / `--inhouse`), auto-appends a dated register, and diffs the last pass. Not yet — let's prove the pair earns its place first.
