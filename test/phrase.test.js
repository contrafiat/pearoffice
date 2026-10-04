const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { generateKeypair } = require('@peerloom/core/identity')
const { seedToPhrase, phraseToSeed, identityFromSeed } = require('../src/shared/phrase')

test('matches the BIP39 test vector for 32 bytes of 0x7f', () => {
  // From the reference BIP39 vectors (trezor/python-mnemonic vectors.json).
  const phrase = seedToPhrase(b4a.alloc(32, 0x7f))
  assert.equal(phrase, 'legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth useful legal winner thank year wave sausage worth title')
})

test('a phrase gives back the identity it came from', () => {
  const id = generateKeypair()
  const seed = id.secretKey.subarray(0, 32)
  const phrase = seedToPhrase(seed)
  assert.equal(phrase.split(' ').length, 24)
  const back = identityFromSeed(phraseToSeed('  ' + phrase.toUpperCase() + '\n'))
  assert.ok(b4a.equals(back.publicKey, id.publicKey))
  assert.ok(b4a.equals(back.secretKey, id.secretKey))
})

test('a mistyped or unknown word is caught', () => {
  const words = seedToPhrase(b4a.alloc(32, 7)).split(' ')
  const swapped = [...words]
  ;[swapped[3], swapped[4]] = [swapped[4], swapped[3]]
  assert.throws(() => phraseToSeed(swapped.join(' ')), /do not check out/)
  assert.throws(() => phraseToSeed(words.slice(0, 23).join(' ')), /24 words/)
  assert.throws(() => phraseToSeed([...words.slice(0, 23), 'pearsheet'].join(' ')), /Word 24/)
})
