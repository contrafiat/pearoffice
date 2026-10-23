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

test('a link to a block keeps its corners; a link to a name follows a rename', () => {
  const { doc, tab } = sheet()
  const costs = model.addTab(doc, 'Costs').id
  model.setLink(doc, tab, 1, 1, 1, 1, { tabId: costs, row: 4, col: 2, row2: 9, col2: 4 })
  const block = model.getFormat(doc, tab, 1, 1).link
  assert.deepEqual(model.linkTarget(doc, block), { tabId: costs, name: 'Costs', row: 4, col: 2, row2: 9, col2: 4 })
  model.insertRows(doc, costs, 1)
  assert.deepEqual(model.linkTarget(doc, block), { tabId: costs, name: 'Costs', row: 5, col: 2, row2: 10, col2: 4 })
  // The far corner deleted: the link keeps its first cell.
  model.deleteRows(doc, costs, 10)
  assert.deepEqual(model.linkTarget(doc, block), { tabId: costs, name: 'Costs', row: 5, col: 2 })

  model.setName(doc, 'Totals', costs, 'B2:C3')
  model.setLink(doc, tab, 2, 1, 2, 1, { name: 'totals' })
  assert.equal(model.getFormat(doc, tab, 2, 1).link, '#=Totals')
  assert.deepEqual(model.linkTarget(doc, '#=Totals'), { tabId: costs, name: 'Costs', row: 2, col: 2, row2: 3, col2: 3, rangeName: 'Totals' })
  model.renameName(doc, 'Totals', 'Sums')
  assert.equal(model.getFormat(doc, tab, 2, 1).link, '#=Sums')
  assert.equal(model.linkTarget(doc, '#=Sums').rangeName, 'Sums')
  model.deleteName(doc, 'Sums')
  assert.equal(model.linkTarget(doc, '#=Sums'), null)
  assert.throws(() => model.setLink(doc, tab, 3, 1, 3, 1, { name: 'Nope' }), /no range called/)
})

test('links to a block and to a name go out to .xlsx and .ods and come back', () => {
  const XLSX = require('xlsx/dist/xlsx.mini.min.js')
  const fflate = require('fflate')
  const { workbookBytes, odsBytes, workbookToTabs } = require('../src/sheet/xlsxMap')
  const dump = {
    title: 'L',
    names: [{ name: 'Totals', tab: 'Costs', range: 'B2:C3' }],
    tabs: [
      { name: 'Main', cells: [
        { row: 1, col: 1, input: 'block', value: 'block', fmt: {}, linkTo: { tab: 1, row: 4, col: 2, row2: 9, col2: 4 } },
        { row: 2, col: 1, input: 'name', value: 'name', fmt: {}, linkTo: { rangeName: 'Totals' } }] },
      { name: 'Costs', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }] }
    ]
  }
  const xlsx = XLSX.read(workbookBytes(XLSX, fflate, dump), { type: 'array' })
  const { tabs, names } = workbookToTabs(XLSX, xlsx)
  assert.deepEqual(tabs[0].links.sort((a, b) => a[0] - b[0]), [[1, 1, { tab: 1, row: 4, col: 2, row2: 9, col2: 4 }], [2, 1, { name: 'Totals' }]])
  const back = model.createDoc()
  model.importTabs(back, { tabs, names })
  const [t0, t1] = model.tabIds(back)
  assert.deepEqual(model.linkTarget(back, model.getFormat(back, t0, 1, 1).link), { tabId: t1, name: 'Costs', row: 4, col: 2, row2: 9, col2: 4 })
  assert.equal(model.linkTarget(back, model.getFormat(back, t0, 2, 1).link).rangeName, 'Totals')
  // .ods keeps the block too.
  const ods = XLSX.read(odsBytes(XLSX, fflate, dump), { type: 'array' })
  assert.deepEqual(workbookToTabs(XLSX, ods).tabs[0].links.find((l) => l[0] === 1), [1, 1, { tab: 1, row: 4, col: 2, row2: 9, col2: 4 }])
})

// Links to another file or a folder (proposals/2026-10-22-links-to-files.md).
const FILE = 'pearoffice://file/' + 'aB3_-'.repeat(8) + 'xyz'
const FOLDER = 'pearoffice://folder/' + '0123456789abcdef'.repeat(2)

test('a link can go to another file or a folder; near misses are refused', () => {
  const { doc, tab } = sheet()
  model.setLink(doc, tab, 1, 1, 1, 1, FILE)
  model.setLink(doc, tab, 2, 1, 2, 1, FOLDER)
  assert.equal(model.getFormat(doc, tab, 1, 1).link, FILE)
  assert.equal(model.getFormat(doc, tab, 2, 1).link, FOLDER)
  for (const bad of [FILE + 'a', FILE.slice(0, -1), FILE.replace('_', '.'), FOLDER.toUpperCase(), FOLDER.slice(0, -1), 'pearoffice://join/' + 'a'.repeat(43), 'pearoffice://file/', 'pearoffice:file/' + 'a'.repeat(43)]) {
    assert.throws(() => model.setLink(doc, tab, 3, 1, 3, 1, bad), /Links can go/, bad)
  }
})

test('file and folder links go out to .xlsx and .ods and come back', () => {
  const XLSX = require('xlsx/dist/xlsx.mini.min.js')
  const fflate = require('fflate')
  const { workbookBytes, odsBytes, workbookToTabs } = require('../src/sheet/xlsxMap')
  const dump = { title: 'Links', tabs: [{ name: 'S', cells: [{ row: 1, col: 1, input: 'Plan', value: 'Plan', fmt: { link: FILE }, link: FILE }, { row: 2, col: 1, input: 'Work', value: 'Work', fmt: { link: FOLDER }, link: FOLDER }] }] }
  for (const bytes of [workbookBytes(XLSX, fflate, dump), odsBytes(XLSX, fflate, dump)]) {
    const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array' }))
    assert.deepEqual(tabs[0].links.sort((a, b) => a[0] - b[0]), [[1, 1, FILE], [2, 1, FOLDER]])
    const back = model.createDoc()
    model.importTabs(back, { tabs, names: [] })
    const t = model.tabIds(back)[0]
    assert.equal(model.getFormat(back, t, 1, 1).link, FILE)
    assert.equal(model.getFormat(back, t, 2, 1).link, FOLDER)
  }
})

test('file:follow finds where a linked file moved to', async () => {
  const { createFileMethods } = require('../src/worklet/fileMethods')
  const follow = createFileMethods({}, { getJoin: () => null, getMoves: () => null, getProfiles: () => null })['file:follow']
  const db = new Map([['moves:a', { to: 'b' }], ['moves:b', { to: 'c' }], ['moves:x', { to: null, removed: true }]])
  const ctx = { localDb: { get: async (k) => (db.has(k) ? { value: db.get(k) } : null) } }
  assert.deepEqual(await follow({ sheetId: 'c' }, ctx), { sheetId: 'c' })
  assert.deepEqual(await follow({ sheetId: 'b' }, ctx), { sheetId: 'c' })
  assert.deepEqual(await follow({ sheetId: 'a' }, ctx), { sheetId: 'c' })
  assert.deepEqual(await follow({ sheetId: 'x' }, ctx), { sheetId: null })
})

// @ chips (proposals/2026-10-23-multi-select-and-smart-chips.md).
test('person and date chips are checked, and clearing a cell removes them', () => {
  const { doc, tab } = sheet()
  const who = 'ab'.repeat(32)
  model.setCells(doc, tab, 1, 1, [['Ada'], ['46318']])
  model.setFormat(doc, tab, 1, 1, { person: who })
  model.setFormat(doc, tab, 2, 1, { datechip: true, num: 'd mmm yyyy' })
  assert.equal(model.getFormat(doc, tab, 1, 1).person, who)
  assert.equal(model.getFormat(doc, tab, 2, 1).datechip, true)
  for (const bad of ['AB'.repeat(32), 'ab'.repeat(31), 'zz'.repeat(32), 7]) assert.throws(() => model.setFormat(doc, tab, 1, 1, { person: bad }), /bad value/)
  assert.throws(() => model.setFormat(doc, tab, 1, 1, { datechip: 'yes' }), /bad value/)
  model.clearRange(doc, tab, 1, 1, 2, 1)
  assert.equal(model.getFormat(doc, tab, 1, 1).person, undefined)
  assert.equal(model.getFormat(doc, tab, 2, 1).datechip, undefined)
  assert.equal(model.getFormat(doc, tab, 2, 1).num, 'd mmm yyyy')
})
