import { useState } from 'react'
import { ShieldCheck, AlertTriangle } from 'lucide-react'
import { Tooltip, TooltipTrigger, TooltipContent } from '@/components/ui/tooltip'

// SafetyChip — Phase 2b of "Make a point" (.claude/make-a-point-spec.md).
//
// Sibling to VoiceChip, same header, same passive click-to-expand shape —
// but a DIFFERENT judgment: does this long-form point-content draft hold the
// non-diagnostic framing (a hedged mechanism is fine and expected; an
// asserted-as-fact mechanism or reader-directed instruction is not)? Voice
// fidelity asks "does it sound like you"; this asks "did it overclaim." Two
// independent axes, two independent chips, two independent columns
// (point_safety_score / point_safety_audit — never voice_audit).
//
// Only ever renders for content generated from a kind='point' interview —
// every other piece (the overwhelming majority) shows nothing, matching how
// VoiceChip shows nothing before its own audit lands. Gate-based, not
// score-tier-based (mirrors AnswerReview.jsx's VoiceCheckChip, F16's
// advisory-surface precedent): quiet when passed, amber when held. No
// "unscored" state — deliberately not built beyond what the signed-off
// mockup (.claude/mockups/safety-chip.html) showed; a failed/incomplete
// check renders nothing, same as "not applicable".
export default function SafetyChip({ piece }) {
  const [open, setOpen] = useState(false)
  const isPoint = piece?.interview?.kind === 'point'
  const audit = piece?.point_safety_audit

  if (!isPoint || !audit || (audit.gate !== 'passed' && audit.gate !== 'held')) return null

  const held = audit.gate === 'held'
  const score = piece?.point_safety_score
  const Icon = held ? AlertTriangle : ShieldCheck
  const tone = held
    ? { border: 'border-action/30', bg: 'bg-action/15', text: 'text-action' }
    : { border: 'border-success/25', bg: 'bg-success/10', text: 'text-success' }

  return (
    <div className="relative">
      <Tooltip>
        <TooltipTrigger asChild>
          <button
            type="button"
            onClick={() => setOpen((v) => !v)}
            className={`inline-flex items-center gap-1.5 rounded-full border ${tone.border} ${tone.bg} px-2.5 py-1 ${tone.text}`}
            aria-expanded={open}
          >
            <Icon className="h-3.5 w-3.5 shrink-0" />
            <span className="hidden text-2xs font-semibold sm:inline">Safety check</span>
            {typeof score === 'number' && <span className="text-2xs font-bold tabular-nums">{score}</span>}
          </button>
        </TooltipTrigger>
        <TooltipContent className="max-w-[240px] text-center leading-snug">
          {held
            ? 'The safety check flagged this — you can still publish it. Click for details.'
            : 'Checked for an overclaimed mechanism or reader-directed instruction. Click for details.'}
        </TooltipContent>
      </Tooltip>

      {open && (
        <>
          <button
            type="button"
            aria-label="Close"
            className="fixed inset-0 z-40 cursor-default"
            onClick={() => setOpen(false)}
          />
          <div className="absolute right-0 z-50 mt-2 w-72 rounded-xl border border-border bg-popover p-3 text-popover-foreground shadow-lg">
            <div className="flex items-center gap-2">
              <Icon className={`h-4 w-4 ${tone.text}`} />
              <span className={`text-sm font-semibold ${tone.text}`}>
                {held ? 'Safety check flagged this — your call' : 'Safety check passed'}
              </span>
              {typeof score === 'number' && (
                <span className="ml-auto text-sm font-bold tabular-nums text-muted-foreground">{score}/100</span>
              )}
            </div>
            {held && audit.red_flag && audit.red_flag !== 'none' && (
              <p className="mt-2 border-t border-border/60 pt-2 text-2xs text-foreground">
                <span className="font-semibold">What it flagged:</span> &ldquo;{audit.red_flag}&rdquo;
              </p>
            )}
            <p className="mt-2.5 border-t border-border/60 pt-2 text-3xs text-muted-foreground">
              Checks for a mechanism stated as fact (a hedged one is fine) or reader-directed
              instruction. Advisory only — you decide with &ldquo;Approve&rdquo;.
            </p>
          </div>
        </>
      )}
    </div>
  )
}
