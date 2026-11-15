# Shared media library for Bernard and movebetter.co — plan

Status: **draft plan, nothing built or moved.** Written 2026-11-14. No media has been copied, deleted or
re-uploaded, and no production setting has changed. Decisions that cost money or change who can see files
are listed at the end and need Q's answer first.

## The short version

- Bernard already **is** the media library: ~1,450 rows in `media_assets`, about 88 GB, all in one public
  Vercel Blob store. Supabase Storage holds nothing (zero buckets).
- The website should **not** point at Bernard's store. Bernard's originals include patients, and every
  row today defaults to `consent_status = 'not_required'`, so "it's in Bernard" says nothing about whether it
  is safe to publish.
- Recommendation: keep Bernard as the place media is catalogued and approved. When an item is approved for
  the website, Bernard writes **web-sized copies** to a separate, website-only public Blob store and adds the
  item to a published manifest (JSON). The website fetches that manifest at build time and falls back to a
  committed copy if Bernard is down. Withdrawing an item deletes the copies and drops it from the manifest.
- Storage home: **Vercel Blob** (a new store dedicated to web-approved media). Reasons in section 2.

## 1. Inventory (measured on prod 2026-11-14)

Source: read-only SQL on Bernard's Supabase project (`media_assets` joined to `workspaces`), plus the
Movebetterco repo tree via the GitHub API.

### Where files live

| Location | What | Measured |
|---|---|---|
| Vercel Blob, store host `t4otw6ecf8ztxfeq.public.blob.vercel-storage.com` (public) | Every Bernard upload, original + `web_blob_url` variant + thumbnails + render proxies | the only blob host in `media_assets.blob_url` |
| Mux | Playback copies of uploaded videos | 224 rows have `mux_playback_id` |
| Google Drive | Source of imports, not storage | 858 rows carry a `drive_id` (imported via `api/integrations/drive/import.js`); the file itself was copied to Blob |
| Supabase Storage | nothing | `storage.buckets` empty, 0 objects |
| Bernard repo `public/` | Bernard's own brand art, not clinic media | — |
| Movebetterco repo `public/images/` | The website's hand-picked photos | 146 files, 70 MB |
| Website Blob store `movebetter-videos` | Website videos (posters and captions in repo) | not measured here (needs the website's Vercel project) |

### Bernard rows by workspace and kind

| Workspace | Kind | Rows | Size | Archived |
|---|---|---|---|---|
| movebetter | photo | 570 | 3.0 GB | 381 |
| movebetter | video | 499 | 85.2 GB | 180 |
| movebetter-equine | photo | 266 | 0.2 GB | 0 |
| movebetter-animals | photo + video | 103 | 0.45 GB | 0 |
| groovechiro, studio | photo | 7 | ~0 | 0 |

Types: `mime_type` is mostly JPEG/HEIC/WebP for photos and MP4/MOV for video. Sources: `upload` (in-app),
`local-import` (bulk import from Drive/disk — these are the 66 GB of large originals), `moments`,
`capture_companion`, `edit`.

### Metadata that already exists (movebetter workspace, non-archived matters most)

| Field | Column | Coverage |
|---|---|---|
| Alt text | `alt_text` | good on uploads (254/286 photos), almost none on imports (8/284) |
| Person pictured (staff) | `staff_id` → staff row | 221/286 uploaded photos; few imports |
| Date taken | `captured_at` | most rows |
| Condition | `condition` | ~20 rows total — effectively empty |
| AI tags | `ai_tags` (e.g. `manual-therapy`, `hip-treatment`, `treatment-room`) | wide |
| Manual tags | `tags` | empty in practice |
| Patient flag | `patient_pseudonym` | ~30 rows |
| Consent | `consent_status` | **10 rows `obtained`; every other row is the default `not_required`** |
| Web-sized variant | `web_blob_url`, `web_width`, `web_height` | uploaded photos only |
| Video poster | `thumbnail_url`, Mux playback | most uploaded video |
| Clinic (Portland / Vancouver) | — | **no column** |
| Pillar (breathe/brace/hinge) | — | **no column** |

What this means: the catalogue can be built on `media_assets`, but clinic, pillar and an explicit
"approved for the public website" field must be added, and the existing consent value cannot be trusted as
an approval because it was never set on most rows.

## 2. Storage home — recommendation: Vercel Blob (new web-only store)

| | Vercel Blob | Supabase Storage | Cloudflare R2 |
|---|---|---|---|
| Public CDN URLs | yes, already in use | yes (public bucket) | yes, needs a custom domain or r2.dev |
| Resizing | none in Blob; Vercel Image Optimization can resize remote images (billed per transform) | built-in transforms on paid plans | Cloudflare Images / Workers, separate setup |
| Cost at our size | the web set is small (hundreds of MB); the 88 GB Bernard store already pays | adds a second storage bill; Bernard has none today | cheapest storage, zero egress |
| Egress | billed data transfer | billed | free |
| Access control | per store, public or private | per bucket + policies | per bucket + tokens |
| Website effort | lowest — same platform, `media-src` already allows `*.public.blob.vercel-storage.com`, `img-src` allows `https:` | new host in CSP, new SDK in Bernard | new account, new SDK, new host in CSP |
| Migration effort | none for existing files | copy 88 GB or split homes | copy 88 GB or split homes |

Why Blob wins: everything is already there, both apps deploy on Vercel, Bernard already writes to Blob in
~40 places, and the website's CSP already permits it. R2's free egress matters only at traffic levels a
clinic site doesn't reach. Supabase's image transforms are the one real advantage elsewhere, and
pre-generating sizes (below) removes the need.

Why a **separate store** and not the existing one: the website must only ever see approved files. A
separate store means the website's manifest physically cannot name a Bernard original, withdrawal is a
delete in one place, and patient-identifiable originals never get a URL that lives on a public page. It
also keeps the CSP narrowable later to one exact host.

**Pricing not verified here** — check the Vercel Blob line on the Movebetter team's plan before creating
the store (decision D1).

## 3. Catalogue design

### Database (Bernard)

New columns on `media_assets` (or a 1:1 `web_media` table if we want web metadata out of the hot table;
recommend the separate table so the publish logic is one place):

```sql
-- sketch only, not a migration yet
create table public.web_media (
  id               text primary key,          -- stable slug, e.g. 'mb-knee-hinge-01'; never reused
  asset_id         uuid not null references media_assets(id),
  workspace_id     uuid not null references workspaces(id),
  approved_at      timestamptz,               -- null = not public
  approved_by      text,                      -- Clerk user id
  consent_basis    text not null check (consent_basis in ('no_people','staff_only','patient_release_on_file')),
  consent_ref      text,                      -- where the signed release lives (Jane doc id / filename), required for patient_release_on_file
  withdrawn_at     timestamptz,
  withdrawn_reason text,
  alt_text         text not null,
  people           uuid[] not null default '{}', -- staff ids pictured
  clinic           text check (clinic in ('portland','vancouver','both')),
  pillar           text[] default '{}',       -- breathe | brace | hinge
  conditions       text[] default '{}',       -- matches website condition slugs
  tags             text[] default '{}',
  renditions       jsonb not null default '[]', -- [{url,width,height,format}]
  poster_url       text, captions_url text,   -- video
  created_at timestamptz default now(), updated_at timestamptz default now()
);
grant all on public.web_media to service_role;
```

### Exported manifest (what the website reads)

Published at a stable public URL in the web store, e.g. `.../manifest/v1.json`, regenerated on every
approve or withdraw. Only rows with `approved_at is not null and withdrawn_at is null`.

```json
{
  "version": 1,
  "generated_at": "2026-11-14T18:00:00Z",
  "items": [
    {
      "id": "mb-knee-hinge-01",
      "kind": "photo",
      "alt": "Clinician guiding a hip hinge in the Portland gym",
      "width": 2000, "height": 1333,
      "src": "https://<web-store>.public.blob.vercel-storage.com/p/mb-knee-hinge-01-2000.webp",
      "renditions": [
        {"w": 640, "url": ".../mb-knee-hinge-01-640.webp"},
        {"w": 1280, "url": ".../mb-knee-hinge-01-1280.webp"},
        {"w": 2000, "url": ".../mb-knee-hinge-01-2000.webp"}
      ],
      "people": ["dr-q"],
      "clinic": "portland",
      "taken": "2024-04-12",
      "tags": {"conditions": ["knee-pain"], "pillar": ["hinge"], "team": ["dr-q"], "other": ["treatment"]},
      "public": true
    },
    {
      "id": "mb-breathe-demo-01", "kind": "video",
      "src": ".../v/mb-breathe-demo-01-1080.mp4",
      "poster": ".../v/mb-breathe-demo-01-poster.webp",
      "captions": ".../v/mb-breathe-demo-01.en.vtt",
      "width": 1080, "height": 1920, "duration_s": 42,
      "alt": "...", "clinic": "vancouver", "tags": {"pillar": ["breathe"]}, "public": true
    }
  ]
}
```

People are exported as staff slugs, never names of patients. No patient field is ever exported.

## 4. Privacy — approval and withdrawal

Rules:

1. **Default is not public.** A row is on the website only when `web_media.approved_at` is set and
   `withdrawn_at` is null. Nothing inherits approval from `consent_status`.
2. **Approval needs a consent basis.** The approve action requires choosing one of: no people visible;
   staff only (staff ids recorded); patient release on file (with `consent_ref` pointing to the signed
   form). An asset with `patient_pseudonym` set or `consent_status in ('pending','revoked')` cannot be
   approved as `no_people`/`staff_only`.
3. **Role-gated.** Only owner/admin (`requireRole`) can approve or withdraw; every change is stamped with
   the Clerk user id.
4. **Enforced by construction.** Approval *copies* resized renditions (EXIF/GPS stripped) into the web-only
   store. The website can only reference that store, so an unapproved original is never reachable from the
   site even by a bad manifest edit.
5. **Withdrawal** (button in Bernard, or patient request): sets `withdrawn_at`, deletes the copies from the
   web store, regenerates the manifest, and triggers a website rebuild via a Vercel deploy hook. Old URLs
   return 404 immediately because the file is gone; CDN caches clear within the Blob cache window. The
   committed fallback manifest in the website repo is refreshed by the same rebuild job (PR or bot commit) —
   **withdrawal is not complete until the fallback copy no longer names the item**, so a guard in the
   website build fails if the fallback names an id absent from the live manifest.
6. **Revocation of consent** in Bernard (`consent_status = 'revoked'`) auto-withdraws any `web_media` row
   for that asset.

## 5. Website integration (no runtime dependency on Bernard)

- **Build-time fetch with fallback.** A small loader (`src/lib/media.ts`) fetches the manifest URL with a
  short timeout. On success it validates the shape (zod), writes nothing, and uses it. On failure it uses
  `src/data/media-manifest.json`, committed in the website repo. The build never calls Bernard's API and
  never needs Bernard's repo; the manifest lives in the web store, so Bernard being down does not matter
  either.
- **Refreshing the fallback.** A scheduled GitHub Action in Movebetterco (or the Bernard publish job via
  a PR) copies the live manifest into the fallback file weekly and on every withdraw.
- **CSP.** `img-src` already allows any `https:`; `media-src` already allows
  `https://*.public.blob.vercel-storage.com`. Before enforcement (Dec 2026), **narrow both to the exact
  web-store host** (`https://<web-store-id>.public.blob.vercel-storage.com`) rather than the wildcard,
  which also admits Bernard's patient-originals store. Captions (`<track>`) fall under `media-src`.
- **Image sizing.** Use the pre-generated renditions: render `<img srcset sizes width height>` (or
  `<picture>`) straight from the manifest, with width/height from the manifest to avoid layout shift. No
  Astro remote-image config or Vercel image optimizer needed. If Astro's `<Image>` is preferred later, add
  the exact host to `image.remotePatterns` in `astro.config.mjs` — this makes Vercel resize at request time
  and adds a per-transform cost, so it is optional.
- **Lookups by id**, never by array index: `getMedia('mb-knee-hinge-01')` throws at build time if the id
  is missing, so a withdrawn image used on a page fails the build loudly instead of shipping a broken img.

## 6. Migration plan

Each phase is shippable alone; the website keeps its `public/images/` files until the phase is verified.

| Phase | Scope | Steps | Rollback |
|---|---|---|---|
| 0 | Plumbing | D1–D3 answered; create the web store; `web_media` migration; approve/withdraw API + a minimal approve panel in the media library; manifest writer; deploy hook | drop table, delete empty store |
| 1 | Condition pages (~14 images: `paradigm/*`, `homepage-treatment-*`, `about-hero.jpg`, a few named photos) | Find or import each into Bernard (they came from the website repo, so import from there, not re-shoot); approve with consent basis; website loader + fallback; switch condition pages to `getMedia()` | revert the website PR; images still in `public/images/` |
| 2 | Team headshots | add `people`; approve as `staff_only`; switch team page | revert website PR |
| 3 | Hero, treatment, video | approve heroes/treatment photos; move `movebetter-videos` items into the manifest (copy into web store, keep old store until verified); posters and VTT into the store | revert; old video store untouched until phase 4 |
| 4 | Clean-up | delete website `public/images/` files that are now in the manifest; retire `movebetter-videos`; narrow CSP to one host | git revert restores files; videos kept 30 days before the old store is deleted (needs Q's yes) |

Full-library tagging (clinic, pillar, conditions on the ~600 active movebetter rows) runs alongside
phases 2–3; ai_tags can pre-fill suggestions but a human approves anything that goes public.

## 7. Decisions for Q (need an answer before phase 0)

| ID | Decision | Why it needs you |
|---|---|---|
| D1 | Create a new public Vercel Blob store for web-approved media | costs money (small) and creates a new public location |
| D2 | Use the website-only store (recommended) vs. point the site at Bernard's existing store | changes who can see files |
| D3 | Who may approve for public use (owner only, or owner + admin) | access policy |
| D4 | Where signed patient releases live (`consent_ref` target) | privacy record |

## Website-side checklist (hand to a Claude session in Move-Better/Movebetterco)

Do not start until Bernard's phase 0 ships and the manifest URL exists.

1. Add `src/data/media-manifest.json` (copy of the live manifest) and `src/lib/media.ts`: fetch the manifest
   URL (env `MEDIA_MANIFEST_URL`, **not sensitive**) with a 5 s timeout, validate with zod, fall back to the
   committed copy; export `getMedia(id)` that throws on a missing id.
2. Build a `<LibraryImage id sizes>` component rendering `<img src srcset sizes width height alt
   loading decoding>` from the manifest renditions; and `<LibraryVideo id>` with `poster` and a `<track
   kind="captions">`.
3. Replace the condition-page image paths (`/images/paradigm/*`, `homepage-treatment-*`, `about-hero.jpg`
   and the named photos in `src/content/conditions/*.md`) with library ids. Keep the files in
   `public/images/` until verified on prod.
4. Add a build guard: fail if the fallback manifest contains an id not in the live manifest (withdrawal
   safety), and fail if any page references an unknown id. Prove each guard fails on a mutation.
5. In `vercel.json`, narrow `img-src`/`media-src` to the exact web-store host (keep report-only until Dec).
6. Add a scheduled GitHub Action that refreshes the fallback manifest weekly via PR.
7. Verify on the deployed site: images load from the web-store host, no CSP reports, layout shift unchanged.
