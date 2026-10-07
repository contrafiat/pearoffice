// Pictures in documents (proposals/2026-10-06-document-images.md, design B):
// a picture core per writer per file, encrypted with a key from the file key,
// backed up blind by the seeder, copied on a tidy-up and dropped with the
// file. Over a local DHT testnet with the real seeder. Only strings, numbers
// and booleans are compared.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const b4a = require('b4a')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { createSheetEngine } = require('../src/worklet/engine')
const { createSeeder } = require('../src/seeder/seeder')
const Hyperblobs = require('hyperblobs')
const { hashOf, parseRef, pictureKey } = require('../src/worklet/pictures')
const docModel = require('../src/doc/docModel')
const { tmpDir, cleanup, waitFor, call } = require('./helpers')

const hex = (buf) => b4a.toString(buf, 'hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MARKER = 'PEAROFFICE-PICTURE-MARKER-5521'

// Picture-like bytes with a plaintext marker in the middle.
function pictureBytes (size, seed) {
  const out = b4a.alloc(size)
  let x = seed
  for (let i = 0; i < size; i++) { x = (x * 1103515245 + 12345) & 0x7fffffff; out[i] = x & 255 }
  out[0] = 0xff; out[1] = 0xd8
  b4a.from(MARKER).copy(out, Math.floor(size / 2))
  return out
}

async function replica (engine, sheetId) {
  const s = await call(engine, 'doc:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  return doc
}

// Change a device's document the way the editor would.
async function edit (engine, sheetId, fn) {
  const doc = await replica(engine, sheetId)
  const before = Y.encodeStateVector(doc)
  doc.transact(() => fn(docModel.body(doc), doc))
  const update = b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64')
  doc.destroy()
  return call(engine, 'doc:update', { sheetId, update })
}

function imageNode (attrs) {
  const el = new Y.XmlElement('image')
  for (const [k, v] of Object.entries(attrs)) el.setAttribute(k, v)
  return el
}

// The image nodes' refs and hashes on a device, as one string.
async function refsOn (engine, sheetId) {
  const doc = await replica(engine, sheetId)
  const out = docModel.images(doc).map((n) => n.getAttribute('ref') + '#' + n.getAttribute('hash')).join(',')
  doc.destroy()
  return out
}

async function addPicture (engine, sheetId, bytes) {
  const a = await call(engine, 'doc:addPicture', { sheetId, bytes: b4a.toString(bytes, 'base64'), mime: 'image/jpeg', width: 400, height: 300 })
  await edit(engine, sheetId, (body) => body.push([imageNode({ ref: a.ref, hash: a.hash, mime: a.mime, w: a.w, h: a.h, align: 'center', alt: 'Picture ' + bytes.length })]))
  return a
}

async function pictureHash (engine, sheetId, ref) {
  const r = await call(engine, 'doc:picture', { sheetId, ref })
  return hashOf(b4a.from(r.data, 'base64'))
}

// Search a core's raw (still encrypted) blocks for the marker.
async function rawHits (store, key) {
  const core = store.get({ key, encryption: null })
  await core.ready()
  let blocks = 0
  let hits = 0
  for (let i = 0; i < core.contiguousLength; i++) {
    const raw = await core.get(i, { raw: true, wait: false })
    if (!raw) continue
    blocks++
    if (b4a.indexOf(raw, b4a.from(MARKER)) !== -1) hits++
  }
  await core.close()
  return { blocks, hits }
}

// Wait for blind-peer's record before opening the core on the seeder: opening
// it first makes the seeder skip the download (spikes/picture-core/RESULTS.md).
function seederHas (seeder, key, length) {
  return async () => {
    if (!(await seeder.peer.db.getCoreRecord(key))) return false
    const c = seeder.peer.store.get({ key })
    await c.ready()
    const ok = c.contiguousLength >= length
    await c.close()
    return ok
  }
}

function setup (t) {
  const ctx = { engines: [], dirs: new Map() }
  ctx.start = async () => {
    ctx.testnet = await createTestnet(3)
    ctx.seeder = await createSeeder({ dataDir: tmpDir(), bootstrap: ctx.testnet.bootstrap })
  }
  ctx.device = async (name, dir = tmpDir()) => {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: ctx.testnet.bootstrap }) })
    ctx.engines.push(e)
    ctx.dirs.set(e, dir)
    await e.init({})
    await call(e, 'app:setName', { name })
    return e
  }
  ctx.join = async (owner, e, sheetId, role) => {
    const { link } = await call(owner, 'sheet:invite', { sheetId, role })
    await call(e, 'sheet:join', { link })
    await waitFor(role + ' in', async () => (role === 'viewer' ? !!e.bases.get(sheetId) && (await call(e, 'doc:state', { sheetId })).myRole === 'viewer' : !!e.bases.get(sheetId)?.writable))
  }
  t.after(async () => {
    for (const e of ctx.engines) { try { await e.close() } catch {} }
    try { await ctx.seeder.close() } catch {}
    try { await ctx.testnet.destroy() } catch {}
    cleanup()
  })
  return ctx
}

test('pictures: shared, refused, backed up blind and read from the seeder alone', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const { seeder } = ctx
  const owner = await ctx.device('Owner')
  await call(owner, 'seeder:pair', { link: seeder.openPairing().link })
  const { sheetId } = await call(owner, 'doc:create', { title: 'Trip notes' })
  const bootstrap = hex(owner.bases.get(sheetId).key)
  await waitFor('seeder holds the document', async () => seeder.allowedSheets().includes(bootstrap), { timeout: 30000 })

  // A member who goes offline before any picture is added.
  const lateDir = tmpDir()
  let late = await ctx.device('Late', lateDir)
  await ctx.join(owner, late, sheetId, 'editor')
  await waitFor('late sees the seeder', async () => (await call(late, 'seeder:sheet', { sheetId })).listed.length === 1)
  await late.close()

  const editor = await ctx.device('Editor')
  const viewer = await ctx.device('Viewer')
  await ctx.join(owner, editor, sheetId, 'editor')
  await ctx.join(owner, viewer, sheetId, 'viewer')

  const bytes = pictureBytes(300 * 1024, 7)
  const want = hashOf(bytes)
  let pic = null

  await t.test('a new document is version 1; the first picture makes it 2', async () => {
    const before = await replica(owner, sheetId)
    assert.equal(docModel.version(before), 1)
    before.destroy()
    pic = await addPicture(owner, sheetId, bytes)
    assert.equal(pic.hash, want)
    assert.equal(pic.size, bytes.length)
    assert.match(pic.ref, /^[0-9a-f]{64}:\d+\.\d+\.\d+\.\d+$/)
    const after = await replica(owner, sheetId)
    assert.equal(docModel.version(after), 2)
    after.destroy()
    assert.equal((await call(owner, 'doc:state', { sheetId, withState: false })).newer, false)
  })

  await t.test('an editor gets the reference and the same bytes', async () => {
    await waitFor('editor has the node', async () => (await refsOn(editor, sheetId)) === pic.ref + '#' + want)
    assert.equal(await pictureHash(editor, sheetId, pic.ref), want)
  })

  await t.test('every member device downloads the pictures by itself', async () => {
    await waitFor('viewer fetched it', async () => (await viewer.pictures.cores(sheetId)).some((c) => c.contiguousLength >= parseRef(pic.ref).id.blockLength))
    assert.equal(await pictureHash(viewer, sheetId, pic.ref), want)
  })

  await t.test('refusals: viewer, too big, wrong hash, oversized reference', async () => {
    await assert.rejects(call(viewer, 'doc:addPicture', { sheetId, bytes: b4a.toString(bytes, 'base64'), mime: 'image/jpeg', width: 1, height: 1 }), /view this file but not edit it/)
    const big = b4a.toString(b4a.alloc(1024 * 1024 + 1, 1), 'base64')
    await assert.rejects(call(owner, 'doc:addPicture', { sheetId, bytes: big, mime: 'image/jpeg', width: 1, height: 1 }), /too big to add, even after shrinking it/)
    await assert.rejects(call(owner, 'doc:addPicture', { sheetId, bytes: b4a.toString(bytes, 'base64'), mime: 'image/svg+xml', width: 1, height: 1 }), /cannot be added/)
    await assert.rejects(call(editor, 'doc:picture', { sheetId, ref: pic.ref, hash: hashOf(b4a.from('something else')) }), /does not match/)
    const r = parseRef(pic.ref)
    const huge = r.key + ':' + r.id.blockOffset + '.40.' + r.id.byteOffset + '.' + (3 * 1024 * 1024)
    await assert.rejects(call(editor, 'doc:picture', { sheetId, ref: huge, hash: want }), /too big to show/)
  })

  await t.test('a newer schema version opens read-only', async () => {
    const { sheetId: other } = await call(owner, 'doc:create', { title: 'From the future' })
    await edit(owner, other, (body, doc) => doc.getMap('meta').set('version', docModel.VERSION + 1))
    assert.equal((await call(owner, 'doc:state', { sheetId: other, withState: false })).newer, true)
  })

  await t.test('the seeder stores the picture core, as ciphertext', async () => {
    const key = b4a.from(parseRef(pic.ref).key, 'hex')
    await waitFor('seeder has the picture core', seederHas(seeder, key, parseRef(pic.ref).id.blockLength), { timeout: 40000 })
    const raw = await rawHits(seeder.peer.store, key)
    assert.ok(raw.blocks >= parseRef(pic.ref).id.blockLength, raw.blocks + ' blocks')
    assert.equal(raw.hits, 0)
  })

  await t.test('a member who comes back when only the seeder is up gets the picture', async () => {
    for (const e of [owner, editor, viewer]) await e.close()
    await sleep(500)
    late = await ctx.device('Late', lateDir)
    await waitFor('late has the node', async () => (await refsOn(late, sheetId)) === pic.ref + '#' + want, { timeout: 60000 })
    assert.equal(await pictureHash(late, sheetId, pic.ref), want)
  })
})

test('pictures: a tidy-up copies the live ones; deleting drops them', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const { seeder } = ctx
  const owner = await ctx.device('Owner')
  await call(owner, 'seeder:pair', { link: seeder.openPairing().link })
  const editor = await ctx.device('Editor')
  const { sheetId: oldId } = await call(owner, 'doc:create', { title: 'Album' })
  await ctx.join(owner, editor, oldId, 'editor')

  const pics = []
  for (const seed of [1, 2, 3]) pics.push({ bytes: pictureBytes(100 * 1024 + seed, seed) })
  for (const p of pics) p.a = await addPicture(owner, oldId, p.bytes)
  // The second one is deleted from the document.
  await edit(owner, oldId, (body) => {
    const i = body.toArray().findIndex((n) => n instanceof Y.XmlElement && n.getAttribute('ref') === pics[1].a.ref)
    body.delete(i, 1)
  })
  const live = [pics[0], pics[2]]
  await waitFor('editor has the two', async () => (await refsOn(editor, oldId)).split(',').length === 2)

  let newId = null
  await t.test('a tidy-up copies the live pictures under the new key', async () => {
    newId = (await call(owner, 'file:compact', { sheetId: oldId })).sheetId
    const mine = await owner.pictures.ownKey(newId)
    const refs = (await refsOn(owner, newId)).split(',')
    assert.equal(refs.length, 2)
    assert.equal(refs.map((x) => x.split('#')[1]).join(','), live.map((p) => p.a.hash).join(','))
    assert.equal(refs.every((x) => parseRef(x.split('#')[0]).key === mine), true)
    assert.equal(refs.some((x) => x.includes(pics[1].a.hash)), false)
    // The new core holds only the two live pictures.
    const blocks = live.reduce((n, p) => n + parseRef(p.a.ref).id.blockLength, 0)
    const own = await owner.pictures.own(newId)
    assert.equal(own.core.length, blocks)
    for (const x of refs) assert.equal(await pictureHash(owner, newId, x.split('#')[0]), x.split('#')[1])
  })

  await t.test('the other device follows and reads them', async () => {
    await waitFor('editor in the new file', async () => !!editor.bases.get(newId) && (await refsOn(editor, newId)).split(',').length === 2, { timeout: 40000 })
    for (const x of (await refsOn(editor, newId)).split(',')) assert.equal(await pictureHash(editor, newId, x.split('#')[0]), x.split('#')[1])
  })

  await t.test('deleting the document drops its picture cores, here and at the seeder', async () => {
    const newBootstrap = hex(owner.bases.get(newId).key)
    const key = (await owner.pictures.own(newId)).core.key
    const len = (await owner.pictures.own(newId)).core.length
    await waitFor('seeder holds the new file', async () => seeder.allowedSheets().includes(newBootstrap), { timeout: 30000 })
    await waitFor('seeder has the new picture core', seederHas(seeder, key, len), { timeout: 40000 })
    await call(owner, 'file:deleteForEveryone', { sheetId: newId })
    await waitFor('drop scheduled', async () => (await seeder.drops()).some((d) => d.sheet === newBootstrap), { timeout: 30000 })
    await waitFor('removed here', async () => !!(await owner.localDb.get('removed:' + newId)))
    const here = owner.store.get({ key })
    await here.ready()
    assert.equal(here.contiguousLength, 0)
    await here.close()
    await seeder.scheduleDrop(newBootstrap, 0)
    await waitFor('cleared at the seeder', async () => {
      const there = seeder.peer.store.get({ key })
      await there.ready()
      const n = there.contiguousLength
      await there.close()
      return n === 0
    }, { timeout: 15000 })
  })
})

test('pictures after a move: a removed person cannot read new ones', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const owner = await ctx.device('Owner')
  const editor = await ctx.device('Editor')
  const gone = await ctx.device('Gone')
  const { sheetId: oldId } = await call(owner, 'doc:create', { title: 'Private' })
  await ctx.join(owner, editor, oldId, 'editor')
  await ctx.join(owner, gone, oldId, 'editor')
  const { sheetId: newId } = await call(owner, 'sheet:removeMember', { sheetId: oldId, identity: hex(gone.identity.publicKey) })
  const bytes = pictureBytes(120 * 1024, 11)
  const want = hashOf(bytes)
  const pic = await addPicture(owner, newId, bytes)
  await waitFor('editor reads it', async () => (await refsOn(editor, newId)) === pic.ref + '#' + want, { timeout: 40000 })
  assert.equal(await pictureHash(editor, newId, pic.ref), want)
  await waitFor('gone knows it was removed', async () => !!(await gone.localDb.get('moves:' + oldId))?.value?.removed, { timeout: 40000 })
  assert.equal(!!gone.bases.get(newId), false)
  await assert.rejects(call(gone, 'doc:picture', { sheetId: newId, ref: pic.ref, hash: want }), /unknown sheet/)

  // Given the core key and range anyway, with the only key it has (the old
  // file's picture key) or none, it gets ciphertext.
  const r = parseRef(pic.ref)
  const s1 = owner.store.replicate(true)
  const s2 = gone.store.replicate(false)
  s1.pipe(s2).pipe(s1)
  const results = []
  for (const encryption of [{ key: pictureKey(gone.bases.get(oldId).encryptionKey) }, null]) {
    const core = gone.store.get({ key: b4a.from(r.key, 'hex'), encryption })
    await core.ready()
    await core.download({ start: r.id.blockOffset, end: r.id.blockOffset + r.id.blockLength }).done()
    const got = await new Hyperblobs(core).get(r.id, { timeout: 10000 }).catch(() => null)
    results.push(got ? String(hashOf(got) === want) + '/' + String(b4a.indexOf(got, b4a.from(MARKER)) !== -1) : 'none')
    await core.close()
  }
  s1.destroy()
  s2.destroy()
  assert.equal(results.join(','), 'false/false,false/false')
})

test('pictures added offline: carried by a follower and by two writers apart', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const owner = await ctx.device('Owner')
  const awayDir = tmpDir()
  let away = await ctx.device('Away', awayDir)
  const { sheetId: oldId } = await call(owner, 'doc:create', { title: 'Trip' })
  await ctx.join(owner, away, oldId, 'editor')

  // Away adds a picture with no connection, then the owner tidies up.
  const offline = pictureBytes(90 * 1024, 21)
  await away.swarm.destroy()
  await addPicture(away, oldId, offline)
  await away.close()
  const { sheetId: newId } = await call(owner, 'file:compact', { sheetId: oldId })

  await t.test('a follower that added a picture offline carries it into the new file', async () => {
    away = await ctx.device('Away', awayDir)
    await waitFor('the owner has it in the new file', async () => (await refsOn(owner, newId)).includes(hashOf(offline)), { timeout: 60000 })
    const ref = (await refsOn(owner, newId)).split(',').find((x) => x.endsWith(hashOf(offline))).split('#')[0]
    assert.equal(parseRef(ref).key, await away.pictures.ownKey(newId))
    assert.equal(await pictureHash(owner, newId, ref), hashOf(offline))
  })

  await t.test('two writers apart each add one; both read both', async () => {
    const a = pictureBytes(70 * 1024, 31)
    const b = pictureBytes(80 * 1024, 41)
    await waitFor('away writable in the new file', async () => !!away.bases.get(newId)?.writable, { timeout: 40000 })
    await away.swarm.destroy()
    await addPicture(away, newId, b)
    await away.close()
    await addPicture(owner, newId, a)
    away = await ctx.device('Away', awayDir)
    for (const e of [owner, away]) {
      await waitFor('both pictures on one device', async () => { const refs = await refsOn(e, newId); return refs.includes(hashOf(a)) && refs.includes(hashOf(b)) }, { timeout: 60000 })
      for (const x of (await refsOn(e, newId)).split(',')) assert.equal(await pictureHash(e, newId, x.split('#')[0]), x.split('#')[1])
    }
  })
})

test('pictures: references to other cores are bounded and fail cleanly', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const owner = await ctx.device('Owner')
  const { sheetId: other } = await call(owner, 'doc:create', { title: 'Other' })
  const elsewhere = await addPicture(owner, other, pictureBytes(60 * 1024, 51))
  const { sheetId } = await call(owner, 'doc:create', { title: 'Target' })
  const bogus = []
  for (let i = 0; i < 200; i++) bogus.push(hashOf(b4a.from('bogus ' + i)) + ':0.1.0.1000')
  await edit(owner, sheetId, (body) => {
    body.push([imageNode({ ref: elsewhere.ref, hash: elsewhere.hash, mime: 'image/jpeg', w: 1, h: 1 })])
    body.push(bogus.map((ref) => imageNode({ ref, hash: hashOf(b4a.from(ref)), mime: 'image/jpeg', w: 1, h: 1 })))
  })
  await sleep(1500)

  await t.test('another file\'s picture core does not decrypt here', async () => {
    await assert.rejects(call(owner, 'doc:picture', { sheetId, ref: elsewhere.ref }), /does not match/)
  })

  await t.test('200 bogus references open at most a few cores and fetch at most 4 at a time', async () => {
    const st = owner.pictures.stats(sheetId)
    assert.equal(st.cores <= 4, true, st.cores + ' cores')
    assert.equal(st.running <= 4, true)
    await assert.rejects(call(owner, 'doc:picture', { sheetId, ref: bogus[150] }), /not from this document/)
    await assert.rejects(owner.pictures.get(sheetId, bogus[0], hashOf(b4a.from(bogus[0])), { timeout: 1000 }), /not available yet/)
    assert.equal((await call(owner, 'doc:state', { sheetId, withState: false })).myRole, 'owner')
  })
})

// Slide decks hold pictures in picture elements (proposals/2026-10-06-slides.md,
// "Pictures"), with the same cores, seeding and moves as documents.
const slidesModel = require('../src/slides/slidesModel')

async function deckReplica (engine, sheetId) {
  const s = await call(engine, 'slides:state', { sheetId })
  const doc = new Y.Doc()
  Y.applyUpdate(doc, b4a.from(s.state, 'base64'))
  return doc
}

async function deckEdit (engine, sheetId, fn) {
  const doc = await deckReplica(engine, sheetId)
  const before = Y.encodeStateVector(doc)
  let out
  doc.transact(() => { out = fn(doc) })
  await call(engine, 'slides:update', { sheetId, update: b4a.toString(Y.encodeStateAsUpdate(doc, before), 'base64') })
  doc.destroy()
  return out
}

async function deckRefs (engine, sheetId) {
  const doc = await deckReplica(engine, sheetId)
  const out = slidesModel.pictureRefs(doc).map((p) => p.ref + '#' + p.hash).sort().join(',')
  doc.destroy()
  return out
}

async function deckPicture (engine, sheetId, bytes) {
  const a = await call(engine, 'slides:addPicture', { sheetId, bytes: b4a.toString(bytes, 'base64'), mime: 'image/jpeg', width: 800, height: 600 })
  const elId = await deckEdit(engine, sheetId, (doc) => {
    const slideId = slidesModel.addSlide(doc, { layout: 'blank' })
    return { slideId, elId: slidesModel.addPicture(doc, slideId, { ...a, alt: 'Picture ' + bytes.length }) }
  })
  return { ...a, ...elId }
}

async function deckPictureHash (engine, sheetId, ref) {
  const r = await call(engine, 'slides:picture', { sheetId, ref })
  return hashOf(b4a.from(r.data, 'base64'))
}

test('pictures in slide decks: shared, backed up blind, tidied up and read from the seeder', async (t) => {
  const ctx = setup(t)
  await ctx.start()
  const { seeder } = ctx
  const owner = await ctx.device('Owner')
  await call(owner, 'seeder:pair', { link: seeder.openPairing().link })
  const editor = await ctx.device('Editor')
  const lateDir = tmpDir()
  const late = await ctx.device('Late', lateDir)
  const { sheetId: oldId } = await call(owner, 'slides:create', { title: 'Album deck' })
  await ctx.join(owner, editor, oldId, 'editor')
  await ctx.join(owner, late, oldId, 'editor')

  const pics = []
  for (const seed of [11, 12, 13, 14, 15]) pics.push(await deckPicture(owner, oldId, pictureBytes(60 * 1024 + seed, seed)))

  await t.test('a picture element is placed centred at most half the slide', async () => {
    const doc = await deckReplica(owner, oldId)
    const f = slidesModel.frame(slidesModel.element(doc, pics[0].slideId, pics[0].elId))
    doc.destroy()
    assert.equal([f.x, f.y, f.w, f.h].join(), '600,270,720,540')
  })

  await t.test('the other devices get the references and the same bytes', async () => {
    const want = await deckRefs(owner, oldId)
    await waitFor('editor has the refs', async () => (await deckRefs(editor, oldId)) === want)
    for (const p of pics) assert.equal(await deckPictureHash(editor, oldId, p.ref), p.hash)
  })

  await t.test('a wrong hash is refused', async () => {
    await assert.rejects(call(editor, 'slides:picture', { sheetId: oldId, ref: pics[0].ref, hash: 'ab'.repeat(32) }), /does not match/)
  })

  await t.test('the seeder stores the picture core, as ciphertext', async () => {
    const key = b4a.from(parseRef(pics[0].ref).key, 'hex')
    const length = pics.reduce((n, p) => Math.max(n, parseRef(p.ref).id.blockOffset + parseRef(p.ref).id.blockLength), 0)
    await waitFor('seeder has the picture core', seederHas(seeder, key, length), { timeout: 40000 })
    assert.equal((await rawHits(seeder.peer.store, key)).hits, 0)
  })

  // Two picture elements go; one picture's slide is deleted but stays (Restore).
  await deckEdit(owner, oldId, (doc) => {
    slidesModel.removeElement(doc, pics[1].slideId, pics[1].elId)
    slidesModel.removeElement(doc, pics[3].slideId, pics[3].elId)
    slidesModel.deleteSlide(doc, pics[4].slideId)
  })
  const live = [pics[0], pics[2], pics[4]]
  await waitFor('editor has three', async () => (await deckRefs(editor, oldId)).split(',').length === 3)

  let newId = null
  await t.test('a tidy-up of 5 pictures with 2 deleted copies the 3 under the new key', async () => {
    newId = (await call(owner, 'file:compact', { sheetId: oldId })).sheetId
    const mine = await owner.pictures.ownKey(newId)
    const refs = (await deckRefs(owner, newId)).split(',')
    assert.equal(refs.length, 3)
    assert.equal(refs.map((x) => x.split('#')[1]).sort().join(), live.map((p) => p.hash).sort().join())
    assert.equal(refs.every((x) => parseRef(x.split('#')[0]).key === mine), true)
    const own = await owner.pictures.own(newId)
    assert.equal(own.core.length, live.reduce((n, p) => n + parseRef(p.ref).id.blockLength, 0))
    for (const x of refs) assert.equal(await deckPictureHash(owner, newId, x.split('#')[0]), x.split('#')[1])
  })

  await t.test('the editor follows and reads them', async () => {
    await waitFor('editor in the new file', async () => !!editor.bases.get(newId) && (await deckRefs(editor, newId)).split(',').length === 3, { timeout: 40000 })
    for (const x of (await deckRefs(editor, newId)).split(',')) assert.equal(await deckPictureHash(editor, newId, x.split('#')[0]), x.split('#')[1])
  })

  await t.test('a member who comes back when only the seeder is up gets the pictures', async () => {
    const want = await deckRefs(owner, newId)
    await waitFor('the seeder has the new picture core', seederHas(seeder, b4a.from(parseRef(want.split(',')[0].split('#')[0]).key, 'hex'), (await owner.pictures.own(newId)).core.length), { timeout: 40000 })
    await late.close()
    // The others follow first, so the late device has somewhere to go.
    await waitFor('editor still there', async () => !!editor.bases.get(newId))
    for (const e of [owner, editor]) await e.close()
    await sleep(500)
    const back = await ctx.device('Late again', lateDir)
    await waitFor('late follows to the new file', async () => !!(await back.localDb.get('moves:' + oldId))?.value?.to, { timeout: 60000 })
    await waitFor('late has the refs', async () => !!back.bases.get(newId) && (await deckRefs(back, newId)) === want, { timeout: 60000 })
    for (const x of want.split(',')) assert.equal(await deckPictureHash(back, newId, x.split('#')[0]), x.split('#')[1])
  })
})
