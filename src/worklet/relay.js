// The PeerLoom blind relay: the fallback when two devices cannot connect
// directly (proposals/2026-10-08-blind-relay.md). Adopted from PearList
// (pearlist/src/relay.js), which keeps it in step with PearTune, where the
// relay node was built. Same relay key, same direct-first rule.
//
// The relay forwards the still-encrypted stream, so it sees which two keys
// talk and how many bytes, never a file or a key. Above the socket nothing
// changes: the same stream and the same authenticated remote key as a direct
// connection.
//
// Two ways out:
//   - the members' Hyperswarm takes `swarmRelayThrough`, a function it asks
//     on every dial: null (direct) until a holepunch to that peer failed;
//   - seeder dials (blind-peering backups, seeding.js requests) use
//     dht.connect outside Hyperswarm, where a relay key means "relay from the
//     first attempt" (hyperdht/lib/connect.js). `relayingDht` wraps the DHT so
//     those are direct first too, per seeder.

const z32 = require('z32')
const b4a = require('b4a')

// The deployed PeerLoom relay (2026-07-23), shared by the whole suite.
const RELAY_PUBLIC_KEY_Z = 'qshao3eawtzecrt5p7buswr4meyyhw6q6b51qtxazd8wwfdp8uqy'
const RELAY_PUBLIC_KEY = RELAY_PUBLIC_KEY_Z ? z32.decode(RELAY_PUBLIC_KEY_Z) : null

// localDb key holding the switch (Settings, "Connect anywhere"). This device only.
const PREF_KEY = 'relay'

// The errors after which a direct connection will not work: Hyperswarm's own
// list (hyperswarm/index.js shouldForceRelaying).
const PUNCH_FAILED = new Set(['HOLEPUNCH_ABORTED', 'HOLEPUNCH_DOUBLE_RANDOMIZED_NATS', 'REMOTE_NOT_HOLEPUNCHABLE'])

// The rule: the relay key, or null for a direct attempt. Off or not
// configured gates first, so a device switched off never relays.
function relayThroughFor ({ force, randomized, useRelay, relayKey }) {
  if (!useRelay || !relayKey) return null
  return (force || randomized) ? relayKey : null
}

// One per engine. `hydrated` stays false until the stored switch is read, and
// until then nothing relays, so a device switched off never leaks a dial in
// the moment before the read lands.
function createRelay ({ relayKey = RELAY_PUBLIC_KEY } = {}) {
  const prefs = { useRelay: true, hydrated: false }

  function set (on) {
    prefs.useRelay = on !== false
    prefs.hydrated = true
    return prefs.useRelay
  }

  // A failed read must not switch the fallback off: default on.
  async function hydrate (localDb) {
    try {
      const row = await localDb.get(PREF_KEY)
      return set(!(row && row.value && row.value.useRelay === false))
    } catch {
      return set(true)
    }
  }

  async function save (localDb, on) {
    const v = set(on)
    await localDb.put(PREF_KEY, { useRelay: v })
    return v
  }

  function swarmRelayThrough (force, swarm) {
    if (!prefs.hydrated) return null
    return relayThroughFor({ force, randomized: !!(swarm && swarm.dht && swarm.dht.randomized), useRelay: prefs.useRelay, relayKey })
  }

  // The DHT, with connect() direct first per remote key: after a holepunch
  // failure to a key, later connects to it go through the relay.
  function relayingDht (dht) {
    const failed = new Set()
    const stats = { direct: 0, relayed: 0, punchFailures: 0 }
    function connect (remotePublicKey, opts = {}) {
      const key = b4a.toString(remotePublicKey, 'hex')
      const relayThrough = prefs.hydrated
        ? relayThroughFor({ force: failed.has(key), randomized: !!dht.randomized, useRelay: prefs.useRelay, relayKey })
        : null
      if (relayThrough) stats.relayed++
      else stats.direct++
      const socket = dht.connect(remotePublicKey, relayThrough ? { ...opts, relayThrough } : opts)
      socket.on('error', (err) => {
        if (err && PUNCH_FAILED.has(err.code)) { failed.add(key); stats.punchFailures++ }
      })
      return socket
    }
    const wrapped = new Proxy(dht, {
      get (target, prop) {
        if (prop === 'connect') return connect
        if (prop === 'relayStats') return stats
        const v = Reflect.get(target, prop, target)
        return typeof v === 'function' ? v.bind(target) : v
      }
    })
    return wrapped
  }

  return {
    hydrate,
    save,
    get useRelay () { return prefs.useRelay },
    get hydrated () { return prefs.hydrated },
    configured: !!relayKey,
    swarmRelayThrough,
    relayingDht
  }
}

module.exports = { createRelay, relayThroughFor, RELAY_PUBLIC_KEY, RELAY_PUBLIC_KEY_Z, PREF_KEY, PUNCH_FAILED }
