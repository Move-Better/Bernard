// Bernard brand constants — the single JS-side source of truth for the
// PRODUCT's own identity (logo files + brand color). Import these instead of
// hardcoding the values; the `bernard/no-hardcoded-brand-color` lint rule will
// flag raw brand hex/hsl literals.
//
// Two sibling sources of truth, by necessity:
//   • CSS chrome  → src/index.css design tokens (--primary, --action, …). The
//     app's buttons/nav/accents read from there; this file does NOT drive them.
//   • <img> logos → the .svg files referenced below. Because the marks render
//     in <img src> (Layout, PostPreview, favicon), CSS vars/currentColor can't
//     recolor them — the color is baked into the file, so the canonical art
//     lives in exactly one .svg per mark.
// BERNARD_PRIMARY mirrors --primary's value; keep them in sync if the brand
// color ever changes (a rebrand touches both this constant and src/index.css).
//
// TENANT brands are NOT here — each workspace's colors/logos come from the DB
// (workspaces row, brand_kit_roles, primary_logo_url). See CLAUDE.md
// "Multi-tenant SaaS". This file is only the fallback/product identity.

export const BERNARD_PRIMARY = '#0C7580' // Blue Spruce — HSL 186 83% 27%
export const BERNARD_EMERALD = BERNARD_PRIMARY // alias kept for any remaining refs
export const BERNARD_INK     = '#0F172A'

// HSL triplet mirroring src/index.css's `--primary` custom property, in the
// `h s% l%` form CSS's hsl() function expects. Clerk's `appearance.variables`
// needs a literal CSS color string (not a var() passthrough it can safely
// derive internal shades from), so this is the one place that string is
// built — Account.jsx and App.jsx both import it instead of re-hardcoding
// the triplet, so a rebrand only has to update it here (+ index.css).
export const BERNARD_PRIMARY_HSL = '186 83% 27%'

export const BERNARD_LOGO_URL = '/bernard-logo.svg' // horizontal wordmark (dark ink — for light grounds)
export const BERNARD_LOGO_LIGHT_URL = '/bernard-logo-light.svg' // light wordmark — for dark grounds (charcoal sidebar)
export const BERNARD_ICON_URL = '/bernard-icon.svg' // square app mark / favicon
