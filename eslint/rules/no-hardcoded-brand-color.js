// ESLint rule: ban hardcoded *retired brand* color values in JS/JSX.
//
// The repaint to Bernard emerald (PR #1294) was a multi-file hunt because the
// brand color had leaked out of the design tokens (src/index.css --primary etc.)
// into raw hex / hsl / rgba literals — in className arbitrary values AND in JS
// color objects (PipelineKanban LANES, Home ACCENT, workspace.js colors). This
// rule stops that leakage at PR time: a retired brand value anywhere in a string
// literal is an error, pushing authors back to the token.
//
// Scope note: this is deliberately NARROW — it bans only the specific *retired*
// brand values, not all hex. Legitimate neutral/semantic hex (slate #64748b,
// status pills #ecfdf5, decorative gradients) is untouched, the same way
// no-arbitrary-text-size targets only text-[Npx]. The CSS token definitions in
// src/index.css are not JS and are never scanned.

const BANNED = [
  // Retired brand hexes: Move-Better orange / grey, NarrateRx evergreen, coral, old Bernard emerald.
  { re: /#(?:e36525|6e7072|1c4d37|ff8552|10b981)\b/gi, hint: 'retired brand hex' },
  // The Move-Better orange expressed as rgb()/rgba() (e.g. shadow tints).
  { re: /rgba?\(\s*227\s*,\s*101\s*,\s*37\b/gi, hint: 'Move-Better orange as rgb()' },
  // Any orange hue-20 HSL literal — this is the old --primary/--accent value
  // pasted inline (e.g. bg-[hsl(20_76%_52%)]) instead of referencing the token.
  { re: /hsl\(\s*20[\s_]/gi, hint: 'orange hue-20 HSL (old --primary/--accent value)' },
]

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow hardcoded retired brand color values; reference the design tokens in src/index.css instead',
    },
    messages: {
      noHardcodedBrandColor:
        'Hardcoded brand color "{{ value }}" ({{ hint }}). Reference a design token instead — ' +
        'bg-primary / text-primary / hsl(var(--primary)) for emerald, hsl(var(--action)) for the ' +
        'act-now signal (see src/index.css). Only add an eslint-disable with a reason if this is ' +
        'a deliberate, documented exception.',
    },
    schema: [],
  },

  create(context) {
    function check(node, value) {
      if (typeof value !== 'string' || !value) return
      for (const { re, hint } of BANNED) {
        re.lastIndex = 0
        let m
        while ((m = re.exec(value)) !== null) {
          context.report({
            node,
            messageId: 'noHardcodedBrandColor',
            data: { value: m[0], hint },
          })
        }
      }
    }

    return {
      Literal(node) {
        check(node, node.value)
      },
      TemplateLiteral(node) {
        for (const q of node.quasis) {
          check(node, q.value.cooked || q.value.raw)
        }
      },
    }
  },
}
