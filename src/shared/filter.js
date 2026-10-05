// Filters (proposals/2026-10-04-freeze-filter.md). A filter belongs to the
// device that set it and is never stored in the sheet; these are the rules
// for which rows it hides. Pure functions over the view's cells (a Map
// "row,col" -> { display, num }).
//
// A filter: { r1, c1, c2, cols: { [col]: { values, cond } } }. r1 is the
// header row; the table runs down from it while rows have something in
// c1..c2. values: the shown values (display text, '' for blanks) or absent
// for all. cond: { op, a, b } or absent.

const OPS = ['eq', 'ne', 'contains', 'begins', 'ends', 'gt', 'lt', 'between', 'top']

const cellAt = (cells, r, c) => cells.get(r + ',' + c)
const shown = (x) => (x ? String(x.display) : '')

// The last row of the table under a header row: the run of rows below it
// that have something in the filter's columns.
function tableEnd (cells, filter, maxRows) {
  let r2 = filter.r1
  const filled = (r) => {
    for (let c = filter.c1; c <= filter.c2; c++) if (shown(cellAt(cells, r, c)) !== '') return true
    return false
  }
  while (r2 < maxRows && filled(r2 + 1)) r2++
  return r2
}

const toNum = (x, text) => {
  if (x && x.num !== undefined) return x.num
  const n = Number(String(text).trim())
  return String(text).trim() !== '' && Number.isFinite(n) ? n : null
}

// Does one cell pass a condition? top needs the column's cut-off (`least`).
function passes (x, cond, least) {
  const text = shown(x)
  const lower = text.toLowerCase()
  const a = cond.a === undefined || cond.a === null ? '' : String(cond.a)
  const al = a.toLowerCase()
  const n = toNum(x, text)
  const an = toNum(null, a)
  switch (cond.op) {
    case 'eq': return n !== null && an !== null ? n === an : lower === al
    case 'ne': return n !== null && an !== null ? n !== an : lower !== al
    case 'contains': return lower.includes(al)
    case 'begins': return lower.startsWith(al)
    case 'ends': return lower.endsWith(al)
    case 'gt': return n !== null && an !== null ? n > an : (text !== '' && lower > al)
    case 'lt': return n !== null && an !== null ? n < an : (text !== '' && lower < al)
    case 'between': {
      const bn = toNum(null, cond.b === undefined ? '' : cond.b)
      if (n === null || an === null || bn === null) return false
      return n >= Math.min(an, bn) && n <= Math.max(an, bn)
    }
    case 'top': return n !== null && least !== null && n >= least
    default: return true
  }
}

// Which rows of the table the filter hides. Returns { r2, hidden: Set of
// row numbers, total, showing } (total and showing count the data rows, not
// the header).
function filterRows (cells, filter, maxRows) {
  const r2 = tableEnd(cells, filter, maxRows)
  const hidden = new Set()
  const rules = []
  for (const [key, rule] of Object.entries(filter.cols || {})) {
    const col = Number(key)
    if (!rule || col < filter.c1 || col > filter.c2) continue
    const values = Array.isArray(rule.values) ? new Set(rule.values.map(String)) : null
    const cond = rule.cond && OPS.includes(rule.cond.op) ? rule.cond : null
    if (!values && !cond) continue
    // Top N: the Nth largest number in the column is the cut-off.
    let least = null
    if (cond && cond.op === 'top') {
      const nums = []
      for (let r = filter.r1 + 1; r <= r2; r++) { const x = cellAt(cells, r, col); const v = toNum(x, shown(x)); if (v !== null) nums.push(v) }
      nums.sort((p, q) => q - p)
      const k = Math.max(1, Math.floor(Number(cond.a) || 10))
      least = nums.length ? nums[Math.min(k, nums.length) - 1] : null
    }
    rules.push({ col, values, cond, least })
  }
  for (let r = filter.r1 + 1; r <= r2; r++) {
    for (const { col, values, cond, least } of rules) {
      const x = cellAt(cells, r, col)
      if ((values && !values.has(shown(x))) || (cond && !passes(x, cond, least))) { hidden.add(r); break }
    }
  }
  const total = r2 - filter.r1
  return { r2, hidden, total, showing: total - hidden.size }
}

// The distinct values in one column of the table, for its checklist:
// [{ value, count }], numbers in order, then text A to Z, blanks last.
function columnValues (cells, filter, col, maxRows) {
  const r2 = tableEnd(cells, filter, maxRows)
  const seen = new Map()
  for (let r = filter.r1 + 1; r <= r2; r++) {
    const x = cellAt(cells, r, col)
    const v = shown(x)
    if (!seen.has(v)) seen.set(v, { value: v, count: 0, num: v === '' ? null : toNum(x, v) })
    seen.get(v).count++
  }
  return [...seen.values()].sort((p, q) => {
    if ((p.value === '') !== (q.value === '')) return p.value === '' ? 1 : -1
    if ((p.num === null) !== (q.num === null)) return p.num === null ? 1 : -1
    if (p.num !== null) return p.num - q.num
    return p.value.localeCompare(q.value)
  }).map(({ value, count }) => ({ value, count }))
}

// Is a column filtered?
const isActive = (filter, col) => {
  const rule = filter && filter.cols && filter.cols[col]
  return !!(rule && (Array.isArray(rule.values) || (rule.cond && OPS.includes(rule.cond.op))))
}

module.exports = { OPS, tableEnd, filterRows, columnValues, isActive }
