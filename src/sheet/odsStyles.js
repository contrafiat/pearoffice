// How cells look in .ods files (LibreOffice and OpenOffice): bold, italic,
// underline, strike, font, size, colour, fill, alignment, wrap and borders;
// column widths and row heights; hidden rows and columns; frozen panes. SheetJS
// writes none of this reliably and reads none of it, so it is done here on the
// file's XML: content.xml for the cells, styles.xml for the default text size,
// settings.xml for frozen panes.

const MAX_IMPORT_CELLS = 200000
const CELL_LIMIT = 1000 // a repeated run bigger than this is a whole row or column, not cells
const LO_COL_PX = 0.889 * 96 // LibreOffice's default column width

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const unesc = (s) => String(s).replace(/&apos;/g, "'").replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
const attrOf = (tag, name) => { const m = new RegExp('\\s' + name + '="([^"]*)"').exec(tag || ''); return m ? unesc(m[1]) : null }
const PX = { cm: 96 / 2.54, mm: 96 / 25.4, in: 96, pt: 96 / 72, pc: 16, px: 1 }
const px = (len) => { const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)?$/.exec(String(len || '').trim()); return m ? Number(m[1]) * PX[m[2] || 'cm'] : 0 }
const pt = (len) => px(len) * 0.75

const FONTS = { serif: 'Liberation Serif', mono: 'Liberation Mono' }
const SERIF = /times|georgia|cambria|garamond|palatino|book antiqua|serif/i
const MONO = /consolas|courier|mono|menlo|lucida console|andale/i
const BORDER = { thin: '0.75pt solid', medium: '1.75pt solid', thick: '2.5pt solid', dashed: '0.75pt dashed', double: '2.25pt double' }

// --- writing -------------------------------------------------------------------

// fmt -> the style's properties, without the data style.
function styleBody (f) {
  const cell = []
  const para = []
  const text = []
  if (f.fill) cell.push('fo:background-color="' + esc(f.fill) + '"')
  for (const [key, side] of [['bt', 'top'], ['br', 'right'], ['bb', 'bottom'], ['bl', 'left']]) {
    if (!f[key]) continue
    const [kind, color] = String(f[key]).split(':')
    cell.push('fo:border-' + side + '="' + (BORDER[kind] || BORDER.thin) + ' ' + esc(color || f.color || '#000000') + '"')
  }
  if (f.valign) cell.push('style:vertical-align="' + f.valign + '"')
  if (f.wrap) cell.push('fo:wrap-option="wrap"')
  if (f.align) { cell.push('style:text-align-source="fix"'); para.push('fo:text-align="' + ({ left: 'start', center: 'center', right: 'end' }[f.align] || 'start') + '"') }
  if (f.b) text.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"')
  if (f.i) text.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"')
  if (f.u) text.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
  if (f.s) text.push('style:text-line-through-style="solid"')
  if (f.size) text.push('fo:font-size="' + f.size + 'pt"')
  if (f.color) text.push('fo:color="' + esc(f.color) + '"')
  if (FONTS[f.font]) text.push('fo:font-family="' + FONTS[f.font] + '"')
  return (cell.length ? '<style:table-cell-properties ' + cell.join(' ') + '/>' : '') +
    (para.length ? '<style:paragraph-properties ' + para.join(' ') + '/>' : '') +
    (text.length ? '<style:text-properties ' + text.join(' ') + '/>' : '')
}

const looks = (f) => { if (!f) return null; const o = { ...f }; delete o.num; return Object.keys(o).length ? o : null }

// Adds the tabs' looks to a .ods SheetJS wrote. tabs: [{ styles: [[row, col,
// fmt]], widths: { col: px }, heights: { row: px }, hidden: { rows, cols },
// freeze: { rows, cols }, cols: the last used column }] in sheet order; names: the sheets' names. Every
// styled cell must be inside the range SheetJS wrote (writeOds makes sure).
function addStylesToOds (files, tabs, names, fflate) {
  let xml = fflate.strFromU8(files['content.xml'])
  // The data styles SheetJS gave its cell styles (number formats).
  const dataStyle = {}
  for (const m of xml.matchAll(/<style:style\s([^>]*?)\/?>/g)) {
    const tag = '<x ' + m[1] + '>'
    if (attrOf(tag, 'style:family') === 'table-cell') dataStyle[attrOf(tag, 'style:name')] = attrOf(tag, 'style:data-style-name')
  }
  const made = new Map() // key -> style name
  const newStyles = []
  const styleFor = (f, base) => {
    const key = (base ? dataStyle[base] || '' : '') + '|' + JSON.stringify(f)
    if (!made.has(key)) {
      const name = 'pf' + (made.size + 1)
      made.set(key, name)
      const ds = base && dataStyle[base] ? ' style:data-style-name="' + dataStyle[base] + '"' : ''
      newStyles.push('<style:style style:name="' + name + '" style:family="table-cell" style:parent-style-name="Default"' + ds + '>' + styleBody(f) + '</style:style>')
    }
    return made.get(key)
  }
  let col = 0
  const colStyles = []
  const rowStyles = []
  const sizeStyle = (family, prop, value, list) => {
    const key = family + value
    if (!made.has(key)) {
      const name = (family === 'table-column' ? 'pco' : 'pro') + (list.length + 1)
      made.set(key, name)
      list.push('<style:style style:name="' + name + '" style:family="' + family + '"><style:' + family + '-properties ' + prop + '/></style:style>')
    }
    return made.get(key)
  }

  // Cells, rows and columns, walked in order.
  const want = tabs.map((t) => new Map((t.styles || []).map(([r, c, f]) => [(r - 1) + ',' + (c - 1), looks(f)]).filter(([, f]) => f)))
  let out = ''
  let last = 0
  let tab = -1
  let depth = 0
  let row = -1
  const re = /<(\/?)table:(table-row|table-cell|covered-table-cell|table-column|table)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [tag, close, kind, attrs, selfClose] = m
    if (kind === 'table') {
      if (close) { depth--; continue }
      depth++
      if (depth !== 1) continue
      tab++
      row = -1
      // Columns: SheetJS's are replaced with ours (widths, hidden).
      const t = tabs[tab] || {}
      const hiddenCols = new Set((t.hidden && t.hidden.cols) || [])
      const widthCols = Object.keys(t.widths || {}).map(Number)
      // Every used column, so they keep PearOffice's width (LibreOffice's
      // default is narrower).
      const n = Math.max(0, t.cols || 0, ...widthCols, ...hiddenCols)
      let cols = ''
      for (let c = 1; c <= n; c++) {
        const w = t.widths && t.widths[c]
        const name = sizeStyle('table-column', 'style:column-width="' + (Math.round((w || 100) * 2.54 / 96 * 1000) / 1000) + 'cm"', w || 100, colStyles)
        cols += '<table:table-column table:style-name="' + name + '"' + (hiddenCols.has(c) ? ' table:visibility="collapse"' : '') + ' table:default-cell-style-name="Default"/>'
      }
      out += xml.slice(last, m.index + tag.length) + cols
      last = m.index + tag.length
      // Drop SheetJS's own column elements that follow.
      const after = /^(\s*<table:table-column\b[^>]*?(?:\/>|>\s*<\/table:table-column>))+/.exec(xml.slice(last))
      if (after && n) { last += after[0].length; re.lastIndex = last }
      continue
    }
    if (depth !== 1 || close) continue
    if (kind === 'table-column') continue
    const t = tabs[tab] || {}
    if (kind === 'table-row') {
      row++
      col = 0
      const h = t.heights && t.heights[row + 1]
      const hidden = t.hidden && (t.hidden.rows || []).includes(row + 1)
      if (!h && !hidden) continue
      let a = attrs.replace(/\stable:style-name="[^"]*"/, '')
      if (h) a += ' table:style-name="' + sizeStyle('table-row', 'style:row-height="' + (Math.round(h * 2.54 / 96 * 1000) / 1000) + 'cm" style:use-optimal-row-height="false"', 'h' + h, rowStyles) + '"'
      if (hidden) a += ' table:visibility="collapse"'
      out += xml.slice(last, m.index) + '<table:table-row' + a + (selfClose ? '/>' : '>')
      last = m.index + tag.length
      continue
    }
    const f = want[tab] && want[tab].get(row + ',' + col)
    col += Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
    if (!f || kind !== 'table-cell') continue
    const base = attrOf(attrs, 'table:style-name')
    const a = attrs.replace(/\stable:style-name="[^"]*"/, '').replace(/\s+$/, '')
    out += xml.slice(last, m.index) + '<table:table-cell' + a + ' table:style-name="' + styleFor(f, base) + '"' + (selfClose ? '/>' : '>')
    last = m.index + tag.length
  }
  xml = out + xml.slice(last)
  xml = xml.replace('</office:automatic-styles>', colStyles.join('') + rowStyles.join('') + newStyles.join('') + '</office:automatic-styles>')
  files['content.xml'] = fflate.strToU8(xml)

  // Plain text at 11pt, as in PearOffice (LibreOffice's own default is 10).
  let styles = fflate.strFromU8(files['styles.xml'])
  const def = '<office:styles><style:style style:name="Default" style:family="table-cell"><style:text-properties fo:font-size="11pt"/></style:style></office:styles>'
  styles = /<office:styles\/>/.test(styles) ? styles.replace('<office:styles/>', def)
    : /<office:styles>/.test(styles) ? styles.replace('<office:styles>', def.replace('</office:styles>', ''))
      : styles.replace('<office:master-styles>', def + '<office:master-styles>')
  files['styles.xml'] = fflate.strToU8(styles)

  // Frozen panes, in the view settings.
  const frozen = tabs.map((t, i) => [names[i], t.freeze]).filter(([, f]) => f && (f.rows || f.cols))
  if (frozen.length) {
    const item = (name, type, v) => '<config:config-item config:name="' + name + '" config:type="' + type + '">' + v + '</config:config-item>'
    const entries = frozen.map(([name, f]) => '<config:config-item-map-entry config:name="' + esc(name) + '">' +
      item('HorizontalSplitMode', 'short', f.cols ? 2 : 0) + item('VerticalSplitMode', 'short', f.rows ? 2 : 0) +
      item('HorizontalSplitPosition', 'int', f.cols || 0) + item('VerticalSplitPosition', 'int', f.rows || 0) +
      item('ActiveSplitRange', 'short', 2) + item('PositionLeft', 'int', 0) + item('PositionRight', 'int', f.cols || 0) +
      item('PositionTop', 'int', 0) + item('PositionBottom', 'int', f.rows || 0) + '</config:config-item-map-entry>').join('')
    // LibreOffice reads the view settings only when the ooo namespace is
    // declared, though nothing here uses it (found by trial, LibreOffice 26.2).
    files['settings.xml'] = fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<office:document-settings xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:config="urn:oasis:names:tc:opendocument:xmlns:config:1.0" xmlns:ooo="http://openoffice.org/2004/office" office:version="1.3"><office:settings>' +
      '<config:config-item-set config:name="ooo:view-settings"><config:config-item-map-indexed config:name="Views"><config:config-item-map-entry>' +
      item('ViewId', 'string', 'view1') + '<config:config-item-map-named config:name="Tables">' + entries + '</config:config-item-map-named>' +
      '</config:config-item-map-entry></config:config-item-map-indexed></config:config-item-set></office:settings></office:document-settings>')
    const manifest = fflate.strFromU8(files['META-INF/manifest.xml'])
    if (!manifest.includes('"settings.xml"')) files['META-INF/manifest.xml'] = fflate.strToU8(manifest.replace('</manifest:manifest>', '<manifest:file-entry manifest:full-path="settings.xml" manifest:media-type="text/xml"/></manifest:manifest>'))
  }
}

// --- reading -------------------------------------------------------------------

// Every style in a document, by family and name: { parent, cell, para, text,
// col, row } (the attributes of each properties element).
function readStyles (xml, into = {}) {
  for (const m of xml.matchAll(/<style:style\s([^>]*?)(?:\/>|>([\s\S]*?)<\/style:style>)/g)) {
    const tag = '<x ' + m[1] + '>'
    const family = attrOf(tag, 'style:family')
    const name = attrOf(tag, 'style:name')
    if (!family || !name) continue
    const body = m[2] || ''
    const props = (el) => (new RegExp('<style:' + el + '\\s([^>]*?)/?>').exec(body) || [])[1] || ''
    into[family + ':' + name] = {
      parent: attrOf(tag, 'style:parent-style-name'),
      cell: props('table-cell-properties'),
      para: props('paragraph-properties'),
      text: props('text-properties'),
      col: props('table-column-properties'),
      row: props('table-row-properties')
    }
  }
  return into
}

// A cell style's font family, following its parents; at each level either
// attribute counts (a style may name the font one way and its parent the other).
function fontOf (styles, name, fonts, seen = new Set()) {
  const s = styles['table-cell:' + name]
  if (!s || seen.has(name)) return ''
  seen.add(name)
  const tag = '<x ' + s.text + '>'
  const v = attrOf(tag, 'fo:font-family') || fonts[attrOf(tag, 'style:font-name')]
  if (v) return v.replace(/^'|'$/g, '')
  return s.parent ? fontOf(styles, s.parent, fonts, seen) : ''
}

// One property of a cell style, following its parents.
function lookup (styles, name, part, prop, seen = new Set()) {
  const s = styles['table-cell:' + name]
  if (!s || seen.has(name)) return null
  seen.add(name)
  const v = attrOf('<x ' + s[part] + '>', prop)
  if (v !== null) return v
  return s.parent ? lookup(styles, s.parent, part, prop, seen) : null
}

function borderOf (v) {
  if (!v || v === 'none') return null
  // "0.74pt solid #000000", "1.76pt double-thin #000000", "0.74pt fine-dashed ..."
  const m = /^([\d.]+[a-z]+)\s+([\w-]+)\s+(#[0-9a-f]{6})/i.exec(v.trim())
  if (!m || m[2] === 'none' || m[2] === 'hidden') return null
  const w = pt(m[1])
  const kind = /double/.test(m[2]) ? 'double' : /dash|dot/.test(m[2]) ? 'dashed' : w > 2 ? 'thick' : w > 1.1 ? 'medium' : 'thin'
  return kind + (m[3].toLowerCase() !== '#000000' ? ':' + m[3].toLowerCase() : '')
}

// A cell style -> fmt (only what PearOffice has), or null. base: the default
// style's size, font and colour.
function fmtOf (styles, name, base, fonts) {
  const f = {}
  const get = (part, prop) => lookup(styles, name, part, prop)
  if (get('text', 'fo:font-weight') === 'bold') f.b = true
  if (get('text', 'fo:font-style') === 'italic') f.i = true
  const u = get('text', 'style:text-underline-style')
  if (u && u !== 'none') f.u = true
  const s = get('text', 'style:text-line-through-style')
  if (s && s !== 'none') f.s = true
  const size = pt(get('text', 'fo:font-size'))
  if (size && Math.abs(size - base.size) > 0.01) f.size = Math.max(6, Math.min(72, Math.round(size)))
  const fontName = fontOf(styles, name, fonts)
  if (fontName && fontName !== base.font) {
    if (MONO.test(fontName)) f.font = 'mono'
    else if (SERIF.test(fontName) && !SERIF.test(base.font)) f.font = 'serif'
  }
  const color = (get('text', 'fo:color') || '').toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(color) && color !== base.color && color !== '#000000') f.color = color
  const fill = (get('cell', 'fo:background-color') || '').toLowerCase()
  if (/^#[0-9a-f]{6}$/.test(fill)) f.fill = fill
  const all = get('cell', 'fo:border')
  for (const [key, side] of [['bt', 'top'], ['br', 'right'], ['bb', 'bottom'], ['bl', 'left']]) {
    const b = borderOf(get('cell', 'fo:border-' + side) || all)
    if (b) f[key] = b
  }
  const align = get('para', 'fo:text-align')
  if (align === 'center') f.align = 'center'
  else if (align === 'end' || align === 'right') f.align = 'right'
  else if ((align === 'start' || align === 'left') && get('cell', 'style:text-align-source') === 'fix') f.align = 'left'
  const v = get('cell', 'style:vertical-align')
  if (v === 'top' || v === 'middle') f.valign = v
  if (get('cell', 'fo:wrap-option') === 'wrap') f.wrap = true
  return Object.keys(f).length ? f : null
}

// Each tab's looks from a .ods file's parts (content.xml, styles.xml,
// settings.xml), in tab order: { styles, widths, heights, hidden, freeze }.
function stylesFromOds (files, fflate, names) {
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const xml = read('content.xml')
  const styles = readStyles(xml, readStyles(read('styles.xml')))
  const fonts = {}
  for (const m of (read('styles.xml') + xml).matchAll(/<style:font-face\s([^>]*?)\/?>/g)) {
    const tag = '<x ' + m[1] + '>'
    fonts[attrOf(tag, 'style:name')] = (attrOf(tag, 'svg:font-family') || '').replace(/^'|'$/g, '')
  }
  const baseGet = (prop) => lookup(styles, 'Default', 'text', prop)
  const base = { size: pt(baseGet('fo:font-size')) || 10, font: fontOf(styles, 'Default', fonts), color: (baseGet('fo:color') || '#000000').toLowerCase() }
  const fmts = {}
  const fmtFor = (name) => (name in fmts ? fmts[name] : (fmts[name] = fmtOf(styles, name, base, fonts)))

  const out = names.map(() => ({ styles: [], widths: {}, heights: {}, hidden: { rows: [], cols: [] } }))
  let tab = -1
  let depth = 0
  let row = 0
  let col = 0
  let colDefaults = [] // [from, to, default cell style]
  let rowDefault = null
  let rowRepeat = 1
  let count = 0
  const re = /<(\/?)table:(table-row|table-cell|covered-table-cell|table-column|table)(?=[\s/>])([^>]*?)(\/?)>/g
  let m
  while ((m = re.exec(xml))) {
    const [, close, kind, attrs, selfClose] = m
    if (kind === 'table') {
      if (close) { depth--; continue }
      depth++
      if (depth === 1) { tab++; row = 0; col = 0; colDefaults = [] }
      if (selfClose) depth--
      continue
    }
    if (depth !== 1 || close || tab < 0 || tab >= out.length) continue
    const t = out[tab]
    if (kind === 'table-column') {
      const n = Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
      const s = styles['table-column:' + attrOf(attrs, 'table:style-name')]
      const w = s && px(attrOf('<x ' + s.col + '>', 'style:column-width'))
      const hidden = attrOf(attrs, 'table:visibility') === 'collapse'
      const def = attrOf(attrs, 'table:default-cell-style-name')
      if (def) colDefaults.push([col, col + n - 1, def])
      if (n <= CELL_LIMIT) {
        for (let c = col; c < col + n; c++) {
          if (w && Math.abs(w - LO_COL_PX) > 1) t.widths[c + 1] = Math.round(w)
          if (hidden) t.hidden.cols.push(c + 1)
        }
      }
      col += n
      continue
    }
    if (kind === 'table-row') {
      rowRepeat = Number(attrOf(attrs, 'table:number-rows-repeated')) || 1
      rowDefault = attrOf(attrs, 'table:default-cell-style-name')
      const s = styles['table-row:' + attrOf(attrs, 'table:style-name')]
      const h = s && attrOf('<x ' + s.row + '>', 'style:use-optimal-row-height') === 'false' && px(attrOf('<x ' + s.row + '>', 'style:row-height'))
      const hidden = attrOf(attrs, 'table:visibility') === 'collapse'
      if (rowRepeat <= CELL_LIMIT) {
        for (let r = row; r < row + rowRepeat; r++) {
          if (h) t.heights[r + 1] = Math.round(h)
          if (hidden) t.hidden.rows.push(r + 1)
        }
      }
      row += rowRepeat
      col = 0
      continue
    }
    // A cell: its style, else the row's default, else the column's.
    const n = Number(attrOf(attrs, 'table:number-columns-repeated')) || 1
    const r0 = row - rowRepeat
    const name = attrOf(attrs, 'table:style-name') || rowDefault || (colDefaults.find(([a, b]) => col >= a && col <= b) || [])[2]
    const f = name && name !== 'Default' ? fmtFor(name) : null
    if (f && n * rowRepeat <= CELL_LIMIT) {
      for (let r = r0; r < row; r++) {
        for (let c = col; c < col + n; c++) {
          if (++count > MAX_IMPORT_CELLS) break
          t.styles.push([r + 1, c + 1, f])
        }
      }
    }
    col += n
  }

  // Frozen panes.
  const settings = read('settings.xml')
  const tables = /<config:config-item-map-named config:name="Tables">([\s\S]*?)<\/config:config-item-map-named>/.exec(settings)
  if (tables) {
    for (const e of tables[1].matchAll(/<config:config-item-map-entry config:name="([^"]*)">([\s\S]*?)<\/config:config-item-map-entry>/g)) {
      const i = names.indexOf(unesc(e[1]))
      if (i < 0) continue
      const item = (k) => Number((new RegExp('config:name="' + k + '"[^>]*>(-?\\d+)<').exec(e[2]) || [])[1] || 0)
      const cols = item('HorizontalSplitMode') === 2 ? item('HorizontalSplitPosition') : 0
      const rows = item('VerticalSplitMode') === 2 ? item('VerticalSplitPosition') : 0
      if (rows || cols) out[i].freeze = { rows, cols }
    }
  }
  return out
}

function stylesFromOdsBytes (bytes, fflate, names) {
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes), { filter: (f) => ['content.xml', 'styles.xml', 'settings.xml'].includes(f.name) }) } catch { return names.map(() => null) }
  return stylesFromOds(files, fflate, names)
}

module.exports = { addStylesToOds, stylesFromOds, stylesFromOdsBytes, styleBody, fmtOf }
