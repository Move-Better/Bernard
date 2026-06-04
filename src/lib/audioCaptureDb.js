// IndexedDB wrapper for crash-safe audio capture (P3 "bulletproof capture").
//
// Problem it solves: a MediaRecorder running in a browser tab holds its audio
// chunks in RAM until Stop fires. On iPhone, iOS can freeze/kill a backgrounded
// tab (phone call, screen lock, notification) before onstop runs — and the whole
// recording is lost with no trace. This store persists each MediaRecorder chunk
// to IndexedDB the instant it arrives, so a killed tab can recover everything up
// to the last flushed chunk on next open.
//
// Two object stores (kept separate from the media multipart store
// `narraterx-uploads` so the two systems never interfere):
//
//   sessions  keyPath 'id'
//     { id, status, source, mimeType, filename, durationSec, staffId,
//       interviewId, workspaceHost, chunkCount, createdAt, updatedAt }
//     status: 'recording' | 'stopped' | 'uploading' | 'failed'
//     source: 'voice_memo' | 'interview'
//
//   chunks    keyPath 'key' ('<sessionId>:<seq>'), index 'sessionId'
//     { key, sessionId, seq, blob }
//
// Per-chunk records mean appendChunk() is O(1) — a single put — rather than
// rewriting a growing blob array every few seconds (which would bog down a long
// recording on an old phone). Assembly reads all chunks for a session by index.
//
// Per-origin store → tenant-isolated (each <slug>.narraterx.ai subdomain sees
// only its own sessions). `workspaceHost` is recorded so a recovered session can
// be confined to the host it was captured on.

const DB_NAME  = 'narraterx-audio-capture'
const SESSIONS = 'sessions'
const CHUNKS    = 'chunks'
const VERSION  = 1

// Recovered sessions older than this are pruned (and offered no more) so the
// store can't grow without bound from abandoned captures.
export const STALE_MS = 7 * 24 * 60 * 60 * 1000 // 7 days

let _dbPromise = null

function openDb() {
  if (typeof indexedDB === 'undefined') {
    return Promise.reject(new Error('IndexedDB unavailable'))
  }
  if (_dbPromise) return _dbPromise
  _dbPromise = new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, VERSION)
    req.onupgradeneeded = () => {
      const db = req.result
      if (!db.objectStoreNames.contains(SESSIONS)) {
        const s = db.createObjectStore(SESSIONS, { keyPath: 'id' })
        s.createIndex('createdAt', 'createdAt', { unique: false })
      }
      if (!db.objectStoreNames.contains(CHUNKS)) {
        const c = db.createObjectStore(CHUNKS, { keyPath: 'key' })
        c.createIndex('sessionId', 'sessionId', { unique: false })
      }
    }
    req.onsuccess = () => resolve(req.result)
    req.onerror   = () => reject(req.error)
  })
  return _dbPromise
}

// Run a transaction over one or more stores.
//
// CRITICAL: `fn(stores, setResult)` MUST be synchronous and MUST chain any
// dependent IndexedDB requests via their `onsuccess` handlers — never via
// `await`. Safari < 15.4 (and the iOS 14.5–15.3 range that is the MediaRecorder
// minimum) uses the legacy IDB auto-commit model: a readwrite transaction
// commits as soon as the JS task stack unwinds with no pending request. An
// `await` between two requests yields a microtask boundary, the stack unwinds,
// the transaction commits, and every subsequent request throws
// `TransactionInactiveError`. Issuing the next request from inside the prior
// request's `onsuccess` keeps the transaction alive on every engine.
//
// `fn` reports its return value by calling `setResult(value)`; the promise
// resolves with that value once the transaction actually commits (oncomplete).
function runTx(storeNames, mode, fn) {
  const names = Array.isArray(storeNames) ? storeNames : [storeNames]
  return openDb().then(
    (db) => new Promise((resolve, reject) => {
      const t = db.transaction(names, mode)
      const stores = {}
      for (const n of names) stores[n] = t.objectStore(n)
      let result
      t.oncomplete = () => resolve(result)
      t.onerror    = () => reject(t.error)
      t.onabort    = () => reject(t.error || new Error('IDB transaction aborted'))
      try {
        fn(stores, (r) => { result = r })
      } catch (e) {
        try { t.abort() } catch { /* already inactive */ }
        reject(e)
      }
    }),
  )
}

/**
 * Create a new recording session. Call this when MediaRecorder.start() fires.
 * @returns {Promise<object>} the persisted session record
 */
export async function createSession({ id, source, mimeType, filename, staffId = null, interviewId = null }) {
  const now = Date.now()
  const record = {
    id,
    status: 'recording',
    source,
    mimeType: mimeType || 'audio/webm',
    filename: filename || `${source}-${id}.webm`,
    durationSec: 0,
    staffId,
    interviewId,
    workspaceHost: typeof window !== 'undefined' ? window.location.host : '',
    chunkCount: 0,
    createdAt: now,
    updatedAt: now,
  }
  await runTx(SESSIONS, 'readwrite', (s) => { s[SESSIONS].put(record) })
  return record
}

/**
 * Append one MediaRecorder chunk and bump the session's counters — a single
 * put per store inside one transaction, so it stays O(1) for long recordings.
 * Silently no-ops if the session was already deleted (e.g. discarded mid-flush).
 */
export async function appendChunk(sessionId, blob, { durationSec } = {}) {
  if (!blob || !blob.size) return
  // Single transaction, requests chained via onsuccess (no await between them)
  // so the tx stays active on Safari < 15.4's legacy auto-commit model.
  return runTx([SESSIONS, CHUNKS], 'readwrite', (s) => {
    const getReq = s[SESSIONS].get(sessionId)
    getReq.onsuccess = () => {
      const session = getReq.result
      if (!session) return // discarded — drop the chunk; tx still commits
      const seq = session.chunkCount
      s[CHUNKS].put({ key: `${sessionId}:${seq}`, sessionId, seq, blob })
      session.chunkCount = seq + 1
      if (typeof durationSec === 'number') session.durationSec = durationSec
      session.updatedAt = Date.now()
      s[SESSIONS].put(session)
    }
  })
}

/** Patch a subset of session fields (e.g. status transitions). */
export async function patchSession(sessionId, patch) {
  return runTx(SESSIONS, 'readwrite', (s, setResult) => {
    const getReq = s[SESSIONS].get(sessionId)
    getReq.onsuccess = () => {
      const existing = getReq.result
      if (!existing) { setResult(null); return }
      const next = { ...existing, ...patch, updatedAt: Date.now() }
      s[SESSIONS].put(next)
      setResult(next)
    }
  })
}

export async function getSession(sessionId) {
  return runTx(SESSIONS, 'readonly', (s, setResult) => {
    const req = s[SESSIONS].get(sessionId)
    req.onsuccess = () => setResult(req.result || null)
  })
}

export async function listSessions() {
  return runTx(SESSIONS, 'readonly', (s, setResult) => {
    const req = s[SESSIONS].getAll()
    req.onsuccess = () => setResult(req.result || [])
  })
}

/**
 * Reassemble a session's audio into a single Blob from its persisted chunks,
 * ordered by sequence. Returns null if there are no chunks.
 */
export async function assembleBlob(sessionId) {
  const session = await getSession(sessionId)
  if (!session) return null
  const chunks = await runTx(CHUNKS, 'readonly', (s, setResult) => {
    const req = s[CHUNKS].index('sessionId').getAll(sessionId)
    req.onsuccess = () => setResult(req.result || [])
  })
  if (!chunks || !chunks.length) return null
  chunks.sort((a, b) => a.seq - b.seq)
  return new Blob(chunks.map((c) => c.blob), { type: session.mimeType || 'audio/webm' })
}

/** Delete a session and all of its chunks. Call on successful upload or discard. */
export async function deleteSession(sessionId) {
  return runTx([SESSIONS, CHUNKS], 'readwrite', (s) => {
    s[SESSIONS].delete(sessionId)
    const keysReq = s[CHUNKS].index('sessionId').getAllKeys(sessionId)
    keysReq.onsuccess = () => {
      for (const k of keysReq.result || []) s[CHUNKS].delete(k)
    }
  })
}

/**
 * Recoverable sessions for the current host: anything that never finished
 * uploading (recording/stopped/failed), newest first, excluding stale ones.
 * Also opportunistically prunes stale sessions so the store self-cleans.
 */
export async function listRecoverable() {
  const all = await listSessions()
  const host = typeof window !== 'undefined' ? window.location.host : ''
  const now = Date.now()
  const stale = []
  const live = []
  for (const s of all) {
    if (now - (s.createdAt || 0) > STALE_MS) { stale.push(s); continue }
    if (s.workspaceHost && host && s.workspaceHost !== host) continue // tenant confinement
    if (['recording', 'stopped', 'failed'].includes(s.status)) live.push(s)
  }
  // Fire-and-forget prune; don't block the caller.
  for (const s of stale) deleteSession(s.id).catch(() => {})
  return live.sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0))
}
