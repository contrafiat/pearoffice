// OpenDocument spreadsheets (.ods, LibreOffice and OpenOffice). SheetJS reads
// and writes the values and tabs, but its formula conversion loses $ signs,
// garbles references to other tabs and turns commas inside text into
// semicolons, and it reads tab names with "&" as "&amp;". So the formulas
// and the tab names are handled here, straight in the file's content.xml.
//
// Formulas here are in the .xlsx file form (src/sheet/xlsxMap.js toFile and
// fromFile): A1 references, commas, _xlfn. prefixes, ANCHORARRAY for A2#.
// In a .ods file they are OpenFormula: "of:=SUM([.A1:.B2];[$'Other tab'.C3])".

// Functions LibreOffice stores with a COM.MICROSOFT. prefix (Excel-only, or
// newer than OpenFormula).
const MICROSOFT = new Set(['ANCHORARRAY', 'CHOOSECOLS', 'CHOOSEROWS', 'CONCAT', 'DROP', 'EXPAND', 'FILTER', 'HSTACK', 'IFS', 'LET',
  'MAXIFS', 'MINIFS', 'RANDARRAY', 'SEQUENCE', 'SORT', 'SORTBY', 'SWITCH', 'TAKE', 'TEXTAFTER', 'TEXTBEFORE', 'TEXTJOIN', 'TEXTSPLIT',
  'TOCOL', 'TOROW', 'UNIQUE', 'VSTACK', 'WRAPCOLS', 'WRAPROWS', 'XLOOKUP', 'XMATCH'])

const CELL = '\\$?[A-Za-z]{1,3}\\$?\\d+'
const SHEET = "(?:'(?:[^']|'')+'|[A-Za-z_][\\w.]*)!"
// A reference in the .xlsx form, from where it starts: an optional tab, then
// a cell, a box, whole columns or whole rows. Not followed by "(" (LOG10(
// is a function) or another name character.
const XLSX_REF = new RegExp('^(' + SHEET + ')?(' + CELL + '(?::' + CELL + ')?|\\$?[A-Za-z]{1,3}:\\$?[A-Za-z]{1,3}|\\$?\\d+:\\$?\\d+)(?![\\w.(!])')

const unquote = (s) => (s[0] === "'" ? s.slice(1, -1).replace(/''/g, "'") : s)
// A tab name as an .xlsx formula needs it: bare when it is a plain name that
// cannot be read as a cell, else in quotes.
const sheetForXlsx = (name) => (/^[A-Za-z_][\w.]*$/.test(name) && !/^[A-Za-z]{1,3}\d+$/.test(name) && !/^(TRUE|FALSE)$/i.test(name) ? name : "'" + name.replace(/'/g, "''") + "'")

// .xlsx form -> OpenFormula, with the "of:=" prefix.
function toOds (f) {
  let out = ''
  let i = 0
  let inArray = false
  const s = String(f)
  while (i < s.length) {
    const ch = s[i]
    const prev = i > 0 ? s[i - 1] : ''
    if (ch === '"') {
      const m = /^"(?:[^"]|"")*"?/.exec(s.slice(i))[0]
      out += m
      i += m.length
      continue
    }
    if (ch === '{') { inArray = true; out += ch; i++; continue }
    if (ch === '}') { inArray = false; out += ch; i++; continue }
    if (ch === ',') { out += ';'; i++; continue }
    if (ch === ';') { out += inArray ? '|' : ';'; i++; continue }
    const startOfToken = !/[\w.$]/.test(prev)
    if (startOfToken) {
      const ref = XLSX_REF.exec(s.slice(i))
      if (ref) {
        const sheet = ref[1] ? unquote(ref[1].slice(0, -1)) : null
        const [a, b] = ref[2].split(':')
        const head = sheet === null ? '.' : "$'" + sheet.replace(/'/g, "''") + "'."
        out += '[' + head + a + (b ? ':.' + b : '') + ']'
        i += ref[0].length
        continue
      }
      const name = /^[A-Za-z_][\w.]*/.exec(s.slice(i))
      if (name) {
        let n = name[0]
        const call = s[i + n.length] === '('
        i += n.length
        if (call) {
          n = n.replace(/^_xlfn\.(_xlws\.)?/i, '')
          if (MICROSOFT.has(n.toUpperCase())) n = 'COM.MICROSOFT.' + n
        } else if (/^(TRUE|FALSE)$/i.test(n)) {
          n = n.toUpperCase() + '()'
        }
        out += n
        continue
      }
      const num = /^\d+(?:\.\d*)?(?:[eE][+-]?\d+)?/.exec(s.slice(i))
      if (num) { out += num[0]; i += num[0].length; continue }
    }
    out += ch
    i++
  }
  return 'of:=' + out
}

// One OpenFormula reference (what is inside [ ]) -> the .xlsx form.
function refFromOds (inner) {
  if (/#REF!/i.test(inner)) return '#REF!'
  // Split at ":" outside quotes.
  const parts = []
  let cur = ''
  let q = false
  for (const ch of inner) {
    if (ch === "'") q = !q
    if (ch === ':' && !q) { parts.push(cur); cur = '' } else cur += ch
  }
  parts.push(cur)
  let sheet = null
  const addrs = parts.map((p) => {
    const m = /^\$?('(?:[^']|'')*'|[^.]*)\.(.*)$/.exec(p)
    if (!m) return p
    if (m[1] && sheet === null) sheet = unquote(m[1])
    return m[2]
  })
  return (sheet ? sheetForXlsx(sheet) + '!' : '') + addrs.join(':')
}

// OpenFormula ("of:=..." or "=...") -> the .xlsx form, without "=".
function fromOds (f) {
  let s = String(f).replace(/^(?:[a-z]+:)?=/i, '')
  let out = ''
  let i = 0
  let inArray = false
  while (i < s.length) {
    const ch = s[i]
    if (ch === '"') {
      const m = /^"(?:[^"]|"")*"?/.exec(s.slice(i))[0]
      out += m
      i += m.length
      continue
    }
    if (ch === '[') {
      const end = s.indexOf(']', i)
      const inner = s.slice(i + 1, end < 0 ? s.length : end)
      out += refFromOds(inner)
      i = end < 0 ? s.length : end + 1
      continue
    }
    if (ch === '{') { inArray = true; out += ch; i++; continue }
    if (ch === '}') { inArray = false; out += ch; i++; continue }
    if (ch === ';') { out += ','; i++; continue }
    if (ch === '|' && inArray) { out += ';'; i++; continue }
    if (ch === '!') { out += ' '; i++; continue } // intersection
    const name = !/[\w.]/.test(i > 0 ? s[i - 1] : '') && /^[A-Za-z_][\w.]*/.exec(s.slice(i))
    if (name) {
      let n = name[0]
      i += n.length
      n = n.replace(/^COM\.MICROSOFT\./i, '').replace(/^_xlpm\./i, '')
      if (/^(TRUE|FALSE)$/i.test(n) && s.slice(i, i + 2) === '()') { i += 2; n = n.toUpperCase() }
      out += n
      continue
    }
    out += ch
    i++
  }
  return out
}

const XML_ENTITIES = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'" }
const unescapeXml = (s) => String(s).replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) =>
  e[0] === '#' ? String.fromCodePoint(e[1] === 'x' || e[1] === 'X' ? parseInt(e.slice(2), 16) : Number(e.slice(1))) : (XML_ENTITIES[e] ?? m))
const escapeXml = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? unescapeXml(m[1]) : null }

// The tabs of a .ods file's content.xml: each one's name and its formulas by
// position, { name, formulas: Map('row,col' (from 0) -> OpenFormula) }.
function odsTabs (contentXml) {
  const tabs = []
  let tab = null
  let depth = 0 // tables inside cells (rare) are not tabs
  let row = 0
  let col = 0
  const re = /<(\/?)table:(table-row|table-cell|covered-table-cell|table)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(contentXml))) {
    const [, close, kind, attrs, selfClose] = m
    if (kind === 'table') {
      if (close) { depth--; if (depth === 0) tab = null; continue }
      depth++
      if (depth === 1) { tab = { name: attr(attrs, 'table:name') || 'Sheet' + (tabs.length + 1), formulas: new Map() }; tabs.push(tab); row = 0 }
      if (selfClose) { depth--; if (depth === 0) tab = null }
      continue
    }
    if (!tab || depth !== 1 || close) continue
    if (kind === 'table-row') {
      tab.rowAt = row
      row += Number(attr(attrs, 'table:number-rows-repeated')) || 1
      col = 0
      continue
    }
    const f = kind === 'table-cell' ? attr(attrs, 'table:formula') : null
    if (f) tab.formulas.set(tab.rowAt + ',' + col, f)
    col += Number(attr(attrs, 'table:number-columns-repeated')) || 1
  }
  return tabs.map((t) => ({ name: t.name, formulas: t.formulas }))
}

// Fix a workbook SheetJS read from a .ods file: the tab names as the file has
// them, and every formula from the file converted here.
function fixOdsWorkbook (XLSX, fflate, wb, bytes) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: (f) => f.name === 'content.xml' }) } catch { return wb }
  if (!files['content.xml']) return wb
  const tabs = odsTabs(fflate.strFromU8(files['content.xml']))
  const names = wb.SheetNames.slice()
  tabs.forEach((t, i) => {
    if (i >= names.length) return
    const ws = wb.Sheets[names[i]]
    if (t.name !== names[i]) { delete wb.Sheets[names[i]]; wb.Sheets[t.name] = ws; wb.SheetNames[i] = t.name }
    for (const k of Object.keys(ws)) if (k[0] !== '!' && ws[k].f) delete ws[k].f
    for (const [pos, f] of t.formulas) {
      const [r, c] = pos.split(',').map(Number)
      const ref = XLSX.utils.encode_cell({ r, c })
      if (!ws[ref]) ws[ref] = { t: 'n', v: 0 }
      ws[ref].f = fromOds(f)
    }
  })
  return wb
}

// A workbook as .ods bytes: SheetJS writes it with each formula replaced by a
// marker, then the markers are swapped for the formulas converted here, and
// the charts are added (src/sheet/odsCharts.js). tabs: [{ name, charts }] in
// sheet order.
function writeOds (XLSX, fflate, wb, tabs = []) {
  const formulas = []
  wb.SheetNames.forEach((name, t) => {
    // A chart's anchor cell must be inside the range SheetJS writes.
    const ws = wb.Sheets[name]
    const anchors = ((tabs[t] && tabs[t].charts) || []).filter((c) => c.anchor).map((c) => c.anchor)
    if (anchors.length) {
      const range = XLSX.utils.decode_range(ws['!ref'] || 'A1:A1')
      for (const a of anchors) { range.e.r = Math.max(range.e.r, a.row - 1); range.e.c = Math.max(range.e.c, a.col - 1) }
      ws['!ref'] = XLSX.utils.encode_range(range)
    }
  })
  for (const name of wb.SheetNames) {
    const ws = wb.Sheets[name]
    for (const k of Object.keys(ws)) {
      if (k[0] === '!' || !ws[k].f) continue
      // A spilling formula goes out as a plain formula in its first cell.
      delete ws[k].F
      delete ws[k].D
      formulas.push(toOds(ws[k].f))
      ws[k].f = '"PEAROFFICEF' + (formulas.length - 1) + '"'
    }
  }
  const files = fflate.unzipSync(new Uint8Array(XLSX.write(wb, { type: 'array', bookType: 'ods' })))
  const xml = fflate.strFromU8(files['content.xml'])
  files['content.xml'] = fflate.strToU8(xml
    .replace(/table:formula="of:=(?:&quot;|")PEAROFFICEF(\d+)(?:&quot;|")"/g, (m, n) => 'table:formula="' + escapeXml(formulas[Number(n)]) + '"')
    // Notes stay hidden until hovered, as in the app and in .xlsx files.
    .replace(/<office:annotation office:display="true"/g, '<office:annotation office:display="false"'))
  require('./odsCharts').addChartsToOds(files, tabs, fflate)
  // The mimetype entry must come first and stay uncompressed.
  const out = { mimetype: [files.mimetype, { level: 0 }] }
  for (const [k, v] of Object.entries(files)) if (k !== 'mimetype') out[k] = v
  return fflate.zipSync(out)
}
module.exports = { toOds, fromOds, odsTabs, fixOdsWorkbook, writeOds, unescapeXml }
