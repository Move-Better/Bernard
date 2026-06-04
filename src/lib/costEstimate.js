// Operational run-cost estimator for the Overview weekly recap.
//
// IMPORTANT: these are ESTIMATES, not billed cost. We multiply genuinely
// COUNTED usage units (from the workspace_recap SQL function — audio seconds
// transcribed, realtime voice seconds, video seconds encoded, content pieces
// generated) by a published provider rate card. The only non-counted unit is
// AI-writing tokens (we don't persist per-generation token counts), so that
// line uses a flat per-piece estimate. Everything is labeled "estimate" in the
// UI. Excludes flat subscriptions (Buffer, hosting) — this is marginal compute.
//
// Rates live here (not in SQL) so they can be tuned without a migration. Keep
// them conservative and update as provider pricing changes.

// USD rate card (provider list prices, rounded conservatively).
export const RATES = {
  transcribePerSec: 0.006 / 60,   // Whisper $0.006/min
  voicePerSec:      0.003,        // ElevenLabs ~$0.18/1k chars ≈ ~15 chars/sec
  videoPerSec:      0.04 / 60,    // Mux-class encode ~$0.04/min (blended)
  perPiece:         0.04,         // AI writing: flat per generated piece (no token log)
}

const EMPTY = { pieces: 0, transcribe_sec: 0, voice_sec: 0, video_sec: 0 }

// Convert one window's counted units → a dollar breakdown + total.
export function estimateWindow(units = EMPTY) {
  const u = { ...EMPTY, ...(units || {}) }
  const lines = {
    transcription: Number(u.transcribe_sec) * RATES.transcribePerSec,
    writing:       Number(u.pieces)         * RATES.perPiece,
    video:         Number(u.video_sec)      * RATES.videoPerSec,
    voice:         Number(u.voice_sec)      * RATES.voicePerSec,
  }
  const total = lines.transcription + lines.writing + lines.video + lines.voice
  return { lines, total }
}

// Whole-recap cost view: per-window totals + this-week line breakdown + WoW.
export function buildCostView(cost = {}) {
  const week = estimateWindow(cost.this_week)
  const prev = estimateWindow(cost.prev_week)
  const mtd  = estimateWindow(cost.mtd)
  const ytd  = estimateWindow(cost.ytd)
  const all  = estimateWindow(cost.all)

  let wowPct = null
  if (prev.total > 0) wowPct = Math.round(((week.total - prev.total) / prev.total) * 100)

  const pieces = Number(cost?.this_week?.pieces) || 0
  const perPost = pieces > 0 ? week.total / pieces : null

  return {
    week,
    weekTotal: week.total,
    mtdTotal: mtd.total,
    ytdTotal: ytd.total,
    allTotal: all.total,
    wowPct,
    perPost,
    units: cost?.this_week || EMPTY,
  }
}

// Money formatter — sub-dollar amounts read better with cents.
export function fmtUsd(n) {
  const v = Number(n) || 0
  if (v > 0 && v < 0.01) return '<$0.01'
  return `$${v.toFixed(2)}`
}

// Round audio/video seconds → friendly minutes label.
export function fmtMinutes(sec) {
  const m = Math.round((Number(sec) || 0) / 60)
  return `${m} min`
}
