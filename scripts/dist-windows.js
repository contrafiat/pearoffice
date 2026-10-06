// Build the Windows installer (NSIS, x64) on this Linux machine. Needs Wine
// (electron-builder runs NSIS and edits the exe's resources through it).
// Staging checks that every native addon has its Windows file.
//
// The installer is unsigned (no Windows code-signing certificate). Before a
// release, `npm run dist:windows:vm` builds it on the Windows VM and checks
// the app starts there (scripts/build-desktop-windows.sh).
//
// BUILD_VERSION=<x.y.z> labels the build as another version (testing updates).
const { execFileSync } = require('child_process')
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
execFileSync(process.execPath, [path.join(root, 'scripts', 'stage-desktop.js'), '--platform', 'win32', '--arch', 'x64'], { stdio: 'inherit' })
// Clear only earlier Windows output; the other platforms' installers live in
// the same folder.
const dist = path.join(root, 'desktop', 'dist')
if (fs.existsSync(dist)) {
  for (const f of fs.readdirSync(dist)) {
    if (/^PearOffice-Setup-|^win-unpacked$/.test(f)) fs.rmSync(path.join(dist, f), { recursive: true, force: true })
  }
}
const args = ['electron-builder', '--win', '--x64', '--publish', 'never']
if (process.env.BUILD_VERSION) args.push('-c.extraMetadata.version=' + process.env.BUILD_VERSION)
execFileSync('npx', args, { cwd: path.join(root, 'desktop'), stdio: 'inherit' })

// The packaged app must hold the Windows runtime and both bundles.
const res = path.join(dist, 'win-unpacked', 'resources')
for (const f of ['bare/bare.exe', 'worklet/worklet.bundle', 'seeder/seeder.bundle', 'ui/index.html']) {
  if (!fs.existsSync(path.join(res, f))) throw new Error('packaged app is missing ' + f)
}
const { assertAddons } = require('./check-addons')
for (const b of ['worklet/worklet.bundle', 'seeder/seeder.bundle']) assertAddons(path.join(res, b), 'win32-x64')
const setup = fs.readdirSync(dist).find((f) => /^PearOffice-Setup-.*\.exe$/.test(f))
if (!setup) throw new Error('no installer in desktop/dist')
console.log('ok - built desktop/dist/' + setup)
