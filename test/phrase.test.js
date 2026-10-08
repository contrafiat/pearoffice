const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { rootToPhrase, phraseToRoot, newRoot, seedFromRoot, identityFromRoot } = require('../src/shared/phrase')

test('matches the BIP39 test vector for 16 bytes of 0x7f', () => {
  // From the reference BIP39 vectors (trezor/python-mnemonic vectors.json).
  assert.equal(rootToPhrase(b4a.alloc(16, 0x7f)), 'legal winner thank year wave sausage worth useful legal winner thank yellow')
  assert.equal(rootToPhrase(b4a.alloc(16, 0)), 'abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon abandon about')
})

test('a phrase gives back the identity it came from', () => {
  const root = newRoot()
  const phrase = rootToPhrase(root)
  assert.equal(phrase.split(' ').length, 12)
  const back = phraseToRoot('  ' + phrase.toUpperCase() + '\n')
  assert.ok(b4a.equals(back, root))
  assert.ok(b4a.equals(identityFromRoot(back).publicKey, identityFromRoot(root).publicKey))
})

test('the identity seed is a keyed hash of the root', () => {
  const root = b4a.alloc(16, 0x7f)
  // Pinned: a changed derivation would give everyone a different identity.
  assert.equal(b4a.toString(seedFromRoot(root), 'hex').slice(0, 16), '53a2c46c11fdec12')
  assert.notEqual(b4a.toString(seedFromRoot(root), 'hex').slice(0, 32), b4a.toString(root, 'hex'))
  assert.throws(() => seedFromRoot(b4a.alloc(32)))
})

test('a mistyped or unknown word is caught', () => {
  const words = rootToPhrase(b4a.alloc(16, 7)).split(' ')
  const swapped = [...words]
  ;[swapped[3], swapped[4]] = [swapped[4], swapped[3]]
  assert.throws(() => phraseToRoot(swapped.join(' ')), /do not check out/)
  assert.throws(() => phraseToRoot(words.slice(0, 11).join(' ')), /12 words; this has 11/)
  assert.throws(() => phraseToRoot([...words.slice(0, 11), 'pearoffice'].join(' ')), /Word 12/)
  // An old 24-word phrase is refused by its length.
  assert.throws(() => phraseToRoot([...words, ...words].join(' ')), /12 words; this has 24/)
})

test('a new device gets a 12-word phrase; an identity from before has none', async (t) => {
  const Hyperswarm = require('hyperswarm')
  const Corestore = require('corestore')
  const createTestnet = require('@hyperswarm/testnet')
  const { createSheetEngine } = require('../src/worklet/engine')
  const { tmpDir, cleanup, call } = require('./helpers')
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => { try { await e.close() } catch {} await testnet.destroy(); cleanup() })
  await e.init({})
  const { phrase } = await call(e, 'link:phrase')
  assert.equal(phrase.split(' ').length, 12)
  assert.ok(b4a.equals(identityFromRoot(phraseToRoot(phrase)).publicKey, e.identity.publicKey), 'the identity comes from the phrase')
  await e.localDb.del('phrase:root')
  await assert.rejects(call(e, 'link:phrase'), /older test version/)
})
