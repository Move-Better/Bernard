import { defineConfig, devices } from '@playwright/test'

// Preview URL is injected by GitHub Actions after waiting for the Vercel
// deployment for the current SHA. Local runs can set E2E_BASE_URL to any
// reachable narraterx host, but must include a workspace one way or another
// (subdomain in prod-shape URLs, or ?workspace= for preview URLs).
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'

// Vercel Deployment Protection 401s anonymous requests to preview URLs.
// The bypass token can be sent either as a header or as a query parameter;
// we use the query-parameter form because the header form triggers CORS
// preflights on every cross-origin subresource (Clerk frontend API, Google
// Fonts, etc.) — and those preflights then fail because the third-party
// hosts don't whitelist the custom Vercel header. The query-param form,
// combined with `x-vercel-set-bypass-cookie=samesitenone`, drops a
// `_vercel_jwt` cookie on the first request, and all subsequent requests
// authenticate via cookie with no custom headers anywhere.
//
// `bypassQuery` is wired into auth.setup.ts where it's appended to the
// first page.goto. The cookie persists in storageState for the spec.
export const bypassQuery = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
  ? `x-vercel-protection-bypass=${encodeURIComponent(process.env.VERCEL_AUTOMATION_BYPASS_SECRET)}&x-vercel-set-bypass-cookie=samesitenone`
  : ''

export default defineConfig({
  testDir: './tests/e2e',
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 1 : 0,
  workers: 1,
  reporter: process.env.CI ? [['github'], ['html', { open: 'never' }]] : [['list'], ['html', { open: 'never' }]],
  timeout: 60_000,
  expect: { timeout: 15_000 },
  use: {
    baseURL,
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
    video: 'retain-on-failure',
  },
  projects: [
    {
      name: 'setup',
      testMatch: /auth\.setup\.ts/,
      use: { ...devices['Desktop Chrome'] },
    },
    {
      name: 'chromium',
      use: {
        ...devices['Desktop Chrome'],
        storageState: 'tests/e2e/.auth/user.json',
      },
      dependencies: ['setup'],
    },
  ],
})
