// The join handshake, Protomux channel `pearoffice/join/1` (wire protocol
// proposal, section 5). The invite link never contains the encryption key. A
// member hands it over only after checking the invite.
//
//   joiner -> member   request  { inviteId, identity, name, proof }
//   member -> joiner   welcome  { groupKey, bootstrap, encryptionKey, name, role }
//                      or reject { reason }
//   joiner opens the base, then
//   joiner -> members  claim    { claim, device }      repeated until applied
//   writer             appends  inviteUse { claim, device }
//
// Members also use the channel to hand a writer something to append for
// them: `device` (a new device after a move) and `profile` (a viewer's signed
// name or picture change, proposals/2026-10-04-profiles-with-avatars.md).
// Older builds ignore message types they do not know.
//
// One channel type carries both roles: a device answers requests for sheets
// it holds and runs its own joins on the same channels.

const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')
const { topicForKey } = require('@peerloom/core/swarm')
const { defaultEncodeInvite } = require('@peerloom/core/engine')
const m = require('./membership')

const PROTOCOL = 'pearoffice/join/1'
const REQUEST_PURPOSE = 'pearoffice/join-request/v1'
const CLAIM_RESEND_MS = 3000
// Hyperswarm looks a topic up once and then waits minutes before looking
// again. A joiner that looked before any member had announced would sit idle,
// so look again on a short timer while the join is pending.
const LOOKUP_EVERY_MS = [3000, 5000, 10000, 15000]
// A join that has found nobody to let it in for this long stops by itself:
// invites last at most 7 days (sheetMethods.js).
const GIVE_UP_MS = 7 * 24 * 3600 * 1000
const hex = (buf) => b4a.toString(buf, 'hex')

function createJoinService ({ engine, emit, onProfile = async () => {}, kindOf = async () => 'sheet', log = () => {}, now = () => Date.now() }) {
  const muxes = new Set()
  const joins = new Map() // sheetId -> { link, welcome, channels:Set, timer, done }
  const recentlyAppended = new Map() // inviteId -> time

  async function view (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base) return null
    await base.ready()
    return base.view
  }

  async function get (sheetId, key) {
    const v = await view(sheetId)
    if (!v) return null
    const node = await v.get(key)
    return node ? node.value : null
  }

  // --- connections -----------------------------------------------------------

  function onConnection (conn) {
    const mux = Protomux.from(conn)
    muxes.add(mux)
    conn.on('close', () => muxes.delete(mux))
    for (const sheetId of engine.bases.keys()) listen(mux, sheetId)
    for (const [sheetId, j] of joins) if (!j.done) openChannel(mux, sheetId)
  }

  // Answer channels a peer opens for a sheet this device holds.
  function listen (mux, sheetId) {
    mux.pair({ protocol: PROTOCOL, id: b4a.from(sheetId) }, () => openChannel(mux, sheetId))
  }

  function addSheet (sheetId) {
    for (const mux of muxes) listen(mux, sheetId)
  }

  function openChannel (mux, sheetId) {
    const id = b4a.from(sheetId)
    if (mux.opened({ protocol: PROTOCOL, id })) return null
    const ch = mux.createChannel({
      protocol: PROTOCOL,
      id,
      onopen: () => {
        const j = joins.get(sheetId)
        log('join channel open ' + sheetId.slice(0, 6) + (j ? ' (joining)' : ''))
        if (!j || j.done) return
        j.channels.add(ch)
        if (j.claimMsg) ch.msg.send(j.claimMsg)
        else if (!j.welcome) ch.msg.send(requestFor(sheetId, j))
      },
      onclose: () => {
        const j = joins.get(sheetId)
        log('join channel closed ' + sheetId.slice(0, 6))
        if (j) j.channels.delete(ch)
      }
    })
    if (!ch) return null
    ch.msg = ch.addMessage({ encoding: c.json, onmessage: (msg) => onMessage(ch, sheetId, msg).catch((e) => log('join message failed: ' + e.message)) })
    ch.open()
    return ch
  }

  async function onMessage (ch, sheetId, msg) {
    if (!msg || typeof msg.t !== 'string') return
    if (msg.t === 'request') return answerRequest(ch, sheetId, msg)
    if (msg.t === 'claim') return takeClaim(ch, sheetId, msg)
    if (msg.t === 'device') return takeDevice(sheetId, msg)
    if (msg.t === 'profile') return onProfile(sheetId, msg.op)
    const j = joins.get(sheetId)
    if (!j || j.done) return
    log('join got ' + msg.t + (msg.reason ? ': ' + msg.reason : ''))
    if (msg.t === 'welcome' && !j.welcome) {
      j.welcome = msg
      await persist(sheetId, j)
      emit('join:progress', { sheetId, stage: 'welcomed' })
      await openBase(sheetId, j)
    } else if (msg.t === 'reject') {
      j.reason = String(msg.reason || '').slice(0, 200)
      emit('join:progress', { sheetId, stage: 'waiting', reason: j.reason })
    }
  }

  // --- member side ---------------------------------------------------------

  async function answerRequest (ch, sheetId, msg) {
    log('answer request ' + String(msg.inviteId).slice(0, 6))
    const reject = (reason) => { log('reject: ' + reason); ch.msg.send({ t: 'reject', reason }) }
    const invite = await get(sheetId, 'invite/' + msg.inviteId)
    if (!invite) return reject('This device has not seen that invite yet')
    if (await get(sheetId, 'invite-used/' + msg.inviteId)) return reject('This invite has already been used or was cancelled')
    if (now() > invite.expiresAt) return reject('This invite has expired')
    const p = msg.proof
    if (!p || p.purpose !== REQUEST_PURPOSE || p.sheetId !== sheetId || p.inviteId !== msg.inviteId || p.invitePub !== invite.invitePub || !verifyValueWithSigner(p, 'invitePub')) {
      return reject('This invite does not check out')
    }
    const mine = (await engine.localDb.get('groups:joined:' + sheetId))?.value
    if (!mine || !mine.encryptionKey) return reject('This device cannot share that sheet')
    log('welcome ' + String(msg.inviteId).slice(0, 8))
    const kind = await kindOf(sheetId).catch(() => 'sheet')
    ch.msg.send({ t: 'welcome', groupKey: mine.groupKey, bootstrap: mine.bootstrap, encryptionKey: mine.encryptionKey, name: mine.name || '', role: invite.role, kind })
  }

  async function takeClaim (ch, sheetId, msg) {
    const base = engine.bases.get(sheetId)
    if (!base || !base.writable) return
    const { claim, device } = msg
    if (!claim || !device || typeof claim.inviteId !== 'string') return
    const last = recentlyAppended.get(claim.inviteId)
    if (last && now() - last < 30000) return
    const invite = await get(sheetId, 'invite/' + claim.inviteId)
    if (!invite || invite.invitePub !== claim.invitePub) return
    if (await get(sheetId, 'invite-used/' + claim.inviteId)) return
    if (now() > invite.expiresAt) return
    if (!verifyValueWithSigner(claim, 'invitePub') || !verifyValueWithSigner(device, 'identity')) return
    const me = await get(sheetId, 'member/' + hex(engine.identity.publicKey))
    if (!me || (me.role !== 'owner' && me.role !== 'editor')) return
    recentlyAppended.set(claim.inviteId, now())
    log('inviteUse ' + claim.inviteId.slice(0, 8))
    await engine.append(sheetId, { type: 'inviteUse', claim, device })
  }

  // A member's new device (after a move) asks to be admitted.
  async function takeDevice (sheetId, msg) {
    const base = engine.bases.get(sheetId)
    if (!base || !base.writable) return
    const d = msg.device
    if (!d || d.purpose !== m.P.device || d.sheetId !== sheetId || !verifyValueWithSigner(d, 'identity')) return
    const key = 'device:' + d.writerKey
    const last = recentlyAppended.get(key)
    if (last && now() - last < 30000) return
    if (await get(sheetId, 'device/' + d.writerKey)) return
    if (!(await get(sheetId, 'member/' + d.identity))) return
    const me = await get(sheetId, 'member/' + hex(engine.identity.publicKey))
    if (!me || (me.role !== 'owner' && me.role !== 'editor')) return
    recentlyAppended.set(key, now())
    await engine.append(sheetId, m.admitOp({ device: d }))
  }

  // Send a message to every peer reachable for a sheet.
  function sendToMembers (sheetId, msg) {
    for (const mux of muxes) {
      const id = b4a.from(sheetId)
      let ch = null
      for (const c of mux) if (c.protocol === PROTOCOL && b4a.equals(c.id, id)) ch = c
      if (!ch) ch = openChannel(mux, sheetId)
      if (ch && ch.opened && ch.msg) ch.msg.send(msg)
    }
  }

  function sendDevice (sheetId, device) {
    sendToMembers(sheetId, { t: 'device', device })
  }

  // --- joiner side -----------------------------------------------------------

  function requestFor (sheetId, j) {
    const kp = m.inviteKeyPair(j.link.seed)
    const identity = hex(engine.identity.publicKey)
    const proof = signValue({ purpose: REQUEST_PURPOSE, sheetId, inviteId: j.link.inviteId, identity, invitePub: hex(kp.publicKey) }, kp.secretKey)
    return { t: 'request', inviteId: j.link.inviteId, identity, name: j.name, proof }
  }

  async function persist (sheetId, j) {
    await engine.localDb.put('joins:pending:' + sheetId, { link: j.raw, name: j.name, welcomed: !!j.welcome, startedAt: j.startedAt })
  }

  async function start (rawLink, { name = '' } = {}) {
    const link = m.parseInviteLink(rawLink)
    const sheetId = link.sheetId
    if (await engine.localDb.get('groups:joined:' + sheetId) && !(await engine.localDb.get('joins:pending:' + sheetId))) {
      throw new Error('You already have this sheet')
    }
    if (joins.has(sheetId)) return { sheetId }
    // Invited back after removing the sheet from this device: allow it.
    await engine.localDb.del('removed:' + sheetId)
    const j = { raw: rawLink, link, name: m.cleanName(name), welcome: null, channels: new Set(), timer: null, done: false, claimMsg: null, startedAt: now() }
    joins.set(sheetId, j)
    await persist(sheetId, j)
    lookFor(sheetId, j)
    for (const mux of muxes) openChannel(mux, sheetId)
    emit('join:progress', { sheetId, stage: 'looking' })
    return { sheetId }
  }

  // Resume joins that were in flight when the app last stopped.
  async function resume () {
    for await (const { key, value } of engine.localDb.createReadStream({ gt: 'joins:pending:', lt: 'joins:pending:~' })) {
      const sheetId = key.slice('joins:pending:'.length)
      if (joins.has(sheetId) || !value || !value.link) continue
      let link
      try { link = m.parseInviteLink(value.link) } catch { await engine.localDb.del(key); continue }
      const j = { raw: value.link, link, name: value.name || '', welcome: value.welcomed ? {} : null, channels: new Set(), timer: null, done: false, claimMsg: null, startedAt: value.startedAt || now() }
      if (!value.startedAt) await persist(sheetId, j)
      if (!j.welcome && now() - j.startedAt > GIVE_UP_MS) {
        await engine.localDb.del(key)
        log('gave up joining ' + sheetId.slice(0, 6))
        emit('join:gaveUp', { sheetId })
        continue
      }
      joins.set(sheetId, j)
      lookFor(sheetId, j)
      for (const mux of muxes) openChannel(mux, sheetId)
      if (j.welcome && engine.bases.get(sheetId)) startClaiming(sheetId, j)
    }
  }

  function lookFor (sheetId, j) {
    const discovery = engine.swarm.join(topicForKey(j.link.groupKey), { server: false, client: true })
    let n = 0
    const again = () => {
      if (j.done || j.claimMsg) return
      discovery.refresh({ server: false, client: true }).catch(() => {})
      // A member that had not set up its listener yet rejects our channel,
      // and nothing reopens it on that connection. Try again.
      if (!j.welcome) for (const mux of muxes) openChannel(mux, sheetId)
      j.lookup = setTimeout(again, LOOKUP_EVERY_MS[Math.min(n++, LOOKUP_EVERY_MS.length - 1)])
      if (j.lookup.unref) j.lookup.unref()
    }
    j.lookup = setTimeout(again, LOOKUP_EVERY_MS[n++])
    if (j.lookup.unref) j.lookup.unref()
  }

  async function openBase (sheetId, j) {
    if (!engine.bases.get(sheetId)) {
      const w = j.welcome
      const inviteKey = defaultEncodeInvite({ groupId: sheetId, groupKey: w.groupKey, encryptionKey: w.encryptionKey, bootstrap: w.bootstrap, name: w.name })
      await engine.joinGroup({ inviteKey })
    }
    addSheet(sheetId)
    startClaiming(sheetId, j)
  }

  function startClaiming (sheetId, j) {
    const base = engine.bases.get(sheetId)
    const { claim, device } = m.claimFor({ sheetId, inviteId: j.link.inviteId, seed: j.link.seed, identity: engine.identity, writerKey: hex(base.local.key), name: j.name })
    j.claimMsg = { t: 'claim', claim, device }
    const tick = async () => {
      if (j.done) return
      try {
        await base.update()
        if (await get(sheetId, 'member/' + hex(engine.identity.publicKey))) return finish(sheetId, j)
      } catch {}
      for (const ch of j.channels) ch.msg.send(j.claimMsg)
      for (const mux of muxes) openChannel(mux, sheetId)
    }
    j.timer = setInterval(tick, CLAIM_RESEND_MS)
    if (j.timer.unref) j.timer.unref()
    tick()
  }

  async function finish (sheetId, j) {
    if (j.done) return
    j.done = true
    clearInterval(j.timer)
    clearTimeout(j.lookup)
    for (const ch of j.channels) { try { ch.close() } catch {} }
    joins.delete(sheetId)
    await engine.localDb.del('joins:pending:' + sheetId)
    emit('sheet:joined', { sheetId })
  }

  function pending () {
    return [...joins.entries()].map(([sheetId, j]) => ({ sheetId, kind: (j.welcome && j.welcome.kind) || j.link.kind || 'sheet', stage: j.welcome ? 'claiming' : 'looking', role: j.link.role, reason: j.reason || undefined, startedAt: j.startedAt }))
  }

  // Stop a join. Returns whether keys had arrived, in which case the caller
  // also removes the half-opened sheet.
  async function cancel (sheetId) {
    const j = joins.get(sheetId)
    if (j) {
      j.done = true
      clearInterval(j.timer)
      clearTimeout(j.lookup)
      for (const ch of j.channels) { try { ch.close() } catch {} }
      joins.delete(sheetId)
      if (!engine.bases.get(sheetId)) {
        try { await engine.swarm.leave(topicForKey(j.link.groupKey)) } catch {}
      }
    }
    await engine.localDb.del('joins:pending:' + sheetId)
    log('stopped joining ' + sheetId.slice(0, 6))
    return { welcomed: !!(j && j.welcome) }
  }

  function close () {
    for (const j of joins.values()) { clearInterval(j.timer); clearTimeout(j.lookup) }
  }

  return { onConnection, addSheet, start, resume, pending, cancel, close, sendDevice, sendToMembers }
}

module.exports = { createJoinService, PROTOCOL }
