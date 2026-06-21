# Hidden Settings Audit
_Generated 2026-06-21 — session `expose-hidden-settings`_

Scanned for DB columns / code-gated features with no tenant-accessible UI.
`blog_review_enabled` is excluded — added in the same PR.

---

## P1 — Should expose in UI

### 1. `cadence_policy` (JSONB) — `workspaces`
**Subfields read by live code:** `channels` (array of `{platform, posts_per_week}`), `quiet_days` (array of weekday ints), `timezone`, `daily_limit`.

**Current gap:** `/week` reads `cadence_policy` to slot content into days and show the weekly plan, but there is **no UI to edit it**. Tenants are locked to whatever was set at onboarding (or by ops SQL). A clinician who wants to post 3×/week on Instagram vs 1×/week on Facebook has no self-service path.

**Recommended action:** Add a "Posting cadence" section to `src/pages/settings/ChannelsSettings.jsx` — per-channel posts-per-week spinner + quiet-days checkboxes + timezone picker. PATCH via `api/_routes/db/workspace.js`.

---

### 2. `engagement_digest_enabled` + `engagement_digest_recipients` — `workspaces`
**Current gap:** A weekly producer digest email is gated on `engagement_digest_enabled` (boolean, DEFAULT false) and sends to `engagement_digest_recipients` (text[]). There is no UI toggle or recipient list editor.

**Recommended action:** Add a toggle + recipient email list input to `src/pages/settings/AutoPublishSettings.jsx` or a new Notifications settings page.

---

### 3. `publish_intent` (JSONB) — `workspaces`
**Subfields:** `channels` (which platforms are actively targeted), set during `/onboard`.

**Current gap:** Onboarding captures which channels the workspace plans to publish to, but there is no post-onboarding UI to add or remove a channel from the intent list (separate from whether credentials are connected). Affects which outputs appear in the `/week` plan.

**Recommended action:** Expose as editable checkboxes alongside the connected-credential status in `ChannelsSettings.jsx`. Low complexity — it is already a JSONB write.

---

## P2 — Ops-only is fine (document, no UI needed)

| Field | Table | Why ops-only is correct |
|---|---|---|
| `realtime_voice_enabled` | workspaces | Entitlement flag — Bernard controls based on plan tier. Billing settings already shows plan; this is a back-office toggle, not a tenant self-serve switch. |
| `video_pipeline_enabled` | workspaces | Migration gate — auto-set true on new workspaces. Exists for rolling out video to legacy workspaces; no ongoing tenant decision. |
| `rag_fusion_enabled` / `rag_hot_tier_enabled` | workspaces | Staged RAG rollout infrastructure. A/B controlled by ops. Would be confusing as a user-facing toggle. |
| `role_templates` | workspaces | Advanced per-tier capability defaults (what roles can do what). Bernard configures for each client at setup. Exposing as self-serve creates support risk. |
| `prompt_mode` | workspaces | `clinical` vs `general` prompt templates. Currently set at onboarding. Could become an onboarding preference field in a future pass but not urgent. |

---

## P3 — Dead code
None found — all flags are read by live code paths.

---

## Summary / Priority

**Biggest gap: `cadence_policy`** — the F2 `/week` output-governance feature assumes tenants control their posting cadence, but there is zero UI to set it. Every workspace runs on whatever the initial default is. This is the highest-value add.

Order of effort:
1. **Cadence policy editor** (P1 #1) — moderate effort, core to the `/week` value prop
2. **Digest email toggle + recipients** (P1 #2) — small card in Notifications / AutoPublish settings
3. **Publish intent editor** (P1 #3) — small addition to ChannelsSettings, low complexity
