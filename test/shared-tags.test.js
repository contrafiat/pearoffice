// Sharing tags with a file (proposals/2026-10-29-shared-tags.md): the
// owner's tags on a file reach the people in it as their own tags, a tag
// taken off stays off, a viewer cannot share and the list is cleaned.

const test = require('node:test')
const assert = require('node:assert/strict')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { cleanShared } = require('../src/worklet/tags')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

test('cleanShared keeps up to 20 named tags, one per name, in known colours', () => {
  assert.deepEqual(cleanShared([{ name: ' Shopping ', color: 'green' }, { name: 'shopping', color: 'red' }, { name: '', color: 'red' }, { name: 'Food', color: 'neon' }, 'x']), [{ name: 'Shopping', color: 'green' }, { name: 'Food', color: 'grey' }])
  assert.equal(cleanShared(Array.from({ length: 30 }, (_, i) => ({ name: 'T' + i, color: 'blue' }))).length, 20)
  assert.deepEqual(cleanShared(null), [])
})

test('shared tags', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  async function device (dir = tmpDir()) {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    engines.push(e)
    await e.init({})
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })
  const names = async (e, sheetId) => {
    const v = await call(e, 'file:tags')
    return (v.files[sheetId] || []).map((id) => v.tags.find((x) => x.id === id).name).sort()
  }

  const owner = await device()
  const { sheetId } = await call(owner, 'doc:create', { title: 'Shopping list' })
  const shopping = await call(owner, 'file:newTag', { name: 'Shopping' })
  await call(owner, 'file:tag', { sheetId, id: shopping.id, on: true })

  await t.test('the owner shares their tags on the file', async () => {
    assert.deepEqual(await call(owner, 'file:shareTags', { sheetId }), { tags: [], sharing: false })
    const r = await call(owner, 'file:shareTags', { sheetId, on: true })
    assert.deepEqual(r, { tags: [{ name: 'Shopping', color: shopping.color }], sharing: true })
    // The owner's own tag is not made twice.
    assert.equal((await call(owner, 'file:tags')).tags.length, 1)
  })

  const editor = await device()
  const viewer = await device()
  // The editor has a tag of that name already, in another case.
  const theirs = await call(editor, 'file:newTag', { name: 'shopping' })
  for (const [e, role] of [[editor, 'editor'], [viewer, 'viewer']]) {
    const { link } = await call(owner, 'file:invite', { sheetId, role })
    await call(e, 'file:join', { link })
    await waitFor(role + ' joined', async () => (await call(e, 'doc:state', { sheetId, withState: false })).myRole === role)
  }

  await t.test('people who join get them as their own tags', async () => {
    await waitFor('editor tagged', async () => (await names(editor, sheetId)).join() === 'shopping')
    const v = await call(editor, 'file:tags')
    assert.deepEqual(v.files[sheetId], [theirs.id])
    await waitFor('viewer tagged', async () => (await names(viewer, sheetId)).join() === 'Shopping')
    assert.equal((await call(viewer, 'file:tags')).tags[0].color, shopping.color)
  })

  await t.test('a new tag on the file follows while the owner shares', async () => {
    const food = await call(owner, 'file:newTag', { name: 'Food' })
    await call(owner, 'file:tag', { sheetId, id: food.id, on: true })
    await waitFor('shared list updated', async () => (await call(owner, 'file:shareTags', { sheetId })).tags.length === 2)
    await waitFor('editor has Food', async () => (await names(editor, sheetId)).join() === 'Food,shopping')
  })

  await t.test('a tag taken off stays off', async () => {
    await waitFor('viewer has Food on the file', async () => (await names(viewer, sheetId)).includes('Food'))
    const food = (await call(viewer, 'file:tags')).tags.find((x) => x.name === 'Food')
    await call(viewer, 'file:tag', { sheetId, id: food.id, on: false })
    // The owner shares another, so the file's list changes again.
    const recipes = await call(owner, 'file:newTag', { name: 'Recipes' })
    await call(owner, 'file:tag', { sheetId, id: recipes.id, on: true })
    await waitFor('viewer has Recipes', async () => (await names(viewer, sheetId)).includes('Recipes'))
    assert.deepEqual(await names(viewer, sheetId), ['Recipes', 'Shopping'])
  })

  await t.test('a viewer cannot share, and turning it off leaves the others theirs', async () => {
    await assert.rejects(call(viewer, 'file:shareTags', { sheetId, on: true }), /view this file but not edit/)
    const r = await call(owner, 'file:shareTags', { sheetId, on: false })
    assert.deepEqual(r, { tags: [], sharing: false })
    await waitFor('editor sees none shared', async () => (await call(editor, 'file:shareTags', { sheetId })).tags.length === 0)
    assert.deepEqual(await names(editor, sheetId), ['Food', 'Recipes', 'shopping'])
  })
})
