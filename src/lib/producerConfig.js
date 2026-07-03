// Client mirror of the Standing Producer's per-workspace config.
//
// Server source of truth is api/_lib/producer/config.js (built alongside the
// P3/P4 backend). These two files must agree on lane keys + defaults — they're
// kept in sync by hand. Drives the control panel (/producer/settings) and the
// pre-drafted-week banner on /week.
//
// Config shape (JSONB on workspaces.producer_config):
//   { enabled, paused_at, daily_spend_cap, lanes: { <laneKey>: boolean } }

// Each lane is an autonomous behavior the owner can independently allow. Lanes
// default ON when the producer is enabled EXCEPT pre_draft_week, which is
// explicitly opt-in — hiring Bernard never silently starts drafting the week
// ahead until the owner asks for it.
export const LANE_DEFAULTS = {
  answer_change_requests: true,
  auto_repair_captions:   true,
  pre_draft_week:         false,
  escalation_email:       true,
}

// Control-panel metadata, in display order.
export const PRODUCER_LANES = [
  {
    key: 'answer_change_requests',
    label: 'Answer change requests',
    description: 'When you click “Request changes”, Bernard revises the draft in your voice and sends it back for review.',
  },
  {
    key: 'auto_repair_captions',
    label: 'Auto-repair drifted captions',
    description: 'If a short caption scores below the voice bar, Bernard takes one faithfulness pass to fix it — or flags it for you.',
  },
  {
    key: 'pre_draft_week',
    label: 'Pre-draft the week',
    description: 'Draft the upcoming week’s posts ahead of Monday, grounded and voice-checked, so Your Week opens ready to review.',
    isNew: true,
  },
  {
    key: 'escalation_email',
    label: 'Email me when something needs me',
    description: 'A single email only for things you must act on — a failed publish, a caption Bernard couldn’t fix, a gap he can’t fill. Never more than one a day.',
  },
]

export const SPEND_CAP_MIN = 10
export const SPEND_CAP_MAX = 120
export const SPEND_CAP_DEFAULT = 40

/** Is the producer actively working (enabled AND not paused)? */
export function producerActive(config) {
  return Boolean(config?.enabled) && !config?.paused_at
}

/**
 * A lane's raw configured value (ignoring pause) — for the control-panel toggle.
 * @param {object} config @param {string} lane
 */
export function laneValue(config, lane) {
  const v = config?.lanes?.[lane]
  return v === undefined ? Boolean(LANE_DEFAULTS[lane]) : Boolean(v)
}

/**
 * A lane's effective on/off state, honoring defaults AND pause — mirrors the
 * server's laneEnabled() so the UI shows what Bernard would actually do.
 * @param {object} config @param {string} lane
 */
export function laneEnabled(config, lane) {
  if (!producerActive(config)) return false
  return laneValue(config, lane)
}

/** Clamp a spend-cap number to the allowed range. */
export function clampSpendCap(n) {
  const v = Math.round(Number(n))
  if (!Number.isFinite(v)) return SPEND_CAP_DEFAULT
  return Math.min(SPEND_CAP_MAX, Math.max(SPEND_CAP_MIN, v))
}

/** Build the full config object to persist, from the current config + a change. */
export function withProducerChange(config, change) {
  const base = config && typeof config === 'object' ? config : {}
  return {
    enabled: Boolean(base.enabled),
    paused_at: base.paused_at ?? null,
    daily_spend_cap: clampSpendCap(base.daily_spend_cap ?? SPEND_CAP_DEFAULT),
    lanes: { ...(base.lanes || {}) },
    ...change,
    ...(change.lanes ? { lanes: { ...(base.lanes || {}), ...change.lanes } } : {}),
  }
}
