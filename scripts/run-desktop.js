// Build the UI and worklet, then start the desktop app from the checkout.
// Uses a separate data folder from an installed copy (PEAROFFICE_DATA to override).
const { execFileSync, spawn } = require('child_process')
const path = require('path')
const os = require('os')

const root = path.join(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-ui.mjs')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-worklet.js')], { stdio: 'inherit' })
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-seeder.js')], { stdio: 'inherit' })
require('./bare').barePath() // fixes the execute bit

const electron = require(path.join(root, 'desktop', 'node_modules', 'electron'))
const args = [path.join(root, 'desktop')]
// Fedora's packaged Electron sandbox helper is not set up for a dev checkout.
if (process.platform === 'linux') args.unshift('--no-sandbox')
const env = { ...process.env, PEAROFFICE_DATA: process.env.PEAROFFICE_DATA || path.join(os.homedir(), '.pearoffice-dev') }
spawn(electron, args, { stdio: 'inherit', env }).on('exit', (code) => process.exit(code || 0))
