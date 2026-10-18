// Links in cells (proposals/2026-10-18-sheet-links.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const model = require('../src/sheet/sheetModel')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

test('web and email links are kept on every cell of the range', () => {
  const { doc, tab } = sheet()
  model.setLink(doc, tab, 1, 1, 2, 2, 'https://pears.com/')
  model.setLink(doc, tab, 3, 1, 3, 1, 'mailto:a@b.c')
  assert.equal(model.getFormat(doc, tab, 2, 2).link, 'https://pears.com/')
  assert.equal(model.getFormat(doc, tab, 3, 1).link, 'mailto:a@b.c')
  model.setLink(doc, tab, 1, 1, 1, 1, null)
  assert.equal(model.getFormat(doc, tab, 1, 1).link, undefined)
  assert.equal(model.getFormat(doc, tab, 1, 2).link, 'https://pears.com/')
})

test('other kinds of link and long ones are refused', () => {
  const { doc, tab } = sheet()
  for (const bad of ['javascript:alert(1)', 'file:///etc/passwd', 'ftp://x.y', 'https://a b', '#nope', 'https://x.y/' + 'a'.repeat(2048)]) {
    assert.throws(() => model.setLink(doc, tab, 1, 1, 1, 1, bad), /Links can go/, bad)
    assert.throws(() => model.setFormat(doc, tab, 1, 1, { link: bad }), /bad value/, bad)
  }
})

test('a link inside the file follows its cell through renames and inserts', () => {
  const { doc, tab } = sheet()
  const costs = model.addTab(doc, 'Costs').id
  model.setLink(doc, tab, 1, 1, 1, 1, { tabId: costs, row: 4, col: 2 })
  model.setLink(doc, tab, 2, 1, 2, 1, { tabId: costs })
  const link = model.getFormat(doc, tab, 1, 1).link
  assert.match(link, /^#[\w-]{11}![\w-]{11}:[\w-]{11}$/)
  assert.deepEqual(model.linkTarget(doc, link), { tabId: costs, name: 'Costs', row: 4, col: 2 })
  model.renameTab(doc, costs, 'Spending')
  model.insertRows(doc, costs, 1, 2)
  model.insertCols(doc, costs, 1)
  assert.deepEqual(model.linkTarget(doc, link), { tabId: costs, name: 'Spending', row: 6, col: 3 })
  assert.deepEqual(model.linkTarget(doc, model.getFormat(doc, tab, 2, 1).link), { tabId: costs, name: 'Spending', row: null, col: null })
  model.deleteRows(doc, costs, 6)
  assert.deepEqual(model.linkTarget(doc, link), { tabId: costs, name: 'Spending', row: null, col: null })
  model.deleteTab(doc, costs)
  assert.equal(model.linkTarget(doc, link), null)
  assert.equal(model.linkTarget(doc, 'https://pears.com/'), null)
})

test('a link past the end of a tab is refused', () => {
  const { doc, tab } = sheet()
  assert.throws(() => model.setLink(doc, tab, 1, 1, 1, 1, { tabId: tab, row: 5000, col: 1 }), /past the end/)
})

test('clearing a cell removes its link; sort and fill move it', () => {
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['b'], ['a']])
  model.setLink(doc, tab, 1, 1, 1, 1, 'https://b.example/')
  model.sortRows(doc, tab, 1, 1, 2, 1, [2, 1])
  assert.equal(model.getInput(doc, tab, 2, 1), 'b')
  assert.equal(model.getFormat(doc, tab, 2, 1).link, 'https://b.example/')
  assert.equal(model.getFormat(doc, tab, 1, 1).link, undefined)
  model.fillRange(doc, tab, { r1: 2, c1: 1, r2: 2, c2: 1 }, 'down', 1, 'copy')
  assert.equal(model.getFormat(doc, tab, 3, 1).link, 'https://b.example/')
  model.clearRange(doc, tab, 2, 1, 3, 1)
  assert.equal(model.getFormat(doc, tab, 2, 1).link, undefined)
  assert.equal(model.getFormat(doc, tab, 3, 1).link, undefined)
})

test('links go out to .xlsx and .ods and come back', () => {
  const XLSX = require('xlsx/dist/xlsx.mini.min.js')
  const fflate = require('fflate')
  const { workbookBytes, odsBytes, workbookToTabs } = require('../src/sheet/xlsxMap')
  const { doc, tab } = sheet()
  const other = model.addTab(doc, 'My tab').id
  model.setCells(doc, tab, 1, 1, [['web'], ['mail'], ['cell'], ['tab']])
  model.setLink(doc, tab, 1, 1, 1, 1, 'https://pears.com/a?b=1&c=2')
  model.setLink(doc, tab, 2, 1, 2, 1, 'mailto:a@b.c')
  model.setLink(doc, tab, 3, 1, 3, 1, { tabId: other, row: 4, col: 2 })
  model.setLink(doc, tab, 4, 1, 4, 1, { tabId: other })
  const order = model.tabIds(doc)
  const dump = {
    title: 'Links',
    tabs: order.map((id) => ({
      name: doc.getMap('tab:' + id).get('name'),
      cells: id !== tab ? [] : [1, 2, 3, 4].map((row) => {
        const fmt = model.getFormat(doc, tab, row, 1)
        const to = fmt.link[0] === '#' ? model.linkTarget(doc, fmt.link) : null
        return { row, col: 1, input: model.getInput(doc, tab, row, 1), value: model.getInput(doc, tab, row, 1), fmt, ...(to ? { linkTo: { tab: order.indexOf(to.tabId), row: to.row, col: to.col } } : { link: fmt.link }) }
      })
    }))
  }
  for (const bytes of [workbookBytes(XLSX, fflate, dump), odsBytes(XLSX, fflate, dump)]) {
    const wb = XLSX.read(bytes, { type: 'array' })
    const { tabs } = workbookToTabs(XLSX, wb)
    assert.deepEqual(tabs[0].links.sort((a, b) => a[0] - b[0]), [
      [1, 1, 'https://pears.com/a?b=1&c=2'],
      [2, 1, 'mailto:a@b.c'],
      [3, 1, { tab: 1, row: 4, col: 2 }],
      [4, 1, { tab: 1, row: 1, col: 1 }]
    ])
    const back = model.createDoc()
    model.importTabs(back, { tabs, names: [] })
    const [t0, t1] = model.tabIds(back)
    assert.equal(model.getFormat(back, t0, 1, 1).link, 'https://pears.com/a?b=1&c=2')
    assert.deepEqual(model.linkTarget(back, model.getFormat(back, t0, 3, 1).link), { tabId: t1, name: 'My tab', row: 4, col: 2 })
  }
})

test('imported links that are not allowed are dropped', () => {
  const back = model.createDoc()
  model.importTabs(back, { tabs: [{ name: 'S', cells: [[1, 1, 'x'], [2, 1, 'y'], [3, 1, 'z']], links: [[1, 1, 'javascript:alert(1)'], [2, 1, { tab: '__proto__', row: 1, col: 1 }], [3, 1, { tab: 7 }]] }], names: [] })
  const t = model.tabIds(back)[0]
  for (const row of [1, 2, 3]) assert.equal(model.getFormat(back, t, row, 1).link, undefined)
})

test('HYPERLINK shows its label and links only its own cell', () => {
  const { evaluateSheet } = require('../src/sheet/formula')
  const { doc, tab } = sheet()
  model.setCells(doc, tab, 1, 1, [['=HYPERLINK("https://pears.com", "Pears")'], ['=HYPERLINK("mailto:a@b.c")'], ['=A1'], ['=HYPERLINK(1/0, "x")']])
  const v = evaluateSheet(doc).get(tab)
  assert.deepEqual(v.get('1,1'), { value: 'Pears', link: 'https://pears.com' })
  assert.deepEqual(v.get('2,1'), { value: 'mailto:a@b.c', link: 'mailto:a@b.c' })
  assert.deepEqual(v.get('3,1'), { value: 'Pears' })
  assert.deepEqual(v.get('4,1'), { error: '#DIV/0!' })
})
