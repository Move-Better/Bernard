// The Standing Producer's per-workspace config helpers (Phase 3+).
//
// `workspaces.producer_config` is free-shape JSONB (migration 155, no CHECK).
// Through Phases 0–2A it was effectively `{ enabled: bool, paused_at, ... }` and
// every reader treated a missing key as its default. Phase 3 introduces PER-LANE
// gating so an owner can turn individual behaviors on/off without a schema change.
//
// BACKWARD COMPATIBILITY is the whole point of the LANE_DEFAULTS map: a workspace
// whose config is just `{ enabled: true }` (no `lanes` object) keeps its exact
// prior behavior — revise + auto-repair ON (they default true), pre-draft OFF
// (it defaults false, so no existing workspace starts pre-drafting until a human
// explicitly opts in). New lanes are added default-OFF unless they mirror an
// already-live behavior.
//
// Documented config shape (all optional; code applies defaults):
//   { enabled: bool,              -- master switch (default false)
//     enabled_at: timestamptz,    -- when hired
//     paused_at: timestamptz,     -- pause without un-hiring (producerActive → false)
//     daily_ai_call_cap: int,     -- daily AI-action cap (default 40; agent-tick
//                                    enforces it, the control panel writes it)
//     max_items_per_tick: int,    -- work-per-tick guardrail (default 3)
//     lanes: {                    -- per-behavior gates (see LANE_DEFAULTS)
//       answer_change_requests: bool,  -- P1  (default true)
//       auto_repair_captions:   bool,  -- P2A.2 (default true)
//       pre_draft_week:         bool,  -- P3  (default FALSE — opt-in)
//       escalation_email:       bool,  -- P4  (default true; NO sender wired yet)
//     } }
//
// PURE: no env reads, no network, no side effects. Safe to import anywhere.

// Per-lane defaults applied when producer_config.lanes[<lane>] is undefined.
// Lanes that mirror an ALREADY-LIVE behavior default true (so an existing
// `{enabled:true}` workspace is unchanged); genuinely-new autonomy defaults false.
export const LANE_DEFAULTS = {
  answer_change_requests: true,   // P1  — revise agent (already live when enabled)
  auto_repair_captions:   true,   // P2A.2 — held-caption repair (already live when enabled)
  pre_draft_week:         false,  // P3  — pre-draft the week: OPT-IN, default OFF
  escalation_email:       true,   // P4  — surfacing default-on; NO email sender exists yet
}

/**
 * The producer is "active" on a workspace when it's been hired AND not paused.
 * This is the master gate every entry point (tick, sensors, lanes) checks first.
 * Pause ≠ disable: a paused workspace keeps its config/enabled, so resume drains
 * whatever queued while paused.
 *
 * @param {object|null|undefined} config  workspaces.producer_config
 * @returns {boolean}
 */
export function producerActive(config) {
  return !!config?.enabled && !config?.paused_at
}

/**
 * Whether a specific lane is enabled for a workspace. False whenever the producer
 * itself is inactive (disabled or paused), regardless of the lane setting — so a
 * paused producer runs no lanes. When active, an explicit `lanes[<lane>]` wins;
 * otherwise the LANE_DEFAULTS value applies (undefined lane → its default).
 *
 * @param {object|null|undefined} config  workspaces.producer_config
 * @param {string} lane                    key in LANE_DEFAULTS
 * @returns {boolean}
 */
export function laneEnabled(config, lane) {
  if (!producerActive(config)) return false
  const v = config?.lanes?.[lane]
  return v === undefined ? (LANE_DEFAULTS[lane] ?? false) : !!v
}
