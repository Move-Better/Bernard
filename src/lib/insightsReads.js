// Insights advisor — deterministic, grounded "reads" derived from REAL workspace
// data (published pieces + engagement snapshots). No fabrication: every read is
// computed from counted facts, and when there isn't enough signal we say so
// rather than inventing a trend. The plain-language phrasing is the product —
// Narrate acting like a content expert — but the claims are all real.
//
// Phase 1 is intentionally rule-based (no model call): it's instant, free, and
// can't hallucinate a number. An LLM-polish pass can layer on later without
// changing these facts.

const DAY = 24 * 60 * 60 * 1000
const WEEK = 7 * DAY

const reachOf = (p) => Number(p?.reach ?? p?.pageviews ?? 0)
const norm = (s) => (s || '').trim().toLowerCase()

// Sum a numeric field across performers, ignoring missing values.
export function sumField(performers = [], field) {
  return performers.reduce((a, p) => a + (Number(p?.[field]) || 0), 0)
}

// Total social reach across the ranked performers we have data for.
export function totalReach(performers = []) {
  return performers.reduce((a, p) => a + reachOf(p), 0)
}

// Derive up to 3 plain-language reads + the underlying facts.
// inputs: { stories: Story[], performers: Performer[] }
export function deriveInsights({ stories = [], performers = [] } = {}) {
  const now = Date.now()

  const pieces = stories.flatMap((s) => s.pieces || [])
  const published = pieces.filter((p) => p.status === 'published' && p.published_at)

  const inWindow = (ts, lo, hi) => {
    const t = new Date(ts).getTime()
    if (Number.isNaN(t)) return false
    const age = now - t
    return age >= lo && age < hi
  }
  const thisWeek = published.filter((p) => inWindow(p.published_at, 0, WEEK)).length
  const lastWeek = published.filter((p) => inWindow(p.published_at, WEEK, 2 * WEEK)).length

  // Days since the most recent capture (story created_at is the capture event).
  let lastCapture = null
  for (const s of stories) {
    const t = new Date(s.created_at).getTime()
    if (!Number.isNaN(t) && (lastCapture == null || t > lastCapture)) lastCapture = t
  }
  const daysSinceCapture = lastCapture == null ? null : Math.floor((now - lastCapture) / DAY)

  // Standout topic: a topic whose average reach clearly leads the rest. Needs
  // enough performers to be meaningful (>=3 with real reach, >=1 outside the
  // leading topic) and at least ~1.8x to call it a standout.
  const withReach = performers.filter((p) => reachOf(p) > 0)
  let standout = null
  if (withReach.length >= 3) {
    const groups = new Map()
    for (const p of withReach) {
      const key = norm(p.topic)
      if (!key) continue
      const g = groups.get(key) || { topic: p.topic, items: [] }
      g.items.push(p)
      groups.set(key, g)
    }
    let best = null
    for (const g of groups.values()) {
      g.avg = g.items.reduce((a, p) => a + reachOf(p), 0) / g.items.length
      if (!best || g.avg > best.avg) best = g
    }
    if (best) {
      const others = withReach.filter((p) => norm(p.topic) !== norm(best.topic))
      if (others.length) {
        const otherAvg = others.reduce((a, p) => a + reachOf(p), 0) / others.length
        const mult = otherAvg > 0 ? best.avg / otherAvg : null
        if (mult && mult >= 1.8) standout = { topic: best.topic, mult: Math.round(mult) }
      }
    }
  }

  const reads = []

  if (standout) {
    reads.push({
      id: 'standout',
      tone: 'good',
      icon: 'trending-up',
      title: `Your "${standout.topic}" posts are your standouts.`,
      body: `They've pulled about ${standout.mult}× the reach of your other posts. People clearly want more of this — lean in.`,
      action: { label: 'Capture more like these', to: '/new', icon: 'mic' },
    })
  }

  if (daysSinceCapture != null && daysSinceCapture >= 7) {
    reads.push({
      id: 'gap',
      tone: 'warn',
      icon: 'calendar-clock',
      title: `It's been ${daysSinceCapture} days since anyone captured a story.`,
      body: `Your steadiest weeks have a post every few days — a 2-minute capture keeps the momentum going.`,
      action: { label: 'Record a quick voice memo', to: '/new/voice-memo', icon: 'mic' },
    })
  }

  if (thisWeek > 0 && reads.length < 3) {
    const delta = thisWeek - lastWeek
    if (delta > 0) {
      reads.push({
        id: 'momentum',
        tone: 'good',
        icon: 'activity',
        title: `You published ${thisWeek} ${thisWeek === 1 ? 'post' : 'posts'} this week — up ${delta} from last week.`,
        body: `Good momentum. Consistency is what compounds reach over time.`,
        action: null,
      })
    }
  }

  if (reads.length === 0) {
    reads.push({
      id: 'empty',
      tone: 'muted',
      icon: 'sparkles',
      title: `Not enough signal yet to call a trend.`,
      body: `Once a few more posts are live and their numbers settle, this fills in with what's working and what to do next.`,
      action: null,
    })
  }

  return {
    reads: reads.slice(0, 3),
    facts: {
      thisWeek,
      lastWeek,
      publishedDelta: thisWeek - lastWeek,
      daysSinceCapture,
      hasReachData: withReach.length > 0,
    },
  }
}
