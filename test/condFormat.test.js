// Colour rules, conditional formatting (proposals/2026-10-04-sheet-tools.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const Y = require('yjs')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { evaluate, normalize, inPeriod } = require('../src/sheet/condFormat')
const { workbookBytes, condFormatsFromXlsx } = require('../src/sheet/xlsxMap')

// Column A: rows 1..n holding the given values ('' leaves a blank).
function column (values) {
  const cells = new Map()
  values.forEach((v, i) => {
    if (v === '') return
    const cell = typeof v === 'number' ? { row: i + 1, col: 1, kind: 'number', num: v, display: String(v) } : { row: i + 1, col: 1, kind: 'text', display: v }
    cells.set(i + 1 + ',1', cell)
  })
  return cells
}
const RED = { fill: '#ffc7ce' }
const rows = (rule, values, today = 46000) => {
  const r = { ...normalize({ style: RED, ...rule }), r1: 1, c1: 1, r2: values.length, c2: 1 }
  return [...evaluate([r], column(values), today).keys()].map((k) => Number(k.split(',')[0])).sort((a, b) => a - b)
}

test('each kind of rule', () => {
  const nums = [5, 10, 15, 20, 'x', '']
  assert.deepEqual(rows({ kind: 'gt', a: 10 }, nums), [3, 4, 5], 'text sorts after numbers, as in Excel')
  assert.deepEqual(rows({ kind: 'lt', a: 10 }, nums), [1])
  assert.deepEqual(rows({ kind: 'eq', a: 15 }, nums), [3])
  assert.deepEqual(rows({ kind: 'eq', a: 'X' }, nums), [5], 'text ignores case')
  assert.deepEqual(rows({ kind: 'between', a: 20, b: 10 }, nums), [2, 3, 4])
  const words = ['apple', 'Banana', 'grape', '']
  assert.deepEqual(rows({ kind: 'text', op: 'contains', text: 'AP' }, words), [1, 3])
  assert.deepEqual(rows({ kind: 'text', op: 'notContains', text: 'ap' }, words), [2, 4])
  assert.deepEqual(rows({ kind: 'text', op: 'begins', text: 'b' }, words), [2])
  assert.deepEqual(rows({ kind: 'text', op: 'ends', text: 'E' }, words), [1, 3])
  assert.deepEqual(rows({ kind: 'dup' }, ['a', 'A', 'b', '', 'c', 'c']), [1, 2, 5, 6])
  assert.deepEqual(rows({ kind: 'unique' }, ['a', 'A', 'b', '', 'c']), [3, 5])
  assert.deepEqual(rows({ kind: 'top', n: 2 }, [1, 9, 5, 9, 3]), [2, 4], 'ties are all in')
  assert.deepEqual(rows({ kind: 'top', n: 2 }, [1, 8, 5, 9, 3]), [2, 4])
  assert.deepEqual(rows({ kind: 'bottom', n: 40, percent: true }, [1, 8, 5, 9, 3]), [1, 5])
  assert.deepEqual(rows({ kind: 'above' }, [1, 2, 3, 10]), [4])
  assert.deepEqual(rows({ kind: 'below' }, [1, 2, 3, 10]), [1, 2, 3])
  assert.deepEqual(rows({ kind: 'blank' }, [1, '', 'x', '']), [2, 4])
  assert.deepEqual(rows({ kind: 'notBlank' }, [1, '', 'x', '']), [1, 3])
  assert.throws(() => normalize({ kind: 'gt', a: '', style: RED }), /Enter a value/)
  assert.throws(() => normalize({ kind: 'gt', a: 1, style: {} }), /how matching cells look/)
})

test('dates: today, weeks from Sunday, months', () => {
  const today = 46026 // 2026-01-04, a Sunday
  assert.ok(inPeriod('today', today + 0.75, today))
  assert.ok(inPeriod('yesterday', today - 1, today) && inPeriod('tomorrow', today + 1, today))
  assert.ok(inPeriod('last7', today - 6, today) && !inPeriod('last7', today - 7, today))
  assert.ok(inPeriod('thisWeek', today + 6, today) && !inPeriod('thisWeek', today - 1, today))
  assert.ok(inPeriod('lastWeek', today - 1, today) && inPeriod('nextWeek', today + 7, today))
  assert.ok(inPeriod('lastMonth', 46021, today), 'Dec 30 is last month')
  assert.ok(inPeriod('thisMonth', 46053, today) && inPeriod('nextMonth', 46054, today), 'Jan 31, Feb 1')
})

test('the rule higher in the list wins, attribute by attribute', () => {
  const cells = column([3, 8, 10])
  const all = { r1: 1, c1: 1, r2: 3, c2: 1 }
  const out = evaluate([
    { ...all, ...normalize({ kind: 'gt', a: 5, style: { fill: '#ffc7ce', color: '#9c0006' } }) },
    { ...all, ...normalize({ kind: 'top', n: 1, style: { fill: '#c6efce', b: true } }) }
  ], cells, 46000)
  assert.deepEqual(out.get('3,1'), { fill: '#ffc7ce', color: '#9c0006', b: true })
  assert.deepEqual(out.get('2,1'), { fill: '#ffc7ce', color: '#9c0006' })
  assert.equal(out.get('1,1'), undefined)
})

test('colour scales and data bars', () => {
  const cells = column([0, 50, 100])
  const all = { r1: 1, c1: 1, r2: 3, c2: 1 }
  const scale = evaluate([{ ...all, ...normalize({ kind: 'scale', colors: ['#ff0000', '#ffffff', '#0000ff'] }) }], cells, 0)
  assert.deepEqual([1, 2, 3].map((r) => scale.get(r + ',1').fill), ['#ff0000', '#ffffff', '#0000ff'])
  const bars = evaluate([{ ...all, ...normalize({ kind: 'bar', color: '#638ec6' }) }], column([-50, 0, 150]), 0)
  assert.deepEqual(bars.get('1,1').bar, { from: 0, to: 0.25, color: '#638ec6' })
  assert.deepEqual(bars.get('3,1').bar, { from: 0.25, to: 1, color: '#638ec6' })
})

test('rules: new on top, move, follow inserts, two people at once', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  const a = model.addCondFormat(doc, tab, 'A1:A5', { kind: 'gt', a: 5, style: RED }).id
  model.addCondFormat(doc, tab, 'B1:B5', { kind: 'dup', style: RED })
  assert.deepEqual(model.getCondFormats(doc, tab).map((r) => r.kind), ['dup', 'gt'])
  model.moveCondFormat(doc, tab, a, -1)
  assert.deepEqual(model.getCondFormats(doc, tab).map((r) => r.kind), ['gt', 'dup'])
  model.insertRows(doc, tab, 1, 1)
  assert.deepEqual(model.getCondFormats(doc, tab).map((r) => r.range), ['A2:A6', 'B2:B6'])
  model.setCondFormat(doc, tab, a, 'A2:A3', { kind: 'lt', a: 1, style: RED })
  assert.deepEqual(model.getCondFormats(doc, tab).map((r) => r.kind + ' ' + r.range), ['lt A2:A3', 'dup B2:B6'], 'a change keeps its place')
  const x = new Y.Doc()
  const y = new Y.Doc()
  Y.applyUpdate(x, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(y, Y.encodeStateAsUpdate(doc))
  model.addCondFormat(x, tab, 'C1', { kind: 'blank', style: RED })
  model.addCondFormat(y, tab, 'D1', { kind: 'notBlank', style: RED })
  Y.applyUpdate(x, Y.encodeStateAsUpdate(y))
  Y.applyUpdate(y, Y.encodeStateAsUpdate(x))
  assert.deepEqual(model.getCondFormats(x, tab), model.getCondFormats(y, tab))
  assert.equal(model.getCondFormats(x, tab).length, 4)
  model.deleteRows(doc, tab, 2, 2)
  assert.deepEqual(model.getCondFormats(doc, tab).map((r) => r.kind + ' ' + r.range), ['dup B2:B4'], 'a deleted range takes its rule with it; one cut at the top shrinks')
})

const RULES = [
  { range: 'A1:A9', kind: 'gt', a: '5', style: { fill: '#ffc7ce', color: '#9c0006' } },
  { range: 'B1:B9', kind: 'text', op: 'contains', text: 'x"y', style: { b: true } },
  { range: 'C1:C9', kind: 'date', period: 'thisWeek', style: { fill: '#c6efce', color: '#006100' } },
  { range: 'D1:D9', kind: 'top', n: 10, percent: true, style: { s: true, color: '#808080' } },
  { range: 'E1:E9', kind: 'scale', colors: ['#63be7b', '#ffeb84', '#f8696b'] },
  { range: 'F1:F9', kind: 'bar', color: '#638ec6' },
  { range: 'G1:G9', kind: 'between', a: 1, b: 5, style: { i: true } },
  { range: 'H1:H9', kind: 'below', style: { fill: '#ffc7ce', color: '#9c0006' } },
  { range: 'I1:I9', kind: 'blank', style: { fill: '#ffeb9c' } },
  { range: 'J1:J9', kind: 'eq', a: 'done', style: { b: true } }
]

test('rules go out to .xlsx and come back, in order', () => {
  const bytes = workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }], widths: {}, condFormats: RULES, validations: [{ range: 'K1', kind: 'list', items: ['a'], onBad: 'stop' }] }] })
  const xml = fflate.strFromU8(fflate.unzipSync(bytes)['xl/worksheets/sheet1.xml'])
  assert.ok(xml.indexOf('<conditionalFormatting') < xml.indexOf('<dataValidations'), 'Excel wants colour rules before validation')
  assert.deepEqual(condFormatsFromXlsx(bytes, fflate)[0], RULES)
})

test('a file saved by LibreOffice', () => {
  const back = condFormatsFromXlsx(fs.readFileSync(path.join(__dirname, 'fixtures/libreoffice-colour-rules.xlsx')), fflate)[0]
  assert.deepEqual(back.map((r) => r.kind), ['gt', 'text', 'date', 'top', 'scale', 'bar', 'between', 'below', 'blank', 'eq', 'dup'])
  assert.deepEqual(back[0].style, { fill: '#ffc7ce', color: '#9c0006' })
})

test('deleting the first row of a range shrinks colour rules, validation and charts, as formulas', () => {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.addCondFormat(doc, tab, 'B1:B5', { kind: 'dup', style: RED })
  model.setValidation(doc, tab, 'C1:C5', { kind: 'list', source: 'D1:D4' })
  model.addChart(doc, tab, { data: 'E1:F5' })
  model.deleteRows(doc, tab, 1, 1)
  assert.equal(model.getCondFormats(doc, tab)[0].range, 'B1:B4')
  assert.equal(model.getValidations(doc, tab)[0].range, 'C1:C4')
  assert.equal(model.getValidations(doc, tab)[0].source, 'D1:D3')
  assert.equal(model.getCharts(doc, tab)[0].data, 'E1:F4')
})
