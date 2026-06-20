# Video editor — parity with the photo/carousel editor

_2026-06-19. Q's directive: build a great photo editor template first; video reuses the same concept. This captures how the photo editor maps to video so we don't design a separate thing — video is the photo editor + a time axis._

## The core idea
The photo (carousel) editor and the video (Reel) editor are **the same editor with one added dimension: time.** Everything we just designed for photo carries over 1:1; video only *adds* a timeline and trim. Get the photo template right and ~80% of the video editor is already designed.

## What maps 1:1 (no new design)
| Photo editor concept | Video editor equivalent |
|---|---|
| Aspect-ratio-parameterized canvas (4:5 / 1:1 / 9:16) + safe zones | Identical — Reels default 9:16, same safe-zone overlay |
| One active canvas **is** the live preview (one render path) | Identical — and *more* load-bearing: the preview must match the baked MP4 frame-for-frame |
| Free **drag** text blocks (x/y), role, click-to-edit | Identical overlay system; blocks gain an **in/out time** (when each caption shows) |
| Drag-to-pan + scroll/slider **zoom** on the photo | Becomes **Ken Burns / reframe over time**: same crop UI, optionally keyframed start→end |
| Per-slide **theme** (inherit deck / override) | Per-clip style, same theme system |
| **AI Colorist** grade params + brand house look | **Identical params**, rendered with ffmpeg color filters instead of Sharp — the brand `.cube` LUT applies to video natively (`lut3d`) |
| Non-destructive (store params, render derived artifact) | Identical (store params, render derived MP4) |
| Filmstrip of slides | Timeline of segments/clips (the filmstrip *is* a timeline already) |

## What's video-only (the additions)
- **Trim** (in/out points on the clip). Bernard already cuts clips in **Slate** — the video editor consumes an already-cut clip, so trim here is light.
- **Time axis for overlays**: each text block gets an appear/disappear time. (Default: show for the whole clip — so even with zero timing work, it behaves like the photo editor.)
- **Ken Burns keyframes** (optional): reframe can animate from one crop to another. v1 can ship with a *static* reframe (exactly the photo crop) and add motion later.
- **Audio/caption track** (later): burned-in captions already happen upstream; auto-captions could live here eventually.

## Architecture parity (why this is cheap if we plan now)
- **Data model:** `slides[]` → `segments[]`. A segment is the same object — `{ blocks[], theme, grade, photoOff, photoZoom }` — plus `{ clipId, inSec, outSec, kenBurns? }`. A still photo is just a segment with no clip + infinite duration.
- **One grade module, two emitters:** the AI Colorist param schema (exposure, contrast, saturation, warmth, tint, curves, LUT) is rendered by **Sharp** for photo and by an **ffmpeg filtergraph** (`eq`, `curves`, `colorbalance`, `lut3d`) for video. Same numbers in; same look out. This is the single highest-leverage reason to lock the param schema during the photo build.
- **Same renderer = same preview:** the "preview ≠ publish" bug class is the #1 risk for video too. The editor canvas must render from the same params the MP4 bake consumes.
- **Reuses Slate:** Slate finds + cuts clips today; the video editor is the "compose overlays + grade + reframe on a cut clip" step — i.e. the real **Reel composer**, mirroring the carousel composer.

## Build implication
When we build the photo editor (Phase 0–2 of the colorist + the carousel redesign), keep three things **format-agnostic** so video drops in later with minimal rework:
1. The **grade param schema** (shared module, Sharp + ffmpeg emitters).
2. The **overlay/block model** (free x/y, role, theme) — leave room for optional `in/out`.
3. The **aspect-ratio parameterization** (already decided — drives both).

Do that, and the video editor is "the photo editor, plus a timeline" — not a second product.
