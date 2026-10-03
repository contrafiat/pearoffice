const test = require('node:test')
const assert = require('node:assert/strict')
const fs = require('node:fs')
const path = require('node:path')
const { cases } = require('./fixtures/formula-corpus')
const { runCorpus } = require('./fixtures/formula-run')

const GOLDEN = path.join(__dirname, 'fixtures', 'formula-golden.json')

test('formula corpus matches Excel', () => {
  const got = runCorpus()
  for (const [a1, f, excel] of cases) {
    if (excel === null) continue
    const v = got[a1]
    if (typeof excel === 'string' && excel[0] === '#') assert.deepEqual(v, { error: excel }, a1 + ' ' + f)
    else if (typeof excel === 'number') {
      assert.equal(typeof v, 'number', a1 + ' ' + f + ' gave ' + JSON.stringify(v))
      assert.ok(Math.abs(v - excel) <= 1e-9 * Math.max(1, Math.abs(excel)), a1 + ' ' + f + ' gave ' + v)
    } else assert.equal(v, excel, a1 + ' ' + f)
  }
})

test('formula corpus is bit-identical to the golden file', () => {
  const got = runCorpus()
  if (process.env.UPDATE_GOLDEN) fs.writeFileSync(GOLDEN, JSON.stringify(got, null, 2) + '\n')
  assert.deepEqual(got, JSON.parse(fs.readFileSync(GOLDEN, 'utf8')))
})

test('formula results do not depend on the timezone', () => {
  const { execFileSync } = require('node:child_process')
  const script = 'console.log(JSON.stringify(require(' + JSON.stringify(path.join(__dirname, 'fixtures', 'formula-run.js')) + ').runCorpus()))'
  const outs = ['UTC', 'America/Los_Angeles', 'Pacific/Kiritimati', 'Asia/Kolkata'].map((TZ) =>
    execFileSync(process.execPath, ['-e', script], { env: { ...process.env, TZ } }).toString())
  for (const o of outs) assert.equal(o, outs[0])
})

test('no ** operator in the vendored formula code', () => {
  const root = path.join(__dirname, '..', 'src', 'shared', 'formula')
  const hits = []
  const walk = (dir) => {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name)
      if (e.isDirectory()) walk(p)
      else if (p.endsWith('.js')) {
        fs.readFileSync(p, 'utf8').split('\n').forEach((line, i) => {
          const code = line.replace(/\/\/.*$/, '').replace(/\/\*.*?\*\//g, '')
          if (/[^*/]\*\*[^*/]/.test(code) && !/^\s*\*/.test(code)) hits.push(p + ':' + (i + 1))
        })
      }
    }
  }
  walk(root)
  assert.deepEqual(hits, [])
})
