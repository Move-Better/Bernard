# Bernard Capture — iOS App Scope

_Scoped 2026-06-14. Status: awaiting build go-ahead. Keep file (human-authored spec, not scratch)._

## Goal
A focused native **iPhone** app for **field capture** that feeds the existing Bernard
web app. Two jobs: (1) media capture (photo/video) and (2) voice/interview capture.
Everything downstream (review, edit, publish — Slate/Library/Storyboard) stays in the
web app. This app is the **capture + offline-queue + background-upload layer only.**

## Why native (vs. the existing PWA)
The mobile PWA can already shoot media and record audio. Native is justified ONLY for
the field-capture pain points the browser can't do:
- **Background uploads that survive app suspension** (`URLSession` background config).
- **Durable offline capture queue** — shoot in a clinic with no signal, upload later.
- **Reliable large video (≤2GB)** via direct-to-Blob.
- Share-sheet ingest (later phase).
Do NOT rebuild any web surfaces natively.

## Key finding — the backend mostly already exists
Bernard has a `/api/capture/*` companion surface + voice/interview ingest already built.
This is ~80% a **client** build.

| Capability | Backend | Endpoint(s) |
|---|---|---|
| Media upload (stream ≤200MB) | ✅ | `POST /api/capture/upload` (Bearer `cct_` capture token) |
| Large media (≤2GB) | ✅ | `POST /api/capture/upload-url` → `PUT <blob>` → `POST /api/capture/register` |
| Voice memo → transcript → interview | ✅ | `POST /api/voice-memo` (Whisper) |
| Realtime voice interview | ✅ | `POST /api/realtime-session` (WebRTC → OpenAI ephemeral key) |
| Interview CRUD | ✅ | `/api/db/interviews` |

### Auth model
- **Media path:** capture token (`cct_` + base32, 90-day expiry, rotatable from Profile UI).
  Token lookup (`api/_lib/captureAuth.js`) returns `{ staffMember, workspace }`, so the
  workspace is carried by the token — **no subdomain needed. Native-ready today.**
- **Interview/voice path:** Clerk JWT (Clerk iOS SDK). Needs the backend fix below.

### The ONE real backend gap (gates P1, not P0)
`/api/voice-memo`, `/api/realtime-session`, `/api/db/interviews` resolve the tenant from
the `*.withbernard.ai` **subdomain** (`Host` header). A native client has no subdomain.
Fix: teach `workspaceContext(req)` (`api/_lib/workspaceContext.js`) to also accept an
explicit workspace — cleanest is the `org_id` already present in the Clerk JWT (map
`org_id` → `workspaces.clerk_org_id`), falling back to an `X-Workspace-Slug` header.
Small, contained (~half day) + must filter by `workspace_id` for tenant isolation.

## Architecture
Native **SwiftUI** capture client; reuse the existing Bernard API. Not a WebView wrapper,
not a rewrite.
- SwiftUI + AVFoundation — camera (photo/video) + audio record.
- SwiftData/Core Data — offline capture queue (pending → uploading → done/failed).
- `URLSession` **background** configuration — uploads survive suspension/kill.
- Clerk iOS SDK — auth for the interview path; capture token for media.

## Distribution decisions (locked 2026-06-14)
- **TestFlight only** for v1 (a few clinicians). No App Store review.
- **Separate repo:** `Move-Better/Bernard-Capture` — keeps Xcode tooling out of the web
  monorepo's CI / lint ratchet / worktree flow.
- **Apple Developer Program NOT yet set up** → enrollment is a hard prerequisite (Step 0).

## Phases

### Step 0 — Prerequisite (human, ~1–3 days wall-clock, mostly waiting)
- Enroll in Apple Developer Program ($99/yr) under the Move Better org (or Q's account).
- Create the App ID / bundle id (e.g. `co.movebetter.bernard.capture`), signing certs,
  TestFlight app record in App Store Connect.
- Create the `Move-Better/Bernard-Capture` repo.
- _Claude can't do enrollment/signing — needs Q. Claude can scaffold the repo + Xcode
  project once the bundle id exists._

### P0 — Media capture MVP (4–6d, $8–20, Opus/Large)
Clerk sign-in → pick workspace → camera (photo+video) → offline queue → background upload
via `/api/capture/upload-url` → `PUT` Blob → `/register`. TestFlight build.
**No backend change required** (capture-token path). Ship to 1–2 clinicians, prove the
offline + background-upload loop against real prod, then decide on P1.

### P1 — Voice/interview capture (+3–4d, $6–15, Opus)
Backend workspace-resolution fix FIRST, then audio record → `/api/voice-memo`. Captured
audio lands as an interview that flows into the existing Words pipeline.

### P2 — Realtime interview + share sheet (+4–6d, $10–25, Opus)
WebRTC realtime interview via `/api/realtime-session`; iOS Share Extension for
Photos/Safari ingest.

## Open items / risks
- Background `URLSession` + Vercel Blob direct PUT: confirm the client-token TTL outlives
  a deferred background upload (token from `/upload-url` may expire before a queued upload
  fires). May need re-mint-on-retry.
- Capture token UX: how does a clinician get their `cct_` token onto the phone? (QR from
  the web Profile page → app scans, vs. type it.) Decide in P0.
- `media_assets` detail-drawer refresh contract already handles pipeline-pending state
  (see CLAUDE.md) — native uploads use the same `source='capture_companion'` rows, so the
  web Library will reflect them with no extra work.
