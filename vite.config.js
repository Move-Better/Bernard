import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import path from 'path'
import { fileURLToPath } from 'url'
import { execSync } from 'node:child_process'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

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
