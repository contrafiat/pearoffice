// Pictures in documents (proposals/2026-10-06-document-images.md, design B).
//
// Each writer device has one picture core per file: a Hyperblobs core named
// pictures/<fileId>, encrypted with a key derived from the file key, so only
// members can read it and the seeder holds it blind. The document holds only
// a reference: "<core key hex>:<blockOffset>.<blockLength>.<byteOffset>.<byteLength>"
// plus the BLAKE2b hash of the bytes, checked on every read.
//
// Every member device downloads every picture the document references, for
// offline use, and registers the picture cores it holds with the file's
// seeders (seeding.js), referred by the file's base key.
//
// Bounds, since any member can write any reference into the document:
// - a reference must claim 1 byte to 2 MB, in no more blocks than that needs
//   (25 MB in a PDF or picture file, proposals/2026-10-29-pdf-and-picture-files.md);
// - per file, only the first (devices in the file + 2) picture core keys the
//   document names are opened at all (at least 4); each device has one core
//   per file, so others are not real picture cores of this file;
// - background downloads run 4 at a time, each given up after 60 s and stop
//   at 256 MB claimed per file (the rest are fetched when shown);
// - a picture whose bytes do not match its hash is never shown.

const b4a = require('b4a')
const sodium = require('sodium-universal')
const Hyperblobs = require('hyperblobs')
const docModel = require('../doc/docModel')
const slidesModel = require('../slides/slidesModel')
const model = require('../sheet/sheetModel')
const mediaModel = require('../media/mediaModel')

const MAX_BYTES = 1024 * 1024 // per picture, after the UI shrank it
const MAX_FETCH = 2 * 1024 * 1024 // a reference to more than this is not downloaded
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const SCAN_MS = 500
const GET_TIMEOUT_MS = 20000
const BLOCK = 64 * 1024 // Hyperblobs' block size
const FETCH_AT_ONCE = 4
const FETCH_TIMEOUT_MS = 60000
const FETCH_BYTES_PER_FILE = 256 * 1024 * 1024
const TOO_BIG = 'This picture is too big to add, even after shrinking it. Try a smaller one.'

const hex = (buf) => b4a.toString(buf, 'hex')

// Keyed BLAKE2b of the purpose string, as linking.js derives its keys.
function pictureKey (fileKey) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from('pearoffice/pictures/1'), fileKey)
  return out
}

function hashOf (bytes) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, bytes)
  return hex(out)
}

function formatRef (key, id) {
  return hex(key) + ':' + [id.blockOffset, id.blockLength, id.byteOffset, id.byteLength].join('.')
}

function parseRef (ref) {
  const m = /^([0-9a-f]{64}):(\d{1,12})\.(\d{1,12})\.(\d{1,15})\.(\d{1,12})$/.exec(String(ref || ''))
  if (!m) return null
  return { key: m[1], id: { blockOffset: Number(m[2]), blockLength: Number(m[3]), byteOffset: Number(m[4]), byteLength: Number(m[5]) } }
}

// A reference whose size is within the limit and whose blocks fit its size.
// Kinds of file that can hold pictures.
function hasPictures (doc) {
  const kind = model.kind(doc)
  return kind === 'doc' || kind === 'slides' || mediaModel.KINDS.includes(kind)
}

// The most a reference in this file may claim.
const maxFetch = (doc) => (doc && mediaModel.isMedia(doc) ? mediaModel.MAX_BYTES : MAX_FETCH)

function sizeOk (r, max = MAX_FETCH) {
  const len = r.id.byteLength
  return len >= 1 && len <= max && r.id.blockLength >= 1 && r.id.blockLength <= Math.ceil(len / BLOCK) + 1
}

function createPictures ({ engine, sheets, getSeeding = () => null, log = () => {} }) {
  const open = new Map() // sheetId -> Map(coreHex -> Promise<{ core, blobs }>)
  const ownKeys = new Map() // sheetId -> Promise<own core key hex, or null>
  const fetched = new Set() // sheetId + ' ' + ref, downloads started
  const timers = new Map()
  const queue = [] // background downloads waiting: { sheetId, ref }
  const claimed = new Map() // sheetId -> bytes queued for background download
  let running = 0
  let closed = false

  function fileKey (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base || !base.encryptionKey) throw new Error('unknown file: ' + sheetId)
    return base.encryptionKey
  }

  function coresFor (sheetId) {
    let m = open.get(sheetId)
    if (!m) open.set(sheetId, (m = new Map()))
    return m
  }

  // The key of this device's picture core for a file, once it has one
  // (recorded locally as pictures:own:<fileId>).
  function ownKey (sheetId) {
    if (!ownKeys.has(sheetId)) ownKeys.set(sheetId, engine.localDb.get('pictures:own:' + sheetId).then((r) => (r && r.value ? r.value.key : null)))
    return ownKeys.get(sheetId)
  }

  // This device's picture core for a file, made on first use.
  const making = new Map() // sheetId -> Promise<{ core, blobs }>
  function own (sheetId) {
    if (!making.has(sheetId)) {
      const p = (async () => {
        const core = engine.store.get({ name: 'pictures/' + sheetId, encryption: { key: pictureKey(fileKey(sheetId)) } })
        await core.ready()
        const key = hex(core.key)
        await engine.localDb.put('pictures:own:' + sheetId, { key })
        ownKeys.set(sheetId, Promise.resolve(key))
        const entry = { core, blobs: new Hyperblobs(core) }
        coresFor(sheetId).set(key, Promise.resolve(entry))
        sweepSoon()
        return entry
      })()
      p.catch(() => making.delete(sheetId))
      making.set(sheetId, p)
    }
    return making.get(sheetId)
  }

  // Any member's picture core for a file, opened by key.
  async function byKey (sheetId, keyHex) {
    if (keyHex === await ownKey(sheetId)) return own(sheetId)
    const m = coresFor(sheetId)
    if (!m.has(keyHex)) {
      const core = engine.store.get({ key: b4a.from(keyHex, 'hex'), encryption: { key: pictureKey(fileKey(sheetId)) } })
      m.set(keyHex, core.ready().then(() => ({ core, blobs: new Hyperblobs(core) })))
      sweepSoon()
    }
    return m.get(keyHex)
  }

  // Register new cores with the seeders soon (seeding.js reads cores()).
  function sweepSoon () {
    const seeding = getSeeding()
    if (seeding) setTimeout(() => seeding.sweep().catch(() => {}), 100)
  }

  // Store a picture in this device's core for the file.
  // `max`: the most it may be (a PDF or picture file's own limit).
  async function put (sheetId, bytes, { max = MAX_BYTES } = {}) {
    if (bytes.byteLength > max) throw new Error(TOO_BIG)
    const { core, blobs } = await own(sheetId)
    const id = await blobs.put(bytes)
    return { ref: formatRef(core.key, id), hash: hashOf(bytes), size: bytes.byteLength }
  }

  // The picture core keys this device will open for a file: this device's
  // own and the first (devices + 2) others the document names, at least 4.
  async function allowedKeys (sheetId, doc) {
    const base = engine.bases.get(sheetId)
    let devices = 0
    if (base) for await (const row of base.view.createReadStream({ gt: 'device/', lt: 'device/~' })) if (row) devices++
    const cap = Math.max(4, devices + 2)
    const keys = new Set()
    const own = await ownKey(sheetId)
    if (own) keys.add(own)
    for (const { ref } of refsIn(doc)) {
      if (keys.size >= cap + (own ? 1 : 0)) break
      keys.add(parseRef(ref).key)
    }
    return keys
  }

  // A picture's bytes, checked against its hash. `doc` is the document the
  // reference comes from (the file's loaded one by default).
  async function get (sheetId, ref, hash, { timeout = GET_TIMEOUT_MS, doc = null } = {}) {
    const r = parseRef(ref)
    if (!r) throw new Error('This picture reference is not valid')
    const from = doc || (sheets.peek(sheetId) || { guarded: {} }).guarded.doc
    if (!sizeOk(r, maxFetch(from))) throw new Error('This picture is too big to show')
    if (from && !(await allowedKeys(sheetId, from)).has(r.key)) throw new Error('This picture is not from this file')
    const { blobs } = await byKey(sheetId, r.key)
    const bytes = await blobs.get(r.id, { timeout }).catch(() => null)
    if (!bytes) throw new Error('This picture is not available yet')
    if (bytes.byteLength !== r.id.byteLength || hashOf(bytes) !== String(hash || '')) throw new Error('This picture does not match the file and was not shown')
    return bytes
  }

  // Every picture the file references: [{ ref, hash, alt, point }], where
  // point(ref) changes that one reference (inside a transaction). Documents
  // hold them in image nodes, decks in picture elements.
  function refsIn (doc) {
    const out = []
    const kind = model.kind(doc)
    if (kind === 'doc') {
      for (const node of docModel.images(doc)) {
        const ref = node.getAttribute('ref')
        if (parseRef(ref)) out.push({ ref, hash: node.getAttribute('hash'), alt: node.getAttribute('alt') || '', point: (r) => node.setAttribute('ref', r) })
      }
    } else if (kind === 'slides') {
      for (const p of slidesModel.pictureRefs(doc)) {
        if (parseRef(p.ref)) out.push({ ref: p.ref, hash: p.hash, alt: p.alt, point: (r) => p.map.set('ref', r) })
      }
    } else if (mediaModel.isMedia(doc)) {
      const m = mediaModel.mediaOf(doc)
      if (m && parseRef(m.ref)) out.push({ ref: m.ref, hash: m.hash, alt: m.name, point: (r) => mediaModel.pointMedia(doc, r) })
    }
    return out
  }

  // Queue a download of every picture the document references (decision 4),
  // within the bounds above.
  async function fetchAll (sheetId) {
    if (closed || !engine.bases.get(sheetId)) return
    const e = sheets.peek(sheetId)
    if (!e || !hasPictures(e.guarded.doc)) return
    const allowed = await allowedKeys(sheetId, e.guarded.doc)
    for (const { ref } of refsIn(e.guarded.doc)) {
      const k = sheetId + ' ' + ref
      if (fetched.has(k)) continue
      const r = parseRef(ref)
      if (!sizeOk(r, maxFetch(e.guarded.doc)) || !allowed.has(r.key)) continue
      const bytes = (claimed.get(sheetId) || 0) + r.id.byteLength
      if (bytes > FETCH_BYTES_PER_FILE) break
      claimed.set(sheetId, bytes)
      fetched.add(k)
      queue.push({ sheetId, ref })
    }
    pump()
  }

  function pump () {
    if (closed) return
    while (running < FETCH_AT_ONCE && queue.length) {
      const { sheetId, ref } = queue.shift()
      running++
      fetchOne(sheetId, ref).catch((err) => log('picture fetch failed: ' + err.message)).finally(() => { running--; pump() })
    }
  }

  async function fetchOne (sheetId, ref) {
    if (!engine.bases.get(sheetId)) return
    const r = parseRef(ref)
    const { core } = await byKey(sheetId, r.key)
    const range = core.download({ start: r.id.blockOffset, end: r.id.blockOffset + r.id.blockLength })
    let timer = null
    const gaveUp = new Promise((resolve) => { timer = setTimeout(() => resolve(false), FETCH_TIMEOUT_MS); if (timer.unref) timer.unref() })
    const ok = await Promise.race([range.done().then(() => true, () => false), gaveUp])
    clearTimeout(timer)
    if (!ok) { try { range.destroy() } catch {} }
  }

  // Counts for one file, for tests.
  function stats (sheetId) {
    const m = open.get(sheetId)
    return { cores: m ? m.size : 0, running, queued: queue.filter((x) => x.sheetId === sheetId).length, claimed: claimed.get(sheetId) || 0 }
  }

  // The document changed: look for new references a moment later.
  function changed (sheetId) {
    if (closed || timers.has(sheetId)) return
    const t = setTimeout(() => { timers.delete(sheetId); fetchAll(sheetId).catch(() => {}) }, SCAN_MS)
    if (t.unref) t.unref()
    timers.set(sheetId, t)
  }

  // On start: load every document and fetch its pictures.
  async function resume () {
    for (const sheetId of [...engine.bases.keys()]) {
      try {
        await sheets.load(sheetId)
        await fetchAll(sheetId)
      } catch {}
    }
  }

  // Wait until every picture in the document is on this device. Resolves to
  // the references that could not be fetched.
  async function ensureAll (sheetId, doc, { timeout = GET_TIMEOUT_MS } = {}) {
    const missing = []
    for (const { ref, hash, alt } of refsIn(doc)) {
      try { await get(sheetId, ref, hash, { timeout, doc }) } catch { missing.push({ ref, alt }) }
    }
    return missing
  }

  // Copy the pictures in `doc` (a scratch copy of file `fromId`'s state) into
  // this device's core for file `toId` and point the references there. Only
  // references `which` picks are moved. Returns the Yjs update, or null.
  async function rehome (fromId, toId, doc, which = () => true) {
    const done = new Map() // old ref -> new ref
    const changes = []
    for (const { ref, hash, point } of refsIn(doc)) {
      if (!which(ref)) continue
      if (!done.has(ref)) {
        const bytes = await get(fromId, ref, hash, { doc })
        done.set(ref, (await put(toId, bytes, { max: maxFetch(doc) })).ref)
      }
      changes.push([point, done.get(ref)])
    }
    if (!changes.length) return null
    return docModel.capture(doc, () => { for (const [point, ref] of changes) point(ref) })
  }

  // The open picture cores of a file, for seeding.js.
  async function cores (sheetId) {
    const m = open.get(sheetId)
    if (!m) return []
    const out = []
    for (const p of m.values()) { try { out.push((await p).core) } catch {} }
    return out
  }

  // Close a file's picture cores and say which they were, for removal.
  async function forget (sheetId) {
    const keys = new Set()
    try { const k = await ownKey(sheetId); if (k) keys.add(k) } catch {}
    const e = sheets.peek(sheetId)
    if (e) for (const { ref } of refsIn(e.guarded.doc)) keys.add(parseRef(ref).key)
    const m = open.get(sheetId)
    if (m) {
      for (const [k, p] of m) { keys.add(k); try { await (await p).core.close() } catch {} }
    }
    open.delete(sheetId)
    ownKeys.delete(sheetId)
    making.delete(sheetId)
    try { await engine.localDb.del('pictures:own:' + sheetId) } catch {}
    for (const k of [...fetched]) if (k.startsWith(sheetId + ' ')) fetched.delete(k)
    for (let i = queue.length - 1; i >= 0; i--) if (queue[i].sheetId === sheetId) queue.splice(i, 1)
    claimed.delete(sheetId)
    return [...keys].map((k) => b4a.from(k, 'hex'))
  }

  async function close () {
    closed = true
    queue.length = 0
    for (const t of timers.values()) clearTimeout(t)
    for (const m of open.values()) {
      for (const p of m.values()) { try { await (await p).core.close() } catch {} }
    }
    open.clear()
  }

  return { put, get, own, ownKey, stats, fetchAll, changed, resume, ensureAll, rehome, refsIn, cores, forget, close }
}

module.exports = { createPictures, hasPictures, pictureKey, hashOf, parseRef, formatRef, MAX_BYTES, MAX_FETCH, MIMES, TOO_BIG }
