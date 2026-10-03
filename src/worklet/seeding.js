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
const { PAIR_PROTOCOL, PAIR_WINDOW_MS, pairTopic, parseSeederLink } = require('../seeder/protocol')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const SWEEP_MS = 5000

function createSeeding ({ engine, log = () => {} }) {
  let peering = null
  const registered = new Map() // sheetId -> sorted seeder keys string
  let sweepTimer = null

  function start () {
    peering = new BlindPeering(engine.swarm.dht, engine.store, { wakeup: new Wakeup() })
    // blind-peering dials with `peering.keyPair`, which it never sets, so the
    // DHT falls back to a random key per process. The seeder recognises paired
    // devices by key, so dial with this device's swarm key (the one sent at
    // pairing).
    peering.keyPair = engine.swarm.keyPair
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
    if (!base || !peering) return
    await base.ready()
    const keys = await seedersOf(base)
    const id = keys.join(',')
    if (!keys.length || registered.get(sheetId) === id) return
    registered.set(sheetId, id)
    peering.addAutobaseBackground(base, { keys: keys.map((k) => b4a.from(k, 'hex')), pick: keys.length })
    log('registered ' + sheetId.slice(0, 8) + ' with ' + keys.length + ' seeder(s)')
  }

  async function sweep () {
    await listOurSeeders()
    for (const sheetId of engine.bases.keys()) await register(sheetId)
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
        if (!listed.has(key)) await engine.append(sheetId, m.seederOp({ sheetId, identity: engine.identity, seederKey: key }))
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
      const finish = async (err) => {
        if (done) return
        done = true
        clearTimeout(timer)
        clearInterval(again)
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

  async function list () {
    return (await pairedSeeders()).map((seederKey) => ({ seederKey }))
  }

  async function close () {
    clearInterval(sweepTimer)
    if (peering) await peering.close().catch(() => {})
  }

  return { start, pair, list, register, sweep, close, get peering () { return peering } }
}

module.exports = { createSeeding }
