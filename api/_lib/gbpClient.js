// Google Business Profile API client — read-only data access.
//
// Three APIs used here:
//  1. Business Profile Performance API (v1) — location-level daily metrics:
//     impressions (Maps + Search), direction requests, call clicks, website clicks.
//  2. My Business Account Management API (v1) — verify location access.
//  3. My Business API (v4, legacy) — list localPosts and reportInsights for
//     per-post view counts. v4 is still the only path for localPosts data.
//
// All functions take a fresh access token — callers are responsible for
// refreshing via gbpAuth.refreshGbpToken() before calling.

// Daily metric keys to request from the Performance API.
const DAILY_METRICS = [
  'BUSINESS_IMPRESSIONS_MOBILE_MAPS',
  'BUSINESS_IMPRESSIONS_DESKTOP_MAPS',
  'BUSINESS_IMPRESSIONS_MOBILE_SEARCH',
  'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH',
  'BUSINESS_DIRECTION_REQUESTS',
  'CALL_CLICKS',
  'BUSINESS_WEBSITE_CLICKS',
]

// Fetch 30-day daily metric time series for a GBP location.
// locationName: "locations/{locationId}" (v1 format).
// Returns { dailySeries: [{date, impressions, directionRequests, callClicks, websiteClicks}],
//           totals: { impressions, mapImpressions, searchImpressions, directionRequests, callClicks, websiteClicks } }
export async function fetchLocationMetrics(accessToken, locationName, days = 30) {
  const end   = new Date()
  const start = new Date(end.getTime() - days * 24 * 60 * 60 * 1000)

  const fmt  = (d) => ({ year: d.getUTCFullYear(), month: d.getUTCMonth() + 1, day: d.getUTCDate() })
  const s    = fmt(start)
  const e    = fmt(end)

  // Build query params: each dailyMetrics= repeated, plus date range
  const params = new URLSearchParams()
  for (const m of DAILY_METRICS) params.append('dailyMetrics', m)
  params.set('dailyRange.startDate.year',  String(s.year))
  params.set('dailyRange.startDate.month', String(s.month))
  params.set('dailyRange.startDate.day',   String(s.day))
  params.set('dailyRange.endDate.year',    String(e.year))
  params.set('dailyRange.endDate.month',   String(e.month))
  params.set('dailyRange.endDate.day',     String(e.day))

  const url = `https://businessprofileperformance.googleapis.com/v1/${locationName}:getMultiDailyMetricsTimeSeries?${params.toString()}`
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`GBP Performance API ${r.status}: ${text.slice(0, 300)}`)
  }
  const data = await r.json().catch(() => null)

  // Build a day-keyed map from each metric's time series
  // { "2024-01-15": { METRIC_KEY: value } }
  const dayMap = {}
  const series = Array.isArray(data?.multiDailyMetricTimeSeries) ? data.multiDailyMetricTimeSeries : []
  for (const s of series) {
    const metric = s.dailyMetric
    const values = s.timeSeries?.datedValues || []
    for (const dv of values) {
      if (!dv?.date) continue
      const dateKey = `${dv.date.year}-${String(dv.date.month).padStart(2,'0')}-${String(dv.date.day).padStart(2,'0')}`
      if (!dayMap[dateKey]) dayMap[dateKey] = {}
      dayMap[dateKey][metric] = typeof dv.value === 'number' ? dv.value : (Number(dv.value) || 0)
    }
  }

  const num = (obj, key) => (typeof obj?.[key] === 'number' ? obj[key] : 0)
  const totals = { impressions: 0, mapImpressions: 0, searchImpressions: 0, directionRequests: 0, callClicks: 0, websiteClicks: 0 }

  const dailySeries = Object.entries(dayMap)
    .sort(([a], [b]) => a.localeCompare(b))
    .map(([date, d]) => {
      const mobileSearch  = num(d, 'BUSINESS_IMPRESSIONS_MOBILE_SEARCH')
      const desktopSearch = num(d, 'BUSINESS_IMPRESSIONS_DESKTOP_SEARCH')
      const mobileMaps    = num(d, 'BUSINESS_IMPRESSIONS_MOBILE_MAPS')
      const desktopMaps   = num(d, 'BUSINESS_IMPRESSIONS_DESKTOP_MAPS')
      const imp      = mobileSearch + desktopSearch + mobileMaps + desktopMaps
      const mapImp   = mobileMaps + desktopMaps
      const srchImp  = mobileSearch + desktopSearch
      const dirReq   = num(d, 'BUSINESS_DIRECTION_REQUESTS')
      const calls    = num(d, 'CALL_CLICKS')
      const website  = num(d, 'BUSINESS_WEBSITE_CLICKS')

      totals.impressions       += imp
      totals.mapImpressions    += mapImp
      totals.searchImpressions += srchImp
      totals.directionRequests += dirReq
      totals.callClicks        += calls
      totals.websiteClicks     += website

      return { date, impressions: imp, mapImpressions: mapImp, searchImpressions: srchImp, directionRequests: dirReq, callClicks: calls, websiteClicks: website }
    })

  return { dailySeries, totals }
}

// List recent local posts for a location (My Business v4 API).
// v4LocationName: "accounts/{accountId}/locations/{locationId}"
// Returns array of { name, summary, state, createTime, updateTime }
export async function listLocalPosts(accessToken, v4LocationName, maxResults = 50) {
  const url = `https://mybusiness.googleapis.com/v4/${v4LocationName}/localPosts?pageSize=${maxResults}`
  const r = await fetch(url, { signal: AbortSignal.timeout(30_000), headers: { Authorization: `Bearer ${accessToken}` } })
  if (!r.ok) {
    const text = await r.text().catch(() => '')
    throw new Error(`GBP localPosts list ${r.status}: ${text.slice(0, 300)}`)
  }
  const data = await r.json().catch(() => null)
  return Array.isArray(data?.localPosts) ? data.localPosts : []
}

// Fetch per-post view counts for a batch of local posts (My Business v4 reportInsights).
// v4LocationName: "accounts/{accountId}/locations/{locationId}"
// localPostNames: array of full resource names like "accounts/.../localPosts/{postId}"
// Returns { [localPostName]: { views: N, actions: N } }
// Batches automatically in groups of 10 (API limit).
export async function fetchPostViewInsights(accessToken, v4LocationName, localPostNames, days = 90) {
  if (!localPostNames?.length) return {}

  const endTime   = new Date().toISOString()
  const startTime = new Date(Date.now() - days * 24 * 60 * 60 * 1000).toISOString()

  const results = {}
  const BATCH = 10
  for (let i = 0; i < localPostNames.length; i += BATCH) {
    const batch = localPostNames.slice(i, i + BATCH)
    const body = JSON.stringify({
      localPostNames: batch,
      basicRequest: {
        metricRequests: [
          { metric: 'LOCAL_POST_VIEWS_SEARCH' },
          { metric: 'LOCAL_POST_ACTIONS_CALL_TO_ACTION' },
        ],
        timeRange: { startTime, endTime },
      },
    })
    const r = await fetch(
      `https://mybusiness.googleapis.com/v4/${v4LocationName}/localPosts:reportInsights`,
      { signal: AbortSignal.timeout(30_000), method: 'POST', headers: { Authorization: `Bearer ${accessToken}`, 'Content-Type': 'application/json' }, body },
    )
    if (!r.ok) {
      const text = await r.text().catch(() => '')
      console.warn('[gbpClient] reportInsights failed:', r.status, text.slice(0, 200))
      continue
    }
    const data = await r.json().catch(() => null)
    for (const pm of (data?.localPostMetrics || [])) {
      const name   = pm.localPostName
      let views    = 0
      let actions  = 0
      for (const mv of (pm.metricValues || [])) {
        const val = Number(mv?.totalValue?.value) || 0
        if (mv.metric === 'LOCAL_POST_VIEWS_SEARCH')           views   += val
        if (mv.metric === 'LOCAL_POST_ACTIONS_CALL_TO_ACTION') actions += val
      }
      results[name] = { views, actions }
    }
  }
  return results
}
