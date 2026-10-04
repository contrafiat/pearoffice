// Works out the expected value of every case in
// test/fixtures/function-corpus.js with LibreOffice, writes them to
// test/fixtures/function-expected.json and lists where PearSheet differs.
//
//   node scripts/function-expectations.js
//
// Needs `soffice` (LibreOffice). Run it after adding cases; the test reads
// the JSON and does not need LibreOffice.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const XLSX = require('xlsx')
const { inputs, cases } = require('../test/fixtures/function-corpus')
const { runFunctionCorpus } = require('../test/fixtures/function-run')

const root = path.join(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-fn-'))
const src = path.join(dir, 'cases.xlsx')

// Inputs typed as a person would: numbers as numbers, TRUE as a boolean.
const ws = {}
for (const [a1, v] of Object.entries(inputs)) {
  if (v === 'TRUE' || v === 'FALSE') ws[a1] = { t: 'b', v: v === 'TRUE' }
  else if (!isNaN(Number(v))) ws[a1] = { t: 'n', v: Number(v) }
  else ws[a1] = { t: 's', v }
}
const { xlfn } = require('./xlfn')
// Functions that return an array need an array formula in LibreOffice.
const ARRAY = /MINVERSE|MMULT|MUNIT|FREQUENCY|GROWTH|LINEST|LOGEST|MODE\.MULT|TREND|TRANSPOSE|SERIESSUM|SUMPRODUCT/
for (const [a1, f] of cases) {
  ws[a1] = { t: 'n', f: xlfn(f.slice(1)) }
  if (ARRAY.test(f)) ws[a1].F = a1 + ':' + a1
}
ws['!ref'] = 'A1:AF' + cases.length
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
XLSX.writeFile(wb, src)

// LibreOffice recalculates on load (the file has no cached values) and
// writes the results.
execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', 'ods', '--outdir', path.join(dir, 'out'), src], { stdio: 'ignore' })
const out = XLSX.readFile(path.join(dir, 'out', 'cases.ods'))
const sheet = out.Sheets[out.SheetNames[0]]
const version = execFileSync('soffice', ['--version']).toString().trim().split(' ').slice(0, 2).join(' ')

const expected = {}
for (const [a1, f] of cases) {
  const c = sheet[a1]
  let v = null
  if (!c) v = null
  else if (c.t === 'e') v = { error: c.w || XLSX.SSF.format('General', c.v) }
  else if (c.t === 'b') v = !!c.v
  else if (c.t === 'n') v = c.v
  else v = String(c.v)
  expected[a1] = { formula: f, libreoffice: v }
}
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'function-expected.json'), JSON.stringify({ source: version, expected }, null, 1) + '\n')
fs.rmSync(dir, { recursive: true, force: true })

// Compare with PearSheet.
const ours = runFunctionCorpus()
let same = 0
const diff = []
for (const [a1, { formula, libreoffice }] of Object.entries(expected)) {
  if (agree(ours[a1], libreoffice)) same++
  else diff.push(a1 + '  ' + formula + '  pearsheet=' + JSON.stringify(ours[a1]) + '  libreoffice=' + JSON.stringify(libreoffice))
}
console.log(version + ': ' + same + ' of ' + cases.length + ' agree')
for (const d of diff) console.log(d)

function agree (a, b) {
  if (typeof a === 'number' && typeof b === 'number') return Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b))
  return JSON.stringify(a) === JSON.stringify(b)
}

module.exports = { agree }
