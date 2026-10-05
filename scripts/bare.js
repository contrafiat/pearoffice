// Shared helpers for running the real Bare binary from Node scripts.
const fs = require('fs')
const path = require('path')
const { execFileSync } = require('child_process')

const root = path.join(__dirname, '..')

function host () {
  return process.platform + '-' + process.arch
}

function barePath () {
  const p = path.join(root, 'node_modules', 'bare-runtime-' + host(), 'bin', process.platform === 'win32' ? 'bare.exe' : 'bare')
  // npm sometimes installs the binary without the execute bit.
  if (process.platform !== 'win32') fs.chmodSync(p, 0o755)
  return p
}

// Bundle an entry for this machine's host, with native addons next to it.
function pack (entry, out) {
  fs.rmSync(path.dirname(out), { recursive: true, force: true })
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'bare-pack', 'bin.js'),
    '--host', host(),
    '--offload-addons',
    '--imports', path.join(root, 'scripts', 'bare-imports.js'),
    '-o', out,
    entry
  ], { cwd: root, stdio: 'inherit' })
  return out
}

// The headless seeder for a Linux arch (x64 or arm64) in dir: the Bare
// runtime as dir/bare and dir/seeder/seeder.bundle with that arch's addons.
// Used by the Linux download and the Umbrel image.
function seederPayload (arch, dir) {
  const target = 'linux-' + arch
  const runtimeVersion = require(path.join(root, 'node_modules', 'bare-runtime', 'package.json')).version
  const runtimeDir = path.join(root, 'node_modules', 'bare-runtime-' + target)
  if (!fs.existsSync(runtimeDir)) execFileSync('npm', ['install', '--no-save', '--force', 'bare-runtime-' + target + '@' + runtimeVersion], { cwd: root, stdio: 'inherit' })
  fs.mkdirSync(dir, { recursive: true })
  fs.copyFileSync(path.join(runtimeDir, 'bin', 'bare'), path.join(dir, 'bare'))
  fs.chmodSync(path.join(dir, 'bare'), 0o755)
  if (arch === process.arch) { try { execFileSync('strip', ['--strip-unneeded', path.join(dir, 'bare')]) } catch {} }
  execFileSync(process.execPath, [
    path.join(root, 'node_modules', 'bare-pack', 'bin.js'),
    '--host', target, '--offload-addons',
    '--imports', path.join(root, 'scripts', 'bare-imports.js'),
    '-o', path.join(dir, 'seeder', 'seeder.bundle'),
    path.join(root, 'src', 'seeder', 'bare.js')
  ], { cwd: root, stdio: 'inherit' })
}

module.exports = { root, host, barePath, pack, seederPayload }
