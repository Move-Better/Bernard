// Custom ESLint rule: require workspace isolation in any api/* handler that
// defines a local `sb()` PostgREST helper.
//
// Background. Bernard is a multi-tenant SaaS with one shared Supabase database.
// Tenant isolation is enforced at the API layer — every handler that touches a
// tenant-scoped table must resolve the workspace via workspaceContext(req),
// workspaceScope(req), or workspaceById(id) before querying. There is no RLS
// backstop. A handler that forgets the import leaks cross-tenant data.
//
// What we detect:
//   Any file in api/ (outside api/_lib/) that defines a local function named
//   `sb` whose body contains `SUPABASE_URL` — the canonical PostgREST wrapper
//   pattern used throughout this codebase — but does NOT import at least one of:
//     workspaceContext / workspaceScope / workspaceById
//   from the workspaceContext.js or workspaceScope.js lib modules.
//
// The sb() wrapper is the reliable signal: it's defined inline in every handler
// that talks to PostgREST, so its presence means the handler is querying the DB.
// Requiring a workspace import ensures the tenant filter is in scope.
//
// Suppression (use sparingly, with a reason):
//   // eslint-disable-next-line bernard/require-workspace-scope
//   function sb(...) { ... }
//
// Valid exceptions:
//   - Webhook handlers that identify a workspace via a payload field
//     (e.g. billing/webhook.js resolves workspace by stripe_customer_id, not Host)
//   - Background cron jobs that iterate workspaces and use workspaceById inline
//     (those import workspaceById and satisfy the rule automatically)
//   - Handlers that query only non-tenant global tables (rare; add disable comment)

const WORKSPACE_SPECIFIERS = new Set([
  'workspaceContext',
  'workspaceScope',
  'workspaceById',
])

const MESSAGE =
  "This handler defines an `sb()` PostgREST helper but does not import " +
  "workspaceContext, workspaceScope, or workspaceById. Every handler that queries " +
  "the DB must resolve the workspace before filtering — omitting it leaks " +
  "cross-tenant data. Import from '../_lib/workspaceContext.js' or " +
  "'../_lib/workspaceScope.js' and filter every query by workspace_id. " +
  "If this handler legitimately bypasses workspace scoping (e.g. a webhook that " +
  "resolves workspace from a payload field), add an eslint-disable comment with " +
  "a reason. See CLAUDE.md \"Multi-tenant SaaS\"."

function bodyContainsSupabaseUrl(fnNode) {
  // Walk the function body source to check for SUPABASE_URL — we do this by
  // looking for Identifier nodes named SUPABASE_URL inside the function body.
  let found = false
  function walk(node) {
    if (!node || found) return
    if (node.type === 'Identifier' && node.name === 'SUPABASE_URL') {
      found = true
      return
    }
    for (const key of Object.keys(node)) {
      if (key === 'parent') continue
      const child = node[key]
      if (Array.isArray(child)) child.forEach(walk)
      else if (child && typeof child === 'object' && child.type) walk(child)
    }
  }
  const body = fnNode.body ?? fnNode.init?.body
  if (body) walk(body)
  return found
}

export default {
  meta: {
    type: 'problem',
    docs: {
      description:
        'Require workspaceContext/workspaceScope/workspaceById import in any api/* handler that defines a local sb() PostgREST helper, to enforce multi-tenant data isolation.',
    },
    schema: [],
  },
  create(context) {
    const sourceCode = context.sourceCode ?? context.getSourceCode()
    const program = sourceCode.ast

    // Collect imported workspace specifiers from all ImportDeclarations.
    const importedWorkspaceSpecifiers = new Set()
    for (const node of program.body) {
      if (node.type !== 'ImportDeclaration') continue
      for (const specifier of node.specifiers) {
        const name =
          specifier.type === 'ImportSpecifier'
            ? specifier.imported?.name
            : specifier.local?.name
        if (name && WORKSPACE_SPECIFIERS.has(name)) {
          importedWorkspaceSpecifiers.add(name)
        }
      }
    }

    // If the file already imports a workspace helper, nothing to check.
    if (importedWorkspaceSpecifiers.size > 0) return {}

    // Look for the sb() PostgREST wrapper definition.
    return {
      FunctionDeclaration(node) {
        if (node.id?.name !== 'sb') return
        if (!bodyContainsSupabaseUrl(node)) return
        context.report({ node, message: MESSAGE })
      },
      VariableDeclarator(node) {
        if (node.id?.name !== 'sb') return
        const init = node.init
        if (
          !init ||
          (init.type !== 'ArrowFunctionExpression' && init.type !== 'FunctionExpression')
        )
          return
        if (!bodyContainsSupabaseUrl(init)) return
        context.report({ node, message: MESSAGE })
      },
    }
  },
}
