// Every function the formula engine has, checked against LibreOffice's
// answers (test/fixtures/function-expected.json, made by
// scripts/function-expectations.js) or Excel's where they differ.

const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { cases, EXCEL_OVERRIDES } = require('./fixtures/function-corpus')
const { runFunctionCorpus } = require('./fixtures/function-run')

const GOLDEN = path.join(__dirname, 'fixtures', 'function-golden.json')
const { expected } = JSON.parse(fs.readFileSync(path.join(__dirname, 'fixtures', 'function-expected.json'), 'utf8'))

test('every function matches LibreOffice or Excel', () => {
  const got = runFunctionCorpus()
  const wrong = []
  for (const [a1, f] of cases) {
    const want = f in EXCEL_OVERRIDES ? EXCEL_OVERRIDES[f][0] : expected[a1] && expected[a1].formula === f ? expected[a1].libreoffice : undefined
    assert.notEqual(want, undefined, a1 + ' ' + f + ' has no expected value: run node scripts/function-expectations.js')
    const v = got[a1]
    const ok = typeof want === 'number' && typeof v === 'number'
      ? Math.abs(v - want) <= 1e-9 * Math.max(1, Math.abs(want))
      : JSON.stringify(v) === JSON.stringify(want)
    if (!ok) wrong.push(a1 + ' ' + f + ' gave ' + JSON.stringify(v) + ', expected ' + JSON.stringify(want))
  }
  assert.deepEqual(wrong, [])
})

// The distributions and the gamma and beta functions under them
// (src/shared/formula/precise.js) are held to 13 digits.
test('statistics functions match to 13 digits', () => {
  const got = runFunctionCorpus()
  const stats = /^=(GAMMA|BETA|CHISQ|F\.|T\.|CONFIDENCE|LOGNORM|NORM|EXPON|POISSON|BINOM|NEGBINOM|HYPGEOM|WEIBULL|GAUSS|PHI|FISHER|ERF)/
  const wrong = []
  for (const [a1, f] of cases.filter(([, f]) => stats.test(f))) {
    const want = f in EXCEL_OVERRIDES ? EXCEL_OVERRIDES[f][0] : expected[a1].libreoffice
    const v = got[a1]
    if (typeof want === 'number' && !(Math.abs(v - want) <= 1e-13 * Math.max(1, Math.abs(want)))) wrong.push(f + ' gave ' + v + ', expected ' + want)
  }
  assert.deepEqual(wrong, [])
})

test('function results are bit-identical to the golden file', () => {
  const got = runFunctionCorpus()
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 1) + '\n')
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
})

test('function results do not depend on the timezone', () => {
  const { execFileSync } = require('node:child_process')
  const script = 'console.log(JSON.stringify(require(' + JSON.stringify(path.join(__dirname, 'fixtures', 'function-run.js')) + ').runFunctionCorpus()))'
  const outs = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata'].map((TZ) =>
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ } }).toString())
  for (const o of outs) assert.equal(o, outs[0])
})
