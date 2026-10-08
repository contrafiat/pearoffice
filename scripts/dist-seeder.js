// Build the headless seeder download for Linux:
//   dist/seeder-pkg/pearoffice-seeder-<version>-linux-<arch>.tar.gz
// for x64 and arm64, each with the Bare runtime, the seeder bundle and its
// native addons, a launcher, a systemd unit and a README. Then runs the x64
// one from a scratch folder to check it starts and prints a pairing link.
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')
const { seederPayload } = require('./bare')

const root = path.join(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const outDir = path.join(root, 'dist', 'seeder-pkg')

// rocksdb-native links libatomic.so.1, which a server or minimal install
// often lacks (a fresh Ubuntu 24.04 server does), and the seeder then stops
// at start. The addon looks in $ORIGIN/rocksdb-native first, so Debian 12's
// copy goes there, as in the Umbrel image (seeder-dist/umbrel/Dockerfile).
const LIBATOMIC = {
  x64: { deb: 'libatomic1_12.2.0-14+deb12u1_amd64.deb', sha256: 'fbd4e154a6b444229ea002cc209df099209c0adc09102e5fd21239a3d2b55e2d', lib: 'usr/lib/x86_64-linux-gnu/libatomic.so.1.2.0' },
  arm64: { deb: 'libatomic1_12.2.0-14+deb12u1_arm64.deb', sha256: '1693aa13ce2b30d061a519fc28b77b9bab8c8e45804ced5969d99821e1bc2159', lib: 'usr/lib/aarch64-linux-gnu/libatomic.so.1.2.0' }
}

function addLibatomic (arch, dir) {
  const { deb, sha256, lib } = LIBATOMIC[arch]
  const cache = path.join(root, 'dist', 'cache')
  const file = path.join(cache, deb)
  fs.mkdirSync(cache, { recursive: true })
  if (!fs.existsSync(file)) execFileSync('curl', ['-fsSL', '-o', file, 'https://deb.debian.org/debian/pool/main/g/gcc-12/' + deb])
  const got = crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
  if (got !== sha256) { fs.rmSync(file); throw new Error(deb + ': checksum ' + got + ', expected ' + sha256) }
  const x = fs.mkdtempSync(path.join(os.tmpdir(), 'libatomic-'))
  execFileSync('ar', ['x', file], { cwd: x })
  const data = fs.readdirSync(x).find((n) => n.startsWith('data.tar'))
  execFileSync('tar', ['xf', data, './' + lib], { cwd: x })
  const addon = path.join(dir, 'seeder', 'node_modules', 'rocksdb-native', 'prebuilds', 'linux-' + arch)
  if (!fs.existsSync(path.join(addon, 'rocksdb-native.bare'))) throw new Error('rocksdb-native.bare not at ' + addon)
  fs.mkdirSync(path.join(addon, 'rocksdb-native'), { recursive: true })
  fs.copyFileSync(path.join(x, lib), path.join(addon, 'rocksdb-native', 'libatomic.so.1'))
  fs.rmSync(x, { recursive: true, force: true })
  fs.cpSync(path.join(root, 'seeder-dist', 'licenses'), path.join(dir, 'licenses'), { recursive: true })
}

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
for (const arch of ['x64', 'arm64']) {
  const host = 'linux-' + arch
  const name = 'pearoffice-seeder-' + version + '-' + host
  const dir = path.join(outDir, name)
  fs.mkdirSync(dir, { recursive: true })
  seederPayload(arch, dir)
  addLibatomic(arch, dir)
  for (const f of ['pearoffice-seeder', 'pearoffice-seeder.service', 'README.md']) fs.copyFileSync(path.join(root, 'seeder-dist', f), path.join(dir, f))
  fs.chmodSync(path.join(dir, 'pearoffice-seeder'), 0o755)
  // The launcher's update command compares this with the latest release.
  fs.writeFileSync(path.join(dir, 'VERSION'), version + '\n')
  execFileSync('tar', ['czf', name + '.tar.gz', name], { cwd: outDir })
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('built ' + name + '.tar.gz (' + Math.round(fs.statSync(path.join(outDir, name + '.tar.gz')).size / 1e6) + ' MB)')
}

// Unpack and start the x64 build where nothing from the checkout is around,
// with a fake newer release served locally: it must start, print a pairing
// link and QR code and say the newer version is out. Then `update` must
// install that release, and refuse one whose checksum does not match.
if (process.arch === 'x64' && process.platform === 'linux') {
  const { serveRelease } = require('./serve-local-release')
  const name = 'pearoffice-seeder-' + version + '-linux-x64'
  const next = version.replace(/\d+$/, (n) => String(Number(n) + 1))
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-seeder-pkg-'))
  const unpack = (into) => { fs.mkdirSync(into, { recursive: true }); execFileSync('tar', ['xzf', path.join(outDir, name + '.tar.gz')], { cwd: into }); return path.join(into, name) }
  const fail = (what) => { console.error('not ok - ' + what); process.exit(1) }

  // The fake release: this build, relabelled as the next version.
  const releaseDir = path.join(scratch, 'release')
  const nextName = 'pearoffice-seeder-' + next + '-linux-x64'
  fs.renameSync(unpack(path.join(scratch, 'build')), path.join(scratch, 'build', nextName))
  fs.writeFileSync(path.join(scratch, 'build', nextName, 'VERSION'), next + '\n')
  fs.mkdirSync(releaseDir)
  execFileSync('tar', ['czf', path.join(releaseDir, nextName + '.tar.gz'), nextName], { cwd: path.join(scratch, 'build') })
  const digest = crypto.createHash('sha256').update(fs.readFileSync(path.join(releaseDir, nextName + '.tar.gz'))).digest('hex')
  const writeSum = (hex) => fs.writeFileSync(path.join(releaseDir, nextName + '.tar.gz.sha256'), hex + '  ' + nextName + '.tar.gz\n')

  ;(async () => {
    const server = await serveRelease({ version: next, dir: releaseDir })
    const env = { ...process.env, PEAROFFICE_UPDATE_LATEST_URL: 'http://127.0.0.1:' + server.address().port + '/latest', PEAROFFICE_UPDATE_DELAY: '0' }
    delete env.PEAROFFICE_NO_UPDATE_CHECK
    writeSum(digest)
    try {
      const app = unpack(path.join(scratch, 'run'))
      await new Promise((resolve) => {
        const proc = spawn(path.join(app, 'pearoffice-seeder'), [], { env: { ...env, PEAROFFICE_SEEDER_DATA: path.join(scratch, 'data') }, stdio: ['pipe', 'pipe', 'inherit'] })
        let out = ''
        const timer = setTimeout(() => { proc.kill(); fail('packaged seeder did not print a pairing link and the update notice:\n' + out) }, 30000)
        proc.stdout.on('data', (d) => {
          out += d
          if (/pearoffice:\/\/seeder\?rv=/.test(out) && /▀|▄|█/.test(out) && out.includes('PearOffice seeder ' + next + ' is out')) {
            clearTimeout(timer)
            proc.kill()
            resolve()
          }
        })
      })
      console.log('ok - packaged seeder (linux-x64) starts, prints a pairing link and QR code and says ' + next + ' is out')

      const run = (dir) => new Promise((resolve) => {
        const p = spawn(path.join(dir, 'pearoffice-seeder'), ['update'], { env })
        let out = ''
        p.stdout.on('data', (d) => { out += d })
        p.on('exit', (code) => resolve({ code, out }))
      })
      const readVersion = (dir) => fs.readFileSync(path.join(dir, 'VERSION'), 'utf8').trim()
      writeSum('0'.repeat(64))
      const bad = await run(app)
      if (bad.code === 0 || !bad.out.includes('checksum does not match') || readVersion(app) !== version) fail('update with a wrong checksum was not refused:\n' + bad.out)
      writeSum(digest)
      const good = await run(app)
      if (good.code !== 0 || readVersion(app) !== next) fail('update did not install ' + next + ':\n' + good.out)
      execFileSync(path.join(app, 'bare'), ['-e', '0'])
      const again = await run(app)
      if (!again.out.includes('already up to date')) fail('a second update did not say up to date:\n' + again.out)
      console.log('ok - packaged seeder updates itself to ' + next + ' and refuses a bad checksum')
    } finally {
      server.close()
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })().catch((err) => fail(err.message))
}
