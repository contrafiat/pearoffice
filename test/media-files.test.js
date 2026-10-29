// PDFs and pictures as files (proposals/2026-10-29-pdf-and-picture-files.md):
// added in parts, read back in parts, the same bytes on a viewer who joins,
// held blind by the seeder, carried when someone is removed, and the checks.

const test = require('node:test')
const assert = require('node:assert/strict')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const { hashOf, parseRef } = require('../src/worklet/pictures')
const { looksLike, PART } = require('../src/media/mediaMethods')
const { parseInviteLink } = require('../src/worklet/membership')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const MARKER = 'PEAROFFICE-MEDIA-MARKER-7731'

// A "PDF" of `size` bytes: the header, noise and a marker in the middle.
function pdfBytes (size, seed) {
  const out = b4a.alloc(size)
  let x = seed
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = x & 255 }
  b4a.from('%PDF-1.7\n').copy(out, 0)
  b4a.from(MARKER).copy(out, Math.floor(size / 2))
  return out
}

async function add (engine, bytes, { mime = 'application/pdf', name = 'Manual.pdf', ...extra } = {}) {
  const { id, part } = await call(engine, 'media:begin', { mime, name, size: bytes.byteLength })
  for (let i = 0; i < bytes.byteLength; i += part) await call(engine, 'media:part', { id, data: b4a.toString(bytes.subarray(i, i + part), 'base64') })
  return call(engine, 'media:end', { id, ...extra })
}

async function read (engine, sheetId) {
  const parts = []
  let size = Infinity
  for (let at = 0; at < size; at += PART) {
    const r = await call(engine, 'media:read', { sheetId, offset: at })
    size = r.size
    parts.push(b4a.from(r.data, 'base64'))
  }
  return b4a.concat(parts)
}

test('looksLike checks the first bytes', () => {
  assert.equal(looksLike(b4a.from('%PDF-1.4 x'), 'application/pdf'), true)
  assert.equal(looksLike(b4a.from('<html>'), 'application/pdf'), false)
  assert.equal(looksLike(b4a.from([0xff, 0xd8, 0xff, 0xe0]), 'image/jpeg'), true)
  assert.equal(looksLike(b4a.from('\x89PNG\r\n\x1a\n...', 'latin1'), 'image/png'), true)
  assert.equal(looksLike(b4a.from('GIF89a..'), 'image/gif'), true)
  assert.equal(looksLike(b4a.from('RIFF....WEBPVP8 '), 'image/webp'), true)
  assert.equal(looksLike(b4a.from('RIFF....WAVE'), 'image/webp'), false)
})

test('PDF and picture files', async (t) => {
  const testnet = await createTestnet(3)
  const seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: testnet.bootstrap })
  const engines = []
  async function device (name) {
    const e = createSheetEngine({ corestore: new Corestore(tmpDir()), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
    engines.push(e)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  t.after(async () => {
    for (const e of engines) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  })

  const owner = await device('Owner')
  await call(owner, 'seeder:pair', { link: seeder.openPairing().link })
  // Over 2 MB, the limit for pictures in documents, in several parts.
  const bytes = pdfBytes(3 * 1024 * 1024 + 123, 5)
  const want = hashOf(bytes)
  let sheetId = null

  await t.test('a PDF goes in by parts and reads back the same', async () => {
    sheetId = (await add(owner, bytes, { pages: 12 })).sheetId
    const info = await call(owner, 'media:info', { sheetId })
    assert.equal(info.kind, 'pdf')
    assert.equal(info.title, 'Manual')
    assert.equal(info.myRole, 'owner')
    assert.deepEqual({ ...info.media, ref: null }, { ref: null, hash: want, mime: 'application/pdf', size: bytes.byteLength, name: 'Manual.pdf', w: null, h: null, pages: 12 })
    assert.equal(hashOf(await read(owner, sheetId)), want)
    const f = (await call(owner, 'file:list')).find((x) => x.sheetId === sheetId)
    assert.equal(f.kind, 'pdf')
    assert.equal(f.title, 'Manual')
  })

  await t.test('refusals: other types, too big, a lie about the size, not a PDF', async () => {
    await assert.rejects(call(owner, 'media:begin', { mime: 'application/zip', name: 'a.zip', size: 10 }), /PDFs and pictures/)
    await assert.rejects(call(owner, 'media:begin', { mime: 'application/pdf', name: 'a.pdf', size: 25 * 1024 * 1024 + 1 }), /bigger than 25 MB/)
    const { id } = await call(owner, 'media:begin', { mime: 'application/pdf', name: 'a.pdf', size: 4 })
    await assert.rejects(call(owner, 'media:part', { id, data: b4a.toString(b4a.from('%PDF-1'), 'base64') }), /bigger than it said/)
    await assert.rejects(add(owner, b4a.from('<html>not a pdf</html>')), /not a PDF/)
    await assert.rejects(add(owner, b4a.from('%PDF-1.4'), { mime: 'image/png', name: 'x.png' }), /not a picture/)
  })

  const viewer = await device('Viewer')
  const editor = await device('Editor')

  await t.test('the invite says what it is, and a viewer who joins gets the same bytes', async () => {
    const { link } = await call(owner, 'file:invite', { sheetId, role: 'viewer' })
    assert.equal(parseInviteLink(link).kind, 'pdf')
    await call(viewer, 'file:join', { link })
    await waitFor('viewer in', async () => !!viewer.bases.get(sheetId) && (await call(viewer, 'media:info', { sheetId }).catch(() => ({}))).myRole === 'viewer', { timeout: 40000 })
    await waitFor('viewer has the bytes', async () => hashOf(await read(viewer, sheetId).catch(() => b4a.alloc(0))) === want, { timeout: 60000 })
  })

  await t.test('the seeder holds the bytes, as ciphertext', async () => {
    const info = await call(owner, 'media:info', { sheetId })
    const r = parseRef(info.media.ref)
    const key = b4a.from(r.key, 'hex')
    await waitFor('seeder has the core', async () => {
      if (!(await seeder.peer.db.getCoreRecord(key))) return false
      const c = seeder.peer.store.get({ key })
      await c.ready()
      const ok = c.contiguousLength >= r.id.blockOffset + r.id.blockLength
      await c.close()
      return ok
    }, { timeout: 60000 })
    const core = seeder.peer.store.get({ key, encryption: null })
    await core.ready()
    let hits = 0
    for (let i = 0; i < core.contiguousLength; i++) {
      const raw = await core.get(i, { raw: true, wait: false })
      if (raw && b4a.indexOf(raw, b4a.from(MARKER)) !== -1) hits++
    }
    await core.close()
    assert.equal(hits, 0)
  })

  await t.test('removing someone moves the file with its bytes', async () => {
    const { link } = await call(owner, 'file:invite', { sheetId, role: 'editor' })
    await call(editor, 'file:join', { link })
    await waitFor('editor in', async () => !!editor.bases.get(sheetId)?.writable, { timeout: 40000 })
    const { sheetId: newId } = await call(owner, 'sheet:removeMember', { sheetId, identity: hex(viewer.identity.publicKey) })
    assert.equal(hashOf(await read(owner, newId)), want)
    assert.notEqual((await call(owner, 'media:info', { sheetId: newId })).media.ref, (await call(owner, 'media:info', { sheetId })).media.ref)
    await waitFor('editor follows and reads it', async () => hashOf(await read(editor, newId).catch(() => b4a.alloc(0))) === want, { timeout: 60000 })
  })
})

test('mediaOf checks the record against the kind', () => {
  const Y = require('yjs')
  const mediaModel = require('../src/media/mediaModel')
  const doc = new Y.Doc()
  const hash = 'a'.repeat(64)
  mediaModel.initMedia(doc, { title: 'Box', media: { ref: 'r', hash, mime: 'image/png', size: 10, name: 'box.png', w: 4, h: 3 } })
  assert.equal(doc.getMap('meta').get('kind'), 'picture')
  assert.deepEqual(mediaModel.mediaOf(doc), { ref: 'r', hash, mime: 'image/png', size: 10, name: 'box.png', w: 4, h: 3, pages: null })
  doc.getMap('media').set('mime', 'application/pdf') // a PDF's type in a picture file
  assert.equal(mediaModel.mediaOf(doc), null)
  doc.getMap('media').set('mime', 'image/png')
  doc.getMap('media').set('size', 26 * 1024 * 1024)
  assert.equal(mediaModel.mediaOf(doc), null)
  assert.throws(() => mediaModel.initMedia(new Y.Doc(), { title: 'x', media: { mime: 'application/zip' } }), /PDFs and pictures/)
})
