# Weekly Stack & AI Review — 2026-06-24

**Scope:** One project detected — **Bernard** (`/Users/qbook/Claude Projects/Bernard`). Research window ~June 14–24, 2026.

**Detected stack (what's actually in the code):**
- **Frontend:** React 18.2, Vite 5, React Router 6, Tailwind 3, Radix UI, TanStack Query 5 (`package.json`)
- **Hosting:** Vercel — Node functions, `regions: pdx1`, 12 crons, `includeFiles` for ffmpeg (`vercel.json`)
- **AI:** Vercel **AI SDK v6** (`ai@^6.0.175`) via **Vercel AI Gateway** (`AI_GATEWAY_API_KEY`, `api/stream.js:43`); models = Claude 4.x family + `google/gemini-2.5-flash` + OpenAI Realtime (`gpt-realtime`)
- **Data/Auth/Infra:** Supabase (PostgREST REST + `pg` in scripts only), **Clerk** auth, Upstash Redis (rate limiting), Vercel Blob, Sentry, PostHog, bundle.social
- **Not present (so not researched):** Railway, Ably/Pusher/Supabase Realtime, AWS runtime SDK in request path, Supabase Auth, Supabase RLS (0 policies — isolation is API-layer, by design per `CLAUDE.md`)

---

## 1) This Week's Changes

### Anthropic / Claude (weighted first)

- **Model retirements — June 15, 2026 (BREAKING in general; does NOT hit this code).** `claude-sonnet-4-20250514` and `claude-opus-4-20250514` (the bare "Sonnet 4 / Opus 4" IDs) are now **Retired** — requests fail with no grace period. — *Maturity: retired.* [Anthropic model deprecations](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- **Claude Opus 4.1 deprecated (June 5), retires Aug 5, 2026.** `claude-opus-4-1-20250805` → replace with `claude-opus-4-8`. — *Maturity: deprecated.* [source](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- **API parameter deprecation: `temperature` / `top_p` / `top_k` return a 400 on Opus 4.7 and later** (incl. 4.8) when set to a non-default value. — *Maturity: active/breaking-for-param.* [source](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- **All current 4.x models Active:** `claude-opus-4-8`, `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4-5-20250929`, `claude-haiku-4-5-20251001` all listed Active with retirement dates in 2027 (or late 2026 for the dated 4.5s). — *Maturity: GA.* [source](https://platform.claude.com/docs/en/about-claude/model-deprecations)
- **Claude Code (June 2026):** `sandbox.credentials` setting to block sandboxed commands from reading secrets/credential files; org-configured model restrictions; hierarchical sub-agents (up to 3 levels); `fallbackModel` chains; doubled rate limits; structured-output fixes. — *Maturity: shipped.* [Claude Code changelog](https://code.claude.com/docs/en/changelog)

### AI — other labs

- **Google Gemini 2.5 Pro "Deep Think"** launched June 22, 2026 (reasoning mode). **Gemini 3.5 Flash** is GA (since May 19, ~$1.50/$9.00 per Mtok). — *Maturity: GA / new.* [Gemini changelog](https://ai.google.dev/gemini-api/docs/changelog), [llm-stats](https://llm-stats.com/llm-updates)
- **OpenAI GPT-5.5** family (incl. Pro / Instant) tracked in June 2026 updates. — *Maturity: tracked/GA.* [llm-stats](https://llm-stats.com/llm-updates)

### Vercel
*(Date labels read from the live changelog; the fetch mis-stamped the page year, so treat exact dates as approximate — entries themselves are current.)*
- **Custom OIDC Token Audiences** — define custom audiences for OIDC token federation (runtime credentials instead of long-lived secrets). — *Maturity: shipped.* [Vercel changelog](https://vercel.com/changelog)
- **Deploy Node servers with zero configuration.** — *Maturity: shipped.* [source](https://vercel.com/changelog)
- **Deploy from Claude Design to Vercel** + **redesigned Workflows trace viewer** + **GLM 5.2 Fast on AI Gateway**. — *Maturity: shipped.* [source](https://vercel.com/changelog)
- **AI Gateway: service tiers + provider routing** (`order`/`only`/`sort` in `providerOptions.gateway`); supports OpenAI Responses API. — *Maturity: GA.* [AI Gateway docs](https://vercel.com/docs/ai-gateway/models-and-providers/service-tiers)

### Supabase (Launch Week, June 2026)
- **Passkey auth** (WebAuthn) for Supabase Auth. — *Maturity: new.* [Supabase Developer Update, June 2026](https://supabase.com/changelog/46689-developer-update-june-2026)
- **pg-delta** schema-diffing engine (tables, columns, RLS, functions, triggers, indexes, extensions). — *Maturity: new.* [source](https://supabase.com/changelog/46689-developer-update-june-2026)
- **Multigres v0.1 alpha** (sharding, connection pooling, failover). **Metered logs pricing** (Pro/Team: 5 GB ingest + 1,000 GB query/mo, overage $0.50/GB & $0.002/GB). **Supabase AI Agent plugin** (MCP + skills). — *Maturity: alpha / GA.* [source](https://supabase.com/changelog/46689-developer-update-june-2026)

### Clerk
- **`<OAuthConsent />`** — host the OAuth consent screen on your own domain; org selector for `user:org:read`. (2026-06-22) — *Maturity: shipped.* [Clerk changelog](https://clerk.com/changelog)
- **Multi-value SAML custom attribute mapping** → arrays on `publicMetadata`. (2026-06-12) — *Maturity: shipped.* [source](https://clerk.com/changelog)

### Dev tooling / workflows
- **Cursor (June 2026):** Automations / always-on agents, `/automate` skill, Auto-review autonomy "dial", Background Agent, Cursor SDK for deployable agents. — *Maturity: shipped.* [Cursor releasebot](https://releasebot.io/updates/cursor)
- **Real-world workflow:** a documented 100-developer rollout reported a **28% productivity lift sustained over 6 months**, anchored by a 32-entry shared skill library. — [case study](https://www.digitalapplied.com/blog/case-study-ai-coding-rollout-100-dev-team-quarterly-data-2026)
- **Counterpoint (worth knowing):** industry data shows AI-generated PRs wait ~4.6× longer in review and carry 15–18% more security findings — review capacity, not generation, is the bottleneck. — [Opsera 2026 benchmark](https://opsera.ai/resources/report/ai-coding-impact-2026-benchmark-report/)

---

## 2) Action Items for My Projects

### 🔴 BREAKING (do now)
**None.** Every model string in the code is on the **Active** list. The June 15 retirements were the bare `claude-sonnet-4` / `claude-opus-4` IDs (the `…-20250514` builds) — a full-repo grep found **zero** of those. The code uses `claude-opus-4-7`, `claude-sonnet-4-6`, `claude-sonnet-4-5`, `claude-haiku-4-5(-20251001)`, all Active. No call needs to change to keep working.

### 🟡 WORTH DOING
- **Bernard — guard against the Opus 4.7+ `temperature` 400.** Today **no Opus 4.7 call site passes `temperature`/`top_p`** (verified across `api/stream.js`, `api/_lib/bookSynthesis.js:22`, `api/_routes/content-items/blog-regen-prepare.js:187`, `api/_routes/content-items/split-into-series.js:278`, `src/pages/CaptureReview.jsx:145`), so nothing breaks now. **Risk:** several Sonnet/Haiku call sites *do* set `temperature` (e.g. `api/_routes/editorial/propose-grade.js:57`, `api/_routes/photo-templates/generate.js:167`, `api/_lib/voiceAudit.js:179`) — if any are ever bumped to Opus 4.7/4.8, they'll 400. **Rec:** add a tiny lint/helper note so an Opus model + `temperature` can't ship together. *Effort: low.* [source](https://platform.claude.com/docs/en/about-claude/model-deprecations)

### 🔵 INVESTIGATE
- **Bernard — Vercel OIDC / Custom Token Audiences to retire long-lived secrets.** Long-lived credentials are stored as Vercel env and read directly: `MULTITENANT_DATABASE_URL` (`scripts/fix-video-orientations.mjs:216`, many scripts), `BLOB_READ_WRITE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKSPACE_CREDENTIALS_KEY`. Vercel's new Custom OIDC Token Audiences enable runtime credential federation for backends that support it. **Rec:** evaluate which of these can move to short-lived OIDC-issued credentials (DB/blob are the highest-value). *Effort: med.* [Vercel changelog](https://vercel.com/changelog)
- **Bernard — Supabase metered logs + 12 crons = cost exposure.** `vercel.json` runs frequent crons (`*/5`, `*/10`, `5-59/10`) and the codebase logs verbosely (`console.error` is the documented debugging pattern). Supabase now meters logs (overage $0.50/GB ingest). **Rec:** sample current log volume before it's billable; trim hot-path `console.error` in the `*/5`–`*/10` cron handlers. *Effort: low.* [Supabase June 2026](https://supabase.com/changelog/46689-developer-update-june-2026)
- **Bernard — Supabase pg-delta for schema drift.** `CLAUDE.md` documents there is **no migration tracker** (`scripts/apply-multitenant-migrations.mjs` just applies whatever you pass). pg-delta could detect prod-vs-migration drift — directly addresses the documented "merged a column reference before the migration applied → 500" failure mode. *Effort: med.* [source](https://supabase.com/changelog/46689-developer-update-june-2026)
- **Bernard — Gemini 3.5 Flash GA for vision tagging.** `api/_lib/tagAsset.js:27` uses `google/gemini-2.5-flash`. 3.5 Flash is now GA via AI Gateway. **Rec:** A/B 2.5 → 3.5 Flash on real asset-tagging inputs for quality/cost. *Effort: low.* [Gemini changelog](https://ai.google.dev/gemini-api/docs/changelog)
- **Bernard — optional `claude-opus-4-7` → `claude-opus-4-8`.** 4.7 is Active until ~Apr 2027 (no urgency), but 4.8 is the current top model and the named successor to the retiring 4.1. Sites: `api/_lib/bookSynthesis.js:22`, `api/_routes/content-items/blog-regen-prepare.js:187`, `api/_routes/content-items/split-into-series.js:278`/`:337`, `src/pages/CaptureReview.jsx:145`, and the allow-list `api/stream.js:50`. **Rec:** test quality on book/blog synthesis before switching. *Effort: low.* [source](https://platform.claude.com/docs/en/about-claude/model-deprecations)

### ⚪ IGNORE / FYI
- **Supabase & Clerk passkeys — not applicable.** Auth is **Clerk**, not Supabase Auth, so Supabase passkeys don't apply. Clerk passkeys exist but no action needed now.
- **Supabase Multigres / connection pooling — not applicable to the request path.** Serverless functions talk to Supabase over **PostgREST REST**, not direct Postgres; direct `pg` (`new Pool`/`new Client`) appears **only in `scripts/`** (migrations/backups), which aren't high-concurrency. No serverless pooling problem to solve.
- **Supabase Realtime / native websockets — not in use.** No `.channel()`/Ably/Pusher in `src` or `api`; nothing to migrate.
- **Claude Code features** (hierarchical sub-agents, `sandbox.credentials`, doubled rate limits) — workflow niceties for your own dev loop, not app changes.
- **Railway** — appears in `CLAUDE.md`/memory for a *different* project (Practice Brain) but not in Bernard's code, so its changelog was not researched per instructions.

---

### 🏁 Highest-priority action across all projects
**Move Bernard's long-lived backend secrets (`MULTITENANT_DATABASE_URL`, `BLOB_READ_WRITE_TOKEN`, `SUPABASE_SERVICE_ROLE_KEY`, `WORKSPACE_CREDENTIALS_KEY`) toward Vercel OIDC / runtime credentials.** It's the one item that reduces standing blast-radius rather than just chasing a version — and there is no urgent breaking change forcing other work this week.

### ⚠️ Couldn't verify
- **Exact Vercel changelog dates:** the fetched page mis-stamped its year, so the Vercel entries above are confirmed *current* but their day-level dates are approximate — confirm at [vercel.com/changelog](https://vercel.com/changelog) before acting.
- **Upstash & Sentry June 2026 specifics:** search surfaced the changelog index pages but no concrete dated entries, so nothing is reported for them rather than guessing.
