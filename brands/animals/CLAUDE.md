# Move Better Animals Chiropractic — Project Notes

## Session Focus
At the start of EVERY new conversation, before doing anything else, ask:
"What are we working on today?" then confirm it fits one of these session types:

- **Planning / Architecture** — decisions, structure, roadmap
- **Feature: [name]** — building one specific feature end to end
- **Prompts** — writing or tuning AI prompts
- **Debug: [issue]** — one specific problem

If the work drifts into a second unrelated area mid-session, name it and suggest: "That's a good next session — want to note it and come back to it?"

## Brand
This is the **small animal chiropractic** brand (Move Better Animals Chiropractic).
- Species: Dogs, cats, and most small pets
- Audience: Pet owners
- Brand is new — website, social accounts, and visual identity are being built alongside this deployment
- Positioned as complementary to veterinary care, never a replacement

The underlying app is called **NarrateRx** — a multi-brand SaaS product. Move Better Animals Chiropractic, Move Better People, and Move Better Equine are all separate deployments of NarrateRx with their own brand configs, databases, and API keys. Do not mix brand-specific content, credentials, or data between deployments.

### Brand config
Brand-specific values (name, domain, location, social handles, prompt context, internal-link library, signature system, etc.) live in [src/lib/brand.js](src/lib/brand.js). The `ANIMALS` entry is populated. The deployment selects it via env vars on its Vercel project:

- `VITE_BRAND=animals` — read by browser code (Vite replaces at build time).
- `BRAND=animals` — read by Vercel serverless functions in `api/`. Must match `VITE_BRAND`.
- `BRAND_URL` — used by `api/publish/gbp.js` for the GBP "Book" call-to-action URL.

When adding a feature, never hardcode "Move Better," `movebetter.co`, "Portland," "patients/clinicians," or human/equine-specific assumptions in `src/`. Read those values from `brand` instead. See [brands/people/CLAUDE.md](brands/people/CLAUDE.md) for the canonical brand-config style.

## Key Conditions & Language
Common conditions: intervertebral disc disease (IVDD), hip dysplasia, post-surgical recovery, mobility decline in senior pets, gait abnormalities, neck and back pain, limping without orthopedic cause.
Audience tone: warm, accessible, pet-owner-friendly. Education-forward without clinical jargon.

## GitHub
Use the GitHub CLI (`gh`) for GitHub-specific interactions — PRs, issues, releases, repo management. `gh` is configured as the git credential helper, so plain `git push` / `git fetch` are fine for ref operations (they authenticate through `gh` under the hood). Do not set up separate HTTPS basic auth or raw SSH credentials.

The repo has a single long-lived branch (`main`); brand deployments are differentiated by Vercel project + env vars, not by branch. There is no per-brand merge cascade.

## Email Template
Same TrustDrivenCare template as Move Better People — see [brands/people/CLAUDE.md](brands/people/CLAUDE.md) for merge tag details.
