// Stage what the Umbrel image copies in, per Docker arch:
//   dist/umbrel/amd64/ and dist/umbrel/arm64/
// Each holds the Bare runtime, the seeder bundle with that arch's addons and
// the dashboard (seeder-dist/umbrel/server.js and what it requires), laid out
// as in this repo so the server's relative requires work. No npm runs inside
// the image. See proposals/2026-10-05-umbrel-seeder.md.
//
// The login is @peerloom/host's dashboard-auth, from the copy in
// desktop/vendor/peerloom-host (scripts/vendor-peerloom-host.js), with the
// one module it needs (z32, and b4a under it).
//
// Usage: node scripts/stage-umbrel.js [amd64|arm64]   (default both)
const fs = require('fs')
const path = require('path')
const { root, seederPayload } = require('./bare')

const outDir = path.join(root, 'dist', 'umbrel')
fs.rmSync(outDir, { recursive: true, force: true })
const files = [
  'seeder-dist/umbrel/server.js',
  'seeder-dist/umbrel/index.html',
  'seeder-dist/umbrel/icon.png',
  'desktop/seeder-process.js',
  'src/shared/qr.js',
  'src/ui/fonts.js',
  'node_modules/qrcode-generator/dist/qrcode.js',
  'node_modules/qrcode-generator/package.json',
  'node_modules/z32/index.js',
  'node_modules/z32/package.json',
  'node_modules/b4a/index.js',
  'node_modules/b4a/package.json'
]
const host = path.join(root, 'desktop', 'vendor', 'peerloom-host')
const hostFiles = ['dashboard-auth.js', 'tighten.js', 'LICENSE']
const only = process.argv[2]
for (const [arch, dockerArch] of [['x64', 'amd64'], ['arm64', 'arm64']]) {
  if (only && only !== dockerArch) continue
  const dir = path.join(outDir, dockerArch)
  seederPayload(arch, dir)
  for (const f of files) {
    fs.mkdirSync(path.dirname(path.join(dir, f)), { recursive: true })
    fs.copyFileSync(path.join(root, f), path.join(dir, f))
  }
  fs.writeFileSync(path.join(dir, 'seeder-dist', 'umbrel', 'version.json'), JSON.stringify({ version: require(path.join(root, 'package.json')).version }) + '\n')
  const hostDir = path.join(dir, 'node_modules', '@peerloom', 'host')
  for (const f of hostFiles) {
    fs.mkdirSync(path.join(hostDir, 'src'), { recursive: true })
    fs.copyFileSync(path.join(host, f), path.join(hostDir, f === 'LICENSE' ? f : path.join('src', f)))
  }
  fs.writeFileSync(path.join(hostDir, 'package.json'), JSON.stringify({ name: '@peerloom/host', exports: { './dashboard-auth': './src/dashboard-auth.js' } }, null, 2) + '\n')
  console.log('staged ' + path.relative(root, dir))
}
