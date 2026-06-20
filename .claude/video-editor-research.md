# Short-Form Video / Reel Editor — Competitive Research

_Generated 2026-06-19 by the video-editor-research workflow (read-only; WebSearch + WebFetch + Bernard source map). This is the competitive basis for the Reel-editor mockup that mirrors the approved photo/carousel editor. No app code was written._

---

## 0. Why this doc exists & what we're mirroring

Bernard has an **approved photo/carousel editor IA** (see `.claude/carousel-editor-redesign-findings.md` and `.claude/video-editor-parity.md`):

- **ONE big scaling canvas** that *is* the live preview (one render path, zero preview-vs-publish drift).
- A **left vertical slide rail** (filmstrip navigator).
- **Direct layer selection** on the canvas (click the photo / a text block / the slide).
- A **contextual RIGHT inspector** that becomes the selected layer's editor:
  - photo layer → **AI Photo Editor / Colorist** (vibe chips + Brightness / Warmth / Contrast / Vibrance / Depth sliders + "describe the vibe").
  - text layer → text controls.
  - slide layer → layout / theme.

The owner's four hard requirements for the video editor:

1. **Auto-captions that follow the spoken audio** (word/phrase-synced, burned in).
2. **Manual text overlays** independent of speech (title card, lower-third, callout).
3. **The same AI visual editor** (the colorist grade) applied to video frames.
4. **Good bones, not a full CapCut suite** — minimal but credible.

The single most important pre-existing fact: **Bernard already ships most of the video plumbing.** It is not greenfield. See §6 ("What Bernard already has") — `api/_lib/karaokeCaptions.js` already turns Whisper word-timestamps into animated karaoke captions; `api/_lib/brandRenderVideo.js` already runs the ffmpeg crop+overlay+caption pipeline per channel; `SlateClipEditor.jsx` already has a trim bar, a WYSIWYG caption-band preview, and position/size controls. The video editor is a **re-skin + re-IA of capabilities that already exist**, plus a time axis for overlays and the colorist grade.

---

## 1. Competitor teardown

For each: how auto-captions work, the manual-text/overlay model, the timeline/clip UI, the visual grade / AI enhance, and (where relevant) the transcript-as-editor pattern.

### 1.1 CapCut — the "full suite" reference (what we explicitly do NOT need to match)

- **Auto-captions:** Speech-recognition AI scans the audio track and generates timed subtitle text synced to each spoken word, laid out as editable text blocks within seconds; 35+ languages. ([CapCut caption generators](https://www.capcut.com/resource/caption-generators), [SocialRevver](https://www.socialrevver.com/blog/capcut-auto-captions))
- **Editing model:** Word-level. "Click and edit any word in the generated text, and the corresponding timing on the video timeline automatically updates." ([CapCut](https://www.capcut.com/resource/caption-generators)) The v20 "Animated Subtitle" toolkit adds **karaoke highlights, pop-ons, fades, and typewriter** effects. A **Templates** library (karaoke highlight, pop-by-word, bounce, typewriter, "TikTok classic") applies a style to the whole caption track in one click. ([Pixflow](https://pixflow.net/blog/ai-automatic-captions-subtitles/))
- **Caption-as-layer / styling:** Select the subtitle track → **Inspector → Style** tab → font, size, color, background, outline, drop-shadow, position; an **Animations** tab for the per-word motion. ([CapCut help](https://www.capcut.com/help/editing-not-match-displayed), [TechBloat](https://www.techbloat.com/how-to-change-opacity-in-capcut-pc-full-guide-2.html))
- **Manual text / titles:** Standard text layers with the same Inspector (scale, position, rotation, color, opacity, animation in/out).
- **Timeline / layout:** Canonical 4-pane desktop NLE — **top-left assets panel**, **center preview window**, **bottom multi-track timeline** (video/audio/text/effects layered chronologically), **right Inspector/Properties** (scale, position, rotation, color, opacity). ([Filmora on CapCut timeline](https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html), [Filmora layout](https://www.createthat.ai/blog/how-to-change-layout-in-capcut))
- **Visual grade / AI enhance:** Full color panel (the Inspector "color" controls) plus filters and an "Auto" adjust — lives in the right Inspector when a clip is selected.
- **Takeaway for Bernard:** CapCut is the *maximal* version of every surface (multi-track, full color wheels, 35+ caption templates). Our job is to lift the **shape** (preview center, timeline bottom, Inspector right, caption-as-styleable-track, word-level timing edit) and ship a deliberately smaller feature set inside it.

### 1.2 Descript — the transcript-as-editor archetype (the pattern to call out)

- **Auto-captions:** Captions come from an **editable transcript**; transcription ~95% accurate. Fix the text once and the **caption timing updates with it**. Styles: **Classic, Clean, Karaoke**, then customize fonts/colors/background boxes/animation. ([Descript captions](https://www.descript.com/captions), [Descript caption generator](https://www.descript.com/tools/video-caption-generator))
- **The defining pattern — edit text to edit video:** "When you change or delete words in the transcript, your video updates instantly." You "delete words, rearrange sentences, or copy-paste clips the same way you'd edit text in a doc." ([Descript](https://www.descript.com/video-editing)) Deleted footage is reversible (strikethrough → restore). ([Riverside guide](https://riverside.com/blog/how-to-edit-video-with-text))
- **Manual text / overlays / layers:** "Scenes and layouts" — add **title cards, brand watermarks, lower-thirds overlays, rolling credits**. You "use the transcript to manage edits, generate captions, highlight areas for text overlays, or build title scenes." ([Descript video-editing](https://www.descript.com/video-editing))
- **Layout:** **Transcript/script panel is the primary editing surface** (doc-like), with a video preview and a thin scene/timeline strip; properties for a selected element appear in a side panel. (Marketing pages obscure exact geometry, but the consistent description across sources is: **script on one side, canvas + scenes on the other**.) ([Primal Video tutorial](https://primalvideo.com/guides/edit-videos-by-editing-text-descript-tutorial/))
- **AI enhance:** "Underlord" AI co-editor can tighten cuts, remove silences/filler words, improve audio, add visuals or captions on direction. ([Descript](https://www.descript.com/video-editing))
- **Takeaway for Bernard:** Descript proves the **transcript panel doubles as both the caption editor and the trim tool** — editing a word fixes the caption *and* (if you delete it) the footage. Bernard already has a transcript per clip (`media_assets.transcript_excerpt`, `video_segments.transcript_excerpt`) and Whisper word-timestamps in the render path; a **read-first transcript panel** (edit caption text; optionally delete-to-trim later) is the highest-leverage borrow and a natural fit with our interview-first product.

### 1.3 Opus Clip — AI repurposing + animated captions (our closest "intent" sibling)

- **Auto-captions:** Auto-added at **>97% accuracy**, 20+ languages, **auto-synced to the video's pacing and tone**. ([OpusClip captions](https://www.opus.pro/captions), [Skywork review](https://skywork.ai/blog/opusclip-review-2025-ai-video-clipping-social-repurposing/))
- **Animated captions:** Dynamic captions with **animated emojis and highlighted keywords**, added automatically — explicitly because most social video plays muted. ([Fritz AI review](https://fritz.ai/opusclip-ai-review/))
- **Editing model:** Text-based — "change text and edit it freely … the same way you edit a document"; customize fonts/colors/animation styles to match brand. (Word-vs-phrase granularity not documented on the marketing page.) ([OpusClip captions](https://www.opus.pro/captions))
- **AI Reframe:** Tracks the moving subject (speaker walking, ball in sport) to keep focus centered; one-click 9:16 / 1:1 / 16:9. ([OpusClip reframe](https://www.opus.pro/ai-reframe))
- **The pipeline (relevant to Bernard's Slate):** GPT-class model analyzes the long video against platform trends → segments into chapters → finds "gold nugget" hooks → auto-reframes → animated captions → optional B-roll. ([Skywork](https://skywork.ai/blog/opusclip-review-2025-ai-video-clipping-social-repurposing/))
- **Takeaway for Bernard:** This is **exactly what Bernard's ClipFinder/Slate does** (find standalone moments, hook, transcript excerpt, 9:16 render with burned captions). Opus is the model for the **upstream "find the clip" step**; our editor is the **downstream "compose + caption + grade + reframe the chosen clip"** step. Don't rebuild Opus — feed from it (the `video_segments` proposals already populate `SlateClipEditor`).

### 1.4 Submagic — caption-first, text-based, template-heavy

- **Auto-captions:** Beautiful animated captions in **48 languages**, instant; premium = unlimited dynamic/animated. **35+ animation templates** that highlight, bounce, fade **word-by-word** in sync. ([Submagic](https://www.submagic.co/), [PostUnreel](https://postunreel.com/blog/submagic-review-ai-caption-tool), [Max-Productive](https://max-productive.ai/ai-tools/submagic/))
- **Editing model — text-based, no traditional timeline:** "Replaces traditional timelines with text-based editing where you can cut, trim, and remove silences by editing the transcript instead of scrubbing through footage." ([Submagic review](https://www.bytecap.io/alternatives/submagic))
- **Layout:** Minimal — **left sidebar** (uploads, subtitles, edits) + **main preview area** where changes show instantly; a **Boost panel** to toggle AI features (AI Captions, Remove Silences, Auto Zooms, Auto B-Rolls), swap B-roll, adjust caption positioning, tweak the hook title. ([Submagic review](https://www.toolsforhumans.ai/ai-tools/submagic), [AnixSoftware](https://anixsoftware.com/submagic-ai/))
- **B-roll:** "Magic B-Rolls" auto-inserts contextual stock footage/images/GIFs with transitions while **keeping caption sync**. ([Submagic](https://www.submagic.co/))
- **Takeaway for Bernard:** Submagic is proof that a **caption-first editor with NO heavyweight timeline** is a credible, popular product. For a clinic tool, the **"sidebar + big preview + transcript-driven trim"** model is lighter to build and learn than CapCut's NLE — and it matches Bernard's existing `SlateClipEditor` two-column shape almost exactly.

### 1.5 Veed.io — browser editor with dynamic captions + brand kit

- **Auto-captions:** AI transcribes and timestamps **every word**, up to 99.9% accuracy, 125+ languages; can translate. ([VEED auto-subtitle](https://www.veed.io/tools/auto-subtitle-generator-online), [VEED caption generator](https://www.veed.io/tools/auto-subtitle-generator-online/video-caption-generator))
- **Dynamic captions:** Emphasize key words with special animations/styling/colors; named styles **Handwritten, Whisper, Fusion, Glide, Pulse**. ([VEED dynamic subtitles](https://www.veed.io/tools/auto-subtitle-generator-online/dynamic-subtitles))
- **Manual text overlays:** Drag-and-drop; type text, **extend the clip on the timeline** (sets in/out duration), reposition on the canvas, choose animation presets. ([VEED add text](https://www.veed.io/tools/add-text-to-video))
- **Timeline:** Simple timeline; drag clips to adjust length/timing; AI handles repetitive caption work. ([VEED review](https://www.vidau.ai/veed-io-review-video-editor/))
- **Brand kit:** Set fonts/colors/logos once → apply across every video; subtitles can match the brand kit. ([VEED](https://www.veed.io/learn/best-auto-subtitle-generator))
- **Takeaway for Bernard:** The **brand-kit-applied-to-captions** model is exactly Bernard's case (workspace brand colors → caption accent, already wired in `brandRenderVideo.js` via `resolveBrandColors`). The "type text → extend on timeline → reposition on canvas" loop is the **manual-overlay interaction** to copy verbatim.

### 1.6 Kapwing — transcript-panel caption editor (clean reference for caption editing)

- **Auto-captions:** Auto-generate from audio (most <5-min clips done in 30–60s), then edit the transcript, fix timing, customize design. ([Kapwing subtitles](https://www.kapwing.com/subtitles))
- **Editing model — the two-pane caption editor:** "Manually adjust the timing of each subtitle line by **editing the transcript on the left-hand side of the screen**." Edit individual words, adjust timing per line, control character-limit-per-line, one-click timecode adjustments, easy line breaks to emphasize product names / CTAs. Export hardcoded into the video OR as SRT/VTT/TXT. ([Kapwing editor](https://www.kapwing.com/subtitles/editor), [Tuts+](https://photography.tutsplus.com/tutorials/how-to-generate-captions-kapwing--cms-41601))
- **Takeaway for Bernard:** Kapwing is the cleanest reference for the **caption-transcript panel itself**: left transcript list, each line editable (text + timing + line-break), right/preview shows the styled result. This is the concrete shape for Bernard's transcript/caption panel.

### 1.7 Captions.ai — pivoted from captions to full AI editor (mobile-first)

- **Auto-captions:** High-accuracy transcription synced to the timeline; customize style/color/font/placement; trending styles or custom colors; translate/dub into 30+ languages. ([Captions overview](https://captions.ai/overview), [eesel deep-dive](https://www.eesel.ai/blog/captions-ai))
- **Timeline caption features:** **Word/Phrase View** — tapping a word in the timeline lets you choose **viewing the individual word OR the full phrase** for easier timing edits. **Video Overlay (picture-in-picture)** to import B-roll/reaction clips. ([Captions what's new](https://captions.ai/help/whats-new))
- **AI editor:** Auto-cuts scenes, overlays B-roll, generates AI avatars; "fix inconsistent eye contact," remove background noise. ([eesel](https://www.eesel.ai/blog/captions-ai))
- **Takeaway for Bernard:** The **Word/Phrase toggle** is a smart, low-cost UX primitive: same caption data, two granularities of editing (per-word for precise timing, per-phrase for fast text fixes). Worth adopting since Bernard already stores word-timestamps (per-word) and groups them into lines (per-phrase) in `karaokeCaptions.js` (`groupWordsIntoLines`).

### 1.8 Canva (video) — captions as a first-class timeline layer

- **Auto-captions:** Text panel → **Dynamic text → Captions → Generate captions**; built-in speech-to-text. ([Canva help](https://www.canva.com/help/generate-edit-captions-on-videos/), [Canva auto-caption](https://www.canva.com/features/auto-caption/))
- **Caption-as-layer:** Captions appear as a **dedicated timeline layer** — see exactly where they play; edit text and adjust timing in the timeline **without losing alignment**; **drag the start/end edges of caption segments** to retime. ([Canva manage captions](https://www.canva.com/help/edit-manage-video-captions/))
- **Styling/animation:** 20+ curated **style packs** bundling font+color+animation with accessibility-safe defaults; caption animations + glow that make each word pop as spoken. ([Canva captions guide](https://www.checksub.com/blog/canva-captions-guide))
- **Layout:** Canva's standard editor — **left object/asset panel**, **center canvas**, **bottom timeline (with the caption layer)**, contextual **top toolbar** for the selected element.
- **Takeaway for Bernard:** Canva is the strongest argument for **"caption is a real timeline layer you can select, retime by dragging its edges, and restyle from a style-pack"** — and for **style packs** (a named bundle = font + color + animation) instead of exposing every individual caption property. Bernard's `workspace.brand_style` is already a de-facto single style pack.

### 1.9 Adobe Express (video) — captions via Quick Action + timeline "Open captions"

- **Auto-captions:** A **Caption video Quick Action** (free) auto-creates captions from audio; pick spoken language; edit the caption text box, pick a style, customize color/outline; **drag to reposition anywhere on the canvas**. Separately, in the editor timeline, an **"Open captions" icon** generates captions and shows them along the timeline; adjust font/colors/background/positioning. ([Adobe Express caption help](https://helpx.adobe.com/express/web/video-creation-and-editing/edit-videos/caption-video.html), [Adobe Research content-aware captioning](https://research.adobe.com/news/content-aware-video-captioning-in-adobe-express/))
- **Note (a real gap to learn from):** Multiple community threads note the **main editor and the caption Quick Action were historically separate flows** — you couldn't always caption *and* fully edit in one surface. ([Adobe community](https://community.adobe.com/t5/adobe-express-discussions/can-you-edit-and-add-captions-before-exporting-a-video-in-adobe-express/td-p/14922285))
- **Takeaway for Bernard:** Adobe's split-flow is the **anti-pattern to avoid** — captioning must live *inside* the one editor, not a separate "quick action," or users distrust which surface is canonical (the same preview-vs-publish trap CLAUDE.md warns about). One editor, one render path.

### 1.10 Extras found — Vizard.ai & Riverside Magic Clips (clip-generator siblings)

- **Vizard.ai:** Finds best moments → short clips with auto-captions; auto-reframe for TikTok/Reels/Shorts; ASR subtitles 30+ languages >97%; topic-based clipping. ([Vizard clip maker](https://vizard.ai/tools/clip-maker))
- **Riverside Magic Clips:** Spots key moments → ready clips; **text-based editing** (edit by editing the transcript); 99%-accurate fully-customizable captions; aspect-ratio + branding inside Riverside. ([Riverside Magic Clips](https://riverside.com/magic-clips))
- **Takeaway:** Both reinforce the same two-stage shape Bernard already has: **(1) AI finds/cuts the clip** (Slate/ClipFinder) → **(2) caption + brand + reframe** (the editor). Neither adds a pattern beyond what CapCut/Descript/Canva already establish.

### Cross-competitor summary table

| Tool | Caption granularity | Transcript-as-editor (edit text → edit video) | Caption = selectable layer/track | Manual overlays w/ in/out timing | Timeline model | Color grade / AI look location |
|---|---|---|---|---|---|---|
| **CapCut** | Word-level + templates | Partial (Premiere-class supports it; CapCut edits caption text→retimes) | Yes (subtitle track + Style/Animations tabs) | Yes (text layer, Inspector) | Full multi-track (bottom) | Right Inspector color panel + filters + Auto |
| **Descript** | Word/line, Classic/Clean/Karaoke | **Yes — the archetype** (delete word = delete footage) | Yes (caption layer; scenes) | Yes (title cards, lower-thirds, watermarks) | Script-primary + thin scene strip | Underlord AI; per-element side panel |
| **Opus Clip** | Word/phrase, animated emoji + keyword highlight | Text-based caption edit | Yes (caption styling) | Limited (caption-focused) | Clip-rail / minimal | AI reframe; brand styles |
| **Submagic** | **Word-by-word**, 35+ templates | **Yes** (trim by editing transcript, remove silences) | Yes | Yes (hook title, positioning) | **No traditional timeline** (text-based) | Boost panel (Auto Zoom); B-roll |
| **Veed.io** | Per-word, dynamic styles (Pulse/Glide…) | No (timeline-based) | Yes | **Yes — extend on timeline + reposition** | Simple timeline | Brand kit; filters |
| **Kapwing** | Per-line/word, edit + retime | Caption-transcript edit (not delete-to-trim) | Yes | Yes | Timeline + **left transcript pane** | Filters; design panel |
| **Captions.ai** | **Word/Phrase toggle** | Text-based | Yes | Yes (PiP overlay) | Timeline + word/phrase view | AI editor (eye contact, denoise) |
| **Canva (video)** | Word, 20+ style packs + glow | No | **Yes — drag segment edges to retime** | Yes (animation presets) | **Bottom timeline w/ caption layer** | Top toolbar when clip selected |
| **Adobe Express** | Word/line, styles | No | Yes (timeline "Open captions") | Yes (drag to reposition) | Timeline (+ separate Quick Action) | Filters/adjust; **split flow = anti-pattern** |

**Convergent truths across all 10:**
1. Auto-captions = **ASR transcription → timed text segments**, edited as text, with **timing that follows the text**.
2. The winning caption UX is **word-by-word animated** ("karaoke"), because social plays muted — Bernard already does this (`buildKaraokeAss`).
3. Captions are a **selectable, restyleable layer/track**, retimed by **dragging segment edges** or editing the transcript.
4. Manual overlays are **text layers with in/out points + canvas position + an animation preset** — the same object as a slide text block, plus time.
5. Layout converges on **preview-center, timeline/clip-rail-bottom, contextual-inspector-right** (CapCut/Canva), OR **transcript-left + big-preview** for the lighter caption-first tools (Submagic/Kapwing). Bernard can do **both at once** because the timeline IS the transcript for an interview clip.
6. The grade/look lives in a **contextual inspector tied to selecting the clip** — exactly where Bernard's colorist should sit.

---

## 2. The "transcript-as-editor" pattern (called out specifically, per the brief)

Descript (2017) invented it; Riverside, Submagic, CapCut, Premiere, Vimeo, Captions.ai all now offer a version. ([Riverside](https://riverside.com/blog/how-to-edit-video-with-text))

**Mechanics:**
- **Delete** selected transcript text → the matching footage is removed from the cut.
- **Reorder** (cut/copy/paste sentences) → reorders the corresponding clips.
- **Restore** — deleted text shows as strikethrough and can be un-deleted.
- The transcript **doubles as the caption source**: highlight a segment → add it as a caption; fix a word once → both the spoken-word caption and the cut update.

**Why it matters for Bernard specifically (strong fit, but scope it):**
- Bernard is **interview-first**. Every clip already has a transcript (`transcript_excerpt`) and Whisper word-timestamps. A transcript panel is *free* domain-fit — clinicians think in "what I said," not "frames 1200–1840."
- **BUT** full delete-to-trim (multi-cut, non-contiguous removal, ripple) is a real editor engine (gap management, re-stitching, re-rendering a concatenated MP4). That is **not v1**. Bernard's clips today are a **single contiguous window** (`startSec` → `endSec`, ≤60s).
- **v1 recommendation:** ship the transcript panel as **(a)** the caption editor (edit the words → the burned caption text updates) and **(b)** a **navigator/trim aid** (click a sentence → playhead jumps there; "trim to this sentence" sets in/out). Defer **delete-to-trim / reorder** (the true Descript engine) to a later phase, flagged as an open question (§5). This gives 80% of the felt magic at ~10% of the build.

---

## 3. PART A — Minimal "good bones" feature set (prioritized, mapped to the 4 requirements)

Legend: **[R1]** auto-captions · **[R2]** manual overlays · **[R3]** AI colorist grade · **[R4]** minimal-but-credible.

### MUST-HAVE (v1 — the "good bones")

| # | Feature | Maps to | Why it's the floor | Bernard status |
|---|---|---|---|---|
| M1 | **Auto-captions, word-synced, burned in** — Whisper word-timestamps → animated karaoke caption track (each word fills to brand accent as spoken) | **R1** | The #1 reason short video works muted; every competitor's table-stakes | **DONE** — `buildKaraokeAss` + `transcribeToWords` in `brandRenderVideo.js`; just needs an editor surface |
| M2 | **Caption transcript panel** — see the spoken text as editable lines; fix a misheard word; the burned caption updates | **R1** | The universal caption-edit UX (Kapwing/Descript/Submagic); ASR is never 100% so editing is mandatory | Partial — transcript exists; needs an editable line list + write-back |
| M3 | **Caption style pack** — one named bundle: font + accent color + position (top/center/bottom) + size (S/M/L). Brand-kit-driven defaults | **R1, R4** | Canva/Veed "style pack" beats exposing every property; keeps it minimal | Partial — position/size already in `SlateClipEditor` (`overlayPosition`/`overlaySize`); accent already from brand |
| M4 | **Manual text overlay layer** — add a title card / lower-third / callout: text + canvas position (drag x/y) + role + an in/out time on the timeline | **R2** | The second explicit requirement; same object as a carousel text block + time | New surface; reuses the carousel block model (`overlayTemplates.js`) |
| M5 | **One active canvas = the live preview** (9:16 default, 1:1 / 4:5 / 16:9 parameterized) with safe-zone overlay; renders from the SAME params the MP4 bake consumes | **R2, R3, R4** | The non-negotiable anti-drift rule (CLAUDE.md "preview is not the published artifact") | Partial — `SlateClipEditor` has a WYSIWYG caption band; must extend to overlays + grade |
| M6 | **Bottom clip rail / timeline** — the trimmed clip as a single track with a playhead; trim in/out handles; overlay + caption blocks shown as time-spanning bars under it | **R2, R4** | Where time lives; lets overlays get in/out points; minimal single-track is enough | Partial — `TrimBar` (dual-handle) exists; needs to become a layered rail |
| M7 | **AI Colorist grade on the clip** — the SAME param schema as the photo colorist (Brightness/Warmth/Contrast/Vibrance/Depth + "describe the vibe" + vibe chips), rendered via ffmpeg color filters (`eq`/`curves`/`colorbalance`/`lut3d`) | **R3** | The third explicit requirement; one schema, two emitters (Sharp/ffmpeg) | Schema being built for photo; ffmpeg `lut3d`/`eq` natively supports it |
| M8 | **Reframe / crop within aspect** — position the source inside the 9:16 frame (static crop = the photo pan/zoom UI, no motion) | **R2, R4** | Source rarely matches output aspect; static reframe is the floor (Ken Burns later) | Partial — render does cover-crop centered; needs a crop handle |
| M9 | **Contextual right inspector** that swaps by selection (caption / overlay / clip-grade / frame) — mirrors the photo editor exactly | **R3, R4** | The IA spine; makes everything above legible without clutter | New; direct port of the photo editor inspector pattern |

### NICE-TO-HAVE (v1.5 — cheap wins if time allows)

| # | Feature | Maps to | Note |
|---|---|---|---|
| N1 | **Word/Phrase toggle** for caption editing (Captions.ai) | R1 | Free — Bernard already has both granularities (`groupWordsIntoLines`) |
| N2 | **A few caption animation presets** (karaoke-fill, pop-on, fade) beyond the single karaoke style | R1 | ASS supports per-word `\k`; pop-on/fade are small additions |
| N3 | **Overlay animation presets** (fade-in/out, slide-up) on the in/out points | R2 | ffmpeg `fade`/`drawtext` enable timestamp; keep to 2–3 presets |
| N4 | **"Trim to this sentence"** — click a transcript line → set in/out to its word-timestamps | R1 | Bridges transcript panel ↔ trim; uses data we already have |
| N5 | **Describe-the-grade for video** ("warmer, more contrast") → param set | R3 | Same `proposeGradeParams` model call as photo; just a different emitter |
| N6 | **Duplicate / delete overlay** with undo toast | R2 | Matches the carousel delete-UX decision |

### LATER (explicitly out of v1 — the "we don't need full CapCut" line)

| # | Feature | Why deferred |
|---|---|---|
| L1 | **Delete-to-trim / reorder transcript** (true Descript engine — non-contiguous cuts, ripple, re-stitch) | Real editor engine: gap mgmt + concat re-render. v1 is one contiguous window |
| L2 | **Multi-clip timeline** (stitch several source clips into one Reel) | Multi-track concat; big jump. Bernard renders one ≤60s window today |
| L3 | **Ken Burns / keyframed reframe** (animate crop start→end) | Ship static reframe first; motion is additive |
| L4 | **Auto B-roll insertion** (Submagic/Captions Magic B-roll) | Stock-footage sourcing + IP; not clinic-appropriate by default |
| L5 | **AI avatars / eye-contact correction / dub** (Captions.ai) | Off-mission for clinical authenticity |
| L6 | **Background-only grade / segmentation on video** | Per the colorist brief, even photo background-isolation is Phase 3; video is later still |
| L7 | **Full color wheels / scopes** (CapCut pro grade) | The 5 colorist sliders + LUT are the deliberate ceiling |
| L8 | **Multi-track audio / music bed / ducking** | Audio editing is a separate product surface |

**Requirement coverage check:**
- **R1 (auto-captions following audio):** M1 + M2 + M3 (+ N1/N2/N4) — covered, mostly already built.
- **R2 (manual overlays):** M4 + M5 + M6 + M8 (+ N3/N6) — covered.
- **R3 (same AI visual editor on frames):** M7 + M9 (+ N5) — one schema, ffmpeg emitter.
- **R4 (minimal but credible):** the MUST-HAVE list IS the minimal credible set; everything heavyweight is in LATER.

---

## 4. PART B — IA recommendation (mirror the photo editor + add time)

### 4.1 The mapping (photo → video), one-to-one

| Photo/carousel editor | Video editor equivalent | Where it lives |
|---|---|---|
| Big scaling canvas = live preview | **Same canvas**, now with a play/pause + scrubbable playhead | CENTER (dominant, ≥60% viewport) |
| Left vertical **slide rail** (filmstrip) | **Layers list** for THIS clip (Video clip · Frame grade · Caption track · each text overlay) | LEFT rail (thin, vertical) |
| Direct **layer selection** on canvas | Same — click the caption / an overlay / the video frame to select | CENTER (canvas) + LEFT (list) stay in sync |
| Contextual **right inspector** | Same — swaps to the selected layer's editor | RIGHT inspector |
| (none) | **Bottom timeline / clip rail** — the time axis: trim handles + caption/overlay bars | BOTTOM (new) |
| (none) | **Transcript panel** — spoken lines, editable, doubles as caption editor + trim navigator | A LEFT-rail tab OR a slide-out (see 4.3) |

**Top bar (~48px, the only persistent chrome — same discipline as the carousel spec):** back arrow · editable piece title · a **format badge** ("Instagram Reel · 9:16 · 0:32" derived from the clip) · primary **Save / Schedule**.

### 4.2 The four panes (concrete geometry)

```
┌─────────────────────────────────────────────────────────────────────┐
│ ← Back   Reel title            [Instagram Reel · 9:16 · 0:32]   Save  │  TOP BAR ~48px
├──────┬───────────────────────────────────────────────┬──────────────┤
│ LAYERS│                                               │  INSPECTOR    │
│ (rail)│                                               │  (contextual) │
│       │              ACTIVE CANVAS = PREVIEW          │               │
│ ▣ Clip│            (9:16, safe-zone overlay,          │  swaps to the │
│ ◐ Grade│            captions + overlays composited,    │  selected     │
│ ⌶ Caps │            ▶ play / scrub)                    │  layer's      │
│ T Title│                                               │  editor       │
│ T CTA  │                                               │               │
│  [Trans│                                               │               │
│  cript]│                                               │               │
├──────┴───────────────────────────────────────────────┴──────────────┤
│  ▶ ──────●───────────────────────  0:12 / 0:32     [In|====|Out]      │  TIMELINE
│  CAPTIONS  ▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓▓ (whole clip)     │  (bottom,
│  "Title"        ▓▓▓▓▓▓▓                                                │   layered)
│  "CTA"                                    ▓▓▓▓▓▓▓▓▓                    │
└──────────────────────────────────────────────────────────────────────┘
```

- **LEFT rail = LAYERS** (not slides). For a single clip the layers are: **Video clip**, **Frame grade** (the colorist look — a single pseudo-layer for the whole clip), **Captions** (the auto track), and **one row per manual text overlay**. A **Transcript** tab/toggle sits at the bottom of the rail (or expands as a slide-out, see 4.3). This is the *exact* role the slide filmstrip plays in the photo editor — a vertical selectable list — just listing layers instead of slides (because a single clip has one canvas, not N slides).
- **CENTER = ACTIVE CANVAS = live preview.** One render path: the canvas composites the source frame + grade + overlays + caption from the SAME params the ffmpeg bake consumes. Play/scrub via the bottom playhead. Safe-zone overlay (9:16 reel chrome bands) default ON.
- **RIGHT = CONTEXTUAL INSPECTOR.** Swaps by selection (the four states in 4.4).
- **BOTTOM = TIMELINE.** Single video track with **trim in/out handles** (the existing `TrimBar`, promoted). Below it, **time-spanning bars** for the caption track (spans whole clip by default) and each text overlay (its in/out window). Click a bar → selects that layer (drives canvas + inspector). Drag a bar's edges → set in/out.

### 4.3 Where the transcript panel goes (the one genuinely new question)

Two viable placements; **recommend a LEFT-rail tab** that expands into a slide-out column, so it never permanently steals canvas width:

- **Option A (recommend): Transcript as a LEFT-rail tab → slide-out.** The left rail has two modes: **Layers** (default) and **Transcript**. Picking Transcript slides out a wider column listing spoken lines (editable text + a tiny waveform/timecode each). Editing a line edits the burned caption; clicking a line jumps the playhead; a "trim to this line" action sets in/out. Collapses back to the thin rail. _Why:_ keeps the canvas dominant (the carousel lesson), but gives the transcript real room when needed — mirrors how the photo editor's filmstrip is the navigator.
- **Option B: Transcript as a bottom-timeline mode.** A toggle swaps the bottom timeline between "bars" view and "transcript" view (Submagic/Descript-ish). Cleaner conceptually (text and time share the bottom), but a horizontal strip is cramped for reading multiple sentences.

(Open question Q-IA in §5 surfaces this to the owner.)

### 4.4 The 3–4 screen states (how layer-selection works WITH a timeline)

Selection is unified: **clicking on the canvas, the left layers rail, OR a bottom-timeline bar selects the same layer** and swaps the right inspector. The four states:

**STATE 1 — Nothing selected / "Clip" selected → Clip & Reframe inspector**
- RIGHT shows: format (Reel 9:16), **Trim** (in/out, mirrors the bottom handles), **Reframe** (drag the source inside the frame — static crop), duration readout, and the **caption style pack** picker (since captions belong to the whole clip).
- CENTER: full clip preview; bottom timeline shows trim handles active.

**STATE 2 — Video frame / "Grade" selected → AI Colorist inspector (R3)**
- RIGHT shows the **identical colorist** to the photo editor: **vibe chips** + **Brightness / Warmth / Contrast / Vibrance / Depth** sliders + **"describe the vibe"** box + brand "house look" toggle. Same param schema; rendered to the clip via ffmpeg `eq`/`curves`/`colorbalance`/`lut3d` instead of Sharp.
- CENTER: the grade applies live to every frame of the preview.
- _This is the screen that proves requirement R3 — it must look and feel pixel-identical to the photo colorist._

**STATE 3 — Caption track selected → Captions inspector (R1)**
- RIGHT shows: **Style pack** (font/accent/animation preset), **position** (top/center/bottom), **size** (S/M/L), **word/phrase edit toggle** (N1), and an **"Edit transcript"** button that opens the transcript panel (4.3).
- CENTER: captions render in the preview, word-fill animating on scrub.
- BOTTOM: the caption bar spans the clip; (later) draggable to offset.

**STATE 4 — A text overlay selected → Overlay (text) inspector (R2)**
- RIGHT shows: the **text** (roomy textarea), **role** (title / lower-third / callout), **position** (drag on canvas or presets), **in/out time** (numeric, mirrors the bottom bar), and an **animation preset** (fade/slide).
- CENTER: the overlay is draggable on the canvas; selected handles visible.
- BOTTOM: that overlay's bar is highlighted; drag its edges to set when it appears/disappears.

**The selection contract (write it into the mockup):** exactly one layer selected at a time; selecting anywhere (canvas/rail/timeline) updates all three; the right inspector is ALWAYS the selected layer's editor (never a generic catch-all). This is a direct port of the carousel editor's "context inspector appears for the selection" rule — the only addition is that the **timeline is a third place you can select from**.

### 4.5 Why this is cheap (architecture parity, from `video-editor-parity.md`)

- **Data model:** `slides[]` → `segments[]`. A segment = the same object (`{ blocks[], theme, grade, photoOff, photoZoom }`) plus `{ clipId, inSec, outSec, kenBurns? }`. A v1 Reel is **one segment** = one cut clip + overlays + grade + caption.
- **One grade module, two emitters:** the colorist param schema is rendered by **Sharp** (photo) and an **ffmpeg filtergraph** (video). Lock the schema during the photo build → video drops in.
- **Same renderer = same preview:** the canvas must render from the same params the MP4 bake consumes (the #1 risk).
- **Reuses Slate:** Slate/ClipFinder finds + cuts the clip; this editor is the "compose overlays + grade + reframe + caption on the cut clip" step — the **Reel composer**, mirroring the carousel composer.

---

## 5. PART C — Captions data/UX model

### 5.1 The representation (segments with start/end + text + style)

A caption track is an ordered list of **caption segments**, each:

```jsonc
// caption_track on the segment/clip
{
  "source": "asr",                  // 'asr' (auto) | 'manual'
  "style": {                        // the "style pack" — one bundle
    "preset": "karaoke",            // 'karaoke' | 'pop_on' | 'fade' | 'static'
    "font": "Inter",                // from workspace.brand_style.heading_font
    "accent": "#0C7580",            // brand accent (spoken word fill)
    "position": "bottom",           // top | center | bottom  (= overlayPosition)
    "size": "medium"                // small | medium | large  (= overlaySize)
  },
  "lines": [                        // phrase-level (what's shown at once)
    {
      "start": 0.42, "end": 2.18,   // seconds, relative to the clip window
      "text": "the fastest way to loosen a tight hip",
      "words": [                    // word-level (drives karaoke fill + word edit)
        { "start": 0.42, "end": 0.66, "word": "the" },
        { "start": 0.66, "end": 1.10, "word": "fastest" }
        // …
      ]
    }
  ]
}
```

- **Two granularities, one source of truth:** `words[]` (per-word timestamps from Whisper, drives the `\k` karaoke fill and the per-word edit) and `lines[]` (the phrase grouping, what's on screen at once, drives the per-phrase edit). This is exactly what `karaokeCaptions.js` already computes — `groupWordsIntoLines(words, maxWords=5, maxChars=26)` produces the lines from the words. The data model should **persist both** so the editor doesn't recompute on every load and edits round-trip.
- **Style is a single bundle** (the "style pack"), not 12 loose properties — matches Canva/Veed and keeps the inspector minimal (R4). Defaults come from `workspace.brand_style` (already wired: accent from `resolveBrandColors`, font from `brand_style.heading_font`, size from `brand_style.subtitle_font_size`).
- **Render contract:** the editor and the bake both consume this object. Today `brandRenderVideo.js` builds the ASS *at render time* from a fresh Whisper pass; the model change is to **persist the words/lines once** (on clip detection or first caption edit) so (a) edits survive, (b) the preview matches without re-transcribing, (c) re-render is free and identical (the non-destructive principle from the colorist brief).

### 5.2 How it relates to Bernard's existing transcript/clip data

- **`media_assets.transcript_excerpt`** and **`video_segments.transcript_excerpt`** already hold the spoken text for a clip. These seed the transcript panel's text.
- **Whisper word-timestamps** are already produced in the render path (`transcribeToWords` → `karaokeWords`). The model change is to **capture that output onto the row** (e.g. a `caption_track` JSONB on `video_segments`, or on the `content_items` once the clip becomes a piece) instead of discarding it after the render.
- **`overlayPosition` / `overlaySize`** in `SlateClipEditor` map directly to `style.position` / `style.size`.
- **Brand accent / font** already resolve from the workspace — no new plumbing.
- So the caption model is **mostly a persistence + surfacing change**, not new capability: stop throwing away the word-timestamps, store them as `caption_track`, render the editor from them.

### 5.3 How a user edits captions (the UX)

1. **Auto-generate** on clip open (or it's already there from detection): the transcript panel fills with `lines[]`; the canvas shows karaoke captions.
2. **Fix a word:** click a word (word view) or a line (phrase view) in the transcript panel → edit text inline → the burned caption text updates; timing is preserved (only text changed). (Kapwing/Descript model.)
3. **Retime (later/nice):** drag a line's edges on the bottom timeline bar, or nudge start/end in the inspector.
4. **Restyle:** State-3 inspector → pick a style pack / position / size → whole track updates live.
5. **Reposition:** position is part of the style pack (top/center/bottom); free-drag is reserved for *manual* overlays (State 4), not the auto-caption track (keeps captions consistent and safe-zone-aware).
6. **Word/Phrase toggle (N1):** switch the transcript panel between per-word (precise) and per-phrase (fast text) editing — same data.

### 5.4 Manual overlay model (the non-caption text — R2)

A manual overlay reuses the **carousel text-block object** (`overlayTemplates.js` `renderFreeformSlide` blocks: role + position + text) **plus a time window**:

```jsonc
{
  "kind": "overlay",
  "role": "title",                 // title | lower_third | callout
  "text": "3 fixes for a stiff neck",
  "position": { "x": 0.5, "y": 0.18 },   // normalized; drag on canvas (same as photo)
  "in": 0.0, "out": 3.0,           // seconds within the clip
  "anim": "fade",                  // none | fade | slide_up
  "style": { "theme": "deck" }     // inherits the clip/brand style
}
```

- Same block model as a slide → the photo editor's text controls **port directly**; the only addition is `in`/`out` (the bottom timeline bar) and `anim`.
- Default `in=0, out=clipEnd` so an overlay behaves like a static photo text block with **zero timing work** (the parity-doc principle: "Default: show for the whole clip — so even with zero timing work, it behaves like the photo editor").
- Rendered via ffmpeg `drawtext`/overlay-PNG with `enable='between(t,in,out)'` and a `fade` filter for `anim`.

---

## 6. What Bernard already has (so the mockup is grounded, not aspirational)

| Capability | Where | State |
|---|---|---|
| Whisper transcription → **word timestamps** | `api/_lib/whisper.js` (`transcribeToWords`), called in `brandRenderVideo.js` | Live |
| **Animated karaoke captions** (per-word fill to brand accent) | `api/_lib/karaokeCaptions.js` (`buildKaraokeAss`, `groupWordsIntoLines`) | Live (burned via ffmpeg `ass=`) |
| SRT fallback captions | `transcribeToSrt` + `subtitles=` filter | Live |
| **ffmpeg crop/scale to aspect + brand overlay + caption burn** per channel | `api/_lib/brandRenderVideo.js` (`renderVideoChannel`, `VIDEO_CHANNEL_SPECS`) | Live (9:16/1:1/4:5/16:9 specs) |
| Brand overlay SVG (caption band, lower-third w/ clinician + workspace name) | `buildBrandOverlaySvg` (shared with photo) | Live |
| Brand accent/font/opacity resolution | `resolveBrandColors`, `getBrandFont`, `workspace.brand_style` | Live |
| **Trim UI** (dual-handle in/out, ≤60s, playhead) | `SlateClipEditor.jsx` `TrimBar` | Live |
| **WYSIWYG caption-band preview** + position (top/center/bottom) + size (S/M/L) | `SlateClipEditor.jsx` (`overlayPosition`, `overlaySize`) | Live |
| Caption **position/size on the render** | `renderVideoChannel({ overlayPosition, overlaySize })` | Live |
| **AI-proposed clips** (hook + transcript excerpt + start/end) | `video_segments` rows, ClipFinder/Slate, `getSegments` | Live |
| Transcript excerpt per clip/segment | `media_assets.transcript_excerpt`, `video_segments.transcript_excerpt` | Live |
| **"Polish this clip" AI chat** (tighten caption, change size) | `SlateClipEditor.jsx` `fireChip` → `/api/editorial/restyle` | Live |
| Render-as-post / b-roll / whole-video / ad-export hand-offs | `SlateClipEditor.jsx`, `api/editorial/*` | Live |
| Voice-faithful caption generation | `api/_lib/captionGen.js` (`generateCaption`) | Live |
| Carousel **text-block overlay model** (role/position/free-drag) | `src/lib/overlayTemplates.js` (`renderFreeformSlide`) | Live (photo) |
| **AI Colorist param schema + Sharp grade** | being built (`.claude/colorist-concept-brief.md`, `api/_lib/brandRender.js`) | In progress |

**What's genuinely NEW to build for the video editor (the honest delta):**
1. The **4-pane editor shell** (left layers rail + active video canvas + bottom layered timeline + contextual inspector) — a re-IA of `SlateClipEditor`'s current two-column layout into the photo-editor's shape.
2. **Persisting the caption track** (`caption_track` JSONB: words + lines + style) instead of discarding Whisper output after render — so captions are editable and the preview matches.
3. The **transcript/caption editing panel** (editable lines, word/phrase toggle, click-to-seek, trim-to-line).
4. **Manual text overlays with in/out time** (carousel block model + a time window + the bottom bar).
5. The **ffmpeg emitter for the colorist grade** (`eq`/`curves`/`colorbalance`/`lut3d`) wired to the SAME param schema as the photo colorist, exposed via the State-2 inspector.
6. **Static reframe handle** (position source inside the frame), upgrading today's hard-coded center-cover crop.

Everything else (transcription, karaoke captions, brand overlay, per-channel render, trim, hand-offs) is reuse.

---

## 7. PART D — Open questions for the owner (resolve before building the mockup)

### Q-IA — Where does the transcript panel live: a left-rail tab/slide-out, or a bottom-timeline mode?
_Why it matters:_ It's the one genuinely-new surface with no photo-editor precedent, and it sets whether the canvas stays maximally dominant. (Recommend: **left-rail tab → slide-out**, §4.3 Option A.)

### Q-TRIM — Is v1's clip a single contiguous window (trim in/out only), or do we want delete-to-trim from the transcript (Descript-style) now?
_Why it matters:_ Delete-to-trim / reorder is a real editor engine (non-contiguous cuts, gap mgmt, concat re-render). It's the difference between a ~1-week editor and a multi-week one. (Recommend: **single window in v1**; transcript edits the caption + navigates, delete-to-trim is LATER.)

### Q-GRADE-FEEL — Should the video colorist inspector be **pixel-identical** to the photo colorist (same chips, same 5 sliders, same "describe the vibe"), even if a slider (e.g. Vibrance/Depth) is harder to do faithfully in ffmpeg than in Sharp?
_Why it matters:_ R3 says "the same AI visual editor." Per the colorist brief, **Vibrance** ("needs-model") and **Depth** don't have clean deterministic paths even in Sharp. Do we (a) show the same 5 sliders and approximate, (b) show only the deterministic ones for video (Brightness/Warmth/Contrast), or (c) gate Vibrance/Depth behind the model for both? (Recommend: **same UI, shared schema**; clamp/approximate so it never looks broken, matching the photo editor's own honesty constraints.)

### Q-CAPTION-DEFAULT — Are auto-captions **on by default** for every Reel (burned unless turned off), or an explicit "add captions" action?
_Why it matters:_ Today the render path makes captions opt-out for clips, opt-in for long-form. For the editor, default-on matches social best practice (muted playback) but burns transcription on every clip. (Recommend: **on by default for Reels/clips**, off for keep-whole long-form — match the current render behavior.)

### Q-CAPTION-POSITION — Can the **auto-caption track be free-dragged** anywhere (like CapCut/Adobe), or is it constrained to top/center/bottom presets (current behavior) while only *manual* overlays free-drag?
_Why it matters:_ Free-drag captions invite safe-zone collisions and inconsistency; presets keep clinic output clean. (Recommend: **presets for the caption track, free-drag for manual overlays** — §5.3 step 5.)

### Q-ANIM-COUNT — How many caption + overlay **animation presets** in v1?
_Why it matters:_ Each preset is small but additive build + design. (Recommend: **captions: karaoke-fill + pop-on + fade (3); overlays: none + fade + slide-up (3)** — credible, not CapCut's 35.)

### Q-REFRAME — Is **static reframe** (position source inside the frame) enough for v1, or is **Ken Burns / subject-tracking auto-reframe** (Opus-style) needed at launch?
_Why it matters:_ Subject-tracking is an ML feature (Opus/Vizard differentiator); static crop is a drag-handle. (Recommend: **static reframe v1**; subject-tracking/Ken Burns LATER.)

### Q-MULTICLIP — Is a v1 Reel always **one cut clip**, or do we need to stitch **multiple clips** into one Reel from the start?
_Why it matters:_ Multi-clip = multi-track concat timeline (a much bigger build). Bernard renders one ≤60s window today. (Recommend: **one clip per Reel in v1**; multi-clip stitch is LATER.)

### Q-FORMAT-SWITCH — Should the format badge be **read-only** (Reel 9:16, derived) or a **switcher** (Reel ↔ square ↔ landscape) that re-crops in place?
_Why it matters:_ Mirrors the carousel Q5. A switcher needs rules for re-cropping/safe-zones per aspect. (Recommend: **read-only badge v1**, defer the switcher — consistent with the carousel decision.)

---

## 8. One-paragraph mockup direction (the spec the owner signs off on)

A **canvas-dominant Reel editor that is the photo editor plus a time axis.** TOP BAR (~48px): back · editable title · a derived format badge ("Instagram Reel · 9:16 · 0:32") · Save/Schedule. LEFT a thin **layers rail** listing this clip's layers — **Video clip · Frame grade · Captions · each text overlay** — with a **Transcript** tab that slides out a wider editable spoken-lines column (fix a word → the burned caption updates; click a line → seek; "trim to this line"). CENTER one **active 9:16 canvas that IS the live preview**, safe-zone overlay on, captions + overlays + grade composited from the SAME params the MP4 bake consumes, with a play/scrub control. BOTTOM a **single-track timeline**: trim in/out handles on the clip, plus time-spanning bars for the caption track (whole clip) and each overlay (its in/out window) — click a bar to select, drag its edges to retime. RIGHT a **contextual inspector** that swaps by selection across four states: **Clip & Reframe** (trim + static crop + caption style pack), **AI Colorist** (the *identical* vibe-chips + Brightness/Warmth/Contrast/Vibrance/Depth + "describe the vibe" as the photo editor, rendered via ffmpeg color filters), **Captions** (style pack + position + size + word/phrase edit), and **Overlay** (text + role + canvas position + in/out + animation). Selection is unified — clicking the canvas, the layers rail, or a timeline bar selects the same layer and drives the inspector. It reuses everything Bernard already ships (Whisper word-timestamps, karaoke ASS captions, brand overlay, per-channel ffmpeg render, the trim bar, the carousel text-block model); the only new work is the 4-pane shell, persisting the caption track, the transcript panel, manual overlays with time, the ffmpeg grade emitter, and a reframe handle — deliberately stopping short of a full CapCut suite (no multi-clip stitch, no delete-to-trim engine, no auto-B-roll, no color wheels).

---

## Sources

- CapCut: [caption generators](https://www.capcut.com/resource/caption-generators) · [editing not matching preview](https://www.capcut.com/help/editing-not-match-displayed) · [SocialRevver auto-captions](https://www.socialrevver.com/blog/capcut-auto-captions) · [Pixflow AI captions](https://pixflow.net/blog/ai-automatic-captions-subtitles/) · [Filmora timeline](https://filmora.wondershare.com/advanced-video-editing/capcut-timeline.html) · [CreateThat layout](https://www.createthat.ai/blog/how-to-change-layout-in-capcut) · [TechBloat opacity/Inspector](https://www.techbloat.com/how-to-change-opacity-in-capcut-pc-full-guide-2.html)
- Descript: [video editing](https://www.descript.com/video-editing) · [captions](https://www.descript.com/captions) · [caption generator](https://www.descript.com/tools/video-caption-generator) · [Primal Video tutorial](https://primalvideo.com/guides/edit-videos-by-editing-text-descript-tutorial/)
- Opus Clip: [captions](https://www.opus.pro/captions) · [AI reframe](https://www.opus.pro/ai-reframe) · [Skywork review](https://skywork.ai/blog/opusclip-review-2025-ai-video-clipping-social-repurposing/) · [Fritz AI review](https://fritz.ai/opusclip-ai-review/)
- Submagic: [home](https://www.submagic.co/) · [PostUnreel review](https://postunreel.com/blog/submagic-review-ai-caption-tool) · [Max-Productive review](https://max-productive.ai/ai-tools/submagic/) · [ByteCap alternative](https://www.bytecap.io/alternatives/submagic) · [ToolsForHumans](https://www.toolsforhumans.ai/ai-tools/submagic) · [AnixSoftware](https://anixsoftware.com/submagic-ai/)
- Veed.io: [auto-subtitle](https://www.veed.io/tools/auto-subtitle-generator-online) · [caption generator](https://www.veed.io/tools/auto-subtitle-generator-online/video-caption-generator) · [dynamic subtitles](https://www.veed.io/tools/auto-subtitle-generator-online/dynamic-subtitles) · [add text](https://www.veed.io/tools/add-text-to-video) · [best subtitle generator](https://www.veed.io/learn/best-auto-subtitle-generator) · [VidAU review](https://www.vidau.ai/veed-io-review-video-editor/)
- Kapwing: [subtitles](https://www.kapwing.com/subtitles) · [subtitle editor](https://www.kapwing.com/subtitles/editor) · [caption generator](https://www.kapwing.com/subtitles/caption-generator) · [Tuts+ guide](https://photography.tutsplus.com/tutorials/how-to-generate-captions-kapwing--cms-41601)
- Captions.ai: [overview](https://captions.ai/overview) · [what's new](https://captions.ai/help/whats-new) · [eesel deep-dive](https://www.eesel.ai/blog/captions-ai)
- Canva (video): [generate/edit captions](https://www.canva.com/help/generate-edit-captions-on-videos/) · [manage captions](https://www.canva.com/help/edit-manage-video-captions/) · [auto-caption feature](https://www.canva.com/features/auto-caption/) · [Checksub guide](https://www.checksub.com/blog/canva-captions-guide)
- Adobe Express (video): [caption help](https://helpx.adobe.com/express/web/video-creation-and-editing/edit-videos/caption-video.html) · [generate captions](https://helpx.adobe.com/express/web/create-and-customize-text/generate-captions-in-adobe-express.html) · [Adobe Research content-aware captioning](https://research.adobe.com/news/content-aware-video-captioning-in-adobe-express/) · [community thread](https://community.adobe.com/t5/adobe-express-discussions/can-you-edit-and-add-captions-before-exporting-a-video-in-adobe-express/td-p/14922285)
- Transcript-as-editor & extras: [Riverside text-based editing](https://riverside.com/blog/how-to-edit-video-with-text) · [Riverside Magic Clips](https://riverside.com/magic-clips) · [Vizard clip maker](https://vizard.ai/tools/clip-maker)
- Transcription/word-timestamps: [AssemblyAI best models](https://www.assemblyai.com/blog/best-api-models-for-real-time-speech-recognition-and-transcription) · [Inworld STT comparison](https://inworld.ai/resources/best-speech-to-text-apis)
- Bernard internal (source-grounded): `api/_lib/karaokeCaptions.js`, `api/_lib/brandRenderVideo.js`, `src/pages/SlateClipEditor.jsx`, `api/editorial/render-segments.js`, `.claude/carousel-editor-redesign-findings.md`, `.claude/colorist-concept-brief.md`, `.claude/video-editor-parity.md`
