// @ts-check
// Client wrapper for the ad-creative export endpoints.

import { apiFetch } from './api.js'

/**
 * Render a source photo into a set of ad aspect ratios. Returns the uploaded
 * JPEG URLs (read-only against the source — does not mutate any content piece).
 * @param {{ sourceUrl: string, aspects?: string[], treatment?: object, templateId?: string }} params
 * @returns {Promise<{ files: Array<{ aspect: string, url: string, width: number, height: number }> }>}
 */
export function renderAdPack({ sourceUrl, aspects, treatment, templateId }) {
  return /** @type {any} */ (apiFetch('/api/ads/render-pack', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ sourceUrl, aspects, treatment, templateId }),
  }))
}
