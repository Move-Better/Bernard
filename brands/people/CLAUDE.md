# Move Better People — Project Notes

## Session Focus
At the start of EVERY new conversation, before doing anything else, ask:
"What are we working on today?" then confirm it fits one of these session types:

- **Planning / Architecture** — decisions, structure, roadmap
- **Feature: [name]** — building one specific feature end to end
- **Prompts** — writing or tuning AI prompts
- **Debug: [issue]** — one specific problem

If the work drifts into a second unrelated area mid-session, name it and suggest: "That's a good next session — want to note it and come back to it?"

## Brand
This is the **human chiropractic / physical therapy** brand (Move Better People).
The underlying app is called **NarrateRx** — a multi-brand SaaS product. Move Better People, Move Better Equine, and Move Better Animals Chiropractic are all separate deployments of NarrateRx with their own brand configs, databases, and API keys. Do not mix brand-specific content, credentials, or data between deployments.

### Brand config
Brand-specific values (name, domain, location, social handles, prompt context, internal-link library, signature system, etc.) live in [src/lib/brand.js](src/lib/brand.js). Each deployment selects its brand via env vars:

- `VITE_BRAND` — read by browser code (Vite replaces at build time). Set on the Vercel project, e.g. `VITE_BRAND=people`. The people deployment currently relies on the codebase default and does not set this env var.
- `BRAND` — read by Vercel serverless functions in `api/`. Set the same value alongside `VITE_BRAND`.
- `BRAND_URL` — used by `api/publish/gbp.js` for the GBP "Book" call-to-action URL. Falls back to `https://www.movebetter.co` if unset.

When adding a feature, never hardcode "Move Better," `movebetter.co`, "Portland," "patients/clinicians" terminology, or human-specific assumptions in `src/`. Read those values from `brand` instead. To add a new brand deployment, add a sibling entry to `BRANDS` in `brand.js` and set `VITE_BRAND` / `BRAND` on the new Vercel project.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

## Email Template
The email newsletter preview renders the actual TrustDrivenCare (TDC) HTML template via `<iframe srcDoc>`. The template lives at `src/email-template.html` and is imported with Vite's `?raw` loader in `src/components/PostPreview.jsx`.

**To update the template** (e.g. after redesigning in TDC): export the master HTML from TrustDrivenCare, replace `src/email-template.html` with the new HTML, and commit. No React changes needed — all `{{merge_tags}}` are substituted at render time by `fillTemplate()` in PostPreview.jsx.

Merge tags currently in use: `{{preview_text}}`, `{{headline}}`, `{{pull_quote}}`, `{{body_paragraph_1}}`, `{{body_paragraph_2}}`, `{{body_paragraph_3}}`, `{{cta_text}}`, `{{cta_url}}`, `{{ps_text}}`, `{{hero_image_url}}`, `{{year}}`, `{{unsubscribe_url}}`, `{{webview_url}}`.
