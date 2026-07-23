#!/usr/bin/env node
// Capture a tight, high-DPI screenshot of an element on an authenticated
// Bernard page and write it straight to disk.
//
// Why this exists: the Chrome-MCP capture pipeline (html2canvas -> blob URL ->
// ~/Downloads) cannot write files in the agent environment — the MCP tab is
// never *visible*, so every visibility-gated browser API (downloads, clipboard)
// is blocked. This drives a local Playwright Chromium instead, which we own
// end-to-end, and uses the same Clerk sign-in-ticket trick as tests/e2e/auth.setup.ts.
//
// Usage:
//   node scripts/capture-screenshot.mjs \
//     --url https://movebetter.withbernard.ai/week \
//     --selector '[data-testid="schedule-strip"]' \
//     --out .staff-update-screenshots/2026-07-22_PR1234_thing.png
//
// Options:
//   --url       (required) page to capture
//   --out       (required) output .png path
//   --selector  CSS selector of the element to crop to. Omit for a viewport shot.
//   --hide      comma-separated selectors to display:none before capturing
//   --wait-for  CSS selector to wait for before capturing
//   --delay     extra ms to wait before capturing (default 1200)
//   --scale     deviceScaleFactor (default 2)
//   --width     viewport width (default 1440)
//   --height    viewport height (default 900)
//   --full-page capture the whole page instead of an element
//
// Env: CLERK_SECRET_KEY, E2E_TEST_USER_EMAIL

import { chromium } from '@playwright/test'
import { createClerkClient } from '@clerk/backend'
import path from 'node:path'
import fs from 'node:fs'

function arg(name, fallback = undefined) {
  const i = process.argv.indexOf(`--${name}`)
  if (i === -1) return fallback
  const v = process.argv[i + 1]
  return v && !v.startsWith('--') ? v : true
}

const url = arg('url')
const out = arg('out')
const selector = arg('selector')
const hide = arg('hide')
const waitFor = arg('wait-for')
const delay = Number(arg('delay', 1200))
const scale = Number(arg('scale', 2))
const width = Number(arg('width', 1440))
const height = Number(arg('height', 900))
const fullPage = !!arg('full-page', false)

if (!url || !out) {
  console.error('ERROR: --url and --out are required.')
  process.exit(1)
}

const SECRET = process.env.CLERK_SECRET_KEY
// The fixture account to sign in as. Defaults to the dedicated e2e user.
// NOTE: the 1Password `E2E_TEST_USER_EMAIL` value is currently corrupt (a
// 15-char random string, not an address), so it is NOT used as a fallback.
const EMAIL = arg('email') || 'e2e@movebetter.co'
if (!SECRET) {
  console.error('ERROR: CLERK_SECRET_KEY must be set (prod sk_live_...).')
  process.exit(1)
}

const origin = new URL(url).origin
const outPath = path.resolve(out)
fs.mkdirSync(path.dirname(outPath), { recursive: true })

const clerk = createClerkClient({ secretKey: SECRET })

// Resolve fixture user (backend SDK returns either shape depending on version).
const userList = await clerk.users.getUserList({ emailAddress: [EMAIL] })
const users = Array.isArray(userList) ? userList : (userList?.data ?? [])
const user = users[0]
if (!user?.id) throw new Error(`No Clerk user for ${EMAIL}`)

const ticketResp = await clerk.signInTokens.createSignInToken({
  userId: user.id,
  expiresInSeconds: 300,
})
const ticket = ticketResp?.token ?? ticketResp?.data?.token
if (!ticket) throw new Error('Clerk returned no sign-in token')

const browser = await chromium.launch()
const context = await browser.newContext({
  viewport: { width, height },
  deviceScaleFactor: scale,
})
const page = await context.newPage()

try {
  // Load the SPA so window.Clerk initializes, then exchange the ticket.
  await page.goto(origin + '/', { waitUntil: 'domcontentloaded' })
  await page.waitForFunction(() => !!window.Clerk?.loaded, null, { timeout: 30_000 })
  await page.evaluate(async (t) => {
    const c = window.Clerk
    const signIn = await c.client.signIn.create({ strategy: 'ticket', ticket: t })
    if (signIn.status !== 'complete' || !signIn.createdSessionId) {
      throw new Error(`Ticket sign-in did not complete: status=${signIn.status}`)
    }
    await c.setActive({ session: signIn.createdSessionId })
  }, ticket)

  // Dismiss the first-run announcement if it intercepts.
  try {
    const skip = page.getByRole('button', { name: /skip intro/i })
      .or(page.getByRole('link', { name: /skip intro/i })).first()
    await skip.waitFor({ state: 'visible', timeout: 4_000 })
    await skip.click()
  } catch { /* already seen */ }

  // Suppress first-visit help overlays. These auto-open for a fresh fixture
  // user and paint on top of whatever you are trying to crop. Two separate
  // mechanisms: PageHelp (src/components/PageHelp.jsx) and the Library's
  // MediaHubHelp (src/components/MediaHubHelp.jsx).
  await page.evaluate(() => {
    const ts = new Date().toISOString()
    try {
      localStorage.setItem('pagehelp:session:welcomed', ts)
      localStorage.setItem('mediahub:welcomed:v1', ts)
      ;['home', 'overview', 'stories', 'usage', 'your-week'].forEach((k) => {
        localStorage.setItem(`pagehelp:${k}:welcomed:v1`, ts)
      })
    } catch {}
  })

  await page.goto(url, { waitUntil: 'networkidle' })

  // Belt-and-braces: close anything still overlaying the page.
  await page.keyboard.press('Escape').catch(() => {})

  // Optionally click something first (a tab, a filter chip) so the capture
  // targets the right view. Comma-separated selectors are clicked in order.
  const click = arg('click')
  if (click) {
    for (const sel of String(click).split(',').map((s) => s.trim()).filter(Boolean)) {
      await page.locator(sel).first().click()
      await page.waitForTimeout(1200)
    }
  }

  if (waitFor) await page.locator(waitFor).first().waitFor({ state: 'visible', timeout: 30_000 })
  if (hide) {
    await page.evaluate((sels) => {
      sels.split(',').map((s) => s.trim()).filter(Boolean).forEach((s) => {
        document.querySelectorAll(s).forEach((el) => { el.style.display = 'none' })
      })
    }, hide)
  }

  // Let rAF-driven animations (NumberTicker etc.) finish — they run normally
  // here because this page is genuinely visible to its own browser.
  await page.waitForTimeout(delay)

  if (fullPage || !selector) {
    await page.screenshot({ path: outPath, fullPage })
  } else {
    // `:has-text()` matches ancestors too, so --last picks the innermost
    // (tightest) match — usually what you want for a component crop.
    const all = page.locator(selector)
    const el = arg('last', false) ? all.last() : all.first()
    await el.waitFor({ state: 'visible', timeout: 30_000 })
    await el.screenshot({ path: outPath })
  }

  const { size } = fs.statSync(outPath)
  console.log(`OK ${outPath} (${size} bytes)`)
} finally {
  await browser.close()
}
