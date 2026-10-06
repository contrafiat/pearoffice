// Check that a staged bundle has a native addon for its target beside it, for
// every package in it that has one. A cross-build can quietly ship without
// one (PearGuard once did, wiki: linux-cross-build-quirk), and the app then
// fails only when it starts on the user's machine.
//
//   node scripts/check-addons.js <bundle> <host>   e.g. ... worklet.bundle win32-x64
// Also used by scripts/stage-desktop.js after staging.

const fs = require('fs')
const path = require('path')
const Bundle = require('bare-bundle')

// The packages whose bundled code loads a native addon, each with whether the
// target's addon file is next to the bundle. Packages that load none on this
// target (bare-posix on Windows) are left out, as bare-pack left out their
// loading code.
function checkAddons (bundlePath, host) {
  const bundle = Bundle.from(fs.readFileSync(bundlePath))
  const dirs = new Set()
  for (const file of bundle._files.keys()) {
    if (!file.endsWith('.js')) continue
    if (!/require\.addon\(/.test(bundle.read(file).toString())) continue
    const pkg = bundle._resolutions[file] && bundle._resolutions[file]['#package']
    dirs.add(typeof pkg === 'string' ? path.posix.dirname(pkg) : path.posix.dirname(file))
  }
  return [...dirs].sort().map((dir) => {
    const prebuilt = path.join(path.dirname(bundlePath), dir, 'prebuilds', host)
    const found = fs.existsSync(prebuilt) && fs.readdirSync(prebuilt).some((f) => f.endsWith('.bare'))
    return { dir, found }
  })
}

// Throws listing every addon missing for `host`.
function assertAddons (bundlePath, host) {
  const addons = checkAddons(bundlePath, host)
  const missing = addons.filter((a) => !a.found)
  if (missing.length) {
    throw new Error(path.basename(bundlePath) + ' has no ' + host + ' addon for: ' + missing.map((a) => a.dir).join(', '))
  }
  return addons.length
}

module.exports = { checkAddons, assertAddons }

if (require.main === module) {
  const [bundlePath, host] = process.argv.slice(2)
  if (!bundlePath || !host) { console.error('usage: node scripts/check-addons.js <bundle> <host>'); process.exit(2) }
  try {
    console.log('ok - ' + assertAddons(path.resolve(bundlePath), host) + ' addons for ' + host + ' in ' + path.basename(bundlePath))
  } catch (e) {
    console.error('not ok - ' + e.message)
    process.exit(1)
  }
}
