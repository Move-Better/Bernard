// ESLint rule: ban temperature/top_p/top_k on Claude Opus 4.7+ model calls.
//
// As of Claude Opus 4.7, Anthropic deprecated the `temperature`, `top_p`, and
// `top_k` sampling parameters: setting any of them to a non-default value
// returns a 400 from the API (this applies to Opus 4.7, 4.8, and any later
// Opus). See https://platform.claude.com/docs/en/about-claude/model-deprecations
//
// Today no Opus call site in this repo passes these params, so nothing breaks
// now — this rule is a tripwire so a future edit (e.g. bumping a Sonnet/Haiku
// call that DOES set `temperature` up to an Opus model) can't ship a guaranteed
// 400. It flags an object literal that has BOTH a sampling param AND a `model`
// property resolving to an Opus 4.7+ id (string literal inline, or a module
// const initialized to one — the two shapes used in this codebase).
//
// To intentionally keep a sampling param (e.g. on a non-Opus model the rule
// mis-resolved), add eslint-disable-next-line with a reason.

const SAMPLING_KEYS = new Set(['temperature', 'top_p', 'topP', 'top_k', 'topK'])

// Opus 4.7+, 4.8+, 4.9, or any Opus 5+. Matches both bare ('claude-opus-4-7')
// and gateway-prefixed ('anthropic/claude-opus-4-7') ids.
const OPUS_47_PLUS = /claude-opus-4-(?:[7-9])\b|claude-opus-[5-9]\b/

function propKeyName(node) {
  const k = node.key
  if (!k) return null
  return k.type === 'Identifier' ? k.name : k.type === 'Literal' ? k.value : null
}

// Resolve a value node to a string if it's a string literal, or a same-module
// const identifier initialized to a string literal.
function resolveString(node, context) {
  if (!node) return null
  if (node.type === 'Literal' && typeof node.value === 'string') return node.value
  if (node.type === 'Identifier') {
    const scope = context.sourceCode.getScope(node)
    let s = scope
    while (s) {
      const variable = s.variables.find((v) => v.name === node.name)
      if (variable) {
        for (const def of variable.defs) {
          const init = def.node && def.node.init
          if (init && init.type === 'Literal' && typeof init.value === 'string') return init.value
        }
        return null
      }
      s = s.upper
    }
  }
  return null
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow temperature/top_p/top_k on Claude Opus 4.7+ calls — they return a 400 from the API',
    },
    messages: {
      noTemperatureOnOpus:
        '`{{param}}` is deprecated on Claude Opus 4.7 and later (model `{{model}}`) — ' +
        'setting it returns a 400 from the API. Remove the sampling param and steer with the prompt instead. ' +
        'See https://platform.claude.com/docs/en/about-claude/model-deprecations',
    },
    schema: [],
  },

  create(context) {
    return {
      ObjectExpression(node) {
        const props = node.properties.filter((p) => p.type === 'Property')

        const modelProp = props.find((p) => propKeyName(p) === 'model')
        if (!modelProp) return
        const modelStr = resolveString(modelProp.value, context)
        if (!modelStr || !OPUS_47_PLUS.test(modelStr)) return

        for (const p of props) {
          const name = propKeyName(p)
          if (SAMPLING_KEYS.has(name)) {
            context.report({
              node: p,
              messageId: 'noTemperatureOnOpus',
              data: { param: name, model: modelStr },
            })
          }
        }
      },
    }
  },
}
