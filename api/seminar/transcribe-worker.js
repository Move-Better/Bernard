// POST /api/seminar/transcribe-worker
//
// Internal continuation endpoint for the Seminar / Talk capture lane. The
// /api/seminar/create handler kicks this off after creating the interview row,
// so the (long, chunked) transcription runs on a FRESH function instance with
// its own 300s budget rather than blocking the user-facing request.
//
// It schedules the work via waitUntil and returns 202 immediately, so the
// caller's kickoff fetch resolves fast and the create request returns to the
// browser without waiting on transcription.
//
// Auth: Bearer CRON_SECRET (same shared service-role secret as the cron + the
// longform worker). Never call from the browser.
//
// Body: { interviewId: string }
// Responses: 202 { ok: true } | 400 | 401 | 405 | 503

export const config = { runtime: 'nodejs', maxDuration: 300 }

import { waitUntil } from '@vercel/functions'
import { transcribeSeminar } from '../_lib/seminarTranscribe.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    return res.status(405).json({ error: 'method_not_allowed' })
  }

  const cronSecret = process.env.CRON_SECRET
  if (!cronSecret) return res.status(503).json({ error: 'CRON_SECRET not configured' })
  if (req.headers?.authorization !== `Bearer ${cronSecret}`) {
    return res.status(401).json({ error: 'unauthorized' })
  }

  const body = req.body || {}
  const interviewId = body.interviewId ? String(body.interviewId) : ''
  if (!interviewId) return res.status(400).json({ error: 'interviewId_required' })

  waitUntil(transcribeSeminar({ interviewId }))

  return res.status(202).json({ ok: true })
}
