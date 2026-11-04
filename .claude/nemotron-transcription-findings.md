# Nemotron 3.5 for transcription in Bernard — findings (2026-11-03)

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
5. **Recommendation:** do not adopt Nemotron on its own merits yet. Run one bake-off harness
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

## Things not verified here

- DeepInfra's maximum upload size for this model (not stated anywhere found).
- Whether DeepInfra's `verbose_json` words carry the `speaker` field the model produces.
- Whether `google/gemini-3.5-transcribe` returns word-level timing through the gateway.
- Whether Nemotron 3.5 Transcribe is on build.nvidia.com today (sources are late October).
- Any WER on actual clinic footage. Every number above is a public benchmark.

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
