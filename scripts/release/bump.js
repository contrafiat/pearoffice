// Set the release version everywhere it is written (scripts/release.sh
// prepare). Android's versionCode and iOS's buildNumber go up by one.
//
//   node scripts/release/bump.js <version> <notes-file>
//
// The StartOS package keeps a graph of its versions: the current one moves
// to versions/v<old>.ts and a new current.ts takes the new version, with the
// notes' first paragraph as its release notes.

const fs = require('fs')
const path = require('path')

const root = path.join(__dirname, '..', '..')
const [version, notesFile] = process.argv.slice(2)
if (!/^\d+\.\d+\.\d+$/.test(version || '') || !notesFile) {
  console.error('usage: node scripts/release/bump.js <x.y.z> <notes-file>')
  process.exit(2)
}
const at = (p) => path.join(root, p)
const read = (p) => fs.readFileSync(at(p), 'utf8')
const write = (p, s) => fs.writeFileSync(at(p), s)
const json = (p, fn) => { const o = JSON.parse(read(p)); fn(o); write(p, JSON.stringify(o, null, 2) + '\n') }

const old = JSON.parse(read('package.json')).version
if (old === version) { console.error('already at ' + version); process.exit(1) }

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

// The StartOS image tag.
const manifest = 'start9/seeder/startos/manifest/index.ts'
write(manifest, read(manifest).replace(/pearoffice-seeder:\d+\.\d+\.\d+/, 'pearoffice-seeder:' + version))

// The StartOS version graph.
const dir = 'start9/seeder/startos/versions'
const oldName = 'v' + old.replace(/\./g, '_')
const current = read(dir + '/current.ts')
write(dir + '/' + oldName + '.ts', current.replace('export const current =', 'export const ' + oldName + ' ='))
const firstPara = read(path.relative(root, path.resolve(notesFile))).split(/\n\s*\n/)[0].replace(/\s+/g, ' ').trim()
write(dir + '/current.ts', `import { IMPOSSIBLE, VersionInfo } from '@start9labs/start-sdk'

export const current = VersionInfo.of({
  version: '${version}:0',
  releaseNotes: {
    en_US: ${JSON.stringify(firstPara)},
  },
  migrations: {
    up: async ({ effects }) => {},
    down: IMPOSSIBLE,
  },
})
`)
const index = read(dir + '/index.ts')
const others = ((/other:\s*\[([^\]]*)\]/.exec(index) || [])[1] || '').split(',').map((s) => s.trim()).filter(Boolean)
others.unshift(oldName)
write(dir + '/index.ts', `import { VersionGraph } from '@start9labs/start-sdk'
import { current } from './current'
${others.map((n) => `import { ${n} } from './${n}'`).join('\n')}

export const versionGraph = VersionGraph.of({
  current,
  other: [${others.join(', ')}],
})
`)

const app = JSON.parse(read('app.json')).expo
console.log(`${old} -> ${version} (Android versionCode ${app.android.versionCode}, iOS build ${app.ios.buildNumber}, StartOS ${version}:0)`)
