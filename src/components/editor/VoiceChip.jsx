import { useState } from 'react'
import { ShieldCheck, AlertTriangle, ChevronDown } from 'lucide-react'
import { scoreTier, FLAG_LABELS, SEVERITY_DOT, VOICE_FIDELITY_TOOLTIP, wordSources, needsCloseRead, CLOSE_READ_PCT } from '@/lib/voiceFidelity'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// VoiceChip — the compact, header-sized voice-fidelity read for the editor.
//
// Passive by design (Q, 2026-07-08): it shows Bernard's score + tier and, on
// click, the drift flags — it INFORMS the "Sounds like me" call, it does not
// act (no regenerate/rewrite). Same data source as the full VoiceFidelityBadge
// (piece.voice_fidelity_score + piece.voice_audit); shares scoreTier so the two
// never drift. Renders nothing until an audit lands — matches the badge, so the
// fire-and-forget pass never leaves a visible "pending" stub in the header.

// One voice number (post editor audit B, 2026-11-11): this chip is the only
// voice read on the editor. "Where the words came from" (provenance) sits in
// its details, and when Bernard wrote more than 40% of the words the chip turns
// amber and reads "Read closely", with or without a score.
const CLOSE_READ_TIER = { text: 'text-warning', bg: 'bg-warning/10', border: 'border-warning/30' }

export default function VoiceChip({ piece }) {
  const [open, setOpen] = useState(false)
  const audit = piece?.voice_audit
  const score = piece?.voice_fidelity_score
  const hasAudit = !!audit && !audit.error
  const sources = wordSources(piece)
  const closeRead = needsCloseRead(piece)

  if (!hasAudit && !closeRead) return null

  const shown = hasAudit ? (typeof score === 'number' ? score : (audit.score ?? 0)) : null
  const tier = hasAudit ? scoreTier(shown) : { ...CLOSE_READ_TIER, iconName: 'alert', label: 'No voice score yet' }
  const chipTier = closeRead ? CLOSE_READ_TIER : tier
  const flags = hasAudit && Array.isArray(audit.flags) ? audit.flags : []
  const Icon = closeRead || tier.iconName !== 'shield' ? AlertTriangle : ShieldCheck
  const who = (piece?.staff_name || '').trim().split(/\s+/)[0] || 'their'
  const whose = who === 'their' ? 'their' : `${who}’s`
  const hasDetails = flags.length > 0 || !!sources

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border ${chipTier.border} ${chipTier.bg} px-2.5 py-1 ${chipTier.text}`}
            aria-expanded={open}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            {closeRead
              ? <span className="text-2xs font-semibold">Read closely</span>
              : <span className="hidden text-2xs font-semibold 2xl:inline">Sounds like you</span>}
            {shown != null && <span className="text-2xs font-bold tabular-nums">{shown}</span>}
            {hasDetails && (
              <ChevronDown className={`h-3 w-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-center leading-snug">
          {closeRead
            ? `Bernard wrote more than ${CLOSE_READ_PCT}% of these words. Read it closely before approving.`
            : VOICE_FIDELITY_TOOLTIP} Click for details.
        </TooltipContent>
      </Tooltip>

      {open && (
        <>
          {/* click-away backdrop */}
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${tier.text}`} />
              <span className={`text-sm font-semibold ${tier.text}`}>{tier.label}</span>
              {shown != null && <span className="ml-auto text-sm font-bold tabular-nums text-muted-foreground">{shown}/100</span>}
            </div>
            {hasAudit && audit.summary && (
              <p className="mt-1.5 text-2xs leading-snug text-muted-foreground">{audit.summary}</p>
            )}
            {flags.length > 0 ? (
              <ul className="mt-2 space-y-2 border-t border-border/60 pt-2">
                {flags.map((f, i) => (
                  <li key={i} className="space-y-1">
                    <div className="flex items-center gap-1.5">
                      <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${SEVERITY_DOT[f.severity] || 'bg-muted-foreground'}`} />
                      <span className="text-2xs font-medium text-foreground">
                        {FLAG_LABELS[f.type] || f.type}
                      </span>
                    </div>
                    {f.excerpt && (
                      <p className="border-l-2 border-border pl-2 text-2xs italic text-foreground/70">“{f.excerpt}”</p>
                    )}
                    {f.issue && <p className="text-2xs text-muted-foreground">{f.issue}</p>}
                    {f.suggestion && (
                      <p className="text-2xs text-foreground/80">
                        <span className="font-medium">Suggestion:</span> {f.suggestion}
                      </p>
                    )}
                  </li>
                ))}
              </ul>
            ) : hasAudit ? (
              <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
                No drift flags — this reads like you.
              </p>
            ) : null}
            {sources && <WordSources sources={sources} whose={whose} />}
            <p className="mt-2.5 border-t border-border/60 pt-2 text-3xs text-muted-foreground">
              Bernard’s read, to inform your call. You decide with “Approve”.
            </p>
          </div>
        </>
      )}
    </div>
  )
}

// "Where the words came from" — the provenance split, as a bar plus labelled
// parts. Parts that don't add to 100 leave the rest of the bar grey rather
// than guessing where it came from (two real blogs sum to ~90%).
function WordSources({ sources, whose }) {
  const parts = [
    { key: 'said', pct: sources.asSaid, label: `${whose} words, as said`, color: 'bg-primary' },
    { key: 'reworded', pct: sources.reworded, label: `${whose} words, reworded`, color: 'bg-primary/45' },
    { key: 'bernard', pct: sources.bernard, label: 'written by Bernard', color: 'bg-warning' },
  ].filter((p) => p.pct > 0)
  return (
    <div className="mt-2 space-y-1.5 border-t border-border/60 pt-2">
      <p className="text-2xs font-semibold text-foreground">Where the words came from</p>
      <div className="flex h-2 overflow-hidden rounded-full bg-muted" aria-hidden="true">
        {parts.map((p) => <span key={p.key} className={p.color} style={{ width: `${Math.min(p.pct, 100)}%` }} />)}
      </div>
      <ul className="space-y-0.5">
        {parts.map((p) => (
          <li key={p.key} className="flex items-center gap-1.5 text-2xs text-foreground/80">
            <span className={`h-1.5 w-1.5 shrink-0 rounded-full ${p.color}`} />
            {p.pct}% {p.label}
          </li>
        ))}
      </ul>
      {sources.phrases > 0 && (
        <p className="text-2xs text-muted-foreground">
          {sources.phrases} of {whose} exact phrase{sources.phrases === 1 ? '' : 's'} kept
        </p>
      )}
      {sources.prior > 0 && <p className="text-2xs text-muted-foreground">{sources.prior}% drew on earlier work</p>}
      {sources.echoes > 0 && (
        <p className="text-2xs text-muted-foreground">
          {sources.echoes} phrase{sources.echoes === 1 ? '' : 's'} echo earlier work
        </p>
      )}
    </div>
  )
}
