// The PeerLoom blind relay, direct first (proposals/2026-10-08-blind-relay.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const EventEmitter = require('node:events')
const b4a = require('b4a')
const { createRelay, relayThroughFor, RELAY_PUBLIC_KEY, PREF_KEY } = require('../src/worklet/relay')

const fakeDb = (rows = {}) => ({
  async get (k) { return k in rows ? { value: rows[k] } : null },
  async put (k, v) { rows[k] = v },
  rows
})

test('the rule: direct first, the relay only after a failed punch or a randomized NAT, never when off', () => {
  const relayKey = RELAY_PUBLIC_KEY
  assert.equal(RELAY_PUBLIC_KEY.length, 32, 'the shared suite key')
  assert.equal(relayThroughFor({ force: false, randomized: false, useRelay: true, relayKey }), null)
  assert.equal(relayThroughFor({ force: true, randomized: false, useRelay: true, relayKey }), relayKey)
  assert.equal(relayThroughFor({ force: false, randomized: true, useRelay: true, relayKey }), relayKey)
  assert.equal(relayThroughFor({ force: true, randomized: true, useRelay: false, relayKey }), null, 'switched off')
  assert.equal(relayThroughFor({ force: true, randomized: true, useRelay: true, relayKey: null }), null, 'no relay configured')
})

test('the switch: nothing relays before it is read; on by default; saved per device', async () => {
  const r = createRelay()
  assert.equal(r.swarmRelayThrough(true, null), null, 'not read yet')
  assert.equal(await r.hydrate(fakeDb()), true, 'on by default')
  assert.ok(b4a.equals(r.swarmRelayThrough(true, null), RELAY_PUBLIC_KEY))
  assert.equal(r.swarmRelayThrough(false, { dht: { randomized: false } }), null, 'direct first')
  const db = fakeDb()
  assert.equal(await r.save(db, false), false)
  assert.deepEqual(db.rows[PREF_KEY], { useRelay: false })
  assert.equal(r.swarmRelayThrough(true, null), null, 'off')
  const again = createRelay()
  assert.equal(await again.hydrate(db), false, 'read back off')
  const broken = createRelay()
  assert.equal(await broken.hydrate({ get: async () => { throw new Error('closed') } }), true, 'a failed read keeps it on')
})

test('seeder dials are direct first, per seeder', async () => {
  const calls = []
  const sockets = []
  const dht = {
    randomized: false,
    other () { return this === dht },
    connect (key, opts) { calls.push({ key: b4a.toString(key, 'hex'), relay: !!opts.relayThrough, keyPair: opts.keyPair }); const s = new EventEmitter(); sockets.push(s); return s }
  }
  const r = createRelay()
  await r.hydrate(fakeDb())
  const w = r.relayingDht(dht)
  assert.equal(w.other(), true, 'other methods still work on the real DHT')
  const a = b4a.alloc(32, 1)
  const b = b4a.alloc(32, 2)
  w.connect(a, { keyPair: 'kp' })
  assert.deepEqual(calls[0], { key: b4a.toString(a, 'hex'), relay: false, keyPair: 'kp' })
  sockets[0].emit('error', Object.assign(new Error('x'), { code: 'CONNECTION_REFUSED' }))
  w.connect(a, {})
  assert.equal(calls[1].relay, false, 'other errors stay direct')
  sockets[1].emit('error', Object.assign(new Error('x'), { code: 'HOLEPUNCH_ABORTED' }))
  w.connect(a, {})
  assert.equal(calls[2].relay, true, 'after a failed punch, through the relay')
  w.connect(b, {})
  assert.equal(calls[3].relay, false, 'another seeder is still direct')
  assert.deepEqual(w.relayStats, { direct: 3, relayed: 1, punchFailures: 1 })
  await r.save(fakeDb(), false)
  w.connect(a, {})
  assert.equal(calls[4].relay, false, 'switched off: never')
  dht.randomized = true
  await r.save(fakeDb(), true)
  w.connect(b, {})
  assert.equal(calls[5].relay, true, 'a randomized NAT relays from the start')
})
