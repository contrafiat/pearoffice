// Your devices keep the same files (proposals/2026-10-07-own-devices-files.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { generateKeypair } = require('@peerloom/core/identity')
const { createSheetEngine } = require('../src/worklet/engine')
const { makeHello, checkHello, cleanEntry, ownTopic } = require('../src/worklet/ownDevices')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const listed = async (e) => (await call(e, 'file:list')).map((f) => f.sheetId)

test('a hello must be signed by this identity for this connection', () => {
  const me = generateKeypair()
  const other = generateKeypair()
  const a = 'aa'.repeat(32)
  const b = 'bb'.repeat(32)
  const now = 1_000_000_000_000
  const hello = makeHello(me, a, b, now)
  const check = (msg, over = {}) => checkHello(msg, { identity: hex(me.publicKey), device: a, peer: b, now, ...over })
  assert.equal(check(hello), true)
  assert.equal(check(hello, { device: 'cc'.repeat(32) }), false, 'signed for a different device key')
  assert.equal(check(hello, { peer: 'cc'.repeat(32) }), false, 'meant for another device')
  assert.equal(check(hello, { identity: hex(other.publicKey) }), false, 'another identity')
  assert.equal(check(hello, { now: now + 11 * 60 * 1000 }), false, 'too old')
  assert.equal(check(makeHello(other, a, b, now)), false, 'signed by someone else')
  assert.equal(check({ ...hello, device: 'cc'.repeat(32) }, { device: 'cc'.repeat(32) }), false, 'device changed after signing')
  assert.equal(check({ ...hello, at: now + 1 }), false, 'time changed after signing')
  assert.equal(check(null), false)
})

test('received entries are checked field by field', () => {
  const good = { sheetId: 'A'.repeat(43), groupKey: '1'.repeat(64), encryptionKey: '2'.repeat(64), bootstrap: '3'.repeat(64), name: 'Plan', kind: 'doc' }
  assert.equal(JSON.stringify(cleanEntry(good)), JSON.stringify(good))
  assert.equal(cleanEntry({ ...good, sheetId: 'short' }), null)
  assert.equal(cleanEntry({ ...good, groupKey: 'zz'.repeat(32) }), null)
  assert.equal(cleanEntry({ ...good, encryptionKey: '2'.repeat(63) }), null)
  assert.equal(cleanEntry({ ...good, bootstrap: null }), null)
  assert.equal(cleanEntry({ ...good, kind: 'virus' }).kind, undefined)
  assert.equal(cleanEntry({ ...good, name: 'x'.repeat(5000) }).name.length, 200)
})

test('your devices keep the same files', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  async function device (name, dir = tmpDir()) {
    const tag = name || 'new'
    const log = process.env.DEBUG_OWN ? (m) => console.log(Date.now() % 100000, tag, m) : undefined
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, log })
    open.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of open) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  const A = await device('Alex')
  const dirB = tmpDir()
  let B = await device(null, dirB)
  {
    const { link } = await call(A, 'link:start')
    await call(B, 'link:join', { link })
    await B.close()
    B = await device(null, dirB)
    assert.equal(hex(B.identity.publicKey), hex(A.identity.publicKey))
  }

  let first
  await t.test('a file made on one device appears on the other and can be edited there', async () => {
    const started = Date.now()
    const { sheetId } = await call(A, 'sheet:create', { title: 'Made on A' })
    first = sheetId
    await call(A, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'from A' })
    await waitFor('B lists it', async () => (await listed(B)).includes(sheetId), { timeout: 15000 })
    const took = Date.now() - started
    console.log('# listed on B after ' + took + ' ms')
    assert.ok(took < 15000)
    await waitFor('B has the content', async () => (await grid(B, sheetId))['1,1'] === 'from A', { timeout: 20000 })
    await waitFor('B can write', async () => !!(B.bases.get(sheetId) && B.bases.get(sheetId).writable), { timeout: 30000 })
    await call(B, 'sheet:setCell', { sheetId, row: 2, col: 1, input: 'from B' })
    await waitFor('A sees the edit', async () => (await grid(A, sheetId))['2,1'] === 'from B', { timeout: 20000 })
    assert.equal(A.ownDevices.stats.refused, 0)
    assert.equal(B.ownDevices.stats.refused, 0)
  })

  await t.test('a file made while the other device was off arrives when it comes back', async () => {
    await B.close()
    const { sheetId } = await call(A, 'doc:create', { title: 'Made while B was off' })
    B = await device(null, dirB)
    await waitFor('B lists it', async () => (await listed(B)).includes(sheetId), { timeout: 20000 })
    await waitFor('B has the content', async () => (await call(B, 'file:list')).some((f) => f.sheetId === sheetId && f.title === 'Made while B was off' && f.kind === 'doc'), { timeout: 20000 })
  })

  await t.test('a file removed on one device is not added back to it', async () => {
    assert.equal((await call(B, 'sheet:removeLocal', { sheetId: first })).ok, true)
    assert.equal((await listed(B)).includes(first), false)
    await B.close()
    B = await device(null, dirB)
    const total = (await listed(A)).length
    // B has looked at everything A sent after the restart.
    await waitFor('B heard the whole list', async () => B.ownDevices.stats.seen >= total, { timeout: 20000 })
    assert.equal((await listed(B)).includes(first), false)
    assert.equal(!!B.bases.get(first), false)
    assert.equal(!!(await B.localDb.get('groups:joined:' + first)), false)
    // And A still has it: the removal stayed on B.
    assert.equal((await listed(A)).includes(first), true)
  })

  await t.test('nor is its new copy after the owner tidies it up', async () => {
    const { sheetId: tidied } = await call(A, 'file:compact', { sheetId: first })
    assert.notEqual(tidied, first)
    await waitFor('B kept the new copy away', async () => B.ownDevices.stats.skipped >= 1, { timeout: 15000 })
    assert.equal((await listed(B)).includes(tidied), false)
    assert.equal(!!(await B.localDb.get('removed:' + tidied)), true)
  })

  await t.test('a device with another identity gets nothing, even on the topic', async () => {
    const C = await device('Cam')
    const forced = ownTopic(A.identity.secretKey.subarray(0, 32))
    assert.equal(hex(forced), hex(A.ownDevices.topic))
    const refusedBefore = A.ownDevices.stats.refused + B.ownDevices.stats.refused
    C.ownDevices.start(forced)
    await waitFor('A or B refused its hello', async () => A.ownDevices.stats.refused + B.ownDevices.stats.refused > refusedBefore, { timeout: 20000 })
    await waitFor('C refused theirs', async () => C.ownDevices.stats.refused > 0, { timeout: 20000 })
    await new Promise((resolve) => setTimeout(resolve, 1000))
    assert.equal(C.ownDevices.stats.accepted, 0)
    assert.equal(C.ownDevices.stats.seen, 0)
    assert.equal(C.ownDevices.stats.opened, 0)
    assert.equal((await listed(C)).length, 0)
    // A file made now does not reach it either.
    const { sheetId } = await call(A, 'sheet:create', { title: 'Not for Cam' })
    await waitFor('B lists it', async () => (await listed(B)).includes(sheetId), { timeout: 15000 })
    assert.equal((await listed(C)).length, 0)
    assert.equal(C.ownDevices.stats.seen, 0)
  })
})
