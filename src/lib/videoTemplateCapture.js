// Turn a VideoEditor session into a reusable template config.
//
// Templates are authored by editing a REAL clip and saving the look, rather than
// in a separate template-editing screen. That is what keeps the preview honest:
// the editor already renders the thing, so there is no second surface to drift
// out of sync with the bake.
//
// The whole job here is separating STYLE from CONTENT. Style is what should
// carry to the next clip; content is what belongs to this one:
//
//   style     caption on/off, position, size, style, colour
//             headline role, vertical placement, hold, typography
//   content   the headline TEXT, this video, the trim points, per-word caption
//             fixes, the manually nudged x position of one overlay
//
// Anything ambiguous is resolved toward style, because a template that captures
// too little is silently useless while one that captures too much is visibly
// wrong the first time you use it — and visible beats silent.
//
// KEEP IN SYNC with api/_lib/videoTemplates.js (the client/server import
// boundary forbids sharing one file — same arrangement as gradeParams.js).

export const NAMED_SIZE_SCALE = { small: 0.75, medium: 1.0, large: 1.35 }

// Editor overlay roles that a template can express. 'lower_third' and 'callout'
// are per-clip annotations, not a reel's look, so they are not captured as the
// template's headline.
const TEMPLATE_HEADLINE_ROLES = ['hook_card', 'title']

const WEIGHT_FOR_ROLE = { hook_card: 'bold', title: 'extrabold' }

/**
 * @param {Object} p
 * @param {Object} p.caption   editor caption state {preset, position, size, style, accent}
 * @param {Array}  p.overlays  editor overlays
 * @param {number} p.durationSec
 * @returns {{config: object, captured: string[], skipped: string[]}}
 *   `captured` / `skipped` are human-readable lines for the save dialog — the
 *   user should be able to see exactly what carried over before committing,
 *   rather than discovering it on the next reel.
 */
export function buildTemplateFromEditor({ caption, overlays = [], durationSec = 0 }) {
  const captured = []
  const skipped = []

  const captionsOn = caption?.preset !== 'off'
  const sizeScale = NAMED_SIZE_SCALE[caption?.size] ?? 1.0

  const captions = {
    enabled: captionsOn,
    position: ['top', 'center', 'bottom'].includes(caption?.position) ? caption.position : 'bottom',
    style: caption?.style || 'bold',
    sizeScale,
  }
  captured.push(captionsOn
    ? `Captions — ${captions.position}, ${caption?.size || 'medium'}, ${captions.style.replace(/_/g, ' ')}`
    : 'Captions — off')

  // The headline comes from the first overlay whose role a template can express.
  // A clip with only callouts/lower-thirds yields a captions-only template, which
  // is a real template, not a failure.
  const head = overlays.find((o) => TEMPLATE_HEADLINE_ROLES.includes(o?.role))
  let headline = { role: null }

  if (head) {
    const holdSec = Math.max(0.5, Number(head.out) - Number(head.in))
    // A hold that runs to the end of THIS clip is a property of the clip, not a
    // decision — fall back to the reading-time rule so it adapts to the next one.
    const runsToEnd = durationSec > 0 && Number(head.out) >= durationSec - 0.05
    headline = {
      role: head.role,
      yFrac: Number.isFinite(Number(head.y)) ? Number(head.y) : 0.17,
      widthFrac: Number.isFinite(Number(head.widthFrac)) ? Number(head.widthFrac) : 0.88,
      hold: runsToEnd ? 'reading' : Math.round(holdSec * 10) / 10,
      fadeIn: Number(head.in) > 0.001,
    }
    captured.push(`Headline — ${head.role === 'hook_card' ? 'inset card' : 'on-frame title'} at ${Math.round(headline.yFrac * 100)}% height`)
    captured.push(runsToEnd
      ? 'Headline hold — reading time, adapts per clip'
      : `Headline hold — ${headline.hold}s`)
    skipped.push(`Headline text ("${String(head.text || '').slice(0, 32)}…") — each reel writes its own`)
  } else {
    captured.push('Headline — none (captions only)')
    if (overlays.length) skipped.push(`${overlays.length} text overlay${overlays.length > 1 ? 's' : ''} — callouts and caption bars stay with this clip`)
  }

  const hex = /^#[0-9a-fA-F]{6}$/
  const headlineColor = hex.test(head?.color || '') ? head.color : '#FFFFFF'
  if (head && headlineColor !== '#FFFFFF') captured.push(`Headline colour — ${headlineColor}`)

  skipped.push('This video, its trim points, and any per-word caption fixes')

  return {
    config: {
      headline,
      captions,
      blocks: {
        headline: {
          fontWeight: head?.fontWeight || WEIGHT_FOR_ROLE[head?.role] || 'bold',
          color: headlineColor,
          shadow: head?.shadow || (head?.role === 'title' ? 'strong' : 'medium'),
          uppercase: head?.uppercase === true,
        },
        caption: {
          fontWeight: 'bold',
          color: '#FFFFFF',
          shadow: 'medium',
          uppercase: false,
        },
      },
    },
    captured,
    skipped,
  }
}

/** A default name from what the template actually does, so it isn't "Untitled 3". */
export function suggestTemplateName({ caption, overlays = [] }) {
  const head = overlays.find((o) => TEMPLATE_HEADLINE_ROLES.includes(o?.role))
  if (!head) return caption?.position === 'center' ? 'Centred captions' : 'Captions only'
  return head.role === 'hook_card' ? 'Hook card' : 'On-frame headline'
}
