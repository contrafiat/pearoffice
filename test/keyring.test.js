// The keyring's keys, sealing and merging (proposals/2026-10-07-phrase-recovers-files.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const { deriveKeys, topicOf, empty, seal, checkSealed, open, merge, files, seeders, TOMBSTONE_MS } = require('../src/worklet/keyring')

const hex = (buf) => b4a.toString(buf, 'hex')
const seedA = b4a.alloc(32, 1)
const seedB = b4a.alloc(32, 2)
const id = (c) => c.repeat(43)
const file = (c, extra = {}) => ({ sheetId: id(c), groupKey: 'a'.repeat(64), encryptionKey: 'b'.repeat(64), bootstrap: 'c'.repeat(64), name: 'File ' + c, kind: 'sheet', ...extra })
const NOW = 1_800_000_000_000

test('the keys are stable and differ by purpose and by seed', () => {
  const a = deriveKeys(seedA)
  const again = deriveKeys(b4a.from(seedA))
  assert.equal(hex(a.locator), hex(again.locator))
  assert.equal(hex(a.boxKey), hex(again.boxKey))
  assert.equal(hex(a.signKeyPair.publicKey), hex(again.signKeyPair.publicKey))
  // Pinned, so a change to a purpose string is noticed: a changed derivation
  // would lose every keyring already on a seeder.
  assert.equal(hex(a.locator).slice(0, 16), '6b274fc07de0f39b')
  const all = [a.locator, a.topic, a.boxKey, a.signKeyPair.publicKey, seedA].map(hex)
  assert.equal(new Set(all).size, all.length, 'every key differs')
  assert.equal(hex(topicOf(a.locator)), hex(a.topic), 'a seeder works out the topic from the locator')
  const b = deriveKeys(seedB)
  assert.notEqual(hex(a.locator), hex(b.locator))
  assert.notEqual(hex(a.boxKey), hex(b.boxKey))
  assert.throws(() => deriveKeys(b4a.alloc(31)))
})

test('a sealed keyring opens only with the same seed and holds no plain keys', () => {
  const keys = deriveKeys(seedA)
  const k = { v: 1, files: { [id('x')]: { at: NOW, entry: file('x', { role: 'owner' }) } }, seeders: { ['d'.repeat(64)]: { at: NOW } } }
  const rec = seal(k, keys, 1)
  assert.ok(checkSealed(rec), 'a seeder can check it')
  const back = open(rec, keys)
  assert.deepEqual(files(back), [file('x', { role: 'owner' })])
  assert.deepEqual(seeders(back), ['d'.repeat(64)])
  assert.equal(open(rec, deriveKeys(seedB)), null, 'another seed cannot open it')
  const text = JSON.stringify(rec)
  for (const secret of ['a'.repeat(64), 'b'.repeat(64), 'File x']) assert.ok(!text.includes(secret), 'nothing readable: ' + secret)
  assert.notEqual(seal(k, keys, 1).ciphertext, rec.ciphertext, 'a fresh nonce every time')
})

test('a changed version does not check out', () => {
  const keys = deriveKeys(seedA)
  const rec = seal(empty(), keys, 3)
  assert.equal(checkSealed({ ...rec, seq: 4 }), null, 'seq is signed')
  const ct = b4a.from(rec.ciphertext, 'base64')
  ct[0] ^= 1
  assert.equal(checkSealed({ ...rec, ciphertext: b4a.toString(ct, 'base64') }), null, 'ciphertext is signed')
  assert.equal(checkSealed({ ...rec, locator: 'e'.repeat(64) }), null, 'locator is signed')
  // Someone else's sign key over the same address: checks out at the seeder
  // (its first-key rule refuses it there) but never opens.
  const other = deriveKeys(seedB)
  const forged = seal(empty(), { ...other, locator: keys.locator }, 9)
  assert.ok(checkSealed(forged))
  assert.equal(open(forged, keys), null)
  for (const bad of [null, 'x', {}, { ...rec, sig: 'zz' }, { ...rec, seq: 0 }, { ...rec, nonce: 'AAAA' }]) assert.equal(checkSealed(bad), null)
})

test('bad items are dropped when opening', () => {
  const keys = deriveKeys(seedA)
  const k = {
    v: 1,
    files: {
      [id('x')]: { at: NOW, entry: file('x') },
      [id('y')]: { at: NOW, entry: file('z') }, // listed under another id
      [id('w')]: { at: NOW, entry: { ...file('w'), encryptionKey: 'short' } },
      'not an id': { at: NOW, entry: file('v') },
      [id('u')]: { at: -1, entry: file('u') },
      [id('t')]: { at: NOW, entry: file('t', { role: 'admin' }) }
    },
    seeders: { nope: { at: NOW } }
  }
  const back = open(seal(k, keys, 1), keys)
  assert.deepEqual(files(back).map((f) => f.sheetId).sort(), [id('t'), id('x')])
  assert.equal(files(back).find((f) => f.sheetId === id('t')).role, undefined, 'an unknown role is dropped')
  assert.deepEqual(seeders(back), [])
})

test('merging keeps the later item, removals for 30 days, the same result either way', () => {
  const a = { v: 1, files: { [id('x')]: { at: NOW, entry: file('x') }, [id('y')]: { at: NOW, entry: file('y') } }, seeders: {} }
  const b = { v: 1, files: { [id('y')]: { at: NOW + 5, removed: true }, [id('z')]: { at: NOW, entry: file('z') } }, seeders: { ['d'.repeat(64)]: { at: NOW } } }
  const ab = merge(a, b, NOW + 10)
  assert.deepEqual(ab, merge(b, a, NOW + 10))
  assert.deepEqual(files(ab).map((f) => f.sheetId).sort(), [id('x'), id('z')], 'both devices\' files, without the removed one')
  assert.deepEqual(seeders(ab), ['d'.repeat(64)])
  // A slower device that still lists y does not bring it back.
  const slow = { v: 1, files: { [id('y')]: { at: NOW, entry: file('y') } }, seeders: {} }
  assert.ok(!files(merge(ab, slow, NOW + 20)).some((f) => f.sheetId === id('y')))
  // Joining it again later does.
  const rejoin = { v: 1, files: { [id('y')]: { at: NOW + 100, entry: file('y') } }, seeders: {} }
  assert.ok(files(merge(ab, rejoin, NOW + 200)).some((f) => f.sheetId === id('y')))
  // After 30 days the removal itself is dropped.
  assert.equal(merge(ab, empty(), NOW + 5 + TOMBSTONE_MS + 1).files[id('y')], undefined)
  assert.ok(merge(ab, empty(), NOW + TOMBSTONE_MS).files[id('y')].removed)
  // A tie goes the same way in either order.
  const t1 = { v: 1, files: { [id('q')]: { at: NOW, entry: file('q', { name: 'One' }) } }, seeders: {} }
  const t2 = { v: 1, files: { [id('q')]: { at: NOW, entry: file('q', { name: 'Two' }) } }, seeders: {} }
  assert.deepEqual(merge(t1, t2, NOW), merge(t2, t1, NOW))
})

test('a keyring too large to back up is refused when sealing', () => {
  const keys = deriveKeys(seedA)
  const k = empty()
  for (let i = 0; i < 5000; i++) {
    const sid = String(i).padStart(43, '0')
    k.files[sid] = { at: NOW, entry: { ...file('x'), sheetId: sid, name: 'n'.repeat(200) } }
  }
  assert.throws(() => seal(k, keys, 1), /too large/)
})
