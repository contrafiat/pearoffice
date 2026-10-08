// Seeders keep keyrings (proposals/2026-10-07-phrase-recovers-files.md, step 2):
// only paired devices put them, anyone with the locator gets them, the seeder
// announces each on its topic, a device proving the sign key counts as
// paired, and the limits hold.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const { deriveKeys, seal, open, files, signClaim } = require('../src/worklet/keyring')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const seedOf = (e) => b4a.from(e.identity.secretKey.subarray(0, 32))
const entry = { sheetId: 'k'.repeat(43), groupKey: 'a'.repeat(64), encryptionKey: 'b'.repeat(64), bootstrap: 'c'.repeat(64), name: 'Budget', kind: 'sheet' }
const ring = (at) => ({ v: 1, files: { [entry.sheetId]: { at, entry } }, seeders: {} })

test('seeders keep keyrings', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  const mk = async () => {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    return e
  }
  const seederDir = tmpDir()
  let seeder = await createSeeder({ dataDir: seederDir, bootstrap: testnet.bootstrap })
  const finder = new Hyperswarm({ bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await finder.destroy() } catch {}
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const A = await mk() // paired
  const C = await mk() // a device restored from A's phrase: not paired yet
  await call(A, 'seeder:pair', { link: seeder.openPairing().link })
  const sk = hex(seeder.seederKey)
  const keys = deriveKeys(seedOf(A))
  const locator = hex(keys.locator)

  await t.test('a paired device puts a keyring; seq must grow', async () => {
    assert.deepEqual(await A.seeding.keyringPut(sk, seal(ring(1), keys, 1)), { seq: 1 })
    await assert.rejects(A.seeding.keyringPut(sk, seal(ring(2), keys, 1)), /newer file list/)
    assert.deepEqual(await A.seeding.keyringPut(sk, seal(ring(2), keys, 2)), { seq: 2 })
    assert.equal((await seeder.status()).keyrings, 1)
  })

  await t.test('others cannot put or replace it', async () => {
    await assert.rejects(C.seeding.keyringPut(sk, seal(ring(3), keys, 3)), /Only paired devices/)
    const other = deriveKeys(b4a.alloc(32, 7))
    await assert.rejects(A.seeding.keyringPut(sk, seal(ring(3), { ...other, locator: keys.locator }, 9)), /someone else/)
    const bad = seal(ring(3), keys, 3)
    await assert.rejects(A.seeding.keyringPut(sk, { ...bad, seq: 4 }), /does not check out/)
  })

  await t.test('anyone with the locator gets the latest version, and only the phrase opens it', async () => {
    const rec = await C.seeding.keyringGet(sk, locator)
    assert.equal(rec.seq, 2)
    assert.deepEqual(files(open(rec, keys)), [entry])
    assert.equal(open(rec, deriveKeys(seedOf(C))), null)
    assert.equal(await C.seeding.keyringGet(sk, 'f'.repeat(64)), null)
  })

  await t.test('the seeder announces it on the keyring topic', async () => {
    const found = new Promise((resolve) => finder.on('connection', (conn) => { conn.on('error', () => {}); if (b4a.equals(conn.remotePublicKey, seeder.seederKey)) resolve(true) }))
    finder.join(keys.topic, { server: false, client: true })
    assert.equal(await found, true)
  })

  await t.test('a device that proves the sign key is paired', async () => {
    const cKey = hex(C.swarm.keyPair.publicKey)
    // Signed for another device: refused.
    await assert.rejects(C.seeding.keyringClaim(sk, locator, signClaim(keys.signKeyPair, locator, sk, hex(A.swarm.keyPair.publicKey))), /does not check out/)
    // Signed by another seed: refused.
    await assert.rejects(C.seeding.keyringClaim(sk, locator, signClaim(deriveKeys(b4a.alloc(32, 8)).signKeyPair, locator, sk, cKey)), /does not check out/)
    assert.equal(seeder.isPaired(C.swarm.keyPair.publicKey), false)
    assert.deepEqual(await C.seeding.keyringClaim(sk, locator, signClaim(keys.signKeyPair, locator, sk, cKey)), { paired: true })
    assert.equal(seeder.isPaired(C.swarm.keyPair.publicKey), true)
    assert.deepEqual((await call(C, 'seeder:list')).map((s) => s.seederKey), [sk], 'C remembers the seeder')
    assert.deepEqual(await C.seeding.keyringPut(sk, seal(ring(5), keys, 5)), { seq: 5 })
  })

  await t.test('at most 4 keyrings per device', async () => {
    for (let i = 10; i < 13; i++) await A.seeding.keyringPut(sk, seal(ring(1), deriveKeys(b4a.alloc(32, i)), 1))
    await assert.rejects(A.seeding.keyringPut(sk, seal(ring(1), deriveKeys(b4a.alloc(32, 13)), 1)), /too many/)
    // Its own keyring can still change.
    await A.seeding.keyringPut(sk, seal(ring(6), keys, 6))
  })

  await t.test('keyrings survive a restart and go when their devices are forgotten', async () => {
    await seeder.close()
    seeder = await createSeeder({ dataDir: seederDir, bootstrap: testnet.bootstrap })
    assert.equal((await seeder.status()).keyrings, 4)
    await waitFor('the seeder is back', async () => {
      try { return (await A.seeding.keyringGet(sk, locator))?.seq === 6 } catch { return false }
    })
    await seeder.forgetDevice(hex(A.swarm.keyPair.publicKey))
    assert.equal((await seeder.status()).keyrings, 1, 'C still has the shared one')
    await seeder.forgetDevice(hex(C.swarm.keyPair.publicKey))
    assert.equal((await seeder.status()).keyrings, 0)
  })
})
