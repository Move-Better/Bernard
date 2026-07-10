# F1 — "Bernard picks up the phone" (outbound call) · v1 runbook

**Status:** ✅ **LIVE-VERIFIED 2026-07-10.** First provisioned call ran end-to-end: Bernard dialed Q, interviewed him, and autonomously produced an on-brand blog draft — dial → SIP-bridge → OpenAI accept (SIP-header correlation + webhook signatures all confirmed) → dual-channel recording → transcribe → generate → completion cascade. **v1.1 shipped** to fix three things the pilot surfaced (below). Env is provisioned on prod; `movebetter` is allowlisted.

**Pilot-call learnings → v1.1 fixes:**
- Cut the clinician off on a mid-thought pause → `turn_detection` switched to **semantic_vad, eagerness 'low'** (model decides end-of-turn by meaning, not a silence timer).
- Ran to ~10 min and the OpenAI session went quiet → **~6-min prompt time-box** (Bernard wraps up warmly) + **`<Dial timeLimit="480">`** 8-min hard cap so a call can never dead-air.
- Transcript came through as one merged block → **dual-channel split** (ffmpeg; ch0=user/left, ch1=assistant/right — mapping confirmed on the real recording) → proper speaker-separated turns.
- Story titled with the generic placeholder "Your weekly call" → **auto-title** from the transcript: `"July 10, 2026 — <derived topic>"` (full date + Haiku-derived subject).

**Decided (Q, 2026-07-10):** Provider = **Twilio SIP + OpenAI Realtime** (Bernard owns the loop). Pilot rings **Dr. Q** on **movebetter**. Opener = **ultra-light / standing-consent**. No-answer = **silent → in-app nudge only**. Trigger = **manual** (cadence automation is a fast-follow).

---

## What v1 does

1. `POST /api/producer/outbound-call { staffId }` (owner-only, movebetter-only) creates an interview row, assembles the call's system prompt server-side (reusing the SAME pure builders the in-app voice interview uses + the clinician's style ledger + "what Bernard already shipped this week"), stashes it on the row, and dials the pilot number via Twilio.
2. Twilio bridges the answered call to OpenAI's SIP connector. OpenAI fires `realtime.call.incoming` → `POST /api/webhooks/openai-realtime` accepts it with the stashed instructions. Bernard drives the conversation (ultra-light opener, then the interview).
3. Twilio records dual-channel; on hangup `POST /api/webhooks/twilio-recording` transcribes it, generates the blog server-side, writes it to the interview, and runs the same enrichment the in-app interview does (content_items, style ledger, RAG index, strategist re-plan, book-stale, voice phrases).
4. If unanswered, `POST /api/webhooks/twilio-status` marks the interview abandoned — no voicemail/retry; the Home "your weekly call" nudge stands.

## Files
- `api/_lib/outboundCall.js` — server-side prompt assembly + browserless transcript→outputs (**verified on real data**).
- `api/_lib/twilioSip.js` — Twilio originate + OpenAI accept (fetch, no SDK).
- `api/_lib/callTranscript.js` — recording → transcript turns.
- `api/_routes/producer/outbound-call.js` — the manual trigger.
- `api/_routes/webhooks/openai-realtime.js` — OpenAI accept webhook.
- `api/_routes/webhooks/twilio-recording.js` — recording → content completion.
- `api/_routes/webhooks/twilio-status.js` — no-answer handling.

---

## Provisioning (one-time, Q + me together)

### 1. Prereqs — BAAs (healthcare account)
- [ ] **Twilio BAA** signed (Twilio Console → Trust Hub / support).
- [ ] **OpenAI BAA** on the API org (with Zero-Data-Retention). The pilot uses the existing Bernard `OPENAI_API_KEY` account.

### 2. Twilio
- [ ] Buy one voice-capable phone number → this is Bernard's caller ID (`TWILIO_FROM_NUMBER`).
- [ ] Confirm the account can place outbound calls to the pilot number's region.
- No SIP trunk needed for the outbound direction — we bridge via inline TwiML `<Dial><Sip>` (see `twilioSip.js`). The SIP trunk config in the Twilio blog posts is for *inbound*.

### 3. OpenAI Realtime SIP
- [ ] Confirm the account has **Realtime SIP calling** enabled (shipped May 2026).
- [ ] Note the **project id** for the SIP URI → `OPENAI_REALTIME_PROJECT_ID` (`proj_…`).
- [ ] Platform → Project → **Webhooks**: add an endpoint `https://withbernard.ai/api/webhooks/openai-realtime` subscribed to `realtime.call.incoming`. Copy the signing secret → `OPENAI_WEBHOOK_SECRET` (`whsec_…`).

### 4. Env vars (Vercel `bernard` project — prod + preview)

| Var | Sensitivity | Value |
|---|---|---|
| `TWILIO_ACCOUNT_SID` | **Mildly sensitive** | Twilio account SID (`AC…`) |
| `TWILIO_AUTH_TOKEN` | **Sensitive** | Twilio auth token — also the webhook-signature key |
| `TWILIO_FROM_NUMBER` | **Mildly sensitive** | Bernard's caller-ID number, E.164 (`+1…`) |
| `OPENAI_REALTIME_PROJECT_ID` | **Mildly sensitive** | `proj_…` for the SIP URI |
| `OPENAI_WEBHOOK_SECRET` | **Sensitive** | `whsec_…` from the OpenAI webhook |
| `OUTBOUND_CALL_PUBLIC_URL` | **Not sensitive** | `https://withbernard.ai` (host webhooks call back to) |
| `OUTBOUND_CALL_PILOT_NUMBER` | **Sensitive** (personal #) | Q's mobile, E.164 — the ONLY number v1 can dial |
| `OUTBOUND_CALL_ENABLED_WORKSPACES` | **Not sensitive** | `movebetter` |

Reuses existing: `OPENAI_API_KEY`, `AI_GATEWAY_API_KEY`, `SUPABASE_URL`, `SUPABASE_SERVICE_KEY`.
Store all Sensitive values in 1Password (Bernard vault) per the 1Password template; add to Vercel via `vercel env add … --force --yes --value …`.

### 5. Enable the pilot
- [ ] `movebetter` must have `realtime_voice_enabled = true` (it does — voice-for-all shipped).
- [ ] Set `OUTBOUND_CALL_ENABLED_WORKSPACES=movebetter`.
- [ ] Redeploy prod so the functions pick up the env.

---

## First live smoke (the parts code can't self-verify)

Trigger (from an authed browser tab on `movebetter.withbernard.ai`, as owner):
```js
await window.Clerk.session.getToken().then(t =>
  fetch('/api/producer/outbound-call', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${t}` },
    body: JSON.stringify({ staffId: 'ecc80e20-40af-49dd-9879-e79f65656e6b' }), // Dr. Q
  }).then(r => r.json()))
```
Then confirm, in order:
1. **Dial** — Q's phone rings from `TWILIO_FROM_NUMBER`.
2. **Accept** — Bernard speaks the ultra-light opener within a couple seconds of answer (checks the `realtime.call.incoming` → accept webhook + SIP-header correlation).
3. **Converse** — natural back-and-forth; watch for silence-hallucination (autonomous `create_response:true`; VAD is tuned less sensitive — adjust `threshold`/`silence_duration_ms` in `twilioSip.js` if Bernard talks over pauses or to himself).
4. **Complete** — after hangup, within ~2 min the interview flips to `completed` with a blog draft, a `content_items` blog row appears, and `/week` re-plans. Check `vercel logs --status-code 500 --expand` + the `[webhooks/twilio-recording]` tag if not.
5. **No-answer** — separately, let it ring out; interview → `abandoned`, no voicemail.

### Known SMOKE-PENDING details to nail on that call
- **Dual-channel transcript**: v1 transcribes the mixed recording into one combined turn. Confirm quality; then split channels for true speaker-attributed turns (`callTranscript.js` marker).
- **SIP-header surfacing**: confirm `X-Bernard-Interview` arrives in the webhook's `sip_headers`.
- **Webhook signature formats**: confirm the OpenAI (`webhook-signature`) + Twilio (`x-twilio-signature`) verifiers pass on real requests.

---

## Deliberately deferred (fast-follows, not v1)
- **Cadence automation** — fire the call off `cadence_policy`/`cadenceAdaptive.js` instead of a manual trigger.
- **Phone-number schema** — v1 hardcodes the pilot number in env; multi-clinician needs a `staff.phone_e164` column + consent flag + a per-workspace `outbound_call_enabled` column (replaces the env allowlist).
- **Moment-mining** — segment/scoreMoments key off `media_assets`, not the interview transcript; register the call recording as a media_asset to feed the moment feed.
- **Full RAG grounding in the opener** — v1 uses the style ledger + shipped-this-week; add the concept/agreement/gap blocks + own-history.
- **Live WS observer** — for real-time in-call tooling (remote MCP, in-call supersession resolution) instead of record-then-transcribe. Needs a non-Vercel always-on host.
- **Cascade unification** — extract the `interviews.js` completion cascade into a shared helper both it and `twilio-recording.js` call (v1 mirrors it directly).

_Keep file — human-authored provisioning doc, per the `.claude/` scratch-vs-keep convention._
