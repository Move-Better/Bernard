---
description: Weekly "Stack & AI" review — scan my stack, research the last ~7-10 days, cross-reference against my code, write ./weekly-update.md
---

Run my weekly "Stack & AI" review. Do everything below in order and write the result to `./weekly-update.md`. Be rigorous about sources — never invent a version number, date, or feature; if you can't confirm it, leave it out and note it in the "Couldn't verify" line.

## STEP 1 — DISCOVER MY STACK
Scan this directory and subdirectories for projects. For each, read `package.json` / `requirements.txt` / `go.mod` / etc. and any config (`vercel.json`, `supabase/`, `railway.json|toml`, `.env.example`, `Dockerfile`). Build a list of: frameworks + versions, hosting platforms in use, and any AI SDKs or hardcoded model strings (grep `src api scripts` for `claude-*`, `gpt-*`, `gemini-*`, `anthropic/`, provider wiring, `AI_GATEWAY`). **Only research tools that actually appear in the code** — don't scan changelogs for platforms that aren't present.

## STEP 2 — RESEARCH RECENT CHANGES (web search; last ~7-10 days)
A) For each detected platform, find material changelog items (features, GA/beta, pricing, breaking changes). If Railway is detected, fetch `https://railway.com/changelog` directly. Skip minor patches/cosmetic tweaks.
B) AI developments, weighted: **Anthropic/Claude first** (models, Claude Code, API/platform, agent tooling, and any MODEL RETIREMENTS — flag those as breaking), then OpenAI/Google/major labs, then dev tooling (Cursor, agents, MCP), then 1-2 genuinely useful real-world workflows (named teams, measurable outcomes — no hype).
- Always fetch the official Anthropic deprecation page: `https://platform.claude.com/docs/en/about-claude/model-deprecations`.

## STEP 3 — CROSS-REFERENCE AGAINST MY CODE
For every relevant finding, grep the actual code and cite `file:line` evidence. At minimum check:
- **BREAKING:** retired/deprecated model strings. Fetch current Anthropic/OpenAI deprecations AND grep for bare retired forms (`claude-sonnet-4"`, `claude-opus-4"`, `claude-3*`, `gpt-3.5`, `text-davinci`). Report exact `file:line` + recommended replacement. Distinguish bare retired IDs from still-Active dotted versions (`claude-opus-4-7` ≠ retired `claude-opus-4`).
- **Anthropic API param deprecations** (e.g. `temperature`/`top_p`/`top_k` 400 on Opus 4.7+): grep whether any affected-model call site passes them.
- **Supabase RLS** (`auth.uid()`, `create policy`) → flag for hardening if new tooling exists.
- **Supabase Auth** in use → note relevant auth upgrades (passkeys). If auth is Clerk/other, say so and skip.
- **Long-lived secrets / provider tokens** in env (DB URLs, blob tokens, service-role keys, AWS) → flag if a runtime-credential/OIDC option now exists (Vercel OIDC/Connect).
- **Realtime/websocket** (Ably, Pusher, Supabase Realtime, socket servers) → flag if the host now supports it natively.
- **DB connection patterns** on serverless → flag pooling (PgBouncer/Multigres); note if the request path uses REST (no pooling concern) vs direct `pg`.
- **Verbose logging on a metered platform** → flag cost exposure (cross-ref cron frequency).
- **High-volume simple LLM calls on a premium model** → flag cheaper-tier A/B candidates.
Add any other matches found — these are examples, not the full set.

## STEP 4 — WRITE ./weekly-update.md with two sections
1. **"This Week's Changes"** — grouped by platform and by AI; each item: name + source link, plain-English description, maturity tag.
2. **"Action Items for My Projects"** — grouped **BREAKING (do now) / WORTH DOING / INVESTIGATE / IGNORE-FYI**. Each item: project name, `file:line` evidence, specific recommendation, effort (low/med/high). Omit checks that don't apply rather than padding.
End the file with the single highest-priority action across all projects, and a one-line note of anything you couldn't verify.

## STEP 5 — VERIFY before finishing
Re-read `weekly-update.md`. Confirm every cited `file:line` actually exists in the code and every external claim has a real source URL. Fix or drop anything that fails.
