// Deleting sheets (proposals/2026-10-04-deleting-sheets.md).
//
// removeLocal: any member frees a sheet's storage on this device.
// deleteForEveryone: the owner appends `delete`; every device that applies it
// asks its seeders to drop the sheet after the grace period, then removes it.
// After a key move, the frozen old copy goes the same way a week later.

const b4a = require('b4a')
const { DROP_GRACE_MS } = require('../seeder/protocol')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const MOVE_CLEANUP_MS = DROP_GRACE_MS

function createDeleting ({ engine, sheets, getSeeding, emit, log = () => {}, now = () => Date.now() }) {
  async function viewGet (base, key) {
    const node = await base.view.get(key)
    return node ? node.value : null
  }

  async function seedersOf (base) {
    const out = []
    for await (const { value } of base.view.createReadStream({ gt: 'seeder/', lt: 'seeder/~' })) out.push(value.seederKey)
    return out
  }

  // Every core the sheet's base uses on this device.
  function coreKeys (base) {
    const keys = new Map()
    const add = (k) => { if (k) keys.set(hex(k), k) }
    add(base.key)
    if (base.local) add(base.local.key)
    if (base.system && base.system.core) add(base.system.core.key)
    for (const w of base.activeWriters || []) add(w.core.key)
    for (const v of base.views ? base.views() : []) add(v.key)
    return [...keys.values()]
  }

  async function removeLocal (sheetId, { reason = 'removed' } = {}) {
    const base = engine.bases.get(sheetId)
    const keys = base ? coreKeys(base) : []
    sheets.forget(sheetId)
    await engine.destroyGroup(sheetId)
    let freed = 0
    for (const key of keys) {
      const core = engine.store.get({ key })
      try {
        await core.ready()
        if (core.length) { await core.clear(0, core.length); freed++ }
      } catch {} finally { await core.close().catch(() => {}) }
    }
    const snap = engine.store.get({ name: 'pearsheet-snapshot-' + sheetId })
    try { await snap.ready(); if (snap.length) await snap.clear(0, snap.length) } catch {} finally { await snap.close().catch(() => {}) }
    for (const key of ['groups:joined:', 'joins:pending:', 'snap:', 'moves:']) await engine.localDb.del(key + sheetId)
    await engine.localDb.put('removed:' + sheetId, { reason, at: now() })
    log('removed ' + sheetId.slice(0, 8) + ' from this device (' + freed + ' cores cleared)')
    emit('sheet:gone', { sheetId, reason })
    return { ok: true, freed }
  }

  async function deleteForEveryone (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base) throw new Error('unknown sheet: ' + sheetId)
    const sheet = await viewGet(base, 'sheet')
    if (!sheet || sheet.owner !== hex(engine.identity.publicKey)) throw new Error('Only the owner can delete a sheet for everyone')
    await engine.append(sheetId, m.deleteOp({ sheetId, owner: engine.identity }))
    // onDeleted runs when apply records it (the engine's onMembership hook).
    return { ok: true }
  }

  // Apply recorded `deleted` (here or on another device). False while the
  // view does not show it yet: the engine calls again until it does.
  async function onDeleted (sheetId) {
    const base = engine.bases.get(sheetId)
    if (!base) return true
    const deleted = await viewGet(base, 'deleted')
    if (!deleted) return false
    const title = (await engine.localDb.get('groups:joined:' + sheetId))?.value?.name || ''
    const seeding = getSeeding()
    if (seeding) {
      try { await seeding.requestDrop({ bootstrap: hex(base.key), seederKeys: await seedersOf(base), afterMs: DROP_GRACE_MS }) } catch (e) { log('drop request failed: ' + e.message) }
    }
    await engine.localDb.put('deleted:' + sheetId, { by: deleted.by, title, at: now() })
    emit('sheet:deleted', { sheetId, title })
    await removeLocal(sheetId, { reason: 'deleted' })
    return true
  }

  // After a key move: ask the seeder to drop the old copy a week on, and
  // remove the frozen copy here once the week has passed.
  async function afterMove (oldId) {
    const base = engine.bases.get(oldId)
    if (!base) return
    const seeding = getSeeding()
    if (seeding) {
      try { await seeding.requestDrop({ bootstrap: hex(base.key), seederKeys: await seedersOf(base), afterMs: MOVE_CLEANUP_MS }) } catch (e) { log('drop request failed: ' + e.message) }
    }
  }

  // On start: finish deletes that were applied while removal was pending, and
  // remove old copies whose week after a move is up.
  async function resume () {
    for (const [sheetId, base] of engine.bases) {
      try {
        if (await viewGet(base, 'deleted')) { await onDeleted(sheetId); continue }
        const moved = (await engine.localDb.get('moves:' + sheetId))?.value
        if (moved && moved.to && now() - moved.at >= MOVE_CLEANUP_MS) await removeLocal(sheetId, { reason: 'moved' })
      } catch (e) { log('delete resume failed for ' + sheetId.slice(0, 8) + ': ' + e.message) }
    }
  }

  return { removeLocal, deleteForEveryone, onDeleted, afterMove, resume }
}

module.exports = { createDeleting, MOVE_CLEANUP_MS }
