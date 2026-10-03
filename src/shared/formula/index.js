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
const VOLATILE = /\b(NOW|TODAY|RAND|RANDBETWEEN)\s*\(/i
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

function evaluateSheet (doc) {
  const tabs = model.tabsContext(doc)
  const index = refs.indexTabs(tabs)
  const memo = new Map()
  const visiting = new Set()

  function rawAt (tab, row, col) {
    const rowId = tab.rows[row - 1]
    const colId = tab.cols[col - 1]
    if (!rowId || !colId) return undefined
    return doc.getMap('tab:' + tab.id).get('cells').get(rowId + ':' + colId)
  }

  // Value of a cell as formulas see it: number, string, boolean, null or a
  // FormulaError.
  function valueAt (tab, row, col) {
    const key = tab.id + '|' + row + ',' + col
    if (memo.has(key)) return memo.get(key)
    const raw = rawAt(tab, row, col)
    if (typeof raw !== 'string' || raw[0] !== '=') {
      const v = literal(raw)
      memo.set(key, v)
      return v
    }
    if (visiting.has(key)) return new FormulaError(CIRCULAR)
    visiting.add(key)
    let v
    try {
      const text = refs.toDisplay(raw.slice(1), { tabId: tab.id, tabs }, index)
      v = parserFor(tab).parse(text, { row, col, sheet: tab.name })
      if (Array.isArray(v)) v = v[0] && v[0][0] !== undefined ? v[0][0] : null // no array spill in v1
      if (v === undefined) v = null
    } catch (err) {
      v = new FormulaError(errorCode(err))
    }
    visiting.delete(key)
    memo.set(key, v)
    return v
  }

  function tabByName (name) {
    return index.byName.get(String(name).toUpperCase()) || null
  }

  const parsers = new Map()
  function parserFor (tab) {
    if (parsers.has(tab.id)) return parsers.get(tab.id)
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
    parsers.set(tab.id, p)
    return p
  }

  // Result: per tab, "row,col" -> { value } or { error }, plus whether it is
  // volatile, for every non-empty cell.
  const result = new Map()
  for (const tab of index.byId.values()) {
    const cells = doc.getMap('tab:' + tab.id).get('cells')
    const out = new Map()
    for (const [key, raw] of cells.entries()) {
      const [rowId, colId] = key.split(':')
      const row = tab.rowIndex.get(rowId)
      const col = tab.colIndex.get(colId)
      if (row === undefined || col === undefined) continue // orphan from a concurrent delete
      const v = valueAt(tab, row, col)
      const cell = v instanceof FormulaError ? { error: v.error } : { value: v instanceof Date ? v.getTime() : v }
      if (typeof raw === 'string' && raw[0] === '=' && VOLATILE.test(raw)) cell.volatile = true
      out.set(row + ',' + col, cell)
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

module.exports = { evaluateSheet, displayNumber, literal, CIRCULAR }
