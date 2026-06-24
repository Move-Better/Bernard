# Unified editor shell — architecture plan (for Q sign-off)

**Status:** PLAN — awaiting Q sign-off before any code.
**Origin:** Q asked "all media should go to the same editor, same visual landing page, but the left bar adapts to the kind of post + media." Then: research how other companies handle the split → plan the merged shell carefully → ship Story into the existing shell as step 1.

Related: [[project-unified-editor]] (carousel editor, FEATURE COMPLETE), `unified-editor-plan.md` (U1–U5 log). This plan is the U4/U5 "one shell for every format" layer, now research-backed.

---

## 1. What the research settled

Two product families split editors on different axes:
- **Creation tools** (Canva, Adobe Express, CapCut) split by **media type/format**, edit heavily.
- **Publishing tools** (Buffer, Later, Metricool, Hootsuite, Sprout) split by **output channel**, edit lightly (crop-to-network).

Bernard is a publishing tool with creation-grade editors, so the creation family is the precedent.

**Dominant pattern (Canva + Adobe Express, identical):**
- ONE editor. The post type only sets **canvas dimensions**; the editor is otherwise the same.
- The **inspector adapts to the SELECTED ELEMENT**, not the document (Figma/Framer: stable chrome + persistent common-base props + property *sections* that swap by layer type).
- **Video is NOT folded into the layer canvas.** It appears as a **bottom timeline that materializes only when there's timed media.** Static composition never lives in a timeline.
- CapCut — the most video-native — kept static graphics in a *separate* poster surface rather than forcing them into the timeline.

**Biggest merge risk: mode confusion.** Layer gestures (drag=move in space, handles=resize) and timeline gestures (drag=move in time, handles=trim) are the same physical interactions on different axes. An always-on hybrid breaks muscle memory. The successful tools survive only by keeping the timeline a **disclosed lens**, not always-on.

**Recommendation: shared chrome wrapping two surfaces — NOT one fused surface.**

---

## 2. The model for Bernard

```
┌──────────────────────────────────────────────────────────────┐
│ TOP CHROME (persistent, never moves)                          │
│  back · title · FORMAT/POST-TYPE switch · aspect · Preview ·  │
│  Save · Export/Schedule                                       │
├──────┬──────────────┬─────────────────────────┬──────────────┤
│ ICON │  INSPECTOR    │        CANVAS           │   SURFACE     │
│ RAIL │  (contextual  │   (the artifact, big)   │  (disclosed) │
│      │   by selected │                         │              │
│ Words│   element +   │                         │  Carousel →  │
│ Media│   post type)  │                         │  SLIDE RAIL  │
│ Text │               │                         │              │
│ Grade│               │                         │  Video →     │
│ ...  │               │                         │  TIMELINE    │
└──────┴──────────────┴─────────────────────────┴──────────────┘
```

**Three adaptive keys (this resolves Q's Q3 uncertainty):**

| Key | Drives | Example |
|---|---|---|
| **Post type** (carousel / story / reel / single / blog / GBP / text) | which **SURFACE** mounts + which icon-rail sections exist + aspect default | reel ⇒ timeline; carousel ⇒ slide rail; story+photo ⇒ neither |
| **Media type** of the active layer (photo / video / none) | which **inspector tools** within a section | photo ⇒ crop/grade/colorist; video ⇒ trim/captions/speed/grade |
| **Selected element** (slide / photo / text block / overlay / clip) | which **inspector property sections** show (Figma model) | text block ⇒ size/colour/weight; clip ⇒ trim |

So the rail is **post-type + media-type driven** (Q's instinct, option 1 — correct), wrapped in chrome that never moves.

**The disclosed surface (the load-bearing decision):**
- Carousel/multi-photo ⇒ **slide rail** (today's `SlideRail`).
- Reel/clip/story-with-video ⇒ **timeline** (today's `VerticalTimeline`).
- Single photo / story-with-photo / text-only ⇒ **no side surface** (just canvas + inspector).
- The surface is mounted by post-type, with a hard visual mode-shift. Carousels never get a timeline; clips never get a slide rail. This is what avoids the mode-confusion tax.

**Persistent common base (the "feels like one tool" glue):** brand color, aspect, save state, format switch, and a shared selection model live in the chrome and are identical across every post type. This is the single most important thing preventing "two editors bolted together."

---

## 3. Current code → target (convergence, not rebuild)

Both shells are already `rail │ inspector │ canvas`. The merge extracts the shared chrome and makes the side surface swappable.

| Concern | VideoEditor today | SlideEditor today | Merged shell |
|---|---|---|---|
| Top chrome | inside left inspector | real `<header>` top bar | **shared `<EditorChrome>`** (back/title/format/aspect/preview/save/export) |
| Mode switch | `IconRail` (moments/clip/grade/caption/overlays) | accordion layers | **`IconRail`** sections, filtered by post+media type |
| Inspector | `sel`-switched panels (272px) | accordion `selection`-switched (280px) | **shared inspector frame**, panels registered per element type |
| Canvas | `<Canvas>` video player | slide `<canvas>` | **`<EditorCanvas>`** renders video OR slide by post type |
| Side surface | `<VerticalTimeline>` | `<SlideRail>` | **`<EditorSurface>`** = timeline OR slide rail OR none |
| Save/publish | export dropdown (post/broll/ad) | Schedule dialog + ApprovalPanel | **shared `<PublishBar>`** (channels + schedule + ad export) |

Net new infra: `EditorShell` (layout + selection context), `EditorChrome`, `EditorSurface` (mount switch), a panel registry. The actual editing components (ClipInspector, SlideInspector, PhotoInspector, GradeInspector, CaptionInspector) move in mostly as-is.

---

## 4. Every channel collapses into ~9 editing archetypes

The unification insight (mockup `mockups/unified-shell-all-channels.html`): the ~20 channels Bernard could offer are NOT 20 editors. They map onto **9 editing archetypes**. The shell adapts to the **archetype** (= post type + media). The **channel** only changes four things: the format badge, the aspect default, the caption/char rules, and the publish/export action. That's the whole reason one shell scales to every channel.

### The 9 archetypes (each = one surface + rail + canvas)

| Archetype | Side surface | Canvas | Icon-rail | Aspect | Publish |
|---|---|---|---|---|---|
| **Carousel** | Slide rail | visual | Words · Slide · Photo · Text · Grade | 1:1 / 4:5 | Schedule |
| **Single visual** | none | visual | Words · Media · Text · Grade | 1:1 / 4:5 / 16:9 | Schedule |
| **Story frame** | none | visual | Media · Overlay text · Link sticker | 9:16 | Schedule |
| **Story · video** | Timeline | visual | Media · Trim · Captions · Overlay · Link · Grade | 9:16 | Schedule |
| **Vertical video** | Timeline | visual | Media · Trim · Captions · Overlay · Grade | 9:16 | Export |
| **Landscape video** | Timeline | visual | Media · Trim · Captions · Overlay · Grade | 16:9 / 1:1 | Export |
| **Long-form doc** | none | document | Body · Media · SEO | — | Publish |
| **Rich email** | none | email | Blocks · Headline · Media | — | Send |
| **Ad creative** | Size variants | visual | Words · Media · Text · Sizes | 1:1 / 4:5 / 9:16 / 16:9 | Export |

### Channel → archetype map (all channels, not just Move Better's enabled set)

| Archetype | Channels that use it |
|---|---|
| Carousel | IG carousel, FB carousel, LinkedIn multi-image, Pinterest Idea Pin |
| Single visual | FB post, LinkedIn post, X/Twitter, Threads, Bluesky, Mastodon, Pinterest Pin, Reddit, **GBP**, Discord, Slack, IG single post |
| Story frame | IG Story (photo), FB Story |
| Story · video | IG Story (video), FB Story (video) |
| Vertical video | IG Reel, FB Reel, TikTok, YouTube Short |
| Landscape video | YouTube (long-form), LinkedIn video |
| Long-form doc | Blog post, Landing page, LinkedIn article |
| Rich email | Newsletter |
| Ad creative | Google Ads, Meta/IG Ads |

So adding a *new channel* is almost always free: pick its archetype, give it a badge + aspect default + publish action. Only a genuinely new *editing model* (e.g. a future interactive/poll format) needs a new archetype. **Story is just two rows (frame + video) on an existing archetype** — which is why "Story into the existing shell" is genuinely step 1, not throwaway.

### Media tier — every channel can attach media EXCEPT Google search ads

A channel's media support is a third axis the shell must respect (it gates publish + drives the canvas empty-state):

| Tier | Channels | Shell behavior |
|---|---|---|
| **required** | IG (post/story/reel), Pinterest, TikTok, YouTube, YouTube Short, Meta Ads | "Needs media" gate blocks publish until attached (today's behavior) |
| **optional** | Facebook, LinkedIn, X, Threads, Bluesky, Mastodon, Reddit, GBP, Discord, Slack, + doc/email heroes | Canvas shows a **valid text-only state** (text-post card) with media one click away — NOT a "needs media" block. Text-only is a finished post. |
| **none** (text-only) | **Google Ads (search)** — the `textad` archetype | No Media rail section; canvas is a copy-only ad preview |

Implementation note: the "Single visual" archetype renders a **text-post card** (avatar + caption + optional "+ add media") when media is optional and none is attached, and the visual artifact once media is added — a toggle in the editor, driven by `media_urls.length` at runtime. The `textad` archetype has no Media section at all. So the publish gate is `tier === 'required' && media.length === 0`, never a blanket "needs media." (Mockup demonstrates all three tiers + the text-only⇄with-media toggle.)

---

## 5. Phasing (each phase ships + Chrome-verifies independently)

- **Phase 0 — Story into existing shell (ship now, small).** Route `instagram_story` into the editor. Photo-story ⇒ SlideEditor single-slide path (9:16, overlay text + link-sticker inspector, no slide rail). Video-story ⇒ VideoEditor (9:16 format, link-sticker field added). Add `case 'instagram_story'` to `PostPreview`. *No shell refactor yet — proves the matrix on a real type and kills the raw `LINK_STICKER_TEXT:` dump.*
- **Phase 1 — Extract `EditorChrome` + `EditorShell` layout.** Pull the top bar + selection context out of both editors into shared components. Both editors render through it; zero behavior change. Pure refactor, Chrome-verify carousel + reel unchanged.
- **Phase 2 — `EditorSurface` mount switch.** Slide rail vs timeline vs none chosen by post type. VideoEditor + SlideEditor both consume it.
- **Phase 3 — Unified `IconRail` + panel registry.** One rail, sections filtered by the post-type × media-type matrix. Inspector panels registered by element type.
- **Phase 4 — Single entry route.** `/publish/:pieceId` resolves post type → mounts the right surface/rail automatically. Old `/slate/clip/:assetId` editor folds in (asset-backed vs piece-backed unified). Mind the `*` router catch-all.

Phases 1–4 are the real consolidation and can be scheduled later; Phase 0 unblocks Story today.

## 6. Guardrails (carry from unified-editor-plan + CLAUDE.md)
- One render path; every new per-block style field → `slideSignature` or stale bakes ship.
- `media_urls` object shape `[{url,type,kind}]`; `photo_idx` indexes photo-only filtered list.
- Keep `photo_treatment`/`photo_composite_url` in SELECTs; route slide-photo reads through `photoSourceUrl()`.
- Router `*` catch-all; status CHECK constraints; lint 0-warnings; `useAppMutation`/`apiFetch`; workspace scoping on new routes.
- Client-canvas renderers (`renderFreeformSlide`, video `<Canvas>`) ⇒ Chrome-only verify, post-deploy.
