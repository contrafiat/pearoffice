// Runs the desktop smoke test when a display is available. Electron's
// offscreen window still needs a display connection on Linux, so a headless
// box skips it (and says so) instead of failing.
const { execFileSync } = require('child_process')
const path = require('path')
const fs = require('fs')

const root = path.join(__dirname, '..')
if (process.platform === 'linux' && !process.env.DISPLAY && !process.env.WAYLAND_DISPLAY) {
  console.log('skip - desktop smoke: no display')
  process.exit(0)
}
if (!fs.existsSync(path.join(root, 'desktop', 'node_modules', 'electron'))) {
  console.error('not ok - desktop smoke: run `npm install --prefix desktop` first')
  process.exit(1)
}
execFileSync(process.execPath, [path.join(root, 'desktop', 'smoke.js')], { stdio: 'inherit' })
