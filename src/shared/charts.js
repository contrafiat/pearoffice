// Charts (proposals/2026-10-04-charts.md): what a chart's data range holds,
// turned into categories and named series, and a first guess at a chart for
// a selection. Pure functions, used by the worklet (sheet:view) and the
// .xlsx export.

const { colToNum } = require('./a1')

const TYPES = ['column', 'bar', 'line', 'area', 'pie', 'doughnut', 'scatter', 'combo']
// Settings a chart may have, besides its data range, anchor and size.
const SETTINGS = ['type', 'seriesIn', 'labels', 'title', 'xTitle', 'yTitle', 'legend', 'dataLabels', 'stacked', 'percent',
  'yMin', 'yMax', 'yFormat', 'logScale', 'lineSeries', 'secondAxis', 'trendline']

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
  const firstSeries = catCol || type === 'scatter' ? 1 : 0
  const cols = grid[0].length
  const categories = body.map((line, i) => (catCol ? line[0].text : type === 'scatter' ? line[0].num : String(i + 1)))
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

module.exports = { TYPES, SETTINGS, parseRange, rangeBlock, chartData, guessChart }
