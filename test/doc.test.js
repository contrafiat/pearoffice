// Documents (proposals/2026-10-06-documents.md, step 3): made, edited and
// shared like sheets. The editor's copy sends Yjs updates (doc:update) and
// gets everyone else's (doc:updated); viewers cannot edit; titles, the file
// list, invite links and tidying up work as for sheets.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const docModel = require('../src/doc/docModel')
const m = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

// A scratch copy of a device's document, as the editor keeps one.
async function replica (engine, sheetId) {
  const s = await call(engine, 'doc:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  return doc
}

async function text (engine, sheetId) {
  const doc = await replica(engine, sheetId)
  const out = docModel.plainText(doc)
  doc.destroy()
  return out
}

function paragraph (str) {
  const p = new Y.XmlElement('paragraph')
  const t = new Y.XmlText()
  t.insert(0, str)
  p.insert(0, [t])
  return p
}

// Change a copy the way the editor would and return the update, base64.
function change (doc, fn) {
  const before = Y.encodeStateVector(doc)
  doc.transact(() => fn(docModel.body(doc)))
  return b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64')
}

async function edit (engine, sheetId, fn) {
  const doc = await replica(engine, sheetId)
  const update = change(doc, fn)
  doc.destroy()
  return call(engine, 'doc:update', { sheetId, update })
}

test('in memory: concurrent typing converges whichever edit arrives first', () => {
  const base = new Y.Doc()
  docModel.initDoc(base, { title: 'T' })
  change(base, (body) => body.insert(0, [paragraph('hello')]))
  const state = Y.encodeStateAsUpdate(base)
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, state)
  Y.applyUpdate(b, state)
  const ua = b4a.from(change(a, (body) => body.get(0).get(0).insert(0, 'A ')), 'base64')
  const ub = b4a.from(change(b, (body) => body.get(0).get(0).insert(5, ' B')), 'base64')
  const x = new Y.Doc()
  const y = new Y.Doc()
  for (const d of [x, y]) Y.applyUpdate(d, state)
  Y.applyUpdate(x, ua); Y.applyUpdate(x, ub)
  Y.applyUpdate(y, ub); Y.applyUpdate(y, ua)
  assert.equal(docModel.plainText(x), 'A hello B')
  assert.equal(docModel.plainText(y), 'A hello B')
})

test('documents', async (t) => {
  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const engines = []
  const events = new Map() // engine -> [{ sheetId, update }]
  async function device (name) {
    const got = []
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: mkSwarm, onEvent: (ev, data) => { if (ev === 'doc:updated') got.push(data) } })
    events.set(e, got)
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    await testnet.destroy()
    cleanup()
  })

  const owner = await device('Owner')
  const editor = await device('Editor')
  const viewer = await device('Viewer')

  const { sheetId } = await call(owner, 'doc:create', { title: 'Notes' })

  await t.test('a new document is listed as a document', async () => {
    const list = await call(owner, 'file:list')
    const f = list.find((x) => x.sheetId === sheetId)
    assert.equal(f && f.kind, 'doc')
    assert.equal(f && f.title, 'Notes')
    const s = await call(owner, 'doc:state', { sheetId })
    assert.equal(s.myRole, 'owner')
    assert.equal(s.loading, false)
    assert.equal(s.newer, false)
  })

  await t.test('the owner types', async () => {
    const r = await edit(owner, sheetId, (body) => body.insert(0, [paragraph('First line')]))
    assert.equal(r.changed, true)
    assert.equal(await text(owner, sheetId), 'First line')
  })

  let link
  await t.test('a document invite link says it is a document', async () => {
    link = (await call(owner, 'file:invite', { sheetId, role: 'editor' })).link
    assert.match(link, /[?&]f=doc(&|$)/)
    assert.equal(m.parseInviteLink(link).kind, 'doc')
  })

  await t.test('an editor joins and sees the text', async () => {
    await call(editor, 'file:join', { link })
    await waitFor('editor joined', async () => (await call(editor, 'doc:state', { sheetId })).myRole === 'editor')
    await waitFor('editor has the text', async () => (await text(editor, sheetId)) === 'First line')
    await waitFor('editor writable', async () => editor.bases.get(sheetId).writable)
    const f = (await call(editor, 'file:list')).find((x) => x.sheetId === sheetId)
    assert.equal(f && f.kind, 'doc')
  })

  await t.test('an edit from another device reaches the editor as doc:updated', async () => {
    const seen = events.get(editor)
    seen.length = 0
    await edit(owner, sheetId, (body) => body.insert(1, [paragraph('Second line')]))
    await waitFor('event', async () => seen.some((x) => x.sheetId === sheetId))
    // The editor's copy, brought up to date only by the events.
    const doc = new Y.Doc()
    const s = await call(editor, 'doc:state', { sheetId })
    Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
    await waitFor('editor copy has it', async () => {
      for (const x of seen.splice(0)) if (x.sheetId === sheetId) Y.applyUpdate(doc, b4a.from(x.update, 'base64'), 'remote')
      return docModel.plainText(doc) === 'First line\nSecond line'
    })
    doc.destroy()
  })

  await t.test('a device does not get its own edits back as doc:updated', async () => {
    const seen = events.get(owner)
    await new Promise((resolve) => setTimeout(resolve, 300))
    seen.length = 0
    await edit(owner, sheetId, (body) => body.get(1).get(0).insert(0, '2: '))
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(seen.filter((x) => x.sheetId === sheetId).length, 0)
  })

  await t.test('concurrent edits from both devices converge', async () => {
    await Promise.all([
      edit(owner, sheetId, (body) => body.get(0).get(0).insert(0, 'O ')),
      edit(editor, sheetId, (body) => body.get(0).get(0).insert(10, ' E'))
    ])
    const want = 'O First line E\n2: Second line'
    await waitFor('owner converged', async () => (await text(owner, sheetId)) === want)
    await waitFor('editor converged', async () => (await text(editor, sheetId)) === want)
  })

  await t.test('a viewer cannot edit', async () => {
    const { link } = await call(owner, 'file:invite', { sheetId, role: 'viewer' })
    await call(viewer, 'file:join', { link })
    await waitFor('viewer joined', async () => (await call(viewer, 'doc:state', { sheetId })).myRole === 'viewer')
    await waitFor('viewer has the text', async () => (await text(viewer, sheetId)).startsWith('O First line E'))
    await assert.rejects(edit(viewer, sheetId, (body) => body.insert(0, [paragraph('nope')])), /view this file but not edit/)
    assert.equal((await text(viewer, sheetId)).includes('nope'), false)
  })

  // @ chips (proposals/2026-10-26-document-chips.md).
  await t.test('the first chip moves the document to version 3, and a viewer cannot', async () => {
    await assert.rejects(call(viewer, 'doc:useChips', { sheetId }), /view this file but not edit/)
    assert.equal((await call(owner, 'doc:state', { sheetId, withState: false })).version, 1)
    assert.deepEqual(await call(editor, 'doc:useChips', { sheetId }), { version: 3 })
    await waitFor('owner sees version 3', async () => (await call(owner, 'doc:state', { sheetId, withState: false })).version === 3)
    assert.equal((await call(owner, 'doc:state', { sheetId, withState: false })).newer, false)
    assert.deepEqual(await call(editor, 'doc:useChips', { sheetId }), { version: 3 })
  })

  await t.test('renaming a document', async () => {
    await call(editor, 'file:setTitle', { sheetId, title: 'Meeting notes' })
    await waitFor('owner sees the title', async () => (await call(owner, 'doc:state', { sheetId })).title === 'Meeting notes')
    const f = (await call(owner, 'file:list')).find((x) => x.sheetId === sheetId)
    assert.equal(f && f.title, 'Meeting notes')
  })

  await t.test('tidying up a document keeps its text', async () => {
    const before = await text(owner, sheetId)
    const { sheetId: newId } = await call(owner, 'file:compact', { sheetId })
    assert.notEqual(newId, sheetId)
    assert.equal(await text(owner, newId), before)
    assert.equal((await call(owner, 'doc:state', { sheetId: newId })).title, 'Meeting notes')
    assert.equal((await call(owner, 'file:list')).find((x) => x.sheetId === newId)?.kind, 'doc')
    await waitFor('editor followed', async () => !!(await editor.localDb.get('moves:' + sheetId))?.value?.to)
    await waitFor('editor has the text', async () => (await text(editor, newId)) === before, { timeout: 60000 })
    await waitFor('editor can edit the new copy', async () => editor.bases.get(newId) && editor.bases.get(newId).writable, { timeout: 60000 })
    await edit(editor, newId, (body) => body.insert(0, [paragraph('After tidy')]))
    await waitFor('owner sees it', async () => (await text(owner, newId)) === 'After tidy\n' + before)
  })
})
