import { describe, it, expect } from 'vitest'
import { RISKY_VITE_VERCEL_ENV_KEYS, stripRiskyVercelGitEnvVars } from '../../vite.config.js'

// Guards the client-bundle env leak found 2026-08-08: Vercel's "Automatically
// expose System Environment Variables" mirrors every VERCEL_* build var under
// VITE_ (Vite's public-var prefix), including the full git commit message and
// the committer's real name/GitHub login. @clerk/shared's getEnvVariable()
// helper — bundled transitively into vendor-clerk.js — does
// `import.meta.env[name]` with a runtime-determined key, which Vite cannot
// statically resolve, so it inlines the ENTIRE import.meta.env object
// wherever that helper's chunk lands. Confirmed live: prod was shipping this
// repo's own recent commit prose, verbatim, to every visitor.
//
// vite.config.js deletes the risky keys from process.env before Vite's env
// loader ever reads it, so they cannot be present in the fallback object
// regardless of what dynamically indexes it. This test pins the function
// directly rather than trusting a module-load side effect that a later edit
// could silently drop or re-scope.

describe('stripRiskyVercelGitEnvVars', () => {
  it('removes the commit message and author identity fields', () => {
    const env = {
      VITE_VERCEL_GIT_COMMIT_MESSAGE: 'fix(publish): closes the double-dispatch race',
      VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME: 'Dr Q',
      VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN: 'drquasney',
    }
    stripRiskyVercelGitEnvVars(env)
    expect(env.VITE_VERCEL_GIT_COMMIT_MESSAGE).toBeUndefined()
    expect(env.VITE_VERCEL_GIT_COMMIT_AUTHOR_NAME).toBeUndefined()
    expect(env.VITE_VERCEL_GIT_COMMIT_AUTHOR_LOGIN).toBeUndefined()
  })

  it('leaves every other var alone — in particular the commit SHA sentry.js needs', () => {
    const env = {
      VITE_VERCEL_GIT_COMMIT_MESSAGE: 'some prose',
      VITE_VERCEL_GIT_COMMIT_SHA: 'e90f810eb7e3a8b4c26121c1053ca569665f31ad',
      VITE_VERCEL_GIT_COMMIT_REF: 'main',
      VITE_VERCEL_ENV: 'production',
      VITE_CLERK_PUBLISHABLE_KEY: 'pk_live_example',
      VITE_SENTRY_DSN: 'https://example.ingest.sentry.io/1',
    }
    stripRiskyVercelGitEnvVars(env)
    // sentry.js reads exactly this one for release tagging — stripping it
    // would silently break release correlation, not just leave a gap.
    expect(env.VITE_VERCEL_GIT_COMMIT_SHA).toBe('e90f810eb7e3a8b4c26121c1053ca569665f31ad')
    expect(env.VITE_VERCEL_GIT_COMMIT_REF).toBe('main')
    expect(env.VITE_VERCEL_ENV).toBe('production')
    expect(env.VITE_CLERK_PUBLISHABLE_KEY).toBe('pk_live_example')
    expect(env.VITE_SENTRY_DSN).toBe('https://example.ingest.sentry.io/1')
  })

  it('is a no-op, not a throw, when the keys are already absent', () => {
    expect(() => stripRiskyVercelGitEnvVars({})).not.toThrow()
  })

  it('the key list actually contains something (non-vacuity)', () => {
    // A regex/list rot that empties this would make every assertion above
    // pass trivially by stripping nothing.
    expect(RISKY_VITE_VERCEL_ENV_KEYS.length).toBeGreaterThan(0)
    expect(RISKY_VITE_VERCEL_ENV_KEYS).toContain('VITE_VERCEL_GIT_COMMIT_MESSAGE')
  })
})
