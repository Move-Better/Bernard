# Plan — P3 "Bulletproof capture"

**Created:** 2026-06-04 · **Owner:** Q (approval required) · **Status:** PLAN — awaiting sign-off · no src/ changes yet
**Source:** `product-panel-audit.md` §3 (🎙️ conversation/voice + 🔧 reliability) + §4 row P3 · `ux-current-state.md`
**Severity:** 🔴 (blocks daily team use — Whitney's mobile equine visits; likely why Animals/Equine still route through Q)

> **Scope decision (2026-06-04, Q):** Team is on **iPhone or Mac**, and **zero setup** is a hard requirement — most clinicians will not install anything. This **demotes the iOS Shortcut** (it requires install + token paste → drop the "promote/build audio Shortcut" work) and **narrows the acute loss to the iPhone-browser case** (macOS doesn't aggressively kill background tabs). Build only the **cheap in-browser floor** (never silently lose + recover). The truly bulletproof answer — a **native iOS/macOS app** — is the endgame and is tracked as a **separate decision**, not part of P3. A PWA / Add-to-Home-Screen does **not** fix this (still WebKit, still backgrounded/killed).

---

## 0. The one-sentence problem

On mobile, an in-progress **audio** recording lives **only in browser RAM** until the user taps Stop and the upload finishes. iOS Safari/PWA freezes or kills a backgrounded tab — a phone call, a notification, the screen locking on an equine visit — and the captured audio is gone with **no recovery, no trace, no warning**. That silent loss is a trust-killer.

**Key finding from the code read:** the *photo/video* path is already bulletproof — it persists to IndexedDB and resumes across reloads (`resumableUpload.js` + `uploadDb.js` + `UploadProgressContext.jsx`). **Only the two AUDIO capture paths are unprotected.** P3 is mostly about extending the pattern that already exists for media to audio — not building net-new infrastructure.

---

## 1. Failure modes (with file:line evidence)

### FM-1 — Voice Memo: live recording chunks are RAM-only, lost on tab kill 🔴
`src/pages/VoiceMemo.jsx`
- Chunks accumulate in a plain ref: `chunksRef.current.push(e.data)` ([VoiceMemo.jsx:110](src/pages/VoiceMemo.jsx:110)). The `Blob` is only assembled in `rec.onstop` ([:112-115](src/pages/VoiceMemo.jsx:112)).
- `rec.start(1000)` collects a chunk every 1s ([:128](src/pages/VoiceMemo.jsx:128)) — but those chunks **go nowhere durable**. If the tab is killed before `onstop` fires, every chunk is lost. iOS does not reliably fire `onstop` on a background kill.
- **There is no `visibilitychange` / `pagehide` handler on this page at all** — unlike InterviewSession, which at least flushes text state. A backgrounded Voice Memo silently dies.
- Result: clinician records a 4-minute equine note, phone locks, returns to a blank recorder. Audio gone.

### FM-2 — Voice Memo: upload is a single non-resumable raw-body fetch 🔴
`src/pages/VoiceMemo.jsx` + `api/voice-memo.js`
- Upload is **one** `fetch('/api/voice-memo', { body: blob })` ([VoiceMemo.jsx:198-208](src/pages/VoiceMemo.jsx:198)) — no retry, no chunking, no resume.
- Server **buffers the entire body into RAM** (`readBody` concats all chunks, [voice-memo.js:66-73](api/voice-memo.js:66), [:101](api/voice-memo.js:101)) then holds it for Blob upload + Whisper. A network drop mid-upload on cellular = the whole thing fails and the user is bounced back to `state='recorded'` ([VoiceMemo.jsx:220](src/pages/VoiceMemo.jsx:220)) with a generic error and no auto-retry.
- If the tab is backgrounded *during* the upload (common — uploads are slow on cellular), iOS suspends the fetch and it never completes.

### FM-3 — Interview: voice-clone capture chunks are RAM-only 🔴
`src/hooks/useInterviewAudioCapture.js`
- Same shape as FM-1: `chunksRef.current.push(e.data)` with `recorder.start(10_000)`. The comment even says *"Collect a chunk every 10 seconds so we don't lose everything on a crash"* — but the chunks are **never persisted**, so a crash/kill still loses everything since the last `stopAndUpload`.
- The blob is only assembled in `recorder.onstop` inside `stopAndUpload` ([useInterviewAudioCapture.js](src/hooks/useInterviewAudioCapture.js)). A backgrounded interview tab that gets killed loses the entire voice-clone training take.
- Mitigating note: this path is explicitly *non-fatal* (training corpus, not the primary transcript). Lower priority than FM-1/FM-2, but same root cause and same fix.

### FM-4 — Interview transcript survives, but the AUDIO behind it does not 🟡
`src/pages/InterviewSession.jsx`
- The interview **does** protect the *text*: a 3s debounced `flushSessionState` autosave ([:405-411](src/pages/InterviewSession.jsx:405)) plus an immediate flush on `visibilitychange`/`pagehide`/`beforeunload` ([:417-432](src/pages/InterviewSession.jsx:417)). Good — this is the pattern to copy.
- But that only saves the *transcribed text messages*, not the raw mic audio (FM-3). For a chat interview the transcript is the product, so this is mostly fine — the gap is the voice-clone corpus.

### FM-5 — No "recovered recording" surface anywhere 🔴
- There is no UI that says "you have an unfinished recording — recover it?" for audio. The media `UploadTray` hydrates *paused multipart uploads* on mount ([UploadProgressContext.jsx:313-333](src/lib/UploadProgressContext.jsx:313)), but audio never enters that system, so a half-captured memo has no home to be recovered into.

### FM-6 — No background-resilience affordances during recording 🟡
- No `navigator.wakeLock` request while recording, so the screen sleeps and the tab backgrounds faster.
- No warning when the user backgrounds mid-record ("Recording paused — come back to finish").
- The iOS Shortcut (the genuinely reliable native path) **exists but is buried** behind a collapsed accordion at the bottom of `Capture.jsx` ([:486-594](src/pages/Capture.jsx:486)) — and is gated off entirely because `VITE_SHORTCUT_INSTALL_URL` is unset ([Capture.jsx:19](src/pages/Capture.jsx:19), [:535-539](src/pages/Capture.jsx:535)). It's also **photo/video only** — there is no audio Shortcut for the Voice Memo use case.

---

## 2. What already exists (reuse, don't rebuild)

| Asset | What it does | How P3 reuses it |
|---|---|---|
| `src/lib/uploadDb.js` | IndexedDB store `bernard-uploads`, stores `File` blobs structured-cloned, per-origin (tenant-isolated) | Add a sibling store (or record-type) for **audio chunks** |
| `src/lib/resumableUpload.js` | Multipart create → persist → chunked parallel part upload → complete, all checkpointed in IDB; staleness + token-expiry detection | Reuse the multipart orchestration for **resumable audio upload** (FM-2) |
| `src/lib/UploadProgressContext.jsx` + `UploadTray.jsx` | Hydrates paused uploads on mount, shows resume/abort rows | Surface **recovered recordings** here (FM-5) — one consistent recovery UI |
| `InterviewSession.jsx` visibility-flush pattern ([:417](src/pages/InterviewSession.jsx:417)) | `visibilitychange`/`pagehide`/`beforeunload` → immediate persist | Copy verbatim into VoiceMemo + the audio-capture hook |

The strategic win: **audio capture should ride the same IndexedDB-checkpoint rails the media path already proved in production.**

---

## 3. Proposed approach

Three layers, sliceable. Each is independently shippable and testable.

### Layer A — Never lose the chunks (persist MediaRecorder output to IndexedDB as it arrives)
The core fix. As each `ondataavailable` chunk arrives, write it to IndexedDB **immediately** (append to a per-session record) instead of only holding it in a ref.

- New module `src/lib/audioCaptureDb.js` (or extend `uploadDb.js` with an `audio-sessions` store): record `{ id, staffId, mimeType, startedAt, chunks: Blob[], durationSec, status: 'recording'|'stopped' }`. Append each chunk with a small `patch`.
- On Stop: assemble the blob from the **IDB-persisted** chunks (not the in-RAM ref), mark `status:'stopped'`, hand to Layer B.
- On tab kill mid-record: the IDB record survives with `status:'recording'` and all chunks up to the last `ondataavailable`. On next open, Layer C offers recovery.
- Tune `recorder.start(timeslice)` down (e.g. 3–5s for Voice Memo) so at most a few seconds are unflushed at kill time.
- Add a `visibilitychange`/`pagehide` handler to VoiceMemo (copy InterviewSession's) that calls `recorder.requestData()` to force a final chunk flush before suspension.
- Optional: `navigator.wakeLock` while recording to delay backgrounding (FM-6).

Applies to: **VoiceMemo.jsx** (FM-1) and **useInterviewAudioCapture.js** (FM-3) — same helper, two call sites.

### Layer B — Resumable, retrying upload (audio rides the multipart rails)
Replace the single raw-body fetch (FM-2) with the existing resumable multipart flow.

- Two sub-options:
  - **B1 (lean):** keep `/api/voice-memo` but add **client-side retry with backoff** + a guard that the upload only runs in the foreground; persist a "pending upload" flag in IDB so a failed/interrupted upload is retried on next open. Smallest change; covers most real failures (transient cellular drop).
  - **B2 (full):** route audio through `resumableUpload.js`'s multipart orchestrator (create → parts → complete), then trigger transcription server-side after `complete`. True cross-reload resume. More work; reuses proven code.
- **Server consideration:** `api/voice-memo.js` currently buffers the whole body in RAM ([:101](api/voice-memo.js:101)) and runs Whisper inline. For B2, transcription must move to fire after multipart `complete` (a `waitUntil` enrichment or a follow-up call), and the 25 MB Whisper cap ([voice-memo.js:44](api/voice-memo.js:44), [:107](api/voice-memo.js:107)) stays — but large files can at least *upload* reliably before being rejected/transcoded.
- **Recommendation:** ship **B1 first** (covers the common failure, low risk), graduate to **B2** only if large-file cellular uploads remain a problem.

### Layer C — "Recovered recording" surface
On app open, detect `status:'recording'|'stopped'` audio sessions in IDB that never completed upload, and offer recovery.

- Reuse `UploadProgressContext` hydration ([:313](src/lib/UploadProgressContext.jsx:313)): add audio records to the same on-mount scan so the existing `UploadTray` shows a "Recover voice memo from [time] (4:12)" row with **Resume upload** / **Discard** actions.
- For a `status:'recording'` (killed mid-record) session, the action is "Finish & upload this recording" — assemble what we have and send it.
- Staleness/cap: expire audio records after N days (match the media `fileLastModified` staleness model).

### Layer D — iOS Shortcut → DROPPED from P3 (2026-06-04, Q)
Cut. The Shortcut requires install + token-paste, which violates the **zero-setup** requirement, and an audio variant would serve ~1 person (Q). Leave the existing photo/video Shortcut accordion where it is as a buried power-user option; do **not** promote it and do **not** build an audio-memo Shortcut. The reliable native path the panel envisioned is instead the **native app** (separate decision below), not a Shortcut.

---

## 4. Components touched

| File | Change | Layer |
|---|---|---|
| `src/lib/audioCaptureDb.js` *(new)* or extend `src/lib/uploadDb.js` | IDB store for live audio chunks | A |
| `src/pages/VoiceMemo.jsx` | Persist chunks to IDB; add visibility/pagehide flush + `requestData()`; wakeLock; retry upload | A, B1 |
| `src/hooks/useInterviewAudioCapture.js` | Persist chunks to IDB (same helper) | A |
| `src/lib/resumableUpload.js` | (B2 only) accept audio content-type / audio path | B2 |
| `api/voice-memo.js` | (B2 only) decouple transcription from upload; accept multipart-completed blob | B2 |
| `src/lib/UploadProgressContext.jsx` + `src/components/UploadTray.jsx` | Hydrate + display recovered audio sessions | C |
| ~~`src/pages/Capture.jsx` — Shortcut~~ | **Dropped** — Shortcut violates zero-setup (Layer D cut) | — |

---

## 5. Risks

- **IDB write throughput.** Writing a chunk every few seconds to IndexedDB on an old phone could lag. Mitigate: small timeslice but not too small (3–5s); append-only writes; measure on a real device.
- **iOS background-kill timing.** Even `requestData()` on `visibilitychange` may not flush the last chunk if iOS suspends instantly. We recover *up to* the last persisted chunk — accept a few seconds of tail loss as the floor (vs. total loss today). The Shortcut (Layer D) is the only true zero-loss path; that's why D matters.
- **Storage bloat / orphans.** Persisted audio chunks must be cleaned on successful upload and expired on staleness, or IDB fills. Reuse the media model's delete-on-success + staleness expiry.
- **Server transcription decoupling (B2).** Moving Whisper off the upload request changes the review-page contract — the transcript won't be ready synchronously. Would need the detail-drawer refetch pattern (`CLAUDE.md` "Async pipelines and the detail-drawer refresh contract"). This is why B1 is recommended first.
- **Tenant isolation.** IDB is per-origin (already tenant-safe per `uploadDb.js` note). Keep audio records keyed the same way; never leak across subdomains.
- **Whisper 25 MB cap unchanged.** P3 makes capture *reliable*, not *bigger*. Long recordings still hit the cap — out of scope here, note to Q.

---

## 6. Sliced build order (one slice at a time, Q feedback between each)

| Slice | Scope | Unblocks | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **S1** | **Layer A on VoiceMemo** — persist chunks to IDB + visibility flush + wakeLock. The single highest-value fix: a killed Voice Memo is recoverable. | FM-1 | 1–1.5d | $2–4 (Sonnet) |
| **S2** | **Layer C** — recovered-recording row in the existing UploadTray. Makes S1 visible/usable. | FM-5 | 1–1.5d | $2–4 (Sonnet) |
| **S3** | **Layer B1 (light)** — upload retry/backoff + pending-upload flag. Covers Mac + cellular blips; skip the heavy multipart-resume. | FM-2 | 1d | $1–3 (Sonnet) |
| **S4** | **Layer A on useInterviewAudioCapture** — same helper, second call site. | FM-3 | 0.5d | $1–2 (Sonnet) |
| ~~**S5**~~ | ~~Promote iOS Shortcut~~ — **DROPPED** (violates zero-setup; Layer D cut). | — | — | — |
| ~~**S6**~~ | ~~Full multipart resumable audio + decoupled transcription~~ — **DROPPED** (a native app would supersede it; don't polish a path we intend to replace). | — | — | — |

**Recommended:** S1 → S2 → S3 → S4 (the 🔴 core: capture survives on iPhone, is recoverable, uploads reliably; same persistence on the interview voice-clone path). **Zero new setup for the user — entirely in-browser.** Total core (S1–S4): ~**3–3.5d, $5–9 (Sonnet)** — within the §4 P3 estimate (3–6d / $4–10), trimmed because the Shortcut and full-multipart slices are cut.

### Endgame (separate decision — NOT P3): native iOS/macOS app
The only *truly* bulletproof capture on iPhone is a **native app** with the background-audio entitlement — OS records to disk, survives backgrounding, survives a phone call mid-equine-visit. If capture continues to route through Q, that app is the real fix, not more in-browser IndexedDB cleverness. It's a real buy-vs-build + App-Store-overhead + new-surface conversation, scoped on its own. P3's in-browser floor (S1–S4) is still worth shipping first: the app is months out, Whitney is losing recordings now, and the web path never fully disappears (Mac users, quick captures, anyone not on the app). **Tracked as a spawned task.**

**Mockup-first?** S2 (recovery UI) touches the UploadTray surface — a quick labelled-diff mockup of the recovered-recording row is worth doing before S2 per the project's mockup-first rule. S1/S3/S4 are non-visual plumbing — no mockup needed.

---

*Keep file (human-authored plan — treat like source per `.claude/` scratch-vs-keep). Related: `product-panel-audit.md` P3 · `project_ios_shortcut_capture_shipped` · CLAUDE.md "Async pipelines and the detail-drawer refresh contract" · "Large-file handling".*
