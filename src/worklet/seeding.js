// Device side of the blind seeder (wire protocol proposal, section 8).
//
// - pair(link): meet the seeder on its rendezvous topic, prove our swarm key,
//   remember the seeder, and list it in every sheet we can write to.
// - Every sheet is registered with the seeders listed in its own view, and
//   only those, through blind-peering. A seeder never learns about sheets it
//   is not listed in.
//
// blind-peering sends core keys and lengths. It never sends the encryption
// key or the topic key.

const BlindPeering = require('blind-peering')
const Wakeup = require('protomux-wakeup')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const { PAIR_PROTOCOL, PAIR_WINDOW_MS, SEEDER_PROTOCOL, DROP_GRACE_MS, pairTopic, parseSeederLink } = require('../seeder/protocol')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const SWEEP_MS = 5000

function createSeeding ({ engine, log = () => {} }) {
  let peering = null
  const registered = new Map() // sheetId -> seeder keys registered with `peering`
  const seen = new Map() // sheetId -> the sheet's seeder list when last swept
  let sweepTimer = null
  let sweeping = null
  let closed = false
  let rebuildNeeded = false

  function makePeering () {
    peering = new BlindPeering(engine.swarm.dht, engine.store, { wakeup: new Wakeup() })
    // blind-peering dials with `peering.keyPair`, which it never sets, so the
    // DHT falls back to a random key per process. The seeder recognises paired
    // devices by key, so dial with this device's swarm key (the one sent at
    // pairing).
    peering.keyPair = engine.swarm.keyPair
  }

  // blind-peering cannot forget one base, so when a seeder is taken off a
  // sheet, start over with a fresh instance and register every sheet again.
  async function rebuild () {
    const old = peering
    makePeering()
    registered.clear()
    if (old) await old.close().catch(() => {})
  }

  function start () {
    makePeering()
    // Sheets mount during init and arrive later through joins; sweep for new
    // ones and for changed seeder lists. Cheap: one short view read per sheet.
    sweepTimer = setInterval(() => sweep().catch((e) => log('seeding sweep failed: ' + e.message)), SWEEP_MS)
    if (sweepTimer.unref) sweepTimer.unref()
    setTimeout(() => sweep().catch(() => {}), 0)
  }

  async function seedersOf (base) {
    const out = []
    for await (const { value } of base.view.createReadStream({ gt: 'seeder/', lt: 'seeder/~' })) out.push(value.seederKey)
    return out.sort()
  }

  async function register (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base || !peering || closed) return
    await base.ready()
    const keys = await seedersOf(base)
    const id = keys.join(',')
    const prev = seen.get(sheetId)
    seen.set(sheetId, id)
    const removed = prev ? prev.split(',').filter((k) => !keys.includes(k)) : []
    if (removed.length) {
      log('seeder taken off ' + sheetId.slice(0, 8))
      requestDrop({ bootstrap: hex(base.key), seederKeys: removed, afterMs: DROP_GRACE_MS }).catch(() => {})
      rebuildNeeded = true
    }
    if (rebuildNeeded || !keys.length || registered.get(sheetId) === id) return
    registered.set(sheetId, id)
    peering.addAutobaseBackground(base, { keys: keys.map((k) => b4a.from(k, 'hex')), pick: keys.length })
    log('registered ' + sheetId.slice(0, 8) + ' with ' + keys.length + ' seeder(s)')
  }

  async function sweepAll () {
    await listOurSeeders()
    for (const sheetId of [...engine.bases.keys()]) await register(sheetId)
    if (rebuildNeeded && !closed) {
      rebuildNeeded = false
      await rebuild()
      for (const sheetId of [...engine.bases.keys()]) await register(sheetId)
    }
  }

  // One sweep at a time. A call during a sweep runs another one after it, so
  // a change that arrives mid-sweep is never missed.
  let again = null
  function sweep () {
    if (!sweeping) {
      sweeping = sweepAll().finally(() => { sweeping = null })
      return sweeping
    }
    if (!again) again = sweeping.catch(() => {}).then(() => { again = null; return sweep() })
    return again
  }

  // Make sure every sheet we can write to lists every seeder we paired with.
  async function listOurSeeders () {
    const mine = await pairedSeeders()
    if (!mine.length) return
    const me = hex(engine.identity.publicKey)
    for (const [sheetId, base] of engine.bases) {
      if (!base.writable) continue
      const member = (await base.view.get('member/' + me))?.value
      if (!member || (member.role !== 'owner' && member.role !== 'editor')) continue
      const listed = new Set(await seedersOf(base))
      for (const key of mine) {
        if (listed.has(key)) continue
        // Someone took this seeder off the sheet: only an explicit add puts
        // it back.
        if ((await base.view.get('seederOff/' + key))) continue
        await engine.append(sheetId, m.seederOp({ sheetId, identity: engine.identity, seederKey: key }))
        // In case a drop is pending there (we stopped using it and paired again).
        requestKeep({ bootstrap: hex(base.key), seederKeys: [key] }).catch(() => {})
      }
    }
  }

  async function pairedSeeders () {
    const out = []
    for await (const { value } of engine.localDb.createReadStream({ gt: 'seeders:', lt: 'seeders:~' })) out.push(value.seederKey)
    return out
  }

  // Pair with a seeder from the link it shows. Resolves once the seeder has
  // accepted this device.
  function pair (link, { timeoutMs = PAIR_WINDOW_MS } = {}) {
    const { rv, seederKey } = parseSeederLink(link)
    const topic = pairTopic(rv)
    const swarm = engine.swarm
    return new Promise((resolve, reject) => {
      let done = false
      const channels = []
      const finish = async (err) => {
        if (done) return
        done = true
        clearTimeout(timer)
        clearInterval(again)
        for (const ch of channels) { try { ch.close() } catch {} }
        swarm.off('connection', onConnection)
        swarm.leave(topic).catch(() => {})
        if (err) return reject(err)
        await engine.localDb.put('seeders:' + hex(seederKey), { seederKey: hex(seederKey), pairedAt: Date.now() })
        sweep().catch(() => {})
        resolve({ seederKey: hex(seederKey) })
      }
      const onConnection = (conn) => {
        // Talk only to the seeder the link names.
        if (!conn.remotePublicKey || !b4a.equals(conn.remotePublicKey, seederKey)) return
        const mux = Protomux.from(conn)
        const ch = mux.createChannel({ protocol: PAIR_PROTOCOL, id: rv, onopen: () => msg.send({ t: 'trust', deviceKey: hex(swarm.keyPair.publicKey) }) })
        if (!ch) return
        channels.push(ch)
        const msg = ch.addMessage({
          encoding: c.json,
          onmessage: (r) => {
            if (r && r.t === 'ok') finish(null)
            else if (r && r.t === 'no') finish(new Error(r.reason || 'The seeder refused'))
          }
        })
        ch.open()
      }
      const timer = setTimeout(() => finish(new Error('Could not reach the seeder. Check it is running and the pairing window is open.')), timeoutMs)
      swarm.on('connection', onConnection)
      for (const conn of swarm.connections) onConnection(conn)
      const discovery = swarm.join(topic, { server: false, client: true })
      // Look again while waiting, as joins do.
      const again = setInterval(() => discovery.refresh({ server: false, client: true }).catch(() => {}), 4000)
    })
  }

  // Ask every seeder this device is paired with, and that the sheet lists,
  // to drop the sheet's data after `afterMs`. Best effort: a seeder that is
  // unreachable keeps the data (proposals/2026-10-04-deleting-sheets.md).
  async function requestDrop ({ bootstrap, seederKeys, afterMs }) {
    const mine = new Set(await pairedSeeders())
    const results = []
    for (const key of seederKeys) {
      if (!mine.has(key)) continue
      results.push(await dropAt(key, bootstrap, afterMs).catch((e) => ({ seederKey: key, error: e.message })))
    }
    return results
  }

  function dropAt (seederKey, bootstrap, afterMs) {
    return ask(seederKey, { t: 'drop', bootstrap, afterMs }).then((r) => ({ seederKey, due: r.due }))
  }

  // Tell our paired seeders among `seederKeys` that the sheet is wanted again
  // (proposals/2026-10-04-stop-backing-up.md, section 4).
  async function requestKeep ({ bootstrap, seederKeys }) {
    const mine = new Set(await pairedSeeders())
    const results = []
    for (const key of seederKeys) {
      if (!mine.has(key)) continue
      results.push(await ask(key, { t: 'keep', bootstrap }).then((r) => ({ seederKey: key, cancelled: r.cancelled }), (e) => ({ seederKey: key, error: e.message })))
    }
    return results
  }

  // A keep request that is retried a few times if the seeder cannot be
  // reached yet; the drop it cancels is DROP_GRACE_MS away.
  // Resolves after the first try, whatever its outcome.
  function keepInBackground (bootstrap, seederKey, tries = [0, 10000, 30000]) {
    return new Promise((resolve) => {
      const attempt = (i) => setTimeout(() => {
        if (closed) return resolve()
        requestKeep({ bootstrap, seederKeys: [seederKey] }).then((rs) => {
          resolve()
          const failed = rs.find((r) => r.error)
          if (!failed) return
          if (i + 1 < tries.length) attempt(i + 1)
          else log('keep request to ' + seederKey.slice(0, 8) + ' failed: ' + failed.error)
        }, () => resolve())
      }, tries[i])
      attempt(0)
    })
  }

  // One request to a seeder on `pearoffice/seeder/1`, over a direct connection.
  function ask (seederKey, request, timeoutMs = 20000) {
    return new Promise((resolve, reject) => {
      const socket = engine.swarm.dht.connect(b4a.from(seederKey, 'hex'), { keyPair: engine.swarm.keyPair })
      const done = (err, value) => { clearTimeout(timer); try { socket.destroy() } catch {} if (err) reject(err); else resolve(value) }
      const timer = setTimeout(() => done(new Error('seeder did not answer')), timeoutMs)
      socket.on('error', () => {})
      socket.on('open', () => {
        const ch = Protomux.from(socket).createChannel({ protocol: SEEDER_PROTOCOL, onopen: () => msg.send(request) })
        if (!ch) return done(new Error('could not open a channel'))
        const msg = ch.addMessage({ encoding: c.json, onmessage: (m) => (m && m.t === 'ok' ? done(null, m) : done(new Error((m && m.reason) || 'refused'))) })
        ch.open()
      })
    })
  }

  // --- choosing seeders per sheet (proposals/2026-10-04-stop-backing-up.md) --

  async function canStop (base, listing) {
    const me = hex(engine.identity.publicKey)
    if (!base.writable) return false
    const member = (await base.view.get('member/' + me))?.value
    if (!member) return false
    return member.role === 'owner' || (member.role === 'editor' && listing.addedBy === me)
  }

  // The seeders a sheet backs up to, and our paired ones it could.
  async function sheetSeeders (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base) throw new Error('No such sheet')
    await base.ready()
    const mine = new Set(await pairedSeeders())
    const listed = []
    for await (const { value } of base.view.createReadStream({ gt: 'seeder/', lt: 'seeder/~' })) {
      listed.push({ seederKey: value.seederKey, addedBy: value.addedBy, mine: mine.has(value.seederKey), canStop: await canStop(base, value) })
    }
    const me = hex(engine.identity.publicKey)
    const member = (await base.view.get('member/' + me))?.value
    const canAdd = base.writable && !!member && (member.role === 'owner' || member.role === 'editor')
    const available = canAdd ? [...mine].filter((k) => !listed.some((x) => x.seederKey === k)) : []
    return { listed, available }
  }

  async function removeFromSheet (sheetId, seederKey) {
    const base = engine.bases.get(sheetId)
    if (!base) throw new Error('No such sheet')
    const listing = (await base.view.get('seeder/' + seederKey))?.value
    if (!listing) throw new Error('This sheet does not back up to that seeder')
    if (!(await canStop(base, listing))) throw new Error('Only the owner or whoever added this seeder can stop it')
    await engine.append(sheetId, m.seederOffOp({ sheetId, identity: engine.identity, seederKey }))
    await sweep()
  }

  async function addToSheet (sheetId, seederKey) {
    const base = engine.bases.get(sheetId)
    if (!base) throw new Error('No such sheet')
    if (!(await pairedSeeders()).includes(seederKey)) throw new Error('This device is not paired with that seeder')
    await engine.append(sheetId, m.seederOp({ sheetId, identity: engine.identity, seederKey }))
    // Listed again: cancel the drop that taking it off scheduled, then
    // register with it. In the background: reaching the seeder can take
    // longer than the UI waits, and nothing the person sees depends on it.
    keepInBackground(hex(base.key), seederKey).then(() => sweep()).catch(() => {})
  }

  // Stop using a seeder on this device: take it off every sheet where we may,
  // ask it to drop those, then forget it. Listings by other people stay.
  async function stopUsing (seederKey) {
    let stopped = 0
    let kept = 0
    for (const [sheetId, base] of engine.bases) {
      const listing = (await base.view.get('seeder/' + seederKey))?.value
      if (!listing) continue
      if (!(await canStop(base, listing))) { kept++; continue }
      await engine.append(sheetId, m.seederOffOp({ sheetId, identity: engine.identity, seederKey }))
      await requestDrop({ bootstrap: hex(base.key), seederKeys: [seederKey], afterMs: DROP_GRACE_MS }).catch(() => {})
      stopped++
    }
    await engine.localDb.del('seeders:' + seederKey)
    await sweep()
    log('stopped using seeder ' + seederKey.slice(0, 8) + ': ' + stopped + ' sheet(s) off, ' + kept + ' kept by others')
    return { stopped, keptByOthers: kept }
  }

  // What stopping a seeder would do, for the confirmation.
  async function stopPreview (seederKey) {
    const out = { stop: [], keep: [] }
    for (const [sheetId, base] of engine.bases) {
      const listing = (await base.view.get('seeder/' + seederKey))?.value
      if (!listing) continue
      const title = (await engine.localDb.get('groups:joined:' + sheetId))?.value?.name || ''
      ;(await canStop(base, listing) ? out.stop : out.keep).push({ sheetId, title })
    }
    return out
  }

  async function list () {
    return (await pairedSeeders()).map((seederKey) => ({ seederKey }))
  }

  async function close () {
    closed = true
    clearInterval(sweepTimer)
    if (peering) await peering.close().catch(() => {})
  }

  return { start, pair, list, register, sweep, close, requestDrop, requestKeep, sheetSeeders, removeFromSheet, addToSheet, stopUsing, stopPreview, get peering () { return peering } }
}

module.exports = { createSeeding }
