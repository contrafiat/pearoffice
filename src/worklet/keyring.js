// The keyring: an encrypted list of a person's files, kept by their seeders,
// so the recovery phrase brings files back (proposals/2026-10-07-phrase-recovers-files.md).
//
// Everything is derived from the identity seed with a keyed BLAKE2b, one
// purpose string each:
//
//   locator   the keyring's address at a seeder
//   topic     where a restoring device finds seeders that hold it (from the locator)
//   sign key  Ed25519, signs each version
//   box key   XChaCha20-Poly1305, encrypts it
//
// A keyring, before encryption:
//
//   { v: 1, files: { <sheetId>: item }, seeders: { <seederKey>: item } }
//   item  { at, entry } for a file, { at } for a seeder, { at, removed: true } when gone
//
// A file entry is the own-devices entry (ownDevices.js cleanEntry) plus an
// optional role. Merging keeps, per id, the item with the later `at`;
// removals are kept for 30 days so a slower device does not add the file
// back, then dropped.
//
// A sealed version, as a seeder stores it:
//
//   { locator, seq, nonce, ciphertext, signKey, sig }   keys hex, bytes base64
//
// The signature covers the locator, seq, nonce and ciphertext. The locator
// is also the AEAD's additional data, so a ciphertext cannot be moved to
// another address.

const b4a = require('b4a')
const sodium = require('sodium-universal')
const { cleanEntry } = require('./ownDevices')

const NS = {
  locator: 'pearoffice/keyring/locator/1',
  topic: 'pearoffice/keyring/topic/1',
  sign: 'pearoffice/keyring/sign/1',
  box: 'pearoffice/keyring/box/1',
  sig: 'pearoffice/keyring/sig/1'
}
const MAX_BYTES = 1024 * 1024 // ciphertext
const MAX_FILES = 5000
const MAX_SEEDERS = 32
const TOMBSTONE_MS = 30 * 24 * 60 * 60 * 1000
const ROLES = ['owner', 'editor', 'viewer']
const KEY = /^[0-9a-f]{64}$/
const ID = /^[A-Za-z0-9_-]{43}$/
const B64 = /^[A-Za-z0-9+/]*={0,2}$/

const hex = (buf) => b4a.toString(buf, 'hex')

function hash (key, ns) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from(ns), key)
  return out
}

// seed: the 32-byte identity seed.
function deriveKeys (seed) {
  if (!b4a.isBuffer(seed) || seed.length !== 32) throw new Error('seed must be 32 bytes')
  const locator = hash(seed, NS.locator)
  const signKeyPair = { publicKey: b4a.alloc(sodium.crypto_sign_PUBLICKEYBYTES), secretKey: b4a.alloc(sodium.crypto_sign_SECRETKEYBYTES) }
  sodium.crypto_sign_seed_keypair(signKeyPair.publicKey, signKeyPair.secretKey, hash(seed, NS.sign))
  return { locator, topic: hash(locator, NS.topic), signKeyPair, boxKey: hash(seed, NS.box) }
}

// The topic for a locator a seeder holds (the seeder never has the seed).
function topicOf (locator) {
  return hash(locator, NS.topic)
}

function empty () {
  return { v: 1, files: {}, seeders: {} }
}

function signed (locator, seq, nonce, ciphertext) {
  const s = b4a.alloc(8)
  const view = new DataView(s.buffer, s.byteOffset, 8)
  view.setUint32(0, Math.floor(seq / 2 ** 32))
  view.setUint32(4, seq >>> 0)
  return b4a.concat([b4a.from(NS.sig), locator, s, nonce, ciphertext])
}

function seal (keyring, keys, seq) {
  if (!Number.isSafeInteger(seq) || seq < 1) throw new Error('seq must be a positive integer')
  const plain = b4a.from(JSON.stringify(clean(keyring)))
  const nonce = b4a.alloc(sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES)
  sodium.randombytes_buf(nonce)
  const ciphertext = b4a.alloc(plain.length + sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES)
  sodium.crypto_aead_xchacha20poly1305_ietf_encrypt(ciphertext, plain, keys.locator, null, nonce, keys.boxKey)
  if (ciphertext.length > MAX_BYTES) throw new Error('The file list is too large to back up')
  const sig = b4a.alloc(sodium.crypto_sign_BYTES)
  sodium.crypto_sign_detached(sig, signed(keys.locator, seq, nonce, ciphertext), keys.signKeyPair.secretKey)
  return {
    locator: hex(keys.locator),
    seq,
    nonce: b4a.toString(nonce, 'base64'),
    ciphertext: b4a.toString(ciphertext, 'base64'),
    signKey: hex(keys.signKeyPair.publicKey),
    sig: hex(sig)
  }
}

// The checks a seeder can make without the seed: the shape, the size and
// that `signKey` signed it. Returns the decoded bytes, or null.
function checkSealed (rec) {
  if (!rec || typeof rec !== 'object') return null
  const { locator, seq, nonce, ciphertext, signKey, sig } = rec
  if (typeof locator !== 'string' || !KEY.test(locator)) return null
  if (typeof signKey !== 'string' || !KEY.test(signKey)) return null
  if (typeof sig !== 'string' || !/^[0-9a-f]{128}$/.test(sig)) return null
  if (!Number.isSafeInteger(seq) || seq < 1) return null
  if (typeof nonce !== 'string' || typeof ciphertext !== 'string' || !B64.test(nonce) || !B64.test(ciphertext)) return null
  if (ciphertext.length > Math.ceil(MAX_BYTES / 3) * 4) return null
  const bytes = {
    locator: b4a.from(locator, 'hex'),
    nonce: b4a.from(nonce, 'base64'),
    ciphertext: b4a.from(ciphertext, 'base64'),
    signKey: b4a.from(signKey, 'hex'),
    sig: b4a.from(sig, 'hex')
  }
  if (bytes.nonce.length !== sodium.crypto_aead_xchacha20poly1305_ietf_NPUBBYTES) return null
  if (bytes.ciphertext.length < sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES || bytes.ciphertext.length > MAX_BYTES) return null
  try {
    if (!sodium.crypto_sign_verify_detached(bytes.sig, signed(bytes.locator, seq, bytes.nonce, bytes.ciphertext), bytes.signKey)) return null
  } catch { return null }
  return bytes
}

// The keyring in a sealed version, or null when it is not ours, does not
// check out or does not decrypt.
function open (rec, keys) {
  const bytes = checkSealed(rec)
  if (!bytes) return null
  if (!b4a.equals(bytes.locator, keys.locator) || !b4a.equals(bytes.signKey, keys.signKeyPair.publicKey)) return null
  const plain = b4a.alloc(bytes.ciphertext.length - sodium.crypto_aead_xchacha20poly1305_ietf_ABYTES)
  try {
    sodium.crypto_aead_xchacha20poly1305_ietf_decrypt(plain, null, bytes.ciphertext, keys.locator, bytes.nonce, keys.boxKey)
  } catch { return null }
  let parsed
  try { parsed = JSON.parse(b4a.toString(plain)) } catch { return null }
  return clean(parsed)
}

function cleanItem (item, isFile) {
  if (!item || typeof item !== 'object' || !Number.isSafeInteger(item.at) || item.at < 0) return null
  if (item.removed === true) return { at: item.at, removed: true }
  if (!isFile) return { at: item.at }
  const entry = cleanEntry(item.entry)
  if (!entry) return null
  if (ROLES.includes(item.entry.role)) entry.role = item.entry.role
  return { at: item.at, entry }
}

// Drops anything malformed, so a damaged or hostile keyring cannot carry
// bad keys into the restore.
function clean (k) {
  const out = empty()
  if (!k || typeof k !== 'object' || k.v !== 1) return out
  let n = 0
  for (const [id, item] of Object.entries(k.files || {})) {
    if (!ID.test(id) || n >= MAX_FILES) continue
    const c = cleanItem(item, true)
    if (c && (c.removed || c.entry.sheetId === id)) { out.files[id] = c; n++ }
  }
  n = 0
  for (const [key, item] of Object.entries(k.seeders || {})) {
    if (!KEY.test(key) || n >= MAX_SEEDERS) continue
    const c = cleanItem(item, false)
    if (c) { out.seeders[key] = c; n++ }
  }
  return out
}

// The later item; on a tie a removal wins, then the larger JSON, so every
// device picks the same one whatever order it merges in.
function later (x, y) {
  if (x.at !== y.at) return x.at > y.at
  if (!!x.removed !== !!y.removed) return !!x.removed
  return JSON.stringify(x) > JSON.stringify(y)
}

function mergeSection (a, b, now) {
  const out = {}
  for (const src of [a, b]) {
    for (const [id, item] of Object.entries(src)) {
      if (!out[id] || later(item, out[id])) out[id] = item
    }
  }
  for (const [id, item] of Object.entries(out)) {
    if (item.removed && item.at < now - TOMBSTONE_MS) delete out[id]
  }
  return out
}

// Both keyrings' items, the later of each; old removals dropped.
function merge (a, b, now = Date.now()) {
  a = clean(a)
  b = clean(b)
  return { v: 1, files: mergeSection(a.files, b.files, now), seeders: mergeSection(a.seeders, b.seeders, now) }
}

// The files in a keyring that are still there.
function files (k) {
  return Object.values(clean(k).files).filter((i) => !i.removed).map((i) => i.entry)
}

function seeders (k) {
  return Object.entries(clean(k).seeders).filter(([, i]) => !i.removed).map(([key]) => key)
}

module.exports = { deriveKeys, topicOf, empty, seal, checkSealed, open, clean, merge, files, seeders, MAX_BYTES, TOMBSTONE_MS }
