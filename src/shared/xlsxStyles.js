// Cell styles in .xlsx files (proposals/2026-10-04-cell-formats.md). SheetJS
// Community Edition writes no styles, so after it has written the workbook
// this replaces xl/styles.xml with one built from the cells' formats (fonts,
// fills, borders, number formats, alignment) and gives each formatted cell
// its style number.

const STYLE_ATTRS = ['b', 'i', 'u', 's', 'size', 'font', 'color', 'fill', 'num', 'align', 'valign', 'wrap', 'bt', 'br', 'bb', 'bl']
const FONT_NAMES = { serif: 'Times New Roman', mono: 'Consolas' }
const DEFAULT_FONT = 'Calibri'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const argb = (hex) => 'FF' + String(hex).replace('#', '').toUpperCase()

function styleKey (fmt) {
  const f = {}
  for (const a of STYLE_ATTRS) if (fmt && fmt[a] !== undefined && fmt[a] !== null && fmt[a] !== false) f[a] = fmt[a]
  return Object.keys(f).length ? JSON.stringify(f) : null
}

// A list that hands back the position of each distinct entry.
function table (first) {
  const items = [...first]
  const at = new Map(items.map((x, i) => [x, i]))
  return { add: (x) => { if (!at.has(x)) { at.set(x, items.length); items.push(x) } return at.get(x) }, items }
}

function fontXml (f) {
  return '<font>' + (f.b ? '<b/>' : '') + (f.i ? '<i/>' : '') + (f.s ? '<strike/>' : '') + (f.u ? '<u/>' : '') +
    '<sz val="' + (f.size || 11) + '"/>' + (f.color ? '<color rgb="' + argb(f.color) + '"/>' : '<color theme="1"/>') +
    '<name val="' + (FONT_NAMES[f.font] || DEFAULT_FONT) + '"/><family val="' + (f.font === 'serif' ? 1 : f.font === 'mono' ? 3 : 2) + '"/></font>'
}
function side (tag, v) {
  if (!v) return '<' + tag + '/>'
  const [kind, color] = String(v).split(':')
  return '<' + tag + ' style="' + kind + '"><color ' + (color ? 'rgb="' + argb(color) + '"' : 'auto="1"') + '/></' + tag + '>'
}
const borderXml = (f) => '<border>' + side('left', f.bl) + side('right', f.br) + side('top', f.bt) + side('bottom', f.bb) + '<diagonal/></border>'
const fillXml = (hex) => '<fill><patternFill patternType="solid"><fgColor rgb="' + argb(hex) + '"/><bgColor indexed="64"/></patternFill></fill>'

// tabs: [{ cells: [{ row, col, fmt }] }] in sheet order. files: the unzipped
// workbook (path -> bytes), changed in place.
function addStyles (files, tabs, { strToU8, strFromU8 }) {
  const fonts = table(['<font><sz val="11"/><color theme="1"/><name val="' + DEFAULT_FONT + '"/><family val="2"/></font>'])
  const fills = table(['<fill><patternFill patternType="none"/></fill>', '<fill><patternFill patternType="gray125"/></fill>'])
  const borders = table(['<border><left/><right/><top/><bottom/><diagonal/></border>'])
  const numFmts = new Map() // code -> id
  const xfs = table(['<xf numFmtId="0" fontId="0" fillId="0" borderId="0" xfId="0"/>'])
  const byKey = new Map()

  function xfFor (fmt) {
    const key = styleKey(fmt)
    if (!key) return 0
    if (byKey.has(key)) return byKey.get(key)
    const f = JSON.parse(key)
    const fontId = fonts.add(fontXml(f))
    const fillId = f.fill ? fills.add(fillXml(f.fill)) : 0
    const borderId = f.bt || f.br || f.bb || f.bl ? borders.add(borderXml(f)) : 0
    let numFmtId = 0
    if (f.num) {
      if (!numFmts.has(f.num)) numFmts.set(f.num, 164 + numFmts.size)
      numFmtId = numFmts.get(f.num)
    }
    const align = f.align || f.valign || f.wrap
      ? '<alignment' + (f.align ? ' horizontal="' + f.align + '"' : '') + (f.valign ? ' vertical="' + (f.valign === 'middle' ? 'center' : f.valign) + '"' : '') + (f.wrap ? ' wrapText="1"' : '') + '/>'
      : ''
    const xf = '<xf numFmtId="' + numFmtId + '" fontId="' + fontId + '" fillId="' + fillId + '" borderId="' + borderId + '" xfId="0"' +
      (numFmtId ? ' applyNumberFormat="1"' : '') + (fontId ? ' applyFont="1"' : '') + (fillId ? ' applyFill="1"' : '') + (borderId ? ' applyBorder="1"' : '') +
      (align ? ' applyAlignment="1">' + align + '</xf>' : '/>')
    const id = xfs.add(xf)
    byKey.set(key, id)
    return id
  }

  tabs.forEach((tab, t) => {
    const path = 'xl/worksheets/sheet' + (t + 1) + '.xml'
    if (!files[path]) return
    const styleOf = new Map()
    for (const cell of tab.cells || []) {
      const id = xfFor(cell.fmt)
      if (id) styleOf.set(encode(cell.row, cell.col), id)
    }
    files[path] = strToU8(restyle(strFromU8(files[path]), styleOf))
  })

  const numFmtXml = numFmts.size
    ? '<numFmts count="' + numFmts.size + '">' + [...numFmts].map(([code, id]) => '<numFmt numFmtId="' + id + '" formatCode="' + esc(code) + '"/>').join('') + '</numFmts>'
    : ''
  files['xl/styles.xml'] = strToU8('<?xml version="1.0" encoding="UTF-8" standalone="yes"?>\n' +
    '<styleSheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' + numFmtXml +
    '<fonts count="' + fonts.items.length + '">' + fonts.items.join('') + '</fonts>' +
    '<fills count="' + fills.items.length + '">' + fills.items.join('') + '</fills>' +
    '<borders count="' + borders.items.length + '">' + borders.items.join('') + '</borders>' +
    '<cellStyleXfs count="1"><xf numFmtId="0" fontId="0" fillId="0" borderId="0"/></cellStyleXfs>' +
    '<cellXfs count="' + xfs.items.length + '">' + xfs.items.join('') + '</cellXfs>' +
    '<cellStyles count="1"><cellStyle name="Normal" xfId="0" builtinId="0"/></cellStyles>' +
    '<dxfs count="0"/><tableStyles count="0" defaultTableStyle="TableStyleMedium9" defaultPivotStyle="PivotStyleLight16"/></styleSheet>')
}

// The sheet XML with every cell's style number replaced by ours (SheetJS's
// would point into a styles part that is gone), and an empty cell added for
// each styled cell SheetJS left out (it writes no blank cells).
function restyle (xml, styleOf) {
  const m = /<sheetData>([\s\S]*?)<\/sheetData>|<sheetData\/>/.exec(xml)
  if (!m) return xml
  const rows = new Map() // row -> { attrs, cells: Map col -> xml }
  const ROW = /<row r="(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/row>)/g
  const CELL = /<c r="([A-Z]+)(\d+)"([^>]*?)(?:\/>|>([\s\S]*?)<\/c>)/g
  for (let r; (r = ROW.exec(m[1] || ''));) {
    const cells = new Map()
    for (let c; (c = CELL.exec(r[3] || ''));) cells.set(colNum(c[1]), { letters: c[1], attrs: c[3].replace(/\s+s="\d+"/, ''), body: c[4] })
    rows.set(Number(r[1]), { attrs: r[2].replace(/\s+(s|customFormat)="\d+"/g, ''), cells })
  }
  for (const [ref, id] of styleOf) {
    const [, letters, rowText] = /^([A-Z]+)(\d+)$/.exec(ref)
    const row = Number(rowText)
    if (!rows.has(row)) rows.set(row, { attrs: '', cells: new Map() })
    const cells = rows.get(row).cells
    const col = colNum(letters)
    if (!cells.has(col)) cells.set(col, { letters, attrs: '', body: undefined })
    cells.get(col).style = id
  }
  const body = [...rows.keys()].sort((a, b) => a - b).map((row) => {
    const { attrs, cells } = rows.get(row)
    const inner = [...cells.keys()].sort((a, b) => a - b).map((col) => {
      const c = cells.get(col)
      const open = '<c r="' + c.letters + row + '"' + c.attrs + (c.style ? ' s="' + c.style + '"' : '')
      return c.body === undefined ? open + '/>' : open + '>' + c.body + '</c>'
    }).join('')
    return '<row r="' + row + '"' + attrs + '>' + inner + '</row>'
  }).join('')
  return xml.slice(0, m.index) + '<sheetData>' + body + '</sheetData>' + xml.slice(m.index + m[0].length)
}

function colNum (letters) {
  let n = 0
  for (const ch of letters) n = n * 26 + ch.charCodeAt(0) - 64
  return n
}

// A1 reference for a row and column.
function encode (row, col) {
  let s = ''
  for (let n = col; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + ((n - 1) % 26)) + s
  return s + row
}

module.exports = { addStyles }
