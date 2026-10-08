// Bringing files back after a restore from the recovery phrase
// (proposals/2026-10-07-phrase-recovers-files.md, step 4).
//
// `app:restorePhrase` leaves `restore:pending` in localDb and the worklet
// restarts with the restored identity. Then this:
//
//   1. joins the keyring's topic and asks each seeder found there for the
//      keyring, keeping every version that opens, merged;
//   2. claims each seeder that had it, and each seeder it lists, so they
//      treat this device as paired (keyringRecord.js);
//   3. opens every file it lists the way a linked device does
//      (ownDevices.take), marking each `recovered:<sheetId>`.
//
// Each file then waits for another owner's or editor's device to let this
// device in (moves.followDevice). A file nobody else can let it into
// offers a copy this person owns (moves.recoverCopy).

const b4a = require('b4a')
const { deriveKeys, open, merge, empty, files, seeders, signClaim } = require('./keyring')

const hex = (buf) => b4a.toString(buf, 'hex')

function createRestoring ({ engine, getSeeding, getOwnDevices, emit = () => {}, log = () => {}, now = () => Date.now(), lookMs = 90 * 1000, settleMs = 5000 }) {
  let closed = false
  let running = null
  let stop = null // ends a search under way

  async function setStatus (status) {
    await engine.localDb.put('restore:status', { ...status, at: now() })
    emit('restore:changed', status)
  }

  async function status () {
    return (await engine.localDb.get('restore:status'))?.value || null
  }

  // Looks for the keyring on the seeders announcing its topic. Resolves
  // { keyring, seq, holders } or null when none turned up within `lookMs`.
  function find (keys) {
    const swarm = engine.swarm
    const seeding = getSeeding()
    const locator = hex(keys.locator)
    return new Promise((resolve) => {
      const tried = new Set()
      const holders = []
      let keyring = null
      let seq = 0
      let settle = null
      let again = null
      let finished = false
      const finish = () => {
        if (finished) return
        finished = true
        clearTimeout(timer)
        clearTimeout(settle)
        clearInterval(again)
        swarm.off('connection', onConnection)
        swarm.leave(keys.topic).catch(() => {})
        resolve(keyring ? { keyring, seq, holders } : null)
      }
      const tryKey = async (seederKey) => {
        if (tried.has(seederKey) || finished) return
        tried.add(seederKey)
        try {
          const rec = await seeding.keyringGet(seederKey, locator)
          const k = rec && open(rec, keys)
          if (!k || finished) return
          holders.push(seederKey)
          keyring = merge(keyring || empty(), k, now())
          seq = Math.max(seq, rec.seq)
          // Give other seeders a moment to answer, then go with what came.
          if (!settle) settle = setTimeout(finish, settleMs)
        } catch (e) { log('restore: no keyring from ' + seederKey.slice(0, 8) + ': ' + e.message) }
      }
      const onConnection = (conn, info) => {
        if (!conn.remotePublicKey || !info || !Array.isArray(info.topics)) return
        if (info.topics.some((t) => b4a.equals(t, keys.topic))) tryKey(hex(conn.remotePublicKey))
      }
      const timer = setTimeout(finish, lookMs)
      stop = finish
      swarm.on('connection', onConnection)
      let discovery
      try { discovery = swarm.join(keys.topic, { server: false, client: true }) } catch { return finish() }
      // A seeder already connected for another reason brings no new
      // connection event: look through the connections too.
      const known = () => {
        for (const conn of swarm.connections) {
          const peer = conn.remotePublicKey && swarm.peers.get(hex(conn.remotePublicKey))
          if (peer && (peer.topics || []).some((t) => b4a.equals(t, keys.topic))) tryKey(hex(conn.remotePublicKey))
        }
      }
      discovery.flushed().then(known).catch(() => {})
      again = setInterval(() => { known(); discovery.refresh({ server: false, client: true }).catch(() => {}) }, 5000)
    })
  }

  async function run () {
    const seeding = getSeeding()
    const own = getOwnDevices()
    if (closed || !seeding || !own) return null
    const keys = deriveKeys(b4a.from(engine.identity.secretKey.subarray(0, 32)))
    await setStatus({ state: 'looking' })
    if (closed) return null
    const found = await find(keys)
    if (closed) return null
    if (!found) {
      await engine.localDb.del('restore:pending')
      await setStatus({ state: 'none' })
      log('restore: no file list found')
      return { files: 0, seeders: 0 }
    }
    const locator = hex(keys.locator)
    const deviceKey = hex(engine.swarm.keyPair.publicKey)
    const list = files(found.keyring)
    for (const e of list) {
      if (!(await engine.localDb.get('groups:joined:' + e.sheetId))) await engine.localDb.put('recovered:' + e.sheetId, { at: now(), kind: e.kind || null })
    }
    const fromSeeders = [...new Set([...found.holders, ...seeders(found.keyring)])]
    // Start the keyring here from what came back, so this device's next
    // write carries it on.
    await engine.localDb.put('keyring:local', { seq: found.seq, keyring: found.keyring, fingerprint: '', held: [], at: now() })
    await setStatus({ state: 'opening', files: list.length })
    // The files' views, which name their seeders, come only from a seeder:
    // name these first, so each file asks them as soon as it is open (the
    // next seeding sweep registers it), even if opening waits on its data.
    for (const e of list) seeding.hint(e.sheetId, fromSeeders)
    await own.take(list)
    for (const e of list) seeding.hint(e.sheetId, fromSeeders)
    // Then every seeder at once: one that is gone does not hold up the rest.
    const claims = await Promise.all(fromSeeders.map((sk) => seeding.keyringClaim(sk, locator, signClaim(keys.signKeyPair, locator, sk, deviceKey)).then(() => true, (e) => {
      log('restore: seeder ' + sk.slice(0, 8) + ' did not take this device: ' + e.message)
      return false
    })))
    const claimed = claims.filter(Boolean).length
    await engine.localDb.del('restore:pending')
    await setStatus({ state: 'done', files: list.length, seeders: claimed })
    log('restore: ' + list.length + ' files from ' + found.holders.length + ' seeder(s)')
    return { files: list.length, seeders: claimed }
  }

  // On start: carry on with a restore that has not finished.
  async function start () {
    if (closed || !(await engine.localDb.get('restore:pending'))) return null
    if (!running) running = run().catch((e) => { log('restore failed: ' + e.message); return null }).finally(() => { running = null })
    return running
  }

  // Whether this device is in a file brought back by the phrase yet, and
  // whether it can only come back as a copy. Null for any other file.
  async function fileState (sheetId) {
    const rec = (await engine.localDb.get('recovered:' + sheetId))?.value
    if (!rec) return null
    const hintKind = rec.kind ? { kindHint: rec.kind } : {}
    const base = engine.bases.get(sheetId)
    if (!base) return { recovery: 'waiting', ...hintKind }
    await base.ready()
    if ((await base.view.get('device/' + hex(base.local.key)))) {
      await engine.localDb.del('recovered:' + sheetId)
      return null
    }
    // Until this device has the member list, it cannot tell who could let
    // it in: wait.
    const me = hex(engine.identity.publicKey)
    let mine = false
    for await (const { value } of base.view.createReadStream({ gt: 'member/', lt: 'member/~' })) {
      if (!value) continue
      if (value.identity === me) mine = true
      else if (value.role === 'owner' || value.role === 'editor') return { recovery: 'waiting', ...hintKind }
    }
    return { recovery: mine ? 'copy' : 'waiting', ...hintKind }
  }

  function close () {
    closed = true
    if (stop) stop()
  }

  return { start, run, status, fileState, close }
}

module.exports = { createRestoring }
