// The recovery phrase brings files back from the seeder
// (proposals/2026-10-07-phrase-recovers-files.md, step 4).
//
// Ed owns a file alone, edits one Olive owns and owns a document only a
// viewer shares. He loses his only device and restores on a new one.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')

test('the phrase brings files back', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  const logs = []
  const device = async (name, dir = tmpDir()) => {
    const e = createSheetEngine({
      corestore: new Corestore(dir),
      createSwarm: mkSwarm,
      keyringGapMs: 300,
      restoreLookMs: 60000,
      log: (m) => { if (!name) logs.push(m); if (process.env.DEBUG_RESTORE) console.log('[' + (name || 'r') + '] ' + m) }
    })
    engines.push(e)
    await e.init({})
    if (name) await call(e, 'app:setName', { name })
    return e
  }
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const olive = await device('Olive')
  const val = await device('Val')
  const ed = await device('Ed')
  await call(ed, 'seeder:pair', { link: seeder.openPairing().link })
  const { sheetId: solo } = await call(ed, 'sheet:create', { title: 'Ed alone' })
  await call(ed, 'sheet:setCell', { sheetId: solo, row: 1, col: 1, input: 'only ed has this' })
  const { sheetId: olives } = await call(olive, 'sheet:create', { title: 'Olive owns' })
  await call(olive, 'sheet:setCell', { sheetId: olives, row: 1, col: 1, input: 'from olive' })
  const { link: oliveInvite } = await call(olive, 'sheet:invite', { sheetId: olives, role: 'editor' })
  await call(ed, 'sheet:join', { link: oliveInvite })
  await waitFor('Ed edits Olive\'s file', async () => !!ed.bases.get(olives) && ed.bases.get(olives).writable)
  const { sheetId: viewed } = await call(ed, 'sheet:create', { title: 'Val reads' })
  await call(ed, 'sheet:setCell', { sheetId: viewed, row: 1, col: 1, input: 'for val' })
  const { link: valInvite } = await call(ed, 'sheet:invite', { sheetId: viewed, role: 'viewer' })
  await call(val, 'sheet:join', { link: valInvite })
  await waitFor('Val reads it', async () => (await grid(val, viewed))['1,1'] === 'for val')

  // A folder with one of the files in it (proposals/2026-10-10-folders.md).
  const garden = await call(ed, 'file:newFolder', { name: 'Garden' })
  await call(ed, 'file:place', { sheetId: solo, folder: garden.id })

  // Ed's files and the keyring reach the seeder.
  for (const id of [solo, olives, viewed]) {
    await waitFor('the seeder holds ' + id.slice(0, 6), async () => seeder.allowedSheets().includes(hex(ed.bases.get(id).key)), { timeout: 40000 })
  }
  ed.keyring.poke({ soon: true })
  await waitFor('the keyring lists all three', async () => (await ed.keyring.run({ force: true })).held?.length === 1 && (await call(ed, 'app:keyring')).seeders === 1)
  await new Promise((resolve) => setTimeout(resolve, 3000)) // let the last blocks reach the seeder
  const edKey = hex(ed.identity.publicKey)
  const { phrase } = await call(ed, 'link:phrase')
  await ed.close()

  const dirR = tmpDir()
  let r = await device(null, dirR)
  assert.equal((await call(r, 'app:restorePhrase', { phrase })).restart, true)
  await r.close()
  r = await device(null, dirR)
  assert.equal(hex(r.identity.publicKey), edKey)

  await t.test('the files come back from the seeder, and the seeder takes the new device', async () => {
    await waitFor('restore done', async () => (await call(r, 'app:restoreStatus'))?.state === 'done', { timeout: 60000 })
    assert.equal((await call(r, 'app:restoreStatus')).files, 3)
    // Each file asks the seeder at once: its view, which names the seeder,
    // comes only from the seeder (a phone on the real network found it no
    // other way).
    for (const id of [solo, olives, viewed]) {
      await waitFor('asks the seeder for ' + id.slice(0, 6), async () => logs.some((m) => m.startsWith('registered ' + id.slice(0, 8))), { timeout: 5000 })
    }
    assert.equal(seeder.isPaired(r.swarm.keyPair.publicKey), true)
    assert.deepEqual((await call(r, 'seeder:list')).map((s) => s.seederKey), [hex(seeder.seederKey)])
    await waitFor('content from the seeder', async () => (await grid(r, solo))['1,1'] === 'only ed has this', { timeout: 40000 })
  })

  await t.test('and the folders they were in', async () => {
    const f = await call(r, 'file:folders')
    assert.deepEqual(f.folders, [{ id: garden.id, name: 'Garden' }])
    assert.deepEqual(f.places, { [solo]: garden.id })
  })

  await t.test('Olive\'s device lets him back into her file', async () => {
    await waitFor('admitted', async () => {
      const f = (await call(r, 'file:list')).find((x) => x.sheetId === olives)
      return f && !f.recovery && r.bases.get(olives).writable
    }, { timeout: 40000 })
    await call(r, 'sheet:setCell', { sheetId: olives, row: 2, col: 1, input: 'ed is back' })
    await waitFor('Olive sees it', async () => (await grid(olive, olives))['2,1'] === 'ed is back')
    assert.equal((await call(olive, 'sheet:members', { sheetId: olives })).members.filter((m) => m.identity === edKey).length, 1)
  })

  await t.test('files nobody else can let him into offer a copy he owns', async () => {
    const list = await call(r, 'file:list')
    assert.equal(list.find((x) => x.sheetId === solo).recovery, 'copy')
    assert.equal(list.find((x) => x.sheetId === viewed).recovery, 'copy', 'a viewer cannot let him in')
    await assert.rejects(call(r, 'file:recoverCopy', { sheetId: olives }), /recovery phrase|someone else/i)
    await waitFor('content of the viewer file', async () => (await grid(r, viewed))['1,1'] === 'for val')
    const { sheetId: copy } = await call(r, 'file:recoverCopy', { sheetId: solo })
    assert.notEqual(copy, solo)
    assert.equal((await grid(r, copy))['1,1'], 'only ed has this')
    const after = await call(r, 'file:list')
    assert.equal(after.find((x) => x.sheetId === copy).title, 'Ed alone', 'the same title')
    assert.ok(!after.some((x) => x.sheetId === solo), 'the old one is gone from the list')
    assert.ok(r.bases.get(copy).writable)
    await call(r, 'sheet:setCell', { sheetId: copy, row: 2, col: 1, input: 'editing again' })
    assert.equal((await call(r, 'sheet:members', { sheetId: copy })).members.find((m) => m.identity === edKey).role, 'owner')
  })
})
