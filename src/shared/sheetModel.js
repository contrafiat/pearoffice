// The sheet as a Yjs document. Layout (wire protocol proposal, section 3):
//
//   meta          Y.Map    title, version
//   tabs          Y.Array  ordered tab ids
//   tab:<tabId>   Y.Map    name, rows (Y.Array of ids), cols (Y.Array of ids),
//                          cells (Y.Map "rowId:colId" -> raw input),
//                          fmt (Y.Map "rowId:colId:attr" -> value),
//                          widths (Y.Map colId -> px)
//
// Formatting is stored one attribute per key so that one person making a
// cell bold and another giving it a currency format do not overwrite each
// other.
//
// Every mutating function runs in one Yjs transaction and returns the update
// it produced (Uint8Array), or null if nothing changed. The caller appends
// that update to the Autobase.

const Y = require('yjs')
const { newId } = require('./ids')
const refs = require('./refs')

const VERSION = 1
const DEFAULT_ROWS = 100
const DEFAULT_COLS = 26
const FORMAT_ATTRS = ['b', 'i', 'color', 'fill', 'num']

function createDoc () {
  return new Y.Doc()
}

function capture (doc, fn) {
  let update = null
  const onUpdate = (u, origin) => { if (origin === 'local') update = u }
  doc.on('update', onUpdate)
  try {
    doc.transact(fn, 'local')
  } finally {
    doc.off('update', onUpdate)
  }
  return update
}

function applyUpdate (doc, update) {
  Y.applyUpdate(doc, update, 'remote')
}

// Bad updates must be skipped the same way on every device (proposal section
// 4). Applying to a scratch copy first means a throw part-way through cannot
// leave the real document half-changed.
function checkUpdate (doc, update) {
  const scratch = new Y.Doc()
  try {
    Y.applyUpdate(scratch, Y.encodeStateAsUpdate(doc))
    Y.applyUpdate(scratch, update)
    return true
  } catch {
    return false
  } finally {
    scratch.destroy()
  }
}

function encodeState (doc) {
  return Y.encodeStateAsUpdate(doc)
}

function newTab (doc, name, rows = DEFAULT_ROWS, cols = DEFAULT_COLS) {
  // Each tab is its own root map. Only the device that creates a tab writes
  // its nested lists, so two devices never race to create the same ones.
  const id = newId()
  const root = doc.getMap('tab:' + id)
  root.set('name', name)
  const r = new Y.Array()
  r.push(Array.from({ length: rows }, newId))
  root.set('rows', r)
  const c = new Y.Array()
  c.push(Array.from({ length: cols }, newId))
  root.set('cols', c)
  root.set('cells', new Y.Map())
  root.set('fmt', new Y.Map())
  root.set('widths', new Y.Map())
  return id
}

function initSheet (doc, { title = 'Untitled sheet' } = {}) {
  return capture(doc, () => {
    const meta = doc.getMap('meta')
    meta.set('title', title)
    meta.set('version', VERSION)
    const id = newTab(doc, 'Sheet1')
    doc.getArray('tabs').push([id])
  })
}

function tabMap (doc, tabId) {
  const t = doc.getMap('tab:' + tabId)
  if (!t.has('rows')) throw new Error('unknown tab: ' + tabId)
  return t
}

function title (doc) {
  return doc.getMap('meta').get('title') || ''
}

function tabIds (doc) {
  return doc.getArray('tabs').toArray()
}

// Plain-object view of every tab's id lists, for formula translation.
function tabsContext (doc) {
  return tabIds(doc).map((id) => {
    const t = doc.getMap('tab:' + id)
    return { id, name: t.get('name'), rows: t.get('rows').toArray(), cols: t.get('cols').toArray() }
  })
}

function makeCtx (doc, tabId) {
  const ctx = {
    tabId,
    tabs: tabsContext(doc),
    extend (id, rowCount, colCount) {
      const t = tabMap(doc, id)
      const rows = t.get('rows')
      const cols = t.get('cols')
      if (rowCount > rows.length) rows.push(Array.from({ length: rowCount - rows.length }, newId))
      if (colCount > cols.length) cols.push(Array.from({ length: colCount - cols.length }, newId))
      ctx.tabs = tabsContext(doc)
    }
  }
  return ctx
}

function cellKey (rowId, colId) {
  return rowId + ':' + colId
}

// Row and column numbers are 1-based positions in the current order.
function idsAt (doc, tabId, row, col) {
  const t = tabMap(doc, tabId)
  return { t, rowId: t.get('rows').get(row - 1), colId: t.get('cols').get(col - 1) }
}

// Set what a person typed into a cell. Formulas are translated from A1 to ids.
// Typing past the edge of the grid grows it.
function setCell (doc, tabId, row, col, input) {
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    const t = tabMap(doc, tabId)
    if (row > t.get('rows').length || col > t.get('cols').length) ctx.extend(tabId, row, col)
    const { rowId, colId } = idsAt(doc, tabId, row, col)
    const cells = t.get('cells')
    const key = cellKey(rowId, colId)
    if (input === '' || input === null || input === undefined) {
      if (cells.has(key)) cells.delete(key)
      return
    }
    const raw = typeof input === 'string' && input[0] === '=' ? '=' + refs.toStored(input.slice(1), ctx) : String(input)
    if (cells.get(key) !== raw) cells.set(key, raw)
  })
}

// What to show in the edit box for a cell: formulas back in A1 form.
function getInput (doc, tabId, row, col, prebuilt) {
  const { t, rowId, colId } = idsAt(doc, tabId, row, col)
  if (!rowId || !colId) return ''
  const raw = t.get('cells').get(cellKey(rowId, colId))
  if (raw === undefined) return ''
  if (raw[0] !== '=') return raw
  return '=' + refs.toDisplay(raw.slice(1), { tabId, tabs: tabsContext(doc) }, prebuilt)
}

function setFormat (doc, tabId, row, col, patch) {
  return capture(doc, () => {
    const { t, rowId, colId } = idsAt(doc, tabId, row, col)
    const fmt = t.get('fmt')
    for (const [attr, value] of Object.entries(patch)) {
      if (!FORMAT_ATTRS.includes(attr)) throw new Error('unknown format attribute: ' + attr)
      const key = cellKey(rowId, colId) + ':' + attr
      if (value === null || value === undefined || value === false) fmt.delete(key)
      else fmt.set(key, value)
    }
  })
}

function getFormat (doc, tabId, row, col) {
  const { t, rowId, colId } = idsAt(doc, tabId, row, col)
  const fmt = t.get('fmt')
  const out = {}
  for (const attr of FORMAT_ATTRS) {
    const v = fmt.get(cellKey(rowId, colId) + ':' + attr)
    if (v !== undefined) out[attr] = v
  }
  return out
}

function insertRows (doc, tabId, at, count = 1) {
  return capture(doc, () => tabMap(doc, tabId).get('rows').insert(at - 1, Array.from({ length: count }, newId)))
}

function insertCols (doc, tabId, at, count = 1) {
  return capture(doc, () => tabMap(doc, tabId).get('cols').insert(at - 1, Array.from({ length: count }, newId)))
}

// Deleting a row or column removes its cells and formatting. Ranges in any
// formula that START or END on the deleted line are pulled one line inward
// (as Excel does), so SUM(A1:A10) becomes SUM(A1:A9) when row 10 goes. Single
// references to a deleted cell become #REF! on their own.
function deleteLine (doc, tabId, kind, at, count) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const list = t.get(kind === 'row' ? 'rows' : 'cols')
    const all = list.toArray()
    const gone = new Set(all.slice(at - 1, at - 1 + count))
    if (gone.size === 0) return
    const before = all[at - 2] || null
    const after = all[at - 1 + count] || null

    rewriteRangeEnds(doc, tabId, kind, gone, before, after)

    for (const key of [...t.get('cells').keys()]) {
      const [r, c] = key.split(':')
      if (gone.has(kind === 'row' ? r : c)) t.get('cells').delete(key)
    }
    for (const key of [...t.get('fmt').keys()]) {
      const [r, c] = key.split(':')
      if (gone.has(kind === 'row' ? r : c)) t.get('fmt').delete(key)
    }
    if (kind === 'col') for (const id of gone) t.get('widths').delete(id)
    list.delete(at - 1, gone.size)
  })
}

function rewriteRangeEnds (doc, tabId, kind, gone, before, after) {
  const RANGE = new RegExp(refs.TOKEN_RE.source + ':' + refs.TOKEN_RE.source, 'g')
  for (const otherTab of tabIds(doc)) {
    const cells = doc.getMap('tab:' + otherTab).get('cells')
    for (const [key, raw] of [...cells.entries()]) {
      if (typeof raw !== 'string' || raw[0] !== '=') continue
      const next = raw.replace(RANGE, (whole, t1, r1$, r1, c1$, c1, t2, r2$, r2, c2$, c2) => {
        const tab1 = t1 || otherTab
        const tab2 = t2 || otherTab
        if (tab1 !== tabId || tab2 !== tabId) return whole
        let [a, b] = kind === 'row' ? [r1, r2] : [c1, c2]
        if (gone.has(a) && after && !gone.has(b)) a = after
        if (gone.has(b) && before && !gone.has(a)) b = before
        const tok = (t, r$, r, c$, c) => '{' + (t ? t + '|' : '') + (r === '' ? '' : r$ + r) + '.' + (c === '' ? '' : c$ + c) + '}'
        return kind === 'row'
          ? tok(t1, r1$, a, c1$, c1) + ':' + tok(t2, r2$, b, c2$, c2)
          : tok(t1, r1$, r1, c1$, a) + ':' + tok(t2, r2$, r2, c2$, b)
      })
      if (next !== raw) cells.set(key, next)
    }
  }
}

function deleteRows (doc, tabId, at, count = 1) {
  return deleteLine(doc, tabId, 'row', at, count)
}

function deleteCols (doc, tabId, at, count = 1) {
  return deleteLine(doc, tabId, 'col', at, count)
}

function setWidth (doc, tabId, col, px) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const colId = t.get('cols').get(col - 1)
    if (!colId) return
    const w = Math.max(24, Math.min(1000, Math.round(Number(px) || 0)))
    if (t.get('widths').get(colId) !== w) t.get('widths').set(colId, w)
  })
}

function addTab (doc, name) {
  let id = null
  const update = capture(doc, () => {
    id = newTab(doc, name)
    doc.getArray('tabs').push([id])
  })
  return { id, update }
}

function renameTab (doc, tabId, name) {
  return capture(doc, () => tabMap(doc, tabId).set('name', name))
}

function setTitle (doc, value) {
  return capture(doc, () => doc.getMap('meta').set('title', value))
}

module.exports = {
  VERSION,
  FORMAT_ATTRS,
  createDoc,
  applyUpdate,
  checkUpdate,
  encodeState,
  initSheet,
  title,
  setTitle,
  tabIds,
  tabsContext,
  tabMap,
  cellKey,
  setCell,
  getInput,
  setFormat,
  getFormat,
  insertRows,
  insertCols,
  deleteRows,
  deleteCols,
  setWidth,
  addTab,
  renameTab
}
