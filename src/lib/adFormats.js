// @ts-check
// Ad-size matrix shared by the ad-export modal. Each entry maps an aspect ratio
// to its pixel size and the platforms that use it, so the UI can label sizes by
// where they're spent. Keep in sync with EDITORIAL_ASPECTS / WHOOP_ASPECTS in
// api/_lib/brandRender.js + api/_lib/whoopTemplates.js (the render side).
//
// Note: Google Local Services Ads (LSAs) need no creative — they're assembled
// from the Google Business Profile — so there's intentionally no LSA size here.

export const AD_FORMATS = [
  { aspect: '1:1',  w: 1080, h: 1080, px: '1080²',     platforms: 'Meta feed, LinkedIn' },
  { aspect: '4:5',  w: 1080, h: 1350, px: '1080×1350', platforms: 'Meta feed (best)' },
  { aspect: '9:16', w: 1080, h: 1920, px: '1080×1920', platforms: 'Stories, Reels, TikTok, Shorts' },
  { aspect: '16:9', w: 1920, h: 1080, px: '1920×1080', platforms: 'YouTube, Google Display' },
]

export const AD_ASPECTS = AD_FORMATS.map((f) => f.aspect)
