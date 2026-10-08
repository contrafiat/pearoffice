// Linking a person's devices (proposals/2026-10-03-device-linking.md).
//
//   A (has the identity)            B (new, no sheets)
//   start(): link + topic           join(link): topic, talk only to key `a`
//               <- hello { deviceKey, proof signed with the link secret }
//   welcome { root, name, sheets, seeders } ->
//                                   store identity, ask the shell to restart
//   after the restart B opens each sheet and asks to be admitted (moves.js).
//
// The recovery phrase is the identity's root as 12 words (src/shared/phrase.js);
// the root is `phrase:root` in localDb and the identity is derived from it.

const Protomux = require('protomux')
const c = require('compact-encoding')
const b4a = require('b4a')
const sodium = require('sodium-universal')
const { signValue, verifyValueWithSigner } = require('@peerloom/core/records')
const { identityFromRoot, rootToPhrase, phraseToRoot } = require('../shared/phrase')
const { defaultEncodeInvite } = require('@peerloom/core/engine')
const { inviteKeyPair, cleanName, checkAvatar } = require('./membership')

const PROTOCOL = 'pearoffice/link/1'
const NAMESPACE = 'pearoffice/link/v1'
const PURPOSE = 'pearoffice/link/v1'
const LINK_WINDOW_MS = 5 * 60 * 1000
const hex = (buf) => b4a.toString(buf, 'hex')

function b64url (buf) {
  return b4a.toString(buf, 'base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}
function fromB64url (s) {
  return b4a.from(String(s).replace(/-/g, '+').replace(/_/g, '/'), 'base64')
}

function linkTopic (rv) {
  const out = b4a.alloc(32)
  sodium.crypto_generichash(out, b4a.concat([b4a.from(NAMESPACE), rv]))
  return out
}

function parseLink (link) {
  const m = /^pearoffice:\/\/link\?(.+)$/.exec(String(link).trim())
  if (!m) throw new Error('That is not a PearOffice device link')
  const q = new URLSearchParams(m[1])
  if (q.get('v') !== '1') throw new Error('This link needs a newer version of PearOffice')
  const rv = fromB64url(q.get('rv') || '')
  const secret = fromB64url(q.get('k') || '')
  const a = q.get('a') || ''
  if (rv.length !== 32 || secret.length !== 32 || !/^[0-9a-f]{64}$/.test(a)) throw new Error('This device link is damaged')
  return { rv, secret, deviceA: b4a.from(a, 'hex') }
}

// HAS_FILES starts the error when the device already has files: the UI then
// offers to remove them from this device and try again with `replace`.
const HAS_FILES = 'This device already has files.'

// removeFiles: removes every file from this device (deleting.js removeLocal),
// for taking on another identity on a device that was already in use.
function createLinking ({ engine, removeFiles = async () => {}, log = () => {}, now = () => Date.now() }) {
  let active = null // A's open link: { rv, topic, pub, expiresAt, used, timer }
  let waiting = null // B's join while it looks for A: stops it early (cancel)

  async function hasSheets () {
    for await (const _ of engine.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~', limit: 1 })) return true
    return false
  }

  async function memberships () {
    const out = []
    for await (const { value } of engine.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
      if (!value || !value.encryptionKey) continue
      const moved = (await engine.localDb.get('moves:' + value.groupId))?.value
      if (moved) continue // a frozen copy; its replacement is listed itself
      out.push({ sheetId: value.groupId, groupKey: value.groupKey, encryptionKey: value.encryptionKey, bootstrap: value.bootstrap, name: value.name || '' })
    }
    return out
  }

  // --- A: hand the identity to a new device -------------------------------

  async function start () {
    close()
    const rv = b4a.alloc(32)
    const secret = b4a.alloc(32)
    sodium.randombytes_buf(rv)
    sodium.randombytes_buf(secret)
    const topic = linkTopic(rv)
    const mine = { rv, topic, pub: hex(inviteKeyPair(secret).publicKey), expiresAt: now() + LINK_WINDOW_MS, used: false }
    active = mine
    // Timers close only this link, never a newer one.
    active.timer = setTimeout(() => close(mine), LINK_WINDOW_MS)
    if (active.timer.unref) active.timer.unref()
    engine.swarm.join(topic, { server: true, client: false })
    for (const conn of engine.swarm.connections) listen(conn)
    const link = 'pearoffice://link?' + new URLSearchParams({ rv: b64url(rv), k: b64url(secret), a: hex(engine.swarm.keyPair.publicKey), v: '1' }).toString()
    return { link, expiresAt: active.expiresAt }
  }

  function listen (conn) {
    if (!active) return
    const rv = active.rv
    Protomux.from(conn).pair({ protocol: PROTOCOL, id: rv }, () => answer(conn, rv))
  }

  function answer (conn, rv) {
    const ch = Protomux.from(conn).createChannel({ protocol: PROTOCOL, id: rv })
    if (!ch) return
    const msg = ch.addMessage({
      encoding: c.json,
      onmessage: async (m) => {
        const no = (reason) => msg.send({ t: 'no', reason })
        if (!m || m.t !== 'hello') return
        if (!active || !b4a.equals(active.rv, rv)) return no('This link has been closed. Make a new one on your other device.')
        if (active.used) return no('This link has already been used.')
        if (now() > active.expiresAt) return no('This link has expired. Make a new one on your other device.')
        const p = m.proof
        if (!p || p.purpose !== PURPOSE || p.rv !== hex(rv) || p.pub !== active.pub || p.deviceKey !== hex(conn.remotePublicKey) || !verifyValueWithSigner(p, 'pub')) {
          return no('This link does not check out.')
        }
        active.used = true
        const root = await rootHere()
        if (!root) return no('This device has no recovery phrase to pass on. It was set up by an older test version of PearOffice.')
        const profile = (await engine.localDb.get('profile'))?.value
        const seeders = []
        for await (const { value } of engine.localDb.createReadStream({ gt: 'seeders:', lt: 'seeders:~' })) seeders.push(value.seederKey)
        log('linking a device ' + hex(conn.remotePublicKey).slice(0, 8))
        msg.send({ t: 'welcome', root: hex(root), name: profile ? profile.name : '', profile: profile || null, sheets: await memberships(), seeders })
        engine.emit('link:done', { deviceKey: hex(conn.remotePublicKey) })
        const used = active
        setTimeout(() => close(used), 2000)
      }
    })
    ch.open()
  }

  // Close the open link (or only `which`, if given and still open).
  function close (which) {
    if (!active || (which && which !== active)) return
    clearTimeout(active.timer)
    engine.swarm.leave(active.topic).catch(() => {})
    active = null
  }

  // --- B: take on the identity ---------------------------------------------

  // replace: the device's own files are removed first, but only once the
  // other device has answered, so a link that fails costs nothing.
  function join (link, { timeoutMs = 120000, replace = false } = {}) {
    const { rv, secret, deviceA } = parseLink(link)
    return (async () => {
      if (!replace && await hasSheets()) throw new Error(HAS_FILES + ' Linking replaces its identity, so its files must be removed from it first.')
      const welcome = await new Promise((resolve, reject) => {
        const swarm = engine.swarm
        const topic = linkTopic(rv)
        let done = false
        const channels = []
        const finish = (err, value) => {
          if (done) return
          done = true
          if (waiting === finish) waiting = null
          clearTimeout(timer)
          clearInterval(again)
          // Close our channels, so a later attempt on the same connection can
          // open a fresh one.
          for (const ch of channels) { try { ch.close() } catch {} }
          swarm.off('connection', onConnection)
          swarm.leave(topic).catch(() => {})
          if (err) reject(err); else resolve(value)
        }
        const onConnection = (conn) => {
          if (!conn.remotePublicKey || !b4a.equals(conn.remotePublicKey, deviceA)) return
          const kp = inviteKeyPair(secret)
          const proof = signValue({ purpose: PURPOSE, rv: hex(rv), pub: hex(kp.publicKey), deviceKey: hex(swarm.keyPair.publicKey) }, kp.secretKey)
          const ch = Protomux.from(conn).createChannel({ protocol: PROTOCOL, id: rv, onopen: () => msg.send({ t: 'hello', deviceKey: hex(swarm.keyPair.publicKey), proof }) })
          if (!ch) return
          channels.push(ch)
          const msg = ch.addMessage({
            encoding: c.json,
            onmessage: (m) => {
              if (m && m.t === 'welcome') finish(null, m)
              else if (m && m.t === 'no') finish(new Error(m.reason || 'The other device refused'))
            }
          })
          ch.open()
        }
        waiting = finish
        const timer = setTimeout(() => finish(new Error('Could not reach your other device. Open PearOffice on it, stay on the screen with the link and try again.')), timeoutMs)
        swarm.on('connection', onConnection)
        for (const conn of swarm.connections) onConnection(conn)
        const discovery = swarm.join(topic, { server: false, client: true })
        const again = setInterval(() => discovery.refresh({ server: false, client: true }).catch(() => {}), 4000)
      })
      if (replace) await removeFiles()
      await adopt(welcome)
      return { restart: true, sheets: welcome.sheets.length }
    })()
  }

  // Stop a join that is still looking for the other device. One that has
  // already heard back goes on to take the identity.
  function cancel () {
    if (waiting) waiting(new Error('Linking was cancelled'))
    return { ok: true }
  }

  // Store the identity and what comes with it; the sheets open after the
  // worklet restarts with the new identity.
  async function adopt (welcome) {
    if (typeof welcome.root !== 'string') throw new Error('The other device needs an update to link')
    const root = b4a.from(welcome.root, 'hex')
    if (root.length !== 16) throw new Error('The other device sent a damaged identity')
    await replaceIdentity(root)
    const profile = { name: cleanName(welcome.name), nameAt: 0, avatar: null, avatarAt: 0 }
    const p = welcome.profile
    if (p && typeof p === 'object') {
      if (typeof p.nameAt === 'number') profile.nameAt = p.nameAt
      if (p.avatar && checkAvatar(p.avatar)) {
        profile.avatar = { data: p.avatar.data, mime: p.avatar.mime, hash: p.avatar.hash }
        profile.avatarAt = typeof p.avatarAt === 'number' ? p.avatarAt : 0
      }
    }
    if (profile.name || profile.avatar) await engine.localDb.put('profile', profile)
    for (const key of welcome.seeders || []) {
      if (/^[0-9a-f]{64}$/.test(key)) await engine.localDb.put('seeders:' + key, { seederKey: key, pairedAt: Date.now() })
    }
    await engine.localDb.put('link:pending', { sheets: welcome.sheets || [] })
  }

  async function replaceIdentity (root) {
    const id = identityFromRoot(root)
    await engine.localDb.put('phrase:root', { root: hex(root) })
    await engine.localDb.put('identity', { publicKey: hex(id.publicKey), secretKey: hex(id.secretKey), createdAt: Date.now() })
  }

  // The root, if it is this identity's (an identity from before 12-word
  // phrases has none).
  async function rootHere () {
    const v = (await engine.localDb.get('phrase:root'))?.value
    if (!v || typeof v.root !== 'string') return null
    const root = b4a.from(v.root, 'hex')
    if (root.length !== 16 || !b4a.equals(identityFromRoot(root).publicKey, engine.identity.publicKey)) return null
    return root
  }

  // After a restart: open the sheets that came with a link. Admission into
  // each is then requested by moves.resume (any sheet without this device).
  async function resume () {
    const pending = (await engine.localDb.get('link:pending'))?.value
    if (!pending) return
    for (const s of pending.sheets) {
      if (engine.bases.get(s.sheetId)) continue
      try {
        await engine.joinGroup({ inviteKey: defaultEncodeInvite({ groupId: s.sheetId, groupKey: s.groupKey, encryptionKey: s.encryptionKey, bootstrap: s.bootstrap, name: s.name }) })
        // The UI loaded before this ran; tell it the sheet is here.
        engine.emit('sheet:joined', { sheetId: s.sheetId })
      } catch (e) { log('link: could not open ' + s.sheetId.slice(0, 8) + ': ' + e.message) }
    }
    await engine.localDb.del('link:pending')
  }

  // --- recovery phrase -------------------------------------------------------

  async function phrase () {
    const root = await rootHere()
    if (!root) throw new Error('This identity has no recovery phrase. It was set up by an older test version of PearOffice; start fresh to get one.')
    return rootToPhrase(root)
  }

  async function restore (words, { replace = false } = {}) {
    const root = phraseToRoot(words) // a bad phrase throws before anything is removed
    if (await hasSheets()) {
      if (!replace) throw new Error(HAS_FILES + ' Restoring replaces its identity, so its files must be removed from it first.')
      await removeFiles()
    }
    await replaceIdentity(root)
    return { restart: true }
  }

  return { start, join, cancel, listen, close, resume, phrase, restore }
}

module.exports = { createLinking, parseLink, linkTopic, HAS_FILES }
