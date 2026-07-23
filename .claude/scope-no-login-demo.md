# Scope — No-login public demo (Option B)

**Date:** 2026-06-06
**Goal:** Let a prospect on `withbernard.ai` experience the core loop — *talk/describe → watch a draft post get written in a real voice* — with **zero signup**, the way Narrate's `/demo/recording` does. The demo is the strongest possible "show, don't tell" for the landing page.
**Status:** scoping only — no code written. Grounded in a live read of the real pipeline (see `competitor-ui-benchmark.md` for the why).

---

## The core constraint that shapes everything

The whole app is **subdomain + Clerk-org gated** (`OrgGate` in `src/App.jsx:107-460`), and every generation endpoint (`/api/stream`, `/api/content-plan/draft`, `/api/voice-memo`, `/api/tts`) hard-requires `workspaceContext(req)` (resolves a real active workspace from the Host subdomain) **and** `requireRole(req, …)` (a valid Clerk Bearer token).

**The wrong way to build the demo** (and what I'm explicitly *not* doing): adding a `?demo=1` bypass that skips `requireRole` on the shared `/api/stream`. That would turn the app's main AI endpoint into an unauthenticated, tenant-spoofable, cost-abuse target — anyone could `POST` against any subdomain and burn AI Gateway spend. A security own-goal.

**The right way:** a **separate, self-contained demo surface** that shares *nothing* writable with the tenant path:
- A **public route** that lives *outside* `ProtectedAppWithProvider` (alongside `/onboard`, `/privacy`).
- A **dedicated endpoint** `/api/demo/generate` that has **no `workspaceContext`, no `requireRole`, no Supabase writes** — it hardcodes a frozen "demo workspace" config object in code, runs generation, and returns text. It is structurally incapable of touching a real tenant.
- **Abuse protection by construction:** IP-keyed rate limit + bot check + small token caps + a fixed cheap model. Because it's unauthenticated and calls a paid model, this is mandatory, not optional.

This keeps the blast radius to "someone wastes a few cents of demo generation," never "someone reads/writes tenant data or DOSes the real app."

---

## Architecture (recommended)

```
PUBLIC (no auth, apex domain withbernard.ai)
  /demo                     ← new route, OUTSIDE ProtectedAppWithProvider
   └─ DemoExperience.jsx
        1. pick a topic (or, Phase 2, record 60s)
        2. → POST /api/demo/generate  { topic | transcript, platform }
        3. ← SSE stream: blog draft + 2-3 social atoms, in a fixed demo voice
        4. CTA: "This was a sample. Claim a founding spot →"

/api/demo/generate  (Node, dedicated, self-contained)
   ├─ NO workspaceContext / NO requireRole / NO Supabase
   ├─ enforceLimit(req, res, 'demo')         ← new IP-keyed bucket (e.g. 5/min, 20/day)
   ├─ BotID / lightweight bot check           ← unauth endpoint calling paid AI
   ├─ DEMO_WS = frozen in-code config (display_name, brand voice, sample staff "Dr. Q")
   ├─ build prompt with the SAME prompt fns the real path uses
   │     (getBlogPostSystemPrompt / getAtomSystemPrompt) — so output is representative
   ├─ streamText  model='anthropic/claude-sonnet-4-6'  maxOutputTokens≈1500  ← cheap, fast
   └─ stream text back; persist NOTHING
```

Why reuse the real prompt functions: the demo output then genuinely looks like the product's output (that's the whole point), without inheriting any of the auth/persistence machinery.

---

## The one decision that changes Phase 1 — input mode

How does the prospect "talk"? Two viable shapes; this is the main thing to pick:

| Input mode | What the prospect does | What it needs server-side | Representative-ness | Build cost |
|---|---|---|---|---|
| **A. Sample-first** (recommended for Phase 1) | Picks 1 of ~4 pre-set topics ("low back pain", "knee pain", …) **or** types/pastes a few sentences | Nothing extra — text straight into `/api/demo/generate` | High for the *output* magic; lower for the *"it heard ME"* magic | Low |
| **B. Live mic** (Narrate's exact pattern) | Records ~60s, sees it transcribed, then watches drafts appear | + `/api/demo/transcribe` (Whisper) handling audio **in-memory** (no Vercel Blob, no DB) | Highest — "I talked and it wrote *that*" | Medium (audio handling, Whisper, mobile mic perms, iOS quirks) |

My recommendation: **ship A first** (it delivers ~80% of the wow at ~40% of the cost and zero audio landmines), then **add B as Phase 2** once A is converting. Live mic is the better demo but it carries the iOS audio-unlock / mic-permission / Whisper-cost baggage documented across the project's memory — not worth blocking the first launch on.

---

## Phased plan

| Phase | Scope | Output | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **P1 — Sample-first MVP** | Public `/demo` route outside the gate; `DemoExperience.jsx` (pick-a-topic + free-text); dedicated `/api/demo/generate` (frozen demo-ws config, reuses real prompt fns, Sonnet, token cap); new IP-keyed `demo` rate-limit bucket; BotID/bot check; ephemeral (no DB); end-CTA to founding-spot signup. Wire "Talk for 60 seconds — no login" hero button → `/demo`. | A prospect picks/paste a topic → watches a real-looking blog draft + 2-3 social atoms stream in, in Dr. Q's voice → hits a signup CTA. | 3–4d | ~$8–14 (Opus for the endpoint/security design + Sonnet for UI) |
| **P2 — Live mic** | `/api/demo/transcribe` (Whisper, in-memory audio, IP-limited, capped duration ~90s); MediaRecorder capture in `DemoExperience` with the rotating-prompt-chip empty state (the anti-blank-mic nudge); iOS audio-unlock handling per project memory. | The full Narrate-style loop: record → see transcript → watch drafts appear. | 2–4d | ~$6–12 |
| **P3 — Polish & funnel** | Optional ElevenLabs TTS so a sample voice "talks back" (or keep silent); "save this draft — sign up to keep it" handoff that re-creates the demo interview as a real `interviews` row *after* auth; analytics (demo starts/completions/→signup); abuse dashboards. | Demo converts: output feels alive, and finishing pushes cleanly into onboarding. | 2–3d | ~$5–10 |

**Total if all three:** ~7–11 days, ~$19–36. P1 alone is a shippable, linkable demo.

---

## Build checklist (P1, concrete)

- [ ] **Route:** add `<Route path="/demo" element={<DemoExperience />} />` to the *outer* `<Routes>` in `src/App.jsx` (sibling of `/onboard`), so it never hits `OrgGate`. (Router footgun: use a fixed path; it's a leaf, no descendant routes — fine.)
- [ ] **Endpoint:** `api/demo/generate.js`, `runtime:'nodejs'`, `(req,res)` shape. **No** `workspaceContext`, **no** `requireRole`, **no** `sb()` writes. Returns SSE like `/api/stream`.
- [ ] **Frozen config:** a `DEMO_WORKSPACE` object literal in the endpoint (display name "Bernard Demo Clinic", a believable brand-voice blurb, sample staff "Dr. Q", default tone/voice_mode) — fed into the existing `getBlogPostSystemPrompt` / `getAtomSystemPrompt`.
- [ ] **Rate limit:** add a `demo` bucket to `api/_lib/ratelimit.js` (`{max:5,windowSec:60}` + a daily cap), keyed by IP via the existing `resolveIdentity` IP fallback. Confirm Upstash is provisioned in prod or it fails open (acceptable but note it).
- [ ] **Bot protection:** Vercel **BotID** (`vercel:vercel-firewall` / BotID is GA) on `/api/demo/generate` — cheapest way to keep scrapers/bots off an unauth paid endpoint. (Decision: BotID vs. a Turnstile challenge before first generation. BotID is invisible; Turnstile is a visible gate. Lean BotID.)
- [ ] **Model/caps:** `anthropic/claude-sonnet-4-6`, `maxOutputTokens ≈ 1500`, hard server-side cap regardless of client input.
- [ ] **UI:** `DemoExperience.jsx` — topic chips + free-text, a "Watch it write" run button, streamed blog card + 2-3 atom cards (reuse the mockup's hero card styling), and a persistent "Claim a founding spot →" CTA. Use the app's real tokens.
- [ ] **Hero wire:** point the landing "Talk for 60 seconds — no login" button at `/demo`.
- [ ] **No persistence proof:** verify (network tab) the demo issues **zero** Supabase calls and **zero** `/api/stream`/tenant calls.

---

## Landmines (carried from project memory)

- **Don't reuse `/api/stream` with an auth bypass** — covered above; dedicated endpoint only.
- **300s Vercel cap / cold starts:** Sonnet + 1500 tokens keeps a run well under; still log `e.stack` and handle abort. A warm-instance 200 can mask a cold-start crash — exercise cold start before calling it done (`feedback_vercel_node_runtime_handler_shape`).
- **Node handler shape:** `res.status().json()` / SSE `res.write` — never `return new Response()` (silent 300s hang).
- **Bundle smoke:** new `api/demo/*.js` must pass `npm run verify-bundles` (loads at module level — keep imports clean).
- **iOS mic/audio (P2 only):** per-element audio unlock, gesture-priming, Whisper rejects MP4 multipart (extract/transcode first) — all documented in memory; budget for them in P2, not P1.
- **No fake data:** the demo is explicitly ephemeral and labeled "sample" — it never writes tenant rows, so it doesn't violate the no-seed-data rule. The frozen demo config is a fixture for an *unauthenticated marketing surface*, not faked app state.

---

## Decisions — LOCKED (Q, 2026-06-06)
1. **Input mode:** **Live mic from day one** — the demo opens with record→transcript→drafts, Narrate's exact loop. (Audio/Whisper/iOS work moves into the first build phase rather than being deferred.)
2. **Bot protection:** **Invisible BotID** on `/api/demo/*`, paired with the IP-keyed `demo` rate-limit bucket + server-side token caps.
3. **Scope funded:** **All three phases** (live-mic loop + TTS talk-back + signup handoff + analytics). ~7–11d, ~$19–36.
4. **Voice talk-back:** in scope (P3, ElevenLabs).

## Revised build order (given live-mic-from-day-one)

Because live mic is now day-one, the phases re-cut around *what ships as a usable demo* rather than input mode:

| Phase | Scope | Est. Days | Est. Claude Cost |
|---|---|---|---|
| **B1 — Foundation + live-mic capture** | Public `/demo` route outside the gate; `DemoExperience.jsx` with MediaRecorder capture + rotating-prompt-chip empty state + iOS audio-unlock handling; `/api/demo/transcribe` (Whisper, in-memory audio, capped ~90s, IP-limited); `demo` rate-limit bucket; BotID on `/api/demo/*`. Ends at: record → see transcript on screen. | 2–3d | ~$8–14 |
| **B2 — Generation + the wow** | `/api/demo/generate` (frozen demo-ws config, reuses `getBlogPostSystemPrompt`/`getAtomSystemPrompt`, Sonnet, token cap, SSE); `DemoExperience` streams a blog draft + 2–3 social atoms in Dr. Q's voice; signup CTA; wire the landing "Talk for 60 seconds — no login" button → `/demo`; verify zero Supabase / zero tenant calls. | 2–3d | ~$8–14 |
| **B3 — Talk-back + funnel** | Optional ElevenLabs TTS so a sample voice speaks; "sign up to keep this draft" handoff that re-creates the demo run as a real `interviews` row *after* auth; analytics (starts/completions/→signup); cold-start exercise + abuse check. | 2–3d | ~$5–10 |

Each phase is a separate PR behind the standard worktree → CI → merge → prod-verify loop.
