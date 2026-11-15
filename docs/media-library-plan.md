# Shared media library for Bernard and movebetter.co — plan

Status (2026-11-14): **Bernard's side is live.** Consent backfill + default (#2777), the read-only catalogue
and website tags (#2779, #2780), and video web versions (#2785) are shipped and verified on prod. Remaining
work is on the website side: see the checklist at the end.

## The short version

- **Bernard is the library.** All Move Better photos and videos already live in Bernard's Vercel Blob store
  and are catalogued in `media_assets`. Nothing moves.
- **The website reads Bernard's catalogue directly**, with no approval step. Consent is collected before
  filming and kept in the patient's Jane file, so every Move Better item is publishable unless consent is
  revoked.
- **The website stays standalone.** A Claude session working on movebetter.co queries a read-only catalogue
  endpoint, picks items, and copies those entries into the website repo. The build reads only that committed
  file and the public Blob URLs; it never calls Bernard. Blob is Vercel's storage, so it serves files even if
  Bernard's app is down.
- **Photos are resized by the website's own build** (Astro). **Videos get web versions from Bernard** (an MP4 it makes on request),
  made on request.
- **Labels come from Bernard's existing AI tagger**, extended with pillar, condition and facility tags. No
  location field.

## 1. Inventory (measured on prod 2026-11-14)

Read-only SQL on Bernard's Supabase project plus the Movebetterco repo tree.

| Location | What | Measured |
|---|---|---|
| Vercel Blob, `t4otw6ecf8ztxfeq.public.blob.vercel-storage.com` (public, unlisted URLs) | Every Bernard file: originals, web photo variants, thumbnails, render proxies | the only host in `media_assets.blob_url` |
| Mux | Web playback copies of uploaded videos | 224 rows have `mux_playback_id` |
| Google Drive | Import source only; files were copied into Blob | 858 rows carry a `drive_id` |
| Supabase Storage | nothing | 0 buckets |
| Movebetterco `public/images/` | the website's current photos | 146 files, 70 MB |
| Website Blob store `movebetter-videos` | website videos | not measured (website's Vercel project) |

| Workspace | Kind | Rows | Size | Archived |
|---|---|---|---|---|
| movebetter | photo | 570 | 3.0 GB | 381 |
| movebetter | video | 499 | 85.2 GB | 180 |
| movebetter-equine | photo | 266 | 0.2 GB | 0 |
| movebetter-animals | photo + video | 103 | 0.45 GB | 0 |

Metadata today: alt text, staff pictured (`staff_id`) and date taken (`captured_at`) are mostly filled on
in-app uploads and sparse on Drive imports. `ai_tags` is filled widely. `condition` and manual `tags` are
nearly empty. 284 imported photos (about 3 GB, some HEIC) and most imported videos (66 GB, MOV) have no web
version.

## 2. Storage — stay on Bernard's existing Vercel Blob store

| | Vercel Blob (current) | Supabase Storage | Cloudflare R2 |
|---|---|---|---|
| Public CDN URLs | yes, in use | yes | yes, custom domain needed |
| Resizing | none built in; not needed (section 5) | built-in transforms, paid plans | separate product |
| Cost / egress | already paid; website traffic is small | new bill; Bernard has none today | free egress, new account |
| Access control | public store, unguessable URLs | buckets + policies | buckets + tokens |
| Website effort | none: CSP `media-src` already allows `*.public.blob.vercel-storage.com`, `img-src` allows `https:` | new host, new SDK | new host, new SDK |
| Migration | none | copy 88 GB | copy 88 GB |

Decision: keep everything where it is. The separate web-only store in the first draft existed only to gate
unapproved patient media, and that gate is no longer wanted (section 4).

## 3. Catalogue — a read-only endpoint, copied into the website repo

### Bernard endpoint

`GET /api/media/catalogue` on the movebetter workspace host. Follows the API checklist (`workspaceContext`
filter by `workspace_id`) but authenticates with a **read-only catalogue key** instead of a Clerk session:
`MEDIA_CATALOGUE_KEY` (**Sensitive**), compared with `timingSafeEqual`, stored in Bernard's and the
website's 1Password Environments. It is not public: Blob URLs are unguessable today, and an open list would
make the whole library, patient videos included, browsable by anyone.

Returns non-archived items with `consent_status <> 'revoked'`. Query params for the session: `kind`,
`tag`, `staff`, `q` (alt text / title search), `since`.

```jsonc
{
  "generated_at": "2026-11-14T18:00:00Z",
  "items": [
    {
      "id": "8f1c…",                       // media_assets.id, stable forever
      "kind": "photo",
      "url": "https://t4otw6ecf8ztxfeq.public.blob.vercel-storage.com/…",   // best available: web variant, else original
      "original_url": "…",
      "width": 4032, "height": 3024, "mime": "image/jpeg",
      "alt": "Clinician guiding a hip hinge",
      "people": ["dr-q"],                   // staff slugs only; never patient names
      "taken": "2024-04-12",
      "tags": ["hinge", "knee-pain", "treatment-room"],
      "consent": "obtained"
    },
    {
      "id": "c21a…", "kind": "video",
      "url": "https://…blob.vercel-storage.com/media/web-video/…/c21a….mp4",   // web MP4 once made, else the original
      "web_ready": true,
      "poster_url": "https://…blob.vercel-storage.com/…poster.jpg",
      "captions_url": null,
      "width": 1080, "height": 1920, "duration_s": 42,
      "alt": "…", "tags": ["breathe"], "consent": "obtained"
    }
  ]
}
```

### Website copy

The website keeps `src/data/media.json`: only the entries its pages use, copied from the endpoint by the
Claude session. Pages reference items by `id`. The build reads only this file, so it has no dependency on
Bernard being up or reachable.

## 4. Consent

- Consent is collected before filming and stored in the patient's Jane file (Q, 2026-11-14).
- **Done 2026-11-14:** all 1,448 rows in movebetter, movebetter-equine and movebetter-animals set to
  `consent_status = 'obtained'` with the note "Consent on file in Jane (bulk set 2026-11-14)". New uploads in
  those workspaces are born `obtained` via `workspaces.default_consent_status` and an insert trigger
  (migration 219, PR #2777, applied to prod and verified with a rolled-back probe). Other workspaces keep
  `not_required`.
- **No approval step for the website.**
- **Withdrawal:** if a patient withdraws consent, set the item to "revoked" in Bernard. The catalogue stops
  returning it immediately, so no new page can pick it. Pages already using it keep their link until fixed,
  so the website build runs a weekly check (GitHub Action with the catalogue key) that fails if any id in
  `src/data/media.json` is revoked or archived, naming the page. To pull a file off the internet at once,
  delete the blob in Bernard as well (destructive, confirm first).

## 5. Web versions

- **Photos: the website's job.** In a static Astro build, `astro:assets` downloads remote images at build
  time and writes resized WebP/AVIF files into the site output. Add the exact Blob host to
  `image.remotePatterns` in `astro.config.mjs` and use `<Image>` / `<Picture>` with `width`/`height` from
  `media.json`. No per-request transform cost, nothing new in Bernard. Watch-outs: HEIC originals may not
  decode (test one early; if they fail, the session asks Bernard for a JPEG web variant); large originals
  slow the build, so enable Astro's image cache on Vercel.
- **Videos: Bernard's job, on request** (Q chose this over Mux public streams, 2026-11-14; Bernard's Mux
  account uses signed playback, which a public site can't use without tokens). `POST /api/media/web-version`
  (same key) encodes a 1080-class H.264 MP4 + JPEG poster into Blob next to the original. Shipped in #2785.
  Only videos a page actually uses get encoded; sources over 10 minutes are refused.
- **Captions:** not built. Bernard's existing transcription (Scribe) could write a VTT later.

## 6. Labels

- **No location field.** It is one business; facility shots get a `portland-facility` or
  `vancouver-facility` tag.
- **Automatic:** extend the tag vocabulary in `api/_lib/tagAsset.js` with the pillars (`breathe`, `brace`,
  `hinge`), the website's condition slugs (from `src/content/conditions/` in Movebetterco) and the facility
  tags. New uploads get them automatically; a one-time re-tag run covers the existing ~700 active items.
- **By hand:** the media detail screen already edits tags, condition and alt text; staff pictured is already
  recorded on most uploads.
- **Alt text:** imports mostly lack it. The re-tag run can draft alt text too, which a person edits in the
  media detail screen when it's wrong.

## 7. Website integration

- **Data:** `src/data/media.json`, committed, read at build time. Helper `getMedia(id)` throws on an unknown
  id so a missing image fails the build loudly.
- **Photos:** `<Picture src={item.url} width height alt>` via `astro:assets`, Blob host in
  `image.remotePatterns`.
- **Videos:** `<video src poster controls playsinline>` with the web MP4 from Bernard.
- **CSP (vercel.json):** `img-src` already allows `https:`. `media-src` already allows
  `*.public.blob.vercel-storage.com`, which covers the web MP4s; no change needed. Optionally narrow `*.public.blob…` to Bernard's exact
  host before enforcement in Dec 2026. Since photos are resized at build and served from the site itself,
  only videos load from outside hosts.
- **Secret:** `MEDIA_CATALOGUE_KEY` (**Sensitive**) in the website's 1Password Environment; used only by the
  Claude session and the weekly check, never by the production build.

## 8. Build order and migration

| Phase | Work | Rollback |
|---|---|---|
| 0 | Done: consent backfill and default (#2777) | drop trigger and column; reset rows by the bulk-set note |
| 1 | Bernard: catalogue endpoint + key; tag vocabulary + re-tag run | revert PR; tags are additive |
| 2 | Website: `media.json`, `getMedia`, `remotePatterns`; switch the ~14 condition-page photos | revert website PR; `public/images/` files stay until verified on prod |
| 3 | Website: team headshots, heroes, treatment photos | revert website PR |
| 4 | Bernard: video web-version endpoint; website: videos; move `movebetter-videos` items into the catalogue | revert; old video store kept until verified |
| 5 | Clean-up: remove migrated `public/images/` files; retire `movebetter-videos` after 30 days (needs Q's yes) | git revert restores files |

Phase 4 cost: Vercel function time and Blob storage for each encoded video only; no Mux charges.

## Website-side checklist (hand to a Claude session in Move-Better/Movebetterco)

**Phase 1 is live (2026-11-14, PRs #2779 and #2780); the video step (phase 4, PR #2785) too.** Everything below can start now.

### The catalogue

- URL: `https://movebetter.withbernard.ai/api/media/catalogue` (**Not sensitive**)
- Auth header: `Authorization: Bearer $MEDIA_CATALOGUE_KEY`. The key (**Sensitive**) is in the Movebetterco
  1Password Environment as `MEDIA_CATALOGUE_KEY`. Use it locally and in GitHub Actions only; never put it in
  the Vercel production build env or in client code.
- Query params: `kind=photo|video`, `tag=<tag>` (repeatable, all must match), `staff=<staff uuid>`,
  `since=YYYY-MM-DD`, `ids=<uuid,uuid,…>` (up to 200), `q=<words>` (searches title and alt text),
  `limit` (max 1000, default 200), `offset`.
- Returns only active Move Better items with consent on file. 507 items at launch.
- Item fields: `id` (stable forever), `kind`, `url` (web-sized photo when one exists, else the original;
  for video the rendered file, else the original), `original_url`, `width`, `height`, `original_width`,
  `original_height`, `mime`, `size_bytes`, `duration_s` and `poster_url` (video), `title`, `alt`,
  `people` (`[{id, name}]`, staff only), `taken` (YYYY-MM-DD), `purpose`, `tags`, `consent`, `updated_at`.
- Website tags to search by (fixed spellings): pillars `breathe`, `brace`, `hinge`; conditions
  `concussion-whiplash`, `foot-ankle`, `headaches-migraines`, `knee-pain`, `low-back-pain`,
  `prenatal-postpartum`, `shoulder-pain`; type `treatment`, `exercise`, `assessment`, `headshot`, `team`,
  `clinic-space`, `outdoors`. Facility shots carry `portland-facility` / `vancouver-facility` once a person
  adds them in Bernard. Items also carry free-form AI tags (e.g. `kettlebell`, `thoracic-extension`).
- Example:
  ```bash
  curl -s -H "Authorization: Bearer $MEDIA_CATALOGUE_KEY" "https://movebetter.withbernard.ai/api/media/catalogue?kind=photo&tag=hinge&limit=20"
  ```

### Steps

1. Write `scripts/media-pick.mjs`: query the catalogue with filters and append chosen entries (whole item
   objects) to `src/data/media.json`, keyed by `id`.
2. Add `src/lib/media.ts` with `getMedia(id)` that throws on an unknown id.
3. Add `t4otw6ecf8ztxfeq.public.blob.vercel-storage.com` to `image.remotePatterns` in `astro.config.mjs`;
   render photos with `<Picture>` from `astro:assets` using the item's width, height and alt. Some originals
   are HEIC or 10 MB+ JPEGs; prefer items whose `url` contains `/media/web/` (already web-sized), and test
   one HEIC item before relying on it.
4. Replace the condition-page photos (`/images/paradigm/*`, `homepage-treatment-*`, `about-hero.jpg` and
   the named photos in `src/content/conditions/*.md`) with library ids. Keep the old files until verified on
   prod.
5. Add a weekly GitHub Action (repo secret `MEDIA_CATALOGUE_KEY`) that requests
   `?ids=<every id in media.json>` and fails if any id is missing from the response (archived or consent
   withdrawn), naming the page. Prove it fails on a mutated id.
6. Videos: before using a video, ask Bernard for its web version:
   ```bash
   curl -s -X POST -H "Authorization: Bearer $MEDIA_CATALOGUE_KEY" -H "Content-Type: application/json" -d '{"id":"<video id>"}' https://movebetter.withbernard.ai/api/media/web-version
   ```
   It returns `{status: "created"|"ready", url, width, height, poster_url}` once the MP4 is made (up to
   about 5 minutes for a long clip; instant if already made). Videos over 10 minutes return `too_long`.
   After that the catalogue item shows `web_ready: true` and its `url` is the web MP4. Render with
   `<video src={url} poster={poster_url} width height controls playsinline preload="metadata">`. The MP4
   and poster live on the same Blob host the CSP already allows, so `vercel.json` needs no change.
7. Verify on the deployed site: photos served from the site's own `/_astro/` output, no CSP reports.
