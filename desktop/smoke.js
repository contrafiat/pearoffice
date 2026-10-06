// Desktop smoke test: builds the UI and the worklet, launches Electron with an
// offscreen window against a throwaway data folder, and checks the result
// that smoke-run.js prints. Usage: node desktop/smoke.js [screenshot.png]

const fs = require('node:fs')
const os = require('node:os')
const path = require('node:path')
const { execFileSync, spawn } = require('node:child_process')

const root = path.join(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-ui.mjs')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-worklet.js')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-seeder.js')], { stdio: 'inherit' })
require(path.join(root, 'scripts', 'bare.js')).barePath() // fixes the execute bit

const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-smoke-'))
const electron = require(path.join(__dirname, 'node_modules', 'electron'))
const shot = process.argv[2] ? path.resolve(process.argv[2]) : ''
const args = [__dirname]
// Fedora and some other Linux setups need these to start Electron without a
// GPU sandbox, as in PearGuard's desktop smoke scripts.
if (process.platform === 'linux') args.unshift('--no-sandbox', '--disable-gpu')

const child = spawn(electron, args, {
  env: { ...process.env, PEAROFFICE_SMOKE: '1', PEAROFFICE_DATA: dataDir, PEAROFFICE_SMOKE_SHOT: shot },
  stdio: ['ignore', 'pipe', 'inherit']
})
let out = ''
child.stdout.on('data', (d) => { out += d; process.stdout.write(d) })
const timer = setTimeout(() => { console.error('smoke: timed out'); child.kill('SIGKILL') }, 90000)
child.on('exit', () => {
  clearTimeout(timer)
  fs.rmSync(dataDir, { recursive: true, force: true })
  const line = out.split('\n').find((l) => l.startsWith('SMOKE_RESULT '))
  const result = line ? JSON.parse(line.slice('SMOKE_RESULT '.length)) : { ok: false, error: 'no result line' }
  if (!result.ok) {
    console.error('not ok - desktop smoke', JSON.stringify(result))
    process.exit(1)
  }
  console.log('ok - desktop smoke: create, type, fast typing, formula, formula suggestions, spilling, selection totals, shortcuts, decimals, paste values, find, sort, fill handle, Ctrl+D, charts, cell formats, row heights, merged cells, freeze panes, filters, hiding rows, comments, validation, colour rules, named ranges, copy/paste, fill, clear range, bold, undo, rename, export, csv, json export, pdf, duplicate and delete a tab, tidy up, json and csv import, import, zoom, theme, settings, seeder and devices panels, local seeder, keep online, start at login, profile picture, about, invite link and QR, stop and restart a backup, remove from this device, documents, document paste and outline, document import and export')
})
