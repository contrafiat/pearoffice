// Live Yjs documents for open sheets, kept in step with each sheet's Autobase
// view.
//
// The view holds every Yjs update under y/<writerKey>/<seq> (wire protocol
// proposal, section 4). A document is the fold of those updates. Yjs updates
// can be applied in any order and more than once, so an Autobase reorder that
// re-runs apply is harmless: the same update just lands again.
//
// Known gap: if a writer is revoked, Autobase may drop that writer's
// not-yet-indexed entries from the view, while this live document already has
// them. Reloading the sheet (or restarting) rebuilds from the view. Revocation
// arrives with the membership ops in a later change.

const Y = require('yjs')
const b4a = require('b4a')
const model = require('../shared/sheetModel')
const { evaluateSheet } = require('../shared/formula')

const Y_PREFIX = 'y/'

function yKey (node) {
  return Y_PREFIX + b4a.toString(node.from.key, 'hex') + '/' + String(node.length).padStart(12, '0')
}

// Applies untrusted updates without ever leaving `doc` half-changed: each
// update is tried on a shadow copy first. If Yjs throws, the update is skipped
// and the shadow is rebuilt from the real document. Every device runs the same
// check on the same bytes, so every device skips the same updates.
class GuardedDoc {
  constructor () {
    this.doc = model.createDoc()
    this.shadow = model.createDoc()
    this.skipped = 0
  }

  apply (update) {
    try {
      Y.applyUpdate(this.shadow, update, 'remote')
    } catch {
      this.skipped++
      this.shadow.destroy()
      this.shadow = model.createDoc()
      Y.applyUpdate(this.shadow, Y.encodeStateAsUpdate(this.doc), 'remote')
      return false
    }
    Y.applyUpdate(this.doc, update, 'remote')
    return true
  }

  // Local edits are already in `doc`; mirror them into the shadow.
  mirror (update) {
    Y.applyUpdate(this.shadow, update, 'local')
  }
}

function createSheets ({ emit, getBase }) {
  const open = new Map() // sheetId -> entry

  function entryFor (sheetId) {
    let e = open.get(sheetId)
    if (!e) {
      e = { guarded: new GuardedDoc(), loading: null, values: null, timer: null, undo: null }
      open.set(sheetId, e)
    }
    return e
  }

  function scheduleRecompute (sheetId) {
    const e = open.get(sheetId)
    if (!e || e.timer) return
    e.timer = setTimeout(() => {
      e.timer = null
      e.values = null // recomputed lazily on the next view
      emit('sheet:changed', { sheetId })
    }, 16)
  }

  // Load (once) every update in the view into the live document.
  function load (sheetId) {
    const e = entryFor(sheetId)
    if (!e.loading) {
      e.loading = (async () => {
        const base = getBase(sheetId)
        if (!base) throw new Error('unknown sheet: ' + sheetId)
        await base.ready()
        for await (const { value } of base.view.createReadStream({ gt: Y_PREFIX, lt: Y_PREFIX + '~' })) {
          if (value && typeof value.data === 'string') e.guarded.apply(b4a.from(value.data, 'base64'))
        }
        trackUndo(e)
      })()
    }
    return e.loading.then(() => e)
  }

  function trackUndo (e) {
    const doc = e.guarded.doc
    const scope = [doc.getMap('meta'), doc.getArray('tabs'), ...model.tabIds(doc).map((id) => doc.getMap('tab:' + id))]
    if (!e.undo) e.undo = new Y.UndoManager(scope, { trackedOrigins: new Set(['local']) })
    else for (const t of scope) e.undo.addToScope(t)
  }

  // Called from apply for every `y` op, in log order, including our own.
  function onUpdate (sheetId, update) {
    const e = open.get(sheetId)
    if (!e || !e.loading) return // not open: it will be read from the view on load
    if (e.guarded.apply(update)) {
      trackUndo(e)
      scheduleRecompute(sheetId)
    }
  }

  function noteLocal (sheetId, update) {
    const e = open.get(sheetId)
    e.guarded.mirror(update)
    trackUndo(e)
    scheduleRecompute(sheetId)
  }

  function values (e) {
    if (!e.values) e.values = evaluateSheet(e.guarded.doc)
    return e.values
  }

  function forget (sheetId) {
    const e = open.get(sheetId)
    if (e && e.timer) clearTimeout(e.timer)
    open.delete(sheetId)
  }

  return { load, onUpdate, noteLocal, values, forget, entryFor, yKey }
}

module.exports = { createSheets, GuardedDoc, yKey, Y_PREFIX }
