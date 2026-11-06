# Nemotron 3.5 for transcription in Bernard — findings (2026-11-03, bake-off added 2026-11-05)

Research only. No code changed. Asked: "research using Nemotron 3.5 for transcription in
Bernard instead of what is currently used — this would be used for adding voice-over to
uploaded videos."

## TL;DR

1. **Bernard has to leave `whisper-1` anyway, by 2027-02-26.** OpenAI announced on 2026-08-26
   that `whisper-1`, `gpt-4o-transcribe` and `gpt-4o-mini-transcribe` all shut down on
   2027-02-26. Bernard uses all three. The named replacement, `gpt-transcribe`, does not
   document word timestamps, which karaoke captions depend on. So this is not a "should we
   swap for fun" question; a swap is forced, and Nemotron is one of three credible targets.
2. **"Nemotron 3.5" is two different speech models.** For transcribing uploaded videos the
   relevant one is **Nemotron 3.5 Transcribe (30B-A4B)**, an offline model released
   2026-10-28 with word timestamps and speaker labels, one hour per request, OpenMDW-1.1
   license. The other, **Nemotron 3.5 ASR Streaming (0.6B)**, is a live-mic model and does not
   fit a batch pipeline.
3. **It cannot run where Bernard runs.** Serving it needs an H100 80 GB (or a Blackwell GPU
   for FP8/NVFP4). It is not on the Vercel AI Gateway and, per late-October sources, not on
   build.nvidia.com. The practical route is a third-party host: DeepInfra exposes it on an
   OpenAI-compatible `/audio/transcriptions` endpoint with `verbose_json` word and segment
   timestamps, SRT/VTT, 60 minutes per request, zero data retention, at $0.002/min
   ($0.12/hr). Whisper is $0.006/min. Speaker attribution is "coming soon" there.
4. **Accuracy is better than Whisper on paper**, but the model card lists hallucinated
   speech as a known risk and says nothing about silence. Bernard's silent-b-roll
   hallucination filter stays regardless of vendor.
5. **Recommendation (updated 2026-11-05 after the bake-off below):** Scribe v2 via the gateway is the default to ship for the February deadline; it beat Whisper on real clinic footage on every axis karaoke captions care about, and Gemini returned nothing. Nemotron, measured afterwards, has the best word timing of the four but invents fluent sentences on silent b-roll that the hallucination filter cannot catch, so it is not the b-roll default; it is the better choice for a clean-audio lane or as a voice-over script source behind an energy gate. Original plan: run one bake-off harness
   on real Bernard assets across the three candidates that keep word timestamps:
   `elevenlabs/scribe-v2` (already on the gateway, already a vendor), Nemotron 3.5 Transcribe
   via DeepInfra, and `google/gemini-3.5-transcribe` (gateway). Pick on measured timestamp
   quality on karaoke-baked reels and hallucination on silent clips, not on WER tables.
   Scribe v2 is the lowest-friction default; Nemotron is the cost leader and the only one
   with instruction-controlled "readable" transcripts, which is genuinely useful for turning
   a rambling clip into a voice-over script.

## What Bernard uses today

| Call site | Model | Output used | Notes |
|---|---|---|---|
| `api/_lib/whisper.js` (shared helper) | `whisper-1`, direct REST to `api.openai.com` | SRT, segments, **words**, plain text | 24 MB cap; hallucination filter; feeds `brandRenderVideo.js`, `karaokeCaptions.js`, `segmentDetect.js`, `callTranscript.js`, `renderClipCore.js`, `reelFactory.js` |
| `api/_lib/seminarTranscribe.js` | `whisper-1` inline | text | ffmpeg-chunks to 10-min mono MP3, 6 concurrent |
| `api/voice-memo.js`, `api/handout/create.js`, `api/demo/transcribe.js` | `whisper-1` inline | text | three more copies of the same multipart call |
| `api/realtime-session.js`, `api/_lib/twilioSip.js` | `gpt-4o-mini-transcribe` / `gpt-4o-transcribe` | live interview transcript | also on the 2027-02-26 shutdown list |
| `src/lib/costEstimate.js` | — | $0.006/min | rate constant to update with any swap |

The helper's own header says "provider swaps happen here". There is one seam plus four
inline copies, so a swap is a small code change; the work is in verification.

**The feature that constrains the choice is karaoke captions.** `transcribeToWords` returns
per-word `start`/`end`, keeps zero-duration words (Whisper quantises), and
`karaokeCaptions.js` builds ASS `\k` timing from them, mirrored in the client preview. Any
replacement must return word timestamps of comparable quality, or reels break in a way no
gate catches (same mirror-pair class as #2707).

## The forcing function: OpenAI's shutdown

From OpenAI's deprecations page (fetched 2026-11-03):

| Model | Announced | Shutdown | Replacement |
|---|---|---|---|
| `whisper-1` | 2026-08-26 | **2027-02-26** | `gpt-transcribe` / `gpt-live-transcribe` |
| `gpt-4o-transcribe` | 2026-08-26 | 2027-02-26 | same |
| `gpt-4o-mini-transcribe` | 2026-08-26 | 2027-02-26 | same |

OpenAI's speech-to-text guide states `timestamp_granularities[]` "is only supported for
`whisper-1`" and documents `gpt-transcribe` output as JSON `text` + `languages` only.
`gpt-transcribe` is $0.0045/min. So the vendor's own replacement is a step back for
Bernard's main use. That is sixteen weeks from today.

## Nemotron 3.5 Transcribe — what it actually is

Sources: NVIDIA docs page (`docs.nvidia.com/nemotron/nightly/nemotron/transcribe35`), the
Hugging Face model card (`nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B`), DeepInfra's launch
post, Cekura's write-up.

- **Architecture:** 0.6B Transformer ASR encoder + Nemotron 3 diarization speaker encoder on
  a Nemotron 3.5 Lightning hybrid Mamba-Transformer MoE backbone. ~34B total, ~4.3B active.
- **Tasks:** transcription (verbatim or readable, prompt-controlled), vocabulary/context
  biasing, speaker-attributed transcription, word timestamps, translation, language ID,
  audio Q&A (English only).
- **Input:** 16 kHz mono, trained to one hour, 65,536-token context. Offline only; not a
  streaming recognizer.
- **Timestamps:** word `start`/`end`/`speaker` under `ctc_timestamps`, produced by CTC
  alignment heads. Requires the V1 vLLM model runner and is unavailable with the DFlash2
  speculative decoder. The card says to check the returned `error` before trusting them.
- **Accuracy (model card, captured 2026-10-12):** Open ASR nine-set mean WER 4.71; long-form
  mean 10.98 (vs Parakeet-TDT-0.6B-v3 13.37). Cekura cites the 11-set leaderboard at 5.33
  vs Whisper large-v3 7.16. Note `whisper-1` is the API Whisper, not large-v3, and the
  leaderboard measures read/broadcast speech, not clinic iPhone footage.
- **Known risks (model card):** hallucinated speech, wrong language choice, speaker
  misattribution, rare generation loops, slow first requests while kernels warm. Nothing
  specific about silence or music.
- **Hardware:** reference 1x H100 80 GB (BF16); FP8 on L40S/RTX PRO 6000; NVFP4 needs
  Blackwell. Not runnable on Vercel Functions.
- **License:** OpenMDW-1.1, "ready for commercial use".

### Where it can be called from

| Route | Status (2026-11-03) | Timestamps | Price | Notes |
|---|---|---|---|---|
| Vercel AI Gateway | **Not listed.** 16 transcription models in the catalog; every NVIDIA entry is a chat model | — | — | Bernard's gateway is the obvious seam and it is closed |
| build.nvidia.com NIM | Not listed as of late October (two third-party guides) | — | — | re-check before deciding |
| **DeepInfra** (`api.deepinfra.com/v1/openai`) | Live | `verbose_json` word + segment, SRT, VTT | $0.002/min | 60 min/request, zero data retention, speaker attribution "coming soon" |
| OpenRouter | Live, routes to DeepInfra | via `verbose_json` "if provider supports" | $0.000033/s (same) | JSON body with base64, not multipart |
| Self-host (vLLM 0.32 + NeMo Speech plugin) | Possible | full feature set | GPU time | needs an H100 or Blackwell box; a new ops surface Bernard does not have |

DeepInfra's endpoint is OpenAI-compatible, so the swap in `whisper.js` is a base URL, a
model id and a key. What it does NOT give today is speaker labels, which `callTranscript.js`
and `transcribeWithSpeakers` would want eventually (today they get none from Whisper either,
so that is parity, not a regression).

## Nemotron 3.5 ASR Streaming (0.6B) — the other one

Released 2026-06-04. Cache-aware streaming, 80 ms to 1.12 s chunks, 40 locales of which 19
are "transcription-ready". FLEURS WER ~8.8 to 10.4% on those locales. This is a live-mic
model; it is the candidate for the realtime interview path (`api/realtime-session.js`,
which also loses its model on 2027-02-26), not for uploaded videos. Not on the gateway
either; hosted on Together ($0.0045/min) and others.

## Alternatives that stay on the AI Gateway

The gateway catalog (fetched 2026-11-03) lists 16 transcription models. The ones that keep
word timestamps:

| Model | Word timestamps | Diarization | Price (per hr audio, per Cekura/vendor) | Fit |
|---|---|---|---|---|
| `elevenlabs/scribe-v2` | yes, default | yes, up to 32 speakers | ~$0.22 | Already a Bernard vendor (TTS + voice clone). Timestamps come back in `providerMetadata.elevenlabs.words`. Beta on the gateway. |
| `google/gemini-3.5-transcribe` | per gateway docs, segments "when the model provides them" | unverified | token-priced ($2/$12 per 1M) | unverified timestamps; check before shortlisting |
| `microsoft/mai-transcribe-2` | yes (`timestamps: 'word'`) | yes | unverified | rejects WebM/MP4 input; needs audio extraction first |
| `openai/whisper-1` | yes | no | $0.36 | dies 2027-02-26 |
| `mistral/voxtral-small-transcribe-3` | unverified | unverified | ~$0.24 | AA-WER 2.8%, same as Nemotron's own claim |

Gateway caveat: speech-to-text is "in beta and access is rolling out gradually", and it
takes base64 JSON, not multipart. The AI SDK `transcribe()` call handles that (needs
`ai` 7.0.31+; Bernard is on `^7.0.92`).

## Cost reality

Transcription is a rounding error for Bernard. At 100 hours of audio a year: Whisper $36,
Scribe v2 $22, Nemotron $12. The price delta does not justify a vendor on its own; the
decision is timestamp quality and operational risk.

## Fit for the voice-over use case

Adding voice-over to an uploaded video needs three things from transcription:

1. **A script.** Nemotron's prompt-controlled "readable" mode ("omit fillers and accidental
   repetitions, keep the wording") is the one capability none of the others document. For
   a clinician's rambling clip that becomes a narrated reel, that is a real advantage, and it
   also accepts a vocabulary prompt (clinic terms, names) that Whisper capped at 224 tokens.
2. **Timing.** Word timestamps to place narration against the footage and to keep karaoke
   captions in sync with the new voice. All three shortlisted candidates claim this; none is
   verified on Bernard's footage.
3. **Voice.** Already solved: `api/tts.js` streams ElevenLabs with the clinician's live clone
   when one exists. No change.

So the voice-over feature is not blocked on the transcription vendor; it is blocked on
nothing in this layer. The vendor choice matters for script quality and caption timing.

## What a decision needs (the bake-off)

One throwaway harness, same shape as the OLD-vs-NEW recipe in CLAUDE.md:

- Pull ~20 real `media_assets` with existing `transcript_words` (mix: interview, b-roll
  with speech, silent b-roll, a 40-min seminar chunk, one iPhone clip with the spatial-audio
  track).
- Run each through Whisper (baseline), DeepInfra Nemotron, gateway Scribe v2, gateway
  `gemini-3.5-transcribe`.
- Measure: (a) word-timestamp drift vs Whisper on 10 sampled words per clip, (b) whether
  silent clips come back empty or with invented speech, (c) count of zero-duration words
  (the karaoke code assumes Whisper's quantisation), (d) max accepted file size and the
  per-request duration cap, (e) wall time per minute of audio.
- Bake one reel per vendor with `renderSegmentToReel` and look at the karaoke.

Only then pick, then do the swap in `whisper.js` plus the four inline callers, update
`costEstimate.js`, and keep `isHallucinatedTranscript` in place for every vendor.

## Bake-off results (2026-11-05) — measured on 20 real `media_assets`

Harness: `scripts/transcription-bakeoff.mjs` (runs the clips) + `scripts/transcription-bakeoff-render.mjs`
(bakes each vendor's words into the real clip with the production `buildKaraokeAss` → ffmpeg-static
`ass=` filter and tiles frames). Nothing is written to the DB or blob storage. Audio is extracted once
per clip with ffmpeg (16 kHz mono MP3) so every vendor hears identical bytes. 731 s of audio in total:
16 spoken clips (interview + b-roll with speech, 13–114 s) and 4 quiet b-roll clips (mean −31 to −36 dB).

| vendor | route | ok | median wall / clip | words (stored Whisper = 1460) | zero-duration words | stacked-start words | silent-clip hallucination | speakers labelled | total wall for 731 s audio |
|---|---|---|---|---|---|---|---|---|---|
| `whisper-1` (fresh run) | OpenAI direct | 20/20 | 2.8 s | 1505 | 6.6 % | 4.9 % (12 clips) | 1 ("Thank you for watching my video", caught by filter) | 0 | 56 s |
| Scribe v2 | ElevenLabs direct | 20/20 | 1.3 s | 1701 | 2.5 % | 0.9 % (9 clips) | 0 | 14 clips ≥2 speakers | 26 s |
| Scribe v2 | AI Gateway REST | 20/20 | 1.7 s | 1709 | 3.2 % | 1.4 % (9 clips) | 0 | 14 clips | 36 s |
| `gemini-3.5-transcribe` | AI Gateway REST **and** AI SDK 7.0.163 `transcribe()` | 20/20 HTTP 200 | 1.9 s | **0 on every clip** | – | – | – | – | 39 s |
| Nemotron 3.5 Transcribe | DeepInfra | run later same day, see next subsection | | | | | | | |

"Stacked-start" = a word whose start equals the previous word's start. That is the karaoke pile-up
artefact: the bake renders both words in the same 10 ms slot and the line reads as duplicated or
garbled speech. Timing agreement between Scribe and fresh Whisper on words both heard: median offset
0.02 s, p90 0.36 s, so the two mostly agree on *when*; the disagreement is on *what* and on gaps.

What the numbers and the baked frames actually showed:

- **Whisper drops speech on noisy clips.** Asset `647aecbc` (48 s, a crowd/gym clip): Whisper returned
  17 words, Scribe 64. Baked, the Whisper caption "got this What's up Thanks" sits on screen for ~15 s
  while people are clearly talking; the Scribe bake follows the conversation ("You do this every year?
  No, this is our first time"). This is the current production behaviour.
- **Whisper's stacked zero-duration words are visible in the bake.** On `0f236696` the Whisper line
  reads "Keep it in Keep it" and "in If you're blue stay"; the Scribe bake of the same seconds reads
  "Squeeze your abs. Tight," and "Squeeze your glutes. Stay". Scribe also returns punctuation, which the
  karaoke line-grouper currently throws away but a voice-over script would keep.
- **Silence: Scribe returns empty, Whisper invents.** On the quietest clip (`4b9880b6`, −34 dB) Whisper
  produced the classic "Thank you for watching my video" (the filter caught it); both Scribe routes
  returned nothing. On the other three quiet clips there IS faint real speech and the vendors disagree
  on how much of it to transcribe. Keep `isHallucinatedTranscript` on whichever vendor wins; it cost
  nothing and still fired once in 20.
- **Scribe is not deterministic between routes.** Same model, same bytes: direct vs gateway differed on
  two quiet clips (`00cb52bd`: 0 vs 18 words; `bb736750`: 4 vs 0) and by ±1–3 words on four spoken
  ones. Timing on shared words was identical. Expect run-to-run variance on marginal audio.
- **Gemini 3.5 Transcribe is unusable through the gateway today.** HTTP 200, 336 audio input tokens
  billed, zero output tokens, empty `text`, empty `segments`, no warning, on all 20 clips, as MP3 and as
  WAV, with and without a language hint, via REST and via the current SDK. Gateway cost metadata still
  charged $0.0097 for a 109 s clip ($0.32/hr, 3× Scribe's $0.0033 on the same clip). Not a request-shape
  problem on our side; a provider/gateway-beta problem. Re-check before ever shortlisting it again.
- **Nemotron was measured later the same day** once Q minted a DeepInfra key; see "Nemotron measured" below.
- **One Scribe frame showed two caption lines overlapping** ("good, you're good." drawn over "tight, tight.
  Oh. You're") on `0f236696`. That is `groupWordsIntoLines` producing two Dialogue events whose windows
  overlap when a word's `end` runs past the next line's `start`; it is a property of the line grouper,
  not the vendor, and Whisper's quantised ends happen to hide it. Worth a clamp in `buildKaraokeAss`
  (end of line N ≤ start of line N+1) before any vendor swap.

**Reading:** on real clinic footage Scribe v2 beats the incumbent on every axis this feature cares
about (fewer stacked words, no silent-clip invention, keeps speech Whisper drops, 2× faster, speaker
labels for free, same vendor as the voice clone), and it is already reachable through the gateway with
word timing in `providerMetadata.elevenlabs.words`. Nemotron was then measured (next subsection): best word timing of the four, but it invents speech on
quiet clips, which disqualifies it for b-roll without an energy gate. Scribe v2 stays the default.

### Nemotron measured (2026-11-05, later the same day, once a DeepInfra key existed)

Same 20 clips, same cached audio, re-run with `whisper`, `scribe`, `nemotron` (bare) and
`nemotron-prompt` (`language=en` plus a one-line clinic-gym vocabulary prompt). DeepInfra route,
OpenAI-compatible `verbose_json`. Second Scribe run included so run-to-run variance is visible.

| vendor | words (stored Whisper = 1460) | zero-duration | stacked-start | timing vs fresh Whisper (median / p90 abs) | word edit rate vs Whisper | speakers | realtime factor |
|---|---|---|---|---|---|---|---|
| whisper-1 | 1524 | 6.7 % | 4.7 % | – | – | none | 12× |
| Scribe v2 (run 2) | 1781 | 3.3 % | 1.2 % | 0.02 s / 0.36 s | 0.40 | 15 clips | 28× |
| Nemotron bare | 1679 | **0.0 %** | 1.9 % | −0.02 s / 0.31 s | 0.43 | none via DeepInfra | 16× |
| Nemotron + prompt | 1690 | **0.0 %** | 1.7 % | −0.01 s / **0.28 s** | 0.39 | none | 17× |

**Word timing: Nemotron is the best of the four.** No zero-duration words at all (its CTC alignment
gives every word a real span), the tightest agreement with Whisper on shared words, and stacked words
well under Whisper's. On clean, close-mic speech the transcripts are near-identical to Scribe's
(clip `35baf738` differs by one full stop; the 109 s Gary interview differs mostly in filler words
Scribe keeps and Nemotron drops, which is the "readable" bias the model card describes).

**Content on hard audio: Nemotron is the worst of the four, and in the way that matters most for
b-roll.** It invents fluent speech where there is none or where the audio is faint:

- `4b9880b6` (5 s, −34 dB, two people doing a balance drill, no real speech): Scribe returned
  nothing; Whisper returned its stock "Thank you for watching my video", which the filter catches;
  Nemotron returned *"I don't think that law is still very common nowadays. I certainly use it when I
  tell people, though."* and with the prompt *"Oh, wait. So while she's getting ready, can someone get
  her a mirror?"* Both are fluent, specific, and pass `isHallucinatedTranscript`, which only knows
  Whisper's filler phrases. Baked, that sentence sits in orange karaoke over a silent exercise clip.
- `0f236696` (13 s, loud gym, a clinician shouting cues): Scribe and Whisper both got "Stay tight in
  the middle"; Nemotron bare produced *"Hey Michael, remember, we did it. Mike this, Oh, you said, she
  Easter did"*, identical on three repeats (so deterministic, not a sampling fluke). The prompt
  recovered about half of it.
- `00cb52bd`, `f5f870f9` (faint speech under noise): Nemotron produced plausible but wrong sentences
  ("Is there room for the potato") where Scribe produced the right ones.

A vocabulary prompt helps Nemotron measurably on noisy speech (edit rate 0.43 → 0.39, p90 timing
0.31 → 0.28 s) and does nothing for silence. There is no per-word confidence in DeepInfra's response
to gate on, and the model card's `no_speech_prob`/`avg_logprob` fields come back as literal zeros.

**Scribe is not deterministic either.** Run 1 vs run 2 on the same bytes: `00cb52bd` went from 0 words
to 77; `bb736750` from 4 to 4 with different text; the spoken clips moved by ±1–6 words. Timing on
words both runs heard was identical. Any vendor's result on marginal audio is a sample.

**Reading after measuring Nemotron:** it does not change the recommendation. For a product whose
input is clinic b-roll, where a large share of clips are quiet or ambient and every transcript is
burned into a public reel, a model that returns nothing on silence beats one with better timing that
returns a confident sentence. Nemotron's timing edge (no zero-duration words, p90 0.28 s) is real and
would make it the pick for a clean-audio workload like the longform interview lane, but it would
need a silence/energy gate in front of it that Scribe does not need. Scribe v2 via the gateway stays
the default for the February swap. The one thing worth carrying from Nemotron: its "readable"
transcript is a better voice-over script source than Scribe's verbatim one, so a future voice-over
feature could call it on clips the energy gate has already passed.

Contact sheets for every claim above are reproducible with `transcription-bakeoff-render.mjs`
against the `out2` run; the two decisive ones are `647aecbc` (Scribe vs Nemotron+prompt tracking a
crowd) and `4b9880b6` (Nemotron captioning silence).

### Shipped (2026-11-05)

Batch transcription moved to Scribe v2 in `api/_lib/transcribe.js` (replaces `whisper.js`): all five
exported shapes kept, segments and SRT derived from Scribe's word stream with pure tested helpers,
`transcribeWithSpeakers` now returns real speaker turns, `transcribeBufferToText` added for the four
handlers that held upload bytes (voice memo, handout, demo, seminar chunks), which no longer call
OpenAI directly. The hallucination filter stays. `buildKaraokeAss` now clamps each line's End to the
next line's Start (the overlap found above). `ELEVENLABS_API_KEY` already existed on prod and preview.
The two realtime paths (`realtime-session.js`, `twilioSip.js`) are a different, streaming problem; see
the Realtime section below.

## Realtime interview paths (2026-11-05)

Both live-interview paths (`api/realtime-session.js` for the browser WebRTC interview, `api/_lib/twilioSip.js`
for the outbound phone call) get their user-side transcript from `audio.input.transcription.model` INSIDE
OpenAI's speech-to-speech session: the deltas arrive on the same data channel / SIP session as Bernard's
voice. That makes the model choice inseparable from the OpenAI session. A second stream to
`elevenlabs/scribe-v2-realtime` would need the browser to fork the microphone into a second WebSocket
(and reconcile two transcripts of one utterance), and the SIP path never has the audio server-side at all.
So the realtime half stays on OpenAI, on whichever model it names as the successor.

Checked against the vendor's own pages on 2026-11-05 (raw HTML, not a summary):

| Source | What it says |
|---|---|
| `developers.openai.com/api/docs/deprecations` | `whisper-1`, `gpt-4o-transcribe`, `gpt-4o-mini-transcribe` (+ dated variants, `-diarize`): shutdown 2027-02-26, replacement **`gpt-live-transcribe` or `gpt-transcribe`** |
| `…/guides/realtime-transcription` | "Start with `gpt-live-transcribe`" — "returns transcript deltas as speech arrives and a final transcript when your application commits each audio turn"; `gpt-transcribe` only when transcription must begin after a committed turn or you need detected-language output |
| `…/reference/…/client_secrets/create` | `session.audio.input.transcription.model` for a `type: "realtime"` session enumerates `gpt-live-transcribe` and `gpt-transcribe` alongside the retiring ids |
| Empirical mint | `POST /v1/realtime/client_secrets` with `gpt-realtime-2.1` + `transcription: { model: 'gpt-live-transcribe' }` returned 200 and echoed the model back (same for `gpt-transcribe`); 60-second secret, nothing else created |

Shipped: both paths now set `gpt-live-transcribe`. The `.delta` cadence the browser UI relies on
(`PhoneCall.jsx` renders `conversation.item.input_audio_transcription.delta` as an italic partial turn,
then promotes on `.completed`) is exactly what the vendor documents for this model; `gpt-transcribe` was
not chosen because it waits for the committed turn, which is the whisper-1 behaviour we moved away from.
The client's hallucination filter (`isLikelyWhisperHallucination`, short-speech suppression) is unchanged
and still applies. `tests/lib/transcribeShapes.test.js` now pins both files to `gpt-live-transcribe` and
fails if any `api/` file names a shutdown-listed transcription model again.

Still OpenAI-dependent, by design: `gpt-realtime-2.1` itself (the voice model) has no announced shutdown.
Re-check the deprecations page when it does.

### Reproducing

From the repo root, with the keys exported from the 1Password mount (`SUPABASE_SERVICE_KEY`,
`OPENAI_API_KEY`, `ELEVENLABS_API_KEY`, `AI_GATEWAY_API_KEY`, optional `DEEPINFRA_API_KEY`):

```
node scripts/transcription-bakeoff.mjs --ids <ids.txt> --out <dir> --concurrency 3
node scripts/transcription-bakeoff-render.mjs --out <dir> --asset <uuid> --url <blob_url> --vendors whisper,scribe
```

`nemotron` and `nemotron-prompt` need `DEEPINFRA_API_KEY` on the mount (present since 2026-11-05). The 20 asset ids used:
`fc1c28ad 876872d8 46013c99 449637f4 35baf738 da222163 996cb7e4 0f236696 c4fae4b8 07d1d45d 16b45b86
26a2a5a1 383aab99 647aecbc 5342c5fc 3d100ef5` (spoken) and `4b9880b6 f5f870f9 bb736750 00cb52bd`
(quiet b-roll); full UUIDs resolve with `select id from media_assets where id::text like '<prefix>%'`.
Note the repo's `node_modules` carried `ai` 7.0.2 against a declared `^7.0.92`; the harness uses plain
REST for the gateway so it does not depend on that.

## Things not verified here

- DeepInfra's maximum upload size for this model (not stated anywhere found).
- ~~Whether DeepInfra's `verbose_json` words carry the `speaker` field the model produces.~~ They do not (2026-11-05): no `speaker` on any word, `no_speech_prob`/`avg_logprob` are literal zeros.
- ~~Whether `google/gemini-3.5-transcribe` returns word-level timing through the gateway.~~ Measured 2026-11-05: it returns nothing at all through the gateway (see bake-off results).
- Whether Nemotron 3.5 Transcribe is on build.nvidia.com today (sources are late October).
- ~~Any WER on actual clinic footage for Nemotron.~~ Measured 2026-11-05 on the same 20 clips; see the bake-off section.

## Sources

- NVIDIA Nemotron 3.5 Transcribe docs: https://docs.nvidia.com/nemotron/nightly/nemotron/transcribe35/README.html
- Model card: https://huggingface.co/nvidia/NVIDIA-Nemotron-3.5-Transcribe-30B-A4B
- Streaming model card: https://huggingface.co/nvidia/nemotron-3.5-asr-streaming-0.6b
- DeepInfra launch post: https://deepinfra.com/blog/nvidia-nemotron-3-5-transcribe-release
- OpenRouter listing: https://openrouter.ai/nvidia/nemotron-3.5-transcribe
- Cekura write-up (benchmarks, hosted prices): https://www.cekura.ai/blogs/nemotron-3-5-transcribe
- Vercel AI Gateway speech-to-text: https://vercel.com/docs/ai-gateway/modalities/speech-to-text
- Vercel AI Gateway transcription catalog: https://vercel.com/ai-gateway/models?modality=audio:transcription
- OpenAI deprecations: https://developers.openai.com/api/docs/deprecations
- OpenAI pricing: https://developers.openai.com/api/docs/pricing
- OpenAI speech-to-text guide: https://developers.openai.com/api/docs/guides/speech-to-text
- ElevenLabs models: https://elevenlabs.io/docs/overview/models
- Together AI (streaming model pricing): https://www.together.ai/models/nvidia-nemotron-35-asr
