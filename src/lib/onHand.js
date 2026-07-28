// On-hand runway display rules (Moments IA ②/⑤ — mockup §02/§04, verbatim
// from .claude/moment-ia-build-plan.md; do not improvise):
//   quiet ≥ 4 wks · amber < 4 · red < 1 · "Not started" is ALWAYS quiet
//   (never an alarm before the first capture). Runway is ONE number.
//
// `summary` is the GET /api/moments/summary payload.

export function onHandChipState(summary) {
  if (!summary) return null
  if (!summary.started) return { label: 'On hand · Not started', tone: 'quiet' }
  const wks = summary.runwayWeeks
  // Started but no weekly slot demand configured — runway is undefined, so
  // show the plain count, quietly (nothing to alarm about without a cadence).
  if (wks == null) return { label: `On hand · ${summary.usable ?? 0}`, tone: 'quiet' }
  if (wks < 1) return { label: 'On hand · < 1 wk', tone: 'red' }
  const approx = Math.max(1, Math.round(wks))
  return {
    label: `On hand · ~${approx} wk${approx === 1 ? '' : 's'}`,
    tone: wks < 4 ? 'amber' : 'quiet',
  }
}
