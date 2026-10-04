// Recalculates the spill corpus (test/fixtures/spill-corpus.js) in
// LibreOffice and writes the blocks it gives to
// test/fixtures/spill-expected.json, then lists where PearSheet differs.
// Needs `soffice`. Usage: node scripts/spill-expectations.js
//
// Each formula is written as a dynamic array over the block PearSheet
// spills, so LibreOffice computes the same block. A block of a different
// size in LibreOffice shows up as #N/A padding or missing values.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const XLSX = require('xlsx')
const { inputs, cases } = require('../test/fixtures/spill-corpus')
const { runSpillCorpus } = require('../test/fixtures/spill-run')
const { toFile } = require('../src/shared/xlsxMap')

const root = path.join(__dirname, '..')
const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-spill-'))
const src = path.join(dir, 'spills.xlsx')
const ours = runSpillCorpus()

const ws = {}
for (const [a1, v] of Object.entries(inputs)) {
  if (v === 'TRUE' || v === 'FALSE') ws[a1] = { t: 'b', v: v === 'TRUE' }
  else if (!isNaN(Number(v))) ws[a1] = { t: 'n', v: Number(v) }
  else ws[a1] = { t: 's', v }
}
let last = 0
for (const [a1, f] of cases) {
  const { r, c } = XLSX.utils.decode_cell(a1)
  const block = ours[a1]
  ws[a1] = { t: 'n', f: toFile(f.slice(1)), F: XLSX.utils.encode_range({ s: { r, c }, e: { r: r + block.length - 1, c: c + block[0].length - 1 } }), D: true }
  last = Math.max(last, r + block.length)
}
ws['!ref'] = 'A1:Z' + last
const wb = XLSX.utils.book_new()
XLSX.utils.book_append_sheet(wb, ws, 'Sheet1')
XLSX.writeFile(wb, src)

execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=file://' + path.join(dir, 'profile'), '--convert-to', 'ods', '--outdir', path.join(dir, 'out'), src], { stdio: 'ignore' })
const sheet = XLSX.readFile(path.join(dir, 'out', 'spills.ods')).Sheets.Sheet1
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
  const block = ours[a1].map((line, i) => line.map((_, j) => one(sheet[XLSX.utils.encode_cell({ r: r + i, c: c + j })])))
  expected[a1] = { formula: f, libreoffice: block }
}
fs.writeFileSync(path.join(root, 'test', 'fixtures', 'spill-expected.json'), JSON.stringify({ source: version, expected }, null, 1) + '\n')
fs.rmSync(dir, { recursive: true, force: true })

let same = 0
for (const [a1, { formula, libreoffice }] of Object.entries(expected)) {
  if (JSON.stringify(libreoffice) === JSON.stringify(ours[a1])) same++
  else console.log(a1 + '  ' + formula + '\n  pearsheet   ' + JSON.stringify(ours[a1]) + '\n  libreoffice ' + JSON.stringify(libreoffice))
}
console.log(same + ' of ' + cases.length + ' match ' + version)
