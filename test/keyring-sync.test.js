// Devices keep their keyring on their seeders up to date
// (proposals/2026-10-07-phrase-recovers-files.md, step 3).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const { deriveKeys, open } = require('../src/worklet/keyring')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('devices keep their keyring on their seeders', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  const mk = async (dir = tmpDir(), more = {}) => {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, keyringGapMs: 200, ...more })
    engines.push(e)
    await e.init({})
    return e
  }
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  const sk = hex(seeder.seederKey)

  const A = await mk()
  const keys = deriveKeys(b4a.from(A.identity.secretKey.subarray(0, 32)))
  // What the seeder holds, as the phrase opens it: sheet id -> 'name' or 'removed'.
  const held = async (e) => {
    const rec = await e.seeding.keyringGet(sk, hex(keys.locator)).catch(() => null)
    const k = rec && open(rec, keys)
    if (!k) return {}
    return Object.fromEntries(Object.entries(k.files).map(([id, i]) => [id, i.removed ? 'removed' : i.entry.name]))
  }
  const same = (a, b) => JSON.stringify(Object.entries(a).sort()) === JSON.stringify(Object.entries(b).sort())

  await t.test('nothing is written without a seeder', async () => {
    await call(A, 'sheet:create', { title: 'Early' })
    assert.deepEqual(await A.keyring.run(), { written: false })
    assert.equal((await call(A, 'app:keyring')).seeders, 0)
  })

  let early, x, y
  await t.test('after pairing, the files are backed up and kept up to date', async () => {
    early = (await call(A, 'file:list')).find((f) => f.title === 'Early').sheetId
    await call(A, 'seeder:pair', { link: seeder.openPairing().link })
    A.keyring.poke({ soon: true })
    x = (await call(A, 'sheet:create', { title: 'X' })).sheetId
    y = (await call(A, 'doc:create', { title: 'Y' })).sheetId
    await waitFor('the seeder lists Early, X and Y', async () => same(await held(A), { [early]: 'Early', [x]: 'X', [y]: 'Y' }))
    const st = await call(A, 'app:keyring')
    assert.equal(st.seeders, 1)
    assert.equal(st.paired, 1)
    await call(A, 'sheet:removeLocal', { sheetId: y })
    await waitFor('Y is marked removed', async () => (await held(A))[y] === 'removed')
  })

  await t.test('a second device of the same person merges, losing nothing', async () => {
    const { phrase } = await call(A, 'link:phrase')
    const dirB = tmpDir()
    let B = await mk(dirB)
    assert.equal((await call(B, 'app:restorePhrase', { phrase })).restart, true)
    await B.close()
    B = await mk(dirB)
    assert.equal(hex(B.identity.publicKey), hex(A.identity.publicKey))
    await call(B, 'seeder:pair', { link: seeder.openPairing().link })
    const z = (await call(B, 'sheet:create', { title: 'Z' })).sheetId
    B.keyring.poke({ soon: true })
    await waitFor('the seeder lists A\'s and B\'s files', async () => {
      const h = await held(B)
      return h[x] === 'X' && h[z] === 'Z' && h[y] === 'removed' && h[early] === 'Early'
    })
    const w = (await call(A, 'sheet:create', { title: 'W' })).sheetId
    await waitFor('A adds W and keeps Z', async () => {
      const h = await held(A)
      return h[w] === 'W' && h[z] === 'Z' && h[y] === 'removed'
    })
  })

  // A rename in the same millisecond as the last write still wins, with the
  // clock frozen: the old name sorts later, so a tie would keep it.
  await t.test('a change in the same millisecond as the last write is kept', async () => {
    const B = await mk(tmpDir(), { keyringNow: () => 1700000000000 })
    const bKeys = deriveKeys(b4a.from(B.identity.secretKey.subarray(0, 32)))
    const name = async (id) => {
      const rec = await B.seeding.keyringGet(sk, hex(bKeys.locator)).catch(() => null)
      const k = rec && open(rec, bKeys)
      return k && k.files[id] && k.files[id].entry ? k.files[id].entry.name : null
    }
    await call(B, 'seeder:pair', { link: seeder.openPairing().link })
    const id = (await call(B, 'sheet:create', { title: 'Zeta' })).sheetId
    await waitFor('Zeta written', async () => { await B.keyring.run(); return (await name(id)) === 'Zeta' })
    await call(B, 'file:setTitle', { sheetId: id, title: 'Alpha' })
    await waitFor('Alpha written', async () => { await B.keyring.run(); return (await name(id)) === 'Alpha' })
  })
})
