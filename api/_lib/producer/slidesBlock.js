// Shared parser for atom model output: splits the plain caption from the
// optional Instagram ---SLIDES--- carousel JSON plan, and strips the
// <PROVENANCE> trailer. This is the SINGLE source of truth for that split —
// the first-draft path (draftAtom.js) and the regenerate path
// (content-items/regenerate.js) both import it so they can't drift.
//
// Why this exists: regenerate.js used to split only on a stale ---OVERLAY---
// marker the prompt no longer emits, so for every Instagram piece the raw
// ---SLIDES--- separator + JSON array landed in the caption box on regenerate
// (P0, reported 2026-07-29). Centralizing the parse closes that drift.

import { stripAiDashes } from '../stripAiDashes.js'
import { extractProvenanceBlock } from '../../../src/lib/provenance.js'

/**
 * @param {string} rawText - the raw model output for an atom.
 * @returns {{ caption: string, slides: object[]|null }}
 *   caption: the plain caption text (provenance + ---SLIDES--- stripped, trimmed;
 *            NOT dash-stripped or clamped — callers apply those).
 *   slides:  normalized carousel plan, or null when no valid ---SLIDES--- block.
 */
export function parseCaptionAndSlides(rawText) {
  const content = extractProvenanceBlock(String(rawText ?? '').trim()).content
  const [captionRaw, slidesRaw] = content.split('---SLIDES---')
  const caption = (captionRaw ?? '').trim()

  let slides = null
  if (slidesRaw) {
    try {
      const jsonStr = slidesRaw.trim().replace(/^```(?:json)?\s*/i, '').replace(/```\s*$/i, '').trim()
      const parsed = JSON.parse(jsonStr)
      if (Array.isArray(parsed) && parsed.length > 0) {
        slides = parsed
          .filter((s) => s && typeof s === 'object')
          .map((s) => ({
            photo_idx: null,
            template: typeof s.template === 'string' ? s.template : 'custom',
            blocks: Array.isArray(s.blocks)
              ? s.blocks
                  .filter((b) => b && typeof b === 'object' && typeof b.text === 'string' && b.text.trim() !== '')
                  .map((b) => ({
                    role: typeof b.role === 'string' ? b.role : 'body',
                    text: stripAiDashes(b.text.trim()),
                    position: b.position ?? 'center',
                  }))
              : [],
          }))
          .filter((s, idx) => idx === 0 || s.blocks.length > 0 || s.template === 'demonstration')
        if (slides.length === 0) slides = null
      }
    } catch (e) {
      console.warn('[slidesBlock] Failed to parse ---SLIDES--- JSON:', e.message)
      slides = null
    }
  }
  return { caption, slides }
}
