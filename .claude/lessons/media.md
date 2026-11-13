# Media, rendering, and colour in tenant content

Read this before touching a renderer or compositor (Sharp/SVG, ffmpeg, canvas), the video or slide editors and their templates, captions, grades, thumbnails, `media_urls` entries, the blob store, the email template, or any colour that ends up in tenant content. Moved from `CLAUDE.md` on 2026-11-11; the section headings are unchanged, so a code comment citing `CLAUDE.md "<heading>"` finds its rule here.

## Server-side image compositors (Sharp + SVG) — verify locally, mind tspan whitespace

The photo compositor (`api/_lib/brandRender.js` `renderEditorialPhoto`, `api/_lib/whoopTemplates.js` `renderWhoopPhoto`, baked by `api/editorial/compose-photo.js` into `content_items.photo_treatment` / `media_urls`) is pure server-side render code. Two lessons from building it:

- **Pure render/transform code CAN be verified locally even though app smoke is prod-only** (Clerk domain-locked — see `verify.md`). The render functions take a workspace object + a source URL and return a JPEG buffer — no Clerk, no request context. Before shipping a template/render change, write a throwaway `node` harness that imports the renderer directly, renders every variant to `/tmp/*.jpg`, and **read the JPEGs** to eyeball them against the mockup. This caught every visual bug in the 6-template WHOOP build *before* merge — far cheaper than a prod round-trip. Don't ship SVG/Sharp render changes blind on "gates are green"; gates don't look at pixels.
- **SVG collapses whitespace at `<tspan>` boundaries.** Rendering multi-color text as inline `<tspan fill=…>` runs inside one `<text>` (the clean way to color one accent word — the renderer measures glyph widths for you) drops the space between runs: `isn't the` rendered as `isn'tthe`, `sciatica worse` as `sciaticaworse`. Fix: put `xml:space="preserve"` on the `<text>` element. Applies to any colored-run or multi-tspan text in these compositors.

## Templates are authored in the REAL editors, not a separate template screen (Q, 2026-07-25)

A look is created by dialling it in on an actual clip or carousel and hitting **Save as … template**
(VideoEditor's Captions panel; SlideEditor's Theme panel), not in a settings-page style editor. Q's call,
and it is the better architecture for a reason worth keeping: **the editor already renders the real
thing, so there is no second styling surface to drift out of sync with the bake.** Video renders
server-side in ffmpeg, so a canvas "template preview" would be a mirror — and mirrors here have already
lied (the caption Size control previewed one size and exported another; the glow preview kept an accent
halo after the bake moved to a dark one).

The settings pages (`/settings/photo-templates`, `/settings/video-templates`) are **libraries, not
editors**: browse, rename, delete, choose which one new content uses. Adding style controls there
recreates exactly the surface this design removed.

Capture is a STYLE/CONTENT split, and the split is the design work — `src/lib/videoTemplateCapture.js`
and `src/lib/photoTemplateCapture.js`, both pure and tested. Two rules that generalise:

- **A value that is a property of THIS clip must not be pinned into the template.** A headline hold that
  runs to the end of a 9s clip is saved as the reading-time rule, not as "9 seconds".
- **Take the most common value per role across slides, not the first.** A template is "how you style
  hooks", not "how slide one looked".
- **Name what was skipped in the save dialog.** The photo capture can only promote the five block fields
  the template schema holds (`fontWeight`, `color`, `shadow`, `uppercase`, and `fontScale` folded into a
  named size); the editor sets six more it cannot. Silently dropping half a user's styling is worse than
  saying so.

## Client/server mirror pairs — a fix to one is not a fix to the other

Several render decisions exist twice by design (the import boundary forbids sharing a file), and every
one has bitten. When changing any of these, change both in the same commit:

| Server (bake) | Client (preview) |
|---|---|
| `api/_lib/gradeParams.js` | `src/lib/gradeParams.js` |
| `brandRenderVideo.js` `CAPTION_BASE_FS` × `OVERLAY_SIZE_SCALE` | `video-editor/captions.js` `CAPTION_BASE_FS_PCT` / `CAPTION_SIZE_SCALE` |
| `karaokeCaptions.js` `CAPTION_STYLES` | `video-editor/captions.js` `captionCss()` — **colours test-enforced**, see below |
| `brandRender.js` `resolveBrandColors()` | `src/lib/brandSwatches.js` |
| `api/_lib/videoTemplates.js` | `src/lib/videoTemplateCapture.js` |
| `api/_lib/captionOverlayDedup.js` `normCaptionText` | `video-editor/captions.js` `normCaptionText` |
| `karaokeCaptions.js` `buildKaraokeAss` `\k` word TIMING | `video-editor/Canvas.jsx` `spoken = playClipT >= w.start` |
| `karaokeCaptions.js` `sliceWordsToWindow` / `groupWordsIntoLines` | `video-editor/captions.js` `sliceWords` / `groupLines` |
| `api/_lib/transcriptCuts` | `video-editor/cuts.js` |

**The caption COLOUR half of this table is now enforced rather than remembered.**
`tests/lib/videoEditorCaptions.test.js` builds the ASS for every preset with the real
`buildKaraokeAss` and asserts the preview's spoken/upcoming colours equal the bake's
`PrimaryColour`/`SecondaryColour`. Don't hand-verify that pair — and if you add a preset
to `CAPTION_STYLES`, the test covers it automatically the moment it appears in
`CAPTION_STYLE_OPTS`. It was written after `word_box` AND `underline` were found painting
the spoken word white while the bake painted it the tenant accent (#2731) — two presets
whose whole job is per-word emphasis, showing no highlight at all in the editor. Still NOT
covered: the underline rule's PLACEMENT (ASS `Underline` is style-level so the bake
underlines both states; the preview underlines only the spoken word — deliberate).

Real failures from this list: the Size control previewing identically for Medium and Large while baking
1.0× vs 1.35× (`vh` with a 40px clamp vs a frame-relative bake); `glow` previewing an accent halo for a
commit after the bake moved to a dark one; the karaoke fill IGNORING inter-word silences — ASS `\k`
packs syllables back-to-back from the line's Dialogue Start, so a word after a pause lit up early (up to
~4s on a real reel) while the preview lights each word at its real start. Caption STYLE and caption
TIMING are two separate mirror axes: when a "pacing" report survives a style fix (the outline/`CAPTION_STYLES`
one), suspect the `\k` timing model, not the styles (#2707).

**A `<video>`'s `src` and its `poster` are a mirror pair too — a fix that swaps the src to a clean
source must swap the poster in the same breath, or the poster becomes a second surface carrying the
exact artifact you just removed from the src.** `VideoEditor.jsx` edits a caption-baked auto-reel from
its RAW un-captioned source (`resolveVideoEditSource`, see memory
`project-reel-editor-raw-source`). #2609 correctly pointed `<video src>` at that clean source but left
`poster={asset.thumbnail_url}` on the BAKED clip's thumbnail (captions burned in). On the paused/
undecoded frame — the resting state before play, and always in a stalled harness — the baked-caption
poster rendered UNDER the live karaoke overlay: the same double #2609 removed from the src, now via the
poster. Fix (#2641): `editPoster = editSource.window ? undefined : asset?.thumbnail_url` — drop the
poster whenever editing from a resolved raw-source window; normal clips/uploads and the `captionsBaked`
fallback (video IS the baked blob → thumbnail matches, no live overlay) keep it. It was a universal
wiring bug (all source-linked auto-reels), fixed in one line, no data. The tell that this class exists:
a `<video>` whose `src` and `poster` resolve from DIFFERENT assets. (Client-preview only — the publish
bake reads neither.)

**A per-platform DISPATCH is a mirror pair too, and it's the harder one to audit — a value mismatch is
visible in a diff, a missing platform is invisible until someone opens that specific post.**
`publishPiece.js` bakes slides (photo + text blocks) for EVERY platform except an Instagram Reel with
video — but `PostPreview.jsx`'s `switch (platform)` dispatch only passed `slides` to two of thirteen
cases. `InstagramPreview` was wired correctly and even carries its own comment warning about "the
preview lying about the published artifact" — and nobody generalised that warning to the other cases
when they were added. Found 2026-08-03 across three PRs: Facebook rendered the raw photo with no
on-photo text (a post whose Facebook copy carried a real headline and footer showed neither); LinkedIn
and GBP rendered NO image at all despite 14 and 7 already-baked posts live in prod. Each gap was
individually invisible — the preview just showed *something* plausible, never an error.

**Rule: when one dispatch/switch statement fans out to N per-platform (or per-type) handlers and only
SOME of them wire a given prop, treat that as exactly as suspect as a hardcoded value that only some
copies of a mirror pair updated.** Audit by counting real data, not by reading the dispatch and trusting
it looks complete: `select platform, count(*) filter (where <the feature's precondition>) from <table>
group by platform` finds which cases are silently missing the wiring and how many live rows it actually
affects — a code read alone can't tell you severity. `tests/lib/previewSlidesCoverage.test.js` now
enumerates every case and asserts each slide-bearing platform gets `slides`, with the platforms
deliberately left out pinned as a recorded decision (`instagram_story` uses `overlayText`/`textCard`
instead; `blog`/`landing_page`/`email` publish off the social path; `tiktok`/`youtube` are video-first)
so the next platform added has to actively decide which side of the line it's on.

## Bernard PRODUCT brand ≠ tenant brand — two color namespaces that must never cross

This keeps coming up (Q, repeatedly). There are two brands, and they share a history that makes them
easy to conflate:

| Namespace | What it is | Color | Where it belongs |
|---|---|---|---|
| **Bernard product** | the SaaS app's own chrome | Blue Spruce `#0C7580` (`BERNARD_PRIMARY`, `--primary`), amber `#d97706` (`BERNARD_ACTION`, `--action`) | nav, buttons, app UI **only** |
| **Tenant brand** | the clinic's own brand, stored on its `workspaces` row | e.g. Move Better = orange **`#E36525`** (`colors.primary` / `brand_style.accent_color`) | that tenant's **published content only** |

The app was built FOR Move Better in orange, then repainted to Bernard emerald/Blue Spruce (#1294) —
so `#E36525` looks "retired" but is **Move Better's LIVE tenant color** (verified in prod:
`colors.primary` = `#E36525` for all three Move Better workspaces). `#0C7580` Blue Spruce is Bernard's,
NOT Move Better's — do **not** propose it as a tenant default.

**The wall (both directions):**
- Product chrome must not use a tenant/retired brand hex → `bernard/no-hardcoded-brand-color` (the
  `#e36525`/`#6e7072`/… ban is about keeping those literals out of *app chrome code*, NOT a claim that
  the tenant retired the color).
- **Tenant content** (captions, overlays, slide text, baked reels/photos — anything rendered into a
  tenant artifact) must resolve color ONLY from the tenant palette (`workspaceCaptionAccent(workspace)`
  client / `resolveBrandColors(workspace)` server), falling back to a **neutral** (white / black /
  `#83957C` / `#1a3a5c`) — **never** a `BERNARD_*` constant → `bernard/no-product-brand-in-content`,
  scoped to the render-pipeline + editor files in `eslint.config.js` (add new render files to that glob).

Triage note: a Move Better reel with an **orange** karaoke caption is **on-brand**, not a bug. The
recurring failure is the reverse — Bernard's Blue Spruce / amber leaking INTO tenant content (seeded
caption defaults, editor swatches, render-fn defaults). (feedback dd192d5f, 2026-08: VideoEditor seeded
the caption default accent to `BERNARD_PRIMARY` and offered `BERNARD_ACTION` as a caption swatch;
`videoOverlays.js` defaulted `accentColor` to `#0C7580`.)

## Caption style invariants (`karaokeCaptions.js` `CAPTION_STYLES`)

Two rules, both pinned by `tests/lib/captionStyleContrast.test.js`, both violated in shipped styles:

- **A halo must not be the same colour as the fill it surrounds.** `glow` drew an accent outline while
  karaoke fills the *spoken* word with the accent — an accent fill inside an accent stroke 15% of the
  font size thick, which dissolved into a blob. Making the halo translucent does NOT fix it; same hue at
  any alpha is still no contrast. It also was never a size bug: the stroke is `fontSize × 0.08 ×
  outlineMul`, a constant *fraction*, so it was equally wrong at every size.
- **Every style must have `PrimaryColour !== SecondaryColour`.** `\k` karaoke works by swapping secondary
  (upcoming) to primary (spoken); `accent_fill` set both to white via `whiteText`, so the per-word timing
  was computed and thrown away. On a `BorderStyle=3` style the box cannot carry the highlight — libass
  draws ONE box behind the whole line, not per word — so it has to be a text colour.

## `gradeToCanvasFilter` is the carousel BAKE, not just a preview

`src/lib/gradeParams.js` `gradeToCanvasFilter()` feeds three places: the Brand vibe preview
(`BrandKit.jsx`), the video editor preview (`video-editor/Canvas.jsx`), **and `overlayTemplates.js:1525`, which is
the carousel slide bake**. A change here alters published images, not only what someone sees while
editing. (2026-07-25: a flat `hue-rotate(185deg)` on any cool grade — the sepia scaled with warmth, the
rotation did not — was spinning skin tones to cyan in *published* carousels for the two stock vibes with
negative warmth.) There is no CSS/canvas primitive for the server's cool, which is a per-channel gain, so
cool is deliberately a client-side no-op and the Sharp/ffmpeg bake is authoritative for it.

## `generateAndPersistThumbnail(asset, scope)` wants the workspace OBJECT, and swallows the error

`requireScope()` checks `scope?.workspace`, so the shape is
`{ column: 'workspace_id', id: ws.id, workspace: ws }` — passing `{ workspaceId: ws.id }` throws. Because
posters are deliberately best-effort (a poster is a nicety; losing it must never cost the clip), callers
wrap the call in `.catch()`, so the throw is swallowed and every asset silently ends up with a blank
tile. (2026-07-25: a re-render migration produced four clips with no poster this way; found by querying
`thumbnail_url` afterwards, not from the script's exit code.) **After any batch that generates posters,
verify with a `thumbnail_url IS NULL` count rather than trusting a zero exit.** And note `media_urls` is
a SNAPSHOT, not a join: repointing an asset's `blob_url` without also rewriting the entry leaves `/week`
and the editors rendering the old file.

## `content_items.media_urls` entries

**`content_items.media_urls` canonical shape is `[{url, type, kind, …}]` objects** — never bare strings. A bare string URL → the video publisher can't determine type → ships as a broken image. Every writer must use the object shape. Use `clipToMediaEntry()` / `pickerItemToMediaEntry()` from `src/lib/mediaEntry.js` to construct entries.

**A suggest-media *clip* is NOT a media_urls entry — and `useMediaSuggestions` returns `{ clips: [...] }`, not a bare array.** A suggestion clip is `{ blobUrl, assetId, kind, thumbnailUrl, … }`; a media_urls entry is `{ url, type, mediaAssetId, … }`. Storing a clip raw gives `url: null` (it has `blobUrl`, not `url`) AND breaks `mediaEntryKey` (which reads `mediaAssetId`, not `assetId`) — so dedup and `photo_idx` binding silently fail. ALWAYS pass a clip through `clipToMediaEntry()` before storing/keying it — the Swap-photo panel does this (`attach(clipToMediaEntry(clip))`); the carousel auto-attach did NOT and shipped two follow-up PRs (#1660 read the wrong return shape → bailed entirely; #1662 then stored raw clips → `url:null` blanks). When wiring a new consumer of `useMediaSuggestions`, read `.clips` and map through `clipToMediaEntry`. (Symptom that catches it: editor header shows "N photos" but slides render blank / `photo_idx` stays null in the DB — verify the *persisted* row, not just that the effect fired.)

**Carousel auto-attach persists BOTH `media_urls` and the per-slide `photo_idx` binding** (#1663). It only fires on first open of a media-empty carousel, so if it wrote `media_urls` but left the binding in local state until an explicit Save, a reload-before-Save left "N photos" attached-but-unbound and it could never re-fire (media no longer empty). It now PATCHes `{ mediaUrls, slides }` together and sets the saved baseline. No bake on auto-attach — slide images bake on explicit Save (publish has its own render fallback).

**A `composed: true` entry's `.url` is a BAKED composite, not the photo — draw `sourceUrl || url` (via `photoSourceUrl()` in `mediaEntry.js`) anywhere you re-render the photo under live text.** The editorial "Bake to image" flow (`api/_routes/editorial/compose-photo.js`) flattens a headline onto a navy `dark-claim` card and writes that composite to `entry.url`, stashing the original photo in `entry.sourceUrl` (`composed: true`). Any surface that draws the photo to apply its OWN live text (carousel themes via `renderFreeformSlide`) must use the raw `sourceUrl`, or it draws the baked text-card and hides the photo. This bit 5 drifting call sites at once (#1447, 2026-06-20): `SlideEditor` canvas/rail/full-preview, `renderSlides.js` publish-bake + ad-export, and `PostPreview` `SlideCanvas` all read `.url` while ad export alone (correctly) used `sourceUrl || url`. Symptom: a mixed carousel shows photos on un-baked slides and navy text-cards on baked ones. Un-baked entries have no `sourceUrl`, so `photoSourceUrl()` is a no-op for them — always route slide-photo reads through it. (Same family as "A preview is not the published artifact", in `publish.md`.)

## Blob store
All production media lives in a single Vercel Blob store (`bernard-prod`, prefix `t4otw6ecf8ztxfeq`), attached to the `bernard` Vercel project on team `movebetter`. `BLOB_READ_WRITE_TOKEN` in `.env.local` / Vercel env points to this store.

**Legacy stores are gone.** Three per-brand blob stores (`gmrxcvv1cauu7ksf`, `jl52kpqqmvyxuhpr`, `ep9i5v4jhxekujri`) were detached from Vercel when the per-brand projects were deleted on 2026-05-10. All 908 `media_assets.blob_url` values were migrated to the current store by `scripts/migrate-legacy-blobs.mjs` (2026-05-12, PR #325). Legacy public URLs may continue to resolve for a time but are not relied upon.

**Thumbnail uploads** go to `media/thumbs/<uuid>.jpg`; originals go to `media/raw/<workspace-id>/...`. Both live in the same store.

**Blob path namespacing: use `ws.id`, not `ws.slug`.** Blob keys must use the immutable workspace UUID as the primary namespace component, not the mutable slug. Using `ws.slug` creates two failure modes: (1) a workspace rename silently orphans existing blobs and breaks any handler that validates a blob URL against an expected prefix (see `api/voice-clone/resume.js`), (2) a slug reuse window (however brief) creates a path collision. The slug may appear as a secondary human-readable component, but `ws.id` must be the primary key. Five handlers were found using slug-based paths in the 2026-05-29 audit; all were moved to `ws.id` (#1050, #1181, #1261, #1661), and a 2026-11-12 sweep of every blob `put`/`pathname` under `api/` found none left on the slug (a slug still appears in log lines, and a content slug appears after `ws.id` in the ads render paths, which is fine).

**Re-running the migration** is safe (idempotent): `node scripts/migrate-legacy-blobs.mjs --dry-run` shows what would migrate; without `--dry-run` it skips rows already on the current store. Requires `MULTITENANT_DATABASE_URL` + `BLOB_READ_WRITE_TOKEN` in `.env.local`.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.
