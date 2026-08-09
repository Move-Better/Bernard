import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

// Vercel's "Automatically expose System Environment Variables" mirrors every
// VERCEL_* build var under the framework's public-var prefix — for Vite,
// VITE_VERCEL_*. That includes prose/identity fields never meant for a
// client bundle: the full git commit message and the committer's real name
// and GitHub login. sentry.js needs ONE of these (the commit SHA, for
// release tagging), so this can't be "just turn off the Vercel toggle."
//
// The actual leak path isn't our own code: @clerk/shared's getEnvVariable()
// helper (bundled transitively through @clerk/react into vendor-clerk.js)
// does `import.meta.env[name]` — a runtime dynamic key the bundler cannot
// statically resolve, so Vite falls back to inlining the ENTIRE processed
// import.meta.env object wherever that helper's chunk lands. Every
// VITE_-prefixed var present at build time rides along, whether or not our
// code, or Clerk's, ever actually asks for that specific key. Confirmed
// against the live prod bundle 2026-08-08: the deployed
// VITE_VERCEL_GIT_COMMIT_MESSAGE was this repo's own recent commit prose,
// verbatim, readable by anyone.
//
// Deleting the risky keys from process.env HERE — before Vite's env loader
// ever reads it — is what actually closes this: an absent env var cannot be
// swept into the fallback object no matter what dynamically indexes it.
// Narrowing envPrefix instead doesn't work, because our own intentional
// vars (VITE_CLERK_PUBLISHABLE_KEY etc.) share the same VITE_ prefix Vercel
// auto-mirrors onto — there is no prefix that separates "ours" from
// "Vercel's auto-mirrored git metadata" within one shared family.
//
// Exported (not just run inline) so this is a pure, directly-testable
// function rather than an unverifiable module-load side effect — a
// mutation flipping the key list wrong would otherwise ship silently.
export const RISKY_VITE_VERCEL_ENV_KEYS = Object.freeze([
  'VITE_VERCEL_GIT_COMMIT_MESSAGE',
  'VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME',
  'VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN',
])

export function stripRiskyVercelGitEnvVars(env) {
  for (const k of RISKY_VITE_VERCEL_ENV_KEYS) delete env[k]
  return env
}

stripRiskyVercelGitEnvVars(process.env)

function resolveBuildSha() {
  if (process.env.VERCEL_GIT_COMMIT_SHA) return process.env.VERCEL_GIT_COMMIT_SHA
  try {
    return execSync('git rev-parse HEAD', { stdio: ['ignore', 'pipe', 'ignore'] }).toString().trim()
  } catch {
    return 'dev'
  }
}

export default defineConfig({
  plugins: [react()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, './src'),
    },
  },
  define: {
    __BUILD_SHA__: JSON.stringify(resolveBuildSha()),
  },
  build: {
    rollupOptions: {
      output: {
        // Split the largest vendor dependencies out of the main chunk.
        // Measured via sourcemap analysis (2026-07-02): Clerk (~340 KB src),
        // posthog-js (~200 KB), the react-router stack (~310 KB), react-dom
        // (~130 KB), and the Radix/floating-ui/lucide UI layer together
        // dominated the ~1 MB index chunk. Splitting them improves cache
        // granularity (vendor chunks change far less often than app code)
        // and keeps the main chunk under Vite's 500 KB warning threshold.
        manualChunks(id) {
          if (!id.includes('node_modules')) return undefined
          if (id.includes('@clerk')) return 'vendor-clerk'
          if (id.includes('posthog-js')) return 'vendor-posthog'
          if (id.includes('react-router') || id.includes('@remix-run')) return 'vendor-router'
          // Anchor to the package dir — a bare includes('react-dom') also
          // matches @floating-ui/react-dom and creates a circular chunk
          // (vendor-ui -> vendor-react -> vendor-ui).
          if (id.includes('/node_modules/react-dom/') || id.includes('/node_modules/react/') || id.includes('/node_modules/scheduler/')) return 'vendor-react'
          if (
            id.includes('@radix-ui') ||
            id.includes('@floating-ui') ||
            id.includes('lucide-react') ||
            id.includes('/node_modules/sonner/') ||
            id.includes('/node_modules/cmdk/') ||
            id.includes('tailwind-merge') ||
            id.includes('react-remove-scroll') ||
            id.includes('aria-hidden')
          ) return 'vendor-ui'
          return undefined
        },
      },
    },
  },
  // ES-format workers so we can use dynamic `import()` inside the worker
  // body. Default is IIFE which rejects code splits. Needed by
  // src/lib/heicWorker.js — it polyfills `self.window = self` before
  // heic2any module-init runs (heic2any writes to window.libheif at top
  // level), and a static import would be hoisted ahead of the polyfill.
  worker: {
    format: 'es',
  },
  test: {
    exclude: ['tests/e2e/**', '.claude/**', 'node_modules/**'],
  },
})
