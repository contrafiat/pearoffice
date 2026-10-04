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

// Local snapshots (proposal section 4, "Loading a sheet"): reopening a sheet
// with a long history replayed every update (7.6 s at 100,000 edits, measured
// 2026-10-03). Each device keeps the document state plus the view version and
// fork it covers in its local Hyperbee, and replays only what came after. If
// the view's fork changed (Autobase rewound it), the snapshot is ignored and
// the sheet is rebuilt from the view.
const SNAPSHOT_EVERY = 2000 // updates applied since the last snapshot
const SNAPSHOT_CHUNK = 512 * 1024
// The state itself goes in a per-sheet local core, and older copies are
// cleared after each save. (In the local Hyperbee, which only appends, every
// old snapshot stayed on disk: 343 MB instead of 178 MB at 100,000 edits.)
// The Hyperbee holds only a small record pointing at the latest copy.

function createSheets ({ emit, getBase, getLocalDb = () => null, getStore = () => null }) {
  const open = new Map() // sheetId -> entry

  function entryFor (sheetId) {
    let e = open.get(sheetId)
    if (!e) {
      e = { guarded: new GuardedDoc(), loading: null, values: null, timer: null, undo: null }
      open.set(sheetId, e)
    }
    return e
  }

  // Tell the UI a sheet changed (also used once a background load is done).
  function changed (sheetId) { emit('sheet:changed', { sheetId }) }

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
    // Asked about a sheet this device does not hold (yet): fail without
    // leaving an entry behind, so a later call after joining loads it.
    if (!open.has(sheetId) && !getBase(sheetId)) return Promise.reject(new Error('unknown sheet: ' + sheetId))
    const e = entryFor(sheetId)
    if (!e.loading) {
      e.loading = (async () => {
        const base = getBase(sheetId)
        if (!base) throw new Error('unknown sheet: ' + sheetId)
        await base.ready()
        const fork = base.view.core.fork
        const snap = await readSnapshot(sheetId)
        if (snap && snap.fork === fork && snap.version <= base.view.version && e.guarded.apply(b4a.from(snap.state, 'base64'))) {
          // From the snapshot; catchUp below applies what came after it.
          e.version = snap.version
          e.fork = fork
          e.sinceSnapshot = 0
          e.fromSnapshot = true
        } else {
          e.version = base.view.version
          e.fork = fork
          let n = 0
          for await (const { value } of base.view.createReadStream({ gt: Y_PREFIX, lt: Y_PREFIX + '~' })) {
            if (value && typeof value.data === 'string') { e.guarded.apply(b4a.from(value.data, 'base64')); n++ }
          }
          e.sinceSnapshot = n
          if (n >= SNAPSHOT_EVERY) saveSnapshot(sheetId).catch(() => {})
        }
        trackUndo(e)
        listen(sheetId, e, base)
      })()
      e.loading.catch(() => { if (open.get(sheetId) === e) open.delete(sheetId) })
    }
    return e.loading.then(() => e)
  }

  // Autobase can fast-forward a device to the shared view without running
  // apply for those entries, so onUpdate never sees them. Catch up from the
  // view whenever Autobase says it changed.
  function listen (sheetId, e, base) {
    if (e.listening) return
    e.listening = true
    base.on('update', () => catchUp(sheetId, base).catch(() => {}))
    catchUp(sheetId, base).catch(() => {})
  }

  // A sheet this device just made (created, imported or moved to) is filled
  // directly rather than loaded; start following its view from here, so it
  // catches up and gets snapshots like any other.
  async function attach (sheetId) {
    const e = open.get(sheetId)
    const base = getBase(sheetId)
    if (!e || !base) return
    await base.ready()
    if (e.version === undefined) { e.version = base.view.version; e.fork = base.view.core.fork; e.sinceSnapshot = 0 }
    listen(sheetId, e, base)
  }

  // Apply y/ entries that appeared in the view since we last looked.
  function catchUp (sheetId, base) {
    const e = open.get(sheetId)
    if (!e) return Promise.resolve()
    e.catching = (e.catching || Promise.resolve()).then(async () => {
      const view = base.view
      const version = view.version
      const fork = view.core.fork
      if (version === e.version && fork === e.fork) return
      let applied = 0
      const take = (value) => {
        if (value && typeof value.data === 'string' && e.guarded.apply(b4a.from(value.data, 'base64'))) applied++
      }
      try {
        // A changed fork means the view was rewound; old versions no longer
        // line up, so read everything.
        if (!(e.version > 1) || fork !== e.fork) throw new Error('full scan')
        for await (const { left } of view.createDiffStream(e.version, { gt: Y_PREFIX, lt: Y_PREFIX + '~' })) {
          if (left) take(left.value)
        }
      } catch {
        // No usable older version (first look, or the view was rebuilt): read
        // everything. Applying an update twice is harmless.
        for await (const { value } of view.createReadStream({ gt: Y_PREFIX, lt: Y_PREFIX + '~' })) take(value)
      }
      e.version = version
      e.fork = fork
      e.sinceSnapshot = (e.sinceSnapshot || 0) + applied
      if (e.sinceSnapshot >= SNAPSHOT_EVERY) saveSnapshot(sheetId).catch(() => {})
      if (applied) {
        trackUndo(e)
        scheduleRecompute(sheetId)
      }
    })
    return e.catching
  }

  function snapCore (sheetId) {
    const store = getStore()
    return store ? store.get({ name: 'pearsheet-snapshot-' + sheetId }) : null
  }

  async function readSnapshot (sheetId) {
    const db = getLocalDb()
    if (!db) return null
    const node = await db.get('snap:' + sheetId)
    const rec = node && node.value
    if (!rec || typeof rec.start !== 'number') return null
    const core = snapCore(sheetId)
    if (!core) return null
    try {
      await core.ready()
      const chunks = []
      for (let i = rec.start; i < rec.start + rec.count; i++) {
        const block = await core.get(i, { wait: false })
        if (!block) return null
        chunks.push(block)
      }
      return { version: rec.version, fork: rec.fork, state: b4a.toString(b4a.concat(chunks), 'base64') }
    } finally {
      await core.close()
    }
  }

  // The state is labelled with the version catchUp last finished at: every
  // update up to there is in the document. Updates after it may be in the
  // document too (applied live); replaying them on the next open is harmless.
  async function saveSnapshot (sheetId) {
    const e = open.get(sheetId)
    const db = getLocalDb()
    if (!e || !db || !(e.version > 0) || e.fork === undefined) return
    const version = e.version
    const fork = e.fork
    const state = model.encodeState(e.guarded.doc)
    const core = snapCore(sheetId)
    if (!core) return
    try {
      await core.ready()
      const start = core.length
      const chunks = []
      for (let i = 0; i < state.byteLength; i += SNAPSHOT_CHUNK) chunks.push(state.subarray(i, i + SNAPSHOT_CHUNK))
      if (!chunks.length) chunks.push(b4a.alloc(0))
      await core.append(chunks)
      await db.put('snap:' + sheetId, { version, fork, start, count: chunks.length, at: Date.now() })
      if (start > 0) await core.clear(0, start) // free the older copies
    } finally {
      await core.close()
    }
    e.sinceSnapshot = 0
  }

  // Before shutting down: snapshot sheets that changed since the last one.
  async function flushSnapshots () {
    for (const [sheetId, e] of open) {
      if (e.loading && e.sinceSnapshot > 0) { try { await e.catching; await saveSnapshot(sheetId) } catch {} }
    }
  }

  function trackUndo (e) {
    const doc = e.guarded.doc
    const scope = [doc.getMap('meta'), doc.getArray('tabs'), ...model.tabIds(doc).map((id) => doc.getMap('tab:' + id))]
    // captureTimeout 0: every edit is its own undo step. The default (500 ms)
    // merged an edit with the one before it, so undoing a bold also removed
    // the formula typed just before.
    if (!e.undo) e.undo = new Y.UndoManager(scope, { trackedOrigins: new Set(['local']), captureTimeout: 0 })
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

  // Values as of the latest edit, for actions that act on them (sort, find):
  // the cached ones are refreshed a moment after a change.
  function currentValues (e) {
    if (e.timer) e.values = null
    return values(e)
  }

  function forget (sheetId) {
    const e = open.get(sheetId)
    if (e && e.timer) clearTimeout(e.timer)
    open.delete(sheetId)
  }

  function peek (sheetId) {
    const e = open.get(sheetId)
    return e && e.loading ? e : null
  }

  return { load, attach, onUpdate, noteLocal, values, currentValues, forget, entryFor, peek, yKey, saveSnapshot, flushSnapshots, changed }
}

module.exports = { createSheets, GuardedDoc, yKey, Y_PREFIX }
