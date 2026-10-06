// Two Yjs documents editing offline, then exchanging updates in both orders.
const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/sheet/sheetModel')
const { evaluateSheet } = require('../src/sheet/formula')
const { GuardedDoc } = require('../src/worklet/sheets')

function pair () {
  const a = model.createDoc()
  model.initSheet(a)
  const start = model.encodeState(a)
  const b = model.createDoc()
  model.applyUpdate(b, start)
  return { a, b, start, tab: model.tabIds(a)[0] }
}

function snapshot (doc, tab) {
  const out = {}
  const v = evaluateSheet(doc).get(tab)
  const t = model.tabMap(doc, tab)
  for (let r = 1; r <= t.get('rows').length; r++) {
    for (let c = 1; c <= 5; c++) {
      const input = model.getInput(doc, tab, r, c)
      if (input) out[r + ',' + c] = [input, JSON.stringify(v.get(r + ',' + c)), model.getFormat(doc, tab, r, c)]
    }
  }
  return out
}

test('concurrent edits converge whatever order updates arrive in', () => {
  const { a, b, start, tab } = pair()
  const ua = []
  const ub = []
  ua.push(model.setCell(a, tab, 1, 1, '10'))
  ub.push(model.setCell(b, tab, 1, 1, '20')) // same cell
  ua.push(model.setCell(a, tab, 2, 1, '=A1*2'))
  ub.push(model.insertRows(b, tab, 1)) // shifts everything down on b
  ua.push(model.setFormat(a, tab, 2, 1, { b: true }))
  ub.push(model.setFormat(b, tab, 3, 1, { num: '0.00' })) // the same cell as a's bold, after b's insert

  const c = model.createDoc()
  model.applyUpdate(c, start)
  for (const u of [...ub, ...ua]) model.applyUpdate(c, u)
  for (const u of ua) model.applyUpdate(b, u)
  for (const u of ub) model.applyUpdate(a, u)

  assert.deepEqual(snapshot(a, tab), snapshot(b, tab))
  assert.deepEqual(snapshot(a, tab), snapshot(c, tab))
  // Bold and number format were set by different people on the same cell and both survive.
  const formula = Object.entries(snapshot(a, tab)).find(([, v]) => v[0].startsWith('='))
  assert.deepEqual(formula[1][2], { b: true, num: '0.00' })
})

test('a row deleted on one device while another writes into it drops the write cleanly', () => {
  const { a, b, tab } = pair()
  model.setCell(a, tab, 3, 1, '=A2')
  model.applyUpdate(b, model.encodeState(a))
  const ua = model.deleteRows(a, tab, 2)
  const ub = model.setCell(b, tab, 2, 1, 'orphan')
  model.applyUpdate(a, ub)
  model.applyUpdate(b, ua)
  assert.deepEqual(snapshot(a, tab), snapshot(b, tab))
  assert.equal(model.getInput(a, tab, 2, 1), '=#REF!')
  assert.ok(!JSON.stringify(snapshot(a, tab)).includes('orphan'))
})

test('a malformed update is skipped without changing the document', () => {
  const g = new GuardedDoc()
  const src = model.createDoc()
  g.apply(model.initSheet(src))
  const tab = model.tabIds(g.doc)[0]
  const good = model.setCell(src, tab, 1, 1, 'ok')
  const before = Y.encodeStateVector(g.doc)
  const bad = new Uint8Array(good)
  bad[bad.length >> 1] ^= 0xff
  bad[3] = 0xff
  const accepted = g.apply(bad)
  if (!accepted) assert.deepEqual(Y.encodeStateVector(g.doc), before)
  assert.equal(g.apply(good), true)
  assert.equal(model.getInput(g.doc, tab, 1, 1), 'ok')
  assert.equal(g.apply(new Uint8Array([255, 255, 255, 255, 255])), false)
  assert.equal(g.skipped >= 1, true)
})

test('asking for a sheet before it exists does not break loading it later', async () => {
  const { createSheets } = require('../src/worklet/sheets')
  let base = null
  const sheets = createSheets({ emit: () => {}, getBase: () => base })
  await assert.rejects(sheets.load('s1'), /unknown sheet/)
  const Hyperbee = require('hyperbee')
  const Corestore = require('corestore')
  const store = new Corestore(require('./helpers').tmpDir())
  const view = new Hyperbee(store.get({ name: 'v' }), { keyEncoding: 'utf-8', valueEncoding: 'json' })
  const src = model.createDoc()
  await view.put('y/aa/000000000001', { data: Buffer.from(model.initSheet(src)).toString('base64') })
  base = { ready: async () => {}, view, on: () => {} }
  const e = await sheets.load('s1')
  assert.equal(model.tabIds(e.guarded.doc).length, 1)
  await store.close()
})
