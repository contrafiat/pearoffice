// Charts (proposals/2026-10-04-charts.md): data ranges, series, the first
// guess, and chart settings shared between devices.

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/shared/sheetModel')
const { parseRange, chartData, guessChart, rangeBlock } = require('../src/shared/charts')

const cell = (v) => (typeof v === 'number' ? { num: v, text: String(v) } : { num: null, text: v })
const block = (rows) => rows.map((r) => r.map(cell))

test('data ranges', () => {
  assert.deepEqual(parseRange('B2:A5'), { sheet: undefined, r1: 2, c1: 1, r2: 5, c2: 2, spill: false })
  assert.deepEqual(parseRange("'My tab'!C3#"), { sheet: 'My tab', r1: 3, c1: 3, r2: 3, c2: 3, spill: true })
  assert.equal(parseRange('#REF!'), null)
  const spilled = rangeBlock(parseRange('A1#'), (r, c) => (r === 1 && c === 1 ? { value: 1, spill: { rows: 2, cols: 1 } } : { value: r }))
  assert.deepEqual(spilled.map((l) => l[0].num), [1, 2])
})

test('series from columns or rows, with names', () => {
  const b = block([['', 'Rent', 'Food'], ['Jan', 1200, 400], ['Feb', 1200, 450]])
  assert.deepEqual(chartData(b, { seriesIn: 'columns', labels: { row: true, col: true } }), {
    categories: ['Jan', 'Feb'],
    series: [{ name: 'Rent', values: [1200, 1200] }, { name: 'Food', values: [400, 450] }]
  })
  assert.deepEqual(chartData(b, { seriesIn: 'rows', labels: { row: true, col: true } }), {
    categories: ['Rent', 'Food'],
    series: [{ name: 'Jan', values: [1200, 400] }, { name: 'Feb', values: [1200, 450] }]
  })
  const xy = chartData(block([[1, 2], [2, 4], [3, 7]]), { type: 'scatter' })
  assert.deepEqual(xy.categories, [1, 2, 3], 'scatter takes x from the first column')
})

test('a first guess: names in the first row and column, series down the longer side', () => {
  assert.deepEqual(guessChart(block([['', 'Rent', 'Food'], ['Jan', 1200, 400], ['Feb', 1200, 450]])), { type: 'column', seriesIn: 'columns', labels: { row: true, col: true } })
  assert.deepEqual(guessChart(block([['Rent', 1200], ['Food', 450]])), { type: 'column', seriesIn: 'columns', labels: { row: false, col: true } })
  assert.equal(guessChart(block([[1, 2, 3, 4]])).seriesIn, 'rows')
})

test('two devices change different settings of one chart and both changes stay', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  const { id } = model.addChart(doc, tab, { data: 'A1:B3', anchor: { row: 1, col: 4 }, type: 'column' })
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.setChart(a, tab, id, { title: 'Spending' })
  model.setChart(b, tab, id, { type: 'line' })
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  for (const d of [a, b]) {
    const [c] = model.getCharts(d, tab)
    assert.equal(c.title, 'Spending')
    assert.equal(c.type, 'line')
  }
})

test('a chart follows inserted rows, and says when its data was deleted', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.addChart(doc, tab, { data: 'A2:B4', anchor: { row: 2, col: 4 } })
  model.insertRows(doc, tab, 1, 2)
  let [c] = model.getCharts(doc, tab)
  assert.equal(c.data, 'A4:B6')
  assert.deepEqual([c.anchor.row, c.anchor.col], [4, 4])
  model.deleteRows(doc, tab, 4, 3)
  ;[c] = model.getCharts(doc, tab)
  assert.match(c.data, /#REF!/)
  assert.throws(() => model.setChart(doc, tab, 'nope', { title: 'x' }), /deleted/)
})

test('series keep their cells\' number format', () => {
  const money = (v) => ({ num: v, text: '$' + v, fmt: '"$"#,##0.00' })
  const b = [[cell(''), cell('Rent'), cell('Count')], [cell('Jan'), money(1200), cell(3)], [cell('Feb'), money(1250), cell(4)]]
  const d = chartData(b, { seriesIn: 'columns', labels: { row: true, col: true } })
  assert.equal(d.series[0].format, '"$"#,##0.00')
  assert.equal(d.series[1].format, undefined, 'plain numbers have no format')
  const xy = chartData([[money(1), cell(2)], [money(2), cell(4)]], { type: 'scatter' })
  assert.equal(xy.xFormat, '"$"#,##0.00', 'scatter x values keep theirs')
  const block = rangeBlock(parseRange('A1:A1'), () => ({ value: 5, display: '$5.00', numFmt: '"$"#,##0.00' }))
  assert.equal(block[0][0].fmt, '"$"#,##0.00')
})
