// Your name and picture, kept in step with every sheet you are in
// (proposals/2026-10-04-profiles-with-avatars.md).
//
// This device's copy lives in localDb `profile`:
//   { name, nameAt, avatar: { data, mime, hash } | null, avatarAt }
// `nameAt` and `avatarAt` are when the person last changed them, 0 if never.
//
// For each sheet, `reconcile` compares it with this person's member record:
// - the record is newer (another of their linked devices changed it): copy it
//   into localDb;
// - the local copy is newer: append a signed `name` or `avatar` op, or, on a
//   viewer's device, hand it to a connected writer to append.

const b4a = require('b4a')
const { verifyValueWithSigner } = require('@peerloom/core/records')
const m = require('./membership')

const RESEND_MS = 5000
const hex = (buf) => b4a.toString(buf, 'hex')

function createProfiles ({ engine, getJoin, emit = () => {}, log = () => {} }) {
  const busy = new Map() // sheetId -> Promise, one reconcile at a time per sheet
  const again = new Set()
  const relaying = new Map() // sheetId -> [op] waiting for a writer
  const recentlyAppended = new Map() // sig -> time
  let timer = null

  async function local () {
    const p = (await engine.localDb.get('profile'))?.value || {}
    return {
      name: typeof p.name === 'string' ? p.name : '',
      nameAt: typeof p.nameAt === 'number' ? p.nameAt : 0,
      avatar: p.avatar && p.avatar.data ? p.avatar : null,
      avatarAt: typeof p.avatarAt === 'number' ? p.avatarAt : 0
    }
  }

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

  async function setName (name) {
    const p = await local()
    const clean = m.cleanName(name)
    if (clean === p.name) return
    await engine.localDb.put('profile', { ...p, name: clean, nameAt: Date.now() })
    await reconcileAll()
  }

  async function setAvatar ({ data, mime }) {
    const p = await local()
    let avatar = null
    if (data) {
      const hash = m.avatarHash(b4a.from(data, 'base64'))
      avatar = { data, mime, hash }
      if (!m.checkAvatar(avatar)) throw new Error('That picture could not be used. Try a smaller JPEG or PNG.')
      if (p.avatar && p.avatar.hash === hash) return
    } else if (!p.avatar) return
    await engine.localDb.put('profile', { ...p, avatar, avatarAt: Date.now() })
    await reconcileAll()
  }

  function reconcileAll () {
    return Promise.all([...engine.bases.keys()].map((id) => reconcile(id).catch((e) => log('profile reconcile failed: ' + e.message))))
  }

  function reconcile (sheetId) {
    if (busy.has(sheetId)) { again.add(sheetId); return busy.get(sheetId) }
    const run = (async () => {
      try { await reconcileOnce(sheetId) } finally {
        busy.delete(sheetId)
        if (again.delete(sheetId)) reconcile(sheetId).catch(() => {})
      }
    })()
    busy.set(sheetId, run)
    return run
  }

  async function reconcileOnce (sheetId) {
    const v = await view(sheetId)
    if (!v || (await v.get('moved')) || (await v.get('deleted'))) { relaying.delete(sheetId); return }
    const me = hex(engine.identity.publicKey)
    const member = (await v.get('member/' + me))?.value
    if (!member) return
    let p = await local()
    const recordName = member.name || ''
    const recordAvatarHash = member.avatarHash || null

    // Copy in what another of this person's devices changed. A device that
    // has never had a name or picture takes the record's (a restored or newly
    // linked device).
    const adopt = {}
    if (recordName !== p.name && ((member.nameAt || 0) > p.nameAt || (!p.name && !p.nameAt))) {
      adopt.name = recordName
      adopt.nameAt = member.nameAt || 0
    }
    if (recordAvatarHash !== (p.avatar ? p.avatar.hash : null) && ((member.avatarAt || 0) > p.avatarAt || (!p.avatar && !p.avatarAt))) {
      const pic = recordAvatarHash ? (await v.get('avatar/' + me))?.value : null
      if (!recordAvatarHash || pic) {
        adopt.avatar = pic ? { data: pic.data, mime: pic.mime, hash: pic.hash } : null
        adopt.avatarAt = member.avatarAt || 0
      }
    }
    if (Object.keys(adopt).length) {
      p = { ...p, ...adopt }
      await engine.localDb.put('profile', p)
      emit('profile:changed', {})
    }

    // Push what this device changed.
    const ops = []
    if (p.name !== recordName && p.nameAt > (member.nameAt || 0)) {
      ops.push(m.nameOp({ sheetId, identity: engine.identity, name: p.name, n: (member.n || 0) + 1, at: p.nameAt }))
    }
    if ((p.avatar ? p.avatar.hash : null) !== recordAvatarHash && p.avatarAt > (member.avatarAt || 0)) {
      ops.push(m.avatarOp({ sheetId, identity: engine.identity, ...(p.avatar || {}), n: (member.avatarN || 0) + 1, at: p.avatarAt }))
    }
    if (!ops.length) { relaying.delete(sheetId); return }

    const base = engine.bases.get(sheetId)
    if (base.writable && (member.role === 'owner' || member.role === 'editor')) {
      relaying.delete(sheetId)
      for (const op of ops) await engine.append(sheetId, op)
      return
    }
    relaying.set(sheetId, ops)
    send(sheetId, ops)
    startTimer()
  }

  function send (sheetId, ops) {
    const join = getJoin()
    if (!join) return
    for (const op of ops) join.sendToMembers(sheetId, { t: 'profile', op })
  }

  // While a viewer's change waits for a writer, look again now and then:
  // reconcile drops it once the member record shows it, and resends it
  // otherwise (a writer may have connected since).
  function startTimer () {
    if (timer) return
    timer = setInterval(() => {
      if (!relaying.size) { clearInterval(timer); timer = null; return }
      for (const sheetId of [...relaying.keys()]) reconcile(sheetId).catch(() => {})
    }, RESEND_MS)
    if (timer.unref) timer.unref()
  }

  // Writer side: a member's signed name or picture change, relayed by their
  // device. `apply` makes the real checks; these keep junk out of the log.
  async function take (sheetId, op) {
    const base = engine.bases.get(sheetId)
    if (!base || !base.writable || !op || typeof op !== 'object') return
    const r = op.type === 'name' ? op.name : op.type === 'avatar' ? op.avatar : null
    const purpose = op.type === 'name' ? m.P.name : m.P.avatar
    if (!r || r.purpose !== purpose || r.sheetId !== sheetId || typeof r.sig !== 'string') return
    if (!verifyValueWithSigner(r, 'identity')) return
    const last = recentlyAppended.get(r.sig)
    if (last && Date.now() - last < 30000) return
    const me = await get(sheetId, 'member/' + hex(engine.identity.publicKey))
    if (!me || (me.role !== 'owner' && me.role !== 'editor')) return
    const member = await get(sheetId, 'member/' + r.identity)
    if (!member) return
    const n = op.type === 'name' ? member.n || 0 : member.avatarN || 0
    if (r.n !== n + 1) return
    if (op.type === 'avatar' && r.data && !m.checkAvatar(r)) return
    recentlyAppended.set(r.sig, Date.now())
    await engine.append(sheetId, op)
  }

  // A picture for the UI: by identity, from the sheet's view.
  async function avatarOf (sheetId, identity) {
    return (await get(sheetId, 'avatar/' + identity)) || null
  }

  function close () { if (timer) clearInterval(timer); timer = null }

  return { local, setName, setAvatar, reconcile, reconcileAll, take, avatarOf, close }
}

module.exports = { createProfiles }
