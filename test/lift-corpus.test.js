// Single-value functions over a range: every lifted case gives two cells,
// matching LibreOffice (test/fixtures/lift-expected.json, made by
// scripts/spill-expectations.js lift) or Excel where they differ, and bit
// for bit against a golden file.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { cases, EXCEL_OVERRIDES, LOWER_PRECISION } = require('./fixtures/lift-corpus')
const { runSpillCorpus } = require('./fixtures/spill-run')

const GOLDEN = path.join(__dirname, 'fixtures', 'lift-golden.json')
const { expected } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'lift-expected.json'), 'utf8'))

// LibreOffice's file gives TRUE/FALSE results in arrays back as 1/0.
function same (v, want, tol) {
  if (typeof v === 'number' && typeof want === 'number') return Math.abs(v - want) <= tol * Math.max(1, Math.abs(want))
  if (typeof v === 'boolean' && typeof want === 'number') return Number(v) === want
  return JSON.stringify(v) === JSON.stringify(want)
}

test('every function runs once per value and matches LibreOffice or Excel', () => {
  const got = runSpillCorpus('lift')
  const wrong = []
  for (const [a1, f] of cases) {
    const want = f in EXCEL_OVERRIDES ? EXCEL_OVERRIDES[f] : expected[a1] && expected[a1].formula === f ? expected[a1].libreoffice : undefined
    assert.notEqual(want, undefined, a1 + ' ' + f + ' has no expected block: run node scripts/spill-expectations.js lift')
    const tol = LOWER_PRECISION.has(f) ? 1e-7 : 1e-9
    const v = got[a1]
    const ok = v.length === want.length && v.every((line, i) => line.length === want[i].length && line.every((x, j) => same(x, want[i][j], tol)))
    if (!ok) wrong.push(a1 + ' ' + f + ' gave ' + JSON.stringify(v) + ', expected ' + JSON.stringify(want))
  }
  assert.deepEqual(wrong, [])
})

test('lifted results are bit-identical to the golden file', () => {
  const got = runSpillCorpus('lift')
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
})
