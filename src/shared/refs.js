// Formula references: A1 text for people, stable ids for storage.
//
// A formula is stored with every cell reference replaced by the ids of its row
// and column, so inserting or deleting rows never requires rewriting formulas
// that other people are editing at the same time. See the wire protocol
// proposal, section 3.
//
// Stored token grammar (ids never contain these delimiters, see ids.js):
//
//   {rowId.colId}         a cell            A1
//   {$rowId.$colId}       absolute parts    $A$1
//   {.colId}              a whole column    A (only as a range end: A:A)
//   {rowId.}              a whole row       1 (only as a range end: 1:1)
//   {tabId|rowId.colId}   on another tab    'Tab name'!A1
//
// A range is two tokens joined by ':'. A token whose row, column or tab no
// longer exists shows as #REF!.

const { MAX_ROWS, MAX_COLS, colToNum, numToCol } = require('./a1')

const REF_ERROR = '#REF!'

// Context for one tab, built by the sheet model:
//   tabId, tabs: [{ id, name, rows: [ids], cols: [ids] }]
//   extend(tabId, rowCount, colCount) -> grows the tab so the index exists (optional)
function indexTabs (tabs) {
  const byId = new Map()
  const byName = new Map()
  for (const t of tabs) {
    const entry = {
      ...t,
      rowIndex: new Map(t.rows.map((id, i) => [id, i + 1])),
      colIndex: new Map(t.cols.map((id, i) => [id, i + 1]))
    }
    byId.set(t.id, entry)
    byName.set(t.name.toUpperCase(), entry)
  }
  return { byId, byName }
}

// Walk the formula, calling onCode for text outside string literals and
// passing string literals through untouched.
function mapOutsideStrings (formula, onCode) {
  let out = ''
  let i = 0
  while (i < formula.length) {
    const q = formula.indexOf('"', i)
    if (q === -1) { out += onCode(formula.slice(i)); break }
    out += onCode(formula.slice(i, q))
    // A literal ends at the next quote that is not doubled ("" is an escaped quote).
    let j = q + 1
    while (j < formula.length) {
      if (formula[j] === '"') {
        if (formula[j + 1] === '"') { j += 2; continue }
        break
      }
      j++
    }
    out += formula.slice(q, j + 1)
    i = j + 1
  }
  return out
}

const PREFIX = String.raw`(?:'((?:[^']|'')+)'|([A-Za-z_][A-Za-z0-9_.]*))!`
const CELL = String.raw`(\$?)([A-Za-z]{1,3})(\$?)([0-9]+)`
const A1_RE = new RegExp(
  String.raw`(?:${PREFIX})?(?:` +
    CELL + String.raw`(?::` + CELL + String.raw`)?` + // A1 or A1:B2
    String.raw`|(\$?)([A-Za-z]{1,3}):(\$?)([A-Za-z]{1,3})` + // A:B
    String.raw`|(\$?)([0-9]+):(\$?)([0-9]+)` + // 1:2
  ')', 'y')

const BEFORE_OK = /[^A-Za-z0-9_.$'!]/
const AFTER_BAD = /[A-Za-z0-9_(.!]/

// A1 text (without the leading '=') -> stored form. Grows the tab through
// ctx.extend when a reference points past its current edge.
function toStored (formula, ctx) {
  let tabs = indexTabs(ctx.tabs)

  function lookupTab (quoted, bare) {
    if (quoted === undefined && bare === undefined) return tabs.byId.get(ctx.tabId)
    const name = quoted !== undefined ? quoted.replace(/''/g, "'") : bare
    return tabs.byName.get(name.toUpperCase()) || null
  }

  function rowId (tab, n) {
    if (n < 1 || n > MAX_ROWS) return null
    if (n > tab.rows.length) {
      if (!ctx.extend) return null
      ctx.extend(tab.id, n, 0)
      tabs = indexTabs(ctx.tabs)
      tab = tabs.byId.get(tab.id)
    }
    return tab.rows[n - 1]
  }

  function colId (tab, n) {
    if (n < 1 || n > MAX_COLS) return null
    if (n > tab.cols.length) {
      if (!ctx.extend) return null
      ctx.extend(tab.id, 0, n)
      tabs = indexTabs(ctx.tabs)
      tab = tabs.byId.get(tab.id)
    }
    return tab.cols[n - 1]
  }

  function token (tab, prefixed, r$, rid, c$, cid) {
    const t = prefixed ? tab.id + '|' : ''
    return '{' + t + (rid === '' ? '' : r$ + rid) + '.' + (cid === '' ? '' : c$ + cid) + '}'
  }

  return mapOutsideStrings(formula, (code) => {
    let out = ''
    let i = 0
    while (i < code.length) {
      const prev = i === 0 ? ' ' : code[i - 1]
      A1_RE.lastIndex = i
      const m = BEFORE_OK.test(prev) ? A1_RE.exec(code) : null
      const next = m ? code[i + m[0].length] : undefined
      if (!m || (next !== undefined && AFTER_BAD.test(next))) { out += code[i++]; continue }

      const prefixed = m[1] !== undefined || m[2] !== undefined
      const tab = lookupTab(m[1], m[2])
      let rep = REF_ERROR
      if (tab) {
        if (m[4] !== undefined) {
          const r1 = rowId(tab, Number(m[6]))
          const c1 = colId(tab, colToNum(m[4]))
          if (m[8] === undefined) {
            if (r1 && c1) rep = token(tab, prefixed, m[5], r1, m[3], c1)
          } else {
            const r2 = rowId(tab, Number(m[10]))
            const c2 = colId(tab, colToNum(m[8]))
            if (r1 && c1 && r2 && c2) {
              const t = tabs.byId.get(tab.id)
              rep = token(t, prefixed, m[5], r1, m[3], c1) + ':' + token(t, prefixed, m[9], r2, m[7], c2)
            }
          }
        } else if (m[12] !== undefined) {
          const c1 = colId(tab, colToNum(m[12]))
          const c2 = colId(tab, colToNum(m[14]))
          if (c1 && c2) rep = token(tab, prefixed, '', '', m[11], c1) + ':' + token(tab, prefixed, '', '', m[13], c2)
        } else {
          const r1 = rowId(tab, Number(m[16]))
          const r2 = rowId(tab, Number(m[18]))
          if (r1 && r2) rep = token(tab, prefixed, m[15], r1, '', '') + ':' + token(tab, prefixed, m[17], r2, '', '')
        }
      }
      out += rep
      i += m[0].length
    }
    return out
  })
}

const TOKEN_RE = /\{(?:([A-Za-z0-9_-]+)\|)?(\$?)([A-Za-z0-9_-]*)\.(\$?)([A-Za-z0-9_-]*)\}/g

function quoteTab (name) {
  return /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"
}

// Stored form -> A1 text (without the leading '='). `tabs` may be a prebuilt
// index from indexTabs to avoid rebuilding it for every cell.
function toDisplay (stored, ctx, prebuilt) {
  const tabs = prebuilt || indexTabs(ctx.tabs)
  return mapOutsideStrings(stored, (code) => {
    // Resolve every token first, then join ranges so a cross-tab range prints
    // its tab name once (Tab!A1:B2), as Excel writes it.
    const parts = []
    let last = 0
    TOKEN_RE.lastIndex = 0
    let m
    while ((m = TOKEN_RE.exec(code)) !== null) {
      parts.push({ text: code.slice(last, m.index) })
      const tab = m[1] ? tabs.byId.get(m[1]) : tabs.byId.get(ctx.tabId)
      let a1 = null
      if (tab) {
        const r = m[3] === '' ? '' : tab.rowIndex.get(m[3])
        const c = m[5] === '' ? '' : tab.colIndex.get(m[5])
        if (r !== undefined && c !== undefined) a1 = (c === '' ? '' : m[4] + numToCol(c)) + (r === '' ? '' : m[2] + r)
      }
      parts.push({ ref: true, a1, tab: m[1] ? tab : null })
      last = m.index + m[0].length
    }
    parts.push({ text: code.slice(last) })

    let out = ''
    for (let k = 0; k < parts.length; k++) {
      const p = parts[k]
      if (!p.ref) { out += p.text; continue }
      const isRange = parts[k + 1] && parts[k + 1].text === ':' && parts[k + 2] && parts[k + 2].ref
      if (isRange) {
        const q = parts[k + 2]
        if (p.a1 === null || q.a1 === null) out += REF_ERROR
        else out += (p.tab ? quoteTab(p.tab.name) + '!' : '') + p.a1 + ':' + q.a1
        k += 2
        continue
      }
      out += p.a1 === null ? REF_ERROR : (p.tab ? quoteTab(p.tab.name) + '!' : '') + p.a1
    }
    return out
  })
}

module.exports = { toStored, toDisplay, indexTabs, REF_ERROR, TOKEN_RE }
