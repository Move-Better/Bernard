// CitationReviewPanel — the human gate for research citations
// (.claude/blog-research-citations-spec.md). Implements the signed-off
// mockup, .claude/mockups/citation-review-panel.html (Q reviewed it live
// 2026-08-28 — see .claude/citation-review-mockup-notes.md for both
// resolved design questions).
//
// Rendered inside ApprovalPanel (AssetsPane.jsx), gated on
// `piece.platform === 'blog'` (covers series parts too — they're
// platform:'blog' with series_id set). Shown regardless of draft/approved
// status, per the spec's "before Approve/Schedule/Publish."
//
// Three states, matching the mockup's scenarios:
//   - no citations at all yet → an empty row with a "Find supporting
//     research" button (this doubles as Phase 5's on-demand backfill action
//     for any existing blog, not just freshly-drafted ones)
//   - 'suggested' rows present → a card per suggestion with Approve/Reject
//   - only decided rows (approved/rejected, no pending suggested) → a
//     compact decided list + a "find more" re-check affordance
//
// A citation's source_url/source_title are rendered EXACTLY as stored —
// this component never invents or reformats a URL; it only ever displays
// what api/_lib/citations/pipeline.js already verified.
//
// Every citation also carries a live `willInlineLink` (computed server-side,
// api/_routes/content-items/citations-list.js, against the content_item's
// CURRENT body) — the same rule api/_lib/citations/insertCitations.js
// enforces at publish time. This component never re-derives that decision
// itself; it only ever displays the server's live answer, per the spec's
// "Link placement — LOCKED 2026-08-28": a reviewer approving a citation
// should know which outcome they're getting, not discover it after publish.

import { useState } from 'react'
import { BookOpen, ExternalLink, Search, RefreshCw, Check, X, Loader2, AlertTriangle } from 'lucide-react'
import { Button } from '@/components/ui/button'
import { useCitations, useRunCitationEnrichment, useDecideCitation } from '@/lib/queries'

const TIER_LABEL = {
  peer_reviewed: 'Peer-reviewed',
  major_institution: 'Major institution',
  professional_guidelines: 'Professional guidelines',
  reputable_health_ed: 'Health education',
}

const TIER_CLASS = {
  peer_reviewed: 'bg-info/10 text-info',
  major_institution: 'bg-success/10 text-success',
  professional_guidelines: 'bg-action/10 text-action',
  reputable_health_ed: 'bg-muted text-muted-foreground',
}

function hostnameOf(url) {
  try { return new URL(url).hostname.replace(/^www\./i, '') } catch { return url }
}

function TierChip({ sourceType }) {
  if (!sourceType) return null
  return (
    <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-3xs font-bold uppercase tracking-wide ${TIER_CLASS[sourceType] || 'bg-muted text-muted-foreground'}`}>
      {TIER_LABEL[sourceType] || sourceType}
    </span>
  )
}

function ConfidenceBar({ confidence }) {
  const pct = Math.round(Math.min(Math.max(Number(confidence) || 0, 0), 1) * 100)
  return (
    <div className="flex items-center gap-1.5 text-3xs text-muted-foreground shrink-0">
      <span>{pct}%</span>
      <div className="w-10 h-1 rounded-full bg-muted overflow-hidden">
        <div className="h-full bg-success" style={{ width: `${pct}%` }} />
      </div>
    </div>
  )
}

// Live per-citation outcome — "will this actually inline?" — computed
// server-side and refreshed on every read, never a stale flag from
// enrichment time. Shown BEFORE the reviewer decides, per the locked design.
function LinkOutcomeNote({ willInlineLink }) {
  if (willInlineLink) {
    return (
      <div className="flex items-center gap-1.5 text-2xs text-success">
        <Check className="h-3 w-3 shrink-0" aria-hidden="true" />
        Will link inline + Further reading
      </div>
    )
  }
  return (
    <div
      className="flex items-center gap-1.5 text-2xs text-warning"
      title="The exact sentence this was matched to has changed since this suggestion was generated — approving still adds the source to Further reading, it just won't be linked inline."
    >
      <AlertTriangle className="h-3 w-3 shrink-0" aria-hidden="true" />
      Text changed since suggested — Further reading only
    </div>
  )
}

function SuggestedCitationCard({ citation, onDecide, deciding }) {
  return (
    <div className="border rounded-lg p-3 bg-background flex flex-col gap-2">
      <div className="text-xs text-muted-foreground">
        <span className="opacity-50">&ldquo;</span>
        <span className="font-medium text-foreground">{citation.claim_text}</span>
        <span className="opacity-50">&rdquo;</span>
      </div>
      <div className="flex items-start justify-between gap-2.5">
        <div className="flex flex-col gap-0.5 min-w-0">
          <a
            href={citation.source_url}
            target="_blank"
            rel="noreferrer"
            className="text-sm font-bold text-scheduled flex items-center gap-1.5 hover:underline"
          >
            {citation.source_title || citation.source_url}
            <ExternalLink className="h-3 w-3 opacity-60 shrink-0" aria-hidden="true" />
          </a>
          <div className="flex items-center gap-1.5 flex-wrap">
            <TierChip sourceType={citation.source_type} />
            <span className="text-3xs text-muted-foreground">{hostnameOf(citation.source_url)}</span>
          </div>
        </div>
        <ConfidenceBar confidence={citation.confidence} />
      </div>
      {citation.why_match && (
        <div className="text-xs bg-muted/50 rounded-md px-2.5 py-1.5 leading-relaxed">
          <span className="font-medium">Why it matches:</span> {citation.why_match}
        </div>
      )}
      <div className="flex items-center justify-between gap-2">
        <LinkOutcomeNote willInlineLink={citation.willInlineLink} />
        <div className="flex gap-1.5 shrink-0">
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-destructive/35 text-destructive hover:bg-destructive/10"
            disabled={deciding}
            onClick={() => onDecide(citation.id, 'rejected')}
          >
            <X className="h-3 w-3" aria-hidden="true" /> Reject
          </Button>
          <Button
            type="button"
            size="sm"
            variant="outline"
            className="border-success/40 text-success hover:bg-success/10"
            disabled={deciding}
            onClick={() => onDecide(citation.id, 'approved')}
          >
            <Check className="h-3 w-3" aria-hidden="true" /> Approve &amp; link
          </Button>
        </div>
      </div>
    </div>
  )
}

function DecidedRow({ citation }) {
  const isApproved = citation.status === 'approved'
  return (
    <div className={`flex items-center gap-2 text-xs px-2.5 py-1.5 rounded-md ${isApproved ? 'bg-success/5' : 'bg-muted/50 opacity-75'}`}>
      {isApproved
        ? <Check className="h-3.5 w-3.5 text-success shrink-0" aria-hidden="true" />
        : <X className="h-3.5 w-3.5 text-muted-foreground shrink-0" aria-hidden="true" />}
      <span className={`flex-1 min-w-0 truncate ${isApproved ? '' : 'line-through text-muted-foreground'}`}>
        {citation.source_title || citation.source_url}
        {isApproved && (
          <span className="text-muted-foreground font-normal">
            {citation.willInlineLink ? ' — linked inline + in Further reading' : ' — in Further reading only'}
          </span>
        )}
      </span>
    </div>
  )
}

export default function CitationReviewPanel({ piece }) {
  const eligible = piece?.platform === 'blog'
  const { data: citations = [], isLoading } = useCitations(piece?.id, { enabled: eligible })
  const enrich = useRunCitationEnrichment()
  const decide = useDecideCitation(piece?.id)
  // Session-only: distinguishes "never checked" from "checked, found nothing"
  // when a run genuinely finds 0 citations — nothing is persisted either way
  // (no rows are written on a 0-result run), so this is the honest amount of
  // state without adding a DB column purely for UI copy. Resets on reload,
  // which just falls back to the "never checked" wording — a fine
  // simplification for now (noted in .claude/citation-review-mockup-notes.md).
  const [checkedOnce, setCheckedOnce] = useState(false)

  if (!eligible) return null
  if (isLoading) return null // avoid a flash of the empty state before the first read resolves

  const suggested = citations.filter((c) => c.status === 'suggested')
  const decided = citations.filter((c) => c.status !== 'suggested')
  const checking = enrich.isPending

  const handleEnrich = () => {
    enrich.mutate(piece.id, { onSuccess: () => setCheckedOnce(true) })
  }

  return (
    <div className="flex flex-col gap-2.5">
      <div className="flex items-center justify-between gap-2">
        <div className="flex items-center gap-1.5 text-xs font-bold text-foreground">
          <BookOpen className="h-3.5 w-3.5 text-muted-foreground" aria-hidden="true" />
          {suggested.length > 0
            ? `Suggested research citations (${suggested.length})`
            : 'Research citations'}
        </div>
        {citations.length > 0 && (
          <Button
            type="button"
            size="sm"
            variant="outline"
            className={checking
              ? 'border-scheduled/30 text-scheduled bg-scheduled/10 h-7 px-2'
              : 'border-scheduled/35 text-scheduled hover:bg-scheduled/10 h-7 px-2'}
            disabled={checking}
            onClick={handleEnrich}
          >
            {checking
              ? <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              : <RefreshCw className="h-3 w-3" aria-hidden="true" />}
            {checking ? 'Checking…' : 'Re-check'}
          </Button>
        )}
      </div>

      {suggested.map((c) => (
        <SuggestedCitationCard key={c.id} citation={c} onDecide={(id, decision) => decide.mutate({ citationId: id, decision })} deciding={decide.isPending} />
      ))}

      {decided.length > 0 && (
        <div className="flex flex-col gap-1">
          {decided.map((c) => <DecidedRow key={c.id} citation={c} />)}
        </div>
      )}

      {citations.length === 0 && (
        <div className="flex items-center justify-between gap-2.5 px-3 py-2 border border-dashed rounded-lg bg-muted/40">
          <span className="text-xs text-muted-foreground">
            {checking
              ? 'Checking PubMed, Semantic Scholar, and the web for real sources… this can take a minute.'
              : checkedOnce
                ? 'Checked for supporting research — nothing in this post needed a citation.'
                : 'No research citations checked yet for this post.'}
          </span>
          {checking ? (
            <Button type="button" size="sm" variant="outline" disabled className="border-scheduled/30 text-scheduled bg-scheduled/10">
              <Loader2 className="h-3 w-3 animate-spin" aria-hidden="true" />
              Checking…
            </Button>
          ) : checkedOnce ? (
            <Button type="button" size="sm" variant="outline" className="border-scheduled/35 text-scheduled hover:bg-scheduled/10" onClick={handleEnrich}>
              <RefreshCw className="h-3 w-3" aria-hidden="true" />
              Re-check
            </Button>
          ) : (
            <Button type="button" size="sm" className="bg-action text-action-foreground hover:bg-action/90" onClick={handleEnrich}>
              <Search className="h-3 w-3" aria-hidden="true" />
              Find supporting research
            </Button>
          )}
        </div>
      )}

      {citations.length > 0 && suggested.length === 0 && !checking && (
        <button
          type="button"
          className="text-2xs font-bold text-action text-left hover:underline w-fit"
          onClick={handleEnrich}
        >
          Find more research for this post &rarr;
        </button>
      )}
    </div>
  )
}
