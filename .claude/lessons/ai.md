# Prompts, model calls and judges

Read this before changing a prompt or `src/lib/prompts.js`, the streaming chat or realtime voice session, an LLM judge or rubric, a tactic classifier, or an image-generation spike. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## Validate the validator — Bernard's file paths + worked examples

Caption fidelity gate: `api/_lib/captionFidelity.js` + offline `scripts/voice-fidelity-captions.mjs`, sharing rubric module `api/_lib/captionFidelityRubric.js`; CI gate `scripts/verify-caption-fidelity.mjs`. Full write-up: `memory/feedback_validate_the_validator.md`.

Worked examples of the global judge rules (`~/.claude/lessons/ai.md`, "LLM judges and the gates they drive"):
- **Grader missing the reference:** 2026-05-31, the U1 keystone measured a −0.68 regression that was wrong — the grader never received the transcript it claimed to judge faithfulness against, and rewarded clinical register over faithful warm/personal captions. Rewritten to grade `said_fidelity` against the transcript (PR #1081), the same change measured +1.74.
- **Null score silently disabling the gate:** PR #1881 — `buildFidelityPrompt` returned `{instructions, user}` (AI SDK v7 renamed `system`→`instructions`) but the caller read the nonexistent `.system`, so the judge ran with no system prompt and produced zero parseable scores on 10/10 real long captions — the fidelity gate had been a total no-op since it shipped.
- **Two-stage slice overriding the caller's cap:** `draftAtom` slices the interview to 24k chars for the judge, but `buildFidelityPrompt` re-sliced it to 2500 internally — the judge saw ~13% of the reference (fixed PR #2165).
- **Bigger model, worse judge:** validating the fabrication flag, Sonnet false-positived a real "week four" verbatim in the transcript that Haiku correctly passed — the gate stayed on Haiku (PR #2165).
- **"Fabricated" claim that wasn't:** a GBP patient story flagged as invented was actually verbatim in `interviews.messages` — corrected in PR #2166.
- **Sibling rubric parsers drifted, and the fail-closed gate turned it into a work stoppage:** `answerFidelityRubric.js` ran `JSON.parse` over the judge's WHOLE reply while its older sibling `captionFidelityRubric.js` already extracted the first `{…}` object. Haiku intermittently appends a `**Rationale:**` essay after the JSON, so ~1 in 3 approvals returned `no_dims_parsed` → `gate: 'unscored'` → publish blocked, on a doctor's own answer. Both now share `extractJsonObject()` from `api/_lib/jsonFromModel.js`, and the output contract forbids trailing prose (#2344). **Two rubric modules is two parsers; a fix to one is not a fix to the other.**
- **The safety dimension penalized ordinary public teaching:** it said only "NEVER prescribe treatment or dosing" with no general-vs-individual line, so *"short, quick steps keep you over your feet"* scored safety 5 and held a sound answer at 6.0. Q called it guidance, not prescription. Fixed the grader, not the drafts (#2347) — the line is now GENERAL TEACHING (expected, never penalized) vs INDIVIDUAL INSTRUCTION (unsafe). Old-vs-new on the real queue: every answer's safety rose (running form 6.67→9.0), while three adversarial probes — diagnose-the-reader, dosing, fabricated study — all stayed at safety 1 and blocked. **When loosening a safety rubric, the adversarial probes ARE the evidence; `tests/lib/answerSafetyCalibration.test.js` pins the contract and reverting it reddens 5 of 7.**
- **`said_fidelity` can't gate human-edited text** (the global corpus-vs-human rule in `~/.claude/lessons/ai.md`, discovered here): it scores against topic-scoped practice memory, so Q's own new teaching on hip flexion→hip extension came back as *"invented mechanical specifics not in the source material."* The answer voice check is therefore **advisory, never blocking** (#2351) — see `.claude/decisions.md` 2026-07-25 for the reversal of F16 Phase 1 and its accepted risk. Publishing over a faithfulness flag queues a `topic_backlog` row (`source: 'answer_gap'`) so the corpus catches up instead of re-flagging forever.
- **A scored answer whose score was thrown away:** `draftAnswer()` scores at draft time (and burns a coached regenerate when the first attempt is held), but `authorAnswers.js` — the producer path — never persisted `voiceFidelityScore`/`voiceAudit` onto the row, so producer-authored answers reached the queue unscored. Three of four callers were correct, so a spot-check missed it (#2357). `tests/lib/answerDraftScorePersisted.test.js` pins every caller. **Same shape as the Buffer/bundle divergence: the primitive was fine, one call site wasn't.**

## Streaming chat (/api/stream) conventions

The shared `/api/stream` endpoint and its client wrapper `streamMessage()` in `src/lib/claude.js` are used by every conversational page (InterviewSession, OnboardingInterview, future variants). Two rules to follow when building a NEW page that calls them, or `AI_InvalidPromptError` and retry storms will eat your day:

1. **Inject a silent first-turn user message.** Claude API and the Vercel AI Gateway both require `messages` to contain at least one user message — a system-only request returns `AI_InvalidPromptError` immediately. The canonical pattern (see `InterviewSession.jsx:643`):

   ```js
   const streamInput = currentMessages.length === 0
     ? [{ role: 'user', content: 'Please begin the interview.' }]
     : currentMessages
   for await (const delta of streamMessage(streamInput, systemPrompt, opts)) { ... }
   ```

   The seed message is sent to the stream only; it must NOT be added to the visible transcript or persisted to the row.

2. **Guard the kickoff effect against retry storms.** Any `useEffect` that auto-fires `streamMessage` on mount must have a one-shot ref. Without it, a stream failure clears `streaming` back to false while leaving `messages.length === 0`, and the effect re-fires on every render — producing a ~10 rps hammer on `/api/stream` until the tab closes:

   ```js
   const kickedOffRef = useRef(false)
   useEffect(() => {
     if (loading || streaming || messages.length > 0 || kickedOffRef.current) return
     kickedOffRef.current = true
     runAssistantTurn([], { isFirstMessage: true })
   }, [loading, streaming, messages.length, runAssistantTurn])
   ```

   On error, the user gets the error card with a "Try again" action that page-reloads (resetting the ref). No silent auto-retry. PR #731 fixed both bugs after they hit prod.

## Realtime voice session — system prompt caching pattern

`api/realtime-session.js` mints an OpenAI Realtime client secret. The full system prompt is set in `sessionConfig.instructions` at mint time (not via a post-connect `session.update`) so OpenAI can cache it from token zero.

**Do NOT attempt to port `getInterviewSystemPrompt` server-side.** That function pulls past interviews, practice-memory RAG (concept/agreement/gap vector blocks), staff record, tone, and staffType — replicating those fetches server-side would duplicate the entire interview-context pipeline. The established pattern instead:

1. Browser builds the full prompt via `getInterviewSystemPrompt` (same as today).
2. Browser sends `{ interviewId, systemPrompt: fullPrompt }` in the mint POST body.
3. Server validates and injects it into `sessionConfig.instructions` at mint time; falls back to a 2-sentence bootstrap if the field is absent or too short.
4. Browser still sends `session.update { instructions }` after the data channel opens as a belt-and-suspenders — same content, so OpenAI's cache still hits, and it covers the reconnect path.

The server validates `systemPrompt` as a string with a minimum length (100 chars) and a maximum (32 KB) to prevent abuse; it never logs or stores it.

## Template literal backticks in `src/lib/prompts.js`

All system-prompt functions in `prompts.js` return template literal strings (backtick-delimited). **Any backtick character inside the return value terminates the string and causes an ESLint parse error** (error message: `Parsing error: Unexpected token :`). This includes markdown code formatting: writing `` `[STAGE:n]` `` inside a prompt causes the failure even though it looks like documentation.

Rule: when editing prompt functions in `prompts.js`, use single quotes `'value'`, `[brackets]`, or plain text for any value you'd normally set in backtick-fenced formatting. Never use raw `` ` `` inside a template literal prompt unless you escape it as `` \` ``.

## OLD-vs-NEW harness for a prompt-QUALITY change — Bernard's recipe

Bernard's recipe for the global OLD-vs-NEW harness methodology, applied to a prompt-quality fix that's normally shipped-and-eyeballed ("the output reads better" — CTA flows naturally, voice is warmer). Used 2026-07-08 for the campaign-CTA-flow fix, PR #1994:

1. **Import the real post-fix functions** (`getAtomSystemPrompt` from `api/_lib/atomPrompts.js`, `getTentpolePromptContext` from `api/_lib/tentpoleCampaignContext.js` — both are pure/format-only given a campaign+workspace object; the DB work lives in the separate `loadCurrentTentpole`). Build the NEW system prompt.
2. **Derive OLD by reverting exactly your edits via `String.replace` on the built NEW prompt string** — don't copy+revert whole source files (relative imports break in scratch, and reverting escaped `\n`/em-dash/apostrophe literals with `perl -pi` is error-prone). Assert each revert target `.includes()` before replacing so a stale revert map throws loudly instead of silently testing NEW-vs-NEW. Watch straight `'` vs curly `'` — grep the source (`grep -o "phrase" file | cat -v`) to get the exact byte.
3. **Feed real prod data** pulled via Supabase MCP: the actual active campaign (`campaigns` row: `content_style`/`cta_pitch`/`cta_url`/`cta_label`) and a real interview transcript (`interviews.messages`) thematically matched to it. Never invent inputs — the whole point is to exercise the real read path (see "Probe AI-generation features with the REAL workspace data").
4. **Call the same model the handler uses** — `generateText({ model: 'anthropic/claude-sonnet-4-6', instructions, messages })` via the AI SDK gateway. Set `process.env.AI_GATEWAY_API_KEY` from the 1Password scratch dump inside the harness (never print it).
5. Run OLD + NEW across 2–3 platform/angle combos, print both, and look for the specific defect. The smoking-gun signal for the CTA fix: the campaign's raw `cta_pitch` sentence appeared **verbatim** in every BEFORE output and was **rephrased/bridged** in every AFTER — a concrete pass/fail, not a vibe.

Gotchas: bare `import('ai')` needs repo `node_modules` — ESM does NOT honor `NODE_PATH`, so run the harness file from *inside the repo tree* (`cp` it to the repo root and `node ./_x.mjs`), not from the scratch dir. Clean up the harness AND the env dump (it holds a live key) when done.

## Prompt refactors — update test markers in the same PR

When `getInterviewSystemPrompt` or any other large prompt function changes its structure (sections renamed, reordered, added/removed), the corresponding test assertions in `tests/lib/prompts.test.js` that check for section markers must be updated in the same PR. A test checking `expect(prompt).toContain('PATIENT SCENARIO')` will fail if that section is renamed to `WHAT TO COVER` in the prompt. Lint + build pass (they don't check prompt markers), so the failure is invisible until CI runs tests. **Always update prompt-marker assertions when the prompt structure changes.** (Lesson from evolving-interviewer P1 #1857: first push passed lint/build but failed tests on the new marker names; caught and fixed in a follow-up.)

## Tactic classifiers — lead vs core moves

When building a post-interview classifier that labels which question techniques were used, don't treat all techniques as "repeats" equally. Some moves (like mechanism-push and concrete-metric) are structural deep-dive behaviors that appear in *any* good clinical interview and should never be penalized for recurrence. Others (like case-first, contrarian, steelman) are distinctive opening/framing tactics that should *rotate* across sessions with the same person to maintain novelty. Split the tactic vocabulary into LEAD (rotate + tracked for anti-repeat) and CORE (always available, never flagged as a repeat). Use the shared LEAD_TACTICS array to filter when building an anti-repeat ledger. (Lesson from evolving-interviewer P2 #1859: the first classifier treated all 11 tactics as tracked repeats, flagging mechanism-push as sameness when it's just good structure; the lead/core split fixed it.)

## Image generation spikes — OpenAI model names on this account

The Bernard `OPENAI_API_KEY` (in `.env.bernard.1pw`) is on an account where `dall-e-3` does not exist. Available image gen models are `gpt-image-1`, `gpt-image-1-mini`, `gpt-image-1.5`, `gpt-image-2`, `gpt-image-2-2026-04-21`, `chatgpt-image-latest`. Use `gpt-image-2` for quality. The API uses the standard `/v1/images/generations` endpoint but responses return `b64_json` (not a URL) — decode and write to `/tmp/*.png` before viewing. Supported sizes include `1024x1536` for portrait (close to 9:16).
