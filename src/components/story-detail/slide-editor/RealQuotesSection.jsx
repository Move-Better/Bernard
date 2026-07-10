import { Type, Loader2 } from 'lucide-react'
import { useVerbatimQuotes } from '@/lib/queries'

// ── Real Quotes — verbatim lines from the source interview ────────────────────
// Shows the actual words the clinician said that grounded this post.
// Tapping a quote inserts it as a body text block on the active slide.
export default function RealQuotesSection({ pieceId, onInsertQuote }) {
  const { data: quotes = [], isLoading } = useVerbatimQuotes(pieceId)

  if (!isLoading && quotes.length === 0) return null

  return (
    <div>
      <div className="pb-2 flex items-center justify-between">
        <span className="text-sm font-bold uppercase tracking-wide text-foreground/80 flex items-center gap-1.5">
          <Type className="h-4 w-4" /> Real quotes
        </span>
        <span className="text-xs text-muted-foreground">from your interview · tap to add</span>
      </div>
      {isLoading ? (
        <div className="pb-1 flex items-center gap-2 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin" /> Loading…
        </div>
      ) : (
        <div className="space-y-2">
          {quotes.map((q) => (
            <button
              key={q.id}
              type="button"
              onClick={() => onInsertQuote?.(q.quote)}
              className="w-full text-left rounded-lg border border-l-[3px] border-l-verbatim-accent bg-card px-3 py-2.5 text-sm leading-snug text-foreground hover:bg-verbatim-accent/5 transition-colors"
            >
              <span className="text-xs font-bold uppercase tracking-wide text-verbatim-accent block mb-1">● verbatim</span>
              &ldquo;{q.quote}&rdquo;
            </button>
          ))}
        </div>
      )}
    </div>
  )
}
