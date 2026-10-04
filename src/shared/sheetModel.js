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

// The tabs in order. Moving a tab removes its id and inserts it again, so two
// people moving the same tab at once can leave it listed twice; the first
// one counts, the same on every device.
function tabIds (doc) {
  const seen = new Set()
  return doc.getArray('tabs').toArray().filter((id) => (seen.has(id) ? false : seen.add(id)))
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
function writeCell (doc, ctx, tabId, row, col, input) {
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
}

function setCell (doc, tabId, row, col, input) {
  return capture(doc, () => writeCell(doc, makeCtx(doc, tabId), tabId, row, col, input))
}

// Write a block of inputs (rows of strings) with its top-left at row, col, as
// one change. Used by paste and by .xlsx import.
function setCells (doc, tabId, row, col, grid) {
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    grid.forEach((line, r) => line.forEach((input, c) => {
      if (input !== undefined) writeCell(doc, ctx, tabId, row + r, col + c, input)
    }))
  })
}

// Clear the contents of a range (formatting stays, as with Excel's Delete).
function clearRange (doc, tabId, r1, c1, r2, c2) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const rows = t.get('rows')
    const cols = t.get('cols')
    const cells = t.get('cells')
    for (let r = r1; r <= Math.min(r2, rows.length); r++) {
      for (let c = c1; c <= Math.min(c2, cols.length); c++) {
        const key = cellKey(rows.get(r - 1), cols.get(c - 1))
        if (cells.has(key)) cells.delete(key)
      }
    }
  })
}

function setFormatRange (doc, tabId, r1, c1, r2, c2, patch) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const rows = t.get('rows')
    const cols = t.get('cols')
    const fmt = t.get('fmt')
    for (const attr of Object.keys(patch)) if (!FORMAT_ATTRS.includes(attr)) throw new Error('unknown format attribute: ' + attr)
    for (let r = r1; r <= Math.min(r2, rows.length); r++) {
      for (let c = c1; c <= Math.min(c2, cols.length); c++) {
        for (const [attr, value] of Object.entries(patch)) {
          const key = cellKey(rows.get(r - 1), cols.get(c - 1)) + ':' + attr
          if (value === null || value === undefined || value === false) { if (fmt.has(key)) fmt.delete(key) } else if (fmt.get(key) !== value) fmt.set(key, value)
        }
      }
    }
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

// Put the rows of a range in a new order, as one change: `order` lists the
// source row for each row from r1 down. Only the range's columns move.
// Formulas move like a paste, so their relative references shift with
// their row, as in Excel; formatting moves with the cell.
function sortRows (doc, tabId, r1, c1, r2, c2, order) {
  if (order.length !== r2 - r1 + 1) throw new Error('sort order does not match the range')
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    const t = tabMap(doc, tabId)
    const fmt = t.get('fmt')
    const prebuilt = refs.indexTabs(ctx.tabs)
    const take = []
    for (let r = r1; r <= r2; r++) {
      const line = []
      for (let c = c1; c <= c2; c++) {
        const { rowId, colId } = idsAt(doc, tabId, r, c)
        const f = {}
        for (const attr of FORMAT_ATTRS) {
          const v = rowId && colId ? fmt.get(cellKey(rowId, colId) + ':' + attr) : undefined
          if (v !== undefined) f[attr] = v
        }
        line.push({ input: getInput(doc, tabId, r, c, prebuilt), fmt: f })
      }
      take.push(line)
    }
    order.forEach((from, i) => {
      const to = r1 + i
      take[from - r1].forEach((cell, j) => {
        const c = c1 + j
        let input = cell.input
        if (typeof input === 'string' && input[0] === '=' && to !== from) input = '=' + refs.shiftA1(input.slice(1), to - from, 0)
        writeCell(doc, ctx, tabId, to, c, input)
        const { rowId, colId } = idsAt(doc, tabId, to, c)
        for (const attr of FORMAT_ATTRS) {
          const key = cellKey(rowId, colId) + ':' + attr
          if (cell.fmt[attr] === undefined) { if (fmt.has(key)) fmt.delete(key) } else if (fmt.get(key) !== cell.fmt[attr]) fmt.set(key, cell.fmt[attr])
        }
      })
    })
  })
}

// Replace text in what people typed (formulas in their A1 form), as one
// change. `cells` lists [row, col, newInput].
function replaceInputs (doc, tabId, cells) {
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    for (const [row, col, input] of cells) writeCell(doc, ctx, tabId, row, col, input)
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

// Fill an empty, just-created sheet from an import payload
// ({ tabs: [{ name, cells: [[row, col, input, numFmt?]], widths }] }) in one
// change. Every tab exists before any cell is written, so formulas that point
// at another tab resolve.
function importTabs (doc, payload) {
  return capture(doc, () => {
    const ids = tabIds(doc)
    payload.tabs.forEach((tab, i) => {
      let id = ids[i]
      if (!id) { id = newTab(doc, tab.name); doc.getArray('tabs').push([id]) } else tabMap(doc, id).set('name', tab.name)
      ids[i] = id
    })
    payload.tabs.forEach((tab, i) => {
      const id = ids[i]
      const ctx = makeCtx(doc, id)
      const t = tabMap(doc, id)
      let maxR = 0
      let maxC = 0
      for (const [r, c] of tab.cells) { if (r > maxR) maxR = r; if (c > maxC) maxC = c }
      ctx.extend(id, maxR + 20, Math.max(maxC + 2, DEFAULT_COLS))
      for (const [row, col, input, num] of tab.cells) {
        writeCell(doc, ctx, id, row, col, input)
        if (num) {
          const { rowId, colId } = idsAt(doc, id, row, col)
          t.get('fmt').set(cellKey(rowId, colId) + ':num', num)
        }
      }
      for (const [col, px] of Object.entries(tab.widths || {})) {
        const colId = t.get('cols').get(Number(col) - 1)
        if (colId) t.get('widths').set(colId, Math.max(24, Math.min(1000, Math.round(px))))
      }
    })
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

// Remove a tab from the sheet (its cells stay in the document, unseen).
// Formulas that pointed at it show #REF!. The last tab cannot go.
function deleteTab (doc, tabId) {
  if (tabIds(doc).length <= 1) throw new Error('A sheet needs at least one tab')
  return capture(doc, () => {
    const tabs = doc.getArray('tabs')
    for (let i = tabs.length - 1; i >= 0; i--) if (tabs.get(i) === tabId) tabs.delete(i, 1)
  })
}

// Move a tab to a position (0-based) among the tabs.
function moveTab (doc, tabId, to) {
  const ids = tabIds(doc)
  const from = ids.indexOf(tabId)
  if (from === -1) throw new Error('unknown tab')
  const target = Math.max(0, Math.min(ids.length - 1, to))
  if (target === from) return null
  return capture(doc, () => {
    const tabs = doc.getArray('tabs')
    for (let i = tabs.length - 1; i >= 0; i--) if (tabs.get(i) === tabId) tabs.delete(i, 1)
    // Insert next to the tab that will be its neighbour.
    const rest = ids.filter((id) => id !== tabId)
    const before = rest[target]
    const at = before === undefined ? tabs.length : tabs.toArray().indexOf(before)
    tabs.insert(at, [tabId])
  })
}

// A copy of a tab, placed after it: cells, formats and widths. References to
// its own cells point at the copy's cells, as in Excel.
function duplicateTab (doc, tabId) {
  const ids = tabIds(doc)
  const src = tabMap(doc, tabId)
  const taken = new Set(ids.map((id) => String(tabMap(doc, id).get('name')).toUpperCase()))
  let name = src.get('name') + ' 2'
  for (let n = 3; taken.has(name.toUpperCase()); n++) name = src.get('name') + ' ' + n
  let id = null
  const update = capture(doc, () => {
    const rows = src.get('rows').toArray()
    const cols = src.get('cols').toArray()
    id = newTab(doc, name, rows.length, cols.length)
    const tabs = doc.getArray('tabs')
    tabs.insert(tabs.toArray().indexOf(tabId) + 1, [id])
    const copy = tabMap(doc, id)
    const newRows = copy.get('rows').toArray()
    const newCols = copy.get('cols').toArray()
    const rowAt = new Map(rows.map((r, i) => [r, i]))
    const colAt = new Map(cols.map((c, i) => [c, i]))
    const ctx = makeCtx(doc, id)
    const prebuilt = refs.indexTabs(tabsContext(doc))
    for (const key of src.get('cells').keys()) {
      const [rowId, colId] = key.split(':')
      if (!rowAt.has(rowId) || !colAt.has(colId)) continue
      const r = rowAt.get(rowId) + 1
      const c = colAt.get(colId) + 1
      writeCell(doc, ctx, id, r, c, getInput(doc, tabId, r, c, prebuilt))
    }
    for (const [key, value] of src.get('fmt').entries()) {
      const [rowId, colId, attr] = key.split(':')
      if (!rowAt.has(rowId) || !colAt.has(colId)) continue
      copy.get('fmt').set(cellKey(newRows[rowAt.get(rowId)], newCols[colAt.get(colId)]) + ':' + attr, value)
    }
    for (const [colId, px] of src.get('widths').entries()) if (colAt.has(colId)) copy.get('widths').set(newCols[colAt.get(colId)], px)
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
  setCells,
  clearRange,
  setFormatRange,
  getInput,
  setFormat,
  getFormat,
  insertRows,
  insertCols,
  deleteRows,
  deleteCols,
  setWidth,
  importTabs,
  sortRows,
  replaceInputs,
  addTab,
  renameTab,
  deleteTab,
  moveTab,
  duplicateTab
}
