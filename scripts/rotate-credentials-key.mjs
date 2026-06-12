#!/usr/bin/env node
// Rotate WORKSPACE_CREDENTIALS_KEY without disrupting live tenants.
//
// Usage:
//   NEW_CREDENTIALS_KEY=<64-hex-new-key> \
//   MULTITENANT_DATABASE_URL=<db-url> \
//   WORKSPACE_CREDENTIALS_KEY=<64-hex-old-key> \
//   node scripts/rotate-credentials-key.mjs [--dry-run]
//
// What it does:
//   1. Reads every workspace_credentials row that has a secret_ciphertext.
//   2. Decrypts each with OLD key (WORKSPACE_CREDENTIALS_KEY).
//   3. Re-encrypts with NEW key (NEW_CREDENTIALS_KEY).
//   4. PATCHes the row in-place — workspace_id / service / config unchanged.
//   5. Prints a summary. With --dry-run, no writes happen.
//
// After a successful run:
//   - Set WORKSPACE_CREDENTIALS_KEY=<new-key> on Vercel (production + preview).
//   - Redeploy so functions pick up the new key.
//   - Verify a credential round-trip works (e.g. trigger an auto-publish run).
//   - Revoke (delete) the old key from wherever you stored it.
//
// Safety:
//   - Dry-run by default when NEW_CREDENTIALS_KEY === WORKSPACE_CREDENTIALS_KEY
//     (no-op rotation — catches the "oops I set the same key" mistake).
//   - Each row is re-encrypted independently; a failure on one row aborts
//     before any writes, so the DB is never in a half-rotated state.
//   - The script never logs plaintext secrets.

import pg from 'pg'
import { createCipheriv, createDecipheriv, randomBytes } from 'node:crypto'

const DRY_RUN = process.argv.includes('--dry-run')
const ALGO = 'aes-256-gcm'
const IV_LEN = 12
const TAG_LEN = 16

function parseKey(envVar) {
  const hex = process.env[envVar]
  if (!hex) throw new Error(`${envVar} is not set`)
  if (hex.length !== 64) throw new Error(`${envVar} must be 64 hex chars (32 bytes)`)
  return Buffer.from(hex, 'hex')
}

function decrypt(blob, key) {
  const buf = Buffer.from(blob, 'base64')
  if (buf.length < IV_LEN + TAG_LEN + 1) throw new Error('ciphertext too short')
  const iv = buf.subarray(0, IV_LEN)
  const tag = buf.subarray(buf.length - TAG_LEN)
  const ciphertext = buf.subarray(IV_LEN, buf.length - TAG_LEN)
  const decipher = createDecipheriv(ALGO, key, iv)
  decipher.setAuthTag(tag)
  return Buffer.concat([decipher.update(ciphertext), decipher.final()]).toString('utf8')
}

function encrypt(plaintext, key) {
  const iv = randomBytes(IV_LEN)
  const cipher = createCipheriv(ALGO, key, iv)
  const ciphertext = Buffer.concat([cipher.update(plaintext, 'utf8'), cipher.final()])
  const tag = cipher.getAuthTag()
  return Buffer.concat([iv, ciphertext, tag]).toString('base64')
}

async function main() {
  const oldKey = parseKey('WORKSPACE_CREDENTIALS_KEY')
  const newKey = parseKey('NEW_CREDENTIALS_KEY')

  if (oldKey.equals(newKey)) {
    console.error('ERROR: NEW_CREDENTIALS_KEY is identical to WORKSPACE_CREDENTIALS_KEY — nothing to rotate.')
    process.exit(1)
  }

  const dbUrl = process.env.MULTITENANT_DATABASE_URL
  if (!dbUrl) throw new Error('MULTITENANT_DATABASE_URL is not set')

  const pool = new pg.Pool({ connectionString: dbUrl, max: 2 })

  try {
    const { rows } = await pool.query(
      `SELECT id, workspace_id, service, secret_ciphertext
         FROM workspace_credentials
        WHERE secret_ciphertext IS NOT NULL AND secret_ciphertext <> ''
        ORDER BY workspace_id, service`
    )

    console.log(`Found ${rows.length} rows with encrypted secrets.`)
    if (DRY_RUN) console.log('DRY RUN — no writes will happen.\n')

    // Decrypt all rows first — abort before any writes if any row fails.
    const prepared = []
    for (const row of rows) {
      let plaintext
      try {
        plaintext = decrypt(row.secret_ciphertext, oldKey)
      } catch (e) {
        throw new Error(`Failed to decrypt row id=${row.id} (workspace=${row.workspace_id} service=${row.service}): ${e.message}`)
      }
      const newCiphertext = encrypt(plaintext, newKey)
      prepared.push({ id: row.id, workspace_id: row.workspace_id, service: row.service, newCiphertext })
    }

    console.log(`All ${prepared.length} rows decrypted successfully.`)

    if (DRY_RUN) {
      console.log('\nDry-run complete. Re-run without --dry-run to apply.')
      return
    }

    // Write new ciphertexts.
    let updated = 0
    for (const { id, workspace_id, service, newCiphertext } of prepared) {
      await pool.query(
        `UPDATE workspace_credentials SET secret_ciphertext = $1 WHERE id = $2`,
        [newCiphertext, id]
      )
      console.log(`  ✓ rotated id=${id} (workspace=${workspace_id} service=${service})`)
      updated++
    }

    console.log(`\n✅ Rotated ${updated}/${rows.length} rows.`)
    console.log('\nNext steps:')
    console.log('  1. Set WORKSPACE_CREDENTIALS_KEY=<new-key> on Vercel (production + preview).')
    console.log('  2. Redeploy prod so functions pick up the new key.')
    console.log('  3. Verify a credential round-trip (trigger auto-publish or check Settings → Integrations).')
    console.log('  4. Delete the old key from 1Password.')
  } finally {
    await pool.end().catch(() => {})
  }
}

main().catch((e) => {
  console.error('FATAL:', e.message)
  process.exit(1)
})
