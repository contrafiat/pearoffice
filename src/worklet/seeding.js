// Device side of the blind seeder (wire protocol proposal, section 8).
//
// - pair(link): meet the seeder on its rendezvous topic, prove our swarm key,
//   remember the seeder, and list it in every sheet we can write to.
// - Every sheet is registered with the seeders listed in its own view, and
//   only those, through blind-peering. A seeder never learns about sheets it
//   is not listed in.
//
// - A document's picture cores (pictures.js) are registered with the same
//   seeders, with the file's base key as referrer, so the seeder files them
//   under the file and drops them with it.
//
// blind-peering sends core keys and lengths. It never sends the encryption
// key or the topic key.
//
// Talking to seeders is @peerloom/seeder's client (vendored in src/seeder/vendor). This
// file decides which sheets go to which seeders.

const b4a = require('b4a')
const { createPeering, pair: pairWithSeeder, createAsker } = require('../seeder/vendor/peerloom-seeder/src/client')
const { PAIR_WINDOW_MS, DROP_GRACE_MS } = require('../seeder/protocol')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const SWEEP_MS = 5000

function createSeeding ({ engine, dhtOf = (dht) => dht, getPictures = () => null, log = () => {} }) {
  let peering = null
  const registered = new Map() // sheetId -> seeder keys registered with `peering`
  const registeredCores = new Map() // picture core key -> seeder keys and length registered
  const seen = new Map() // sheetId -> the sheet's seeder list when last swept
  let sweepTimer = null
  let sweeping = null
  let closed = false
  let rebuildNeeded = false

  // Dials with this device's swarm key, the one sent at pairing.
  function makePeering () {
    peering = createPeering({ dht: dhtOf(engine.swarm.dht), store: engine.store, keyPair: engine.swarm.keyPair })
  }

  // blind-peering cannot forget one base, so when a seeder is taken off a
  // sheet, start over with a fresh instance and register every sheet again.
  async function rebuild () {
    if (closed) return
    const old = peering
    makePeering()
    registered.clear()
    registeredCores.clear()
    if (old) await old.close().catch(() => {})
  }

  function start () {
    // Started on a timer after the swarm: an engine closed by then stays closed.
    if (closed) return
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

  // Seeders to use for a file whose view names none yet: after a restore
  // from the phrase, the view arrives only from a seeder (restoring.js).
  const hints = new Map() // sheetId -> [seederKey]
  function hint (sheetId, seederKeys) {
    hints.set(sheetId, [...new Set(seederKeys)].sort())
    register(sheetId).catch(() => {})
  }

  async function register (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base || !peering || closed) return
    await base.ready()
    let keys = await seedersOf(base)
    if (keys.length) hints.delete(sheetId)
    else if (hints.has(sheetId)) keys = hints.get(sheetId)
    const id = keys.join(',')
    const prev = seen.get(sheetId)
    seen.set(sheetId, id)
    const removed = prev ? prev.split(',').filter((k) => !keys.includes(k)) : []
    if (removed.length) {
      log('seeder taken off ' + sheetId.slice(0, 8))
      requestDrop({ bootstrap: hex(base.key), seederKeys: removed, afterMs: DROP_GRACE_MS }).catch(() => {})
      rebuildNeeded = true
    }
    if (rebuildNeeded || !keys.length) return
    if (registered.get(sheetId) !== id) {
      registered.set(sheetId, id)
      peering.addAutobaseBackground(base, { keys: keys.map((k) => b4a.from(k, 'hex')), pick: keys.length })
      log('registered ' + sheetId.slice(0, 8) + ' with ' + keys.length + ' seeder(s)')
    }
    // Picture cores, again whenever one grew (a new picture).
    const pictures = getPictures()
    for (const core of pictures ? await pictures.cores(sheetId) : []) {
      if (core.closing || core.closed || !core.length) continue
      const k = hex(core.key)
      const at = id + '@' + core.length
      if (registeredCores.get(k) === at) continue
      registeredCores.set(k, at)
      peering.addCoreBackground(core, { referrer: base.key, keys: keys.map((x) => b4a.from(x, 'hex')), pick: keys.length })
    }
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

  // Pair with a seeder from the link it shows, either a PearOffice seeder's
  // or a shared PeerLoom seeder's. Resolves once the seeder has accepted this
  // device.
  async function pair (link, { timeoutMs = PAIR_WINDOW_MS } = {}) {
    const { seederKey } = await pairWithSeeder({ swarm: engine.swarm, link, app: 'PearOffice', timeoutMs })
    await engine.localDb.put('seeders:' + seederKey, { seederKey, pairedAt: Date.now() })
    // Pairing again is a deliberate choice: files this person took the
    // seeder off (Stop using, or per file) back up to it again. Taken off by
    // someone else stays off.
    const me = hex(engine.identity.publicKey)
    for (const [sheetId, base] of engine.bases) {
      if (!base.writable) continue
      const off = (await base.view.get('seederOff/' + seederKey))?.value
      if (!off || off.by !== me) continue
      const member = (await base.view.get('member/' + me))?.value
      if (!member || (member.role !== 'owner' && member.role !== 'editor')) continue
      await engine.append(sheetId, m.seederOp({ sheetId, identity: engine.identity, seederKey })).catch((e) => log('re-adding a seeder failed: ' + e.message))
      keepInBackground(hex(base.key), seederKey).catch(() => {})
    }
    sweep().catch(() => {})
    return { seederKey }
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

  // One request to a seeder, over the backup connection to it when one is
  // open. Always under the `pearoffice/seeder/1` name: PearOffice seeders know
  // only that one, and shared seeders answer it too.
  const { ask } = createAsker({
    dht: () => dhtOf(engine.swarm.dht),
    keyPair: () => engine.swarm.keyPair,
    openSocket: (seederKey) => {
      const bp = peering && peering.blindPeers.get(seederKey)
      return bp && bp.connected && bp.socket
    },
    styleOf: () => 'pearoffice'
  })

  // --- keyrings (proposals/2026-10-07-phrase-recovers-files.md) -------------

  // rec: a sealed keyring (keyring.js seal). Resolves { seq }.
  function keyringPut (seederKey, rec) {
    return ask(seederKey, { t: 'keyring-put', rec }).then((r) => ({ seq: r.seq }))
  }

  // The sealed keyring the seeder holds at `locator` (hex), or null.
  function keyringGet (seederKey, locator) {
    return ask(seederKey, { t: 'keyring-get', locator }).then((r) => r.rec || null)
  }

  // Asks the seeder to treat this device as paired, proving the keyring's
  // sign key (keyringRecord.js), and remembers it as paired here.
  async function keyringClaim (seederKey, locator, sig) {
    await ask(seederKey, { t: 'keyring-claim', locator, sig })
    if (!(await engine.localDb.get('seeders:' + seederKey))) {
      await engine.localDb.put('seeders:' + seederKey, { seederKey, pairedAt: Date.now() })
      sweep().catch(() => {})
    }
    return { paired: true }
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
    if (!base) throw new Error('No such file')
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
    if (!base) throw new Error('No such file')
    const listing = (await base.view.get('seeder/' + seederKey))?.value
    if (!listing) throw new Error('This file does not back up to that seeder')
    if (!(await canStop(base, listing))) throw new Error('Only the owner or whoever added this seeder can stop it')
    await engine.append(sheetId, m.seederOffOp({ sheetId, identity: engine.identity, seederKey }))
    await sweep()
  }

  async function addToSheet (sheetId, seederKey) {
    const base = engine.bases.get(sheetId)
    if (!base) throw new Error('No such file')
    if (!(await pairedSeeders()).includes(seederKey)) throw new Error('This device is not paired with that seeder')
    await engine.append(sheetId, m.seederOp({ sheetId, identity: engine.identity, seederKey }))
    // Listed again: cancel the drop that taking it off scheduled, then
    // register with it. In the background: reaching the seeder can take
    // longer than the UI waits, and nothing the person sees depends on it.
    keepInBackground(hex(base.key), seederKey).then(() => sweep()).catch(() => {})
  }

  // The drop requests stopUsing sent in the background (tests wait on them).
  const pendingDrops = new Set()
  function settled () { return Promise.all([...pendingDrops]) }

  // Stop using a seeder on this device: take it off every sheet where we may
  // and forget it, then ask it to drop those sheets. Listings by other people
  // stay; `kept` names them and who added the seeder there.
  async function stopUsing (seederKey) {
    let stopped = 0
    const kept = []
    const drops = []
    for (const [sheetId, base] of engine.bases) {
      const listing = (await base.view.get('seeder/' + seederKey))?.value
      if (!listing) continue
      if (!(await canStop(base, listing))) {
        const title = (await engine.localDb.get('groups:joined:' + sheetId))?.value?.name || ''
        const adder = listing.addedBy ? (await base.view.get('member/' + listing.addedBy))?.value : null
        kept.push({ sheetId, title, addedByName: adder?.name || null })
        continue
      }
      await engine.append(sheetId, m.seederOffOp({ sheetId, identity: engine.identity, seederKey }))
      drops.push(hex(base.key))
      stopped++
    }
    await engine.localDb.del('seeders:' + seederKey)
    sweep().catch(() => {})
    // In the background, so an unreachable seeder does not hold up the
    // screen. One after another over the backup connection, which answers in
    // milliseconds; separate connections in parallel lost requests.
    const dropped = (async () => {
      for (const bootstrap of drops) {
        await dropAt(seederKey, bootstrap, DROP_GRACE_MS).catch((e) => log('drop request to ' + seederKey.slice(0, 8) + ' failed: ' + e.message))
      }
    })()
    pendingDrops.add(dropped)
    dropped.finally(() => pendingDrops.delete(dropped))
    log('stopped using seeder ' + seederKey.slice(0, 8) + ': ' + stopped + ' sheet(s) off, ' + kept.length + ' kept by others')
    return { stopped, keptByOthers: kept.length, kept }
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

  // Paired seeders, each with how many sheets back up to it.
  async function list () {
    const counts = new Map()
    for (const [, base] of engine.bases) {
      for (const key of await seedersOf(base).catch(() => [])) counts.set(key, (counts.get(key) || 0) + 1)
    }
    return (await pairedSeeders()).map((seederKey) => ({ seederKey, sheets: counts.get(seederKey) || 0 }))
  }

  async function close () {
    closed = true
    clearInterval(sweepTimer)
    if (peering) await peering.close().catch(() => {})
  }

  return { start, pair, list, hint, keyringPut, keyringGet, keyringClaim, register, sweep, close, requestDrop, requestKeep, sheetSeeders, removeFromSheet, addToSheet, stopUsing, stopPreview, settled, get peering () { return peering } }
}

module.exports = { createSeeding }
