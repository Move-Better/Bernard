# Source Library — Spec

**Status:** Draft for owner (Q) sign-off · 2026-06-01
**Author:** Q + Claude (planning session)
**Session type:** Planning / Architecture

---

## 1. The idea

Tenants have a body of **published work** — blog posts, guest articles on other sites,
podcast appearances, recorded talks, even a published study. Today that work is invisible
to Bernard. Source Library ingests it once and makes it permanently useful.

It is **not** a "blog importer." The unit is *any digital work the team has authored*,
and the input is just **a URL**. Same pipeline regardless of source type.

### The two-layer model (the core insight)

Ingestion and story-creation happen at **different times** and must not be coupled.

| Layer | When | Scope | Decision required |
|---|---|---|---|
| **Ingest** → corpus + Book KB | Automatically, on import | **Every** source, always | None |
| **Activate** → spawn a Story | Lazily, any time later | One source at a time | Only when there's a reason |

A source ingests once (feeding voice + Book quietly) and then **sits on the shelf**.
A Story is spawned from it *only when a need appears* — manually, or suggested by a
campaign/seminar on a matching topic. No source is ever wasted by a premature
"blog vs. story" routing choice at import time, and a clinic with 300 posts makes
**zero** upfront decisions.

```
   IMPORT (automatic, all sources)
        │
        ▼
   ┌──────────────────┐
   │  Source Library  │  permanent, searchable shelf
   │  (corpus + KB)   │  every source feeds voice + Book
   └──────────────────┘
        │  "Use as a story"  ← triggered by a NEED
        │  (manual, or campaign suggestion)
        ▼
   ┌──────────────────┐
   │   Story draft    │ → Stories → social / email / web
   └──────────────────┘
```

### Discovery = search, not webhooks

The "keep it fresh" mechanism is **not** per-platform webhooks/integrations (overkill).
It's a **periodic web search over the tenant's registered site(s) + byline**, refreshed
every few weeks or on a manual "check for new work" button. New published works surface
as ingest candidates. This works for a clinician who guest-writes across five sites as
easily as one with a single blog, and it respects the **own-content-only** boundary
(`project_no_content_mining_boundary.md`) — inputs are *their* registered identities,
not the open web.

---

## 2. Current state (verified 2026-06-01, this codebase)

The data layer is ~80% built. Verified by grep, not assumed.

### Built & wired
- `staff_corpus_documents` (migration 079, renamed 106): `id, workspace_id, staff_id,
  doc_type CHECK IN ('original_blog','uploaded_draft'), title, body, source_url,
  doc_date, archived_at`. **Unique** `(workspace_id, staff_id, doc_type, title) WHERE
  archived_at IS NULL` = dedup key. `source_url` is built-in provenance for `original_blog`.
- `practice_memory_chunks` (073): `source_type` already includes `'original_blog'` and
  `'uploaded_draft'`; `vector(1536)` embedding; HNSW cosine index; unique
  `(source_type, source_id, chunk_index)` = idempotent re-index.
- RAG retrieval: `match_practice_memory_chunks(...)` RPC + `/api/corpus/search` (POST).
- Read UI: `src/pages/AuthorMode.jsx` already lists both `original_blog` and
  `uploaded_draft` docs and offers them as writing source material.
- Book: `Book.jsx` counts "original articles" + "drafts"; `bookSynthesis.js` consumes
  `staff_corpus_documents`; `api/book/excluded-sources.js` can exclude a corpus row
  from the Book (`source_table='staff_corpus_documents'`).
- Helpers: chunking + `embedTexts()` + `upsertChunks()` + `deleteExtraChunks()` in
  `api/_lib/practiceMemoryRag.js`.

### Exists but NEVER called (ready-made, half-wired)
- `indexOriginalBlog({workspaceId, staffId, blogId, title, body, publishedAt})` —
  `practiceMemoryRag.js:525`. Zero callers.
- `indexUploadedDraft({...})` — `practiceMemoryRag.js:542`. Zero callers.

### MISSING entirely (the keystone)
- **`/api/corpus/ingest`** — the write path. `AuthorMode.jsx:38` already POSTs
  `{docType, title, body}` to it to save a draft, **but the file does not exist**
  (`api/corpus/` only has `documents.js` (GET) + `search.js` (POST)). So Author Mode's
  "save draft" is **currently dead**, and there is no blog-ingest path at all.

**Implication:** building one endpoint — `/api/corpus/ingest` that (a) inserts a
`staff_corpus_documents` row and (b) `waitUntil(indexOriginalBlog | indexUploadedDraft)`
— simultaneously fixes the latent Author Mode bug and unlocks the entire ingest layer.
Its contract is already pinned by the existing caller.

---

## 3. Data model — reuse, don't invent

No new tables required for Phases A–C. The schema already anticipated this.

- **Archive record** = a `staff_corpus_documents` row (`doc_type='original_blog'`,
  `source_url` set). This *is* the shelf. (`uploaded_draft` for pasted/non-URL text.)
- **Voice + Book KB** = `practice_memory_chunks` rows fanned out by the indexer.
- **Story** = a `content_items` row (`status='draft'`) spawned on activation.
- **Provenance back-link:** when activating, set `content_items.resolved_url =
  source_url` (same field the URL-import lane already uses) so a Story knows its origin.

A dedicated `source_library_batches` progress table is only needed for the **batch/
multi-source** ingest UX (Phase A driver + Phase D discovery), not for single ingests.

### The one runtime gotcha to honor
Per `feedback_ship_a_consumer_in_same_pr.md` and the PR #1066 lesson: the ingest
endpoint must `await indexOriginalBlog(...)` **inside** the `waitUntil()` promise. If the
index call is left as a bare floating promise, Vercel freezes the instance on response
and the embedding silently never runs (the exact "backfill looks complete, live hook
dead" trap). Verify a source created *after* ingest actually has chunks.

---

## 4. Phases (estimates revised down — most of the read half exists)

| Phase | Description | Est. Days | Est. Claude Cost |
|---|---|---|---|
| **A — Ingest + shelf** | Build `/api/corpus/ingest` (create row + awaited index). Batch driver for many URLs. Bulk author→staff mapping. Progress + 90s-capped polling. Extend AuthorMode (or new "Sources" tab) as the searchable shelf. | 2–3d | ~$4–8 (Sonnet) |
| **B — On-demand activation** | "Use as a story" from a shelf item → create `content_items` draft (reuse the `import-url.js` create pattern), set `resolved_url`. Topic + semantic search over the archive (reuse `/api/corpus/search`). | 2–3d | ~$4–7 (Sonnet) |
| **C — Triggered activation** | A campaign/seminar surfaces matching archived sources as story candidates (semantic match on campaign topic). | 1–2d | ~$3–5 (Sonnet) |
| **D — Registered-site discovery** | Register sites/byline → periodic (cron) or manual web search → queue new published works as ingest candidates. Per-format extraction adapters (HTML / PDF / transcript). | 3–4d | ~$6–12 (Sonnet) |

A→B→C is the durable architecture. D is the tenant-onboarding feature for clinics that
don't hand us a repo.

---

## 5. Move Better — the immediate one-off (Option B)

We have the clean markdown in two repos with full access, so Move Better needs **none**
of the URL/search machinery. Plan:

1. **Build `/api/corpus/ingest`** (needed by the product anyway; fixes the AuthorMode bug).
2. **One-off script** reads repo markdown → calls ingest per file:
   - **People (`Move-Better/Movebetterco`, ~43 posts):** ingest as `original_blog` into
     the **People** workspace, attributed by the (now-corrected, PR #70) author frontmatter:
     Q (21) · Zach (11) · Whitney (3). Feeds each one's voice corpus + People Book.
     **Park on the shelf — do NOT auto-create stories.**
   - **Animals (`Move-Better/movebetteranimal`, 4 posts):** ingest as `original_blog`
     into the **Animals** workspace — "An Outsider's View" → **Q's** voice, the other
     three → **Whitney's** (PR #10). THEN **activate all 4 as Story drafts**, shaped for
     **Instagram + Facebook + Google Business Profile** (social atoms; no email/web variant).
3. **Validate the live hook:** confirm a freshly-ingested post has `practice_memory_chunks`
   rows (not just a `staff_corpus_documents` row) before declaring done.

Move Better cost: ingest endpoint + script + ~36 embeddings ≈ **~1 day, ~$2–4 (Sonnet)**.

### Voice-corpus hygiene — DECIDED
The ~11 announcement-type People posts (pandemic-era updates, product recs, "clinic &
health updates" — the ones the migration flagged `draft:true`) are **excluded from the
corpus and Book**: they are NOT ingested as voice material. Only substantive
philosophy/clinical posts feed voice + Book. (They can still live on the live website;
this is purely about what trains Bernard.)

---

## 6. Decisions (resolved 2026-06-01)

1. **Announcement/draft posts (~11 People):** ✅ **Excluded** from corpus + Book. Not
   ingested as voice material.
2. **Shelf surface:** ✅ **Extend AuthorMode** to start; promote to its own surface later
   if it earns the room.
3. **Animals stories — channels:** ✅ **Instagram + Facebook + Google Business Profile**
   (social atoms). No email/web variant.
4. **Q's voice in the Animals workspace:** ✅ OK per roster (Q is in all 3 workspaces);
   "An Outsider's View" trains Q's Animals voice.

---

## 7. Risks / lessons to honor

- **Half-wired trap:** `indexOriginalBlog`/`indexUploadedDraft` look usable but have never
  run in production. Treat first live ingest as unproven; verify chunks land.
- **`waitUntil` nested fire-and-forget:** await the index call inside the endpoint (§3).
- **Backfill masking a dead hook:** a one-off Move Better backfill could make the shelf
  look populated while the *live* `/api/corpus/ingest` path is broken. Test the live
  endpoint with a single new URL *after* the backfill, per `feedback_..._waituntil`.
- **Scale:** 300-post tenants → batch ingest as a background job with capped polling;
  never a synchronous request (300s wall). Paginate + batch embeddings.
- **Workspace isolation:** every ingest/read filters by `workspace_id` (and `staff_id`).
