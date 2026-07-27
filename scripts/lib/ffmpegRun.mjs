/**
 * ffmpeg process helpers for the backfill scripts.
 *
 * Split out of backfill-transcript-words.mjs so the error formatting and the
 * retry policy are unit-testable — that script connects to Postgres and
 * process.exit()s on missing env at module load, so nothing in it can be
 * imported from a test.
 */

import { spawn } from 'node:child_process'
import ffmpegPath from 'ffmpeg-static'

const STDERR_CAP_BYTES = 256 * 1024

/**
 * Pull the useful tail out of ffmpeg's stderr.
 *
 * ffmpeg writes its progress counter with CARRIAGE RETURNS, not newlines — the
 * whole "size= … time= … speed=" stream is one enormous \r-delimited line. So
 * splitting on \n and taking the last few lines surfaces that blob, or, when
 * the process dies before printing much, nothing at all. Both of the
 * 2026-07-26 backfill failures reported a bare `ffmpeg exited 1:` with an empty
 * tail, which cost a full reproduce-by-hand cycle to diagnose.
 *
 * @param {Buffer|string} buf — captured stderr
 * @param {number} lines — how many trailing lines to keep
 * @returns {string} the real error lines, or an explicit "nothing captured" note
 */
export function ffmpegErrorTail(buf, lines = 6) {
  const cleaned = String(buf ?? '')
    .replace(/\r/g, '\n')
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l && !/^(size|frame)=/.test(l))
  if (!cleaned.length) return '(no stderr captured — ffmpeg died before writing output)'
  return cleaned.slice(-lines).join('\n')
}

/** Spawn ffmpeg once. Resolves on exit 0, rejects with the stderr tail otherwise. */
export function runFfmpeg(ffArgs) {
  return new Promise((resolve, reject) => {
    const proc = spawn(ffmpegPath, ffArgs, { stdio: ['ignore', 'ignore', 'pipe'] })
    const chunks = []
    let total = 0
    proc.stderr.on('data', (c) => {
      chunks.push(c)
      total += c.length
      // Drop from the FRONT until under the cap. One shift per event is not
      // enough when a single chunk is large, and lets the buffer creep.
      while (total > STDERR_CAP_BYTES && chunks.length > 1) total -= chunks.shift().length
    })
    proc.on('close', (code) => {
      if (code === 0) return resolve()
      reject(new Error(`ffmpeg exited ${code}:\n${ffmpegErrorTail(Buffer.concat(chunks))}`))
    })
    proc.on('error', (err) => reject(new Error(`ffmpeg spawn failed: ${err.message}`)))
  })
}

/**
 * Spawn ffmpeg, retrying transient failures with linear backoff.
 *
 * The input is a remote blob URL, so the extract is a large streaming download —
 * 300MB+ for a minute of 4K footage. Under concurrency those compete for
 * bandwidth, and a transient network fault kills the whole asset for the run.
 * That is exactly what took out 2 of 333 assets on 2026-07-26: both files were
 * later proven healthy (plain h264 + pcm_s16le) and both succeeded on a plain
 * re-run, so one retry would have saved a manual diagnosis and a second pass.
 *
 * @param {string[]} ffArgs
 * @param {string} label — asset filename, for the retry log line
 * @param {{attempts?: number, backoffMs?: number, log?: Function, sleep?: Function, run?: Function}} [opts]
 */
export async function runFfmpegWithRetry(ffArgs, label, opts = {}) {
  const {
    attempts = 3,
    backoffMs = 2000,
    log = console.log,
    sleep = (ms) => new Promise((r) => setTimeout(r, ms)),
    run = runFfmpeg,
  } = opts
  for (let attempt = 1; ; attempt++) {
    try {
      return await run(ffArgs)
    } catch (e) {
      if (attempt >= attempts) throw e
      const waitMs = backoffMs * attempt
      log(`  retry ${attempt}/${attempts - 1} ${label} in ${waitMs}ms — ${String(e?.message).split('\n')[0]}`)
      await sleep(waitMs)
    }
  }
}
