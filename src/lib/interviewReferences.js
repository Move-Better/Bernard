// @ts-check
import { apiFetch } from '@/lib/api'

/**
 * @param {{ topicId?: string, interviewId?: string }} args
 * @returns {Promise<unknown>}
 */
export function fetchReferences({ topicId, interviewId }) {
  const params = new URLSearchParams()
  if (topicId) params.set('topicId', topicId)
  if (interviewId) params.set('interviewId', interviewId)
  return apiFetch(`/api/interview-references?${params.toString()}`)
}

/** @param {Record<string, unknown>} payload @returns {Promise<unknown>} */
export function createReference(payload) {
  return apiFetch('/api/interview-references', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(payload),
  })
}

/** @param {string} id @param {Record<string, unknown>} patch @returns {Promise<unknown>} */
export function updateReference(id, patch) {
  return apiFetch(`/api/interview-references?id=${encodeURIComponent(id)}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(patch),
  })
}

/** @param {string} id @returns {Promise<unknown>} */
export function deleteReference(id) {
  return apiFetch(`/api/interview-references?id=${encodeURIComponent(id)}`, { method: 'DELETE' })
}
