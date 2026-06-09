# Bernard — Current-State Map (how it ACTUALLY works today)

**Built:** 2026-06-02 from the real code, not a redesign. **Status:** for Q to correct BEFORE any mockup.
**Why this exists:** two greenfield "Studio" mockups reinvented logic the app already ships, worse. This maps reality first. Correct anything wrong and I build targeted fixes against *this*, framed as labelled diffs.

---

## The content model (the part I kept getting wrong)

An **interview** → a **Content Plan**, which is:

- **1 Keystone** = the **long-form blog**. The *source piece*. Everything else derives from it. (`useKeystoneBlog`, `KeystoneHeroCard` — "Feeds the posts below.")
- **N atoms** = one per **channel-post**, grouped by platform, spread over **4 weekly slots**. Each atom has its own **angle_label + angle_description + words**. So **4 Instagram posts = 4 atoms with different angles and different words** — already true today. (`atomPlan.js`, `ATOM_DEFINITIONS`, `ContentPlanPanel`.)

**This directly matches your truths:**
- *"Clinicians really just approve the Blog — top-tier truth"* → that **is the Keystone**. The blog is the source; social derives from it.
- *"4 Instagram posts need different words"* → **atoms already are per-post, per-angle**. My "channels = checkbox" was flat-out wrong; the real model is per-channel atoms.
- *"Channels need different length/visual/message"* → handled per-platform (`outputChannels.js` defines instagram_post / instagram_reel / facebook_post / linkedin_post …; `platformMediaKind.js` enforces each channel's media kind).

**Atom/piece lifecycle (the canonical stages, #1147):**
`pending → Draft this (AI generates) → drafted → Approved · "add media" → Scheduled → Published`

The **"Approved · add media"** badge IS the clinician→publisher handoff seam — it already exists in `ContentPlanPanel` / `AtomRow`.

**Per-story channel control (#1086):** a **"Channels in this plan"** toggle bar at the top of the plan — toggle a channel off, its posts leave the plan (published ones stay), toggle back on to restore. Not a checkbox in a rail — a real, shipped control.

---

## The surfaces (real)

| Surface | Route | What it actually is |
|---|---|---|
| **Create** (+ button) | `/new` = `CapturePicker` | **Already the capture hub.** Orange **+ Create** at top of sidebar AND in header → picker of: Interview · Voice memo · Handout · Live interview (phone) · Import URL. The "+ Create that works" you mentioned = this. |
| **Stories** (Words) | `/stories` | The **clinician/words** surface. Lists interviews/stories; detail = `ContentPlanPanel` (keystone + atoms + channel toggles). Quick filters: All / Draft / Ready to Distribute / Published / Mine. **"Edit words"** lives here. |
| **Storyboard** (Media·Publish) | `/storyboard` → `StoryboardPiece` → `/publish` | The **publisher/media** surface. Lists pieces that **need media** + **ready to distribute**. Per piece: attach media (platform-aware kind), **"Edit words"** (jumps back to Stories editor), then `/publish`. |
| **Library** | `/library` = `MediaHub` | Media pool — collections, search, filters, multi-select, Drive import. |
| **Slate** | `/slate` | Clip workshop → As-a-post (→ Storyboard draft) / As-b-roll (→ Library). |
| **Book / Write / Pre-Visit** | `/book` `/write` `/pre-visit` | Separate surfaces. Write = freeform long-form (low expected use). |
| **Overview** | `/overview` | Clinic kanban, canonical stages, editor-gated. |
| **Home** | `/` | Personal dashboard. |

---

## Roles (real — TWO axes, and a naming thing to settle)

**Legacy role** (`roles.js`, stored in Clerk):
- **admin** — owner; configures Bernard (voice, members, brand, billing).
- **clinician** — voices interviews, **approves drafts for voice fidelity. Owns the words.**
- **publisher** — **attaches media from Library, schedules, publishes. Owns distribution.** (`editor` = legacy alias.)

**Phase-4 tier** (independent axis): owner / **producer** (operational editor, Slate-focused nav) / clinician / viewer.

⚠️ **Naming to settle:** you said "producer" for the media-and-send person. The code calls that **role** `publisher`; `producer` is currently a *tier* (Slate-focused operational editor). Same spirit, two different tokens. **Which name do you want to be canonical?**

---

## So what's actually left to fix (targeted, not a rebuild)

The architecture is right. The likely real gaps — for you to confirm/reorder:

1. **Legibility of the keystone→atoms story.** The model is powerful but may not *read* as "your job = approve the blog; the social derives + gets light per-channel tuning." A clinician might not see that.
2. **Audience-aim massaging** — the social atoms pull from the interview, but tuning them *for audience aim* (your outcome-loop wedge) isn't an explicit step yet. This is the one genuinely-new thing, not a re-skin.
3. **Role seam clarity** — clinician (words) vs publisher/producer (media+send) and the "Approved · add media" handoff could be louder/clearer.
4. **Create hub** — add **Write** as an option under Create (you asked); it's currently only reachable from the Tools nav.
5. **Naming** — producer vs publisher (above).

---

## Open questions for Q (correct me here)

- [ ] Is the **keystone = the blog you approve** mapping right, or do you think of "the blog" as something separate from the plan's keystone?
- [ ] For social atoms — is the desired flow *clinician approves words → publisher massages for aim + attaches media*, or does the clinician do the aim-massaging too?
- [ ] **Producer or Publisher** as the canonical name for the media-and-send role?
- [ ] Which of the 5 gaps above is the one worth fixing first?
- [ ] Anything in this map that's just *wrong* about how you think the product works?
