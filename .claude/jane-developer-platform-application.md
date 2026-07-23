# Jane Developer Platform (JDP) — Partner Application Package for Bernard

**Prepared:** 2026-07-16 · **For:** Q (Dr. Michael Quasney) · **Context:** Frontier Panel Run 5, register row **F21** ("From cited to booked — the agent-bookable practice")
**Status of this doc:** research complete, application answers pre-drafted. Nothing has been submitted, no account created, no terms accepted. Q reviews → submits.

---

## 0. Executive summary (read this even if you skip the rest)

1. **The program is real and the intake form is live and public** (no login needed):
   👉 **https://integrations.jane.app/application_forms/jane-integrations-partner-interest-form/partner_applications/new**
2. **But the form itself says the program is at capacity**: *"Our partner program is currently at capacity, so we aren't onboarding new integrations right now"* — applicants *"likely won't hear back"* until it reopens. **Submit anyway**: it's a queue, and F21's whole thesis is that gated = moat for whoever is inside when it reopens. Also email **partnerships@jane.app** in parallel.
3. **The single biggest positioning risk:** Jane says verbatim they are **"not looking to work with AI scheduling or AI scribe tools"** and **"posting directly into Jane's calendars is not supported."** Bernard must apply as what it actually is — a **marketing/content/attribution platform** (the same category as launch partner **TrustDrivenCare**, plus Mailchimp/Cyberimpact/Google Analytics) — NOT as an AI booking agent. Every drafted answer below is written to that framing.
4. **The API cannot create appointments today.** Appointments are **read-only** (writes exist only for charting: observations/care plans/medications). So F21's "real booking actions via JDP" is **phase 2 at best** — but the API's **webhooks are exactly Bernard's attribution seam**: `APPOINTMENT_BOOKED / APPOINTMENT_CANCELLED / APPOINTMENT_UNCANCELLED / APPOINTMENT_RESCHEDULED`, with an appointment resource carrying `first_visit`, `booked_at`, `no_show_at`, `arrived_at`, `state`, `treatment_id` — outcome-grading gold. **Read + webhooks is the whole phase-1 ask.**
5. **The compliance bar for PHI partners is published** ("The Jane 10") and includes **SOC 2 Type II ≤12 months old** — Bernard's biggest structural gap. The form's security dropdown includes softer options ("SOC 2 Planned for 2026", "Other"), so a startup can apply, but Q has a real decision to make (§4, decision D2).
6. **Stopgaps exist today with zero approval**: treatment-level deep links into movebetter.janeapp.com (live, HTTP 200), Reserve with Google (Jane-native, Settings → Integrations), GA4 outbound-click attribution (already shipped in Bernard). One-tap booking on the concierge/answers//link can ship **this week** without Jane's permission — approval upgrades attribution from clicks to actual bookings.

---

## 1. What the research found

### 1.1 Program status (as of 2026-07-16)

| Fact | Detail | Source |
|---|---|---|
| Announced | 2026-04-01 blog post; "official, approval-based, API partner program that's launching soon"; already working with "a small number of early partners" | jane.app/blog/jane-integrations-our-program-our-partners-and-how-to-work-with-us |
| Intake form | Live, public, no login, no terms-acceptance checkbox | integrations.jane.app (URL in §0) |
| Capacity | **"currently at capacity… not onboarding new integrations right now"**; applicants "likely won't hear back" until reopen | text on the intake form page |
| Vetting | "an intake and approval process" reviewing "how their product works, how data flows, how privacy is protected, and how the integration will be supported" | blog post |
| Fees / revenue share | **Nothing published.** No tiers published either. (Only precedent: Documo's discounted per-clinic rate — a co-marketing arrangement, not a platform fee.) | blog + FAQ + search sweep |
| Review timeline | Not published | — |
| Explicit exclusions (verbatim) | "not ready to support single-use-case integrations" · "Clinics cannot build their own integrations" · **"not looking to work with AI scheduling or AI scribe tools"** · **"Posting directly into Jane's calendars is not supported"** · no credential sharing / no disabling 2FA | blog post |
| Launch partners | Claim.MD, Cyberimpact, Documo, Fullscript, Google Analytics, MailChimp, Mango Voice, Pacific Blue Cross, Physitrack, Teleplan, TELUS eClaims, **TrustDrivenCare**, Wibbi | blog post |
| Contact | partnerships@jane.app | integrations FAQ |
| No open API | "Jane doesn't currently have an open API or provide API keys, and there aren't any plans to make these available" — the partner program is the ONLY path | integrations FAQ |

**The TrustDrivenCare angle:** TDC is a named launch partner AND Move Better already uses TDC (Bernard literally renders the TDC email template — `src/email-template.html`). TDC is patient-communication/marketing — proof Jane partners with Bernard's category. Worth (a) name-dropping as a comparable in the application, (b) asking TDC for a warm intro to Jane's partnerships team.

### 1.2 Technical model ("Jane Extensions")

- **Concept:** Extensions are "secure, practitioner-authorized integrations that access clinic data on their behalf." Single-clinic-per-token; each clinic OAuth-authorizes the extension on its own Jane account. There's an extension **catalog** (approved extensions discoverable in Jane).
- **Registration (post-approval):** partner supplies Extension Name, Redirect URI(s) (HTTPS, exact pre-registration), Extension Description, Support Contact(s) → Jane issues `partner_client_id` + `partner_client_secret` (Sensitive — 1Password + Vercel env only), scopes, IAM Service URL.
- **Auth:** OAuth 2.0 Authorization Code **+ PKCE (mandatory)**. Access tokens ~5 min, refresh tokens ~30 min — so Bernard must build proactive refresh (different from our Google OAuth pattern where access tokens live 1h; the `gscAuth.js` refresh-token pattern still applies, just hotter).
- **Environments:** partner sandbox realm `jane_partner_sandbox` (docs demo clinic `jdpdocsdemo.jane.qa`) vs production realm `jane`.
- **Versioning:** date-based in the URL path — current `/api/2026-01-01/`.
- **Rate limits:** 100 req/min per endpoint per clinic; 600 per 5 min per clinic overall. (Fine for webhook-driven attribution; would matter only for bulk backfills.)
- **API surface (from developers.jane.app/llms.txt, complete):**
  - **Read-only:** patients (list/get + POST free-text search — deliberately POST so PII stays out of query strings), **appointments (Get/List only — NO create/update)**, locations, staff_members, disciplines, treatments, company.
  - **Read+write (charting only):** medical-record observations, care plans, medications; document upload.
  - **Webhooks:** register / list / get / deregister subscriptions. **Event topics: `APPOINTMENT_BOOKED`, `APPOINTMENT_CANCELLED`, `APPOINTMENT_UNCANCELLED`, `APPOINTMENT_RESCHEDULED`.** Signing secret returned once at registration; payloads HMAC-verified (matches Bernard's existing `timingSafeEqual` webhook pattern). 409 on duplicate topic.
  - **Appointment resource fields:** `id, start_at, end_at, staff_member_id, patient_id, location_id, treatment_id, first_visit (bool), booked_at, cancelled_at, cancelled_reason (sanitized — staff free-text is mapped to 'Other' by Jane to prevent PHI leakage), no_show_at, arrived_at, checked_in_at, archived_at, state (reserved/booked/arrived/no_show/cancelled/archived)`.
- **Scopes are granular** (`appointments:read`, `webhooks:create`, `observations:read`…) → **yes, the integration can be scoped to appointment metadata and never touch clinical records.** Jane's own API design (sanitized cancel reasons, POST-body patient search) shows they reward data-minimization thinking — mirror it in the application.

### 1.3 Compliance — "The Jane 10" (jane.app/legal/partner-security-at-jane)

Jane's published security requirements **for vendor partnerships involving PHI**:

1. **SOC 2 Type II report ≤12 months old** + HIPAA/GDPR compliance + **signed BAA**
2. Documented security policies: infosec, incident response, change management, secure development, staff training
3. **AES-256 at rest, TLS 1.2+ in transit**, jurisdiction-specific data-residency controls
4. RBAC, SSO, least privilege, **MFA on privileged accounts**
5. Documented IR plan with **breach notification within 24 hours of detection**
6. Monitoring + audit logging, **12-month log retention**
7. Vulnerability scans + patch SLAs (e.g. 30 days critical)
8. Secure SDLC, SAST/DAST, **annual penetration testing**
9. **Subprocessor list** + compliance oversight of them
10. Strong auth mechanisms (OAuth 2.0, mTLS, bearer tokens)

Jane signs BAAs with US clinics and supports PIPEDA for Canadian ones; expect a BAA (or Canadian equivalent data-processing terms) to be part of partner onboarding **if** the integration handles PHI. **Key scoping fact:** appointment events tied to a `patient_id` are PHI under HIPAA even without a name — so "we only take metadata" does not exempt Bernard from the list above; it only shrinks the surface. §4 D3 covers the design choice that follows.

### 1.4 Precedents

| Company | Path | Verified? |
|---|---|---|
| **TrustDrivenCare** | **Official launch partner** — patient communication/reviews/email (Bernard's category) | ✅ On Jane's own launch-partner list |
| **AgentZap** ($109/mo AI receptionist) | Claims "OAuth 2.0 + webhooks" via "Jane's Developer Platform," claims it "books appointments directly into your Jane App schedule" and creates patient records | ⚠️ **Unverified and partially implausible** — no official-partner statement on their site, not on Jane's partner list, and the public API has NO appointment/patient writes. Either a private early-partner arrangement or marketing ahead of reality. **Do not cite AgentZap as proof booking-writes are grantable.** |
| **Kickcall** (AI receptionist) | **Explicitly unofficial** — "connects to Jane via Google Calendar" (calendar bridge), "not an official Jane integration" | ✅ Their own site says so |
| **Smith.ai** (virtual receptionists) | Human receptionists book via the clinic's **Jane online-booking link** (no API) | ✅ Their site: "share your Jane calendar link" |
| **Retell AI** | Has a Jane integration page (same class as Kickcall — not investigated deeper) | — |

Reading of the field: **nobody has verified official API booking-write access.** The AI-receptionist crowd Jane explicitly says it's *not* looking to work with is bridging via calendar sync and booking links. The approved-partner list is billing, clinical content, and **marketing/communications** — exactly where Bernard should stand.

### 1.5 Stopgaps available TODAY (no approval, no account, no terms)

1. **Treatment-level deep links into Jane online booking** — Jane supports copying a direct URL to any discipline/treatment on the clinic's booking site; patients land on that exact schedule. movebetter.janeapp.com is live (HTTP 200 confirmed today). **This is the phase-0 "one-tap booking"**: concierge answers, answer pages, and `/link` link straight to the right treatment's booking page. Attribution via GA4 outbound-click tracking, **already shipped** in Bernard (`fetchGA4OutboundClickCount` — 117 Book-Now clicks measured over the trailing 90 days with zero custom instrumentation).
2. **Reserve with Google** — Jane-native (Settings → Integrations → Reserve with Google, 1–3 business days to activate). Puts a "Book Online" button on the Google Business Profile that routes to the Jane booking site; Jane's Appointments report gains a "Referral Source" column for these. US+Canada; requires a Practice/Thrive (or legacy online-booking) plan and public online booking. **Directly serves F21's "be actionable to Google's agents" thesis with zero build.** ✅ Confirmed 2026-07-16: already enabled and live for both Move Better locations — "Book Online" button verified on both GBP listings, routing to the Jane booking site (see §4 D5).
3. **iCal calendar subscription feeds** (per-staff appointments/shifts) — one-way, view-only. This is the seam Kickcall bridges with. It *could* approximate cancellation detection (events disappearing from the feed), but: it's polling-based, has no explicit cancelled semantics, and can carry appointment-note PHI depending on clinic settings. **Not recommended** as Bernard plumbing — noted for completeness; it's a workaround Jane tolerates but conspicuously doesn't bless for partners.
4. **Jane-side referral attribution** — Jane's own "How did you hear about us?" / Referral Source reporting. Manual/coarse, but a clinic can add "Website concierge / AI answer page" as an option today and staff can eyeball the trend line before any API exists.

**Net:** phase-0 ships the *experience* (one-tap booking from every Bernard surface) and *click-level* attribution now; JDP approval upgrades attribution to *actual bookings* (booked/cancelled/no-show/first-visit) and unlocks cancellation-triggered content.

---

## 2. Application checklist

### ✅ Pre-drafted below (Q reviews, tweaks, pastes)

| # | Form field | Where drafted |
|---|---|---|
| 8 | Product description | §3.1 |
| 9 | Geographic service areas | §3.2 (recommend: United States + Canada) |
| 10 | Integration motivation | §3.3 |
| 11 | Product differentiation | §3.4 |
| 12 | Shared customers | §3.5 |
| 13 | Workflow problems solved | §3.6 |
| 14 | Target users | §3.7 |
| 15 | Data operation type | §3.8 (recommend: **Read**) |
| 16 | Data types needed | §3.8 (Appointments, Treatments, Disciplines, Clinic-Related Data — deliberately NOT Patients) |
| 17 | Create/update/delete needs | §3.8 (recommend: **No**) |
| 18 | Integration description | §3.9 |
| 19 | Customer signup process | §3.10 |
| 21 | New API endpoints wanted | §3.11 |
| 22–24 | Security posture / PHI / encryption | §3.12 (with decisions D2/D3 flagged) |

### 🧍 Only Q can provide / decide

| # | Item | Notes |
|---|---|---|
| 1–4 | First name, Last name, Email, Title | Suggest: Michael / Quasney / operations@movebetter.co (mildly sensitive — login-adjacent email) / "Founder" or "Owner" |
| 5 | **Company legal name + d/b/a** | The registered legal entity behind Bernard (e.g. an LLC name) + "Bernard" as d/b/a. I did not guess this — legal-entity names must be exact. |
| 6 | Company website | withbernard.ai (confirm you want the product site, not movebetter.co) |
| 7 | Company stage | **Startup** (pre-selected in drafts) |
| 22 | **D2: security-posture dropdown choice** | See §4 — honesty options are "Other" (describe posture) or "SOC 2 Planned for 2026" *only if you actually commit to starting one*. Do not select an attestation Bernard doesn't hold. |
| 23 | **D3: PHI-handling radio (Yes/No/Unsure)** | See §4 — recommend **Yes** + minimization narrative; "No" only if you commit to the aggregate-only design. |
| 25 | Security contact (name + email) | Suggest: Michael Quasney, operations@movebetter.co — or a dedicated security@ alias if you'd rather (5-minute setup in your mail provider, looks more mature). |
| 20 | Visual documentation (optional upload) | Optional. I can produce a one-page integration diagram (data-flow: clinic OAuth → webhooks → attribution ledger → dashboard) on request. `-- Sonnet, Quick` |
| — | **The submission itself** | Form is public, no account needed, no terms checkbox. Steps in §5. |

**Not required by this form** (things we guessed might be asked but aren't): insurance certificates, incorporation docs, revenue, customer counts, pricing. The form is a lightweight interest-intake; the heavy vetting (Jane 10 evidence, BAA) comes later, post-queue.

---

## 3. Pre-drafted answers

> Drafting rules used: every claim below is grounded in shipped Bernard architecture or Move Better's real setup — no invented certifications, no inflated numbers. Where the form field is a textarea, the draft is sized to be pasted as-is.

### 3.1 Product description *(required — "describe what your product does and who it serves")*

> Bernard (withbernard.ai) is an AI content and marketing platform for small allied-health clinics — chiropractic, physiotherapy, and similar practices. Bernard interviews the clinician in their own voice (chat or a weekly phone call), then drafts and schedules the practice's marketing — Google Business Profile posts, social posts, blog articles, patient email — with every word gated behind the owner's explicit approval before anything publishes. Bernard also maintains the practice's public patient-education pages (structured Q&A with schema.org markup) and a website concierge that answers patient questions using only the clinic's own published content, and it measures which content actually drives site visits and booking clicks. Bernard is built and operated by the owner of Move Better, a two-location chiropractic practice (Portland, OR / Vancouver, WA) that runs its scheduling on Jane — we are a Jane customer first.

### 3.2 Geographic service areas *(required — checkboxes)*

**United States** ☑ and **Canada** ☑ (recommended both: current tenants are US; the platform is multi-tenant SaaS with nothing US-specific, and most Jane clinics are Canadian — checking Canada signals seriousness about Jane's base. PIPEDA implications are noted in §4 R5.)

### 3.3 Integration motivation *(required — textarea)*

> Our clinics' patient journeys start in Bernard-powered surfaces — the clinic website's Q&A concierge, public patient-education pages, the link-in-bio page — and end at the clinic's Jane online booking site. Two things we cannot do today: (1) close the attribution loop — a clinic can see clicks toward their Jane booking site (via GA4) but never whether an appointment actually resulted, so they can't tell which content fills the calendar; and (2) react to schedule reality — when appointments are cancelled, the clinic's own channels could (with the owner's approval) promote the newly open availability, but we have no signal that a cancellation happened.
>
> We want read-only access to appointment metadata plus appointment-event webhooks (booked / cancelled / rescheduled) so our clinics can see which of their content produces real bookings, and so cancellations can prompt (never auto-publish) availability content. We are deliberately NOT asking to create or modify appointments or post into Jane's calendars: booking should happen in Jane's own online booking flow, where the clinic's policies, intake forms, and payments already live. Our surfaces hand patients to the clinic's Jane booking site via its existing booking links — the same referral pattern as Reserve with Google.

### 3.4 Product differentiation *(required — textarea)*

> Generic AI marketing tools generate plausible content from nothing; Bernard only publishes what the clinician actually said. Every draft is grounded in recorded interviews with the practice's own clinicians, scored against the clinician's real voice by an automated fidelity judge, and hard-gated behind the owner's word-by-word approval before it can publish anywhere. Bernard also maintains the practice's public Q&A corpus with supersession (when the clinician's answer changes, the published page is updated or retracted — stale advice doesn't linger), and tracks whether AI assistants (ChatGPT, Perplexity, Google AI Overviews) cite the practice's content. The Jane integration would complete that loop: from "the AI engines cite you" to "here are the appointments that resulted."

### 3.5 Shared customers *(optional — text)*

> Move Better (Portland, OR + Vancouver, WA) — movebetter.janeapp.com — is a Jane clinic and Bernard's founding customer; Bernard is built by its owner. We also share the TrustDrivenCare ecosystem: Move Better uses TrustDrivenCare (one of your launch partners) for patient email alongside Bernard.

### 3.6 Workflow problems solved *(optional — textarea)*

> 1) Attribution: clinic owners spend on marketing with no line of sight from a post/page to a booked appointment; front-desk "how did you hear about us?" data is spotty. Appointment-event webhooks joined (by time, treatment, and location — not patient identity) to content and referral data give owners a truthful "this content → these bookings" report.
> 2) Cancellation backfill: an open slot is perishable inventory. A cancellation event can prompt the owner to approve a pre-drafted "we have openings this week" post for GBP/social — filled from their own words, published only with their approval.
> 3) Front-desk question load: the website concierge already answers patient questions from the clinic's own content; a clean handoff to the right treatment's Jane booking page turns an answered question into a booked visit without a phone call.

### 3.7 Target users *(optional — textarea)*

> Owner-operators and practice managers of 1–15-practitioner allied-health clinics (chiropractic, physio, massage, multidisciplinary) in the US and Canada — specifically practices with no dedicated marketing staff. Our thesis is that the clinician's own expertise, captured in interviews, is the practice's best marketing asset; Bernard is the employee that turns it into published, measurable work.

### 3.8 Technical scope *(required radios/checkboxes)*

- **15. Data operation type:** **Read** *(not "Both" — matches the current API surface and the positioning; the write-side ambition lives in field 21, not here)*
- **16. Data types needed:** ☑ Appointments · ☑ Treatments · ☑ Disciplines · ☑ Clinic-Related Data (company, locations, staff members) · ☐ Patients (**deliberately unchecked** — data minimization; we never need to resolve a patient's identity) · ☐ Other
- **17. Create/update/delete requirements:** **No**

### 3.9 Integration description *(required — textarea)*

> Per-clinic, practitioner-authorized OAuth 2.0 (Authorization Code + PKCE): the clinic owner connects Jane from Bernard's settings screen and grants read-only scopes (appointments, treatments, disciplines, locations, staff members, company) — never clinical-record scopes. We then register webhook subscriptions for APPOINTMENT_BOOKED / CANCELLED / UNCANCELLED / RESCHEDULED and verify every delivery against the signing secret (HMAC, constant-time comparison — the same pattern we already run for Stripe, Twilio, and OpenAI webhooks).
>
> Inbound events update a per-clinic attribution ledger: bookings are joined to content/referral activity by time window, treatment, location, and staff member. We do not need or use patient identity: the patient_id in event payloads is used only to correlate an appointment's own lifecycle events (booked → rescheduled → cancelled), stored as a salted hash, and never joined to marketing data or displayed. Aggregates (bookings per week per treatment per source, first-visit share, cancellation/no-show rates) power the clinic's dashboard. Cancellation events can prompt the owner to approve availability-promotion content; nothing publishes without explicit human approval.
>
> Patient-facing booking remains 100% in Jane: our concierge, patient-education pages, and link-in-bio page deep-link to the clinic's own Jane online booking site (per-treatment links), so scheduling policy, intake, and payment stay where they already work. We do not write to calendars.
>
> Tenant isolation and credential handling: Bernard is multi-tenant; every server route resolves the workspace and filters all queries by workspace id (audited on a standing cadence). Per-clinic Jane tokens would live in our existing per-workspace credential store, encrypted at the column level with AES-256-GCM, alongside our Google (GA4/Search Console) OAuth credentials which follow the same pattern.

### 3.10 Customer signup process *(optional — textarea)*

> Clinics onboard to Bernard self-serve (workspace + guided setup interview). Connecting Jane would be a settings-page action inside their Bernard workspace: click "Connect Jane," authorize on their own Jane login via your OAuth flow (no credential sharing — we never see Jane passwords), scopes displayed before consent, disconnect available in the same panel at any time and honored by deregistering webhooks and deleting stored tokens.

### 3.11 New API endpoints *(optional — textarea — this is where the F21 write-side ambition goes, framed as roadmap interest)*

> Two things would deepen the integration if they ever fit your roadmap:
> 1) A read-only availability endpoint (open bookable slots per treatment/staff/location) so patient-facing surfaces could show "next available Tuesday 2:10pm" and deep-link to that exact slot in Jane's booking flow — discovery stays with us, transaction stays with Jane.
> 2) A booking-handoff primitive for vetted partners — even just a parameterized/pre-filled booking URL (treatment + staff + slot) rather than API-side booking creation.
> Neither is required for the integration described above; appointment reads + webhooks deliver the core value.

### 3.12 Privacy & security *(required — see decisions D2/D3 in §4 before choosing)*

- **22. Security posture** (dropdown): **Q decides — D2.** If "Other," use this description wherever a text field allows:
  > No formal attestation yet (early-stage). Posture: all infrastructure on SOC 2 Type II-audited providers (Vercel, Supabase/AWS, Clerk); TLS 1.2+ everywhere in transit; AES-256 at rest at the storage layer plus application-layer AES-256-GCM for all third-party credentials/tokens; SSO + MFA via Clerk with role-based access control per workspace; strict tenant isolation enforced and audited at the API layer; webhook ingestion HMAC-verified with constant-time comparison; error tracking and structured logging (Sentry); no PHI in our content pipeline by policy. Prepared to pursue SOC 2 Type II as part of partner onboarding.
- **23. PHI handling** (Yes/No/Unsure): **Q decides — D3.** Recommended: **Yes**, because appointment events keyed by patient_id are PHI even though we never touch clinical records — answering Yes with a tight minimization story reads as mature; answering No requires committing to the strictly-aggregate design (drop patient_id at the edge before any persistence) and saying so explicitly.
- **24. Encryption in transit + at rest** (Yes/No/Unsure): **Yes** — TLS 1.2+ in transit; AES-256 at rest (managed Postgres + object storage); application-layer AES-256-GCM on integration credentials (verified: `api/_lib/credentialCrypto.js`).
- **25. Security contact:** Michael Quasney, operations@movebetter.co (or a security@ alias — Q's call).

---

## 4. Decisions Q must make + risks/blockers

### Decisions

*(Q's calls recorded 2026-07-16)*

- **D1 / Entity — ✅ DECIDED: form a Bernard legal entity FIRST, then submit.** Q ruled out applying under Move Better LLC ("gets very tricky"). Consequences: submission is now gated on entity formation; the cost of the delay is low because the program is at capacity anyway. Supporting logic for entity-first: (a) Jane's verbatim exclusion "Clinics cannot build their own integrations" makes a clinic-named applicant a pattern-match risk; (b) SOC 2 and any future BAA attach to a legal entity — attesting the practice LLC for a SaaS product would be backwards; (c) Bernard's SaaS strategy (Stripe/tiers already in code) needs its own entity soon regardless. When the entity exists, the company-name field = the new entity's exact registered name, "product: Bernard," website withbernard.ai.
- **D2 — Security-posture dropdown: OPEN, staged recommendation.** Do NOT buy SOC 2 now. Stage it: (1) entity first (a report attaches to the entity); (2) do the cheap Jane-10-overlap items (R4 list); (3) adopt a compliance-automation platform (Vanta/Drata/Secureframe, ~$8–15k/yr) to become *audit-ready* only when SaaS externalization is really proceeding; (4) trigger the actual Type II audit (+$5–15k auditor) on a concrete demand signal — the Jane program reopening, or any partner/enterprise prospect asking. On the form: "SOC 2 Planned for 2026" only if step 3 is committed at submission time; otherwise "Other" + the §3.12 description. (Full walkthrough given in-session 2026-07-16.)
- **D3 — PHI stance — ✅ DECIDED: "Yes" + minimization narrative** (as drafted in §3.9/§3.12). Accepts that the full Jane 10 + a BAA apply at vetting time; keeps per-booking no-show/first-visit attribution.
- **D4 — Geography — ✅ DECIDED: United States + Canada.**
- **D5 — Reserve with Google. ✅ RESOLVED 2026-07-16 — already enabled and live.** Verified in Jane admin (Settings → Integrations → Reserve with Google: account-wide toggle ON) and on Google itself: both the Portland (237 NE Broadway Ste 245) and Vancouver (10303 NE Fourth Plain Blvd #105) Google Business Profile listings show the "Book Online" button, and its link routes to the Move Better Jane booking site. Both locations are "listed in online booking" in Jane with public addresses. Attributed bookings appear in Jane's Appointments report → Referral Source column. Minor observation (not changed): Portland's GBP category reads "Physical therapy clinic" while Vancouver's reads "Chiropractor."

### Risks / blockers

- **R1 — Program at capacity (hard blocker on timeline).** No response expected until reopening; no published timeline. Mitigations: queue position now, partnerships@ email, TDC warm intro. Do NOT interpret silence as rejection.
- **R2 — Category exclusion ("AI scheduling tools").** Bernard's application must never read as an AI receptionist/scheduler. The drafted answers position Bernard as marketing/attribution (TDC's category) and explicitly disclaim calendar writes. If a Jane reviewer still pattern-matches "AI + appointments = excluded," the fallback argument is in §3.3's last sentence: we are the referral pattern they already bless (Reserve with Google), plus webhooks they already built.
- **R3 — No booking-write API exists.** F21's "real booking actions via Jane's partner API" cannot ship on today's JDP even with approval. Phasing: phase 0 deep links (now) → phase 1 webhooks/attribution (on approval) → phase 2 availability/handoff (only if Jane ships it; interest registered via field 21). The Agent Gateway's "booking action" therefore means *deep-link handoff with availability context*, not API-side booking, for the foreseeable future. Plan F21 build scope accordingly.
- **R4 — Jane 10 gaps (matters at vetting time, not intake time).** Bernard today lacks: SOC 2 Type II (see D2), annual pen test, documented IR plan with a 24h-notification commitment, 12-month log retention (Vercel's default retention is far shorter — needs a log drain to storage), formal security-policy docs, SAST/DAST in CI (we have lint/audit cadence; not the same thing). None block the *intake form*; all will surface in real vetting. Cheap prep that closes real gaps: written IR plan + breach-notification commitment, log drain, security-policy one-pagers, subprocessor list (already exists in the privacy policy — verify current). `-- Sonnet, Medium`
- **R5 — Cross-border data (if Canada checked).** Canadian clinics' data processed on US infrastructure raises PIPEDA/provincial (PHIPA/PIPA) questions; Jane 10 #3 mentions jurisdiction-specific residency controls. Not a reason to uncheck Canada at intake; flag for the vetting conversation.
- **R6 — Precedent mirage.** AgentZap's "books directly into Jane" marketing is unverified and contradicts the public API — don't cite it in the application or build plans on it.
- **R7 — Token churn.** 5-min access / 30-min refresh tokens mean the integration needs robust rotation (webhook-driven flows mostly dodge this; scheduled reads must refresh first). Build-time concern only.

### Recommended sequencing *(revised 2026-07-16 after D1 entity-first decision)*

1. **Now:** Q forms the Bernard legal entity (attorney/accountant for structure; state filing). Submission waits on this — acceptable because the program is at capacity.
1b. **On entity formation:** submit the intake form (§5) under the new entity → parallel partnerships@ email + TDC warm-intro ask.
2. **Now, no approval needed:** ship phase-0 booking handoff — per-treatment Jane deep links on concierge answers, answer pages, and `/link`, with GA4 outbound-click attribution (already live) + enable Reserve with Google (D5). `-- Sonnet, Medium`
3. **Short-term (pre-vetting posture):** R4 prep items; decide D2 (SOC 2 track).
4. **On approval:** build the OAuth + webhook integration on existing seams (`workspace_credentials` AES-256-GCM store, `gscAuth.js` OAuth pattern, `timingSafeEqual` webhook pattern, attribution join into the Standing Producer's outcome grading). `-- Opus, Large`
5. **If/when Jane ships availability or booking-handoff endpoints:** phase 2 — the full F21 booking action.

---

## 5. Exactly what Q does to submit (no account needed)

1. Open: **https://integrations.jane.app/application_forms/jane-integrations-partner-interest-form/partner_applications/new**
2. Fill Section 1 identity fields (checklist §2 — legal company name is the only thing to look up).
3. Paste §3 answers into their fields; set the three §3.8 radios/checkboxes as drafted.
4. Make calls D2 (security dropdown) and D3 (PHI radio) — recommendations above.
5. Skip the optional file upload (or ask me for the diagram first).
6. Submit. Expect **no reply** while the program is at capacity — that's normal, not a rejection.
7. Optional same-day: short email to partnerships@jane.app ("Jane customer + health-tech founder, submitted the interest form, category = marketing/attribution like TrustDrivenCare, read-only + webhooks only") and ping TDC for a warm intro.

---

## 6. Sources (all fetched 2026-07-16)

- Intake form (fields + "at capacity" notice): https://integrations.jane.app/application_forms/jane-integrations-partner-interest-form/partner_applications/new
- Program announcement + exclusions + launch partners (2026-04-01): https://jane.app/blog/jane-integrations-our-program-our-partners-and-how-to-work-with-us
- "The Jane 10" partner security requirements: https://jane.app/legal/partner-security-at-jane
- JDP docs quick start (OAuth PKCE, tokens, realms, rate limits): https://developers.jane.app/docs/getting-started.md
- Full API index: https://developers.jane.app/llms.txt (webhook topics + appointment schema verified from reference/postwebhooks.md and reference/getanappointment.md OpenAPI)
- Integrations Hub FAQ (no open API; iCal one-way; partnerships@): https://jane.app/guide/integrations-hub-faq
- Reserve with Google guide: https://jane.app/guide/reserve-with-google
- Booking deep links: https://jane.app/guide/how-to-find-your-online-booking-link
- iCal staff feeds: https://jane.app/guide/subscribing-to-your-calendar-for-staff
- Jane HIPAA/BAA stance: https://jane.app/guide/is-jane-hipaa-compliant
- Precedents: https://agentzap.ai/integrations/jane · https://www.kickcall.ai/integrations/jane-app · https://smith.ai/integrates-with/jane
- Bernard-side grounding: `ARCHITECTURE.md` (multi-tenant isolation model), `api/_lib/credentialCrypto.js` (AES-256-GCM), `CLAUDE.md` (no-PHI content policy, GA4 outbound-click tracking), `.claude/frontier-panel.md` Run 5 / F21.
