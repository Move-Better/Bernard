// ESLint rule: ban `detail:` field in res.json() error responses in API handlers.
//
// Over 26 audit rounds, the single most-repeated finding was a `detail: e.message`
// or `detail: text` field leaking server internals to callers. The pattern came
// from copy-paste: one handler set the precedent and ~15 others copied it.
// This rule flags any `Property` with key "detail" inside an argument to a
// `.json()` call within api/** files, so the mistake is caught at lint time
// rather than in a post-ship audit round.
//
// Scoped to api/** only — src/ has no res.json() calls.

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Disallow `detail:` field in res.json() responses — log server-side, return only the error key',
    },
    messages: {
      noDetailInErrorResponse:
        '`detail:` in res.json() leaks server internals to callers. ' +
        'Log the message with console.error() and return only the opaque error key. ' +
        'Add eslint-disable-next-line with a reason only for intentional, non-sensitive detail (e.g. a user-facing validation message).',
    },
    schema: [],
  },

  create(context) {
    return {
      Property(node) {
        // Only flag `detail:` keys
        const key = node.key
        const keyName = key.type === 'Identifier' ? key.name : key.type === 'Literal' ? key.value : null
        if (keyName !== 'detail') return

        // Walk up to find if we're inside a .json() CallExpression argument
        let current = node.parent // ObjectExpression
        if (!current || current.type !== 'ObjectExpression') return
        const objExpr = current
        current = objExpr.parent // CallExpression (the .json() call)
        if (
          !current ||
          current.type !== 'CallExpression' ||
          !current.arguments.includes(objExpr)
        ) return

        const callee = current.callee
        if (
          callee.type !== 'MemberExpression' ||
          (callee.property.name !== 'json' && callee.property.value !== 'json')
        ) return

        context.report({ node, messageId: 'noDetailInErrorResponse' })
      },
    }
  },
}
