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

// --- reading styles from an imported file ----------------------------------

const attr = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag); return m ? m[1] : undefined }
const on = (xml, tag) => { const m = new RegExp('<' + tag + '(\\s[^>]*)?/?>').exec(xml); return !!m && !/\sval="(0|false|none)"/.test(m[0]) }
const children = (xml, tag) => { const out = []; const re = new RegExp('<' + tag + '(?:\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</' + tag + '>)', 'g'); for (let m; (m = re.exec(xml));) out.push(m[0]); return out }
const section = (xml, tag) => { const m = new RegExp('<' + tag + '(?:\\s[^>]*)?>([\\s\\S]*?)</' + tag + '>').exec(xml); return m ? m[1] : '' }

// Excel's first sixteen indexed colours (the rest are rare in modern files).
const INDEXED = ['000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF', '000000', 'FFFFFF', 'FF0000', '00FF00', '0000FF', 'FFFF00', 'FF00FF', '00FFFF']
// The default Office theme, in Excel's theme index order (lt1, dk1, lt2, dk2, accents).
const OFFICE_THEME = ['FFFFFF', '000000', 'E7E6E6', '44546A', '4472C4', 'ED7D31', 'A5A5A5', 'FFC000', '5B9BD5', '70AD47']

// The theme's colours in Excel's index order, from xl/theme/theme1.xml.
function themeColors (xml) {
  if (!xml) return OFFICE_THEME
  const scheme = section(xml, 'a:clrScheme')
  const get = (name) => { const m = new RegExp('<a:' + name + '>[\\s\\S]*?(?:srgbClr val|lastClr)="([0-9A-Fa-f]{6})"').exec(scheme); return m ? m[1].toUpperCase() : null }
  const order = ['lt1', 'dk1', 'lt2', 'dk2', 'accent1', 'accent2', 'accent3', 'accent4', 'accent5', 'accent6']
  return order.map((n, i) => get(n) || OFFICE_THEME[i])
}

// Lighten (tint > 0) or darken (tint < 0) a colour, as Excel does, in HSL.
function applyTint (hex, tint) {
  if (!tint) return hex
  let [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  let h = 0
  let sat = 0
  let l = (max + min) / 2
  if (max !== min) {
    const d = max - min
    sat = l > 0.5 ? d / (2 - max - min) : d / (max + min)
    h = max === r ? (g - b) / d + (g < b ? 6 : 0) : max === g ? (b - r) / d + 2 : (r - g) / d + 4
    h /= 6
  }
  l = tint < 0 ? l * (1 + tint) : l * (1 - tint) + tint
  const q = l < 0.5 ? l * (1 + sat) : l + sat - l * sat
  const p = 2 * l - q
  const hue = (t) => { if (t < 0) t += 1; if (t > 1) t -= 1; return t < 1 / 6 ? p + (q - p) * 6 * t : t < 1 / 2 ? q : t < 2 / 3 ? p + (q - p) * (2 / 3 - t) * 6 : p }
  ;[r, g, b] = sat === 0 ? [l, l, l] : [hue(h + 1 / 3), hue(h), hue(h - 1 / 3)]
  return [r, g, b].map((v) => Math.round(v * 255).toString(16).padStart(2, '0')).join('').toUpperCase()
}

// A <color .../> element -> 'RRGGBB', or null for automatic.
function colorOf (tag, theme) {
  if (!tag || attr(tag, 'auto') === '1') return null
  let hex = null
  const rgb = attr(tag, 'rgb')
  const th = attr(tag, 'theme')
  const ix = attr(tag, 'indexed')
  if (rgb && /^[0-9A-Fa-f]{6,8}$/.test(rgb)) hex = rgb.slice(-6).toUpperCase()
  else if (th !== undefined) hex = theme[Number(th)] || null
  else if (ix !== undefined) hex = INDEXED[Number(ix)] || null
  return hex ? applyTint(hex, Number(attr(tag, 'tint')) || 0) : null
}

const SERIF = /times|georgia|cambria|garamond|palatino|book antiqua|serif/i
const MONO = /consolas|courier|mono|menlo|lucida console|andale/i
const BORDER_KIND = { thin: 'thin', hair: 'thin', medium: 'medium', thick: 'thick', double: 'double', dashed: 'dashed', dotted: 'dashed', dashDot: 'dashed', dashDotDot: 'dashed', mediumDashed: 'medium', mediumDashDot: 'medium', mediumDashDotDot: 'medium', slantDashDot: 'medium' }

// The workbook's sheet files in tab order.
function sheetPaths (files, strFromU8) {
  const wb = files['xl/workbook.xml'] ? strFromU8(files['xl/workbook.xml']) : ''
  const rels = files['xl/_rels/workbook.xml.rels'] ? strFromU8(files['xl/_rels/workbook.xml.rels']) : ''
  const target = {}
  for (const tag of children(rels, 'Relationship')) target[attr(tag, 'Id')] = attr(tag, 'Target')
  return children(section(wb, 'sheets'), 'sheet').map((tag) => {
    const t = target[attr(tag, 'r:id')]
    if (!t) return null
    return t.startsWith('/') ? t.slice(1) : 'xl/' + t.replace(/^\.\//, '')
  })
}

// Every tab's cell formats and row heights from an .xlsx file:
// [{ styles: [[row, col, fmt]], heights: { row: px } }] in tab order.
// SheetJS Community Edition reads none of this; number formats it does read.
function stylesFromXlsx (bytes, { unzipSync, strFromU8 }, maxCells = Infinity) {
  let files
  try { files = unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { return [] }
  const read = (p) => (files[p] ? strFromU8(files[p]) : '')
  const theme = themeColors(read('xl/theme/theme1.xml'))
  const styles = read('xl/styles.xml')
  const fonts = children(section(styles, 'fonts'), 'font')
  const fills = children(section(styles, 'fills'), 'fill')
  const borders = children(section(styles, 'borders'), 'border')
  const xfs = children(section(styles, 'cellXfs'), 'xf')
  const base = fonts[0] || ''
  const baseSize = Number(attr((/<sz\s[^>]*>/.exec(base) || [''])[0], 'val')) || 11
  const baseName = attr((/<name\s[^>]*>/.exec(base) || [''])[0], 'val') || ''
  const baseColor = colorOf((/<color\s[^>]*>/.exec(base) || [null])[0], theme)

  // Style number -> fmt (only the attributes PearSheet has).
  const formats = xfs.map((xf) => {
    const f = {}
    const font = fonts[Number(attr(xf, 'fontId')) || 0] || ''
    if (on(font, 'b')) f.b = true
    if (on(font, 'i')) f.i = true
    if (on(font, 'u')) f.u = true
    if (on(font, 'strike')) f.s = true
    const sz = Number(attr((/<sz\s[^>]*>/.exec(font) || [''])[0], 'val'))
    if (sz && sz !== baseSize) f.size = Math.max(6, Math.min(72, Math.round(sz)))
    const name = attr((/<name\s[^>]*>/.exec(font) || [''])[0], 'val') || ''
    if (name && name !== baseName) {
      if (MONO.test(name)) f.font = 'mono'
      else if (SERIF.test(name) && !SERIF.test(baseName)) f.font = 'serif'
    }
    const color = colorOf((/<color\s[^>]*>/.exec(font) || [null])[0], theme)
    if (color && color !== baseColor && color !== '000000') f.color = '#' + color.toLowerCase()
    const fill = fills[Number(attr(xf, 'fillId')) || 0] || ''
    if (attr(fill, 'patternType') === 'solid') {
      const fg = colorOf((/<fgColor\s[^>]*>/.exec(fill) || [null])[0], theme)
      if (fg) f.fill = '#' + fg.toLowerCase()
    }
    const border = borders[Number(attr(xf, 'borderId')) || 0] || ''
    for (const [side, key] of [['left', 'bl'], ['right', 'br'], ['top', 'bt'], ['bottom', 'bb']]) {
      const m = new RegExp('<' + side + '(\\s[^>]*?)?(?:/>|>([\\s\\S]*?)</' + side + '>)').exec(border)
      const kind = m && BORDER_KIND[attr(m[0].slice(0, m[0].indexOf('>') + 1), 'style')]
      if (!kind) continue
      const c = colorOf((/<color\s[^>]*>/.exec(m[2] || '') || [null])[0], theme)
      f[key] = kind + (c && c !== '000000' ? ':#' + c.toLowerCase() : '')
    }
    const al = (/<alignment\s[^>]*>/.exec(xf) || [''])[0]
    const h = attr(al, 'horizontal')
    if (h === 'left' || h === 'right' || h === 'center') f.align = h
    else if (h === 'centerContinuous') f.align = 'center'
    const v = attr(al, 'vertical')
    if (v === 'top') f.valign = 'top'
    else if (v === 'center') f.valign = 'middle'
    const wrap = attr(al, 'wrapText')
    if (wrap === '1' || wrap === 'true') f.wrap = true
    return Object.keys(f).length ? f : null
  })

  let count = 0
  return sheetPaths(files, strFromU8).map((path) => {
    const out = { styles: [], heights: {} }
    const xml = path ? read(path) : ''
    const data = section(xml, 'sheetData')
    for (const row of children(data, 'row')) {
      const open = row.slice(0, row.indexOf('>') + 1)
      const r = Number(attr(open, 'r'))
      const ht = Number(attr(open, 'ht'))
      if (r && ht && ['1', 'true'].includes(attr(open, 'customHeight'))) out.heights[r] = Math.round(ht * 4 / 3)
      for (const cell of row.matchAll(/<c\s[^>]*?r="([A-Z]+)(\d+)"[^>]*?>|<c\s[^>]*?r="([A-Z]+)(\d+)"[^>]*?\/>/g)) {
        const s = attr(cell[0], 's')
        const fmt = s !== undefined && formats[Number(s)]
        if (!fmt) continue
        if (++count > maxCells) return out
        out.styles.push([Number(cell[2] || cell[4]), colNum(cell[1] || cell[3]), fmt])
      }
    }
    return out
  })
}

module.exports = { addStyles, stylesFromXlsx, sheetPaths }
