// Desktop smoke test: builds the UI and the worklet, then runs each part of
// smoke-run.js (sheets, sheet-files, docs, slides, slides-present, app) in its own Electron launch
// with an offscreen window and a throwaway data folder.
// Usage: node desktop/smoke.js [--part sheets|sheet-files|docs|slides|slides-present|app] [screenshot.png]

const path = require('node:path')
const { execFileSync } = require('node:child_process')
const { parseArgs, runParts } = require('./smoke/launch')

const opts = parseArgs(process.argv.slice(2))
const root = path.join(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-ui.mjs')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-worklet.js')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-seeder.js')], { stdio: 'inherit' })
require(path.join(root, 'scripts', 'bare.js')).barePath() // fixes the execute bit

const electron = require(path.join(__dirname, 'node_modules', 'electron'))
const args = [__dirname]
// Fedora and some other Linux setups need these to start Electron without a
// GPU sandbox, as in PearGuard's desktop smoke scripts.
if (process.platform === 'linux') args.unshift('--no-sandbox', '--disable-gpu')

runParts({ command: electron, args, label: 'desktop smoke', parts: opts.parts, shot: opts.shot, timeout: 60000, echo: true })
  .then((ok) => process.exit(ok ? 0 : 1))
