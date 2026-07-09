import { apiFetch } from './api'

// Editor version history (WS5). subjectType: 'video' | 'slides'; subjectId: the
// asset / content-item uuid; doc: the editor draft snapshot.
export function listRevisions(subjectType, subjectId) {
  return apiFetch(`/api/editorial/revisions?subjectType=${subjectType}&subjectId=${subjectId}`)
}

export function saveRevision(subjectType, subjectId, doc, label) {
  return apiFetch('/api/editorial/revisions', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ subjectType, subjectId, doc, label }),
  })
}
