/* global Bare */
// Your linked devices and their names (proposals/2026-10-07-device-names.md).
//
// A device is known across files by its swarm key (`deviceKey`); inside a
// file it is a writer key (`device/<writerKey>`), different in every file.
// This device's copy of the names lives in localDb `devices:<deviceKey>`:
//   { name, at, kind }
// `at` is when the name was chosen, 0 for the name a device gives itself from
// its platform, so any chosen name wins. `kind` is 'phone' or 'computer'.
//
// For each file, `reconcile` works like profiles.js:
// - a device record there has a newer name: copy it into localDb;
// - localDb has a newer name for a device with a record there (this one
//   always has): append a signed `deviceName` op, or on a viewer's device
//   hand it to a connected writer to append.
// A device not yet in a file gets its name there once it is admitted: its
// own reconcile appends it.
//
// Last seen: presence.js reports devices it hears from; the time is kept in
// localDb `deviceSeen:<deviceKey>`.

const b4a = require('b4a')
const { verifyValueWithSigner } = require('@peerloom/core/records')
const m = require('./membership')

const RESEND_MS = 5000
const hex = (buf) => b4a.toString(buf, 'hex')

const PLATFORMS = {
  linux: { name: 'Linux computer', kind: 'computer' },
  win32: { name: 'Windows computer', kind: 'computer' },
  darwin: { name: 'Mac', kind: 'computer' },
  android: { name: 'Android phone', kind: 'phone' },
  ios: { name: 'iPhone', kind: 'phone' }
}

function hostPlatform () {
  if (typeof Bare !== 'undefined' && Bare.platform) return Bare.platform
  if (typeof process !== 'undefined' && process.platform) return process.platform
  return ''
}

function defaultName (platform = hostPlatform()) {
  return PLATFORMS[platform] || { name: 'Computer', kind: 'computer' }
}

function createDevices ({ engine, getJoin, getPresence = () => null, emit = () => {}, log = () => {}, platform }) {
  const busy = new Map() // sheetId -> Promise, one reconcile at a time per sheet
  const again = new Set()
  const relaying = new Map() // sheetId -> [op] waiting for a writer
  const recentlyAppended = new Map() // sig -> time
  let timer = null

  const myKey = () => hex(engine.swarm.keyPair.publicKey)
  const me = () => hex(engine.identity.publicKey)

  async function localOf (deviceKey) {
    const v = (await engine.localDb.get('devices:' + deviceKey))?.value
    return v && typeof v.name === 'string' ? { name: v.name, at: typeof v.at === 'number' ? v.at : 0, kind: v.kind || '' } : null
  }

  // This device's entry, named from the platform the first time.
  async function self () {
    const key = myKey()
    const have = await localOf(key)
    if (have) return have
    const d = defaultName(platform)
    const row = { name: d.name, at: 0, kind: d.kind }
    await engine.localDb.put('devices:' + key, row)
    return row
  }

  async function view (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base) return null
    await base.ready()
    return base.view
  }

  async function recordsOf (v, identity) {
    const out = []
    for await (const { value } of v.createReadStream({ gt: 'device/', lt: 'device/~' })) {
      if (value && value.identity === identity) out.push(value)
    }
    return out
  }

  // The live files on this device where this person is a member.
  async function myFiles () {
    const out = []
    for (const sheetId of engine.bases.keys()) {
      const v = await view(sheetId).catch(() => null)
      if (!v || (await v.get('moved')) || (await v.get('deleted'))) continue
      if (!(await v.get('member/' + me()))) continue
      out.push({ sheetId, view: v })
    }
    return out
  }

  // --- the list ---------------------------------------------------------------

  async function list () {
    const mine = myKey()
    await self()
    const found = new Map() // deviceKey -> { files, name, at, kind }
    found.set(mine, { files: 0, name: '', at: -1, kind: '' })
    for (const { sheetId, view: v } of await myFiles()) {
      const base = engine.bases.get(sheetId)
      const myWriter = base && base.local ? hex(base.local.key) : null
      for (const rec of await recordsOf(v, me())) {
        const key = rec.writerKey === myWriter ? mine : rec.deviceKey
        if (!key || !/^[0-9a-f]{64}$/.test(key)) continue
        const d = found.get(key) || { files: 0, name: '', at: -1, kind: '' }
        d.files++
        if (rec.name && typeof rec.nameAt === 'number' && rec.nameAt > d.at) { d.name = rec.name; d.at = rec.nameAt; d.kind = rec.kind || d.kind }
        found.set(key, d)
      }
    }
    const presence = getPresence()
    const online = presence ? presence.online() : new Set()
    const out = []
    for (const [deviceKey, d] of found) {
      const local = await localOf(deviceKey)
      const best = local && local.at >= d.at ? local : d
      const seen = (await engine.localDb.get('deviceSeen:' + deviceKey))?.value
      out.push({
        deviceKey,
        name: best.name || 'Unnamed device',
        kind: best.kind || d.kind || 'computer',
        thisDevice: deviceKey === mine,
        online: deviceKey !== mine && online.has(deviceKey),
        lastSeen: deviceKey === mine ? null : (seen && typeof seen.at === 'number' ? seen.at : null),
        files: d.files
      })
    }
    // This device first, then by name.
    out.sort((a, b) => (b.thisDevice - a.thisDevice) || a.name.localeCompare(b.name))
    return out
  }

  async function rename (deviceKey, name) {
    if (!/^[0-9a-f]{64}$/.test(deviceKey || '')) throw new Error('Unknown device')
    const clean = m.checkDeviceName(name)
    if (!clean) throw new Error('Use 1 to 40 characters.')
    let kind = ''
    if (deviceKey === myKey()) kind = (await self()).kind
    else {
      const known = (await list()).find((d) => d.deviceKey === deviceKey)
      if (!known) throw new Error('Unknown device')
      kind = known.kind
    }
    const was = await localOf(deviceKey)
    if (was && was.name === clean) return
    await engine.localDb.put('devices:' + deviceKey, { name: clean, at: Math.max(Date.now(), was ? was.at + 1 : 0), kind })
    emit('devices:changed', {})
    await reconcileAll()
  }

  // --- keeping files in step -------------------------------------------------

  function reconcileAll () {
    return Promise.all([...engine.bases.keys()].map((id) => reconcile(id).catch((e) => log('device names reconcile failed: ' + e.message))))
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
    const member = (await v.get('member/' + me()))?.value
    if (!member) return
    const base = engine.bases.get(sheetId)
    const mine = myKey()
    const myWriter = base.local ? hex(base.local.key) : null
    await self()
    const records = await recordsOf(v, me())

    // Copy in names chosen on another device.
    let changed = false
    for (const rec of records) {
      if (!rec.deviceKey || !rec.name || typeof rec.nameAt !== 'number') continue
      if (rec.writerKey === myWriter && rec.deviceKey !== mine) continue
      const local = await localOf(rec.deviceKey)
      if (local && local.at >= rec.nameAt) continue
      await engine.localDb.put('devices:' + rec.deviceKey, { name: rec.name, at: rec.nameAt, kind: rec.kind || (local ? local.kind : '') })
      changed = true
    }
    if (changed) emit('devices:changed', {})

    // Push names this device knows better.
    const ops = []
    for (const rec of records) {
      const deviceKey = rec.writerKey === myWriter ? mine : rec.deviceKey
      if (!deviceKey) continue
      const local = await localOf(deviceKey)
      if (!local) continue
      const has = typeof rec.nameAt === 'number' ? rec.nameAt : -1
      const behind = rec.deviceKey !== deviceKey || rec.name !== local.name || (rec.kind || '') !== (local.kind || '')
      if (!behind || local.at <= has) continue
      ops.push(m.deviceNameOp({ sheetId, identity: engine.identity, deviceKey, writerKey: rec.writerKey, name: local.name, at: local.at, kind: local.kind }))
    }
    if (!ops.length) { relaying.delete(sheetId); return }

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

  function startTimer () {
    if (timer) return
    timer = setInterval(() => {
      if (!relaying.size) { clearInterval(timer); timer = null; return }
      for (const sheetId of [...relaying.keys()]) reconcile(sheetId).catch(() => {})
    }, RESEND_MS)
    if (timer.unref) timer.unref()
  }

  // Writer side: a viewer's signed device name, relayed by their device.
  // `apply` makes the real checks; these keep junk out of the log.
  async function take (sheetId, op) {
    const base = engine.bases.get(sheetId)
    if (!base || !base.writable || !op || op.type !== 'deviceName') return
    const r = op.deviceName
    if (!r || typeof r !== 'object' || r.purpose !== m.P.deviceName || r.sheetId !== sheetId || typeof r.sig !== 'string') return
    if (!m.checkDeviceName(r.name) || typeof r.writerKey !== 'string' || typeof r.at !== 'number') return
    if (!verifyValueWithSigner(r, 'identity')) return
    const last = recentlyAppended.get(r.sig)
    if (last && Date.now() - last < 30000) return
    const v = await view(sheetId)
    const mine = (await v.get('member/' + me()))?.value
    if (!mine || (mine.role !== 'owner' && mine.role !== 'editor')) return
    const dev = (await v.get('device/' + r.writerKey))?.value
    if (!dev || dev.identity !== r.identity) return
    if (typeof dev.nameAt === 'number' && r.at <= dev.nameAt) return
    recentlyAppended.set(r.sig, Date.now())
    await engine.append(sheetId, op)
  }

  // From presence.js: one of this person's devices was heard from.
  function seen (identity, deviceKey) {
    if (!engine.identity || identity !== me()) return
    engine.localDb.put('deviceSeen:' + deviceKey, { at: Date.now() }).then(() => emit('devices:changed', {}), () => {})
  }

  function close () { if (timer) clearInterval(timer); timer = null }

  return { self, list, rename, reconcile, reconcileAll, take, seen, close }
}

module.exports = { createDevices, defaultName }
