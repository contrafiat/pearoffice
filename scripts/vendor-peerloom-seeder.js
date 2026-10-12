// Copy @peerloom/seeder (the seeder every PeerLoom app shares) into
// src/seeder/vendor/peerloom-seeder/, from the sibling checkout
// ../peerloom-seeder. A copy, not a file: dependency, so the bundles resolve
// its dependencies from this repo: one copy of each, with the hypercore
// patches in src/worklet applied. Committed, so the Mac, Windows and iOS
// builds need no sibling checkout; test/vendor.test.js fails when it falls
// out of step with ../peerloom-seeder.
//
// Usage: node scripts/vendor-peerloom-seeder.js
const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..')
const from = path.join(root, '..', 'peerloom-seeder')
const to = path.join(root, 'src', 'seeder', 'vendor', 'peerloom-seeder')
const FILES = ['src/seeder.js', 'src/client.js', 'src/protocol.js', 'src/keyringRecord.js']

function vendor () {
  fs.rmSync(to, { recursive: true, force: true })
  fs.mkdirSync(path.join(to, 'src'), { recursive: true })
  for (const f of FILES) fs.copyFileSync(path.join(from, f), path.join(to, f))
  fs.copyFileSync(path.join(from, 'LICENSE'), path.join(to, 'LICENSE'))
  const commit = (() => { try { return require('child_process').execFileSync('git', ['-C', from, 'rev-parse', '--short', 'HEAD'], { encoding: 'utf8' }).trim() } catch { return 'unknown' } })()
  fs.writeFileSync(path.join(to, 'README.md'), 'Copied from peerloom-seeder (' + commit + ') by scripts/vendor-peerloom-seeder.js. Do not edit here.\n')
}

if (require.main === module) { vendor(); console.log('vendored ' + FILES.join(', ') + ' from ' + from) }

module.exports = { FILES, from, to }
