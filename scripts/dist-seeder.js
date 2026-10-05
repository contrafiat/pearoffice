// Build the headless seeder download for Linux:
//   dist/seeder-pkg/pearsheet-seeder-<version>-linux-<arch>.tar.gz
// for x64 and arm64, each with the Bare runtime, the seeder bundle and its
// native addons, a launcher, a systemd unit and a README. Then runs the x64
// one from a scratch folder to check it starts and prints a pairing link.
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const { seederPayload } = require('./bare')

const root = path.join(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const outDir = path.join(root, 'dist', 'seeder-pkg')
fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
for (const arch of ['x64', 'arm64']) {
  const host = 'linux-' + arch
  const name = 'pearsheet-seeder-' + version + '-' + host
  const dir = path.join(outDir, name)
  fs.mkdirSync(dir, { recursive: true })
  seederPayload(arch, dir)
  for (const f of ['pearsheet-seeder', 'pearsheet-seeder.service', 'README.md']) fs.copyFileSync(path.join(root, 'seeder-dist', f), path.join(dir, f))
  fs.chmodSync(path.join(dir, 'pearsheet-seeder'), 0o755)
  execFileSync('tar', ['czf', name + '.tar.gz', name], { cwd: outDir })
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('built ' + name + '.tar.gz (' + Math.round(fs.statSync(path.join(outDir, name + '.tar.gz')).size / 1e6) + ' MB)')
}

// Unpack and start the x64 build where nothing from the checkout is around.
if (process.arch === 'x64' && process.platform === 'linux') {
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pearsheet-seeder-pkg-'))
  const name = 'pearsheet-seeder-' + version + '-linux-x64'
  execFileSync('tar', ['xzf', path.join(outDir, name + '.tar.gz')], { cwd: scratch })
  const proc = spawn(path.join(scratch, name, 'pearsheet-seeder'), [], { env: { ...process.env, PEARSHEET_SEEDER_DATA: path.join(scratch, 'data') }, stdio: ['pipe', 'pipe', 'inherit'] })
  let out = ''
  let done = false
  const timer = setTimeout(() => { proc.kill(); console.error('not ok - packaged seeder did not print a pairing link'); process.exit(1) }, 30000)
  proc.stdout.on('data', (d) => {
    out += d
    if (!done && /pearsheet:\/\/seeder\?rv=/.test(out) && /▀|▄|█/.test(out)) {
      done = true
      clearTimeout(timer)
      proc.kill()
      fs.rmSync(scratch, { recursive: true, force: true })
      console.log('ok - packaged seeder (linux-x64) starts and prints a pairing link and QR code')
    }
  })
}
