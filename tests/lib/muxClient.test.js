import { describe, it, expect, beforeEach, afterEach } from 'vitest'
import { createHmac, generateKeyPairSync, createVerify } from 'node:crypto'
import { verifyWebhookSignature, mintPlaybackToken, muxConfigured, muxSignedConfigured } from '../../api/_lib/muxClient.js'

describe('verifyWebhookSignature', () => {
  const secret = 'test-webhook-secret-abc123'
  const body   = JSON.stringify({ type: 'video.asset.ready', data: { id: 'asset-xyz' } })
  const ts     = Math.floor(Date.now() / 1000)

  function signed(ts, body) {
    return createHmac('sha256', secret).update(`${ts}.${body}`, 'utf8').digest('hex')
  }

  it('accepts a correctly signed payload within the tolerance window', () => {
    const sig = signed(ts, body)
    const header = `t=${ts},v1=${sig}`
    expect(verifyWebhookSignature(body, header, secret)).toBe(true)
  })

  it('rejects a payload signed with the wrong secret', () => {
    const wrongSig = createHmac('sha256', 'wrong').update(`${ts}.${body}`, 'utf8').digest('hex')
    const header = `t=${ts},v1=${wrongSig}`
    expect(verifyWebhookSignature(body, header, secret)).toBe(false)
  })

  it('rejects a payload outside the timestamp tolerance window', () => {
    const oldTs = ts - 600  // 10 minutes ago, default tolerance is 5 min
    const sig = signed(oldTs, body)
    const header = `t=${oldTs},v1=${sig}`
    expect(verifyWebhookSignature(body, header, secret)).toBe(false)
  })

  it('rejects when header is missing one of the required parts', () => {
    expect(verifyWebhookSignature(body, `v1=${signed(ts, body)}`, secret)).toBe(false)
    expect(verifyWebhookSignature(body, `t=${ts}`, secret)).toBe(false)
    expect(verifyWebhookSignature(body, '', secret)).toBe(false)
  })

  it('rejects when body, header, or secret is missing', () => {
    expect(verifyWebhookSignature('', `t=${ts},v1=${signed(ts, body)}`, secret)).toBe(false)
    expect(verifyWebhookSignature(body, null, secret)).toBe(false)
    expect(verifyWebhookSignature(body, `t=${ts},v1=${signed(ts, body)}`, '')).toBe(false)
  })

  it('rejects a tampered payload (matching ts, mismatched body)', () => {
    const sig = signed(ts, body)
    const header = `t=${ts},v1=${sig}`
    const tamperedBody = body.replace('ready', 'errored')
    expect(verifyWebhookSignature(tamperedBody, header, secret)).toBe(false)
  })
})

describe('mintPlaybackToken', () => {
  let keypair
  const KEY_ID = 'test-key-id-xyz'

  beforeEach(() => {
    // Mux uses RS256 (RSA) signing keys. Generate a real pair so we can
    // verify the JWT structure end-to-end without bringing in a JWT library
    // just for the test.
    keypair = generateKeyPairSync('rsa', { modulusLength: 2048 })
    process.env.MUX_SIGNING_KEY_ID = KEY_ID
    process.env.MUX_SIGNING_KEY = keypair.privateKey.export({ type: 'pkcs1', format: 'pem' })
  })

  afterEach(() => {
    delete process.env.MUX_SIGNING_KEY_ID
    delete process.env.MUX_SIGNING_KEY
  })

  function decodeJwtSegment(seg) {
    const b64 = seg.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - seg.length % 4) % 4)
    return JSON.parse(Buffer.from(b64, 'base64').toString('utf8'))
  }

  it('produces a verifiable RS256 JWT with the expected claims', () => {
    const token = mintPlaybackToken({ playbackId: 'playback-abc', expiresInSec: 60 })
    const [headerB64, payloadB64, sigB64] = token.split('.')
    expect(headerB64 && payloadB64 && sigB64).toBeTruthy()

    const header  = decodeJwtSegment(headerB64)
    const payload = decodeJwtSegment(payloadB64)

    expect(header.alg).toBe('RS256')
    expect(header.typ).toBe('JWT')
    expect(header.kid).toBe(KEY_ID)
    expect(payload.sub).toBe('playback-abc')
    expect(payload.aud).toBe('v')
    expect(payload.exp).toBeGreaterThan(Math.floor(Date.now() / 1000))
    expect(payload.exp - payload.iat).toBe(60)

    // Verify the signature is real (caught a subtle bug during dev where
    // the wrong segments were concatenated before signing).
    const verifier = createVerify('RSA-SHA256')
    verifier.update(`${headerB64}.${payloadB64}`)
    verifier.end()
    const sigBytes = Buffer.from(
      sigB64.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - sigB64.length % 4) % 4),
      'base64',
    )
    expect(verifier.verify(keypair.publicKey, sigBytes)).toBe(true)
  })

  it('throws if MUX_SIGNING_KEY_ID is not set', () => {
    delete process.env.MUX_SIGNING_KEY_ID
    expect(() => mintPlaybackToken({ playbackId: 'p' })).toThrow(/MUX_SIGNING_KEY_ID/)
  })

  it('throws if playbackId is missing', () => {
    expect(() => mintPlaybackToken({})).toThrow(/playbackId/)
  })

  it('honors a custom audience claim', () => {
    const token = mintPlaybackToken({ playbackId: 'p', audience: 't' })
    const payload = decodeJwtSegment(token.split('.')[1])
    expect(payload.aud).toBe('t')
  })
})

describe('config probes', () => {
  it('muxConfigured tracks the API token env vars', () => {
    const had = { id: process.env.MUX_TOKEN_ID, secret: process.env.MUX_TOKEN_SECRET }
    delete process.env.MUX_TOKEN_ID
    delete process.env.MUX_TOKEN_SECRET
    expect(muxConfigured()).toBe(false)
    process.env.MUX_TOKEN_ID = 'x'
    expect(muxConfigured()).toBe(false)
    process.env.MUX_TOKEN_SECRET = 'y'
    expect(muxConfigured()).toBe(true)
    // restore
    if (had.id) process.env.MUX_TOKEN_ID = had.id; else delete process.env.MUX_TOKEN_ID
    if (had.secret) process.env.MUX_TOKEN_SECRET = had.secret; else delete process.env.MUX_TOKEN_SECRET
  })

  it('muxSignedConfigured tracks the signing key env vars', () => {
    delete process.env.MUX_SIGNING_KEY_ID
    delete process.env.MUX_SIGNING_KEY
    expect(muxSignedConfigured()).toBe(false)
    process.env.MUX_SIGNING_KEY_ID = 'kid'
    process.env.MUX_SIGNING_KEY = 'key'
    expect(muxSignedConfigured()).toBe(true)
    delete process.env.MUX_SIGNING_KEY_ID
    delete process.env.MUX_SIGNING_KEY
  })
})
