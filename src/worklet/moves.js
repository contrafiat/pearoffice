// Removing someone by moving the sheet to a fresh key (wire protocol proposal,
// section 7, with a new sheet id; see the proposal's changes after approval).
//
// Owner:   build a new sheet with new keys, carry the remaining members and the
//          current content into it, then append `move` to the old sheet with
//          the new keys sealed to each remaining person. The old sheet freezes.
// Others:  on seeing `move`, open their sealed entry, join the new sheet and
//          get their device admitted. No entry means they were removed.
//
// Local records:
//   moves:<oldSheetId>  { to: newSheetId | null, removed: bool, at }

const b4a = require('b4a')
const { defaultEncodeInvite } = require('@peerloom/core/engine')
const model = require('../shared/sheetModel')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const DEVICE_RESEND_MS = 3000

function createMoves ({ engine, sheets, getJoin, getDeleting = () => null, emit, log = () => {} }) {
  const following = new Map() // newSheetId -> { timer, device }

  async function viewGet (sheetId, key) {
    const base = engine.bases.get(sheetId)
    if (!base) return null
    await base.ready()
    const node = await base.view.get(key)
    return node ? node.value : null
  }

  async function membersOf (sheetId) {
    const base = engine.bases.get(sheetId)
    const out = []
    for await (const { value } of base.view.createReadStream({ gt: 'member/', lt: 'member/~' })) out.push(value)
    return out
  }

  async function seedersOf (sheetId) {
    const base = engine.bases.get(sheetId)
    const out = []
    for await (const { value } of base.view.createReadStream({ gt: 'seeder/', lt: 'seeder/~' })) out.push(value.seederKey)
    return out
  }

  // --- owner side --------------------------------------------------------------

  async function removeMember (oldId, identity) {
    const me = hex(engine.identity.publicKey)
    const sheet = await viewGet(oldId, 'sheet')
    if (!sheet || sheet.owner !== me) throw new Error('Only the owner can remove people')
    if (identity === me) throw new Error('The owner cannot remove themselves')
    if (await viewGet(oldId, 'moved')) throw new Error('This sheet has already moved')
    const members = await membersOf(oldId)
    if (!members.some((x) => x.identity === identity)) throw new Error('Not a member of this sheet')
    const remaining = members.filter((x) => x.identity !== identity)

    const old = await sheets.load(oldId)
    const title = model.title(old.guarded.doc)
    const state = model.encodeState(old.guarded.doc)

    // 1. The new sheet, founded by this device.
    const created = await engine.createGroup({ name: title })
    const newId = created.groupId
    const base = engine.bases.get(newId)
    const entry = sheets.entryFor(newId)
    entry.loading = Promise.resolve()
    const ownerRec = remaining.find((x) => x.identity === me)
    for (const op of m.foundingOps({ sheetId: newId, identity: engine.identity, writerKey: hex(base.local.key), name: ownerRec ? ownerRec.name : '' })) {
      await engine.append(newId, op)
    }
    // 2. Everyone else who stays, with their role and name.
    for (const x of remaining) {
      if (x.identity === me) continue
      await engine.append(newId, m.memberOp({ sheetId: newId, owner: engine.identity, identity: x.identity, role: x.role, name: x.name }))
    }
    // 3. The current content, then the seeders, re-signed by the owner.
    model.applyUpdate(entry.guarded.doc, state)
    sheets.noteLocal(newId, state)
    await engine.append(newId, { type: 'y', data: b4a.toString(state, 'base64') })
    for (const seederKey of await seedersOf(oldId)) {
      await engine.append(newId, m.seederOp({ sheetId: newId, identity: engine.identity, seederKey }))
    }
    if (getJoin()) getJoin().addSheet(newId)
    await sheets.attach(newId)

    // 4. Freeze the old sheet and hand each remaining person the new keys.
    const target = { sheetId: newId, groupKey: created.groupKey, encryptionKey: created.encryptionKey, bootstrap: created.bootstrap, name: title }
    await engine.append(oldId, m.moveOp({ sheetId: oldId, owner: engine.identity, target, recipients: remaining.map((x) => x.identity) }))
    await engine.localDb.put('moves:' + oldId, { to: newId, removed: false, at: Date.now() })
    emit('sheet:moved', { from: oldId, to: newId })
    log('moved ' + oldId.slice(0, 8) + ' to ' + newId.slice(0, 8))
    if (getDeleting()) getDeleting().afterMove(oldId).catch(() => {})
    return { sheetId: newId }
  }

  // --- everyone else -------------------------------------------------------------

  // Called after apply records `moved` in a sheet, and on start for sheets
  // that moved while this device was off.
  async function onMoved (oldId) {
    const done = await engine.localDb.get('moves:' + oldId)
    if (done && (done.value.removed || engine.bases.get(done.value.to))) {
      if (done.value.to) followDevice(done.value.to)
      return
    }
    const moved = await viewGet(oldId, 'moved')
    if (!moved) return
    const me = hex(engine.identity.publicKey)
    const sealed = moved.sealed && moved.sealed[me]
    const target = sealed ? m.unseal(sealed, engine.identity) : null
    if (!target) {
      await engine.localDb.put('moves:' + oldId, { to: null, removed: true, at: Date.now() })
      emit('sheet:removed', { sheetId: oldId })
      log('removed from ' + oldId.slice(0, 8))
      return
    }
    if (!engine.bases.get(target.sheetId)) {
      await engine.joinGroup({ inviteKey: defaultEncodeInvite({ groupId: target.sheetId, groupKey: target.groupKey, encryptionKey: target.encryptionKey, bootstrap: target.bootstrap, name: target.name }) })
    }
    await engine.localDb.put('moves:' + oldId, { to: target.sheetId, removed: false, at: Date.now() })
    if (getJoin()) getJoin().addSheet(target.sheetId)
    emit('sheet:moved', { from: oldId, to: target.sheetId })
    followDevice(target.sheetId)
    if (getDeleting()) getDeleting().afterMove(oldId).catch(() => {})
  }

  // Get this device admitted in the new sheet: send its proof on the join
  // channel until a writer has appended `admit` for it.
  function followDevice (sheetId) {
    if (following.has(sheetId)) return
    const base = engine.bases.get(sheetId)
    if (!base) return
    const proof = m.deviceProof({ sheetId, identity: engine.identity, writerKey: hex(base.local.key) })
    const f = { timer: null }
    following.set(sheetId, f)
    const tick = async () => {
      try {
        await base.update()
        const dev = (await base.view.get('device/' + hex(base.local.key)))?.value
        if (dev) { clearInterval(f.timer); return }
        if (getJoin()) getJoin().sendDevice(sheetId, proof)
      } catch {}
    }
    f.timer = setInterval(tick, DEVICE_RESEND_MS)
    if (f.timer.unref) f.timer.unref()
    tick()
  }

  // On start: follow sheets that moved while this device was off, and ask to
  // be admitted wherever this identity is a member but this device is not yet
  // known (after a key move, or on a newly linked device).
  async function resume () {
    const me = hex(engine.identity.publicKey)
    for (const [sheetId, base] of engine.bases) {
      try {
        if (await viewGet(sheetId, 'moved')) { await onMoved(sheetId); continue }
        await base.update()
        const member = await viewGet(sheetId, 'member/' + me)
        const known = await viewGet(sheetId, 'device/' + hex(base.local.key))
        if (member && !known) followDevice(sheetId)
      } catch (e) { log('resume failed for ' + sheetId.slice(0, 8) + ': ' + e.message) }
    }
  }

  async function status (sheetId) {
    const rec = await engine.localDb.get('moves:' + sheetId)
    return rec ? rec.value : null
  }

  function close () {
    for (const f of following.values()) clearInterval(f.timer)
  }

  return { removeMember, onMoved, resume, followDevice, status, close }
}

module.exports = { createMoves }
