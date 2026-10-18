// Templates (proposals/2026-10-18-templates.md): a mark in the file that
// everyone in it sees, and a new file of one's own made from it, with fresh
// keys, the content and no comments, mark or other people.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { hashOf, parseRef } = require('../src/worklet/pictures')
const docModel = require('../src/doc/docModel')
const { tmpDir, cleanup, waitFor, call, grid } = require('./helpers')

const PIC = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 31) % 256))
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

function network (t) {
  const engines = []
  let testnet = null
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    if (testnet) await testnet.destroy()
    cleanup()
  })
  return async function device (name) {
    if (!testnet) testnet = await createTestnet(3)
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
}

const listed = async (engine, sheetId) => (await call(engine, 'file:list')).find((f) => f.sheetId === sheetId)

test('a shared template: the viewer sees the mark and makes a file of their own', async (t) => {
  const device = network(t)
  const owner = await device('Owner')
  const viewer = await device('Viewer')

  const { sheetId: tpl } = await call(owner, 'sheet:create', { title: 'Recipe' })
  await call(owner, 'sheet:setCells', { sheetId: tpl, row: 1, col: 1, grid: [['Flour', '200'], ['Servings', '=B1/50']] })
  await call(owner, 'sheet:setFormat', { sheetId: tpl, row: 1, col: 1, patch: { b: true } })
  await call(owner, 'sheet:addComment', { sheetId: tpl, row: 1, col: 1, text: 'Owner notes' })
  await call(owner, 'file:setTemplate', { sheetId: tpl, template: true })
  assert.equal((await listed(owner, tpl)).template, true)

  const { link } = await call(owner, 'sheet:invite', { sheetId: tpl, role: 'viewer' })
  await call(viewer, 'sheet:join', { link })
  await waitFor('viewer has the template', async () => (await listed(viewer, tpl))?.template === true && (await grid(viewer, tpl))['2,2'] === '=B1/50 -> 4')
  await assert.rejects(call(viewer, 'file:setTemplate', { sheetId: tpl, template: false }))

  const { sheetId: copy } = await call(viewer, 'file:fromTemplate', { sheetId: tpl })
  assert.notEqual(copy, tpl)
  assert.deepEqual(await grid(viewer, copy), await grid(viewer, tpl))
  const v = await call(viewer, 'sheet:view', { sheetId: copy })
  assert.equal(v.myRole, 'owner')
  assert.equal(v.title, 'Recipe')
  assert.equal(v.cells.find((c) => c.row === 1 && c.col === 1).fmt.b, true)
  assert.equal(v.comments.length, 0)
  const members = await call(viewer, 'file:members', { sheetId: copy })
  assert.equal(members.members.length, 1)
  assert.equal(members.members[0].isMe && members.members[0].role === 'owner', true)
  assert.equal((await listed(viewer, copy)).template, undefined)
  // The copy can be edited by its maker; the template is unchanged.
  await call(viewer, 'sheet:setCell', { sheetId: copy, row: 1, col: 2, input: '400' })
  await waitFor('copy recalculated', async () => (await grid(viewer, copy))['2,2'] === '=B1/50 -> 8')
  assert.equal((await grid(viewer, tpl))['2,2'], '=B1/50 -> 4')
  // The owner never gets the viewer's file.
  assert.equal(await listed(owner, copy), undefined)

  // Only a template can be copied this way; unmarking stops it.
  await call(owner, 'file:setTemplate', { sheetId: tpl, template: false })
  assert.equal((await listed(owner, tpl)).template, undefined)
  await assert.rejects(call(owner, 'file:fromTemplate', { sheetId: tpl }), /not a template/)
})

test('a document template brings its pictures under the new file\'s key', async (t) => {
  const device = network(t)
  const me = await device('Me')
  const { sheetId: tpl } = await call(me, 'doc:create', { title: 'Meeting notes' })
  const pic = await call(me, 'doc:addPicture', { sheetId: tpl, bytes: b64(PIC), mime: 'image/png', width: 40, height: 20 })
  const s = await call(me, 'doc:state', { sheetId: tpl })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  const before = Y.encodeStateVector(doc)
  const p = new Y.XmlElement('paragraph')
  p.insert(0, [new Y.XmlText('Agenda')])
  const img = new Y.XmlElement('image')
  for (const [k, v] of Object.entries({ ref: pic.ref, hash: pic.hash, mime: 'image/png', w: 40, h: 20 })) img.setAttribute(k, v)
  docModel.body(doc).push([p, img])
  await call(me, 'doc:update', { sheetId: tpl, update: b64(Y.encodeStateAsUpdate(doc, before)) })
  doc.destroy()
  await call(me, 'file:setTemplate', { sheetId: tpl, template: true })

  const { sheetId: copy } = await call(me, 'file:fromTemplate', { sheetId: tpl })
  const c = await call(me, 'doc:state', { sheetId: copy })
  const got = new Y.Doc()
  Y.applyUpdate(got, b4a.from(c.state, 'base64'))
  assert.equal(docModel.body(got).toString().includes('Agenda'), true)
  const refs = docModel.images(got).map((n) => n.getAttribute('ref'))
  assert.equal(refs.length, 1)
  assert.equal(parseRef(refs[0]).key === parseRef(pic.ref).key, false)
  assert.equal(got.getMap('meta').get('template'), undefined)
  got.destroy()
  const bytes = await call(me, 'doc:picture', { sheetId: copy, ref: refs[0] })
  assert.equal(hashOf(b4a.from(bytes.data, 'base64')), hashOf(PIC))
})
