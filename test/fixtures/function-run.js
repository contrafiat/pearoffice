// Evaluates the function corpus: { cell: value | { error } }.
const { colToNum } = require('../../src/sheet/a1')
const model = require('../../src/sheet/sheetModel')
const { evaluateSheet } = require('../../src/sheet/formula')
const { inputs, cases } = require('./function-corpus')

function pos (a1) {
  const m = /^([A-Z]+)(\d+)$/.exec(a1)
  return { row: Number(m[2]), col: colToNum(m[1]) }
}

function runFunctionCorpus () {
  const doc = model.createDoc()
  model.initSheet(doc)
  const tab = model.tabIds(doc)[0]
  for (const [a1, v] of Object.entries(inputs)) { const p = pos(a1); model.setCell(doc, tab, p.row, p.col, v) }
  for (const [a1, f] of cases) { const p = pos(a1); model.setCell(doc, tab, p.row, p.col, f) }
  const values = evaluateSheet(doc).get(tab)
  const out = {}
  for (const [a1] of cases) {
    const p = pos(a1)
    const v = values.get(p.row + ',' + p.col)
    out[a1] = !v ? null : v.error ? { error: v.error } : v.value
  }
  return out
}

module.exports = { runFunctionCorpus }
