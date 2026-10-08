// Recovery phrase: 12 BIP39 English words for a 16-byte root (128 bits plus
// a 4-bit checksum). The identity seed is a keyed BLAKE2b of the root, so the
// phrase stays short (DECISIONS.md 2026-10-07; first in
// proposals/2026-10-03-device-linking.md as 24 words for the seed itself).
// The root is kept in localDb as `phrase:root`.
//
// The word list is the frozen BIP39 English list (vendor/bip39-english.json,
// copied from PearList; sha256 of the list as words joined by newlines plus a
// trailing newline starts 2f5eed53a4727b4b, the published english.txt).

const sodium = require('sodium-universal')
const b4a = require('b4a')
const WORDS = require('./vendor/bip39-english.json')

const INDEX = new Map(WORDS.map((w, i) => [w, i]))
const WORD_COUNT = 12
const ROOT_BYTES = 16
const SEED_NAMESPACE = 'pearoffice/identity/1'

function sha256 (buf) {
  const out = b4a.alloc(32)
  sodium.crypto_hash_sha256(out, buf)
  return out
}

// root: 16 random bytes. The phrase is the root as 12 words: 128 bits plus
// the first 4 bits of its SHA-256 as a checksum (BIP39).
function rootToPhrase (root) {
  if (!root || root.length !== ROOT_BYTES) throw new Error('root must be 16 bytes')
  const bits = []
  for (const byte of root) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  const check = sha256(root)[0]
  for (let i = 7; i >= 4; i--) bits.push((check >> i) & 1)
  const words = []
  for (let i = 0; i < WORD_COUNT; i++) {
    let n = 0
    for (let j = 0; j < 11; j++) n = (n << 1) | bits[i * 11 + j]
    words.push(WORDS[n])
  }
  return words.join(' ')
}

// Throws with a message a person can act on.
function phraseToRoot (phrase) {
  const words = String(phrase).toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length !== WORD_COUNT) throw new Error('A recovery phrase has 12 words; this has ' + words.length)
  const bits = []
  words.forEach((w, i) => {
    const n = INDEX.get(w)
    if (n === undefined) throw new Error('Word ' + (i + 1) + ' ("' + w + '") is not a recovery phrase word')
    for (let j = 10; j >= 0; j--) bits.push((n >> j) & 1)
  })
  const root = b4a.alloc(ROOT_BYTES)
  for (let i = 0; i < ROOT_BYTES; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j]
    root[i] = byte
  }
  let check = 0
  for (let j = 0; j < 4; j++) check = (check << 1) | bits[128 + j]
  if (check !== sha256(root)[0] >> 4) throw new Error('These words do not check out. One of them is probably mistyped.')
  return root
}

function newRoot () {
  const root = b4a.alloc(ROOT_BYTES)
  sodium.randombytes_buf(root)
  return root
}

// The 32-byte identity seed for a root: a keyed BLAKE2b.
function seedFromRoot (root) {
  if (!root || root.length !== ROOT_BYTES) throw new Error('root must be 16 bytes')
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from(SEED_NAMESPACE), root)
  return out
}

// The Ed25519 identity for a seed (libsodium secret keys are seed + public key).
function identityFromSeed (seed) {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  return { publicKey, secretKey }
}

function identityFromRoot (root) {
  return identityFromSeed(seedFromRoot(root))
}

module.exports = { rootToPhrase, phraseToRoot, newRoot, seedFromRoot, identityFromSeed, identityFromRoot, WORDS, WORD_COUNT }
