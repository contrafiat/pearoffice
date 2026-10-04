// Build the Linux installers (AppImage and deb) on this machine, then run the
// packaged smoke test against the AppImage.
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts', 'stage-desktop.js'), '--platform', 'linux', '--arch', 'x64'], { stdio: 'inherit' })
// Clear only earlier Linux output; Mac and Windows installers copied back by
// their build scripts live in the same folder.
const dist = path.join(root, 'desktop', 'dist')
if (fs.existsSync(dist)) {
  for (const f of fs.readdirSync(dist)) {
    if (/^pearsheet-.*-linux-|^linux-unpacked$/.test(f)) fs.rmSync(path.join(dist, f), { recursive: true, force: true })
  }
}
execFileSync('npx', ['electron-builder', '--linux', '--x64', '--publish', 'never'], { cwd: path.join(root, 'desktop'), stdio: 'inherit' })
const appImage = fs.readdirSync(path.join(root, 'desktop', 'dist')).find((f) => f.endsWith('.AppImage'))
fs.chmodSync(path.join(root, 'desktop', 'dist', appImage), 0o755)
execFileSync(process.execPath, [path.join(root, 'scripts', 'smoke-packaged.js'), path.join(root, 'desktop', 'dist', appImage)], { stdio: 'inherit' })
