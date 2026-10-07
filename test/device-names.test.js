// Linked devices and their names (proposals/2026-10-07-device-names.md):
// the `deviceName` op's checks, a device naming itself from its platform,
// renames reaching linked devices and every shared file, a viewer's rename
// appended by a writer and a device admitted later getting its name.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const m = require('../src/worklet/membership')
const { defaultName } = require('../src/worklet/devices')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

function keyPair () {
  const publicKey = b4a.alloc(32)
  const secretKey = b4a.alloc(64)
  sodium.crypto_sign_keypair(publicKey, secretKey)
  return { publicKey, secretKey }
}

// Just enough of a Hyperbee view for applyMembershipOp.
function fakeView () {
  const rows = new Map()
  return {
    rows,
    async get (key) { return rows.has(key) ? { key, value: rows.get(key) } : null },
    async put (key, value) { rows.set(key, value) },
    async del (key) { rows.delete(key) },
    async * createReadStream ({ gt, lt }) {
      for (const key of [...rows.keys()].sort()) if (key > gt && key < lt) yield { key, value: rows.get(key) }
    }
  }
}

test('the deviceName op', async (t) => {
  const sheetId = 'ab'.repeat(16)
  const alex = keyPair()
  const cam = keyPair()
  const A = hex(alex.publicKey)
  const C = hex(cam.publicKey)
  const wA = 'a1'.repeat(32)
  const wC = 'c1'.repeat(32)
  const devKey = 'd1'.repeat(32)
  const view = fakeView()
  await view.put('sheet', { sheetId, owner: A, version: 1 })
  await view.put('member/' + A, { identity: A, role: 'owner' })
  await view.put('member/' + C, { identity: C, role: 'editor' })
  await view.put('device/' + wA, { identity: A, writerKey: wA })
  await view.put('device/' + wC, { identity: C, writerKey: wC })
  const skipped = []
  const apply = (op, from = wA) => m.applyMembershipOp(op, { view, base: {}, groupId: sheetId, node: { from: { key: b4a.from(from, 'hex') } }, log: (s) => skipped.push(s) })
  const recA = () => view.rows.get('device/' + wA)
  const op = (fields) => m.deviceNameOp({ sheetId, identity: alex, deviceKey: devKey, writerKey: wA, name: 'Laptop', at: 100, kind: 'computer', ...fields })

  await t.test('a valid name applies', async () => {
    await apply(op({}))
    assert.equal(recA().name, 'Laptop')
    assert.equal(recA().nameAt, 100)
    assert.equal(recA().deviceKey, devKey)
    assert.equal(recA().kind, 'computer')
  })

  await t.test('another writer may append it for the person', async () => {
    await apply(op({ name: '  Work laptop  ', at: 200 }), wC)
    assert.equal(recA().name, 'Work laptop')
    assert.equal(recA().nameAt, 200)
  })

  await t.test('forged, wrong device, bad names and older ones are skipped', async () => {
    const forged = op({ name: 'Forged', at: 300 })
    forged.deviceName.name = 'Changed'
    await apply(forged)
    // Cam signs a name claiming to be Alex.
    const claimed = m.deviceNameOp({ sheetId, identity: cam, deviceKey: devKey, writerKey: wA, name: 'Mine now', at: 300 })
    claimed.deviceName.identity = A
    await apply(claimed, wC)
    // Alex names Cam's writer.
    await apply(op({ writerKey: wC, name: 'Not yours', at: 300 }))
    await apply(op({ name: '   ', at: 300 }))
    await apply(op({ name: 'x'.repeat(41), at: 300 }))
    await apply(op({ name: 'Bad\u0007name', at: 300 }))
    await apply(op({ name: 'Older', at: 150 }))
    await apply(op({ name: 'Same time', at: 200 }))
    await apply(op({ name: 'Other sheet', at: 300, sheetId: 'cd'.repeat(16) }))
    assert.equal(recA().name, 'Work laptop')
    assert.equal(recA().nameAt, 200)
    assert.equal(view.rows.get('device/' + wC).name, undefined)
    assert.equal(skipped.length, 9)
  })

  await t.test('40 characters is fine', async () => {
    await apply(op({ name: 'y'.repeat(40), at: 400 }))
    assert.equal(recA().name, 'y'.repeat(40))
    assert.equal(m.checkDeviceName('y'.repeat(41)), null)
    assert.equal(m.checkDeviceName(' Phone '), 'Phone')
  })

  await t.test('default names from the platform', () => {
    assert.equal(defaultName('linux').name, 'Linux computer')
    assert.equal(defaultName('win32').name, 'Windows computer')
    assert.equal(defaultName('darwin').name, 'Mac')
    assert.equal(defaultName('android').name, 'Android phone')
    assert.equal(defaultName('android').kind, 'phone')
    assert.equal(defaultName('ios').name, 'iPhone')
  })
})

test('linked devices and their names', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name, dir, platform) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm, platform })
    engines.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  const A = await device('Alex', tmpDir(), 'linux')
  const C = await device('Cam', tmpDir(), 'darwin')
  const keyA = hex(A.swarm.keyPair.publicKey)
  const { sheetId: own } = await call(A, 'sheet:create', { title: 'Mine' })
  const { sheetId: views } = await call(C, 'sheet:create', { title: 'Cam shares' })
  const { link: viewLink } = await call(C, 'sheet:invite', { sheetId: views, role: 'viewer' })
  await call(A, 'sheet:join', { link: viewLink })
  await waitFor('A joined as a viewer', async () => (await call(A, 'sheet:view', { sheetId: views })).myRole === 'viewer')

  // The name stored for a writer key in a file, as one engine sees it.
  async function nameIn (engine, sheetId, writerKey) {
    const node = await engine.bases.get(sheetId).view.get('device/' + writerKey)
    return node && node.value ? node.value.name || '' : ''
  }
  const writerOf = (engine, sheetId) => hex(engine.bases.get(sheetId).local.key)
  const listOf = async (engine) => call(engine, 'app:devices')

  await t.test('a device names itself from its platform', async () => {
    const list = await listOf(A)
    assert.equal(list.length, 1)
    assert.equal(list[0].deviceKey, keyA)
    assert.equal(list[0].name, 'Linux computer')
    assert.equal(list[0].thisDevice, true)
    assert.equal(list[0].kind, 'computer')
    assert.equal(list[0].lastSeen, null)
    await waitFor('the name is in its own file', async () => (await nameIn(A, own, writerOf(A, own))) === 'Linux computer')
    // A viewer's device: Cam's device appends it.
    await waitFor('and in the file it views', async () => (await nameIn(C, views, writerOf(A, views))) === 'Linux computer')
    await waitFor('both files counted', async () => (await listOf(A))[0].files === 2)
  })

  let B
  let keyB
  await t.test('a linked device shows on both, with its own name', async () => {
    const dirB = tmpDir()
    B = await device(null, dirB, 'android')
    const { link } = await call(A, 'link:start')
    await call(B, 'link:join', { link })
    await B.close()
    B = await device(null, dirB, 'android')
    keyB = hex(B.swarm.keyPair.publicKey)
    await waitFor('B has both files', async () => B.bases.get(own)?.writable && (await call(B, 'sheet:view', { sheetId: views })).myRole === 'viewer', { timeout: 40000 })
    await waitFor('A lists B', async () => (await listOf(A)).some((d) => d.deviceKey === keyB && d.name === 'Android phone' && d.kind === 'phone'), { timeout: 30000 })
    await waitFor('B lists A', async () => (await listOf(B)).some((d) => d.deviceKey === keyA && d.name === 'Linux computer'), { timeout: 30000 })
    const onB = await listOf(B)
    assert.equal(onB.length, 2)
    assert.equal(onB.find((d) => d.thisDevice).deviceKey, keyB)
  })

  await t.test('renaming on one shows on the other and in every file', async () => {
    await call(A, 'app:renameDevice', { deviceKey: keyB, name: 'Work phone' })
    assert.equal((await listOf(A)).find((d) => d.deviceKey === keyB).name, 'Work phone')
    await waitFor('B takes the name', async () => (await listOf(B)).find((d) => d.thisDevice).name === 'Work phone', { timeout: 30000 })
    await waitFor('in the file A owns', async () => (await nameIn(A, own, writerOf(B, own))) === 'Work phone', { timeout: 30000 })
    await waitFor('in the file A views, as Cam sees it', async () => (await nameIn(C, views, writerOf(B, views))) === 'Work phone', { timeout: 30000 })
  })

  await t.test('a rename made on a viewer device is appended by a writer', async () => {
    // B is a viewer in Cam's file: Cam's device appends the change for it.
    await call(B, 'app:renameDevice', { deviceKey: keyA, name: 'Desk' })
    await waitFor('Cam has it', async () => (await nameIn(C, views, writerOf(A, views))) === 'Desk', { timeout: 30000 })
    await waitFor('A takes it', async () => (await listOf(A)).find((d) => d.thisDevice).name === 'Desk', { timeout: 30000 })
  })

  await t.test('bad renames are refused', async () => {
    await assert.rejects(call(A, 'app:renameDevice', { deviceKey: keyA, name: '  ' }), /1 to 40/)
    await assert.rejects(call(A, 'app:renameDevice', { deviceKey: keyA, name: 'z'.repeat(41) }), /1 to 40/)
    await assert.rejects(call(A, 'app:renameDevice', { deviceKey: 'ef'.repeat(32), name: 'Who' }), /Unknown device/)
  })

  await t.test('a device admitted later gets its name', async () => {
    // Tidying up moves the file to a fresh copy; both devices are admitted
    // there anew.
    await call(A, 'sheet:compact', { sheetId: own })
    const to = (await A.localDb.get('moves:' + own)).value.to
    await waitFor('B follows', async () => B.bases.get(to)?.writable, { timeout: 40000 })
    await waitFor('both names in the new file', async () =>
      (await nameIn(A, to, writerOf(B, to))) === 'Work phone' && (await nameIn(A, to, writerOf(A, to))) === 'Desk', { timeout: 30000 })
  })
})
