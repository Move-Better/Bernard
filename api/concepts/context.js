// GET /api/concepts/context?topic=<str>
//
// Returns top workspace concepts as a formatted block + raw array for the
// active workspace. Called once by InterviewSession at session start so the
// client can inject learned practice knowledge into the interview system prompt.
//
// ?topic= narrows results to concepts relevant to the interview topic (optional).
export const config = { runtime: 'nodejs' }

import { workspaceContext } from '../_lib/workspaceContext.js'
import { getContextBlock, getRawConcepts } from '../_lib/conceptRetrieval.js'

export default async function handler(req, res) {
  if (req.method !== 'GET') return res.status(405).json({ error: 'Method not allowed' })

  const ws = await workspaceContext(req)
  if (!ws) return res.status(400).json({ error: 'Workspace not resolved' })

  const { searchParams } = new URL(req.url, 'http://localhost')
  const topic = searchParams.get('topic') || null

  const [block, concepts] = await Promise.all([
    getContextBlock({ workspaceId: ws.id, topic }),
    getRawConcepts({ workspaceId: ws.id, topic, limit: 20 }),
  ])

  return res.status(200).json({ block, concepts })
}
