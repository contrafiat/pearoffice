// Stage what the packaged desktop app needs next to Electron, for one target:
//   desktop/build/resources/bare/bare(.exe)       the Bare runtime
//   desktop/build/resources/worklet/              worklet bundle + its addons
//   desktop/build/resources/ui/                   the built web UI
// electron-builder copies that folder into the app's resources (see
// desktop/package.json "build.extraResources" and desktop/paths.js).
//
// Usage: node scripts/stage-desktop.js [--platform darwin] [--arch arm64]
// Defaults to this machine. The bundle can be built for another platform from
// here, because the addon packages ship prebuilds for every platform.

const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')
const arg = (name, fallback) => { const i = process.argv.indexOf('--' + name); return i === -1 ? fallback : process.argv[i + 1] }
const platform = arg('platform', process.platform)
const arch = arg('arch', process.arch)
const host = platform + '-' + arch
const out = path.join(root, 'desktop', 'build', 'resources')

fs.rmSync(out, { recursive: true, force: true })
fs.mkdirSync(path.join(out, 'bare'), { recursive: true })

// 1. The Bare runtime for the target. npm only installs this machine's
//    binary, so fetch another platform's on demand.
const runtimeVersion = require(path.join(root, 'node_modules', 'bare-runtime', 'package.json')).version
const runtimeDir = path.join(root, 'node_modules', 'bare-runtime-' + host)
if (!fs.existsSync(runtimeDir)) {
  execFileSync('npm', ['install', '--no-save', '--force', 'bare-runtime-' + host + '@' + runtimeVersion], { cwd: root, stdio: 'inherit', shell: process.platform === 'win32' })
}
const bareName = platform === 'win32' ? 'bare.exe' : 'bare'
fs.copyFileSync(path.join(runtimeDir, 'bin', bareName), path.join(out, 'bare', bareName))
if (platform !== 'win32') fs.chmodSync(path.join(out, 'bare', bareName), 0o755)
// The Linux binary ships with debug info (93 MB); stripping saves ~25 MB.
if (platform === 'linux' && process.platform === 'linux') {
  try { execFileSync('strip', ['--strip-unneeded', path.join(out, 'bare', bareName)]) } catch { console.log('strip not available, shipping unstripped') }
}

// 2. The worklet bundle with the target's native addons beside it.
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'bare-pack', 'bin.js'),
  '--host', host,
  '--offload-addons',
  '--imports', path.join(root, 'scripts', 'bare-imports.js'),
  '-o', path.join(out, 'worklet', 'worklet.bundle'),
  path.join(root, 'src', 'worklet', 'bare.js')
], { cwd: root, stdio: 'inherit' })

// 3. The blind seeder bundle ("Run a seeder on this computer"), same addons.
execFileSync(process.execPath, [
  path.join(root, 'node_modules', 'bare-pack', 'bin.js'),
  '--host', host,
  '--offload-addons',
  '--imports', path.join(root, 'scripts', 'bare-imports.js'),
  '-o', path.join(out, 'seeder', 'seeder.bundle'),
  path.join(root, 'src', 'seeder', 'bare.js')
], { cwd: root, stdio: 'inherit' })

// 4. The UI, minified.
execFileSync(process.execPath, [path.join(root, 'scripts', 'build-ui.mjs'), '--minify'], { cwd: root, stdio: 'inherit' })
fs.cpSync(path.join(root, 'dist', 'ui'), path.join(out, 'ui'), { recursive: true })

console.log('staged desktop resources for ' + host)
