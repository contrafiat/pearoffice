// Pictures in and out of files (proposals/2026-10-06-document-images.md,
// src/ui/doc/docFiles.js): .md data: URLs, .docx pictures, web addresses left
// out and an import storing its pictures. happy-dom stands in for the page;
// shrinking (a canvas) is replaced by a pass-through. Only strings, numbers
// and booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const zlib = require('node:zlib')
const Y = require('yjs')
const b4a = require('b4a')
const fflate = require('fflate')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { Window } = require('happy-dom')
const { createSheetEngine } = require('../src/worklet/engine')
const { hashOf, parseRef } = require('../src/worklet/pictures')
const docModel = require('../src/doc/docModel')
const { tmpDir, cleanup, call } = require('./helpers')

let engine = null
globalThis.window = new Window()
globalThis.document = window.document
window.pearoffice = { call: (method, args) => call(engine, method, args), on: () => () => {} }
const load = () => import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))
const enc = (s) => new TextEncoder().encode(s)

// A small real PNG, w x h, RGB.
function png (w, h) {
  const table = []
  for (let n = 0; n < 256; n++) { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; table[n] = c >>> 0 }
  const crc = (b) => { let c = 0xffffffff; for (const x of b) c = table[(c ^ x) & 255] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0 }
  const chunk = (type, data) => {
    const len = Buffer.alloc(4); len.writeUInt32BE(data.length)
    const td = Buffer.concat([Buffer.from(type), data])
    const c = Buffer.alloc(4); c.writeUInt32BE(crc(td))
    return Buffer.concat([len, td, c])
  }
  const ihdr = Buffer.alloc(13); ihdr.writeUInt32BE(w, 0); ihdr.writeUInt32BE(h, 4); ihdr[8] = 8; ihdr[9] = 2
  const raw = Buffer.alloc((w * 3 + 1) * h)
  for (let y = 0; y < h; y++) for (let x = 0; x < w; x++) { const i = y * (w * 3 + 1) + 1 + x * 3; raw[i] = x * 7; raw[i + 1] = y * 5; raw[i + 2] = 99 }
  return new Uint8Array(Buffer.concat([Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]), chunk('IHDR', ihdr), chunk('IDAT', zlib.deflateSync(raw)), chunk('IEND', Buffer.alloc(0))]))
}

const PIC = png(40, 20)
const b64 = (bytes) => Buffer.from(bytes).toString('base64')
const images = (json) => {
  const out = []
  const walk = (n) => { for (const c of n.content || []) { if (c.type === 'image') out.push(c); walk(c) } }
  walk(json)
  return out
}

// The JSON's pictures given sizes and bytes, as an open document would have.
function withPictures (json) {
  const pics = new Map()
  for (const n of images(json)) {
    n.attrs = { ...n.attrs, mime: 'image/png', w: 40, h: 20 }
    pics.set(n.attrs.ref, { bytes: PIC, mime: 'image/png' })
  }
  return pics
}

test('a .md picture as a data: URL comes in; one at a web address is left out', async () => {
  const f = await load()
  const md = '# Trip\n\nBefore ![A dot](data:image/png;base64,' + b64(PIC) + ') after.\n\n![Web](https://example.com/x.png)\n'
  const r = await f.fileToJson('Trip.md', enc(md))
  assert.equal(r.pictures.length, 1)
  assert.equal(r.pictures[0].mime, 'image/png')
  assert.equal(hashOf(Buffer.from(r.pictures[0].data, 'base64')), hashOf(PIC))
  assert.equal(r.dropped, true)
  const imgs = images(r.json)
  assert.equal(imgs.length, 1)
  assert.equal(imgs[0].attrs.ref + '|' + imgs[0].attrs.alt, 'pending:0|A dot')
})

test('.md export writes pictures as data: URLs and reads back the same bytes', async () => {
  const f = await load()
  const { json } = await f.fileToJson('a.md', enc('Text\n\n![Dot](data:image/png;base64,' + b64(PIC) + ')\n'))
  const pics = withPictures(json)
  const out = f.toMarkdown(json, pics)
  assert.equal(out.includes('![Dot](data:image/png;base64,'), true)
  const back = await f.fileToJson('b.md', enc(out))
  assert.equal(back.pictures.length, 1)
  assert.equal(hashOf(Buffer.from(back.pictures[0].data, 'base64')), hashOf(PIC))
  assert.equal(f.toText(json).includes('[Picture: Dot]'), true)
})

test('.docx export carries the picture and an import reads it back', async () => {
  const f = await load()
  const { json } = await f.fileToJson('a.md', enc('Text\n\n![Dot](data:image/png;base64,' + b64(PIC) + ')\n'))
  const pics = withPictures(json)
  images(json)[0].attrs.width = 50
  const docx = await f.toDocx(json, 'Pic', pics)
  const files = fflate.unzipSync(docx)
  const media = Object.keys(files).filter((k) => /^word\/media\/.+\.png$/.test(k))
  assert.equal(media.length, 1)
  assert.equal(hashOf(Buffer.from(files[media[0]])), hashOf(PIC))
  assert.equal(fflate.strFromU8(files['word/document.xml']).includes('descr="Dot"'), true)
  const back = await f.fileToJson('Pic.docx', docx)
  assert.equal(back.pictures.length, 1)
  assert.equal(hashOf(Buffer.from(back.pictures[0].data, 'base64')), hashOf(PIC))
  assert.equal(images(back.json).length, 1)
})

test('the printable page embeds pictures as data: URLs', async () => {
  const f = await load()
  const { json } = await f.fileToJson('a.md', enc('![Dot](data:image/png;base64,' + b64(PIC) + ')\n'))
  const html = f.toHtml(json, 'T', withPictures(json))
  assert.equal(html.includes('src="data:image/png;base64,' + b64(PIC) + '"'), true)
})

test('importing a file stores its pictures and points the document at them', async (t) => {
  const f = await load()
  const testnet = await createTestnet(3)
  engine = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  t.after(async () => {
    try { await engine.close() } catch {}
    await testnet.destroy()
    cleanup()
  })
  await engine.init({})
  const md = '# Trip\n\n![A dot](data:image/png;base64,' + b64(PIC) + ')\n\n![Web](https://example.com/x.png)\n'
  const prepare = async (bytes, mime) => ({ bytes, mime, w: 40, h: 20 })
  const r = await f.importDocument(enc(md), 'Trip.md', { prepare })
  assert.equal(r.dropped, true)
  const s = await call(engine, 'doc:state', { sheetId: r.sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  assert.equal(docModel.version(doc), 2)
  const nodes = docModel.images(doc)
  assert.equal(nodes.length, 1)
  const ref = nodes[0].getAttribute('ref')
  assert.equal(!!parseRef(ref), true)
  assert.equal(nodes[0].getAttribute('hash'), hashOf(PIC))
  assert.equal(nodes[0].getAttribute('w') + 'x' + nodes[0].getAttribute('h'), '40x20')
  doc.destroy()
  const got = await call(engine, 'doc:picture', { sheetId: r.sheetId, ref })
  assert.equal(hashOf(b4a.from(got.data, 'base64')), hashOf(PIC))
})
