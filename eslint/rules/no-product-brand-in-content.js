// ESLint rule: ban Bernard PRODUCT-brand colors inside TENANT-content render code.
//
// The recurring confusion (Q, repeatedly): Blue Spruce #0C7580 (BERNARD_PRIMARY)
// and amber #d97706 (BERNARD_ACTION) are the SaaS PRODUCT's own chrome colors —
// nav, buttons, app UI. They are NOT a tenant's brand. A clinic like Move Better
// has its own brand (orange #E36525, stored on its workspace row), and everything
// that renders INTO that tenant's published artifact — captions, overlays, slide
// text, baked reels/photos — must take the TENANT's color (workspaceCaptionAccent
// / resolveBrandColors), falling back to a brand-NEUTRAL (white / black / the
// #83957C / #1a3a5c neutral seeds), NEVER a BERNARD_* product constant.
//
// This is the mirror of no-hardcoded-brand-color.js: that rule stops a tenant/
// retired brand hex from leaking into PRODUCT chrome; this one stops a PRODUCT
// brand color from leaking into TENANT content. Both directions of the wall.
//
// Scope: registered ONLY for the content-render files (see eslint.config.js) —
// app-chrome components use BERNARD_PRIMARY/BERNARD_ACTION freely and are not
// touched. When you add a new render-pipeline file, add it to that glob so the
// guard covers it (an uncovered render file is how the leak comes back).
//
// Real leak this was written after (feedback dd192d5f, 2026-08): VideoEditor.jsx
// seeded a caption's default accent to BERNARD_PRIMARY and offered BERNARD_ACTION
// as a caption swatch — Bernard's product colors presented as Move Better content
// colors.

const BANNED_IDENTS = new Set(['BERNARD_PRIMARY', 'BERNARD_ACTION', 'BERNARD_EMERALD'])
// Product-brand hexes as raw literals (the token values behind the constants).
const BANNED_HEX = /#(?:0c7580|d97706)\b/gi

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow Bernard product-brand colors (BERNARD_PRIMARY/BERNARD_ACTION and their ' +
        '#0C7580/#d97706 hexes) inside tenant-content render code; resolve the tenant brand instead',
    },
    messages: {
      noProductBrandIdent:
        'Bernard PRODUCT-brand color "{{ name }}" in tenant-content render code. This is the app\'s ' +
        'own chrome color, not the tenant\'s brand — a caption/overlay/slide must use the TENANT color ' +
        '(workspaceCaptionAccent(workspace) / resolveBrandColors) or a neutral (white/black/#83957C), ' +
        'never a BERNARD_* constant. See eslint/rules/no-product-brand-in-content.js.',
      noProductBrandHex:
        'Bernard PRODUCT-brand hex "{{ value }}" in tenant-content render code. Use the tenant brand ' +
        '(workspaceCaptionAccent / resolveBrandColors) or a neutral — never a Bernard chrome color.',
    },
    schema: [],
  },

  create(context) {
    function checkHex(node, value) {
      if (typeof value !== 'string' || !value) return
      BANNED_HEX.lastIndex = 0
      let m
      while ((m = BANNED_HEX.exec(value)) !== null) {
        context.report({ node, messageId: 'noProductBrandHex', data: { value: m[0] } })
      }
    }
    return {
      // `import { BERNARD_PRIMARY } from '@/lib/brand'` — the usual entry point.
      ImportSpecifier(node) {
        const name = node.imported?.name
        if (name && BANNED_IDENTS.has(name)) {
          context.report({ node, messageId: 'noProductBrandIdent', data: { name } })
        }
      },
      // Any other reference to the constant (re-export, member access, etc.).
      Identifier(node) {
        if (!BANNED_IDENTS.has(node.name)) return
        // Skip the import specifier (handled above) to avoid a double report.
        if (node.parent?.type === 'ImportSpecifier') return
        context.report({ node, messageId: 'noProductBrandIdent', data: { name: node.name } })
      },
      Literal(node) { checkHex(node, node.value) },
      TemplateLiteral(node) {
        for (const q of node.quasis) checkHex(node, q.value.cooked || q.value.raw)
      },
    }
  },
}
