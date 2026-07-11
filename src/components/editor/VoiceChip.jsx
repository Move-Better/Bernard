import { useState } from 'react'
import { ShieldCheck, AlertTriangle, ChevronDown } from 'lucide-react'
import { scoreTier, FLAG_LABELS, SEVERITY_DOT, VOICE_FIDELITY_TOOLTIP } from '@/lib/voiceFidelity'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// VoiceChip — the compact, header-sized voice-fidelity read for the editor.
//
// Passive by design (Q, 2026-07-08): it shows Bernard's score + tier and, on
// click, the drift flags — it INFORMS the "Sounds like me" call, it does not
// act (no regenerate/rewrite). Same data source as the full VoiceFidelityBadge
// (piece.voice_fidelity_score + piece.voice_audit); shares scoreTier so the two
// never drift. Renders nothing until an audit lands — matches the badge, so the
// fire-and-forget pass never leaves a visible "pending" stub in the header.

export default function VoiceChip({ piece }) {
  const [open, setOpen] = useState(false)
  const audit = piece?.voice_audit
  const score = piece?.voice_fidelity_score

  if (!audit || audit.error) return null

  const shown = typeof score === 'number' ? score : (audit.score ?? 0)
  const tier = scoreTier(shown)
  const flags = Array.isArray(audit.flags) ? audit.flags : []
  const Icon = tier.iconName === 'shield' ? ShieldCheck : AlertTriangle

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border ${tier.border} ${tier.bg} px-2.5 py-1 ${tier.text}`}
            aria-expanded={open}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden text-2xs font-semibold sm:inline">Sounds like you</span>
            <span className="text-2xs font-bold tabular-nums">{shown}</span>
            {flags.length > 0 && (
              <ChevronDown className={`h-3 w-3 opacity-70 transition-transform ${open ? 'rotate-180' : ''}`} />
            )}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-center leading-snug">
          {VOICE_FIDELITY_TOOLTIP} Click for details.
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
              <span className="ml-auto text-sm font-bold tabular-nums text-muted-foreground">{shown}/100</span>
            </div>
            {audit.summary && (
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
            ) : (
              <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-muted-foreground">
                No drift flags — this reads like you.
              </p>
            )}
            <p className="mt-2.5 border-t border-border/60 pt-2 text-3xs text-muted-foreground">
              Bernard’s read, to inform your call. You decide with “Approve”.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
