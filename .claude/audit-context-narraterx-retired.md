# Audit Context — NarrateRx is RETIRED; the brand is Bernard

**Date set:** 2026-06-09
**Applies to:** the /auditfull run dispatched this session (and any audit until removed).

## The rule
The product is **Bernard** (`withbernard.ai`). The old name **NarrateRx** (and domains `narraterx.ai`, `*.narraterx.ai`, the old `narrate*` artwork/colors) is **fully retired**. Any surviving NarrateRx reference of ANY kind is a **defect to flag**, not background noise.

Treat severity as:
- **P0** — user-visible stale brand on a live/shipping surface: a rendered page, email, favicon/PWA icon, OG/canonical URL, page `<title>`, Clerk org logo, or anything served to a tenant.
- **P1** — stale brand in code that *generates* user-visible output but isn't currently rendering wrong (a generator template, a fallback string, a config default), plus any `narraterx.ai` routing/redirect gap.
- **P2** — stale brand in comments, internal docs, test fixtures, scratch files (`.claude/*`), or commit-only artifacts with no user surface.

## Where NarrateRx hides — check ALL of these, not just a source grep
The 2026-06-08 rebrand sweep already swapped obvious strings. The classes that SLIPPED THROUGH and shipped to prod (per CLAUDE.md "Renaming ≠ rebranding"):

1. **Build-time generators regenerate stale output every deploy.** `scripts/build-blog.mjs` had inline HTML (header logo, `<title>`, canonical/OG URLs, footer email) that wasn't rebranded — Vercel regenerated `public/blog*.html` with full NarrateRx branding on every build, so the committed file looked fine but live served stale. **Grep `scripts/` and any prebuild/build step, not just `src/`/`api/`.**
2. **Renamed asset files still contain the old artwork.** `git mv narraterx-icon.svg bernard-icon.svg` changes the filename, not the paths/pixels inside. Check SVG **bodies** for old brand hexes and wordmark text; rasterize a couple of PNGs and actually look.
   - Old brand colors to grep for: `#1c4d37` (evergreen), `#ff8552` (coral), and literal `narrate`/`NarrateRx` text inside SVGs.
   - `grep -ril 'narrate\|#ff8552\|#1c4d37' public/ src/ api/ scripts/`
3. **Domain/routing remnants.** `narraterx.ai` / `*.narraterx.ai` in middleware, redirects, env-derived fallbacks, migrations, email senders, canonical/OG URLs, sitemap, robots. (Memory note: narraterx.ai apex still 200s but `*.narraterx.ai` won't route — flag any code still referencing it.)
4. **User-facing copy & metadata:** page titles, meta descriptions, manifest.json (`name`/`short_name`), favicon refs, email templates/senders, legal pages (privacy/terms), onboarding copy, Clerk org/app name.

## Concrete grep starter set (audit agents should run these and triage hits)
```bash
# String refs (case-insensitive), excluding node_modules / .claude scratch / git history
grep -rniI 'narrate' . --include='*.{js,jsx,ts,tsx,mjs,json,html,svg,css,md,sql}' \
  --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=.claude --exclude-dir=dist
# Old brand color hexes anywhere
grep -rniI '#ff8552\|#1c4d37' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
# Old domain
grep -rniI 'narraterx\.ai' . --exclude-dir=node_modules --exclude-dir=.git --exclude-dir=dist
# Asset bodies specifically (SVGs are text)
grep -rliI 'narrate' public/ 2>/dev/null
```
For PNGs (binary — grep won't see artwork): list `public/brand/*.png`, rasterize/open a representative few and eyeball for the old mark/colors.

## Output expectation
A dedicated **"Rebrand completeness (NarrateRx→Bernard)"** section in the audit report, with each hit as `file:line — what's stale — fix`, severity-tagged per the rule above. Zero hits on user-facing surfaces is the bar for "rebrand complete."
