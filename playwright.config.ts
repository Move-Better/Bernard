import { defineConfig, devices } from '@playwright/test'

// Preview URL is injected by GitHub Actions after waiting for the Vercel
// deployment for the current SHA. Local runs can set E2E_BASE_URL to any
// reachable narraterx host, but must include a workspace one way or another
// (subdomain in prod-shape URLs, or ?workspace= for preview URLs).
const baseURL = process.env.E2E_BASE_URL || 'http://localhost:5173'

// Vercel Deployment Protection 401s anonymous requests to preview URLs.
// "Protection Bypass for Automation" (a per-project secret you mint in the
// Vercel dashboard) lets us send a header and skip the SSO gate. Local runs
// against localhost or unprotected hosts simply omit the env var.
const bypassSecret = process.env.VERCEL_AUTOMATION_BYPASS_SECRET
const extraHTTPHeaders = bypassSecret
  ? { 'x-vercel-protection-bypass': bypassSecret, 'x-vercel-set-bypass-cookie': 'true' }
  : undefined

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
    extraHTTPHeaders,
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
