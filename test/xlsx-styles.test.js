// Cell styles written into .xlsx files (src/sheet/xlsxStyles.js).

const test = require('node:test')
const assert = require('node:assert/strict')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const { workbookBytes } = require('../src/sheet/xlsxMap')

test('formats become Excel styles, blank formatted cells included', () => {
  const dump = {
    title: 'Styles',
    tabs: [{
      name: 'Sheet1',
      widths: {},
      cells: [
        { row: 1, col: 1, input: 'Head', value: 'Head', fmt: { b: true, size: 14, color: '#b3261e', align: 'center', valign: 'middle', wrap: true, font: 'serif' } },
        { row: 1, col: 2, input: '1234.5', value: 1234.5, fmt: { num: '$#,##0.00', fill: '#dcfce7', bb: 'double:#1d4ed8', u: true, s: true } },
        { row: 2, col: 2, input: '7', value: 7, fmt: { b: true, size: 14, color: '#b3261e', align: 'center', valign: 'middle', wrap: true, font: 'serif' } },
        { row: 3, col: 3, input: '', value: null, fmt: { fill: '#fee2e2', bt: 'thick' } },
        { row: 4, col: 1, input: 'plain', value: 'plain', fmt: {} }
      ]
    }]
  }
  const files = fflate.unzipSync(workbookBytes(XLSX, fflate, dump))
  const styles = fflate.strFromU8(files['xl/styles.xml'])
  const sheet = fflate.strFromU8(files['xl/worksheets/sheet1.xml'])
  const xfOf = (ref) => Number((new RegExp('<c r="' + ref + '"[^>]*? s="(\\d+)"').exec(sheet) || [])[1] || 0)
  assert.equal(xfOf('A1'), xfOf('B2'), 'the same formats share a style')
  assert.notEqual(xfOf('A1'), 0)
  assert.equal(xfOf('A4'), 0, 'unformatted cells keep the default')
  assert.match(sheet, /<row r="3"><c r="C3" s="\d+"\/><\/row>/, 'a blank formatted cell is written')
  const xfs = [...styles.matchAll(/<xf numFmtId[^]*?(?:\/>|<\/xf>)/g)].map((m) => m[0])
  const cellXfs = xfs.slice(1) // after cellStyleXfs' one
  assert.match(cellXfs[xfOf('A1')], /<alignment horizontal="center" vertical="center" wrapText="1"\/>/)
  assert.match(styles, /<font><b\/><sz val="14"\/><color rgb="FFB3261E"\/><name val="Times New Roman"\/>/)
  assert.match(styles, /<font><strike\/><u\/><sz val="11"\/>/)
  assert.match(styles, /<numFmt numFmtId="164" formatCode="\$#,##0\.00"\/>/)
  assert.match(cellXfs[xfOf('B1')], /numFmtId="164"/)
  assert.match(styles, /<fgColor rgb="FFDCFCE7"\/>/)
  assert.match(styles, /<bottom style="double"><color rgb="FF1D4ED8"\/><\/bottom>/)
  assert.match(styles, /<top style="thick"><color auto="1"\/><\/top>/)
  const back = XLSX.read(workbookBytes(XLSX, fflate, dump), { type: 'array', cellNF: true })
  assert.equal(back.Sheets.Sheet1.B1.z, '$#,##0.00', 'the number format reads back')
  assert.equal(back.Sheets.Sheet1.B1.v, 1234.5)
})
