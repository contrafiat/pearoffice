// CRDT spike: does a CRDT library run inside Bare with an encrypted Autobase,
// converge after concurrent offline edits, and sync a new device through a
// blind seeder that never sees the encryption key?
//
// Usage: bare spike.js <yjs|automerge> <tmpdir>   (also runs under node)

const Autobase = require('autobase')
const Corestore = require('corestore')
const Hyperswarm = require('hyperswarm')
const BlindPeer = require('blind-peer')
const BlindPeering = require('blind-peering')
const Wakeup = require('protomux-wakeup')
const createTestnet = require('hyperdht/testnet')
const crypto = require('hypercore-crypto')
const b4a = require('b4a')
require('./bare-globals')
const adapters = require('./adapters')

const argv = typeof Bare !== 'undefined' ? Bare.argv.slice(2) : process.argv.slice(2)
const [libName = 'yjs', tmp = './tmp'] = argv
const lib = adapters[libName]
const runtime = typeof Bare !== 'undefined' ? 'bare ' + Bare.platform + '-' + Bare.arch : 'node ' + process.platform + '-' + process.arch
const dir = tmp + '/' + libName + '-' + Date.now()

const T_UPDATE = 0
const T_ADD_WRITER = 1

function encode (type, payload) {
  const out = b4a.alloc(1 + payload.byteLength)
  out[0] = type
  out.set(payload, 1)
  return out
}

// One device: a corestore, an encrypted Autobase and an in-memory CRDT doc.
// The view is a plain core holding every applied update in log order, so the
// doc is always fold(view) and survives restarts and Autobase reorders.
class Device {
  constructor (name, bootstrap, encryptionKey) {
    this.name = name
    this.store = new Corestore(dir + '/' + name)
    this.doc = lib.create()
    this.base = new Autobase(this.store, bootstrap, {
      encryptionKey,
      valueEncoding: 'binary',
      open: (store) => store.get('view'),
      apply: this._apply.bind(this)
    })
    this.swarm = null
    this.applied = 0
  }

  async _apply (nodes, view, host) {
    for (const node of nodes) {
      const v = node.value
      if (v[0] === T_ADD_WRITER) {
        await host.addWriter(v.subarray(1), { indexer: true })
      } else if (v[0] === T_UPDATE) {
        const update = v.subarray(1)
        await view.append(update)
        lib.apply(this.doc, update)
        this.applied++
      }
    }
  }

  async ready () {
    await this.base.ready()
  }

  async edit (fn) {
    const update = fn(this.doc)
    await this.base.append(encode(T_UPDATE, update))
  }

  async addWriter (key) {
    await this.base.append(encode(T_ADD_WRITER, key))
  }

  async join (bootstrap) {
    this.swarm = new Hyperswarm({ bootstrap })
    this.swarm.on('connection', (c) => this.store.replicate(c))
    this.swarm.join(this.base.discoveryKey)
    await this.swarm.flush()
  }

  async leave () {
    if (this.swarm) await this.swarm.destroy()
    this.swarm = null
  }

  snapshot () {
    return JSON.stringify(lib.snapshot(this.doc))
  }

  async close () {
    await this.leave()
    await this.base.close()
    await this.store.close()
  }
}

async function until (fn, ms = 30000, label = '') {
  const start = Date.now()
  while (Date.now() - start < ms) {
    if (await fn()) return Date.now() - start
    await new Promise((resolve) => setTimeout(resolve, 100))
  }
  throw new Error('timeout: ' + label)
}

async function main () {
  const out = { lib: libName, runtime }
  const t0 = Date.now()
  const testnet = await createTestnet(3)
  const bootstrap = testnet.bootstrap

  const encryptionKey = crypto.randomBytes(32)

  // A creates the sheet. B joins with the bootstrap key and encryption key.
  const a = new Device('a', null, encryptionKey)
  await a.ready()
  const b = new Device('b', a.base.key, encryptionKey)
  await b.ready()
  await a.addWriter(b.base.local.key)

  // Initial layout from A: 3 rows, 3 cols.
  for (const [i, id] of ['r1', 'r2', 'r3'].entries()) await a.edit((d) => lib.insertRow(d, i, id))
  for (const [i, id] of ['c1', 'c2', 'c3'].entries()) await a.edit((d) => lib.insertCol(d, i, id))
  await a.edit((d) => lib.setCell(d, 'r1', 'c1', 'SECRET-BUDGET-4242'))

  // Sync once so B is a writer and has the layout.
  await a.join(bootstrap)
  await b.join(bootstrap)
  await until(async () => { await b.base.update(); return b.base.writable && b.snapshot() === a.snapshot() }, 30000, 'b initial sync')
  await a.leave()
  await b.leave()

  // Concurrent offline edits: same cell, different cells, concurrent row inserts.
  await a.edit((d) => lib.setCell(d, 'r2', 'c2', 'from-a'))
  await b.edit((d) => lib.setCell(d, 'r2', 'c2', 'from-b'))
  await a.edit((d) => lib.setCell(d, 'r3', 'c1', '=SUM(A1:A2)'))
  await b.edit((d) => lib.setCell(d, 'r3', 'c3', '42'))
  await a.edit((d) => lib.insertRow(d, 1, 'ra'))
  await b.edit((d) => lib.insertRow(d, 1, 'rb'))
  out.diverged = a.snapshot() !== b.snapshot()

  // Bring them together and check they converge.
  await a.join(bootstrap)
  await b.join(bootstrap)
  out.convergeMs = await until(async () => {
    await a.base.update(); await b.base.update()
    return a.snapshot() === b.snapshot() && a.snapshot().includes('ra') && a.snapshot().includes('rb')
  }, 30000, 'converge')
  out.converged = lib.snapshot(a.doc)

  // Blind seeder: a blind-peer server on the testnet. A and B register the
  // base with it via blind-peering. The seeder is given core keys only.
  const seeder = new BlindPeer(dir + '/seeder', { bootstrap, trustedPubKeys: [] })
  await seeder.listen()
  const peerings = []
  for (const dev of [a, b]) {
    const wakeup = new Wakeup()
    const bp = new BlindPeering(dev.swarm.dht, dev.store, { wakeup, keys: [seeder.publicKey] })
    bp.addAutobaseBackground(dev.base)
    peerings.push(bp)
  }
  await until(async () => seeder.stats.coresAdded >= 3, 30000, 'seeder got cores')
  // Give the seeder time to download everything.
  await until(async () => {
    for (const dev of [a, b]) {
      for (const w of dev.base.activeWriters) {
        const c = seeder.store.get({ key: w.core.key })
        await c.ready()
        const ok = c.contiguousLength >= w.core.length
        await c.close()
        if (!ok) return false
      }
    }
    return true
  }, 30000, 'seeder downloaded')
  out.seederCores = seeder.stats.coresAdded

  // Prove the seeder cannot read: scan the raw blocks it holds for the cell text.
  let plaintextHits = 0
  let blocksScanned = 0
  for (const w of a.base.activeWriters) {
    const c = seeder.store.get({ key: w.core.key })
    await c.ready()
    ;(out.seederLens = out.seederLens || []).push([c.length, c.contiguousLength, w.core.length])
    for (let i = 0; i < c.contiguousLength; i++) {
      const raw = await c.get(i, { raw: true, wait: false })
      if (!raw) { out.missing = (out.missing || 0) + 1; continue }
      blocksScanned++
      if (b4a.indexOf(raw, b4a.from('SECRET-BUDGET')) !== -1) plaintextHits++
    }
    await c.close()
  }
  out.seederBlocksScanned = blocksScanned
  out.seederPlaintextHits = plaintextHits
  // Sanity: the same scan on A's own (decrypting) session does find it.
  let ownHits = 0
  for (let i = 0; i < a.base.local.length; i++) {
    const v = await a.base.local.get(i, { valueEncoding: 'binary' })
    if (v && b4a.indexOf(v, b4a.from('SECRET-BUDGET')) !== -1) ownHits++
  }
  out.ownerPlaintextHits = ownHits

  // A and B go offline. C, a new device with the keys, syncs from the seeder alone.
  for (const bp of peerings) await bp.close()
  await a.close()
  await b.close()

  const c = new Device('c', a.base.key, encryptionKey)
  await c.ready()
  c.swarm = new Hyperswarm({ bootstrap })
  c.swarm.on('connection', (conn) => c.store.replicate(conn))
  const cPeering = new BlindPeering(c.swarm.dht, c.store, { wakeup: new Wakeup(), keys: [seeder.publicKey] })
  cPeering.addAutobaseBackground(c.base)
  out.seederOnlySyncMs = await until(async () => {
    await c.base.update()
    return c.snapshot() === JSON.stringify(out.converged)
  }, 60000, 'c from seeder')

  // Restart C and check the doc rebuilds from its local view.
  await cPeering.close()
  await c.close()
  const c2 = new Device('c', a.base.key, encryptionKey)
  await c2.ready()
  const view = c2.base.view
  await view.ready()
  for (let i = 0; i < view.length; i++) lib.apply(c2.doc, await view.get(i))
  out.restartMatches = c2.snapshot() === JSON.stringify(out.converged)
  await c2.close()

  // Throughput: 2000 single-cell edits applied locally through Autobase.
  const p = new Device('perf', null, encryptionKey)
  await p.ready()
  await p.edit((d) => lib.insertRow(d, 0, 'r'))
  const t1 = Date.now()
  let bytes = 0
  for (let i = 0; i < 2000; i++) {
    const u = lib.setCell(p.doc, 'r', 'c' + (i % 50), 'v' + i)
    bytes += u.byteLength
    await p.base.append(encode(T_UPDATE, u))
  }
  out.edits2000Ms = Date.now() - t1
  out.avgUpdateBytes = Math.round(bytes / 2000)
  out.savedDocBytes = lib.save(p.doc).byteLength
  await p.close()

  await seeder.close()
  await testnet.destroy()
  out.totalMs = Date.now() - t0
  console.log(JSON.stringify(out, null, 2))
}

main().catch((err) => {
  console.error('SPIKE FAILED', err)
  if (typeof Bare !== 'undefined') Bare.exit(1)
  else process.exit(1)
})
