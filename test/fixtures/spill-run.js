// Evaluates the spill corpus: { cell: block } where block is rows of
// values ({ error } for errors), or { error } when the anchor itself is one.
const { colToNum } = require('../../src/shared/a1')
const model = require('../../src/shared/sheetModel')
const { evaluateSheet } = require('../../src/shared/formula')
const { inputs, cases, SPACING } = require('./spill-corpus')

function pos (a1) {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)
  return { row: Number(m[2]), col: colToNum(m[1]) }
}

function runSpillCorpus () {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  model.insertRows(doc, tab, 101, cases.length * SPACING)
  for (const [a1, v] of Object.entries(inputs)) { const p = pos(a1); model.setCell(doc, tab, p.row, p.col, v) }
  for (const [a1, f] of cases) { const p = pos(a1); model.setCell(doc, tab, p.row, p.col, f) }
  const values = evaluateSheet(doc).get(tab)
  const one = (v) => (!v ? null : v.error ? { error: v.error } : v.value)
  const out = {}
  for (const [a1] of cases) {
    const p = pos(a1)
    const anchor = values.get(p.row + ',' + p.col)
    if (!anchor || !anchor.spill) { out[a1] = [[one(anchor)]]; continue }
    const block = []
    for (let r = 0; r < anchor.spill.rows; r++) {
      const line = []
      for (let c = 0; c < anchor.spill.cols; c++) line.push(one(values.get((p.row + r) + ',' + (p.col + c))))
      block.push(line)
    }
    out[a1] = block
  }
  return out
}

module.exports = { runSpillCorpus }
