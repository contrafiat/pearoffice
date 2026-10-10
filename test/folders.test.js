// Folders (proposals/2026-10-10-folders.md): the records and their merge, the
// keyring sections, and two linked devices keeping the same folders.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { cleanFolders, cleanPlaces, mergeRecords, view, cleanName, TOMBSTONE_MS } = require('../src/worklet/folders')
const keyring = require('../src/worklet/keyring')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const F1 = '1'.repeat(32)
const F2 = '2'.repeat(32)
const S1 = 'A'.repeat(43)
const S2 = 'B'.repeat(43)
const NOW = 2_000_000_000_000

test('folder names are kept short and clean', () => {
  assert.equal(cleanName('  Garden  '), 'Garden')
  assert.equal(cleanName('Gar\u0000den\n'), 'Garden')
  assert.equal(cleanName('x'.repeat(300)).length, 100)
  assert.equal(cleanName('   '), '')
  assert.equal(cleanName(42), '')
})

test('records are checked field by field', () => {
  const folders = cleanFolders({
    [F1]: { at: 5, name: 'Garden' },
    [F2]: { at: 6, removed: true },
    short: { at: 1, name: 'Bad id' },
    ['3'.repeat(32)]: { at: -1, name: 'Bad time' },
    ['4'.repeat(32)]: { at: 1, name: '' }
  })
  assert.deepEqual(folders, { [F1]: { at: 5, name: 'Garden' }, [F2]: { at: 6, removed: true } })
  const places = cleanPlaces({
    [S1]: { at: 5, folder: F1 },
    [S2]: { at: 5, folder: null },
    ['C'.repeat(43)]: { at: 5, folder: 'not a folder' },
    short: { at: 5, folder: F1 }
  })
  assert.deepEqual(places, { [S1]: { at: 5, folder: F1 }, [S2]: { at: 5, folder: null } })
  assert.deepEqual(cleanFolders(null), {})
  assert.deepEqual(cleanPlaces('junk'), {})
})

test('merging keeps the later record, the same whatever the order', () => {
  const T = NOW - 1000
  const a = { [F1]: { at: T, name: 'Old name' }, [F2]: { at: T, name: 'Same time' } }
  const b = { [F1]: { at: T + 10, name: 'New name' }, [F2]: { at: T, removed: true } }
  const ab = mergeRecords(a, b, NOW)
  assert.deepEqual(ab, mergeRecords(b, a, NOW))
  assert.deepEqual(ab[F1], { at: T + 10, name: 'New name' })
  assert.deepEqual(ab[F2], { at: T, removed: true }, 'on a tie the removal wins')
  // A removal older than 30 days is dropped.
  const old = mergeRecords({ [F1]: { at: NOW - TOMBSTONE_MS - 1, removed: true } }, {}, NOW)
  assert.deepEqual(old, {})
})

test('a file in a removed or unknown folder shows at the top level', () => {
  const v = view(
    { [F1]: { at: 1, name: 'b garden' }, [F2]: { at: 1, removed: true }, ['3'.repeat(32)]: { at: 1, name: 'A budget' } },
    { [S1]: { at: 1, folder: F1 }, [S2]: { at: 1, folder: F2 }, ['C'.repeat(43)]: { at: 1, folder: '9'.repeat(32) }, ['D'.repeat(43)]: { at: 1, folder: null } }
  )
  assert.deepEqual(v.folders.map((f) => f.name), ['A budget', 'b garden'], 'sorted by name, any case')
  assert.deepEqual(v.places, { [S1]: F1 })
})

test('the keyring carries folders and drops places for files it does not list', () => {
  const entry = (sheetId) => ({ sheetId, groupKey: '1'.repeat(64), encryptionKey: '2'.repeat(64), bootstrap: '3'.repeat(64), name: 'x' })
  const a = { v: 1, files: { [S1]: { at: 1, entry: entry(S1) } }, seeders: {}, folders: { [F1]: { at: 1, name: 'Garden' } }, places: { [S1]: { at: 1, folder: F1 }, [S2]: { at: 1, folder: F1 } } }
  const b = { v: 1, files: {}, seeders: {}, folders: { [F1]: { at: 2, name: 'Garden 2026' } } }
  const m = keyring.merge(a, b, NOW)
  assert.deepEqual(m.folders, { [F1]: { at: 2, name: 'Garden 2026' } })
  assert.deepEqual(m.places, { [S1]: { at: 1, folder: F1 } })
  // A keyring from an older build has no folders.
  const older = keyring.clean({ v: 1, files: {}, seeders: {} })
  assert.deepEqual(older.folders, {})
  assert.deepEqual(older.places, {})
  // Sealed and opened, the folders come back.
  const keys = keyring.deriveKeys(b4a.alloc(32, 7))
  const opened = keyring.open(keyring.seal(m, keys, 1), keys)
  assert.deepEqual(opened.folders, m.folders)
  assert.deepEqual(opened.places, m.places)
})

test('your devices keep the same folders', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  async function device (name, dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
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

  const dirA = tmpDir()
  let A = await device('Alex', dirA)
  const dirB = tmpDir()
  let B = await device(null, dirB)
  {
    const { link } = await call(A, 'link:start')
    await call(B, 'link:join', { link })
    await B.close()
    B = await device(null, dirB)
    assert.equal(hex(B.identity.publicKey), hex(A.identity.publicKey))
  }
  const folders = (e) => call(e, 'file:folders')

  let garden, file
  await t.test('a folder made and a file filed on one device show on the other', async () => {
    ;({ sheetId: file } = await call(A, 'sheet:create', { title: 'Seeds' }))
    garden = await call(A, 'file:newFolder', { name: 'Garden' })
    await call(A, 'file:place', { sheetId: file, folder: garden.id })
    assert.deepEqual(await folders(A), { folders: [{ id: garden.id, name: 'Garden' }], places: { [file]: garden.id } })
    await waitFor('B has the folder and the file in it', async () => JSON.stringify(await folders(B)) === JSON.stringify(await folders(A)), { timeout: 20000 })
  })

  await t.test('names and folders are checked', async () => {
    await assert.rejects(call(A, 'file:newFolder', { name: '   ' }), /needs a name/)
    await assert.rejects(call(A, 'file:renameFolder', { id: '9'.repeat(32), name: 'x' }), /gone/)
    await assert.rejects(call(A, 'file:place', { sheetId: file, folder: '9'.repeat(32) }), /gone/)
    await assert.rejects(call(A, 'file:place', { sheetId: 'nope', folder: null }), /Not a file/)
  })

  await t.test('changes made apart agree once the devices meet', async () => {
    const shed = await call(A, 'file:newFolder', { name: 'Shed' })
    const { sheetId: tools } = await call(A, 'sheet:create', { title: 'Tools' })
    await waitFor('B has Shed', async () => (await folders(B)).folders.some((f) => f.id === shed.id), { timeout: 20000 })
    await B.close()
    // A, alone: renames Garden and files Tools in Shed.
    await call(A, 'file:renameFolder', { id: garden.id, name: 'Garden 2026' })
    await call(A, 'file:place', { sheetId: tools, folder: shed.id })
    await A.close()
    // B, alone and later: deletes Shed and renames Garden too.
    B = await device(null, dirB)
    await new Promise((resolve) => setTimeout(resolve, 20))
    await call(B, 'file:deleteFolder', { id: shed.id })
    await call(B, 'file:renameFolder', { id: garden.id, name: 'Allotment' })
    A = await device(null, dirA)
    const want = { folders: [{ id: garden.id, name: 'Allotment' }], places: { [file]: garden.id } }
    await waitFor('A took the later changes', async () => JSON.stringify(await folders(A)) === JSON.stringify(want), { timeout: 20000 })
    await waitFor('B agrees', async () => JSON.stringify(await folders(B)) === JSON.stringify(want), { timeout: 20000 })
    // Tools was filed in Shed, which is gone: it shows at the top level.
    assert.equal((await folders(A)).places[tools], undefined)
  })

  await t.test('a file that moves to fresh keys stays in its folder', async () => {
    const { sheetId: moved } = await call(A, 'file:compact', { sheetId: file })
    assert.notEqual(moved, file)
    await waitFor('A filed the new copy', async () => (await folders(A)).places[moved] === garden.id, { timeout: 15000 })
    await waitFor('so did B', async () => (await folders(B)).places[moved] === garden.id, { timeout: 30000 })
  })

  await t.test('deleting a folder leaves its files', async () => {
    const before = (await call(A, 'file:list')).length
    await call(A, 'file:deleteFolder', { id: garden.id })
    assert.deepEqual(await folders(A), { folders: [], places: {} })
    assert.equal((await call(A, 'file:list')).length, before)
    await waitFor('B too', async () => (await folders(B)).folders.length === 0, { timeout: 20000 })
  })
})
