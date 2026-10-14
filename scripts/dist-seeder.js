// Build the last PearOffice seeder download for Linux:
//   dist/seeder-pkg/pearoffice-seeder-<version>-linux-<arch>.tar.gz
// for x64 and arm64. The PearOffice seeder is now PeerLoom Seeder, so each one
// carries the published PeerLoom Seeder Linux build in seeder/peerloom-seeder
// and a launcher (seeder-dist/pearoffice-seeder) that runs it on the old data
// folder. The older launcher's `update` takes this download from the latest
// PearOffice release and moves bare, seeder/, VERSION, the launcher, the unit
// and the README into place, so bare and seeder/seeder.bundle are links into
// the PeerLoom copy (its update check needs both).
//
// Then the x64 one is checked end to end: the previous PearOffice seeder
// download (from pearoffice-releases) makes a seeder, updates itself to this
// build from a fake release served locally, and the new launcher must come up
// with the same seeder key.
//
// PEERLOOM_SEEDER_VERSION pins the PeerLoom Seeder release (default: latest).
const crypto = require('crypto')
const fs = require('fs')
const os = require('os')
const path = require('path')
const { execFileSync, spawn } = require('child_process')

const root = path.join(__dirname, '..')
const version = require(path.join(root, 'package.json')).version
const outDir = path.join(root, 'dist', 'seeder-pkg')
const cache = path.join(root, 'dist', 'cache')
const PEERLOOM_REPO = 'peerloomllc/peerloom-seeder'
const OLD_REPO = 'peerloomllc/pearoffice-releases'

const fail = (what) => { console.error('not ok - ' + what); process.exit(1) }
const sha256 = (file) => crypto.createHash('sha256').update(fs.readFileSync(file)).digest('hex')
const getJson = (url) => JSON.parse(execFileSync('curl', ['-fsSL', '--max-time', '30', '-H', 'Accept: application/vnd.github+json', url], { encoding: 'utf8' }))

// Download a release asset and its .sha256 into the cache, checked.
function fetchAsset (release, name) {
  const asset = release.assets.find((a) => a.name === name)
  const sum = release.assets.find((a) => a.name === name + '.sha256')
  if (!asset || !sum) throw new Error(release.tag_name + ' has no ' + name + ' with a .sha256')
  fs.mkdirSync(cache, { recursive: true })
  const file = path.join(cache, name)
  if (!fs.existsSync(file)) execFileSync('curl', ['-fsSL', '--max-time', '600', '-o', file, asset.browser_download_url])
  const want = execFileSync('curl', ['-fsSL', '--max-time', '60', sum.browser_download_url], { encoding: 'utf8' }).match(/[0-9a-fA-F]{64}/)?.[0]?.toLowerCase()
  const got = sha256(file)
  if (!want || got !== want) { fs.rmSync(file); throw new Error(name + ': checksum ' + got + ', expected ' + want) }
  return file
}

const pin = process.env.PEERLOOM_SEEDER_VERSION
const peerloom = getJson('https://api.github.com/repos/' + PEERLOOM_REPO + '/releases/' + (pin ? 'tags/v' + pin : 'latest'))
const plVersion = peerloom.tag_name.replace(/^v/, '')

fs.rmSync(outDir, { recursive: true, force: true })
fs.mkdirSync(outDir, { recursive: true })
for (const arch of ['x64', 'arm64']) {
  const plName = 'peerloom-seeder-' + plVersion + '-linux-' + arch
  const name = 'pearoffice-seeder-' + version + '-linux-' + arch
  const dir = path.join(outDir, name)
  fs.mkdirSync(path.join(dir, 'seeder'), { recursive: true })
  execFileSync('tar', ['xzf', fetchAsset(peerloom, plName + '.tar.gz'), '-C', path.join(dir, 'seeder')])
  fs.renameSync(path.join(dir, 'seeder', plName), path.join(dir, 'seeder', 'peerloom-seeder'))
  fs.symlinkSync('seeder/peerloom-seeder/bare', path.join(dir, 'bare'))
  fs.symlinkSync('peerloom-seeder/seeder/seeder.bundle', path.join(dir, 'seeder', 'seeder.bundle'))
  for (const f of ['pearoffice-seeder', 'pearoffice-seeder.service', 'README.md']) fs.copyFileSync(path.join(root, 'seeder-dist', f), path.join(dir, f))
  fs.chmodSync(path.join(dir, 'pearoffice-seeder'), 0o755)
  fs.cpSync(path.join(root, 'seeder-dist', 'licenses'), path.join(dir, 'licenses'), { recursive: true })
  // The older launcher's update command compares this with the latest release.
  fs.writeFileSync(path.join(dir, 'VERSION'), version + '\n')
  execFileSync('tar', ['czf', name + '.tar.gz', name], { cwd: outDir })
  fs.rmSync(dir, { recursive: true, force: true })
  console.log('built ' + name + '.tar.gz with PeerLoom Seeder ' + plVersion + ' (' + Math.round(fs.statSync(path.join(outDir, name + '.tar.gz')).size / 1e6) + ' MB)')
}

if (process.arch === 'x64' && process.platform === 'linux') {
  const { serveRelease } = require('./serve-local-release')
  const name = 'pearoffice-seeder-' + version + '-linux-x64'
  const scratch = fs.mkdtempSync(path.join(os.tmpdir(), 'pearoffice-seeder-pkg-'))
  const data = path.join(scratch, 'data')
  const env = { ...process.env, PEAROFFICE_SEEDER_DATA: data, PEAROFFICE_NO_UPDATE_CHECK: '1', SEEDER_NO_UPDATE_CHECK: '1' }

  // The newest published PearOffice seeder download older than this one.
  const old = getJson('https://api.github.com/repos/' + OLD_REPO + '/releases?per_page=20')
    .map((r) => ({ r, v: r.tag_name.replace(/^v/, '') }))
    .filter(({ r, v }) => !r.draft && v !== version && r.assets.some((a) => a.name === 'pearoffice-seeder-' + v + '-linux-x64.tar.gz'))[0]
  if (!old) fail('no earlier PearOffice seeder download to update from')
  const oldName = 'pearoffice-seeder-' + old.v + '-linux-x64'

  ;(async () => {
    // The fake release: this build with its .sha256, as the old updater needs.
    const releaseDir = path.join(scratch, 'release')
    fs.mkdirSync(releaseDir)
    fs.copyFileSync(path.join(outDir, name + '.tar.gz'), path.join(releaseDir, name + '.tar.gz'))
    fs.writeFileSync(path.join(releaseDir, name + '.tar.gz.sha256'), sha256(path.join(releaseDir, name + '.tar.gz')) + '  ' + name + '.tar.gz\n')
    const server = await serveRelease({ version, dir: releaseDir })
    try {
      execFileSync('tar', ['xzf', fetchAsset(old.r, oldName + '.tar.gz'), '-C', scratch])
      const app = path.join(scratch, oldName)

      // 1. The old seeder makes its key.
      const oldKey = await new Promise((resolve) => {
        const proc = spawn(path.join(app, 'pearoffice-seeder'), [], { env, stdio: ['pipe', 'pipe', 'inherit'] })
        let out = ''
        const timer = setTimeout(() => { proc.kill(); fail(old.v + ' did not print its seeder key:\n' + out) }, 30000)
        proc.stdout.on('data', (d) => {
          out += d
          const m = out.match(/seeder key ([0-9a-f]{64})/)
          if (m) { clearTimeout(timer); proc.kill(); resolve(m[1]) }
        })
      })

      // 2. Its own update installs this build.
      const upd = await new Promise((resolve) => {
        const p = spawn(path.join(app, 'pearoffice-seeder'), ['update'], { env: { ...env, PEAROFFICE_UPDATE_LATEST_URL: 'http://127.0.0.1:' + server.address().port + '/latest' } })
        let out = ''
        p.stdout.on('data', (d) => { out += d })
        p.stderr.on('data', (d) => { out += d })
        p.on('exit', () => resolve(out))
      })
      if (fs.readFileSync(path.join(app, 'VERSION'), 'utf8').trim() !== version) fail(old.v + ' did not update to ' + version + ':\n' + upd)
      console.log('ok - the ' + old.v + ' seeder download updates itself to ' + version)

      // 3. The new launcher runs PeerLoom Seeder on the same folder.
      const port = String(18000 + Math.floor(Math.random() * 1000))
      const proc = spawn(path.join(app, 'pearoffice-seeder'), [], { env: { ...env, SEEDER_PORT: port }, stdio: ['ignore', 'pipe', 'pipe'], detached: true })
      let out = ''
      proc.stdout.on('data', (d) => { out += d })
      proc.stderr.on('data', (d) => { out += d })
      let status = null
      for (let i = 0; i < 60 && !status?.seederKey; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1000))
        try { status = JSON.parse(execFileSync('curl', ['-fsS', '--max-time', '5', 'http://127.0.0.1:' + port + '/api/status'], { encoding: 'utf8', stdio: ['ignore', 'pipe', 'ignore'] })) } catch {}
      }
      try { process.kill(-proc.pid) } catch {}
      if (!status?.seederKey) fail('PeerLoom Seeder did not answer on port ' + port + ':\n' + out)
      if (status.seederKey !== oldKey) fail('seeder key changed: ' + oldKey + ' -> ' + status.seederKey)
      console.log('ok - it then runs PeerLoom Seeder ' + status.version + ' with the same seeder key')
    } finally {
      server.close()
      fs.rmSync(scratch, { recursive: true, force: true })
    }
  })().catch((err) => fail(err.message))
}
