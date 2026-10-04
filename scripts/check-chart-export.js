// Exports a sheet with one chart of each kind to .xlsx the way the app does,
// then has LibreOffice open it and counts the charts it finds. Needs
// `soffice`. Usage: node scripts/check-chart-export.js [out-dir]
// With an out-dir it also keeps the .xlsx and a PDF of it for a look.

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync } = require('node:child_process')
const Corestore = require('corestore')
const XLSX = require('xlsx/dist/xlsx.mini.min.js')
const fflate = require('fflate')
const createTestnet = require('@hyperswarm/testnet')
const Hyperswarm = require('hyperswarm')
const { createSheetEngine } = require('../src/worklet/engine')
const { call } = require('../test/helpers')
const { workbookBytes } = require('../src/shared/xlsxMap')

const KINDS = [
  { type: 'column', title: 'Column', dataLabels: true },
  { type: 'bar', title: 'Bar' },
  { type: 'line', title: 'Line', trendline: [0] },
  { type: 'area', title: 'Area', stacked: true },
  { type: 'pie', title: 'Pie', data: 'A1:B5' },
  { type: 'doughnut', title: 'Doughnut', data: 'A1:B5' },
  { type: 'scatter', title: 'Scatter', data: 'E1:F6', labels: { row: true } },
  { type: 'combo', title: 'Combo', lineSeries: [1], secondAxis: [1] }
]

;(async () => {
  const out = process.argv[2] || fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-charts-'))
  fs.mkdirSync(out, { recursive: true })
  const testnet = await createTestnet(3)
  const e = createSheetEngine({ corestore: new Corestore(fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-store-'))), createSwarm: ({ keyPair }) => new Hyperswarm({ keyPair, bootstrap: testnet.bootstrap }) })
  await e.init({})
  const { sheetId } = await call(e, 'sheet:create', { title: 'Charts' })
  await call(e, 'sheet:setCells', { sheetId, row: 1, col: 1, grid: [['Month', 'Rent', 'Food'], ['Jan', '1200', '400'], ['Feb', '1200', '450'], ['Mar', '1250', '380'], ['Apr', '1250', '420']] })
  await call(e, 'sheet:setCells', { sheetId, row: 1, col: 5, grid: [['x', 'y'], ['1', '2'], ['2', '4.1'], ['3', '5.9'], ['4', '8.2'], ['5', '9.9']] })
  for (const [i, k] of KINDS.entries()) {
    await call(e, 'sheet:addChart', { sheetId, spec: { data: 'A1:C5', labels: { row: true, col: true }, seriesIn: 'columns', anchor: { row: 8 + Math.floor(i / 2) * 16, col: 1 + (i % 2) * 6 }, ...k } })
  }
  await new Promise((resolve) => setTimeout(resolve, 100))
  const dump = await call(e, 'sheet:dump', { sheetId })
  const file = path.join(out, 'charts.xlsx')
  fs.writeFileSync(file, workbookBytes(XLSX, fflate, dump))
  await e.close()
  await testnet.destroy()

  const profile = 'file://' + path.join(os.tmpdir(), 'pearsheet-lo-profile')
  execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=' + profile, '--convert-to', 'ods', '--outdir', out, file], { stdio: 'ignore' })
  const ods = fflate.unzipSync(fs.readFileSync(path.join(out, 'charts.ods')))
  const charts = Object.keys(ods).filter((n) => /^Object \d+\/content\.xml$/.test(n))
  const kinds = charts.map((n) => (/chart:class="chart:([a-z]+)"/.exec(fflate.strFromU8(ods[n])) || [])[1]).sort()
  console.log('LibreOffice found ' + charts.length + ' of ' + KINDS.length + ' charts: ' + kinds.join(', '))
  if (process.argv[2]) execFileSync('soffice', ['--headless', '--norestore', '-env:UserInstallation=' + profile, '--convert-to', 'pdf', '--outdir', out, file], { stdio: 'ignore' })
  process.exit(charts.length === KINDS.length ? 0 : 1)
})()
