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

/**
 * Render ONE ad aspect of a video clip from the source, using the clip window.
 * Each call is a full ffmpeg re-encode, so the client renders selected aspects
 * one at a time (no free 4-pack).
 * @param {{ assetId: string, aspect: string, startSec?: number, durationSec?: number, captionText?: string, overlayPosition?: string, overlaySize?: string }} params
 * @returns {Promise<{ aspect: string, url: string, width: number, height: number }>}
 */
export function renderAdVideo({ assetId, aspect, startSec, durationSec, captionText, overlayPosition, overlaySize }) {
  return /** @type {any} */ (apiFetch('/api/ads/render-video', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ assetId, aspect, startSec, durationSec, captionText, overlayPosition, overlaySize }),
  }))
}
