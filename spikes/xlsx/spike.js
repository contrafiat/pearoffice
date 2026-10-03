// xlsx spike: write a workbook with values, a formula and a date with each
// library, read it back with both, and report what survived. Runs under node
// and Bare (bundled).
const XLSX = require('xlsx')
const ExcelJS = require('exceljs')

async function main () {
  const out = { runtime: typeof Bare !== 'undefined' ? 'bare' : 'node' }

  // SheetJS write
  const ws = XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['Rent', 1200], ['Food', 450.5]])
  ws.B4 = { t: 'n', f: 'SUM(B2:B3)', v: 1650.5 }
  ws.A5 = { t: 'd', v: new Date(Date.UTC(2024, 1, 29)) }
  ws['!ref'] = 'A1:B5'
  const wb = XLSX.utils.book_new()
  XLSX.utils.book_append_sheet(wb, ws, 'Budget')
  const sjBuf = XLSX.write(wb, { type: 'buffer', bookType: 'xlsx', cellDates: true })
  out.sheetjsBytes = sjBuf.length

  // Read SheetJS's file with both.
  const back = XLSX.read(sjBuf, { cellFormula: true, cellDates: true })
  const s = back.Sheets.Budget
  out.sheetjsReadsOwn = { B4f: s.B4.f, B4v: s.B4.v, A5: String(s.A5.v && s.A5.v.toISOString ? s.A5.v.toISOString() : s.A5.v) }
  const ej = new ExcelJS.Workbook()
  await ej.xlsx.load(sjBuf)
  const c = ej.getWorksheet('Budget').getCell('B4')
  out.exceljsReadsSheetjs = { B4: c.value }

  // ExcelJS write, read back with SheetJS.
  const ew = new ExcelJS.Workbook()
  const sh = ew.addWorksheet('Budget')
  sh.addRow(['Item', 'Cost']); sh.addRow(['Rent', 1200]); sh.addRow(['Food', 450.5])
  sh.getCell('B4').value = { formula: 'SUM(B2:B3)', result: 1650.5 }
  sh.getCell('B2').font = { bold: true }
  const ejBuf = Buffer.from(await ew.xlsx.writeBuffer())
  out.exceljsBytes = ejBuf.length
  const back2 = XLSX.read(ejBuf, { cellFormula: true, cellStyles: true })
  out.sheetjsReadsExceljs = { B4f: back2.Sheets.Budget.B4.f, B4v: back2.Sheets.Budget.B4.v }
  console.log(JSON.stringify(out))
}
main().catch((e) => { console.error('FAILED', e); if (typeof Bare !== 'undefined') Bare.exit(1); else process.exit(1) })
