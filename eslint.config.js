import js from '@eslint/js'
import globals from 'globals'
import reactPlugin from 'eslint-plugin-react'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import apiHandlerShape from './eslint/rules/api-handler-shape.js'
import noRawUseMutation from './eslint/rules/no-raw-use-mutation.js'
import noArbitraryTextSize from './eslint/rules/no-arbitrary-text-size.js'
import noRawApiFetch from './eslint/rules/no-raw-api-fetch.js'
import noHardcodedBrandColor from './eslint/rules/no-hardcoded-brand-color.js'
import requireWorkspaceScope from './eslint/rules/require-workspace-scope.js'
import noDetailInErrorResponse from './eslint/rules/no-detail-in-error-response.js'
import noTemperatureOnOpus from './eslint/rules/no-temperature-on-opus.js'

export default [
  { ignores: ['dist/**', 'node_modules/**', 'playwright-report/**', 'api/_routes/_manifest.generated.js'] },
  {
    files: ['src/**/*.{js,jsx}', 'api/**/*.js'],
    languageOptions: {
      ecmaVersion: 2022,
      sourceType: 'module',
      globals: { ...globals.browser, ...globals.node },
      parserOptions: { ecmaFeatures: { jsx: true } },
    },
    plugins: {
      react: reactPlugin,
      'react-hooks': reactHooks,
      'react-refresh': reactRefresh,
    },
    settings: { react: { version: '18' } },
    rules: {
      ...js.configs.recommended.rules,
      ...reactPlugin.configs.recommended.rules,
      ...reactHooks.configs.recommended.rules,
      'react/react-in-jsx-scope': 'off',
      'react/prop-types': 'off',
      'react/no-unescaped-entities': 'warn',
      // React Compiler rules (react-hooks v7+) — app doesn't use React Compiler
      'react-hooks/set-state-in-effect': 'off',
      'react-hooks/purity': 'off',
      // Allow production logging (console.error/.warn/.info) — only flag debug console.log.
      'no-console': ['warn', { allow: ['warn', 'error', 'info'] }],
      'no-unused-vars': ['warn', { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' }],
      'no-undef': 'warn',
    },
  },
  // Local rule: block Vercel runtime ↔ handler shape mismatches in api/* and middleware.js.
  // Also requires explicit runtime declaration — missing config → error.
  // Source: eslint/rules/api-handler-shape.js. Scoped to handler files only
  // (api/_lib/** is helpers, no default export → rule no-ops anyway, but
  // scoping out keeps the visitor cheap).
  {
    files: ['api/**/*.js', 'middleware.js'],
    ignores: ['api/_lib/**'],
    plugins: {
      bernard: {
        rules: {
          'api-handler-shape': apiHandlerShape,
          'require-workspace-scope': requireWorkspaceScope,
          'no-detail-in-error-response': noDetailInErrorResponse,
          'no-temperature-on-opus': noTemperatureOnOpus,
        },
      },
    },
    rules: {
      'bernard/api-handler-shape': 'error',
      // temperature/top_p/top_k 400 on Opus 4.7+ — flag them next to an Opus model.
      'bernard/no-temperature-on-opus': 'error',
      // Any handler that defines a local sb() PostgREST wrapper must import
      // workspaceContext, workspaceScope, or workspaceById — the tenant filter
      // must be in scope. Suppression requires an inline reason comment.
      'bernard/require-workspace-scope': 'error',
      // Ban `detail:` fields in res.json() — log server-side, return only the opaque key.
      // 26 audit rounds traced back to this copy-paste pattern from one reference handler.
      'bernard/no-detail-in-error-response': 'error',
    },
  },
  // Local rules for client code (src/**):
  //   no-raw-use-mutation   — ban bare `useMutation` from @tanstack/react-query
  //     outside the useAppMutation wrapper, which injects a default onError
  //     toast so failed mutations are never silent (PRs #431, #436).
  //   no-arbitrary-text-size — ban text-[Npx] arbitrary sizes.
  //   no-raw-api-fetch      — ban tokenless raw `fetch('/api/...')`; use
  //     apiFetch so the Clerk bearer token is attached (the API ignores the
  //     session cookie, so a tokenless call gets the slim/unauth shape — the
  //     PR #1064 "settings won't save" bug). Source files in eslint/rules/.
  //   no-hardcoded-brand-color — ban retired brand color literals (Move-Better
  //     orange #e36525 / hue-20 hsl / rgb(227,101,37), grey #6e7072, evergreen
  //     #1c4d37, coral #ff8552) so the brand color stays in the design tokens
  //     (src/index.css) and the next rebrand is a token change, not a hunt (#1294).
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      bernard: {
        rules: {
          'no-raw-use-mutation': noRawUseMutation,
          'no-arbitrary-text-size': noArbitraryTextSize,
          'no-raw-api-fetch': noRawApiFetch,
          'no-hardcoded-brand-color': noHardcodedBrandColor,
          'no-temperature-on-opus': noTemperatureOnOpus,
        },
      },
    },
    rules: {
      'bernard/no-raw-use-mutation': 'error',
      // temperature/top_p/top_k 400 on Opus 4.7+ (InterviewSession/CaptureReview call Opus).
      'bernard/no-temperature-on-opus': 'error',
      // Ban text-[Npx] arbitrary sizes — use text-3xs/text-2xs/Tailwind scale.
      'bernard/no-arbitrary-text-size': 'error',
      'bernard/no-raw-api-fetch': 'error',
      'bernard/no-hardcoded-brand-color': 'error',
    },
  },
  // no-temperature-on-opus is also registered in the api/** and src/** blocks
  // above. This extra block covers api/_lib/** (Opus callers like
  // bookSynthesis.js), which the api/** block deliberately ignores. Scoped to
  // api/_lib only so it never overlaps another block that defines `bernard`
  // (flat config forbids redefining a plugin for the same file).
  {
    files: ['api/_lib/**/*.js'],
    plugins: {
      bernard: {
        rules: { 'no-temperature-on-opus': noTemperatureOnOpus },
      },
    },
    rules: {
      'bernard/no-temperature-on-opus': 'error',
    },
  },
]
