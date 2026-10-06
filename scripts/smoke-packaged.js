// Run the desktop smoke test against a packaged app instead of the checkout:
//   node scripts/smoke-packaged.js <path to the app executable> [screenshot.png]
// e.g. the AppImage, PearOffice.app/Contents/MacOS/PearOffice, or PearOffice.exe.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { spawn } = require('child_process')

const exe = process.argv[2]
if (!exe) { console.error('usage: node scripts/smoke-packaged.js <app executable> [shot.png]'); process.exit(2) }
const dataDir = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-pkg-smoke-'))
const args = process.platform === 'linux' ? ['--no-sandbox', '--disable-gpu'] : []
const child = spawn(exe, args, {
  env: { ...process.env, PEAROFFICE_SMOKE: '1', PEAROFFICE_DATA: dataDir, PEAROFFICE_SMOKE_SHOT: process.argv[3] ? path.resolve(process.argv[3]) : '' },
  stdio: ['ignore', 'pipe', 'pipe']
})
let out = ''
child.stdout.on('data', (d) => { out += d })
child.stderr.on('data', (d) => { out += d })
const timer = setTimeout(() => { console.error('smoke: timed out'); child.kill('SIGKILL') }, 120000)
child.on('exit', () => {
  clearTimeout(timer)
  fs.rmSync(dataDir, { recursive: true, force: true })
  const line = out.split('\n').find((l) => l.includes('SMOKE_RESULT '))
  const result = line ? JSON.parse(line.slice(line.indexOf('SMOKE_RESULT ') + 13)) : { ok: false, error: 'no result line', tail: out.slice(-1500) }
  if (!result.ok) { console.error('not ok - packaged smoke', JSON.stringify(result)); process.exit(1) }
  console.log('ok - packaged smoke: ' + exe)
})
