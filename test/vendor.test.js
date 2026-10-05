// desktop/vendor/peerloom-host must match the sibling peerloom-host checkout
// (scripts/vendor-peerloom-host.js). Skipped where there is no sibling.
const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { FILES, from, to } = require('../scripts/vendor-peerloom-host')

test('vendored peerloom-host files match ../peerloom-host', { skip: !fs.existsSync(from) && 'no ../peerloom-host here' }, () => {
  const stale = FILES.filter((f) => !fs.existsSync(path.join(to, f)) || !fs.readFileSync(path.join(to, f)).equals(fs.readFileSync(path.join(from, 'src', f))))
  assert.deepEqual(stale, [], 'out of step: run node scripts/vendor-peerloom-host.js')
})
