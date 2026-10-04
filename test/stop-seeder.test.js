// Stop backing up to a seeder (proposals/2026-10-04-stop-backing-up.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const DAY = 24 * 3600 * 1000
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))

test('stop backing up to a seeder', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name) {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const owner = await device('Owner')
  const editor = await device('Editor')
  const seederKey = hex(seeder.seederKey)
  for (const e of [owner, editor]) await call(e, 'seeder:pair', { link: seeder.openPairing().link })

  const { sheetId } = await call(owner, 'sheet:create', { title: 'Trip' })
  await call(owner, 'sheet:setCell', { sheetId, row: 1, col: 1, input: 'tent' })
  const { link } = await call(owner, 'sheet:invite', { sheetId, role: 'editor' })
  await call(editor, 'sheet:join', { link })
  await waitFor('editor in', async () => editor.bases.get(sheetId)?.writable)
  const bootstrap = hex(owner.bases.get(sheetId).key)
  await waitFor('seeder holds it', async () => seeder.allowedSheets().includes(bootstrap))
  const listed = async (e) => (await call(e, 'seeder:sheet', { sheetId })).listed.map((x) => x.seederKey)
  await waitFor('both see the listing', async () => (await listed(owner)).length === 1 && (await listed(editor)).length === 1)

  await t.test('only the owner or whoever listed a seeder can take it off', async () => {
    const view = await call(editor, 'seeder:sheet', { sheetId })
    assert.deepEqual(view.listed.map((x) => [x.seederKey, x.canStop]), [[seederKey, false]])
    await assert.rejects(call(editor, 'seeder:removeFromSheet', { sheetId, seederKey }), /Only the owner or whoever added/)
    await editor.append(sheetId, m.seederOffOp({ sheetId, identity: editor.identity, seederKey }))
    await sleep(800)
    assert.deepEqual(await listed(owner), [seederKey], 'a forged seeder-off is skipped')
  })

  await t.test('taking a seeder off stops backups and drops the copy after a week', async () => {
    const core = seeder.peer.store.get({ key: owner.bases.get(sheetId).local.key })
    await core.ready()
    await call(owner, 'seeder:removeFromSheet', { sheetId, seederKey })
    await waitFor('off on both devices', async () => !(await listed(owner)).length && !(await listed(editor)).length)
    await waitFor('drop scheduled', async () => (await seeder.drops()).some((d) => d.sheet === bootstrap))
    const { due } = (await seeder.drops()).find((d) => d.sheet === bootstrap)
    assert.ok(due > Date.now() + 6 * DAY && due < Date.now() + 8 * DAY)

    // New edits no longer reach the seeder.
    await sleep(1000)
    const before = core.length
    for (let i = 2; i < 6; i++) await call(owner, 'sheet:setCell', { sheetId, row: i, col: 1, input: 'x' + i })
    await sleep(2000)
    assert.equal(core.length, before, 'the seeder got nothing new')
    await core.close()

    // The editor is paired with the same seeder but does not list it again.
    await editor.seeding.sweep()
    await sleep(500)
    assert.deepEqual(await listed(editor), [])
  })

  await t.test('listing it again within the week cancels the drop', async () => {
    const view = await call(owner, 'seeder:sheet', { sheetId })
    assert.deepEqual(view.available, [seederKey])
    await call(owner, 'seeder:addToSheet', { sheetId, seederKey })
    await waitFor('drop cancelled', async () => !(await seeder.drops()).some((d) => d.sheet === bootstrap))
    assert.equal(await seeder.runDrops(Date.now() + 8 * DAY), 0)
    assert.ok(seeder.allowedSheets().includes(bootstrap))
  })

  await t.test('stop using a seeder takes it off your own listings and leaves the others', async () => {
    const { sheetId: own } = await call(editor, 'sheet:create', { title: 'Editor notes' })
    await call(editor, 'sheet:setCell', { sheetId: own, row: 1, col: 1, input: 'n' })
    const ownBootstrap = hex(editor.bases.get(own).key)
    await waitFor('seeder holds the editor sheet', async () => seeder.allowedSheets().includes(ownBootstrap))
    const preview = await call(editor, 'seeder:stopPreview', { seederKey })
    assert.deepEqual([preview.stop.map((x) => x.sheetId), preview.keep.map((x) => x.sheetId)], [[own], [sheetId]])
    const r = await call(editor, 'seeder:stopUsing', { seederKey })
    assert.deepEqual(r, { stopped: 1, keptByOthers: 1 })
    assert.deepEqual(await call(editor, 'seeder:list'), [])
    assert.ok((await seeder.drops()).some((d) => d.sheet === ownBootstrap), 'the editor sheet will be dropped')
    assert.ok(!(await seeder.drops()).some((d) => d.sheet === bootstrap), 'the shared one stays')
    assert.deepEqual(await listed(owner), [seederKey])
  })

  await t.test('forgetting a device drops only the sheets nobody else paired registered', async () => {
    const { sheetId: solo } = await call(owner, 'sheet:create', { title: 'Solo' })
    await call(owner, 'sheet:setCell', { sheetId: solo, row: 1, col: 1, input: 's' })
    const soloBootstrap = hex(owner.bases.get(solo).key)
    await waitFor('seeder holds solo', async () => seeder.allowedSheets().includes(soloBootstrap))
    const devices = await seeder.devices()
    assert.equal(devices.length, 2)
    const ownerDevice = hex(owner.swarm.keyPair.publicKey)
    const r = await seeder.forgetDevice(ownerDevice)
    assert.equal(r.forgotten, true)
    const drops = (await seeder.drops()).map((d) => d.sheet)
    assert.ok(drops.includes(soloBootstrap), 'solo is dropped')
    assert.ok(!drops.includes(bootstrap), 'the shared sheet stays: the editor device still registers it')
    assert.equal((await seeder.devices()).length, 1)
    const keep = await owner.seeding.requestKeep({ bootstrap: soloBootstrap, seederKeys: [seederKey] })
    assert.match(keep[0].error, /Only paired devices/)
  })
})
