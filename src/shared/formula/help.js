// Formula help while typing: which function name is being typed, or which
// function's brackets the caret is in. Used by src/ui/FormulaHelp.jsx.

const { suggest, lookup } = require('./catalog')

// What the text up to the caret says about formula help: a function name
// being typed (partial), or the function whose brackets the caret is in (fn)
// and which of its arguments (arg, from 0).
function analyze (value, caret) {
  if (typeof value !== 'string' || value[0] !== '=') return null
  const before = value.slice(0, caret)
  // Inside a "string": no help.
  let quotes = 0
  for (const ch of before) if (ch === '"') quotes++
  if (quotes % 2 === 1) return null
  const m = /(^|[^A-Za-z0-9_.$!:'])([A-Za-z_][A-Za-z0-9._]*)$/.exec(before)
  // A cell reference like B12 is not a function name being typed.
  if (m && !/^[A-Za-z]{1,3}\d+$/.test(m[2]) && value[caret] !== '(') return { partial: m[2] }
  // Innermost open bracket before the caret, skipping strings.
  const stack = []
  let inString = false
  for (let i = 1; i < before.length; i++) {
    const ch = before[i]
    if (ch === '"') { inString = !inString; continue }
    if (inString) continue
    if (ch === '(') stack.push({ at: i, commas: 0 })
    else if (ch === ')') stack.pop()
    else if ((ch === ',' || ch === ';') && stack.length) stack[stack.length - 1].commas++
  }
  const open = stack[stack.length - 1]
  if (!open) return null
  const name = /([A-Za-z][A-Za-z0-9.]*)$/.exec(before.slice(0, open.at))
  return name ? { fn: name[1].toUpperCase(), arg: open.commas } : null
}

// names: the sheet's named ranges, [{ name, about }], offered before
// functions.
function helpFor (value, caret, names = []) {
  const a = analyze(value, caret)
  if (!a) return null
  if (a.partial) {
    const p = a.partial.toUpperCase()
    const named = names.filter((n) => n.name.toUpperCase().startsWith(p) && n.name.toUpperCase() !== p).map((n) => ({ name: n.name, about: n.about, isName: true }))
    const list = [...named, ...suggest(a.partial)]
    return list.length ? { partial: a.partial, list } : null
  }
  const f = lookup(a.fn)
  return f ? { signature: f, arg: a.arg } : null
}

// Text with the function name inserted in place of what was typed.
function insertFunction (value, caret, partial, name, isName = false) {
  const start = caret - partial.length
  const rest = value.slice(caret)
  if (isName) return { value: value.slice(0, start) + name + rest, caret: start + name.length }
  const add = rest[0] === '(' ? name : name + '('
  return { value: value.slice(0, start) + add + rest, caret: start + name.length + 1 }
}

module.exports = { analyze, helpFor, insertFunction }
