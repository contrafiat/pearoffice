// Your devices keep the same files (proposals/2026-10-07-own-devices-files.md).
//
// Every device of one person joins a topic only that person's devices can
// work out: a keyed BLAKE2b of the identity seed. On each connection a
// Protomux channel `pearoffice/own-devices/1` opens, its id a hash of the
// topic, so other people's devices never pair it.
//
//   hello  { t, identity, device, peer, at, sig }   once, when the channel opens
//   files  { t, files: [entry] }                     after both hellos, in parts
//   file   { t, file: entry }                        when this device creates,
//                                                    joins or follows a file
//
//   entry  { sheetId, groupKey, encryptionKey, bootstrap, name, kind, from }
//
// The hello is signed by the identity over both devices' swarm keys and the
// time. A side accepts the other's hello only if its own identity signed it
// for the connection's actual key within the last 10 minutes. Otherwise it
// closes the channel: nothing else is sent before that.
//
// A device opens each file it does not have the way a linked device does
// after its restart (linking.js resume), and moves.followDevice gets it
// admitted as the same person. Removing a file here stays local: a file with
// a `removed:<sheetId>` record is never added back. `from` is the file a moved
// copy came from, so a file removed here is not added back after its owner
// tidied it up either.

const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')
const { defaultEncodeInvite } = require('@peerloom/core/engine')

const PROTOCOL = 'pearoffice/own-devices/1'
const PURPOSE = 'pearoffice/own-devices/v1'
const TOPIC_NAMESPACE = 'pearoffice/own-devices/topic/1'
const CHANNEL_NAMESPACE = 'pearoffice/own-devices/channel/1'
const HELLO_MAX_AGE_MS = 10 * 60 * 1000
const MAX_FILES = 5000
const PART = 500 // entries per `files` message
const NOTIFY_AFTER_MS = 300
const KINDS = ['sheet', 'doc', 'slides']
const hex = (buf) => b4a.toString(buf, 'hex')

const ID = /^[A-Za-z0-9_-]{43}$/
const KEY = /^[0-9a-f]{64}$/

// The topic: only a holder of the identity seed can work it out.
function ownTopic (seed) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.from(TOPIC_NAMESPACE), seed)
  return out
}

// The channel id: derived from the topic, so the topic itself is never sent.
function channelId (topic) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.concat([b4a.from(CHANNEL_NAMESPACE), topic]))
  return out
}

// identityKeyPair: { publicKey, secretKey }; device: this device's swarm key;
// peer: the other device's swarm key (hex).
function makeHello (identityKeyPair, device, peer, at) {
  const body = signValue({ purpose: PURPOSE, identity: hex(identityKeyPair.publicKey), device, peer, at }, identityKeyPair.secretKey)
  return { t: 'hello', identity: body.identity, device, peer, at, sig: body.sig }
}

// True when `msg` is a hello from another device of `identity`: signed by
// it, sent by the device at the other end of this connection (`device`), to
// this device (`peer`), within 10 minutes of `now`.
function checkHello (msg, { identity, device, peer, now }) {
  if (!msg || typeof msg !== 'object') return false
  if (typeof msg.identity !== 'string' || typeof msg.device !== 'string' || typeof msg.peer !== 'string' || typeof msg.sig !== 'string' || typeof msg.at !== 'number') return false
  if (msg.identity !== identity || msg.device !== device || msg.peer !== peer) return false
  if (!(Math.abs(now - msg.at) <= HELLO_MAX_AGE_MS)) return false
  try {
    return verifyValueWithSigner({ purpose: PURPOSE, identity: msg.identity, device: msg.device, peer: msg.peer, at: msg.at, sig: msg.sig }, 'identity')
  } catch { return false }
}

// A received entry, checked field by field, or null.
function cleanEntry (e) {
  if (!e || typeof e !== 'object') return null
  if (typeof e.sheetId !== 'string' || !ID.test(e.sheetId)) return null
  for (const k of ['groupKey', 'encryptionKey', 'bootstrap']) if (typeof e[k] !== 'string' || !KEY.test(e[k])) return null
  const name = typeof e.name === 'string' ? e.name.replace(/[\u0000-\u001f]/g, '').slice(0, 200) : ''
  const out = { sheetId: e.sheetId, groupKey: e.groupKey, encryptionKey: e.encryptionKey, bootstrap: e.bootstrap, name }
  if (KINDS.includes(e.kind)) out.kind = e.kind
  if (typeof e.from === 'string' && ID.test(e.from)) out.from = e.from
  return out
}

// describe(sheetId): { title, kind } for a file whose content is loaded here,
// else null. getMoves: moves.js, to get this device admitted.
function createOwnDevices ({ engine, getJoin = () => null, getMoves = () => null, describe = () => null, emit, log = () => {}, now = () => Date.now() }) {
  const muxes = new Set()
  const channels = new Set()
  // For tests: hellos accepted and refused, entries looked at, files opened
  // and files kept away because they were removed here.
  const stats = { accepted: 0, refused: 0, seen: 0, opened: 0, skipped: 0 }
  let topic = null
  let id = null
  let closed = false
  let taking = Promise.resolve()
  const notifying = new Set()
  let notifyTimer = null

  const me = () => hex(engine.identity.publicKey)
  const myDevice = () => hex(engine.swarm.keyPair.publicKey)

  // Join the topic as client and server. `forced` is for tests: another
  // identity's topic, to show its devices refuse this one.
  function start (forced = null) {
    if (closed) return
    const next = forced || ownTopic(engine.identity.secretKey.subarray(0, 32))
    if (topic && b4a.equals(topic, next)) return
    if (topic) {
      for (const mux of muxes) mux.unpair({ protocol: PROTOCOL, id })
      engine.swarm.leave(topic).catch(() => {})
    }
    topic = next
    id = channelId(topic)
    engine.swarm.join(topic, { server: true, client: true })
    for (const conn of engine.swarm.connections) onConnection(conn)
  }

  function onConnection (conn) {
    if (closed) return
    const mux = Protomux.from(conn)
    if (!muxes.has(mux)) {
      muxes.add(mux)
      conn.on('close', () => muxes.delete(mux))
    }
    if (!id) return
    mux.pair({ protocol: PROTOCOL, id }, () => openChannel(mux))
    openChannel(mux)
  }

  function openChannel (mux) {
    if (closed || mux.opened({ protocol: PROTOCOL, id })) return
    const conn = mux.stream
    const ch = mux.createChannel({
      protocol: PROTOCOL,
      id,
      onopen: () => send(ch, makeHello(engine.identity, myDevice(), hex(conn.remotePublicKey), now())),
      onclose: () => channels.delete(ch)
    })
    if (!ch) return
    ch.conn = conn
    ch.msg = ch.addMessage({ encoding: c.json, onmessage: (msg) => onMessage(ch, msg).catch((e) => log('own devices: ' + e.message)) })
    channels.add(ch)
    ch.open()
  }

  function send (ch, msg) {
    try { ch.msg.send(msg) } catch {}
  }

  async function onMessage (ch, msg) {
    if (!msg || typeof msg.t !== 'string') return
    if (msg.t === 'hello') {
      if (ch.peer) return
      const remote = ch.conn && ch.conn.remotePublicKey ? hex(ch.conn.remotePublicKey) : ''
      if (!checkHello(msg, { identity: me(), device: remote, peer: myDevice(), now: now() })) {
        stats.refused++
        log('own devices: refused a hello from ' + remote.slice(0, 8))
        ch.close()
        return
      }
      ch.peer = remote
      stats.accepted++
      const files = await entries()
      for (let i = 0; i < files.length; i += PART) send(ch, { t: 'files', files: files.slice(i, i + PART) })
      return
    }
    if (!ch.peer) return
    if (msg.t === 'files' && Array.isArray(msg.files) && msg.files.length <= MAX_FILES) take(msg.files)
    else if (msg.t === 'file') take([msg.file])
  }

  // --- what this device has -----------------------------------------------------

  // The entry for one file, or null for a frozen copy, a join still under
  // way or a record without keys.
  async function entryOf (value, froms) {
    if (!value || !value.groupId || !value.encryptionKey) return null
    const sheetId = value.groupId
    if (await engine.localDb.get('moves:' + sheetId)) return null
    if (await engine.localDb.get('joins:pending:' + sheetId)) return null
    const d = describe(sheetId) || {}
    const out = { sheetId, groupKey: value.groupKey, encryptionKey: value.encryptionKey, bootstrap: value.bootstrap, name: d.title || value.name || '' }
    if (d.kind) out.kind = d.kind
    if (froms.has(sheetId)) out.from = froms.get(sheetId)
    return cleanEntry(out)
  }

  // new sheet id -> the old one it moved from, while the old copy is here.
  async function movedFrom () {
    const out = new Map()
    for await (const { key, value } of engine.localDb.createReadStream({ gt: 'moves:', lt: 'moves:~' })) {
      if (value && value.to) out.set(value.to, key.slice('moves:'.length))
    }
    return out
  }

  async function entries () {
    const froms = await movedFrom()
    const out = []
    for await (const { value } of engine.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
      const e = await entryOf(value, froms)
      if (e) out.push(e)
      if (out.length >= MAX_FILES) break
    }
    return out
  }

  // --- files from the other devices ----------------------------------------------

  // One batch at a time, so the same file is never opened twice at once.
  function take (list) {
    taking = taking.then(() => takeAll(list)).catch((e) => log('own devices: ' + e.message))
    return taking
  }

  async function takeAll (list) {
    for (const raw of list) {
      if (closed) return
      const e = cleanEntry(raw)
      if (!e || await known(e.sheetId)) continue
      if (e.from && await engine.localDb.get('removed:' + e.from)) {
        // Removed here before its owner moved it: the new copy stays away too.
        await engine.localDb.put('removed:' + e.sheetId, { reason: 'removed', at: now(), from: e.from })
        stats.skipped++
        continue
      }
      try {
        await open(e)
      } catch (err) { log('own devices: could not open ' + e.sheetId.slice(0, 8) + ': ' + err.message) }
    }
    stats.seen += list.length
  }

  // Has this device got the file, or a reason to stay out of it? It was
  // removed here, deleted by its owner or moved away, or a join of its own
  // is under way.
  async function known (sheetId) {
    if (engine.bases.get(sheetId)) return true
    for (const k of ['groups:joined:', 'removed:', 'deleted:', 'moves:', 'joins:pending:']) {
      if (await engine.localDb.get(k + sheetId)) return true
    }
    return false
  }

  async function open (e) {
    const inviteKey = defaultEncodeInvite({ groupId: e.sheetId, groupKey: e.groupKey, encryptionKey: e.encryptionKey, bootstrap: e.bootstrap, name: e.name })
    // A connection can come before the engine has finished starting.
    for (let i = 0; ; i++) {
      try {
        await engine.joinGroup({ inviteKey })
        break
      } catch (err) {
        if (closed || i >= 60 || !/not initialized/.test(err.message)) throw err
        await new Promise((resolve) => setTimeout(resolve, 1000))
      }
    }
    if (closed) return
    stats.opened++
    log('own devices: opened ' + e.sheetId.slice(0, 8))
    if (getJoin()) getJoin().addSheet(e.sheetId)
    if (getMoves()) getMoves().followDevice(e.sheetId)
    emit('sheet:joined', { sheetId: e.sheetId, fromOtherDevice: true, title: e.name })
  }

  // --- telling the other devices --------------------------------------------------

  // This device created, joined or followed a file: tell the other devices.
  function notify (sheetId) {
    if (closed || typeof sheetId !== 'string') return
    notifying.add(sheetId)
    if (notifyTimer) return
    notifyTimer = setTimeout(() => { notifyTimer = null; flush().catch((e) => log('own devices: ' + e.message)) }, NOTIFY_AFTER_MS)
    if (notifyTimer.unref) notifyTimer.unref()
  }

  async function flush () {
    const ids = [...notifying]
    notifying.clear()
    const open = [...channels].filter((ch) => ch.peer)
    if (!open.length) return
    const froms = await movedFrom()
    for (const sheetId of ids) {
      const e = await entryOf((await engine.localDb.get('groups:joined:' + sheetId))?.value, froms)
      if (e) for (const ch of open) send(ch, { t: 'file', file: e })
    }
  }

  function close () {
    closed = true
    clearTimeout(notifyTimer)
    for (const ch of [...channels]) { try { ch.close() } catch {} }
    if (id) for (const mux of muxes) { try { mux.unpair({ protocol: PROTOCOL, id }) } catch {} }
    if (topic) engine.swarm.leave(topic).catch(() => {})
  }

  return { start, onConnection, notify, close, entries, take, stats, get topic () { return topic } }
}

module.exports = { createOwnDevices, ownTopic, channelId, makeHello, checkHello, cleanEntry, PROTOCOL, PURPOSE }
