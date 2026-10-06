// Reading cell styles and row heights from imported .xlsx files.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('fs')
const path = require('path')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const model = require('../src/sheet/sheetModel')
const { workbookBytes, workbookToTabs, READ_OPTIONS } = require('../src/sheet/xlsxMap')
const { stylesFromXlsx } = require('../src/sheet/xlsxStyles')

const FMT = { b: true, i: true, u: true, s: true, size: 16, font: 'serif', color: '#cc0000', fill: '#ffeeaa', align: 'center', valign: 'middle', wrap: true, bt: 'thin', bb: 'double:#0000ff', bl: 'medium', br: 'dashed' }

function importBytes (bytes) {
  const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }))
  stylesFromXlsx(bytes, fflate).forEach((x, i) => { tabs[i].styles = x.styles; tabs[i].heights = x.heights })
  const doc = model.createDoc()
  model.initSheet(doc)
  model.importTabs(doc, { tabs })
  return { doc, tab: model.tabIds(doc)[0] }
}

test('formats and row heights survive an export and import', () => {
  const dump = { title: 'T', tabs: [{ name: 'A', cells: [{ row: 2, col: 3, input: 'x', value: 'x', fmt: FMT }, { row: 4, col: 1, input: '', value: null, fmt: { fill: '#00ff00' } }, { row: 5, col: 1, input: 'm', value: 'm', fmt: { font: 'mono', num: '0.00' } }], widths: {}, heights: { 2: 40, 7: 60 } }] }
  const { doc, tab } = importBytes(workbookBytes(XLSX, fflate, dump))
  assert.deepEqual(model.getFormat(doc, tab, 2, 3), FMT)
  assert.deepEqual(model.getFormat(doc, tab, 4, 1), { fill: '#00ff00' }, 'a styled blank cell keeps its style')
  assert.deepEqual(model.getFormat(doc, tab, 5, 1), { font: 'mono', num: '0.00' })
  assert.deepEqual(model.getFormat(doc, tab, 1, 1), {})
  assert.deepEqual(model.getHeights(doc, tab), { 2: 40, 7: 60 })
})

test('a file saved by LibreOffice', () => {
  const { doc, tab } = importBytes(fs.readFileSync(path.join(__dirname, 'fixtures/libreoffice-styles.xlsx')))
  assert.deepEqual(model.getFormat(doc, tab, 1, 1), { b: true, size: 14 })
  assert.deepEqual(model.getFormat(doc, tab, 1, 2), { i: true, color: '#cc0000', fill: '#ffeeaa' })
  assert.deepEqual(model.getFormat(doc, tab, 2, 1), { bt: 'thin', bb: 'double:#0000ff', bl: 'medium', br: 'dashed', align: 'center', valign: 'top' })
  assert.deepEqual(model.getFormat(doc, tab, 2, 2), { u: true, s: true, font: 'mono', wrap: true })
  assert.equal(model.getHeights(doc, tab)[3], 50)
})

test('theme colours with a tint, as Excel writes them', () => {
  const files = fflate.unzipSync(workbookBytes(XLSX, fflate, { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: { b: true } }], widths: {} }] }))
  // The file's theme (SheetJS writes the Office 2007 one) has accent 1 =
  // 4F81BD; lightened by 0.8 it is DCE6F2, as Excel shows it.
  files['xl/styles.xml'] = fflate.strToU8(fflate.strFromU8(files['xl/styles.xml'])
    .replace('<fills count="2">', '<fills count="3">')
    .replace('</fills>', '<fill><patternFill patternType="solid"><fgColor theme="4" tint="0.79998168889431442"/><bgColor indexed="64"/></patternFill></fill></fills>')
    .replace(/fillId="0" borderId="0" xfId="0" applyFont="1"/, 'fillId="2" borderId="0" xfId="0" applyFont="1"'))
  const [{ styles }] = stylesFromXlsx(fflate.zipSync(files), fflate)
  assert.deepEqual(styles, [[1, 1, { b: true, fill: '#dce6f2' }]])
})
