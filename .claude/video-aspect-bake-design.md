# Per-aspect video bakes — design note

**Status:** investigated 2026-07-29, grounded in the render code (not assumption).
**Gate for:** the mixed-carousel editor UI (phase 2 of the explicit-format sprint).
**Question it answers:** when a 9:16 clip with burned-in karaoke captions goes into
a 4:5 carousel slot, what actually gets published — and where does that artifact live?

## TL;DR

**Don't build a new render pipeline. Wire the one that exists.** Bernard already
renders any registered aspect, already positions captions relatively (so they
re-place themselves correctly at a new aspect), already stores a complete replayable
edit recipe, and already loops a single render call over multiple output channels.
What's missing is the *caller* asking for more than one aspect, and a place to put
the second output. `autoFitImage` (the letterbox shipped in the publish floor)
becomes the fallback for media with no recipe, not the answer for Bernard's own clips.

## What's already built

| Capability | Where | State |
|---|---|---|
| Arbitrary output aspect | `brandRenderVideo.js:601-620`, specs from `postFrames.js:19-25` (`FRAME_PIXELS` has 4:5, 9:16, 1:1, 16:9, 4:3) | **Done** — driven by a registered channel key, not hardcoded |
| A 4:5 video channel | `facebook_video` → `{platform:'facebook', format:'post'}` → 4:5 (`postFrames.js:31,97`) | **Already exists** |
| Aspect-relative captions | `karaokeCaptions.js:155-222` — fontSize from `min(w,h)`, `marginV = height*0.14`, `marginLR = width*0.08`, ASS `PlayResX/Y`, alignment-based | **Done** — no absolute pixels; re-places by construction |
| Aspect-relative overlays | `videoOverlays.js:197-205` — `cx = x*width`, `cy = y*height`, x/y stored 0..1 | **Done** |
| Complete replayable recipe | `media_assets.video_edit_draft` = `{format, grade, reframe, kenBurns, overlays, speed, caption, startSec, endSec, cuts, music, captionLines, wordEdits}` (`VideoEditor.jsx:1219-1222`) | **Done** — `reframe{zoom,x,y}` is fractional, replays at any W×H |
| Multi-channel render in one call | `renderClipCore.js:219` loops `channels: string[]`, one `renderVideoChannel` per channel, same recipe | **Done** — `rerender-package.js` is live precedent |
| Master/variant family | `parent_id` + `variant_label`; `getAssetFamily()` (`mediaLib.js:145`); `MediaDetail.jsx:791` renders variants collapsed under the master; `?sources=true` hides children (`media/list.js:115`) | **Done** |

## What's actually missing

1. **The caller only ever asks for one aspect.** `VideoEditor.jsx:1590` hardcodes
   `channels: [(FORMATS[format]||FORMATS.reel).channel]`. Passing two channel keys
   produces two outputs from one edit doc, today, with no render-core change.
2. **A global caption-position override defeats per-aspect defaults.** Each channel
   carries its own `spec.captionPos`, but `brandRenderVideo.js:492` resolves
   `overlayPosition ?? spec.captionPos` and the client *always* sends
   `overlayPosition` (`VideoEditor.jsx:1590`), so one position is forced onto every
   channel in the call. Fix: omit it for secondary aspects (falls back to that
   channel's own default) or make it per-channel.
3. **Nowhere to put the second output.** Nothing today persists "this clip, at 4:5."
4. **Nothing resolves a variant at publish time.** A carousel slot holding a video
   has no notion of "prefer the 4:5 bake of this asset."

## Storage: variants under the master (recommended)

Q's constraint: *"I don't want each media upload to be saved as different formats
just to get 4:5 sometimes and 9:16 others."* The family model already satisfies this —
variants nest under a master and the library lists masters only.

- **Recommended — `parent_id` + `variant_label: '4:5'` child row.** Reuses the
  existing family model wholesale: MediaDetail already renders variants collapsed
  under the master, list views already filter children out. Rendered **once** and
  reused by every piece that needs that clip at 4:5 (a bake is deterministic given
  source + recipe + aspect, so caching it is free correctness). The library still
  shows one tile per upload.
- Rejected — bake onto `content_items.media_urls` per piece (the baked-carousel-slide
  pattern). Simpler, but re-renders ~60s of compute every time the same clip is
  reused, and the artifact is invisible outside the one piece.
- Rejected — first-class sibling library rows. Exactly the clutter Q ruled out.

## Timing: bake at format-choice, not publish

~60s per channel (`rerender-package.js:22`), 300s function ceiling
(`render-clip.js:36`), per-clip cap `MAX_RENDER_SECONDS=60` (`brandRenderVideo.js:149`).
Two aspects in one call fits comfortably inside 300s. Baking when the producer picks
the format (rather than at approve) means the editor and the approval queue both show
the *real* artifact — consistent with "a preview is not the published artifact."
Worth one real-clip timing check before trusting 3+ aspects in a single interactive call.

## MEASURED: a per-aspect reframe is REQUIRED, not a nice-to-have

Verified by actually baking a real clinic clip both ways and looking at the frames
(local harness, 2026-07-29 — `renderVideoChannel` needs no API key, per the
pure-render-verifies-locally rule). The mechanical part works: 9:16 → 1080×1920,
4:5 → 1080×1350 (aspect exactly 0.800, right at Instagram's floor), captions
re-place proportionally, ~5s per render. But the *default* output is defective:

| Variant | Result |
|---|---|
| 9:16 reel, captionPos top | Clean — caption sits well clear above the subject |
| **4:5, captionPos top (the default)** | **Karaoke caption lands ON the subject's face** |
| 4:5, captionPos bottom | **Worse** — karaoke collides with the brand band, unreadable overlap |
| 4:5, top + `reframe {zoom:1, x:0.5, y:0.68}` | **Clean** — subject clear of the caption |

**Why it is general, not one unlucky clip:** a centre crop 1920 → 1350 removes 285px
off the top, so the subject rises proportionally in frame (head 26% → 16% of height)
while `marginV` stays a fixed `height * 0.14`. The two converge by construction. Any
clip whose subject sits in the upper half will collide.

**Consequences for the build:**
1. The 4:5 bake needs **its own `reframe`**, which cannot be mechanically derived from
   the 9:16 one — replaying the reel's reframe is exactly what produces the collision.
   So `video_edit_draft` needs per-aspect reframe (or the bake needs an explicit
   reframe argument per channel).
2. Phase 2's UI is therefore **not** just "also bake at 4:5" — it must let the human
   see and adjust the 4:5 crop. That is a real editing step, and the mockup must show it.
3. `captionPos: 'bottom'` is not an escape hatch for 4:5 — it fails differently.
   Both the brand band and the karaoke captions follow `overlayPosition`, so sending
   them to the same edge stacks them on top of each other.

A sensible default to test next: nudge `reframe.y` downward for 4:5 when captions are
top-positioned, then let the human correct it. Do NOT ship the naive replay.

## Build order

1. Register/confirm a carousel 4:5 video channel; per-channel caption position.
2. `VideoEditor` requests primary + secondary aspects in one render call.
3. Persist the secondary output as a `parent_id`/`variant_label` variant.
4. Publish-time resolution: a video in a 4:5 carousel slot prefers its 4:5 variant;
   falls back to `autoFitImage` when no variant exists (raw uploads, un-recipe'd media).
