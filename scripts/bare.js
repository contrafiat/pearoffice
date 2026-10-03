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

module.exports = { root, host, barePath, pack }
