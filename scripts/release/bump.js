// Set the release version everywhere it is written (scripts/release.sh,
// step 0). Android's versionCode and iOS's buildNumber go up by one. Run
// again at the same version (a --retag), it changes nothing.
//
//   node scripts/release/bump.js <version>
//
// The StartOS package is retired (the PearOffice seeder is now PeerLoom
// Seeder), so its version stays at its last release.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const at = (p) => path.join(root, p)
const read = (p) => fs.readFileSync(at(p), 'utf8')
const write = (p, s) => fs.writeFileSync(at(p), s)
const json = (p, fn) => { const o = JSON.parse(read(p)); fn(o); write(p, JSON.stringify(o, null, 2) + '\n') }

const version = process.argv[2]
if (!/^\d+\.\d+\.\d+$/.test(version || '')) {
  console.error('usage: node scripts/release/bump.js <x.y.z>')
  process.exit(2)
}

const old = JSON.parse(read('package.json')).version
if (old === version) { console.log('already at ' + version); process.exit(0) }

json('package.json', (o) => { o.version = version })
json('desktop/package.json', (o) => { o.version = version })
for (const lock of ['package-lock.json', 'desktop/package-lock.json']) {
  json(lock, (o) => { o.version = version; if (o.packages && o.packages['']) o.packages[''].version = version })
}
json('app.json', (o) => {
  o.expo.version = version
  o.expo.android.versionCode = (Number(o.expo.android.versionCode) || 0) + 1
  o.expo.ios.buildNumber = String((Number(o.expo.ios.buildNumber) || 0) + 1)
})

const app = JSON.parse(read('app.json')).expo
console.log(`${old} -> ${version} (Android versionCode ${app.android.versionCode}, iOS build ${app.ios.buildNumber})`)
