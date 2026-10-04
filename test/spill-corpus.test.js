// The array functions' whole blocks against LibreOffice
// (test/fixtures/spill-expected.json, made by scripts/spill-expectations.js)
// or Excel where they differ, bit for bit against a golden file, and the
// same in every timezone.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { cases, EXCEL_OVERRIDES } = require('./fixtures/spill-corpus')
const { runSpillCorpus } = require('./fixtures/spill-run')

const GOLDEN = path.join(__dirname, 'fixtures', 'spill-golden.json')
const { expected } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'spill-expected.json'), 'utf8'))

test('every spilled block matches LibreOffice or Excel', () => {
  const got = runSpillCorpus()
  const wrong = []
  for (const [a1, f] of cases) {
    const want = f in EXCEL_OVERRIDES ? EXCEL_OVERRIDES[f] : expected[a1] && expected[a1].formula === f ? expected[a1].libreoffice : undefined
    assert.notEqual(want, undefined, a1 + ' ' + f + ' has no expected block: run node scripts/spill-expectations.js')
    if (JSON.stringify(got[a1]) !== JSON.stringify(want)) wrong.push(a1 + ' ' + f + ' gave ' + JSON.stringify(got[a1]) + ', expected ' + JSON.stringify(want))
  }
  assert.deepEqual(wrong, [])
})

test('spilled blocks are bit-identical to the golden file', () => {
  const got = runSpillCorpus()
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
})

test('spilled blocks do not depend on the timezone', () => {
  const { execFileSync } = require('node:child_process')
  const script = 'console.log(JSON.stringify(require(' + JSON.stringify(path.join(__dirname, 'fixtures', 'spill-run.js')) + ').runSpillCorpus()))'
  const outs = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata'].map((TZ) =>
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ } }).toString())
  for (const o of outs) assert.equal(o, outs[0])
})
