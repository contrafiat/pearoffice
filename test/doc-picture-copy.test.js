// Copying a picture from one document into another
// (src/ui/doc/pictures.js): the clipboard names the file a picture came
// from, and a paste into another file stores the bytes again there and
// points the node at the new copy. happy-dom stands in for the page. Only
// strings, numbers and booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const Y = require('yjs')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { Window } = require('happy-dom')
const { createSheetEngine } = require('../src/worklet/engine')
const { hashOf, parseRef } = require('../src/worklet/pictures')
const docModel = require('../src/doc/docModel')
const { tmpDir, cleanup, call } = require('./helpers')

globalThis.window = new Window()
globalThis.document = window.document
const pictures = () => import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'pictures.js'))
const extensions = () => import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'extensions.js'))

// Any bytes do: the worklet stores and hashes them, it does not decode them.
const PIC = new Uint8Array(Array.from({ length: 300 }, (_, i) => (i * 31) % 256))
const b64 = (bytes) => Buffer.from(bytes).toString('base64')

async function stateOf (engine, sheetId) {
  const s = await call(engine, 'doc:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  return doc
}

// Put an image node with these attributes in the document, as a paste does.
async function pasteNode (engine, sheetId, attrs) {
  const doc = await stateOf(engine, sheetId)
  const before = Y.encodeStateVector(doc)
  const el = new Y.XmlElement('image')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  docModel.body(doc).push([el])
  const update = Y.encodeStateAsUpdate(doc, before)
  doc.destroy()
  await call(engine, 'doc:update', { sheetId, update: b64(update) })
}

function refsIn (doc) {
  return docModel.images(doc).map((n) => n.getAttribute('ref') + '|' + n.getAttribute('hash'))
}

test('a picture copied into another document is stored again there', async (t) => {
  const p = await pictures()
  const { documentExtensions } = await extensions()
  const { getSchema } = await import('@tiptap/core')
  const testnet = await createTestnet(3)
  const engine = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => {
    try { await engine.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  await engine.init({})
  const send = (method, args) => call(engine, method, args)
  const { sheetId: a } = await send('doc:create', { title: 'A' })
  const { sheetId: b } = await send('doc:create', { title: 'B' })
  const pic = await send('doc:addPicture', { sheetId: a, bytes: b64(PIC), mime: 'image/png', width: 40, height: 20 })

  // Copy: the clipboard HTML names file A on the picture.
  const schema = getSchema(documentExtensions())
  const node = schema.nodeFromJSON({ type: 'doc', content: [{ type: 'image', attrs: { ref: pic.ref, hash: pic.hash, mime: pic.mime, w: pic.w, h: pic.h } }] })
  const box = window.document.createElement('div')
  p.pictureClipboard(() => schema, a).serializeFragment(node.content, { document: window.document }, box)
  const html = '<meta charset="utf-8"><div data-pm-slice="0 0 []">' + box.innerHTML + '</div>'
  assert.equal(html.includes('data-file="' + a + '"'), true)
  assert.equal(p.foreignPictures(html, a).length, 0) // the same document: left as it is
  const found = p.foreignPictures(html, b)
  assert.equal(found.length, 1)
  assert.equal(found[0].ref + '|' + found[0].file + '|' + found[0].mime + '|' + found[0].w + 'x' + found[0].h, pic.ref + '|' + a + '|image/png|40x20')

  // Paste into B: the node arrives with A's reference, then is moved.
  await pasteNode(engine, b, { ref: pic.ref, hash: pic.hash, mime: 'image/png', w: 40, h: 20 })
  const r = await p.adoptPictures(found, { sheetId: b, call: send })
  assert.equal(r.lost, false)
  assert.equal(r.done.size, 1)
  const moved = r.done.get(pic.ref)
  assert.equal(parseRef(moved.ref).key === parseRef(pic.ref).key, false)
  assert.equal(moved.hash, hashOf(PIC))
  const docB = await stateOf(engine, b)
  assert.equal(refsIn(docB).join(','), moved.ref + '|' + moved.hash)
  assert.equal(docModel.version(docB), 2)
  docB.destroy()
  const got = await send('doc:picture', { sheetId: b, ref: moved.ref })
  assert.equal(hashOf(b4a.from(got.data, 'base64')), hashOf(PIC))
  // A's copy is untouched.
  const gotA = await send('doc:picture', { sheetId: a, ref: pic.ref, hash: pic.hash })
  assert.equal(hashOf(b4a.from(gotA.data, 'base64')), hashOf(PIC))

  // From a file this device does not have (another device's copy): the bytes
  // kept from the copy are used.
  const away = { ...found[0], file: 'ff'.repeat(32) }
  const clip = new Map([[pic.ref, Promise.resolve(new Blob([PIC], { type: 'image/png' }))]])
  const r2 = await p.adoptPictures([away], { sheetId: b, call: send, clip })
  assert.equal(r2.lost, false)
  assert.equal(r2.done.get(pic.ref).hash, hashOf(PIC))

  // And with nothing kept: left out, the node keeps the old reference.
  await pasteNode(engine, b, { ref: pic.ref, hash: pic.hash, mime: 'image/png', w: 40, h: 20 })
  const r3 = await p.adoptPictures([away], { sheetId: b, call: send, clip: new Map() })
  assert.equal(r3.lost, true)
  assert.equal(r3.done.size, 0)
  const docB2 = await stateOf(engine, b)
  assert.equal(refsIn(docB2).includes(pic.ref + '|' + pic.hash), true)
  docB2.destroy()
})

test('a copy keeps the bytes of its pictures for a later paste', async () => {
  const p = await pictures()
  const cache = p.pictureCache(async () => PIC)
  p.noteCopied([{ ref: 'r1', hash: 'h', mime: 'image/png' }], cache)
  const r = await p.adoptPictures([{ ref: 'r1', hash: 'h', mime: 'image/png', w: 1, h: 1, file: 'gone' }], {
    sheetId: 'b',
    call: async (method, args) => {
      if (method === 'doc:picture') throw new Error('unknown sheet')
      return { ref: 'new', hash: hashOf(Buffer.from(args.bytes, 'base64')), mime: args.mime, w: args.width, h: args.height }
    }
  })
  assert.equal(r.lost, false)
  assert.equal(r.done.get('r1').hash, hashOf(PIC))
})
