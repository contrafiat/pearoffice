// THIRD-PARTY-NOTICES.txt for a package: the licence of every npm package
// whose code ships in it, read from the built bundles themselves (the
// worklet and seeder Bare bundles, the UI's esbuild metafile), plus the Bare
// runtime and the Manrope font. Electron adds its own LICENSE and
// LICENSES.chromium.html.
//
//   node scripts/third-party-notices.js <out file> <bundle or meta.json>...
//
// A .json argument is an esbuild metafile; anything else a Bare bundle.
// Also run by stage-desktop.js.

const fs = require('fs')
const path = require('path')
const Bundle = require('bare-bundle')

const root = path.join(__dirname, '..')

// The package folder a bundled file comes from, relative to the repo, or
// null for our own code.
function packageDir (file) {
  const parts = file.replace(/\\/g, '/').replace(/^\//, '').split('/')
  const at = parts.lastIndexOf('node_modules')
  if (at === -1) return null
  const name = parts[at + 1].startsWith('@') ? parts.slice(at + 1, at + 3) : [parts[at + 1]]
  return parts.slice(0, at + 1).concat(name).join('/')
}

function filesOf (input) {
  const data = fs.readFileSync(input)
  if (input.endsWith('.json')) return Object.keys(JSON.parse(data).inputs)
  return [...Bundle.from(data).keys()]
}

function licenceText (dir) {
  const names = fs.readdirSync(dir, { withFileTypes: true }).filter((d) => d.isFile() && /^(licen[cs]e|copying|notice)/i.test(d.name)).map((d) => d.name).sort()
  return names.map((n) => fs.readFileSync(path.join(dir, n), 'utf8').trim()).join('\n\n')
}

function notices (inputs, { extraDirs = [] } = {}) {
  const dirs = new Set(extraDirs)
  for (const input of inputs) {
    for (const file of filesOf(input)) {
      const dir = packageDir(file)
      if (dir) dirs.add(path.join(root, dir))
    }
  }
  const seen = new Map() // name@version -> entry
  for (const dir of dirs) {
    let pkg
    try { pkg = JSON.parse(fs.readFileSync(path.join(dir, 'package.json'), 'utf8')) } catch { continue }
    const id = pkg.name + '@' + pkg.version
    if (seen.has(id)) continue
    const licence = typeof pkg.license === 'string' ? pkg.license : (pkg.license && pkg.license.type) || 'see below'
    seen.set(id, { id, licence, text: licenceText(dir) })
  }
  const entries = [...seen.values()].sort((a, b) => a.id.localeCompare(b.id))
  const out = [
    'PearOffice includes the third-party software listed below. Each is',
    'used under its own licence, given after its name.',
    '',
    '=== Manrope typeface (SIL Open Font License 1.1)',
    '',
    fs.readFileSync(path.join(root, 'assets', 'fonts', 'OFL.txt'), 'utf8').trim()
  ]
  // Packages whose licence text is the same word for word share one copy.
  const byText = new Map()
  for (const e of entries) {
    const key = e.text || '(No licence file in the package. Its package.json says ' + e.licence + '.)\n' + e.id
    if (!byText.has(key)) byText.set(key, [])
    byText.get(key).push(e)
  }
  for (const [key, group] of byText) {
    out.push('', '=== ' + group.map((e) => e.id + ' (' + e.licence + ')').join(', '), '')
    out.push(group[0].text || key.split('\n')[0])
  }
  return { text: out.join('\n') + '\n', count: entries.length, missing: entries.filter((e) => !e.text).map((e) => e.id) }
}

module.exports = { notices }

if (require.main === module) {
  const [outFile, ...inputs] = process.argv.slice(2)
  if (!outFile || !inputs.length) {
    console.error('usage: node scripts/third-party-notices.js <out file> <bundle or meta.json>...')
    process.exit(1)
  }
  const r = notices(inputs.map((p) => path.resolve(p)))
  fs.writeFileSync(outFile, r.text)
  console.log('wrote ' + outFile + ': ' + r.count + ' packages' + (r.missing.length ? ', no licence file in ' + r.missing.join(', ') : ''))
}
