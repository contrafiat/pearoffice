const XLSX = require('xlsx')
const ws = XLSX.utils.aoa_to_sheet([['Item', 'Cost'], ['Rent', 1200]])
ws.B3 = { t: 'n', f: 'SUM(B2:B2)', v: 1200 }; ws['!ref'] = 'A1:B3'
const wb = XLSX.utils.book_new(); XLSX.utils.book_append_sheet(wb, ws, 'Budget')
const buf = XLSX.write(wb, { type: 'array', bookType: 'xlsx' })
const back = XLSX.read(buf, { type: 'array', cellFormula: true })
console.log(JSON.stringify({ runtime: 'bare', bytes: buf.byteLength, B3f: back.Sheets.Budget.B3.f, B3v: back.Sheets.Budget.B3.v }))
