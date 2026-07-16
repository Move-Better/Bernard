# "Post" — one-off post composer (build plan)

**Status:** design signed off (Q, 2026-07-16). Ready to build.
**Mockup (spec):** Artifact → https://claude.ai/code/artifact/46245332-ae51-44d7-a77a-a8395fab60d0 · source `.claude/mockups/post-composer-mockup.html`

## One line
Let users create individual, one-off posts that don't come from an interview — by **evolving the existing `/new/brief` screen into a manual-first "Post" composer**, not building a new surface.

## The key finding that shaped this
`/new/brief` ("Brief") already does write-once-fan-out-to-channels with **no interview**, and the `briefs` table (`supabase/multitenant/migrations/129_briefs.sql`) already has every field the four post types need: `body`, `event_at`, `location`, `cta_url`, `cta_label`, `media_url`, `selected_outputs[]`. `content_items.brief_id` already links generated posts back. So this is **reuse + a mode flag, not a rebuild.**

## Decisions locked (from the design interview)
| Decision | Choice |
|---|---|
| Direction | Manual composer **base** + optional Bernard polish (per-post) |
| Post types to serve | Announcements · promotions/offers · photo & video shares · timely/reactive |
| Approach | **Evolve `/new/brief`**, don't build a separate composer |
| Publish | **Post now · Schedule · Save draft** — user's call, per post |
| Name | **"Post"** |
| Entry points | **`/new` capture picker only** — no new global buttons |
| Media | **Photo + video** in v1 |
| Title field | Made **optional** (today it's a required internal label) |
| Adapt-mode publishing | **AI-adapted posts always land as drafts to review** (as-written can post-now) |

## Why this is safe
A manual post is the author's own words → it already **auto-passes** the words-approval gate (`api/_lib/wordsApprovalGate.js:61` returns `{ ok:true }` when `interview_id` is null). So "Post now" carries no AI-fidelity risk. AI-adapted posts (which *do* carry that risk) still go through the review-as-draft path.

## Real-code change map
| Area | File | Change |
|---|---|---|
| Composer UI | `src/pages/NewBrief.jsx` (rename → `NewPost.jsx`) | Reframe copy Brief→Post; title optional; add mode toggle; per-channel char counts (as-written); mode-dependent publish bar; video attach |
| Generate route | `api/_routes/briefs/generate.js` | Accept `mode`; add as-written path (skip LLM, verbatim `content`); add post-now + schedule handling |
| Channel prompts | `api/_lib/briefPrompts.js` | unchanged (adapt mode only) |
| Table | `briefs` (mig 129) | **no migration** — all fields exist. Optional: add `mode`/`as_written` marker for analytics (defer, YAGNI) |
| Capture picker tile | `src/pages/CapturePicker.jsx:111` | "Brief" → "Post" |
| Route | `src/App.jsx:612` | canonical `/new/post`; keep `/new/brief` working (SEO deep-link `SeoOpportunities.jsx:550` + `?topic=`) |
| Char limits | `src/lib/contentMeta.js` (`CAPTION_LIMITS`) | reuse for per-channel counts; extend if a channel is missing |
| Publish path | `src/lib/publish.js`, `api/_lib/dispatchContentItem.js` | reuse for Post-now dispatch (no new pipeline) |
| Media shape | `src/lib/mediaEntry.js`, `src/lib/mediaLib.js` | video → proper `media_urls` object entry (`type:'video'`) |

## Phased build (each phase merges + prod-verifies before the next)

| Phase | Scope | Trial step | Est. Days | Est. Claude Cost |
|---|---|---|---|---|
| **1 — Reframe + as-written** | Brief→Post copy/tile/route; title optional; mode toggle; as-written path in `generate.js` (skip LLM, verbatim content, N rows one per channel); per-channel char counts + over-limit warning. Still lands as **drafts** in both modes. | Write a Thanksgiving-hours post as-written to IG/FB/GBP → 3 Stories drafts, identical **verbatim** text (not rewritten). | 1d | $4–8 (Sonnet) |
| **2 — Publish bar** | Mode-dependent bar: as-written → **Post now · Schedule · Save draft**; adapt → **Generate drafts** (drafts, per decision). Post-now dispatches via existing publish path with per-channel result; Schedule sets `scheduled_at`; **hard-limit guard** blocks Post-now for a channel over its cap (no silent truncation). | As-written → Post now to one test channel → it actually publishes; per-channel result shows. | 1–1.5d | $6–12 (Sonnet) |
| **3 — Video attach** | `accept="image/*,video/*"`; upload via `uploadMedia`; wire into `media_urls` object entry so it ships as video; skip/warn channels that don't support video. | Attach a short clip → post/draft to IG/FB → publishes as video. | 1d | $5–10 (Sonnet) |

**Total ≈ 3–3.5 days, $15–30 (Sonnet — no Opus needed).**

## Behavior details & edge cases
- **As-written = verbatim, identical to every selected channel.** N channels → N `content_items` (one `platform` each), same `content`. Keep `brief_id`, `interview_id: null`.
- **Optional details (event/CTA/location) are adapt-mode aids** — they're inputs the AI weaves into copy. In as-written mode the body *is* the post, so those fields don't alter the text. → **Open micro-decision:** hide them in as-written mode, or show with a "used when Bernard adapts" note. (Media attach stays in both modes.)
- **IG Story, as-written:** no real caption surface — keep existing Brief behavior (uses the attached photo, or a text card from the body).
- **Hard limits:** X 280, GBP 1500 — warn in the count chip; block Post-now for an over-limit channel (shorten or deselect). Never truncate silently.
- **One dispatch path** for as-written and adapt (reuse `publish.js`/`dispatchContentItem.js`) so preview == published (avoid the preview-vs-publish drift class).

## API-handler checklist for the touched routes
`generate.js` (and any new post-now handler): `workspaceContext(req)` + `workspace_id` filter · no `detail:` in error responses · `waitUntil()` for post-response async · validate any id with `UUID_RE` · `enforceLimit` after `workspaceContext`+`requireRole`.

## Open micro-decisions (resolve at build, none block starting)
1. As-written mode: hide optional event/CTA fields, or show-but-inert? (lean: subtle note "applies when adapting")
2. Persist post `mode` on the `briefs` row for analytics? (lean: defer — YAGNI)
3. `/new/brief` → `/new/post`: redirect vs alias (either; keep old URL alive for the SEO deep-link).
