// Single-value functions over a range (proposals/2026-10-04-functions-over-ranges.md):
// every function corpus case whose function takes a single value somewhere,
// with that argument (the first literal one) turned into a two-value column
// {x;x}. The answer must be two cells, checked against LibreOffice
// (scripts/spill-expectations.js lift writes test/fixtures/lift-expected.json).

const { inputs, cases: functionCases, EXCEL_OVERRIDES: FUNCTION_OVERRIDES } = require('./function-corpus')
const { LIFT } = require('../../src/sheet/formula/lift')

// Top-level arguments of the outermost call, as text.
function splitCall (f) {
  const m = /^=([A-Z][A-Z0-9.]*)\((.*)\)$/s.exec(f)
  if (!m) return null
  const args = []
  let depth = 0
  let cur = ''
  let quote = false
  for (const ch of m[2]) {
    if (ch === '"') quote = !quote
    if (!quote && (ch === '(' || ch === '{')) depth++
    if (!quote && (ch === ')' || ch === '}')) depth--
    if (!quote && depth === 0 && ch === ',') { args.push(cur.trim()); cur = '' } else cur += ch
  }
  args.push(cur.trim())
  return { name: m[1], args }
}

const LITERAL = /^(-?\d+(\.\d+)?|"(?:[^"]|"")*"|TRUE|FALSE)$/i
const SPACING = 3
const formulas = []
const origin = {}
for (const [, f] of functionCases) {
  const call = splitCall(f)
  if (!call || !LIFT[call.name]) continue
  const at = LIFT[call.name].find((p) => p < call.args.length && LITERAL.test(call.args[p]))
  if (at === undefined) continue
  const args = call.args.slice()
  args[at] = '{' + args[at] + ';' + args[at] + '}'
  const lifted = '=' + call.name + '(' + args.join(', ') + ')'
  formulas.push(lifted)
  origin[lifted] = f
}

const cases = formulas.map((f, i) => ['AH' + (1 + i * SPACING), f])
// Excel's answer where LibreOffice's differs: the function corpus's
// overrides, twice; and YEARFRAC, whose basis LibreOffice does not take as
// an array (Err:502).
const EXCEL_OVERRIDES = {}
for (const f of formulas) if (origin[f] in FUNCTION_OVERRIDES) EXCEL_OVERRIDES[f] = [[FUNCTION_OVERRIDES[origin[f]][0]], [FUNCTION_OVERRIDES[origin[f]][0]]]
EXCEL_OVERRIDES['=YEARFRAC(E1, E5, {1;1})'] = [[0.9972677595628415], [0.9972677595628415]]

module.exports = { inputs, cases, EXCEL_OVERRIDES, SPACING }
