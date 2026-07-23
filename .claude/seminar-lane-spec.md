# Seminar / Talk capture lane — build spec

**Created:** 2026-06-04 · **Owner:** Q · **Status:** spec for build (slow + feedback, slice by slice)
**Goal:** make the disabled "Seminar / Talk" card in the capture picker LIVE — upload a long talk (45–90+ min) → transcribe it → produce multiple "Learn By Doing" content pieces in the presenter's voice.

## What's already validated (this session, 2026-06-04)
- The **Voice Memo** lane is the proven analog: `src/pages/VoiceMemo.jsx` → `api/voice-memo.js` (raw-binary upload → Whisper → interview row with `capture_mode`) → `src/pages/CaptureReview.jsx` (streams a blog, PATCHes `status='completed'`, server cascade makes atoms).
- `capture_mode='seminar'` is an **accepted value** (a real seminar was inserted this session: interview `e1ad70fe-5ef7-46c9-bb91-99a7abd294bc` in Move Better People, attributed to Q — reference only, don't rebuild it). `CaptureReview` only special-cases `text_import`, so `seminar` flows through the blog→atoms path unchanged.
- **The blocker is long audio.** Real seminars are ~50–85 MB / 48–71 min. ffmpeg compression + chunked transcription works (validated locally). A 71-min file took **239 s** to transcribe — a single prod call would risk the 300 s function timeout.

## Hard constraints the build MUST respect (these are the gotchas — don't relearn them the hard way)
1. **Whisper 25 MB/file cap.** `api/voice-memo.js` (~line 107) hard-rejects >25 MB. → **chunk the audio** server-side (ffmpeg split into ≤~10-min / ≤24 MB segments, transcribe each, stitch in order).
2. **300 s function timeout + 2-hour audio.** ~12 chunks × 30–60 s each will blow past 300 s. → **do NOT transcribe synchronously in the request.** Use a background job: store a status on the interview (e.g. `transcribe_status`), and have the UI **poll with a HARD CAP** (per the `MediaDetail` / `packageStatus` 60s-cap rule in CLAUDE.md — no uncapped poll loops). Reference the worker pattern in `api/editorial/render-longform-worker.js`.
3. **Vercel serverless request-body limit (~4.5 MB).** The browser **cannot** POST a 50–85 MB file as the request body — the voice-memo raw-body approach fails at seminar scale. → **upload client-direct-to-Vercel-Blob** (like `src/pages/Capture.jsx` / the iOS Shortcut path), then hand the blob URL to the API.
4. **Large-file download in the worker.** Stream blob→disk (`pipeline(Readable.fromWeb(...), createWriteStream(...))`), never `arrayBuffer()` — OOM rule in CLAUDE.md ("Large-file handling").

## The build, in 3 feedback-gated slices (PR per slice, ≤3 unmerged, pause for Q between)
**① Chunked background transcription (highest-risk, build + validate FIRST).**
Client uploads audio direct-to-Blob → API creates a `capture_mode='seminar'` interview with `source_audio_url` + `transcribe_status='processing'` → background worker streams the audio, ffmpeg-splits into ≤24 MB/≤10-min segments, transcribes each via Whisper (reuse the call shape in `api/voice-memo.js`), stitches transcripts in order into `messages[0].content`, flips `transcribe_status='ready'`. UI shows "transcribing in the background…" and polls with a hard cap. Validate end-to-end with a REAL uploaded seminar before moving on.

**② The `/new/seminar` card + page.** Enable the disabled card in `src/pages/CapturePicker.jsx` (~line 226; route `/new/seminar`) → an upload page (reuse VoiceMemo's file-upload UX, but direct-to-Blob + the background-status messaging from ①). Then it lands on the review/generate screen when transcription is ready.

**③ "Learn By Doing" generation treatment (product decision — GET Q SIGN-OFF before wiring).**
The current `CaptureReview` makes ONE ~4096-token blog. A 2-hour seminar holds MANY pieces. Build seminar-aware generation that: segments the transcript into **concept → application** teaching units ("talk the why, then do it" — that's literally how Move Better seminars are structured), **anchors on the presenter's (Q's) voice and de-weights the other attendees' lines** (the transcript is multi-speaker with no diarization — folding attendees' words into Q's voice corpus would pollute the real-voice library), and spawns **multiple** content pieces. Show Q a sample/mockup of the treatment output and get his reaction BEFORE fully wiring it.

## Definition of Done (per project CLAUDE.md)
typecheck/lint/build green · handler shape matches runtime (Node `(req,res)`; never `return new Response`) · any new column/status value → migration with `GRANT … TO service_role`, applied to prod before merge · `workspaceContext(req)` + filter by `workspace_id` on every tenant-scoped route · `useAppMutation` / `apiFetch` (not raw) · the polling UI follows the detail-drawer refresh contract with a hard cap · feature used in-browser once before the PR. Branch off `origin/main`; `gh pr merge --auto --squash`.
