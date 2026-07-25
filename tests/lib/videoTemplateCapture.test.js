import { describe, it, expect } from 'vitest'
import { buildTemplateFromEditor, suggestTemplateName } from '../../src/lib/videoTemplateCapture.js'
import { sanitizeVideoTemplate } from '../../api/_lib/videoTemplates.js'

// A template is authored by editing a real clip and saving the look, so the
// whole job of the capture step is separating STYLE (carries to the next clip)
// from CONTENT (belongs to this one). These pin that line.

const caption = (over = {}) => ({ preset: 'karaoke', position: 'bottom', size: 'medium', style: 'bold', accent: '#E36525', ...over })
const overlay = (over = {}) => ({ id: 'o1', role: 'hook_card', text: 'Your tendons do the work', x: 0.5, y: 0.17, size: 1, in: 0, out: 2.5, color: '#ffffff', ...over })

describe('capture — style vs content', () => {
  it('captures caption position, size and style', () => {
    const { config } = buildTemplateFromEditor({ caption: caption({ position: 'center', size: 'large', style: 'glow' }), overlays: [], durationSec: 9 })
    expect(config.captions).toMatchObject({ enabled: true, position: 'center', style: 'glow' })
    expect(config.captions.sizeScale).toBeCloseTo(1.35)
  })

  it('never captures the headline TEXT', () => {
    const { config, skipped } = buildTemplateFromEditor({ caption: caption(), overlays: [overlay()], durationSec: 9 })
    expect(JSON.stringify(config)).not.toContain('Your tendons')
    expect(skipped.join(' ')).toMatch(/each reel writes its own/i)
  })

  it('captures headline role and placement', () => {
    const { config } = buildTemplateFromEditor({ caption: caption(), overlays: [overlay({ y: 0.42 })], durationSec: 9 })
    expect(config.headline.role).toBe('hook_card')
    expect(config.headline.yFrac).toBeCloseTo(0.42)
  })

  it('turns a hold that runs to the end of THIS clip into the reading-time rule', () => {
    // Running to the end is a property of the clip, not a decision — pinning the
    // seconds would make every future reel hold for this clip's length.
    const { config } = buildTemplateFromEditor({ caption: caption(), overlays: [overlay({ in: 0, out: 9 })], durationSec: 9 })
    expect(config.headline.hold).toBe('reading')
  })

  it('keeps a deliberate shorter hold as a number', () => {
    const { config } = buildTemplateFromEditor({ caption: caption(), overlays: [overlay({ in: 0, out: 2.4 })], durationSec: 9 })
    expect(config.headline.hold).toBeCloseTo(2.4)
  })

  it('records a fade-in only when the headline does not start at 0', () => {
    const at0 = buildTemplateFromEditor({ caption: caption(), overlays: [overlay({ in: 0 })], durationSec: 9 })
    const later = buildTemplateFromEditor({ caption: caption(), overlays: [overlay({ in: 1.5, out: 4 })], durationSec: 9 })
    expect(at0.config.headline.fadeIn).toBe(false)
    expect(later.config.headline.fadeIn).toBe(true)
  })

  it('ignores callouts and caption bars — those are per-clip annotations', () => {
    const { config, skipped } = buildTemplateFromEditor({
      caption: caption(),
      overlays: [overlay({ role: 'callout' }), overlay({ id: 'o2', role: 'lower_third' })],
      durationSec: 9,
    })
    expect(config.headline.role).toBeNull()
    expect(skipped.join(' ')).toMatch(/stay with this clip/i)
  })

  it('captions-off is a real template, not a failure', () => {
    const { config, captured } = buildTemplateFromEditor({ caption: caption({ preset: 'off' }), overlays: [], durationSec: 9 })
    expect(config.captions.enabled).toBe(false)
    expect(captured.join(' ')).toMatch(/Captions — off/)
  })
})

describe('capture — the dialog can always explain itself', () => {
  it('always reports something captured and something skipped', () => {
    for (const overlays of [[], [overlay()], [overlay({ role: 'title' })]]) {
      const { captured, skipped } = buildTemplateFromEditor({ caption: caption(), overlays, durationSec: 9 })
      expect(captured.length).toBeGreaterThan(0)
      expect(skipped.length).toBeGreaterThan(0)
    }
  })
})

describe('capture — output is renderable', () => {
  it('every captured config survives the server sanitizer unchanged in intent', () => {
    // The capture writes the config the API stores and the renderer reads. If
    // the two disagreed, a saved template would silently render as something
    // else — the client/server boundary is exactly where that drifts.
    for (const over of [{}, { role: 'title', y: 0.3 }, { in: 1, out: 4 }]) {
      const { config } = buildTemplateFromEditor({ caption: caption({ style: 'glow', size: 'large' }), overlays: [overlay(over)], durationSec: 9 })
      const clean = sanitizeVideoTemplate(config)
      expect(clean.headline.role).toBe(config.headline.role)
      expect(clean.captions.position).toBe(config.captions.position)
      expect(clean.captions.style).toBe(config.captions.style)
      expect(clean.captions.sizeScale).toBeCloseTo(config.captions.sizeScale)
      expect(clean.blocks.headline.color).toBe(config.blocks.headline.color)
    }
  })
})

describe('suggested name', () => {
  it('describes what the template does', () => {
    expect(suggestTemplateName({ caption: caption(), overlays: [overlay()] })).toBe('Hook card')
    expect(suggestTemplateName({ caption: caption(), overlays: [overlay({ role: 'title' })] })).toBe('On-frame headline')
    expect(suggestTemplateName({ caption: caption({ position: 'center' }), overlays: [] })).toBe('Centred captions')
  })
})
