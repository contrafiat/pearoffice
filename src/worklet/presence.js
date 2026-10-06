// Who has a sheet open, and which cell they are on: Protomux channel
// `pearsheet/presence/1` (proposals/2026-10-05-presence.md). Kept in memory
// only; nothing here is stored.
//
//   hello  { t, sheetId, identity, device, at, sig }   once, when the channel opens
//   state  { t, open, tab, row, col, editing }          on change, and every 20 s
//   bye    { t }                                        when the sheet is closed
//
// A channel exists only while both devices have the sheet open. Neither side
// sends a state until it has checked the other's hello: signed by a current
// member's identity, for this connection's device key, made recently. The
// seeder is not a member, so it never sees anything.

const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')

const PROTOCOL = 'pearsheet/presence/1'
const PURPOSE = 'pearsheet/presence/v1'
const HELLO_MAX_AGE_MS = 10 * 60 * 1000
const SEND_EVERY_MS = 250 // at most 4 states a second
const HEARTBEAT_MS = 20000
const SILENT_MS = 60000
const hex = (buf) => b4a.toString(buf, 'hex')

const num = (v) => (Number.isInteger(v) && v > 0 && v < 1e7 ? v : null)

function cleanState (s) {
  return {
    open: !!(s && s.open),
    tab: s && typeof s.tab === 'string' ? s.tab.slice(0, 64) : null,
    row: num(s && s.row),
    col: num(s && s.col),
    editing: !!(s && s.editing)
  }
}

function createPresence ({ engine, emit, log = () => {}, now = () => Date.now() }) {
  const muxes = new Set()
  const mine = new Map() // sheetId -> state, for the sheets open here
  const channels = new Map() // sheetId -> Set of channels
  let closed = false

  const myDevice = () => hex(engine.swarm.keyPair.publicKey)
  const me = () => hex(engine.identity.publicKey)

  function helloFor (sheetId) {
    const body = { purpose: PURPOSE, sheetId, identity: me(), device: myDevice(), at: now() }
    return { t: 'hello', sheetId, identity: body.identity, device: body.device, at: body.at, sig: signValue(body, engine.identity.secretKey).sig }
  }

  async function isMember (sheetId, identity) {
    const base = engine.bases.get(sheetId)
    if (!base) return false
    await base.ready()
    const node = await base.view.get('member/' + identity)
    return !!(node && node.value)
  }

  function chansOf (sheetId) {
    let set = channels.get(sheetId)
    if (!set) { set = new Set(); channels.set(sheetId, set) }
    return set
  }

  // The people present in a sheet: one entry per device we have checked
  // and heard from.
  function list (sheetId) {
    const out = []
    for (const ch of channels.get(sheetId) || []) {
      if (!ch.peer || !ch.state || !ch.state.open) continue
      out.push({ identity: ch.peer.identity, device: ch.peer.device, tab: ch.state.tab, row: ch.state.row, col: ch.state.col, editing: ch.state.editing })
    }
    return out
  }
  const changed = (sheetId) => emit('sheet:presence', { sheetId, people: list(sheetId) })

  function send (ch, msg) {
    try { ch.msg.send(msg) } catch {}
  }

  // While the sheet is open here, answer a peer that opens it (again).
  function listen (mux, sheetId) {
    mux.pair({ protocol: PROTOCOL, id: b4a.from(sheetId) }, () => openChannel(mux, sheetId))
    openChannel(mux, sheetId)
  }

  function openChannel (mux, sheetId) {
    const id = b4a.from(sheetId)
    if (mux.opened({ protocol: PROTOCOL, id })) return
    const conn = mux.stream
    const ch = mux.createChannel({
      protocol: PROTOCOL,
      id,
      onopen: () => send(ch, helloFor(sheetId)),
      onclose: () => {
        const set = channels.get(sheetId)
        if (set && set.delete(ch) && ch.peer) changed(sheetId)
      }
    })
    if (!ch) return
    ch.conn = conn
    ch.msg = ch.addMessage({ encoding: c.json, onmessage: (msg) => onMessage(ch, sheetId, msg).catch((e) => log('presence message failed: ' + e.message)) })
    chansOf(sheetId).add(ch)
    ch.open()
  }

  async function checkHello (ch, sheetId, msg) {
    if (typeof msg.identity !== 'string' || typeof msg.device !== 'string' || typeof msg.sig !== 'string' || typeof msg.at !== 'number') return false
    if (msg.sheetId !== sheetId) return false
    if (!ch.conn || !ch.conn.remotePublicKey || hex(ch.conn.remotePublicKey) !== msg.device) return false
    if (Math.abs(now() - msg.at) > HELLO_MAX_AGE_MS) return false
    const body = { purpose: PURPOSE, sheetId, identity: msg.identity, device: msg.device, at: msg.at, sig: msg.sig }
    let ok = false
    try { ok = verifyValueWithSigner(body, 'identity') } catch {}
    if (!ok) return false
    return isMember(sheetId, msg.identity)
  }

  async function onMessage (ch, sheetId, msg) {
    if (!msg || typeof msg.t !== 'string') return
    if (msg.t === 'hello') {
      if (ch.peer) return
      if (!(await checkHello(ch, sheetId, msg))) { log('presence: refused a hello for ' + sheetId.slice(0, 6)); ch.close(); return }
      ch.peer = { identity: msg.identity, device: msg.device }
      ch.heard = now()
      const s = mine.get(sheetId)
      if (s) send(ch, { t: 'state', ...s })
      return
    }
    if (!ch.peer) return
    ch.heard = now()
    if (msg.t === 'state') {
      ch.state = cleanState(msg)
      changed(sheetId)
    } else if (msg.t === 'bye') {
      ch.state = null
      changed(sheetId)
    }
  }

  // --- this device ------------------------------------------------------------

  const pending = new Map() // sheetId -> timer
  const lastSent = new Map() // sheetId -> time

  function broadcast (sheetId) {
    pending.delete(sheetId)
    const s = mine.get(sheetId)
    if (!s) return
    lastSent.set(sheetId, now())
    for (const ch of channels.get(sheetId) || []) if (ch.peer) send(ch, { t: 'state', ...s })
  }

  // The UI's state for a sheet: open (on screen) or not, and where.
  function set (sheetId, state) {
    if (closed || typeof sheetId !== 'string') return
    const s = cleanState(state)
    if (!s.open) {
      if (!mine.has(sheetId)) return
      mine.delete(sheetId)
      clearTimeout(pending.get(sheetId))
      pending.delete(sheetId)
      for (const ch of channels.get(sheetId) || []) {
        if (ch.peer) send(ch, { t: 'bye' })
        ch.close()
      }
      channels.delete(sheetId)
      for (const mux of muxes) mux.unpair({ protocol: PROTOCOL, id: b4a.from(sheetId) })
      changed(sheetId)
      return
    }
    const was = mine.get(sheetId)
    mine.set(sheetId, s)
    if (!was) {
      for (const mux of muxes) listen(mux, sheetId)
      return
    }
    if (pending.has(sheetId)) return
    const wait = Math.max(0, (lastSent.get(sheetId) || 0) + SEND_EVERY_MS - now())
    pending.set(sheetId, setTimeout(() => broadcast(sheetId), wait))
  }

  function onConnection (conn) {
    if (closed) return
    const mux = Protomux.from(conn)
    muxes.add(mux)
    conn.on('close', () => muxes.delete(mux))
    for (const sheetId of mine.keys()) listen(mux, sheetId)
  }

  // Someone may have been removed: check everyone present again.
  async function recheck (sheetId) {
    for (const ch of [...(channels.get(sheetId) || [])]) {
      if (ch.peer && !(await isMember(sheetId, ch.peer.identity))) ch.close()
    }
  }

  const timer = setInterval(() => {
    for (const sheetId of mine.keys()) broadcast(sheetId)
    for (const [sheetId, set] of channels) {
      for (const ch of set) if (ch.peer && ch.state && now() - ch.heard > SILENT_MS) { ch.state = null; changed(sheetId) }
    }
  }, HEARTBEAT_MS)
  if (timer.unref) timer.unref()

  function close () {
    closed = true
    clearInterval(timer)
    for (const t of pending.values()) clearTimeout(t)
    for (const sheetId of [...mine.keys()]) set(sheetId, { open: false })
  }

  return { onConnection, set, list, recheck, close, _checkHello: checkHello }
}

module.exports = { createPresence, PROTOCOL }
