// Spike: a picture core per writer per file (proposals/2026-10-06-document-images.md).
// Guesses 1 (encryption with the file key) and 2 (seeder backup, unchanged).
// Usage: node spikes/picture-core/spike.js <picture.jpg> [<picture2.png>]
// NOPATCH=1 runs without the DefaultEncryption._reload fix.
// Prints strings and numbers only; never compares live objects.

const fs = require('node:fs')
const path = require('node:path')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const Hypercore = require('hypercore')
const Hyperblobs = require('hyperblobs')
const Hyperswarm = require('hyperswarm')
const Corestore = require('corestore')
const createTestnet = require('@hyperswarm/testnet')
const { applyEncryptionReloadFix } = require('../../src/worklet/hypercoreEncryptionPatch')
const { createSheetEngine } = require('../../src/worklet/engine')
const { createSeeder } = require('../../src/seeder/seeder')
const { tmpDir, cleanup, waitFor, call } = require('../../test/helpers')

if (!process.env.NOPATCH) console.log('patch:', applyEncryptionReloadFix(Hypercore, b4a).reason)
else console.log('patch: off')

const hex = (buf) => b4a.toString(buf, 'hex')
const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms))
const MARKER = 'PEAROFFICE-PLAINTEXT-MARKER-7731'
const results = []
const check = (label, ok, extra = '') => { results.push([label, !!ok]); console.log((ok ? 'PASS ' : 'FAIL ') + label + (extra ? ' (' + extra + ')' : '')) }

// Put MARKER in a JPEG comment segment right after SOI (or append it to a PNG).
function marked (file) {
  const src = fs.readFileSync(file)
  const text = b4a.from(MARKER)
  if (src[0] === 0xff && src[1] === 0xd8) {
    const seg = b4a.alloc(4 + text.length)
    seg[0] = 0xff; seg[1] = 0xfe; seg.writeUInt16BE(text.length + 2, 2); text.copy(seg, 4)
    return b4a.concat([src.subarray(0, 2), seg, src.subarray(2)])
  }
  return b4a.concat([src, text])
}

function blake (bytes) { const out = b4a.alloc(32); sodium.crypto_generichash(out, bytes); return out }

// The key for picture cores: a keyed hash of the file key with a purpose
// string, as linking.js and protocol.js do with their namespaces.
function pictureKey (fileKey) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from('pearoffice/pictures/1'), fileKey)
  return out
}

// Search every file under dir for the needles (plain bytes).
function scanDir (dir, needles) {
  const hits = {}
  let files = 0; let bytes = 0
  const walk = (d) => {
    for (const ent of fs.readdirSync(d, { withFileTypes: true })) {
      const p = path.join(d, ent.name)
      if (ent.isDirectory()) walk(p)
      else if (ent.isFile()) {
        const buf = fs.readFileSync(p); files++; bytes += buf.length
        for (const [name, n] of Object.entries(needles)) if (b4a.indexOf(buf, n) !== -1) hits[name] = (hits[name] || 0) + 1
      }
    }
  }
  walk(dir)
  return { files, bytes, hits }
}

// Search a core's raw (still encrypted) blocks.
async function scanBlocks (store, key, needles) {
  const core = store.get({ key, encryption: null })
  await core.ready()
  let blocks = 0; let hits = 0
  for (let i = 0; i < core.contiguousLength; i++) {
    const raw = await core.get(i, { raw: true, wait: false })
    if (!raw) continue
    blocks++
    for (const n of Object.values(needles)) if (b4a.indexOf(raw, n) !== -1) hits++
  }
  await core.close()
  return { blocks, hits }
}

async function main () {
  const picA = marked(process.argv[2])
  const picB = process.argv[3] ? marked(process.argv[3]) : b4a.concat([picA.subarray(0, 1000), b4a.from('B')])
  const hashA = blake(picA)
  const needles = {
    marker: b4a.from(MARKER),
    jpegHead: picA.subarray(0, 16), // SOI + our comment header
    jfifBody: picA.subarray(4000, 4064), // 64 bytes from inside the picture
    hashBin: hashA,
    hashHex: b4a.from(hex(hashA))
  }

  const testnet = await createTestnet(3)
  const mkSwarm = ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap })
  const open = []
  const seederDir = tmpDir()
  const seederLog = []
  const seeder = await createSeeder({ dataDir: seederDir, bootstrap: testnet.bootstrap, log: (s) => seederLog.push(s) })
  const mk = async (dir) => {
    const e = createSheetEngine({ corestore: new Corestore(dir), createSwarm: mkSwarm })
    open.push(e)
    await e.init({})
    return e
  }
  const extra = []
  try {
    const dirA = tmpDir(); const dirB = tmpDir(); const dirC = tmpDir()
    const A = await mk(dirA)
    const B = await mk(dirB)
    let C = await mk(dirC)
    const { sheetId } = await call(A, 'doc:create', { title: 'Trip notes' })
    for (const e of [B, C]) {
      const { link } = await call(A, 'sheet:invite', { sheetId, role: 'editor' })
      await call(e, 'sheet:join', { link })
      await waitFor('joined', async () => e.bases.get(sheetId)?.writable)
    }
    const baseA = A.bases.get(sheetId)
    const fileKey = baseA.encryptionKey
    const bootstrap = baseA.key
    console.log('file key length', fileKey.length, 'same on B', b4a.equals(fileKey, B.bases.get(sheetId).encryptionKey))
    const pk = pictureKey(fileKey)

    // --- guess 1: the picture core, encrypted --------------------------------
    const coreA = A.store.get({ name: 'pictures/' + sheetId, encryption: { key: pk } })
    await coreA.ready()
    const blobsA = new Hyperblobs(coreA)
    const id = await blobsA.put(picA)
    const ref = hex(coreA.key) + ':' + [id.blockOffset, id.blockLength, id.byteOffset, id.byteLength].join('.')
    console.log('picture', picA.length, 'bytes in', id.blockLength, 'blocks; ref', ref.length, 'chars; core length', coreA.length)
    check('writer reads its own picture back', b4a.equals(await blobsA.get(id), picA))
    check('writer core is encrypted', !!coreA.encryption)

    // Sanity for the disk scan: an unencrypted core holding the marker must be found on disk.
    const plain = A.store.get({ name: 'sanity-plain' })
    await plain.append(b4a.concat([b4a.from('xx'), needles.marker, b4a.from('yy')]))
    await plain.close()
    await sleep(500)
    const rawA = await scanBlocks(A.store, coreA.key, needles)
    check('raw blocks on the writer hold no plaintext', rawA.hits === 0, rawA.blocks + ' blocks scanned')

    // B: a member with the file key opens the core by key (no manifest yet).
    const coreB = B.store.get({ key: coreA.key, encryption: { key: pictureKey(B.bases.get(sheetId).encryptionKey) } })
    await coreB.ready()
    const gotB = await new Hyperblobs(coreB).get(id, { timeout: 20000 })
    check('second member device reads the picture', gotB && b4a.equals(blake(gotB), hashA), gotB ? gotB.length + ' bytes' : 'nothing')
    console.log('B core compat now', coreB.core.compat)

    // The raw blocks as replicated to B are ciphertext too.
    const rawB = await scanBlocks(B.store, coreA.key, needles)
    check('replicated raw blocks on B hold no plaintext', rawB.hits === 0, rawB.blocks + ' blocks')

    // A device with no key: a stranger replicating straight from A's store.
    const strangerStore = new Corestore(tmpDir())
    extra.push(strangerStore)
    const s1 = A.store.replicate(true); const s2 = strangerStore.replicate(false)
    s1.pipe(s2).pipe(s1)
    const coreX = strangerStore.get({ key: coreA.key })
    await coreX.ready()
    await coreX.download({ start: 0, end: coreA.length }).done()
    const gotX = await new Hyperblobs(coreX).get(id, { timeout: 10000 }).catch((e) => e)
    const xBytes = b4a.isBuffer(gotX) ? gotX : null
    check('a device without the key gets only ciphertext', xBytes && !b4a.equals(blake(xBytes), hashA) && b4a.indexOf(xBytes, needles.marker) === -1,
      xBytes ? xBytes.length + ' bytes, JPEG magic ' + (xBytes[0] === 0xff && xBytes[1] === 0xd8) : String(gotX && gotX.message))
    const coreW = strangerStore.get({ key: coreA.key, encryption: { key: fileKey } }) // the raw file key, not the picture key
    await coreW.ready()
    const gotW = await new Hyperblobs(coreW).get(id).catch(() => null)
    check('the file key itself (wrong key) does not decrypt it', !gotW || !b4a.equals(blake(gotW), hashA))
    await coreW.close(); await coreX.close()
    s1.destroy(); s2.destroy()

    // --- guess 2: seeder backup ------------------------------------------
    await call(A, 'seeder:pair', { link: seeder.openPairing().link })
    await waitFor('seeder allows the file', async () => seeder.allowedSheets().includes(hex(bootstrap)), { timeout: 30000 })
    const seederKey = seeder.seederKey
    // A (paired) registers its picture core, referrer = the file's bootstrap key.
    const ka = hex(coreA.key)
    for (const ev of ['add-core', 'add-new-core', 'add-cores-received', 'add-cores-done']) {
      seeder.peer.on(ev, (x, y) => {
        const keys = x && x.cores ? x.cores.map((c) => hex(c.key).slice(0, 6)) : (x && x.key ? [hex(x.key).slice(0, 6)] : (y && y.cores ? y.cores.map((c) => hex(c.key).slice(0, 6)) : []))
        if (keys.includes(ka.slice(0, 6))) console.log('DEBUG event', ev, keys.join(','))
      })
    }
    A.seeding.peering.addCoreBackground(coreA, { referrer: bootstrap, keys: [seederKey] })

    // B (not paired with the seeder) adds a picture and registers it too.
    const coreB2 = B.store.get({ name: 'pictures/' + sheetId, encryption: { key: pk } })
    await coreB2.ready()
    const idB = await new Hyperblobs(coreB2).put(picB)
    await waitFor('B has a seeding instance', async () => !!B.seeding.peering)
    B.seeding.peering.addCoreBackground(coreB2, { referrer: bootstrap, keys: [seederKey] })

    // Wait for blind-peer's record before opening the core on the seeder: if
    // the probe opens it first, the seeder fetches the head over the open
    // connection, then treats the add as already known, writes no record and
    // never downloads the blocks (a test trap; nothing else opens cores there).
    const seederHas = async (key, len) => { if (!(await seeder.peer.db.getCoreRecord(key))) return false; const c = seeder.peer.store.get({ key }); await c.ready(); const ok = c.contiguousLength >= len; await c.close(); return ok }
    const t0 = Date.now()
    await waitFor('seeder has A picture core', () => seederHas(coreA.key, coreA.length), { timeout: 30000 }).catch(async (e) => {
      const c = seeder.peer.store.get({ key: coreA.key }); await c.ready()
      console.log('DEBUG seeder len', c.contiguousLength, 'length', c.length, 'record', !!(await seeder.peer.db.getCoreRecord(coreA.key)), 'peers', c.peers.length, 'stats', JSON.stringify(seeder.peer.stats), 'A peering', JSON.stringify(A.seeding.peering.stats), 'A core peers', coreA.peers.length)
      console.log('DEBUG seeder log', seederLog.join(' | '))
      await c.close(); throw e
    })
    console.log('seeder had A picture core after', Date.now() - t0, 'ms')
    await waitFor('seeder has B picture core', () => seederHas(coreB2.key, coreB2.length), { timeout: 30000 })
    check('seeder stored both picture cores (paired and unpaired member)', true)

    // Writers leave. C never opened a picture core, so it holds none of the
    // blocks; it comes back once A and B are gone.
    await C.close()
    await coreB.close(); await coreB2.close(); await coreA.close()
    await A.close(); await B.close()
    await sleep(500)

    C = await mk(dirC)
    const t1 = Date.now()
    const coreC = C.store.get({ key: b4a.from(ref.split(':')[0], 'hex'), encryption: { key: pictureKey(C.bases.get(sheetId).encryptionKey) } })
    await coreC.ready()
    console.log('C held picture blocks before fetching:', coreC.contiguousLength)
    const gotC = await new Hyperblobs(coreC).get(id, { timeout: 40000 }).catch((e) => e)
    check('third member reads A picture from the seeder alone', b4a.isBuffer(gotC) && b4a.equals(blake(gotC), hashA), (Date.now() - t1) + ' ms')
    const coreC2 = C.store.get({ key: coreB2.key, encryption: { key: pictureKey(C.bases.get(sheetId).encryptionKey) } })
    await coreC2.ready()
    const gotC2 = await new Hyperblobs(coreC2).get(idB, { timeout: 40000 }).catch((e) => e)
    check('third member reads B picture from the seeder alone', b4a.isBuffer(gotC2) && b4a.equals(gotC2, picB))
    await coreC.close(); await coreC2.close()

    // Seeder copy is ciphertext: raw blocks and every file on its disk.
    const rawS = await scanBlocks(seeder.peer.store, coreA.key, needles)
    check('seeder raw blocks hold no plaintext', rawS.hits === 0, rawS.blocks + ' blocks')
    const diskS = scanDir(seederDir, needles)
    check('seeder disk holds no plaintext', Object.keys(diskS.hits).length === 0, diskS.files + ' files, ' + diskS.bytes + ' bytes, hits ' + JSON.stringify(diskS.hits))
    const diskA = scanDir(dirA, needles)
    check('writer disk holds no picture plaintext (marker only in the plain sanity core)', !diskA.hits.jfifBody && !diskA.hits.hashBin, JSON.stringify(diskA.hits))
    check('disk scan sanity: plain core marker found on writer disk', diskA.hits.marker >= 1)

    // Drop: deleting the file at the seeder.
    await seeder.scheduleDrop(hex(bootstrap), 0)
    await waitFor('dropped', async () => seederLog.some((l) => l.startsWith('dropped sheet')), { timeout: 10000 })
    console.log('seeder log:', seederLog.filter((l) => /dropped|refused|allowed/.test(l)).join(' | '))
    const after = seeder.peer.store.get({ key: coreA.key })
    await after.ready()
    check('picture core cleared at the seeder with the file', after.contiguousLength === 0, 'length ' + after.contiguousLength)
    await after.close()
  } finally {
    for (const s of extra) { try { await s.close() } catch {} }
    for (const e of open) { try { await e.close() } catch {} }
    try { await seeder.close() } catch {}
    await testnet.destroy()
    cleanup()
  }
  const failed = results.filter((r) => !r[1]).length
  console.log(failed ? failed + ' FAILED' : 'ALL PASS', results.length + ' checks')
}

main().catch((e) => { console.error('ERROR', e && e.stack); process.exitCode = 1 })
