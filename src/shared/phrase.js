// Recovery phrase: a 32-byte identity seed as 24 BIP39 English words (256
// bits of entropy plus the first 8 bits of its SHA-256 as a checksum). See
// proposals/2026-10-03-device-linking.md.
//
// The word list is the frozen BIP39 English list (vendor/bip39-english.json,
// copied from PearList; sha256 of the list as words joined by newlines plus a
// trailing newline starts 2f5eed53a4727b4b, the published english.txt).

const sodium = require('sodium-universal')
const b4a = require('b4a')
const WORDS = require('./vendor/bip39-english.json')

const INDEX = new Map(WORDS.map((w, i) => [w, i]))

function sha256 (buf) {
  const out = b4a.alloc(32)
  sodium.crypto_hash_sha256(out, buf)
  return out
}

function seedToPhrase (seed) {
  if (!seed || seed.length !== 32) throw new Error('seed must be 32 bytes')
  const bits = []
  for (const byte of seed) for (let i = 7; i >= 0; i--) bits.push((byte >> i) & 1)
  const check = sha256(seed)[0]
  for (let i = 7; i >= 0; i--) bits.push((check >> i) & 1)
  const words = []
  for (let i = 0; i < 24; i++) {
    let n = 0
    for (let j = 0; j < 11; j++) n = (n << 1) | bits[i * 11 + j]
    words.push(WORDS[n])
  }
  return words.join(' ')
}

// Throws with a message a person can act on.
function phraseToSeed (phrase) {
  const words = String(phrase).toLowerCase().trim().split(/\s+/).filter(Boolean)
  if (words.length !== 24) throw new Error('A recovery phrase has 24 words; this has ' + words.length)
  const bits = []
  words.forEach((w, i) => {
    const n = INDEX.get(w)
    if (n === undefined) throw new Error('Word ' + (i + 1) + ' ("' + w + '") is not a recovery phrase word')
    for (let j = 10; j >= 0; j--) bits.push((n >> j) & 1)
  })
  const seed = b4a.alloc(32)
  for (let i = 0; i < 32; i++) {
    let byte = 0
    for (let j = 0; j < 8; j++) byte = (byte << 1) | bits[i * 8 + j]
    seed[i] = byte
  }
  let check = 0
  for (let j = 0; j < 8; j++) check = (check << 1) | bits[256 + j]
  if (check !== sha256(seed)[0]) throw new Error('These words do not check out. One of them is probably mistyped.')
  return seed
}

// The Ed25519 identity for a seed (libsodium secret keys are seed + public key).
function identityFromSeed (seed) {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  sodium.crypto_sign_seed_keypair(publicKey, secretKey, seed)
  return { publicKey, secretKey }
}

module.exports = { seedToPhrase, phraseToSeed, identityFromSeed }
