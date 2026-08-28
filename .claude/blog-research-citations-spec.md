# Blog research citations — verified, human-approved (spec)

Origin: in-app feedback 1cd775a1 (Philip). Bernard was told to "find supporting research and link it" but the blog writer runs with **no retrieval tool**, so it fabricated plausible PubMed/PMID URLs whose anchor text didn't match the linked page. The instruction was removed (PR #2665) and the fabricated links were remediated. This spec restores Q's *actual* ask — real research, really linked — the right way.

## The one invariant that makes a repeat impossible

**A research URL is NEVER emitted from the model's own memory.** Every link that ships came from a real API result (PubMed / Semantic Scholar / web search) and passed content-level verification (it resolves AND the source's real text supports the specific claim). HTTP-200 is not sufficient — a live PMID can be the wrong paper — so verification checks the *content*, judged against the real abstract/page, not just that the URL loads. A human approves every citation before publish.

## Architecture — one enrichment pass, two retrieval sources, one human gate

Runs as a **separate stage after the draft is written** (never inside the draft-generation call, which stays tool-less):

1. **Claim extraction** — pull 1–3 key clinical claims from the draft that would genuinely benefit from backing (mechanism statements, "imaging correlates poorly with pain"–type claims, protocol references). Personal anecdotes and patient stories get nothing.
2. **Retrieval (A + B)** — for each claim, gather real candidates from BOTH:
   - **B (structured):** PubMed E-utilities (`esearch`→`efetch`, real PMID + title + abstract) and Semantic Scholar (free APIs). Best for peer-reviewed studies.
   - **A (web):** a web-search tool call restricted/re-ranked to the source allowlist. Best for authoritative institution pages and guidelines (Mayo, Cleveland, ACA) that aren't in PubMed.
3. **Verification (per candidate)** — fetch the candidate's real content (abstract for PubMed; page text for web) and a judge model rules: does this source *genuinely support this specific claim*? Output = {support: yes/no, confidence, one-line why}. Only `yes` survives. Re-check the URL resolves. Reject anything on a non-allowlisted domain.
4. **Reviewable step (human gate)** — surviving candidates surface in the publish editor as "suggested citations": `claim → source (title + URL) → why it matches → confidence`. Q approves/rejects each. **Approved-only** citations are inserted with descriptive anchor text; rejected ones are discarded. Nothing links without approval.

Cite only when warranted: 0–3 per post, never count-filled. A claim with no supporting source gets no link — that's a correct outcome, not a gap.

## Source policy (allowlist, per Q 2026-08-27)

Tiered; a citation must resolve to one of these or it's rejected:
- **Peer-reviewed:** pubmed.ncbi.nlm.nih.gov, ncbi.nlm.nih.gov (PMC), semanticscholar.org, cochranelibrary.com
- **Major institutions:** mayoclinic.org, clevelandclinic.org, nih.gov, and equivalent
- **Professional guidelines:** acatoday.org (ACA); animalchiropractic.org (AVCA) for equine
- **Reputable health-ed (only where they cite primary research):** healthline.com, webmd.com, medlineplus.gov
- **Excluded always:** competitor clinics, content farms, anything not on the allowlist. Allowlist lives in config so it can grow.

## Data model (proposed)

A `blog_citations` table (or a `citations` jsonb on `content_items`), each row: `content_item_id, claim_text, source_url, source_title, source_type (pubmed|semantic_scholar|web), why_match, confidence, verify_evidence, status (suggested|approved|rejected), created_at`. The review step reads `suggested`; publish inserts only `approved`. Keeps an audit trail of what was proposed and what a human accepted.

## Hookpoints (grounded in the real generation paths)

Blog/series generation lives in:
- `api/_routes/content-items/blog-regen-prepare.js` (getBlogPostSystemPrompt caller)
- `api/_lib/outboundCall.js` (outbound-call blog)
- `src/pages/InterviewSession.jsx` (interview→blog)
- `api/_routes/content-items/split-into-series.js` (getSeriesPartSystemPrompt caller)

The enrichment pass runs **after** each of these produces a draft (not inside them). On-demand re-enrich = a "Find supporting research" action on any existing blog that runs the same pass and populates the review step. Mirror the existing suggest-media pattern (`useMediaSuggestions` / `suggest-media`) for the "propose → human approves → apply" shape.

## Review-step UX

Lives in the publish editor, before Approve/Publish (same neighborhood as ApprovalPanel). Mockup-first: build and sign off a mockup of the "suggested citations" panel before writing UI code. Anchor text descriptive and in the clinician's framing; never "click here."

## Guards / tests (validate-the-validator)

- A test that a URL the model "knows" but that never appeared in a retrieval result CANNOT be inserted (proves the memory-URL path is closed).
- A test that a candidate whose real abstract does NOT support the claim is rejected (proves verification isn't rubber-stamping).
- A test that a non-allowlisted domain is rejected even if the judge says "supports."
- Watch each guard fail before trusting it (mutate the verify step, confirm red).

## Scope boundaries

Blogs + series only. Not social atoms (too short), not answers (own grounding). Not a change to draft generation itself (stays tool-less). No auto-insert — human approval is mandatory.

## Phased build

1. Retrieval + verification library (PubMed/Semantic Scholar clients, web-search call, judge). Pure, unit-testable. Ship with the guards above.
2. `blog_citations` storage + the enrichment endpoint (post-draft + on-demand).
3. Mockup → sign-off → the review-step UI in the publish editor.
4. Wire the four generation hookpoints to trigger the pass; wire publish to insert approved-only.
5. Backfill affordance for the stripped blogs.
