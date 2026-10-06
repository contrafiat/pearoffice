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
const { numToCol } = require('./a1')
const { fillLine } = require('./fill')

const VERSION = 1
const DEFAULT_ROWS = 100
const DEFAULT_COLS = 26
const FORMAT_ATTRS = ['b', 'i', 'color', 'fill', 'num', 'align', 'valign', 'wrap', 'size', 'u', 's', 'font', 'bt', 'br', 'bb', 'bl']

// Allowed values for the formats added in proposals/2026-10-04-cell-formats.md.
// A value outside these is refused, so every device draws the same thing.
const BORDER = /^(thin|medium|thick|dashed|double)(:#[0-9a-f]{6})?$/i
const FORMAT_VALUES = {
  align: (v) => ['left', 'center', 'right'].includes(v),
  valign: (v) => ['top', 'middle', 'bottom'].includes(v),
  wrap: (v) => v === true,
  u: (v) => v === true,
  s: (v) => v === true,
  size: (v) => Number.isInteger(v) && v >= 6 && v <= 72,
  font: (v) => ['serif', 'mono'].includes(v),
  bt: (v) => BORDER.test(v),
  br: (v) => BORDER.test(v),
  bb: (v) => BORDER.test(v),
  bl: (v) => BORDER.test(v)
}
function checkFormat (attr, value) {
  if (!FORMAT_ATTRS.includes(attr)) throw new Error('unknown format attribute: ' + attr)
  if (value === null || value === undefined || value === false) return
  if (FORMAT_VALUES[attr] && !FORMAT_VALUES[attr](value)) throw new Error('bad value for ' + attr)
}

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

// What `from` has that `into` lacks, as one update, or null when nothing:
// after a move each writer device sends the new sheet the edits only its copy
// of the old one holds (proposals/2026-10-05-shared-compaction.md). The new
// sheet starts from the same document, so the two line up. An update always
// carries the whole delete set, so "nothing" means it changes no snapshot.
function missingFrom (from, into) {
  const update = Y.encodeStateAsUpdate(from, Y.encodeStateVector(into))
  const probe = new Y.Doc()
  try {
    Y.applyUpdate(probe, Y.encodeStateAsUpdate(into))
    const before = Y.snapshot(probe)
    Y.applyUpdate(probe, update)
    return Y.equalSnapshots(before, Y.snapshot(probe)) ? null : update
  } finally {
    probe.destroy()
  }
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

// What kind of file a document is (proposals/2026-10-06-rename-to-pearoffice.md,
// step 2). Only sheets exist so far; files made before kinds count as sheets.
const KINDS = ['sheet']

function kind (doc) {
  return doc.getMap('meta').get('kind') || 'sheet'
}

function initSheet (doc, { title = 'Untitled sheet' } = {}) {
  return capture(doc, () => {
    const meta = doc.getMap('meta')
    meta.set('title', title)
    meta.set('kind', 'sheet')
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
    for (const [attr, value] of Object.entries(patch)) checkFormat(attr, value)
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
      checkFormat(attr, value)
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

// Fill n cells past a source range in one direction ('down', 'up', 'right',
// 'left'), as one change: series or copies (src/shared/fill.js). Copied
// formulas shift their references to the new cell; formats come along.
// skipRows: rows a filter hides on this device, left untouched by a fill
// up or down (as in Excel).
function fillRange (doc, tabId, src, dir, n, mode = 'series', skipRows = null) {
  if (!(n > 0)) return null
  const vertical = dir === 'down' || dir === 'up'
  const backward = dir === 'up' || dir === 'left'
  // The rows (or columns) filled, in order away from the source.
  const targets = []
  for (let step = 1; step <= n; step++) {
    const at = vertical ? (backward ? src.r1 - step : src.r2 + step) : (backward ? src.c1 - step : src.c2 + step)
    if (!(vertical && skipRows && skipRows.has(at))) targets.push(at)
  }
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    const t = tabMap(doc, tabId)
    const fmt = t.get('fmt')
    const prebuilt = refs.indexTabs(ctx.tabs)
    const formatOf = (r, c) => {
      const { rowId, colId } = idsAt(doc, tabId, r, c)
      const f = {}
      if (!rowId || !colId) return f
      for (const attr of FORMAT_ATTRS) { const v = fmt.get(cellKey(rowId, colId) + ':' + attr); if (v !== undefined) f[attr] = v }
      return f
    }
    const lines = vertical ? [src.c1, src.c2] : [src.r1, src.r2]
    for (let line = lines[0]; line <= lines[1]; line++) {
      const cellsOf = []
      const k = vertical ? src.r2 - src.r1 + 1 : src.c2 - src.c1 + 1
      for (let i = 0; i < k; i++) {
        const r = vertical ? src.r1 + i : line
        const c = vertical ? line : src.c1 + i
        const f = formatOf(r, c)
        cellsOf.push({ r, c, input: getInput(doc, tabId, r, c, prebuilt), fmt: f, num: f.num })
      }
      const plan = fillLine(cellsOf, targets.length, { backward, mode })
      plan.forEach((p, t) => {
        const r = vertical ? targets[t] : line
        const c = vertical ? line : targets[t]
        if (r < 1 || c < 1) return
        let input
        let f
        if (p.from !== undefined) {
          const from = cellsOf[p.from]
          input = from.input
          if (typeof input === 'string' && input[0] === '=') input = '=' + refs.shiftA1(input.slice(1), r - from.r, c - from.c)
          f = from.fmt
        } else {
          input = p.input
          f = cellsOf[p.like || 0].fmt
        }
        writeCell(doc, ctx, tabId, r, c, input)
        const { rowId, colId } = idsAt(doc, tabId, r, c)
        for (const attr of FORMAT_ATTRS) {
          const key = cellKey(rowId, colId) + ':' + attr
          if (f[attr] === undefined) { if (fmt.has(key)) fmt.delete(key) } else if (fmt.get(key) !== f[attr]) fmt.set(key, f[attr])
        }
      })
    }
  })
}

// --- charts (proposals/2026-10-04-charts.md) -----------------------------
// A tab's charts live in the root map `charts:<tabId>` (root maps never
// clash between devices): chart id -> a map with one key per setting, the
// data range stored like a formula reference (cell ids) and the anchor cell
// as ids.

const { SETTINGS: CHART_SETTINGS } = require('./charts')

function chartsMap (doc, tabId) {
  return doc.getMap('charts:' + tabId)
}

function writeChart (doc, tabId, chart, patch) {
  const ctx = makeCtx(doc, tabId)
  for (const [key, value] of Object.entries(patch)) {
    if (key === 'data') chart.set('data', value ? refs.toStored(String(value).replace(/^=/, ''), ctx) : '')
    else if (key === 'anchor') {
      const { rowId, colId } = idsAt(doc, tabId, Math.max(1, value.row), Math.max(1, value.col))
      chart.set('anchorRow', rowId)
      chart.set('anchorCol', colId)
      chart.set('dx', Math.round(value.dx || 0))
      chart.set('dy', Math.round(value.dy || 0))
    } else if (key === 'size') {
      chart.set('w', Math.max(160, Math.min(2000, Math.round(value.w))))
      chart.set('h', Math.max(120, Math.min(2000, Math.round(value.h))))
    } else if (CHART_SETTINGS.includes(key)) {
      if (value === null || value === undefined) chart.delete(key)
      else chart.set(key, value)
    } else throw new Error('unknown chart setting: ' + key)
  }
}

function addChart (doc, tabId, spec) {
  const id = newId()
  const update = capture(doc, () => {
    const chart = new Y.Map()
    chartsMap(doc, tabId).set(id, chart)
    writeChart(doc, tabId, chart, { size: { w: 480, h: 300 }, ...spec })
  })
  return { id, update }
}

function setChart (doc, tabId, id, patch) {
  const chart = chartsMap(doc, tabId).get(id)
  if (!chart) throw new Error('That chart was deleted')
  return capture(doc, () => writeChart(doc, tabId, chart, patch))
}

function deleteChart (doc, tabId, id) {
  return capture(doc, () => chartsMap(doc, tabId).delete(id))
}

// Every chart on a tab, with its data range back in A1 form and its anchor
// as a row and column number (row 1, column 1 if those were deleted).
function getCharts (doc, tabId) {
  const t = tabMap(doc, tabId)
  const rows = t.get('rows').toArray()
  const cols = t.get('cols').toArray()
  const out = []
  for (const [id, chart] of chartsMap(doc, tabId).entries()) {
    const c = { id }
    for (const key of CHART_SETTINGS) if (chart.has(key)) c[key] = chart.get(key)
    const stored = chart.get('data') || ''
    c.data = stored ? refs.toDisplay(stored, { tabId, tabs: tabsContext(doc) }) : ''
    const row = rows.indexOf(chart.get('anchorRow')) + 1
    const col = cols.indexOf(chart.get('anchorCol')) + 1
    c.anchor = { row: row || 1, col: col || 1, dx: chart.get('dx') || 0, dy: chart.get('dy') || 0 }
    c.size = { w: chart.get('w') || 480, h: chart.get('h') || 300 }
    out.push(c)
  }
  return out.sort((a, b) => (a.id < b.id ? -1 : 1))
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
  // A range whose first or last row (column) goes ends at the next one in.
  const shrink = (raw, otherTab) => raw.replace(RANGE, (whole, t1, r1$, r1, c1$, c1, t2, r2$, r2, c2$, c2) => {
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
  for (const otherTab of tabIds(doc)) {
    const cells = doc.getMap('tab:' + otherTab).get('cells')
    for (const [key, raw] of [...cells.entries()]) {
      if (typeof raw !== 'string' || raw[0] !== '=') continue
      const next = shrink(raw, otherTab)
      if (next !== raw) cells.set(key, next)
    }
    // Ranges kept outside cells: colour rules, validation (range and list
    // source) and chart data.
    for (const [name, fields] of [['cf:', ['range', 'formula']], ['valid:', ['range', 'source']]]) {
      const map = doc.getMap(name + otherTab)
      for (const [id, v] of [...map.entries()]) {
        if (!v || typeof v !== 'object') continue
        const patch = {}
        for (const f of fields) if (typeof v[f] === 'string') { const next = shrink(v[f], otherTab); if (next !== v[f]) patch[f] = next }
        if (Object.keys(patch).length) map.set(id, { ...v, ...patch })
      }
    }
    const names = doc.getMap('names')
    for (const [key, v] of [...names.entries()]) {
      if (!v || v.tab !== otherTab || typeof v.range !== 'string') continue
      const next = shrink(v.range, otherTab)
      if (next !== v.range) names.set(key, { ...v, range: next })
    }
    for (const chart of doc.getMap('charts:' + otherTab).values()) {
      const data = chart && typeof chart.get === 'function' ? chart.get('data') : null
      if (typeof data === 'string') { const next = shrink(data, otherTab); if (next !== data) chart.set('data', next) }
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

// Borders over a range, as one change. preset: all, outside, inside, top,
// bottom, left, right or none; line: 'thin', 'medium:#cc0000' and so on.
function setBorders (doc, tabId, r1, c1, r2, c2, preset, line = 'thin') {
  if (preset !== 'none' && !BORDER.test(line)) throw new Error('bad border')
  const PRESETS = ['all', 'outside', 'inside', 'top', 'bottom', 'left', 'right', 'none']
  if (!PRESETS.includes(preset)) throw new Error('unknown border preset')
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const rows = t.get('rows')
    const cols = t.get('cols')
    const fmt = t.get('fmt')
    for (let r = r1; r <= Math.min(r2, rows.length); r++) {
      for (let c = c1; c <= Math.min(c2, cols.length); c++) {
        const sides = preset === 'none' ? { bt: null, br: null, bb: null, bl: null }
          : preset === 'all' ? { bt: line, br: line, bb: line, bl: line }
            : preset === 'outside' ? { ...(r === r1 && { bt: line }), ...(r === r2 && { bb: line }), ...(c === c1 && { bl: line }), ...(c === c2 && { br: line }) }
              : preset === 'inside' ? { ...(r < r2 && { bb: line }), ...(c < c2 && { br: line }) }
                : preset === 'top' ? (r === r1 ? { bt: line } : {})
                  : preset === 'bottom' ? (r === r2 ? { bb: line } : {})
                    : preset === 'left' ? (c === c1 ? { bl: line } : {})
                      : (c === c2 ? { br: line } : {})
        for (const [attr, value] of Object.entries(sides)) {
          const key = cellKey(rows.get(r - 1), cols.get(c - 1)) + ':' + attr
          if (value === null) { if (fmt.has(key)) fmt.delete(key) } else if (fmt.get(key) !== value) fmt.set(key, value)
        }
      }
    }
  })
}

// --- merged cells (proposals/2026-10-04-cell-formats.md) ------------------
// The root map merges:<tabId>: the top-left cell's ids -> { toRow, toCol },
// the bottom-right cell's ids, so a merge follows inserted and deleted rows.

function mergesMap (doc, tabId) {
  return doc.getMap('merges:' + tabId)
}

// The merges in force on a tab, as { r1, c1, r2, c2 }: those whose corners
// still exist, and where two overlap, the one whose top-left comes first in
// reading order. The same on every device.
function getMerges (doc, tabId) {
  const t = tabMap(doc, tabId)
  const rowAt = new Map(t.get('rows').toArray().map((id, i) => [id, i + 1]))
  const colAt = new Map(t.get('cols').toArray().map((id, i) => [id, i + 1]))
  const all = []
  for (const [key, to] of mergesMap(doc, tabId).entries()) {
    const [rowId, colId] = key.split(':')
    const m = { r1: rowAt.get(rowId), c1: colAt.get(colId), r2: rowAt.get(to && to.toRow), c2: colAt.get(to && to.toCol) }
    if (!m.r1 || !m.c1 || !m.r2 || !m.c2 || m.r2 < m.r1 || m.c2 < m.c1 || (m.r1 === m.r2 && m.c1 === m.c2)) continue
    all.push(m)
  }
  all.sort((a, b) => a.r1 - b.r1 || a.c1 - b.c1)
  const kept = []
  for (const m of all) {
    if (kept.some((k) => m.r1 <= k.r2 && m.r2 >= k.r1 && m.c1 <= k.c2 && m.c2 >= k.c1)) continue
    kept.push(m)
  }
  return kept
}

// Merge a range: keeps the top-left cell's contents and clears the rest, and
// replaces any merge inside it.
function mergeCells (doc, tabId, r1, c1, r2, c2) {
  if (r1 === r2 && c1 === c2) return null
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const rows = t.get('rows')
    const cols = t.get('cols')
    const cells = t.get('cells')
    const map = mergesMap(doc, tabId)
    for (const m of getMerges(doc, tabId)) {
      if (m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1) map.delete(cellKey(rows.get(m.r1 - 1), cols.get(m.c1 - 1)))
    }
    for (let r = r1; r <= r2; r++) {
      for (let c = c1; c <= c2; c++) {
        if (r === r1 && c === c1) continue
        const key = cellKey(rows.get(r - 1), cols.get(c - 1))
        if (cells.has(key)) cells.delete(key)
      }
    }
    map.set(cellKey(rows.get(r1 - 1), cols.get(c1 - 1)), { toRow: rows.get(r2 - 1), toCol: cols.get(c2 - 1) })
  })
}

// Unmerge every merge that touches a range.
function unmergeCells (doc, tabId, r1, c1, r2, c2) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const map = mergesMap(doc, tabId)
    for (const [key, to] of [...map.entries()]) {
      const [rowId, colId] = key.split(':')
      const rows = t.get('rows').toArray()
      const cols = t.get('cols').toArray()
      const m = { r1: rows.indexOf(rowId) + 1, c1: cols.indexOf(colId) + 1, r2: rows.indexOf(to.toRow) + 1, c2: cols.indexOf(to.toCol) + 1 }
      if (!m.r1 || !m.c1 || !m.r2 || !m.c2) { map.delete(key); continue }
      if (m.r1 <= r2 && m.r2 >= r1 && m.c1 <= c2 && m.c2 >= c1) map.delete(key)
    }
  })
}

// --- frozen panes (proposals/2026-10-04-freeze-filter.md) ------------------
// The root map view:<tabId>: freezeRow and freezeCol, the ids of the last
// frozen row and column, so inserting inside the frozen part grows it.

function setFreeze (doc, tabId, rows, cols) {
  return capture(doc, () => {
    const t = tabMap(doc, tabId)
    const v = doc.getMap('view:' + tabId)
    const r = rows > 0 ? t.get('rows').get(Math.min(rows, t.get('rows').length) - 1) : null
    const c = cols > 0 ? t.get('cols').get(Math.min(cols, t.get('cols').length) - 1) : null
    if (r) { if (v.get('freezeRow') !== r) v.set('freezeRow', r) } else if (v.has('freezeRow')) v.delete('freezeRow')
    if (c) { if (v.get('freezeCol') !== c) v.set('freezeCol', c) } else if (v.has('freezeCol')) v.delete('freezeCol')
  })
}

// { rows, cols } frozen on a tab (0 when none, or when that row or column
// was deleted).
function getFreeze (doc, tabId) {
  const t = tabMap(doc, tabId)
  const v = doc.getMap('view:' + tabId)
  const rows = v.has('freezeRow') ? t.get('rows').toArray().indexOf(v.get('freezeRow')) + 1 : 0
  const cols = v.has('freezeCol') ? t.get('cols').toArray().indexOf(v.get('freezeCol')) + 1 : 0
  return { rows, cols }
}

// Hidden rows and columns (proposals/2026-10-04-sheet-tools.md), shared by
// everyone: the root map hidden:<tabId> holds row or column id -> true.
// kind 'row' or 'col'; from..to inclusive.
function setHidden (doc, tabId, kind, from, to, hidden) {
  return capture(doc, () => {
    const ids = tabMap(doc, tabId).get(kind === 'col' ? 'cols' : 'rows')
    const map = doc.getMap('hidden:' + tabId)
    for (let i = Math.max(1, from); i <= Math.min(to, ids.length); i++) {
      const id = ids.get(i - 1)
      if (hidden) { if (map.get(id) !== true) map.set(id, true) } else if (map.has(id)) map.delete(id)
    }
  })
}

// { rows: [row numbers], cols: [col numbers] }, in order.
function getHidden (doc, tabId) {
  const t = tabMap(doc, tabId)
  const map = doc.getMap('hidden:' + tabId)
  const out = { rows: [], cols: [] }
  if (!map.size) return out
  t.get('rows').toArray().forEach((id, i) => { if (map.get(id) === true) out.rows.push(i + 1) })
  t.get('cols').toArray().forEach((id, i) => { if (map.get(id) === true) out.cols.push(i + 1) })
  return out
}

// Comments (proposals/2026-10-04-sheet-tools.md), in the root map
// comments:<tabId>: id -> { row, col (ids), parent, author, text, at,
// edited, deleted }, and "<id>:resolved" -> true for a resolved thread (a
// key of its own, so resolving never overwrites an edit made at the same
// time). A thread is a comment with no parent and its replies. Authors may
// change or delete only their own.
const COMMENT_MAX = 2000
const commentText = (text) => {
  const t = String(text || '').trim()
  if (!t) throw new Error('A comment needs some text')
  return t.slice(0, COMMENT_MAX)
}

function addComment (doc, tabId, { row, col, parent = null, author, text, at }) {
  const map = doc.getMap('comments:' + tabId)
  const t = tabMap(doc, tabId)
  let rowId = t.get('rows').get(row - 1)
  let colId = t.get('cols').get(col - 1)
  if (parent) {
    const root = map.get(parent)
    if (!root || root.parent) throw new Error('No such comment')
    rowId = root.row
    colId = root.col
  }
  if (!rowId || !colId) throw new Error('No such cell')
  const id = newId()
  const update = capture(doc, () => {
    map.set(id, { row: rowId, col: colId, parent: parent || null, author: String(author), text: commentText(text), at: Number(at) || 0 })
  })
  return { id, update }
}

function ownComment (doc, tabId, id, author) {
  const c = doc.getMap('comments:' + tabId).get(id)
  if (!c || c.deleted) throw new Error('No such comment')
  if (c.author !== author) throw new Error('Only the person who wrote a comment can change it')
  return c
}

function editComment (doc, tabId, id, author, text, at) {
  const c = ownComment(doc, tabId, id, author)
  return capture(doc, () => doc.getMap('comments:' + tabId).set(id, { ...c, text: commentText(text), edited: Number(at) || 0 }))
}

// A thread that still has replies keeps its first comment as "deleted".
function deleteComment (doc, tabId, id, author) {
  const c = ownComment(doc, tabId, id, author)
  const map = doc.getMap('comments:' + tabId)
  const replies = !c.parent && [...map.values()].some((x) => x && x.parent === id && !x.deleted)
  return capture(doc, () => {
    if (replies) map.set(id, { ...c, text: '', deleted: true })
    else { map.delete(id); if (map.has(id + ':resolved')) map.delete(id + ':resolved') }
  })
}

function resolveComment (doc, tabId, id, resolved) {
  const map = doc.getMap('comments:' + tabId)
  const c = map.get(id)
  if (!c || c.parent) throw new Error('No such thread')
  return capture(doc, () => { if (resolved) map.set(id + ':resolved', true); else if (map.has(id + ':resolved')) map.delete(id + ':resolved') })
}

// The tab's threads: [{ id, row, col, author, text, at, edited, deleted,
// resolved, replies: [...] }] in reading order, oldest reply first. A
// thread whose cell was deleted, or whose comments are all deleted, is
// left out.
function getComments (doc, tabId) {
  const map = doc.getMap('comments:' + tabId)
  if (!map.size) return []
  const t = tabMap(doc, tabId)
  const rowAt = new Map(t.get('rows').toArray().map((id, i) => [id, i + 1]))
  const colAt = new Map(t.get('cols').toArray().map((id, i) => [id, i + 1]))
  const roots = new Map()
  const replies = []
  for (const [id, c] of map.entries()) {
    if (id.includes(':') || !c || typeof c !== 'object') continue
    if (c.parent) { replies.push({ id, ...c }); continue }
    const row = rowAt.get(c.row)
    const col = colAt.get(c.col)
    if (!row || !col) continue
    roots.set(id, { id, row, col, author: c.author, text: c.text, at: c.at, edited: c.edited || null, deleted: !!c.deleted, resolved: map.get(id + ':resolved') === true, replies: [] })
  }
  for (const r of replies) {
    const root = roots.get(r.parent)
    if (root && !r.deleted) root.replies.push({ id: r.id, author: r.author, text: r.text, at: r.at, edited: r.edited || null })
  }
  const order = (a, b) => a.at - b.at || (a.id < b.id ? -1 : 1)
  return [...roots.values()]
    .filter((x) => !x.deleted || x.replies.length)
    .map((x) => ({ ...x, replies: x.replies.sort(order) }))
    .sort((a, b) => a.row - b.row || a.col - b.col || order(a, b))
}

// Data validation (proposals/2026-10-04-sheet-tools.md), in the root map
// valid:<tabId>: rule id -> { range, source (stored like formula
// references, so they follow inserts and deletes), n (order: the newest
// rule wins where two cover a cell), kind, op, a, b, items, dropdown,
// onBad, message }. A new rule replaces the ones wholly inside its range;
// clearing (rule null) removes every rule that touches the range.
const validation = require('./validation')
// "A3" for a one-cell range, else null.
const oneCell = (box) => (box.r1 === box.r2 && box.c1 === box.c2 ? numToCol(box.c1) + box.r1 : null)

function setValidation (doc, tabId, rangeText, rule) {
  const box = require('./charts').parseRange(rangeText)
  if (!box || box.sheet || box.spill) throw new Error('Pick a range on this tab')
  const clean = rule ? validation.normalize(rule) : null
  if (clean && clean.source) {
    const src = require('./charts').parseRange(clean.source)
    if (!src || src.spill) throw new Error('The list range is not a range')
  }
  return capture(doc, () => {
    const ctx = makeCtx(doc, tabId)
    ctx.extend(tabId, box.r2, box.c2)
    const map = doc.getMap('valid:' + tabId)
    let n = 0
    for (const v of getValidations(doc, tabId)) {
      const inside = v.r1 >= box.r1 && v.r2 <= box.r2 && v.c1 >= box.c1 && v.c2 <= box.c2
      const touches = !(v.r1 > box.r2 || v.r2 < box.r1 || v.c1 > box.c2 || v.c2 < box.c1)
      if (clean ? inside : touches) map.delete(v.id)
    }
    if (!clean) return
    for (const x of map.values()) n = Math.max(n, (x && x.n) || 0)
    const text = numToCol(box.c1) + box.r1 + ':' + numToCol(box.c2) + box.r2
    const stored = { ...clean, n: n + 1, range: refs.toStored(text, makeCtx(doc, tabId)) }
    if (clean.source) stored.source = refs.toStored(clean.source, makeCtx(doc, tabId))
    map.set(newId(), stored)
  })
}

// The tab's rules in order (oldest first), with their ranges as numbers.
// A rule whose range was deleted is left out.
function getValidations (doc, tabId) {
  const map = doc.getMap('valid:' + tabId)
  if (!map.size) return []
  const where = { tabId, tabs: tabsContext(doc) }
  const out = []
  for (const [id, v] of map.entries()) {
    if (!v || typeof v !== 'object') continue
    const range = refs.toDisplay(v.range || '', where)
    const box = require('./charts').parseRange(range)
    if (!box || box.sheet) continue
    const rule = { id, range: oneCell(box) || range, r1: box.r1, c1: box.c1, r2: box.r2, c2: box.c2, n: v.n || 0 }
    for (const k of ['kind', 'op', 'a', 'b', 'items', 'dropdown', 'onBad', 'message']) if (v[k] !== undefined) rule[k] = v[k]
    if (v.source) rule.source = refs.toDisplay(v.source, where)
    out.push(rule)
  }
  return out.sort((a, b) => a.n - b.n || (a.id < b.id ? -1 : 1))
}

// Conditional formatting (proposals/2026-10-04-sheet-tools.md), in the root
// map cf:<tabId>: rule id -> { range (stored like a formula reference),
// order, ...rule }. Lower order comes first; a new rule goes on top. The
// colours are worked out on each device (src/shared/condFormat.js).
const condFormat = require('./condFormat')

function cfRange (doc, tabId, rangeText) {
  const box = require('./charts').parseRange(rangeText)
  if (!box || box.sheet || box.spill) throw new Error('Pick a range on this tab')
  makeCtx(doc, tabId).extend(tabId, box.r2, box.c2)
  return refs.toStored(numToCol(box.c1) + box.r1 + ':' + numToCol(box.c2) + box.r2, makeCtx(doc, tabId))
}

// A formula rule's formula is stored like a cell's, so it follows inserts.
function cfStored (doc, tabId, rule) {
  return rule.formula ? { ...rule, formula: refs.toStored(rule.formula, makeCtx(doc, tabId)) } : rule
}

function addCondFormat (doc, tabId, rangeText, rule) {
  const clean = condFormat.normalize(rule)
  const id = newId()
  const update = capture(doc, () => {
    const map = doc.getMap('cf:' + tabId)
    let order = 0
    for (const v of map.values()) if (v && typeof v.order === 'number') order = Math.min(order, v.order)
    map.set(id, { ...cfStored(doc, tabId, clean), range: cfRange(doc, tabId, rangeText), order: order - 1 })
  })
  return { id, update }
}

function setCondFormat (doc, tabId, id, rangeText, rule) {
  const map = doc.getMap('cf:' + tabId)
  const old = map.get(id)
  if (!old) throw new Error('That rule was deleted')
  const clean = condFormat.normalize(rule)
  return capture(doc, () => map.set(id, { ...cfStored(doc, tabId, clean), range: cfRange(doc, tabId, rangeText), order: old.order }))
}

function deleteCondFormat (doc, tabId, id) {
  return capture(doc, () => doc.getMap('cf:' + tabId).delete(id))
}

// Move a rule up (-1) or down (+1) the list by swapping with its neighbour.
function moveCondFormat (doc, tabId, id, dir) {
  const list = getCondFormats(doc, tabId)
  const i = list.findIndex((r) => r.id === id)
  const j = i + (dir < 0 ? -1 : 1)
  if (i < 0 || j < 0 || j >= list.length) return null
  const map = doc.getMap('cf:' + tabId)
  return capture(doc, () => {
    const a = map.get(list[i].id)
    const b = map.get(list[j].id)
    // Equal orders (two added at once) are spread out first.
    const oa = a.order === b.order ? b.order + (dir < 0 ? 0.5 : -0.5) : a.order
    map.set(list[i].id, { ...a, order: b.order })
    map.set(list[j].id, { ...b, order: oa })
  })
}

// The tab's rules in priority order, ranges as numbers. A rule whose range
// was deleted is left out.
function getCondFormats (doc, tabId) {
  const map = doc.getMap('cf:' + tabId)
  if (!map.size) return []
  const where = { tabId, tabs: tabsContext(doc) }
  const out = []
  for (const [id, v] of map.entries()) {
    if (!v || typeof v !== 'object') continue
    const range = refs.toDisplay(v.range || '', where)
    const box = require('./charts').parseRange(range)
    if (!box || box.sheet) continue
    const { range: _r, ...rule } = v
    if (typeof rule.formula === 'string') rule.formula = refs.toDisplay(rule.formula, where)
    out.push({ id, ...rule, range: oneCell(box) || range, r1: box.r1, c1: box.c1, r2: box.r2, c2: box.c2 })
  }
  return out.sort((a, b) => a.order - b.order || (a.id < b.id ? -1 : 1))
}

// Named ranges (proposals/2026-10-04-sheet-tools.md), in the root map
// names: upper-cased name -> { name, tab, range (stored like a formula
// reference on that tab) }. Formulas keep the name as typed; the engine
// looks it up when it computes.
const NAME_RE = /^[A-Za-z_\\][A-Za-z0-9_.\\]*$/
function checkName (name) {
  const n = String(name || '').trim()
  if (!n) throw new Error('Give the range a name')
  if (n.length > 255 || !NAME_RE.test(n)) throw new Error('A name starts with a letter or _ and has only letters, numbers, _ and .')
  if (/^[A-Za-z]{1,3}\d+$/.test(n) || /^R\d*C\d*$/i.test(n) || /^(TRUE|FALSE)$/i.test(n)) throw new Error('A name cannot look like a cell reference')
  return n
}

function setName (doc, name, tabId, rangeText) {
  const n = checkName(name)
  const box = require('./charts').parseRange(rangeText)
  if (!box || box.spill) throw new Error('Pick a range for the name')
  let tab = tabId
  if (box.sheet) {
    tab = tabIds(doc).find((id) => String(tabMap(doc, id).get('name')).toUpperCase() === box.sheet.toUpperCase())
    if (!tab) throw new Error('There is no tab called ' + box.sheet)
  }
  if (!tabIds(doc).includes(tab)) throw new Error('That tab is gone')
  return capture(doc, () => {
    makeCtx(doc, tab).extend(tab, box.r2, box.c2)
    const text = numToCol(box.c1) + box.r1 + (box.r1 === box.r2 && box.c1 === box.c2 ? '' : ':' + numToCol(box.c2) + box.r2)
    doc.getMap('names').set(n.toUpperCase(), { name: n, tab, range: refs.toStored(text, makeCtx(doc, tab)) })
  })
}

function deleteName (doc, name) {
  return capture(doc, () => { const k = String(name || '').trim().toUpperCase(); if (doc.getMap('names').has(k)) doc.getMap('names').delete(k) })
}

// A name in formula text (outside strings and stored references), not
// followed by "(" (a function) and not after "!" (a tab's name).
const NAME_TOKEN = /"(?:[^"]|"")*"|\{[^}]*\}|[A-Za-z_\\][A-Za-z0-9_.\\]*/g
function replaceNameIn (formula, from, to) {
  const want = from.toUpperCase()
  return formula.replace(NAME_TOKEN, (tok, at, all) => {
    if (tok[0] === '"' || tok[0] === '{' || tok.toUpperCase() !== want) return tok
    if (all[at - 1] === '!' || /^\s*\(/.test(all.slice(at + tok.length))) return tok
    return to
  })
}

// Rename a name, and every formula that uses it.
function renameName (doc, from, to) {
  const n = checkName(to)
  const map = doc.getMap('names')
  const old = map.get(String(from || '').trim().toUpperCase())
  if (!old) throw new Error('That name was deleted')
  if (n.toUpperCase() !== old.name.toUpperCase() && map.has(n.toUpperCase())) throw new Error('There is already a range called ' + n)
  return capture(doc, () => {
    map.delete(old.name.toUpperCase())
    map.set(n.toUpperCase(), { ...old, name: n })
    for (const tab of tabIds(doc)) {
      const cells = doc.getMap('tab:' + tab).get('cells')
      for (const [key, raw] of [...cells.entries()]) {
        if (typeof raw !== 'string' || raw[0] !== '=') continue
        const next = replaceNameIn(raw, old.name, n)
        if (next !== raw) cells.set(key, next)
      }
    }
  })
}

// Every name: [{ name, tabId, tab (its name), range, r1, c1, r2, c2 }],
// A to Z. A name whose tab or cells were deleted has range '#REF!'.
function getNames (doc) {
  const out = []
  const ctxTabs = tabsContext(doc)
  for (const v of doc.getMap('names').values()) {
    if (!v || typeof v !== 'object') continue
    const t = ctxTabs.find((x) => x.id === v.tab)
    const range = t ? refs.toDisplay(v.range || '', { tabId: v.tab, tabs: ctxTabs }) : '#REF!'
    const box = require('./charts').parseRange(range)
    const item = { name: v.name, tabId: v.tab, tab: t ? t.name : null, range: box ? range : '#REF!' }
    if (box && !box.sheet) Object.assign(item, { r1: box.r1, c1: box.c1, r2: box.r2, c2: box.c2 })
    else item.range = '#REF!'
    out.push(item)
  }
  return out.sort((a, b) => (a.name.toUpperCase() < b.name.toUpperCase() ? -1 : 1))
}

// Row heights (pixels at 100%), in the root map heights:<tabId> by row id.
// A row without one is the default height, or taller to fit wrapped or
// larger text on each device.
function setHeight (doc, tabId, row, px) {
  return capture(doc, () => {
    const rowId = tabMap(doc, tabId).get('rows').get(row - 1)
    if (!rowId) return
    const heights = doc.getMap('heights:' + tabId)
    if (px === null || px === undefined) { if (heights.has(rowId)) heights.delete(rowId); return }
    const h = Math.max(12, Math.min(600, Math.round(Number(px) || 0)))
    if (heights.get(rowId) !== h) heights.set(rowId, h)
  })
}

function getHeights (doc, tabId) {
  const rows = tabMap(doc, tabId).get('rows').toArray()
  const at = new Map(rows.map((id, i) => [id, i + 1]))
  const out = {}
  for (const [rowId, h] of doc.getMap('heights:' + tabId).entries()) if (at.has(rowId)) out[at.get(rowId)] = h
  return out
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
      for (const [r, c] of [...tab.cells, ...(tab.styles || []), ...(tab.comments || []).map((n) => [n.row, n.col])]) { if (r > maxR) maxR = r; if (c > maxC) maxC = c }
      ctx.extend(id, maxR + 20, Math.max(maxC + 2, DEFAULT_COLS))
      for (const [row, col, input, num] of tab.cells) {
        writeCell(doc, ctx, id, row, col, input)
        if (num) {
          const { rowId, colId } = idsAt(doc, id, row, col)
          t.get('fmt').set(cellKey(rowId, colId) + ':num', num)
        }
      }
      // Formats read from the file's styles (src/shared/xlsxStyles.js); a
      // value PearOffice does not allow is left out.
      for (const [row, col, f] of tab.styles || []) {
        const { rowId, colId } = idsAt(doc, id, row, col)
        if (!rowId || !colId) continue
        for (const [a, v] of Object.entries(f || {})) {
          if (a === 'num') continue
          try { checkFormat(a, v) } catch { continue }
          t.get('fmt').set(cellKey(rowId, colId) + ':' + a, v)
        }
      }
      for (const [row, px] of Object.entries(tab.heights || {})) {
        const rowId = t.get('rows').get(Number(row) - 1)
        if (rowId && px > 0) doc.getMap('heights:' + id).set(rowId, Math.max(12, Math.min(600, Math.round(px))))
      }
      // Charts read from the file (src/shared/xlsxChartsRead.js).
      for (const c of tab.charts || []) {
        const key = newId()
        const chart = new Y.Map()
        chartsMap(doc, id).set(key, chart)
        try { writeChart(doc, id, chart, c) } catch { chartsMap(doc, id).delete(key) }
      }
      // Imported rules keep the file's order: add from the last so the first ends on top.
      for (const r of [...(tab.condFormats || [])].reverse()) {
        try { addCondFormat(doc, id, r.range, r) } catch {}
      }
      for (const v of tab.validations || []) {
        try { setValidation(doc, id, v.range, v) } catch {}
      }
      for (const note of tab.comments || []) {
        try { addComment(doc, id, { row: note.row, col: note.col, author: String(note.author || 'xlsx:Imported'), text: note.text, at: 0 }) } catch {}
      }
      if (tab.hidden) {
        const map = doc.getMap('hidden:' + id)
        for (const r of tab.hidden.rows || []) { const rid = t.get('rows').get(r - 1); if (rid) map.set(rid, true) }
        for (const c of tab.hidden.cols || []) { const cid = t.get('cols').get(c - 1); if (cid) map.set(cid, true) }
      }
      if (tab.freeze && (tab.freeze.rows || tab.freeze.cols)) {
        ctx.extend(id, tab.freeze.rows || 0, tab.freeze.cols || 0)
        const v = doc.getMap('view:' + id)
        if (tab.freeze.rows) v.set('freezeRow', t.get('rows').get(tab.freeze.rows - 1))
        if (tab.freeze.cols) v.set('freezeCol', t.get('cols').get(tab.freeze.cols - 1))
      }
      for (const [r1, c1, r2, c2] of tab.merges || []) {
        ctx.extend(id, r2, c2)
        const rows = t.get('rows')
        const cols = t.get('cols')
        mergesMap(doc, id).set(cellKey(rows.get(r1 - 1), cols.get(c1 - 1)), { toRow: rows.get(r2 - 1), toCol: cols.get(c2 - 1) })
      }
      for (const [col, px] of Object.entries(tab.widths || {})) {
        const colId = t.get('cols').get(Number(col) - 1)
        if (colId) t.get('widths').set(colId, Math.max(24, Math.min(1000, Math.round(px))))
      }
    })
    // Named ranges from the file: { name, tab (index), range }.
    for (const n of payload.names || []) {
      try { if (ids[n.tab]) setName(doc, n.name, ids[n.tab], n.range) } catch {}
    }
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
    // Everything else kept per tab, as Excel copies it. A row or column id
    // of the original maps to the copy's at the same place.
    const newRow = (rowId) => (rowAt.has(rowId) ? newRows[rowAt.get(rowId)] : null)
    const newCol = (colId) => (colAt.has(colId) ? newCols[colAt.get(colId)] : null)
    for (const [rowId, px] of doc.getMap('heights:' + tabId).entries()) if (newRow(rowId)) doc.getMap('heights:' + id).set(newRow(rowId), px)
    for (const [lineId, v] of doc.getMap('hidden:' + tabId).entries()) { const to = newRow(lineId) || newCol(lineId); if (to) doc.getMap('hidden:' + id).set(to, v) }
    const view = doc.getMap('view:' + tabId)
    if (newRow(view.get('freezeRow'))) doc.getMap('view:' + id).set('freezeRow', newRow(view.get('freezeRow')))
    if (newCol(view.get('freezeCol'))) doc.getMap('view:' + id).set('freezeCol', newCol(view.get('freezeCol')))
    for (const [key, m] of mergesMap(doc, tabId).entries()) {
      const [rowId, colId] = key.split(':')
      if (newRow(rowId) && newCol(colId) && newRow(m.toRow) && newCol(m.toCol)) mergesMap(doc, id).set(cellKey(newRow(rowId), newCol(colId)), { toRow: newRow(m.toRow), toCol: newCol(m.toCol) })
    }
    // Ranges are copied in their A1 form, so ones on this tab point at the copy.
    for (const c of getCharts(doc, tabId)) {
      const chart = new Y.Map()
      chartsMap(doc, id).set(newId(), chart)
      const settings = {}
      for (const k of CHART_SETTINGS) if (c[k] !== undefined) settings[k] = c[k]
      writeChart(doc, id, chart, { ...settings, data: c.data, anchor: c.anchor, size: c.size })
    }
    for (const r of getCondFormats(doc, tabId)) {
      const { id: _i, range, r1, c1, r2, c2, ...rule } = r
      doc.getMap('cf:' + id).set(newId(), { ...cfStored(doc, id, rule), range: cfRange(doc, id, range) })
    }
    for (const r of getValidations(doc, tabId)) {
      const { id: _i, range, r1, c1, r2, c2, source, ...rule } = r
      const stored = { ...rule, range: cfRange(doc, id, range) }
      if (source) stored.source = refs.toStored(source, makeCtx(doc, id))
      doc.getMap('valid:' + id).set(newId(), stored)
    }
    const comments = doc.getMap('comments:' + tabId)
    const newIds = new Map()
    for (const [cid, v] of comments.entries()) if (!cid.includes(':')) newIds.set(cid, newId())
    for (const [cid, v] of comments.entries()) {
      if (cid.includes(':')) { const [root, flag] = cid.split(':'); if (newIds.has(root)) doc.getMap('comments:' + id).set(newIds.get(root) + ':' + flag, v); continue }
      if (!v || !newRow(v.row) || !newCol(v.col)) continue
      doc.getMap('comments:' + id).set(newIds.get(cid), { ...v, row: newRow(v.row), col: newCol(v.col), parent: v.parent ? newIds.get(v.parent) || null : null })
    }
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
  KINDS,
  kind,
  FORMAT_ATTRS,
  createDoc,
  applyUpdate,
  checkUpdate,
  encodeState,
  missingFrom,
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
  setHidden,
  getHidden,
  setName,
  deleteName,
  renameName,
  getNames,
  checkName,
  replaceNameIn,
  addCondFormat,
  setCondFormat,
  deleteCondFormat,
  moveCondFormat,
  getCondFormats,
  setValidation,
  getValidations,
  addComment,
  editComment,
  deleteComment,
  resolveComment,
  getComments,
  insertRows,
  insertCols,
  deleteRows,
  deleteCols,
  setWidth,
  setBorders,
  setFreeze,
  getFreeze,
  getMerges,
  mergeCells,
  unmergeCells,
  setHeight,
  getHeights,
  importTabs,
  sortRows,
  addChart,
  setChart,
  deleteChart,
  getCharts,
  fillRange,
  replaceInputs,
  addTab,
  renameTab,
  deleteTab,
  moveTab,
  duplicateTab
}
