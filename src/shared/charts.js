// Charts (proposals/2026-10-04-charts.md): what a chart's data range holds,
// turned into categories and named series, and a first guess at a chart for
// a selection. Pure functions, used by the worklet (sheet:view) and the
// .xlsx export.

const { colToNum } = require('./a1')

const TYPES = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'combo', 'radar', 'bubble', 'stock', 'histogram', 'waterfall']
// Settings a chart may have, besides its data range, anchor and size.
const SETTINGS = ['type', 'seriesIn', 'labels', 'title', 'xTitle', 'yTitle', 'legend', 'dataLabels', 'stacked', 'percent',
  'yMin', 'yMax', 'yFormat', 'logScale', 'lineSeries', 'secondAxis', 'trendline', 'binWidth', 'totals']
// Types whose first column (or row) holds x values, not category names.
const X_FIRST = ['scatter', 'bubble']

// "A1:C5", "B2", "A2#", "'My tab'!A1:B9" -> { sheet, r1, c1, r2, c2, spill }.
const RANGE = /^\s*(?:'((?:[^']|'')+)'!|([A-Za-z_][\w.]*)!)?\$?([A-Za-z]{1,3})\$?(\d+)(?::\$?([A-Za-z]{1,3})\$?(\d+)|(#))?\s*$/
function parseRange (text) {
  const m = RANGE.exec(String(text || ''))
  if (!m) return null
  const sheet = m[1] !== undefined ? m[1].replace(/''/g, "'") : m[2]
  const c1 = colToNum(m[3].toUpperCase())
  const r1 = Number(m[4])
  const c2 = m[5] ? colToNum(m[5].toUpperCase()) : c1
  const r2 = m[6] ? Number(m[6]) : r1
  return { sheet, r1: Math.min(r1, r2), c1: Math.min(c1, c2), r2: Math.max(r1, r2), c2: Math.max(c1, c2), spill: !!m[7] }
}

// The block a chart reads: rows of { num, text } (num null when the cell is
// not a number). cellAt(row, col) gives { value, error, display, spill }.
function rangeBlock (range, cellAt) {
  let { r1, c1, r2, c2 } = range
  if (range.spill) {
    const a = cellAt(r1, c1)
    if (!a || !a.spill) return null
    r2 = r1 + a.spill.rows - 1
    c2 = c1 + a.spill.cols - 1
  }
  const out = []
  for (let r = r1; r <= r2; r++) {
    const line = []
    for (let c = c1; c <= c2; c++) {
      const x = cellAt(r, c)
      const num = x && x.error === undefined && typeof x.value === 'number' ? x.value : null
      line.push({ num, text: x ? (x.display !== undefined ? x.display : x.value === null || x.value === undefined ? '' : String(x.value)) : '' })
    }
    out.push(line)
  }
  return out
}

// Categories and series from a block. With labels.row the first row names
// the series (or the categories, for series in rows); with labels.col the
// first column does the other. Scatter charts take the first column (or
// row) as x values.
function chartData (block, { seriesIn = 'columns', labels = {}, type } = {}) {
  if (!block || !block.length || !block[0].length) return { categories: [], series: [] }
  const grid = seriesIn === 'rows' ? block[0].map((_, c) => block.map((line) => line[c])) : block
  // Now series run down the columns of `grid`.
  const nameRow = seriesIn === 'rows' ? !!labels.col : !!labels.row
  const catCol = seriesIn === 'rows' ? !!labels.row : !!labels.col
  const body = nameRow ? grid.slice(1) : grid
  const firstSeries = catCol || X_FIRST.includes(type) ? 1 : 0
  const cols = grid[0].length
  const categories = body.map((line, i) => (X_FIRST.includes(type) ? line[0].num : catCol ? line[0].text : String(i + 1)))
  const series = []
  for (let c = firstSeries; c < cols; c++) {
    series.push({
      name: nameRow ? grid[0][c].text : 'Series ' + (c - firstSeries + 1),
      values: body.map((line) => line[c].num)
    })
  }
  return { categories, series }
}

// A first chart for a block of cells: names in the first row and column when
// they are text over numbers, series down the longer side.
function guessChart (block) {
  const rows = block.length
  const cols = rows ? block[0].length : 0
  const isText = (x) => x && x.num === null && x.text !== ''
  const row = cols > 1 && block[0].slice(1).every(isText) && block.slice(1).some((l) => l.some((x) => x.num !== null))
  const col = rows > 1 && block.slice(1).every((l) => isText(l[0])) && block.some((l) => l.slice(1).some((x) => x.num !== null))
  const labels = { row: row || (rows > 1 && cols > 1 && block[0].every((x) => x.num === null && x.text !== '')), col }
  const seriesIn = rows >= cols ? 'columns' : 'rows'
  return { type: 'column', seriesIn, labels }
}

// Histogram bins (proposals/2026-10-05-more-chart-types.md) for numbers:
// [{ from, to, count, label }]. Bins start at the smallest value and are
// binWidth wide, or as wide as Scott's rule gives (3.5 standard deviations
// over the cube root of the count, as Excel). The first bin includes its
// lower edge: [a, b], then (b, c] and so on.
function histogram (values, binWidth) {
  const xs = values.filter((v) => typeof v === 'number' && isFinite(v)).sort((a, b) => a - b)
  const n = xs.length
  if (!n) return []
  const min = xs[0]
  const max = xs[n - 1]
  let width = Number(binWidth) > 0 ? Number(binWidth) : 0
  if (!width) {
    const mean = xs.reduce((a, v) => a + v, 0) / n
    const sd = n > 1 ? Math.sqrt(xs.reduce((a, v) => a + (v - mean) * (v - mean), 0) / (n - 1)) : 0
    width = sd > 0 ? 3.5 * sd / Math.cbrt(n) : 1
  }
  const count = max > min ? Math.max(1, Math.ceil((max - min) / width)) : 1
  const bins = Array.from({ length: count }, (_, k) => ({ from: min + k * width, to: min + (k + 1) * width, count: 0 }))
  for (const x of xs) {
    const k = x === min ? 0 : Math.min(count - 1, Math.ceil((x - min) / width) - 1)
    bins[Math.max(0, k)].count++
  }
  // Edges shown to two decimals at most, as Excel shows them.
  const short = (v) => String(Number(v.toFixed(2)))
  return bins.map((b, k) => ({ ...b, label: (k ? '(' : '[') + short(b.from) + ', ' + short(b.to) + ']' }))
}

// Waterfall bars: each starts where the last ended. A point listed in totals
// is a total: its bar runs from zero to its value, and the running total
// becomes that value. [{ start, end, kind: 'up' | 'down' | 'total' }]
function waterfall (values, totals = []) {
  const marked = new Set(totals)
  let run = 0
  return values.map((v, i) => {
    const x = typeof v === 'number' && isFinite(v) ? v : 0
    if (marked.has(i)) { run = x; return { start: 0, end: x, kind: 'total' } }
    const start = run
    run += x
    return { start, end: run, kind: x < 0 ? 'down' : 'up' }
  })
}

module.exports = { TYPES, SETTINGS, X_FIRST, parseRange, rangeBlock, chartData, guessChart, histogram, waterfall }
