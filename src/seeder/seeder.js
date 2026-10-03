// The PearSheet seeder: Holepunch's blind-peer, plus the rule that it stores
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
// blind-peer is pinned to an exact version in package.json because this file
// wraps two of its internal methods (_onaddcore, _onaddcores).

const BlindPeer = require('blind-peer')
const Corestore = require('corestore')
const Hyperbee = require('hyperbee')
const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const { PAIR_PROTOCOL, PAIR_WINDOW_MS, pairTopic, seederLink } = require('./protocol')

const hex = (buf) => b4a.toString(buf, 'hex')

class SheetSeeder extends BlindPeer {
  constructor (dataDir, opts = {}) {
    super(dataDir + '/blind-peer', opts)
    this.pearsheet = opts.pearsheet
  }

  async _onaddcore (stream, record) {
    await this.pearsheet.admit(stream, record.referrer)
    return super._onaddcore(stream, record)
  }

  async _onaddcores (stream, request) {
    await this.pearsheet.admit(stream, request.referrer)
    return super._onaddcores(stream, request)
  }
}

async function createSeeder ({ dataDir, bootstrap = null, log = () => {} }) {
  const stateStore = new Corestore(dataDir + '/pearsheet-state')
  const state = new Hyperbee(stateStore.get({ name: 'state' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
  await state.ready()

  const paired = new Set()
  const allowed = new Set()
  for await (const { key } of state.createReadStream({ gt: 'device/', lt: 'device/~' })) paired.add(key.slice(7))
  for await (const { key } of state.createReadStream({ gt: 'sheet/', lt: 'sheet/~' })) allowed.add(key.slice(6))

  // blind-peering sends an Autobase in batches: writer cores with the sheet's
  // bootstrap key as referrer, then view cores with no referrer. A connection
  // that has already shown an allowed referrer may send the follow-ups.
  const vouched = new WeakSet()

  const rules = {
    async admit (stream, referrer) {
      const remote = hex(stream.remotePublicKey)
      const ref = referrer ? hex(referrer) : null
      if (paired.has(remote)) {
        if (ref && !allowed.has(ref)) {
          allowed.add(ref)
          await state.put('sheet/' + ref, { by: remote, at: Date.now() })
          log('allowed sheet ' + ref.slice(0, 8) + ' (registered by a paired device)')
        }
        return
      }
      if (ref && allowed.has(ref)) { vouched.add(stream); return }
      if (!ref && vouched.has(stream)) return
      log('refused cores from ' + remote.slice(0, 8))
      throw new Error('This seeder only stores sheets registered by a paired device')
    }
  }

  const peer = new SheetSeeder(dataDir, { bootstrap, pearsheet: rules, trustedPubKeys: [...paired].map((k) => b4a.from(k, 'hex')) })
  await peer.listen()
  const seederKey = peer.publicKey

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

  peer.swarm.on('connection', (conn) => listenOn(conn))

  async function status () {
    return {
      seederKey: hex(seederKey),
      pairedDevices: paired.size,
      sheets: allowed.size,
      coresAdded: peer.stats.coresAdded,
      pairing: windowState ? { link: windowState.link, expiresAt: windowState.expiresAt } : null
    }
  }

  async function close () {
    closePairing()
    await peer.close()
    await state.close()
    await stateStore.close()
  }

  return { seederKey, peer, openPairing, closePairing, status, close, isPaired: (k) => paired.has(hex(k)), allowedSheets: () => [...allowed] }
}

module.exports = { createSeeder }
