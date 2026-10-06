// Recalculates the spill corpus (test/fixtures/spill-corpus.js) in
// LibreOffice and writes the blocks it gives to
// test/fixtures/spill-expected.json, then lists where PearOffice differs.
// Needs `soffice`. Usage: node scripts/spill-expectations.js [lift]
// With `lift`, the same for test/fixtures/lift-corpus.js, where every
// answer must be two cells (a column of two).
//
// Each formula is written as a dynamic array over the block PearOffice
// spills, so LibreOffice computes the same block. A block of a different
// size in LibreOffice shows up as #N/A padding or missing values.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const XLSX = require('xlsx')
const corpus = process.argv[2] === 'lift' ? 'lift' : 'spill'
const { inputs, cases } = require('../test/fixtures/' + corpus + '-corpus')
const { runSpillCorpus } = require('../test/fixtures/spill-run')
const { toFile } = require('../src/shared/xlsxMap')
const { xlfn } = require('./xlfn')

const root = path.join(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-spill-'))
const src = path.join(dir, corpus + '.xlsx')
const ours = runSpillCorpus(corpus)
// The lift corpus checks the shape too: every answer is a column of two.
const shapeOf = (a1) => (corpus === 'lift' ? [[0], [0]] : ours[a1])

const ws = {}
for (const [a1, v] of Object.entries(inputs)) {
  if (v === 'TRUE' || v === 'FALSE') ws[a1] = { t: 'b', v: v === 'TRUE' }
  else if (!isNaN(Number(v))) ws[a1] = { t: 'n', v: Number(v) }
  else ws[a1] = { t: 's', v }
}
let last = 0
for (const [a1, f] of cases) {
  const { r, c } = XLSX.utils.decode_cell(a1)
  const block = shapeOf(a1)
  ws[a1] = { t: 'n', f: xlfn(toFile(f.slice(1))), F: XLSX.utils.encode_range({ s: { r, c }, e: { r: r + block.length - 1, c: c + block[0].length - 1 } }), D: true }
  last = Math.max(last, r + block.length)
}
ws['!ref'] = 'A1:AZ' + last
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
XLSX.writeFile(wb, src)

execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', 'ods', '--outdir', path.join(dir, 'out'), src], { stdio: 'ignore' })
const sheet = XLSX.readFile(path.join(dir, 'out', corpus + '.ods')).Sheets.Sheet1
const version = execFileSync('soffice', ['--version']).toString().trim().split(' ').slice(0, 2).join(' ')

const one = (c) => {
  if (!c) return null
  if (c.t === 'e') return { error: c.w || XLSX.SSF.format('General', c.v) }
  if (c.t === 'b') return !!c.v
  if (c.t === 'n') return c.v
  return String(c.v)
}
const expected = {}
for (const [a1, f] of cases) {
  const { r, c } = XLSX.utils.decode_cell(a1)
  const block = shapeOf(a1).map((line, i) => line.map((_, j) => one(sheet[XLSX.utils.encode_cell({ r: r + i, c: c + j })])))
  expected[a1] = { formula: f, libreoffice: block }
}
fs.writeFileSync(path.join(root, 'test', 'fixtures', corpus + '-expected.json'), JSON.stringify({ source: version, expected }, null, 1) + '\n')
fs.rmSync(dir, { recursive: true, force: true })

// Numbers agree to 9 digits (LibreOffice's file keeps 15).
const close = (a, b) => typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) <= 1e-9 * Math.max(1, Math.abs(b)) : JSON.stringify(a) === JSON.stringify(b)
const sameBlock = (a, b) => a.length === b.length && a.every((line, i) => line.length === b[i].length && line.every((v, j) => close(v, b[i][j])))
let same = 0
for (const [a1, { formula, libreoffice }] of Object.entries(expected)) {
  if (sameBlock(ours[a1], libreoffice)) same++
  else console.log(a1 + '  ' + formula + '\n  pearoffice   ' + JSON.stringify(ours[a1]) + '\n  libreoffice ' + JSON.stringify(libreoffice))
}
console.log(same + ' of ' + cases.length + ' match ' + version)
