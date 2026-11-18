// The slide shape SlideEditor bakes and persists on every autosave.
//
// This REBUILDS each slide from a whitelist, so an omitted field is a
// deletion, not a passthrough: whatever this drops is gone from the saved row
// AND from the bake (ensureRenderedSlides renders this output). Every per-slide
// field the editor sets and renderSlides reads must be listed here.
import { normalizeGrade, isNeutralGrade } from '@/lib/gradeParams'

export function cleanSlidesForSave(slides) {
  return slides.map((s) => ({
    photo_idx: typeof s.photo_idx === 'number' ? s.photo_idx : null,
    // media_idx must be in this whitelist or every autosave silently strips
    // the binding a video slide depends on.
    ...(typeof s.media_idx === 'number' ? { media_idx: s.media_idx } : {}),
    template:  s.template,
    // Preserve the per-slide theme override. Without this it was silently
    // dropped on save — the picker set slide.template_id, the resolver and the
    // bake honored it, but this rebuilt slides without it, so a per-slide
    // theme never persisted. (P0 data-loss fix.)
    template_id: s.template_id || null,
    // Persist the photo reframe (pan/zoom) so it survives reload and ships in
    // the bake. Omit when neutral to keep rows lean + legacy slides identical.
    ...(s.photo_zoom > 1 ? { photo_zoom: s.photo_zoom } : {}),
    ...(s.photo_fill != null ? { photo_fill: s.photo_fill } : {}),
    ...(s.photo_offset && (s.photo_offset.x || s.photo_offset.y)
      ? { photo_offset: { x: s.photo_offset.x || 0, y: s.photo_offset.y || 0 } }
      : {}),
    // Persist the colorist grade; omit when neutral so legacy slides stay lean.
    ...(s.grade && !isNeutralGrade(s.grade) ? { grade: normalizeGrade(s.grade) } : {}),
    blocks:    s.blocks.filter((b) => (b.text || '').trim() !== ''),
    // Logo / watermark layer and the legibility-scrim choice are both baked into
    // the published pixels (renderSlides slideSignature + renderer). Dropping
    // them here lost them on every autosave (audit 2026-11-18).
    ...(Array.isArray(s.objects) && s.objects.length ? { objects: s.objects } : {}),
    ...(s.scrim ? { scrim: s.scrim } : {}),
    // The bake cache key. ensureRenderedSlides skips a slide only when its
    // rendered_sig matches the current pixels' signature, so carrying these is
    // safe: any pixel change produces a new signature and a re-render. Without
    // them every autosave re-rendered and re-uploaded every slide.
    ...(s.rendered_url ? { rendered_url: s.rendered_url } : {}),
    ...(s.rendered_sig ? { rendered_sig: s.rendered_sig } : {}),
  }))
}
