// The PearOffice seeder: Holepunch's blind-peer, plus the rule that it stores
// only sheets a paired device registered (wire protocol proposal, section 8).
//
// The seeder never receives a sheet's encryption key or topic key. It gets
// core keys and lengths through blind-peering, stores the encrypted blocks and
// serves them. It can check blocks but not read them.
//
// Which cores it accepts:
//   - from a paired device: any, and the core's referrer (the sheet's
//     bootstrap key) is added to the allowed list;
//   - from anyone else: only cores whose referrer is already on the list, so
//     the other members of a paired person's sheets can back up too.
// Strangers would need a registered sheet's bootstrap key, which only members
// and the seeder hold.
//
// It also keeps keyrings (proposals/2026-10-07-phrase-recovers-files.md):
// a person's encrypted file list, put by their paired devices, handed to
// anyone who knows its locator, and announced on its topic so a device
// restored from the phrase can find it. A device that proves the keyring's
// sign key counts as paired (keyringRecord.js, claims). The seeder cannot
// open a keyring.
//
// blind-peer is pinned to an exact version in package.json because this file
// wraps two of its internal methods (_onaddcore, _onaddcores).

const BlindPeer = require('blind-peer')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const IdEnc = require('hypercore-id-encoding')
const { PAIR_PROTOCOL, PAIR_WINDOW_MS, SEEDER_PROTOCOL, DROP_MAX_MS, DROP_GRACE_MS, pairTopic, seederLink } = require('./protocol')
const { checkSealed, checkClaim, topicOf } = require('./keyringRecord')

const DROP_SWEEP_MS = 60 * 60 * 1000
const KEYRINGS_PER_DEVICE = 4

const hex = (buf) => b4a.toString(buf, 'hex')

class SheetSeeder extends BlindPeer {
  constructor (dataDir, opts = {}) {
    super(dataDir + '/blind-peer', opts)
    this.pearoffice = opts.pearoffice
  }

  async _onaddcore (stream, record) {
    const sheet = await this.pearoffice.admit(stream, record.referrer)
    await this.pearoffice.track(sheet, [record.key])
    return super._onaddcore(stream, record)
  }

  async _onaddcores (stream, request) {
    const sheet = await this.pearoffice.admit(stream, request.referrer)
    await this.pearoffice.track(sheet, (request.cores || []).map((c) => c.key))
    return super._onaddcores(stream, request)
  }
}

async function createSeeder ({ dataDir, bootstrap = null, log = () => {} }) {
  const stateStore = new Corestore(dataDir + '/pearoffice-state')
  const state = new Hyperbee(stateStore.get({ name: 'state' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
  await state.ready()

  const paired = new Set()
  const allowed = new Set()
  // Which paired devices registered each sheet
  // (proposals/2026-10-04-stop-backing-up.md). Older records kept only the
  // first, as a string.
  const registrants = new Map() // bootstrap -> Set of device keys
  for await (const { key } of state.createReadStream({ gt: 'device/', lt: 'device/~' })) paired.add(key.slice(7))
  for await (const { key, value } of state.createReadStream({ gt: 'sheet/', lt: 'sheet/~' })) {
    const sheet = key.slice(6)
    allowed.add(sheet)
    const by = value && value.by
    registrants.set(sheet, new Set(Array.isArray(by) ? by : by ? [by] : []))
  }

  // locator -> { signKey, seq, by: Set of device keys that put or claimed it }
  const keyrings = new Map()
  for await (const { key, value } of state.createReadStream({ gt: 'keyring/', lt: 'keyring/~' })) {
    if (value && value.rec) keyrings.set(key.slice(8), { signKey: value.rec.signKey, seq: value.rec.seq, by: new Set(value.by || []) })
  }

  async function addRegistrant (sheet, device) {
    const set = registrants.get(sheet) || new Set()
    if (allowed.has(sheet) && set.has(device)) return
    set.add(device)
    registrants.set(sheet, set)
    allowed.add(sheet)
    await state.put('sheet/' + sheet, { by: [...set], at: Date.now() })
  }

  // blind-peering sends an Autobase in batches: writer cores with the sheet's
  // bootstrap key as referrer, then view cores with no referrer. A connection
  // that has already shown an allowed referrer may send the follow-ups.
  const vouched = new WeakMap() // stream -> the allowed sheet it vouched for

  const rules = {
    async admit (stream, referrer) {
      const remote = hex(stream.remotePublicKey)
      const ref = referrer ? hex(referrer) : null
      if (paired.has(remote)) {
        if (ref && !(registrants.get(ref) || new Set()).has(remote)) {
          if (!allowed.has(ref)) log('allowed sheet ' + ref.slice(0, 8) + ' (registered by a paired device)')
          await addRegistrant(ref, remote)
        }
        if (ref) vouched.set(stream, ref)
        return ref || vouched.get(stream) || null
      }
      if (ref && allowed.has(ref)) { vouched.set(stream, ref); return ref }
      if (!ref && vouched.has(stream)) return vouched.get(stream)
      log('refused cores from ' + remote.slice(0, 8))
      throw new Error('This seeder only stores files registered by a paired device')
    },

    // Remember which cores belong to which sheet, so a drop can find them.
    async track (sheet, keys) {
      if (!sheet) return
      const batch = state.batch()
      for (const key of keys) if (key) await batch.put('core/' + sheet + '/' + hex(key), {})
      await batch.flush()
    }
  }

  // --- drops (proposals/2026-10-04-deleting-sheets.md) -----------------------

  async function scheduleDrop (sheet, afterMs) {
    const due = Date.now() + Math.max(0, Math.min(DROP_MAX_MS, Number(afterMs) || 0))
    const existing = (await state.get('drop/' + sheet))?.value
    if (!existing || existing.due > due) await state.put('drop/' + sheet, { due })
    log('drop of sheet ' + sheet.slice(0, 8) + ' due ' + new Date(due).toISOString())
    if (due <= Date.now()) runDrops().catch((e) => log('drop failed: ' + e.message))
    return due
  }

  // Clear and forget every core of each sheet whose drop is due, through
  // blind-peer's own delete path (it also stops announcing and replicating).
  async function runDrops (now = Date.now()) {
    const due = []
    for await (const { key, value } of state.createReadStream({ gt: 'drop/', lt: 'drop/~' })) {
      if (value && value.due <= now) due.push(key.slice(5))
    }
    for (const sheet of due) {
      const self = { remotePublicKey: peer.publicKey, rawStream: { remoteHost: '127.0.0.1' } }
      peer.addTrustedPubKey(peer.publicKey)
      let n = 0
      for await (const { key } of state.createReadStream({ gt: 'core/' + sheet + '/', lt: 'core/' + sheet + '/~' })) {
        const coreKey = b4a.from(key.slice(('core/' + sheet + '/').length), 'hex')
        try { if (await peer._ondeletecore(self, { key: coreKey })) n++ } catch (e) { log('could not delete a core: ' + e.message) }
        await state.del(key)
      }
      allowed.delete(sheet)
      registrants.delete(sheet)
      await state.del('sheet/' + sheet)
      await state.del('drop/' + sheet)
      log('dropped sheet ' + sheet.slice(0, 8) + ' (' + n + ' cores)')
    }
    return due.length
  }
  // A paired device still wants the sheet: cancel a pending drop.
  async function keep (sheet, device) {
    await addRegistrant(sheet, device)
    const pending = (await state.get('drop/' + sheet))?.value
    if (pending) { await state.del('drop/' + sheet); log('drop of sheet ' + sheet.slice(0, 8) + ' cancelled') }
    return !!pending
  }

  // Forget a paired device: refuse it from now on and drop, after the grace
  // period, every sheet no other paired device registered.
  async function forgetDevice (deviceKey) {
    if (!paired.has(deviceKey)) return { forgotten: false, dropping: 0 }
    paired.delete(deviceKey)
    await state.del('device/' + deviceKey)
    peer.trustedPubKeys.delete(IdEnc.normalize(b4a.from(deviceKey, 'hex')))
    for (const conn of peer.swarm.connections) {
      if (conn.remotePublicKey && hex(conn.remotePublicKey) === deviceKey) conn.destroy()
    }
    let dropping = 0
    for (const [sheet, set] of registrants) {
      if (!set.delete(deviceKey)) continue
      await state.put('sheet/' + sheet, { by: [...set], at: Date.now() })
      if (![...set].some((d) => paired.has(d))) { await scheduleDrop(sheet, DROP_GRACE_MS); dropping++ }
    }
    for (const [locator, k] of keyrings) {
      if (!k.by.delete(deviceKey)) continue
      if ([...k.by].some((d) => paired.has(d))) {
        const rec = (await state.get('keyring/' + locator))?.value?.rec
        await state.put('keyring/' + locator, { rec, by: [...k.by] })
      } else {
        await dropKeyring(locator)
      }
    }
    log('forgot device ' + deviceKey.slice(0, 8) + ', dropping ' + dropping + ' sheet(s)')
    return { forgotten: true, dropping }
  }

  async function devices () {
    const out = []
    for await (const { key, value } of state.createReadStream({ gt: 'device/', lt: 'device/~' })) {
      const deviceKey = key.slice(7)
      let sheets = 0
      for (const set of registrants.values()) if (set.has(deviceKey)) sheets++
      out.push({ deviceKey, pairedAt: value && value.at, sheets })
    }
    return out
  }

  const dropTimer = setInterval(() => runDrops().catch((e) => log('drop sweep failed: ' + e.message)), DROP_SWEEP_MS)
  if (dropTimer.unref) dropTimer.unref()

  const peer = new SheetSeeder(dataDir, { bootstrap, pearoffice: rules, trustedPubKeys: [...paired].map((k) => b4a.from(k, 'hex')) })
  await peer.listen()
  const seederKey = peer.publicKey

  // --- keyrings ------------------------------------------------------------

  for (const locator of keyrings.keys()) announce(locator)

  function announce (locator) {
    peer.swarm.join(topicOf(b4a.from(locator, 'hex')), { server: true, client: false })
  }

  async function dropKeyring (locator) {
    keyrings.delete(locator)
    await state.del('keyring/' + locator)
    peer.swarm.leave(topicOf(b4a.from(locator, 'hex'))).catch(() => {})
    log('dropped keyring ' + locator.slice(0, 8))
  }

  function keyringsOf (device) {
    let n = 0
    for (const k of keyrings.values()) if (k.by.has(device)) n++
    return n
  }

  // Puts and claims run one at a time, so two devices writing at once
  // cannot both pass the seq check.
  let keyringLock = Promise.resolve()
  function locked (fn) {
    const run = keyringLock.then(fn)
    keyringLock = run.catch(() => {})
    return run
  }

  function putKeyring (rec, device) {
    return locked(async () => {
      if (!paired.has(device)) return { reason: 'Only paired devices can back up a file list' }
      if (!checkSealed(rec)) return { reason: 'This file list does not check out' }
      const have = keyrings.get(rec.locator)
      if (have && have.signKey !== rec.signKey) return { reason: 'This file list belongs to someone else' }
      if (have && rec.seq <= have.seq) return { reason: 'A newer file list is already here', seq: have.seq }
      if (!(have && have.by.has(device)) && keyringsOf(device) >= KEYRINGS_PER_DEVICE) return { reason: 'This device has backed up too many file lists here' }
      const by = new Set(have ? have.by : [])
      by.add(device)
      const clean = { locator: rec.locator, seq: rec.seq, nonce: rec.nonce, ciphertext: rec.ciphertext, signKey: rec.signKey, sig: rec.sig }
      await state.put('keyring/' + rec.locator, { rec: clean, by: [...by] })
      keyrings.set(rec.locator, { signKey: rec.signKey, seq: rec.seq, by })
      if (!have) { announce(rec.locator); log('keeping keyring ' + rec.locator.slice(0, 8)) }
      return { seq: rec.seq }
    })
  }

  async function getKeyring (locator) {
    if (typeof locator !== 'string' || !keyrings.has(locator)) return null
    return (await state.get('keyring/' + locator))?.value?.rec || null
  }

  // A restored device proves the keyring's sign key: pair it.
  function claimKeyring (m, conn) {
    return locked(async () => {
      const device = hex(conn.remotePublicKey)
      const k = typeof m.locator === 'string' && keyrings.get(m.locator)
      if (!k || !checkClaim(m, k.signKey, hex(seederKey), device)) return { reason: 'This claim does not check out' }
      if (!k.by.has(device)) {
        if (keyringsOf(device) >= KEYRINGS_PER_DEVICE) return { reason: 'This device has backed up too many file lists here' }
        k.by.add(device)
        const rec = (await state.get('keyring/' + m.locator))?.value?.rec
        await state.put('keyring/' + m.locator, { rec, by: [...k.by] })
      }
      if (!paired.has(device)) {
        paired.add(device)
        await state.put('device/' + device, { at: Date.now(), via: 'keyring' })
        peer.addTrustedPubKey(conn.remotePublicKey)
        log('paired device ' + device.slice(0, 8) + ' (it proved keyring ' + m.locator.slice(0, 8) + ')')
      }
      return { paired: true }
    })
  }

  // --- pairing -----------------------------------------------------------

  let windowState = null // { rv, topic, timer, link }

  function openPairing (ms = PAIR_WINDOW_MS) {
    closePairing()
    const rv = b4a.alloc(32)
    sodium.randombytes_buf(rv)
    const topic = pairTopic(rv)
    peer.swarm.join(topic, { server: true, client: false })
    const link = seederLink({ rv, seederKey })
    windowState = { rv, topic, link, expiresAt: Date.now() + ms }
    windowState.timer = setTimeout(closePairing, ms)
    if (windowState.timer.unref) windowState.timer.unref()
    for (const conn of peer.swarm.connections) listenOn(conn)
    log('pairing open for ' + Math.round(ms / 60000) + ' min')
    return { link, expiresAt: windowState.expiresAt }
  }

  function closePairing () {
    if (!windowState) return
    clearTimeout(windowState.timer)
    peer.swarm.leave(windowState.topic).catch(() => {})
    windowState = null
  }

  function listenOn (conn) {
    if (!windowState) return
    const mux = Protomux.from(conn)
    const rv = windowState.rv
    mux.pair({ protocol: PAIR_PROTOCOL, id: rv }, () => openChannel(conn, mux, rv))
  }

  function openChannel (conn, mux, rv) {
    const ch = mux.createChannel({ protocol: PAIR_PROTOCOL, id: rv })
    if (!ch) return
    const msg = ch.addMessage({
      encoding: c.json,
      onmessage: async (m) => {
        if (!m || m.t !== 'trust') return
        if (!windowState || !b4a.equals(windowState.rv, rv)) return msg.send({ t: 'no', reason: 'The pairing window has closed. Open a new one on the seeder.' })
        // The device can only ask to trust the key it is connected with.
        if (m.deviceKey !== hex(conn.remotePublicKey)) return msg.send({ t: 'no', reason: 'Key mismatch' })
        if (!paired.has(m.deviceKey)) {
          paired.add(m.deviceKey)
          await state.put('device/' + m.deviceKey, { at: Date.now() })
          peer.addTrustedPubKey(conn.remotePublicKey)
          log('paired device ' + m.deviceKey.slice(0, 8))
        }
        msg.send({ t: 'ok' })
      }
    })
    ch.open()
  }

  // Requests from paired devices, on every connection.
  function listenRequests (conn) {
    const mux = Protomux.from(conn)
    mux.pair({ protocol: SEEDER_PROTOCOL }, () => openRequests(conn, mux))
  }

  function openRequests (conn, mux) {
    const ch = mux.createChannel({ protocol: SEEDER_PROTOCOL })
    if (!ch) return
    const msg = ch.addMessage({
      encoding: c.json,
      onmessage: async (m) => {
        if (!m) return
        const remote = hex(conn.remotePublicKey)
        const reply = (r) => msg.send(r.reason ? { t: 'no', reason: r.reason } : { t: 'ok', ...r })
        if (m.t === 'keyring-put') return reply(await putKeyring(m.rec, remote))
        if (m.t === 'keyring-get') return reply({ rec: await getKeyring(m.locator) })
        if (m.t === 'keyring-claim') return reply(await claimKeyring(m, conn))
        if (m.t !== 'drop' && m.t !== 'keep') return
        if (!paired.has(remote)) return msg.send({ t: 'no', reason: 'Only paired devices can ask for that' })
        if (typeof m.bootstrap !== 'string' || !allowed.has(m.bootstrap)) return msg.send({ t: 'no', reason: 'This seeder does not hold that file' })
        if (m.t === 'keep') return msg.send({ t: 'ok', cancelled: await keep(m.bootstrap, remote) })
        msg.send({ t: 'ok', due: await scheduleDrop(m.bootstrap, m.afterMs) })
      }
    })
    ch.open()
  }

  peer.swarm.on('connection', (conn) => { listenOn(conn); listenRequests(conn) })
  runDrops().catch(() => {}) // any that came due while the seeder was off

  async function status () {
    return {
      seederKey: hex(seederKey),
      pairedDevices: paired.size,
      sheets: allowed.size,
      keyrings: keyrings.size,
      coresAdded: peer.stats.coresAdded,
      pairing: windowState ? { link: windowState.link, expiresAt: windowState.expiresAt } : null
    }
  }

  async function close () {
    clearInterval(dropTimer)
    closePairing()
    await peer.close()
    await state.close()
    await stateStore.close()
  }

  async function drops () {
    const out = []
    for await (const { key, value } of state.createReadStream({ gt: 'drop/', lt: 'drop/~' })) out.push({ sheet: key.slice(5), due: value.due })
    return out
  }

  return { seederKey, peer, openPairing, closePairing, status, close, runDrops, scheduleDrop, drops, keep, forgetDevice, devices, isPaired: (k) => paired.has(hex(k)), allowedSheets: () => [...allowed] }
}

module.exports = { createSeeder }
