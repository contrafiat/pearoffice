// Formula evaluation over a sheet. A pure function of the merged cells: no
// clock reads except the volatile functions (NOW, TODAY, RAND, RANDBETWEEN),
// which are device-local by design.
//
// evaluateSheet(doc) computes every non-empty cell on every tab with one
// shared memo, so cross-tab references resolve once. Cells are evaluated on
// demand with cycle detection, so the result never depends on visiting order.

const FormulaParser = require('./vendor/fast-formula-parser')
const FormulaError = require('./vendor/fast-formula-parser/formulas/error')
const { installDeterministicMath } = require('./detmath')
const { fillFunctions } = require('./fills')
const refs = require('../refs')
const model = require('../sheetModel')

installDeterministicMath()

const CIRCULAR = '#CIRCULAR!'
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN|RANDARRAY)\s*\(/i
const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i

// What a typed, non-formula cell means.
function literal (raw) {
  if (raw === undefined || raw === null || raw === '') return null
  if (raw[0] === "'") return raw.slice(1) // leading apostrophe forces text
  const t = raw.trim()
  if (NUMBER.test(t)) return Number(t)
  const up = t.toUpperCase()
  if (up === 'TRUE') return true
  if (up === 'FALSE') return false
  return raw
}

function errorCode (err) {
  if (err instanceof FormulaError) return err.error
  if (err && typeof err.error === 'string') return err.error
  return '#ERROR!'
}

// Spilling (proposals/2026-10-04-spilling-formulas.md). A formula whose
// result is an array of more than one value is an anchor; its values fill the
// block below and to the right, unless:
//   1. a cell in the block, other than the anchor, has something typed in it;
//   2. an earlier anchor in reading order already spills over part of it;
//   3. the block goes past the tab's last row or column;
//   4. the block is larger than MAX_SPILL cells.
// A blocked anchor shows #SPILL!. These depend only on the merged cells.
const SPILL = '#SPILL!'
const MAX_SPILL = 100000

// Thrown to stop evaluating a formula only to see whether it spills, when that
// formula turns out to depend on a cell that is itself still being evaluated.
// The candidate is then treated as unknown (see `skipped`).
class ProbeAbort extends Error {}

function isBlock (v) {
  return Array.isArray(v) && Array.isArray(v[0])
}

function evaluateSheet (doc) {
  const tabs = model.tabsContext(doc)
  const index = refs.indexTabs(tabs)
  const memo = new Map() // cell key -> value as formulas see it
  const results = new Map() // formula cell key -> its raw result (value or block)
  const spills = new Map() // anchor key -> { rows, cols } | { blocked } | null
  const visiting = new Map() // formula cell key -> depth, while it is evaluated
  const deciding = new Set() // anchor keys whose spill is being worked out
  const skipped = new Map() // anchor key -> cell keys looked up while it was in progress
  const probes = [] // depth at which each active probe started
  let depth = 0

  const keyOf = (tab, row, col) => tab.id + '|' + row + ',' + col

  function rawAt (tab, row, col) {
    const rowId = tab.rows[row - 1]
    const colId = tab.cols[col - 1]
    if (!rowId || !colId) return undefined
    return doc.getMap('tab:' + tab.id).get('cells').get(rowId + ':' + colId)
  }

  const isFormula = (raw) => typeof raw === 'string' && raw[0] === '='
  const hasInput = (raw) => raw !== undefined && raw !== null && raw !== ''

  // Each tab's formula cells in reading order: the cells that can spill.
  const formulaCellsByTab = new Map()
  function formulaCells (tab) {
    if (formulaCellsByTab.has(tab.id)) return formulaCellsByTab.get(tab.id)
    const list = []
    for (const [key, raw] of doc.getMap('tab:' + tab.id).get('cells').entries()) {
      if (!isFormula(raw)) continue
      const [rowId, colId] = key.split(':')
      const row = tab.rowIndex.get(rowId)
      const col = tab.colIndex.get(colId)
      if (row !== undefined && col !== undefined) list.push({ row, col })
    }
    list.sort((a, b) => a.row - b.row || a.col - b.col)
    formulaCellsByTab.set(tab.id, list)
    return list
  }

  function normal (v) {
    if (v === undefined) return null
    if (v instanceof Date) return v.getTime()
    return v
  }

  // The raw result of a formula cell: a value, a FormulaError or a block.
  function resultOf (tab, row, col) {
    const key = keyOf(tab, row, col)
    if (results.has(key)) return results.get(key)
    if (visiting.has(key)) {
      // Asked again while it is being evaluated. Inside a probe that started
      // above this cell, stop the probe; otherwise it is a real cycle.
      if (probes.length && visiting.get(key) < probes[probes.length - 1]) throw new ProbeAbort()
      return new FormulaError(CIRCULAR)
    }
    visiting.set(key, depth++)
    let v
    try {
      const raw = rawAt(tab, row, col)
      const text = refs.toDisplay(raw.slice(1), { tabId: tab.id, tabs }, index)
      const parser = parserFor(tab)
      parseDepth++
      try {
        v = parser.parse(text, { row, col, sheet: tab.name }, true)
      } finally {
        parseDepth--
      }
      if (v === undefined) v = null
      if (isBlock(v)) {
        if (v.length === 1 && v[0].length === 1) v = v[0][0] === undefined ? null : v[0][0]
        else if (!v.length || !v[0].length) v = null
        // A spilled block shows empty cells as 0, as in Excel.
        else v = v.map((line) => line.map((x) => (x === null || x === undefined ? 0 : x)))
      }
    } catch (err) {
      if (err instanceof ProbeAbort || (err && err.details instanceof ProbeAbort)) {
        visiting.delete(key)
        depth--
        throw err instanceof ProbeAbort ? err : err.details
      }
      v = new FormulaError(errorCode(err))
    }
    visiting.delete(key)
    depth--
    results.set(key, v)
    return v
  }

  // Run fn, or return ABORTED if it hit a cell still being evaluated by a
  // caller outside the probe.
  const ABORTED = {}
  function probe (fn) {
    probes.push(depth)
    try {
      return fn()
    } catch (err) {
      if (err instanceof ProbeAbort) return ABORTED
      throw err
    } finally {
      probes.pop()
    }
  }

  function noteSkip (anchorKey, cellKey) {
    if (!skipped.has(anchorKey)) skipped.set(anchorKey, new Set())
    skipped.get(anchorKey).add(cellKey)
  }

  // How an anchor spills: { rows, cols }, { blocked: reason }, or null when
  // its result is not a block.
  function spillOf (tab, row, col) {
    const key = keyOf(tab, row, col)
    if (spills.has(key)) return spills.get(key)
    const res = resultOf(tab, row, col)
    if (!isBlock(res)) { spills.set(key, null); return null }
    if (deciding.has(key)) return { blocked: { kind: 'circular' } }
    deciding.add(key)
    const rows = res.length
    const cols = Math.max(...res.map((line) => line.length))
    let state = { rows, cols }
    try {
      if (row + rows - 1 > tab.rows.length || col + cols - 1 > tab.cols.length) {
        state = { blocked: { kind: 'edge', rows: Math.max(0, row + rows - 1 - tab.rows.length), cols: Math.max(0, col + cols - 1 - tab.cols.length) } }
      } else if (rows * cols > MAX_SPILL) {
        state = { blocked: { kind: 'size' } }
      } else {
        const inWay = []
        for (let r = row; r < row + rows; r++) {
          for (let c = col; c < col + cols; c++) {
            if ((r !== row || c !== col) && hasInput(rawAt(tab, r, c))) inWay.push([r, c])
          }
        }
        if (inWay.length) state = { blocked: { kind: 'cells', cells: inWay.slice(0, 5), more: Math.max(0, inWay.length - 5) } }
        else {
          // An earlier anchor whose spill reaches into this block wins.
          for (const e of formulaCells(tab)) {
            if (e.row > row + rows - 1) break
            if (e.row > row || (e.row === row && e.col >= col)) continue
            if (e.col > col + cols - 1) continue
            const ekey = keyOf(tab, e.row, e.col)
            if (visiting.has(ekey) || deciding.has(ekey)) { state = { blocked: { kind: 'circular' } }; break }
            const eres = resultOf(tab, e.row, e.col)
            if (!isBlock(eres)) continue
            const eRows = eres.length
            const eCols = Math.max(...eres.map((line) => line.length))
            if (e.row + eRows - 1 < row || e.col + eCols - 1 < col) continue
            const es = spillOf(tab, e.row, e.col)
            if (es && !es.blocked) { state = { blocked: { kind: 'overlap', anchor: [e.row, e.col] } }; break }
          }
        }
      }
      // It covers a cell that was looked up (and settled) while it was still
      // being evaluated: its value depends on its own spill.
      if (!state.blocked && skipped.has(key)) {
        for (const ck of skipped.get(key)) {
          if (!memo.has(ck)) continue
          const [r, c] = ck.slice(ck.indexOf('|') + 1).split(',').map(Number)
          if (r >= row && r < row + rows && c >= col && c < col + cols) { state = { blocked: { kind: 'circular' } }; break }
        }
      }
    } finally {
      deciding.delete(key)
    }
    spills.set(key, state)
    return state
  }

  // The anchor whose spill covers an empty cell, if any.
  function coverOf (tab, row, col, cellKey) {
    for (const cand of formulaCells(tab)) {
      if (cand.row > row) break
      if (cand.col > col) continue
      const ckey = keyOf(tab, cand.row, cand.col)
      if (visiting.has(ckey) || deciding.has(ckey)) { noteSkip(ckey, cellKey); continue }
      const res = probe(() => resultOf(tab, cand.row, cand.col))
      if (res === ABORTED) { noteSkip(ckey, cellKey); continue }
      if (!isBlock(res)) continue
      if (row - cand.row >= res.length || col - cand.col >= Math.max(...res.map((line) => line.length))) continue
      const st = probe(() => spillOf(tab, cand.row, cand.col))
      if (st === ABORTED) { noteSkip(ckey, cellKey); continue }
      if (st && !st.blocked) return { anchor: cand, block: res }
    }
    return null
  }

  // Value of a cell as formulas see it: number, string, boolean, null or a
  // FormulaError.
  function valueAt (tab, row, col) {
    const key = keyOf(tab, row, col)
    if (memo.has(key)) return memo.get(key)
    const raw = rawAt(tab, row, col)
    let v
    if (isFormula(raw)) {
      const res = resultOf(tab, row, col)
      if (isBlock(res)) {
        const st = spillOf(tab, row, col)
        if (st && st.blocked) v = new FormulaError(st.blocked.kind === 'circular' ? CIRCULAR : SPILL)
        else v = normal(res[0][0])
      } else v = normal(res)
    } else if (hasInput(raw)) {
      v = literal(raw)
    } else {
      const cover = coverOf(tab, row, col, key)
      v = cover ? normal(cover.block[row - cover.anchor.row][col - cover.anchor.col]) : null
    }
    // A cell read again while it is still being evaluated gets a cycle error
    // for that reader only; its own value is settled when it finishes.
    if (!visiting.has(key)) memo.set(key, v)
    return v
  }

  function tabByName (name) {
    return index.byName.get(String(name).toUpperCase()) || null
  }

  // One parser per tab and nesting level: evaluating a formula can start
  // another (a referenced cell, or a probe), and a parser cannot be reused
  // while it is in the middle of a formula, least of all after a probe stops
  // part way through.
  const parsers = new Map()
  let parseDepth = 0
  function parserFor (tab) {
    const pkey = tab.id + ':' + parseDepth
    if (parsers.has(pkey)) return parsers.get(pkey)
    const p = new FormulaParser({
      functions: fillFunctions(),
      onCell: ({ sheet, row, col }) => {
        const t = sheet ? tabByName(sheet) : tab
        if (!t) throw FormulaError.REF
        return valueAt(t, row, col)
      },
      onRange: (ref) => {
        const t = ref.sheet ? tabByName(ref.sheet) : tab
        if (!t) throw FormulaError.REF
        // Whole-column and whole-row ranges come in as up to the parser's max;
        // clamp to what the tab actually has.
        const toRow = Math.min(ref.to.row, t.rows.length)
        const toCol = Math.min(ref.to.col, t.cols.length)
        const out = []
        for (let r = ref.from.row; r <= toRow; r++) {
          const line = []
          for (let c = ref.from.col; c <= toCol; c++) line.push(valueAt(t, r, c))
          out.push(line)
        }
        return out
      }
    })
    parsers.set(pkey, p)
    return p
  }

  // Result: per tab, "row,col" -> { value } or { error }, for every non-empty
  // cell and every cell a spill fills. Anchors carry `spill: { rows, cols }`
  // or, when blocked, `blocked`; filled cells carry `from: [row, col]`.
  // Cells are evaluated in reading order (tab, row, column), so a cycle comes
  // out the same on every device.
  const toCell = (v) => (v instanceof FormulaError ? { error: v.error } : { value: normal(v) })
  const result = new Map()
  for (const tab of index.byId.values()) {
    const cells = doc.getMap('tab:' + tab.id).get('cells')
    const order = []
    for (const [key, raw] of cells.entries()) {
      const [rowId, colId] = key.split(':')
      const row = tab.rowIndex.get(rowId)
      const col = tab.colIndex.get(colId)
      if (row === undefined || col === undefined) continue // orphan from a concurrent delete
      order.push({ row, col, raw })
    }
    order.sort((a, b) => a.row - b.row || a.col - b.col)
    const out = new Map()
    for (const { row, col, raw } of order) {
      const cell = toCell(valueAt(tab, row, col))
      if (isFormula(raw)) {
        if (VOLATILE.test(raw)) cell.volatile = true
        const st = spills.get(keyOf(tab, row, col))
        if (st && st.blocked) cell.blocked = st.blocked
        else if (st) cell.spill = { rows: st.rows, cols: st.cols }
      }
      out.set(row + ',' + col, cell)
    }
    for (const { row, col, raw } of order) {
      if (!isFormula(raw)) continue
      const st = spills.get(keyOf(tab, row, col))
      if (!st || st.blocked) continue
      const block = results.get(keyOf(tab, row, col))
      for (let r = 0; r < st.rows; r++) {
        for (let c = 0; c < st.cols; c++) {
          if (r === 0 && c === 0) continue
          const v = block[r] && block[r][c]
          const cell = toCell(v === undefined ? FormulaError.NA : v)
          cell.from = [row, col]
          out.set((row + r) + ',' + (col + c), cell)
        }
      }
    }
    result.set(tab.id, out)
  }
  return result
}

// Numbers are shown rounded to 15 significant digits, as Excel does.
function displayNumber (n) {
  if (!Number.isFinite(n)) return String(n)
  return String(Number(n.toPrecision(15)))
}

module.exports = { evaluateSheet, displayNumber, literal, CIRCULAR, SPILL }
