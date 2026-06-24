# Unified shell — Phases 2–4 implementation spec (code-grounded)

Builds on Phase 1 (`src/lib/editorArchetype.js`, `src/components/editor/EditorChrome.jsx`, both LIVE once #1669 merges). Each phase ships as its own PR, Chrome-verified before merge (authed surfaces are prod-only). Reference mockup: `.claude/mockups/unified-shell-all-channels.html`. Architecture: `.claude/unified-shell-architecture.md`.

Guardrails (carry from CLAUDE.md): client-canvas (`renderFreeformSlide`, VideoEditor `<Canvas>`) → Chrome-only verify; one render path / `slideSignature`; `media_urls` object shape; router `*` catch-all; lint 0; `useAppMutation`/`apiFetch`; mockup-first for net-new UI.

---

## Phase 2 — VideoEditor adopts EditorChrome + `EditorSurface` mount-switch

**Goal:** both editors share the chrome; the side surface (slide rail vs timeline) becomes a switch keyed on archetype.

### 2a. `EditorSurface` component (new) — `src/components/editor/EditorSurface.jsx`
A thin mount-switch. Reads `surfaceFor(piece)` from `editorArchetype.js` and renders the supplied surface node, or nothing for `SURFACE.NONE`. Keeps the "which surface mounts" rule in one place.
```jsx
import { SURFACE } from '@/lib/editorArchetype'
// <EditorSurface kind={surfaceFor(piece)} slides={<SlideRail .../>} timeline={<VerticalTimeline .../>} variants={<AdSizes .../>} />
export default function EditorSurface({ kind, slides, timeline, variants }) {
  if (kind === SURFACE.SLIDES) return slides ?? null
  if (kind === SURFACE.TIMELINE) return timeline ?? null
  if (kind === SURFACE.VARIANTS) return variants ?? null
  return null // SURFACE.NONE
}
```
Then SlideEditor renders `<EditorSurface kind="slides" slides={<SlideRail/>}/>` and VideoEditor `<EditorSurface kind="timeline" timeline={<VerticalTimeline/>}/>`. (Marginal today; pays off in Phase 4 when one component mounts either.)

### 2b. VideoEditor adopts EditorChrome — `src/pages/VideoEditor.jsx`
**This is the layout change. Chrome-verify the reel editor end-to-end.**

Current (line ~848): `<div className="flex h-[calc(100vh-3.5rem)]"><IconRail/><aside w-272>{title+transport+format+export, then inspector}</aside><Canvas/><VerticalTimeline/></div>`. The chrome (back/title/transport/format/export) lives at the TOP of the left `aside`.

Target: lift back/title/format/export into an `EditorChrome` top bar (matching SlideEditor), leaving the `aside` as inspector-only. Wrap in the same outer column:
```jsx
<div className="flex h-[calc(100vh-3.5rem)] flex-col">
  <EditorChrome
    onBack={() => navigate('/moments')}
    title={asset.display_title || asset.filename || 'Reel'}
    badge={{ icon: Film, label: (FORMATS[format]||FORMATS.reel).label, sub: (FORMATS[format]||FORMATS.reel).dim }}
    aspect={{ value: format, options: FORMAT_KEYS, onChange: setFormat }}  // note: FORMAT_KEYS are reel/square/portrait, not 1:1 strings — either map labels or keep VideoEditor's own format seg in the body and pass aspect={null}
  >
    {/* transport (play/pause + time) + Export dropdown move here */}
  </EditorChrome>
  <div className="flex min-h-0 flex-1">
    <IconRail ctx={ctx} />
    <aside className="w-[272px] …">{/* inspector only — sel-switched panels */}</aside>
    <Canvas ctx={ctx} />
    <EditorSurface kind="timeline" timeline={<VerticalTimeline ctx={ctx} />} />
  </div>
</div>
```
**Risks:** (1) the transport (play/pause/scrub time) currently sits in the aside header — moving it to the chrome must keep `togglePlay`/`playClipT` wiring. (2) the Export dropdown's absolute-positioned menu (`exportOpen`) must still anchor correctly in the top bar. (3) `FORMAT_KEYS` (reel/square/portrait) ≠ aspect strings — either keep VideoEditor's format seg in the body and pass `aspect={null}` to EditorChrome, or extend EditorChrome to accept labeled options. Simplest: pass `aspect={null}`, keep the existing format seg where it is for now.
**Verify:** open `/slate/clip/:assetId` for a real clip — transport plays, trim handles drag, captions toggle, format switch reframes, Export → post/library/ads all work, the timeline still scrubs.

---

## Phase 3 — Unified IconRail + media-tier canvas states

### 3a. `IconRail` component (new) — `src/components/editor/IconRail.jsx`
Driven by `railFor(piece)` (the archetype's ordered section list) + the media tier. Each section = icon + label + active state; clicking sets the inspector selection. Replaces VideoEditor's bespoke `IconRail` and SlideEditor's accordion-as-rail with one matrix-driven rail. Sections map to inspector panels via a registry:
```js
const RAIL_META = { words:{icon:…,label:'Words'}, media:{…}, slide:{…}, photo:{…}, text:{…}, grade:{…}, trim:{…}, caption:{…}, overlay:{…}, link:{…}, doc:{…}, seo:{…}, email:{…}, variants:{…} }
```
Filter out `media` for `mediaTierFor(piece)==='none'` (Google text ads). Mockup is the visual spec.

### 3b. Media-tier canvas states (the text-only answer)
Per `mediaTierFor(piece)` + `needsMediaToPublish(piece)` (already in `editorArchetype.js`):
- **required + no media:** keep today's "needs media" publish gate.
- **optional + no media:** the canvas shows a **text-post card** (avatar + caption + "+ add media (optional)"), NOT a block. New `<TextPostCanvas>` (model on the mockup's tweet card). Toggle to the visual artifact once media is attached.
- **none:** `<TextAdCanvas>` (headlines + descriptions preview; no Media rail section).
Build these as a `CANVAS`-kind switch (`canvas` field on the archetype): `visual | doc | email | textad`. **Mockup-first** — the text-only + textad states are net-new; recreate in `.claude/mockups/` for sign-off before coding.

### 3c. Panel registry
Inspector panels keyed by selected-element type (Figma model): `slide | photo | text | overlay | clip | words | grade | caption | link | doc | seo | email`. Each editor registers the panels its archetype uses. This is the deepest refactor — the existing SlideEditor accordion panels + VideoEditor `sel`-switched panels become registry entries. Do incrementally.

---

## Phase 4 — Single entry route

**Goal:** `/publish/:pieceId` resolves the archetype and mounts the right editor; `/slate/clip/:assetId` (asset-backed reel editor) folds into the same shell.

- `src/pages/StoryboardPublish.jsx` already branches on archetype (Phase 1). Extend: `carousel|story|storyvid|visual|doc|email|textad|ad` each → its editor body inside the shared shell. Today carousel→SlideEditor, story→StoryComposer, others→generic two-column. Target: all through one `<UnifiedEditor piece={piece}/>` that composes EditorChrome + IconRail + canvas + EditorSurface by archetype.
- Fold `/slate/clip/:assetId` (VideoEditor, asset-backed): the unified editor must accept either a `piece` (content_items) or an `asset` (media_assets) source. Reel-from-asset and reel-from-piece share the same body.
- **Router `*` catch-all footgun** (CLAUDE.md, PR #729): every authed route flows through the `*` catch-all into `ProtectedAppWithProvider`'s descendant `<Routes>`. Do NOT add fixed-path outer routes. Keep `/publish/:pieceId` inside the descendant routes. Verify deep-links (`/publish/<id>`, `/slate/clip/<id>`) resolve, not silently render Home.
- **Verify:** deep-link each archetype; confirm no route renders the wrong page; carousel/reel/story all open their correct editor.

---

## Sequencing
Verify+merge Phase 1 (#1669) → Phase 2 (one PR, Chrome-verify the reel editor hard) → Phase 3 (mockup-first for text-only/textad, then build IconRail + canvas states) → Phase 4 (router last, verify deep-links). Each PR: gates green + Chrome-verify the affected editor before merge. Never auto-merge a structural editor change unverified.
