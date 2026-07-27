import { describe, it, expect, vi } from 'vitest'
import { ffmpegErrorTail, runFfmpegWithRetry } from '../../scripts/lib/ffmpegRun.mjs'

// Verbatim shape of ffmpeg's progress stream: ONE line, \r-delimited. This is
// what made the 2026-07-26 failures undiagnosable — splitting on \n yielded a
// single useless blob, or nothing.
const PROGRESS = 'size=       8kB time=00:00:01.80 bitrate=  34.6kbits/s speed=2.32x    \r'
  + 'size=      13kB time=00:00:03.31 bitrate=  33.1kbits/s speed=2.46x    \r'
  + 'size=      21kB time=00:00:05.29 bitrate=  32.9kbits/s speed=2.69x    \r'

describe('ffmpegErrorTail', () => {
  it('surfaces the real error even when buried under \\r progress spam', () => {
    const stderr = PROGRESS + '\r[https @ 0x14] HTTP error 416 Requested Range Not Satisfiable\r'
      + 'Error opening input: Input/output error\r'
    const tail = ffmpegErrorTail(Buffer.from(stderr))
    expect(tail).toContain('Error opening input')
    expect(tail).toContain('HTTP error 416')
    // The progress counter must not crowd out the error.
    expect(tail).not.toMatch(/^size=/m)
  })

  it('says so explicitly when nothing was captured, instead of a bare colon', () => {
    // The exact 2026-07-26 case: `ffmpeg exited 1:` and no detail at all.
    expect(ffmpegErrorTail(Buffer.from(''))).toMatch(/no stderr captured/)
    expect(ffmpegErrorTail(Buffer.from('   \r\n  '))).toMatch(/no stderr captured/)
  })

  it('is tolerant of nullish input', () => {
    expect(ffmpegErrorTail(null)).toMatch(/no stderr captured/)
    expect(ffmpegErrorTail(undefined)).toMatch(/no stderr captured/)
  })

  it('keeps only the trailing N real lines', () => {
    const many = Array.from({ length: 20 }, (_, i) => `line${i}`).join('\n')
    const tail = ffmpegErrorTail(Buffer.from(many), 3)
    expect(tail.split('\n')).toEqual(['line17', 'line18', 'line19'])
  })

  it('handles progress spam that is ONLY progress (no real error)', () => {
    expect(ffmpegErrorTail(Buffer.from(PROGRESS))).toMatch(/no stderr captured/)
  })
})

describe('runFfmpegWithRetry', () => {
  const noSleep = () => Promise.resolve()

  it('does not retry when the first attempt succeeds', async () => {
    const run = vi.fn().mockResolvedValue(undefined)
    const log = vi.fn()
    await runFfmpegWithRetry(['-i', 'x'], 'clip.mov', { run, log, sleep: noSleep })
    expect(run).toHaveBeenCalledTimes(1)
    expect(log).not.toHaveBeenCalled()
  })

  // The actual 2026-07-26 scenario: a transient network fault on a 300MB
  // streaming read, where the identical command succeeds moments later.
  it('recovers when a transient failure is followed by success', async () => {
    const run = vi.fn()
      .mockRejectedValueOnce(new Error('ffmpeg exited 1:\n(no stderr captured)'))
      .mockResolvedValue(undefined)
    const log = vi.fn()
    await runFfmpegWithRetry(['-i', 'x'], 'big.mov', { run, log, sleep: noSleep })
    expect(run).toHaveBeenCalledTimes(2)
    expect(log).toHaveBeenCalledTimes(1)
    expect(log.mock.calls[0][0]).toContain('big.mov')
  })

  it('gives up after the configured attempts and rethrows the LAST error', async () => {
    const run = vi.fn().mockRejectedValue(new Error('ffmpeg exited 1:\nboom'))
    await expect(
      runFfmpegWithRetry(['-i', 'x'], 'bad.mov', { run, log: vi.fn(), sleep: noSleep, attempts: 3 }),
    ).rejects.toThrow(/boom/)
    expect(run).toHaveBeenCalledTimes(3)
  })

  it('backs off linearly between attempts', async () => {
    const run = vi.fn().mockRejectedValue(new Error('nope'))
    const waits = []
    await runFfmpegWithRetry(['-i', 'x'], 'c.mov', {
      run, log: vi.fn(), sleep: (ms) => { waits.push(ms); return Promise.resolve() },
      attempts: 4, backoffMs: 1000,
    }).catch(() => {})
    expect(waits).toEqual([1000, 2000, 3000])
  })

  it('attempts=1 disables retrying entirely', async () => {
    const run = vi.fn().mockRejectedValue(new Error('nope'))
    await expect(
      runFfmpegWithRetry(['-i', 'x'], 'c.mov', { run, log: vi.fn(), sleep: noSleep, attempts: 1 }),
    ).rejects.toThrow(/nope/)
    expect(run).toHaveBeenCalledTimes(1)
  })
})
