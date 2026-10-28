// Tags (proposals/2026-10-28-file-tags.md): the records and their merge, the
// keyring sections, the search filter and two linked devices keeping the same
// tags.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { cleanTags, cleanTaggedAll, mergeTags, mergeTagged, view, withAll, cleanName, COLORS } = require('../src/worklet/tags')
const { TOMBSTONE_MS } = require('../src/worklet/folders')
const keyring = require('../src/worklet/keyring')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const T1 = '1'.repeat(32)
const T2 = '2'.repeat(32)
const T3 = '3'.repeat(32)
const S1 = 'A'.repeat(43)
const S2 = 'B'.repeat(43)
const NOW = 2_000_000_000_000

test('tag names are kept short and clean', () => {
  assert.equal(cleanName('  Bicycle  '), 'Bicycle')
  assert.equal(cleanName('Eco\u0000nomy\n  budget'), 'Economy budget')
  assert.equal(cleanName('x'.repeat(100)).length, 40)
  assert.equal(cleanName('   '), '')
  assert.equal(cleanName(7), '')
})

test('records are checked field by field', () => {
  const tags = cleanTags({
    [T1]: { at: 5, name: 'Bicycle', color: 'blue' },
    [T2]: { at: 6, removed: true },
    [T3]: { at: 7, name: 'No colour', color: 'neon' },
    short: { at: 1, name: 'Bad id' },
    ['4'.repeat(32)]: { at: -1, name: 'Bad time' }
  })
  assert.deepEqual(tags, { [T1]: { at: 5, name: 'Bicycle', color: 'blue' }, [T2]: { at: 6, removed: true }, [T3]: { at: 7, name: 'No colour', color: 'grey' } })
  const tagged = cleanTaggedAll({
    [S1 + ':' + T1]: { at: 5, on: true },
    [S2 + ':' + T1]: { at: 5, on: false },
    [S1 + ':short']: { at: 5, on: true },
    [S1 + ':' + T2]: { at: 5, on: 'yes' }
  })
  assert.deepEqual(tagged, { [S1 + ':' + T1]: { at: 5, on: true }, [S2 + ':' + T1]: { at: 5, on: false } })
  assert.deepEqual(cleanTags(null), {})
  assert.deepEqual(cleanTaggedAll('junk'), {})
})

test('merging keeps the later record, the same whatever the order', () => {
  const T = NOW - 1000
  const a = { [S1 + ':' + T1]: { at: T, on: true }, [S1 + ':' + T2]: { at: T, on: true } }
  const b = { [S1 + ':' + T1]: { at: T + 10, on: false }, [S1 + ':' + T2]: { at: T, on: false } }
  const ab = mergeTagged(a, b, NOW)
  assert.deepEqual(ab, mergeTagged(b, a, NOW))
  assert.deepEqual(ab[S1 + ':' + T1], { at: T + 10, on: false })
  assert.deepEqual(ab[S1 + ':' + T2], { at: T, on: false }, 'on a tie taking it off wins')
  // Two devices apart each add a different tag to one file: both stay.
  const both = mergeTagged({ [S1 + ':' + T1]: { at: T, on: true } }, { [S1 + ':' + T2]: { at: T + 1, on: true } }, NOW)
  assert.equal(Object.keys(both).length, 2)
  // Old removals go.
  assert.deepEqual(mergeTagged({ [S1 + ':' + T1]: { at: NOW - TOMBSTONE_MS - 1, on: false } }, {}, NOW), {})
  assert.deepEqual(mergeTags({ [T1]: { at: NOW - TOMBSTONE_MS - 1, removed: true } }, {}, NOW), {})
  assert.deepEqual(mergeTags({ [T1]: { at: T, name: 'Old', color: 'red' } }, { [T1]: { at: T + 1, name: 'New', color: 'red' } }, NOW)[T1].name, 'New')
})

test('the view: live tags by name, same names as one, removed tags off files', () => {
  const v = view(
    {
      [T1]: { at: 1, name: 'budget', color: 'red' },
      [T2]: { at: 2, name: 'Budget', color: 'blue' }, // made apart on another device
      [T3]: { at: 1, name: 'Bicycle', color: 'green' },
      ['4'.repeat(32)]: { at: 1, removed: true }
    },
    {
      [S1 + ':' + T2]: { at: 1, on: true },
      [S1 + ':' + T3]: { at: 1, on: true },
      [S2 + ':' + '4'.repeat(32)]: { at: 1, on: true },
      [S2 + ':' + T3]: { at: 1, on: false }
    }
  )
  assert.deepEqual(v.tags, [{ id: T3, name: 'Bicycle', color: 'green' }, { id: T1, name: 'budget', color: 'red' }])
  assert.deepEqual(v.files[S1].sort(), [T1, T3].sort(), 'the newer Budget counts as the older one')
  assert.equal(v.files[S2], undefined)
})

test('the search filter needs every picked tag', () => {
  const files = { [S1]: [T1, T2], [S2]: [T1] }
  assert.deepEqual(withAll([S1, S2], files, []), [S1, S2])
  assert.deepEqual(withAll([S1, S2], files, [T1]), [S1, S2])
  assert.deepEqual(withAll([S1, S2], files, [T1, T2]), [S1])
  assert.deepEqual(withAll([S1, S2], files, [T3]), [])
})

test('the keyring carries tags and drops them for files it does not list', () => {
  const entry = (sheetId) => ({ sheetId, groupKey: '1'.repeat(64), encryptionKey: '2'.repeat(64), bootstrap: '3'.repeat(64), name: 'x' })
  const a = { v: 1, files: { [S1]: { at: 1, entry: entry(S1) } }, seeders: {}, tags: { [T1]: { at: 1, name: 'Bicycle', color: 'blue' } }, tagged: { [S1 + ':' + T1]: { at: 1, on: true }, [S2 + ':' + T1]: { at: 1, on: true } } }
  const b = { v: 1, files: {}, seeders: {}, tags: { [T1]: { at: 2, name: 'Bikes', color: 'blue' } } }
  const m = keyring.merge(a, b, NOW)
  assert.deepEqual(m.tags, { [T1]: { at: 2, name: 'Bikes', color: 'blue' } })
  assert.deepEqual(m.tagged, { [S1 + ':' + T1]: { at: 1, on: true } })
  const older = keyring.clean({ v: 1, files: {}, seeders: {} })
  assert.deepEqual(older.tags, {})
  assert.deepEqual(older.tagged, {})
  const keys = keyring.deriveKeys(b4a.alloc(32, 7))
  const opened = keyring.open(keyring.seal(m, keys, 1), keys)
  assert.deepEqual(opened.tags, m.tags)
  assert.deepEqual(opened.tagged, m.tagged)
})

test('your devices keep the same tags', async (t) => {
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
  const tagsOf = (e) => call(e, 'file:tags')
  const same = async () => JSON.stringify(await tagsOf(A)) === JSON.stringify(await tagsOf(B))

  let file, bike
  await t.test('a tag made and put on a file on one device shows on the other', async () => {
    ;({ sheetId: file } = await call(A, 'sheet:create', { title: 'Bike budget' }))
    bike = await call(A, 'file:newTag', { name: 'Bicycle' })
    assert.ok(COLORS.includes(bike.color))
    await call(A, 'file:tag', { sheetId: file, id: bike.id })
    assert.deepEqual(await tagsOf(A), { tags: [bike], files: { [file]: [bike.id] } })
    await waitFor('B has the tag on the file', same, { timeout: 20000 })
  })

  await t.test('names, ids and limits are checked', async () => {
    await assert.rejects(call(A, 'file:newTag', { name: '  ' }), /needs a name/)
    assert.deepEqual(await call(A, 'file:newTag', { name: 'BICYCLE' }), bike, 'the same name in another case is the same tag')
    await assert.rejects(call(A, 'file:tag', { sheetId: file, id: '9'.repeat(32) }), /gone/)
    await assert.rejects(call(A, 'file:tag', { sheetId: 'nope', id: bike.id }), /Not a file/)
    const sport = await call(A, 'file:newTag', { name: 'Sports' })
    assert.notEqual(sport.color, bike.color, 'the next tag gets the next colour')
    await assert.rejects(call(A, 'file:renameTag', { id: sport.id, name: 'bicycle' }), /already have a tag/)
  })

  await t.test('tags added apart both stay once the devices meet', async () => {
    const budget = await call(A, 'file:newTag', { name: 'Budget' })
    await waitFor('B has Budget', async () => (await tagsOf(B)).tags.some((x) => x.id === budget.id), { timeout: 20000 })
    const sport = (await tagsOf(A)).tags.find((x) => x.name === 'Sports')
    await B.close()
    await call(A, 'file:tag', { sheetId: file, id: budget.id })
    await A.close()
    B = await device(null, dirB)
    await call(B, 'file:tag', { sheetId: file, id: sport.id })
    A = await device(null, dirA)
    await waitFor('both have all three tags on the file', async () => {
      const a = await tagsOf(A)
      return (a.files[file] || []).length === 3 && await same()
    }, { timeout: 20000 })
  })

  await t.test('rename, take off and delete reach the other device', async () => {
    await call(B, 'file:renameTag', { id: bike.id, name: 'Bikes' })
    await waitFor('A has the new name', async () => (await tagsOf(A)).tags.some((x) => x.id === bike.id && x.name === 'Bikes'), { timeout: 20000 })
    const sport = (await tagsOf(A)).tags.find((x) => x.name === 'Sports')
    await call(A, 'file:tag', { sheetId: file, id: sport.id, on: false })
    await waitFor('B took it off', async () => !(await tagsOf(B)).files[file].includes(sport.id), { timeout: 20000 })
    await call(A, 'file:deleteTag', { id: sport.id })
    await waitFor('B has no Sports', async () => !(await tagsOf(B)).tags.some((x) => x.id === sport.id) && await same(), { timeout: 20000 })
  })

  await t.test('a file that moves to fresh keys keeps its tags', async () => {
    const want = (await tagsOf(A)).files[file].slice().sort()
    const { sheetId: moved } = await call(A, 'file:compact', { sheetId: file })
    assert.notEqual(moved, file)
    await waitFor('A tagged the new copy', async () => JSON.stringify(((await tagsOf(A)).files[moved] || []).slice().sort()) === JSON.stringify(want), { timeout: 15000 })
    await waitFor('so did B', async () => JSON.stringify(((await tagsOf(B)).files[moved] || []).slice().sort()) === JSON.stringify(want), { timeout: 30000 })
  })
})
