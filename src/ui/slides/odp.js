// Slide decks in OpenDocument (.odp), for LibreOffice Impress and OpenOffice.
//
// Saving writes the file straight from the deck's Yjs doc, as deckToPptx
// does with pptxgenjs: the theme's background and fonts, text boxes (titles
// and bodies as Impress's title and outline), shapes (rectangles, rounded
// rectangles and ellipses as themselves, triangles, arrows and custom shapes
// as custom shapes from their paths), lines with their ends, pictures with
// their crop, charts as embedded chart documents with their data, rotation,
// see-through fills and outlines, where text sits and wrapping, and speaker
// notes. Slide space is 144 units to the inch; text sizes are points.
//
// Opening reads the file into the same plain data as the .pptx reader
// (readPresentation), so pptxImport.js builds the deck from it the same way.

import * as fflate from 'fflate'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import slidesModel from '../../slides/slidesModel.js'
import { ROLES } from '../../slides/layouts.js'
import { themeFor, defaultSize } from './themes.js'
import { slideSchema } from './text.js'
import { parsePath, BOX } from './svgPath.js'
import { fontName, slotHex, hexOf } from './pptxExport.js'
import { deckSize } from './pptxImport.js'
import { checkZip } from './importOoxml.js'
import { okLink } from '../../shared/links.js'

export const ODP = 'application/vnd.oasis.opendocument.presentation'
export const isOdpFile = (name) => /\.odp$/i.test(String(name || ''))

const PER_IN = 144
const cm = (v) => (Math.round(v / PER_IN * 2.54 * 1000) / 1000) + 'cm' // slide units -> cm
const pt = (v) => (Math.round(v * 100) / 100) + 'pt'
const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const pct = (o) => Math.round(o * 100) + '%'
const hash = (h) => '#' + String(h).toLowerCase()
const PAD_X = 7.5 // pt, as the .pptx export (.slide-body's padding)
const PAD_Y = 4.5
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }
const CHART_CLASS = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'circle', doughnut: 'ring', scatter: 'scatter', radar: 'radar' }
// Line ends with the names and shapes Impress gives PowerPoint's, so it
// keeps them as those (open arrow, filled triangle, oval) when it saves a .pptx.
const MARKERS = { arrow: 'msArrowOpenEnd_20_5_20_106', triangle: 'msArrowEnd_20_5', oval: 'msArrowOvalEnd_20_5' }

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:chart="urn:oasis:names:tc:opendocument:xmlns:chart:1.0" xmlns:presentation="urn:oasis:names:tc:opendocument:xmlns:presentation:1.0" xmlns:number="urn:oasis:names:tc:opendocument:xmlns:datastyle:1.0"'

// --- saving: text ----------------------------------------------------------------

function fragmentJson (fragment) {
  if (!fragment || typeof fragment.toArray !== 'function' || fragment.length === 0) return null
  try { return yXmlFragmentToProseMirrorRootNode(fragment, slideSchema()).toJSON() } catch { return null }
}

function isEmpty (json) {
  if (!json) return true
  let text = ''
  const walk = (n) => { if (n.text) text += n.text; (n.content || []).forEach(walk) }
  walk(json)
  return text.trim() === ''
}

// Text with runs of spaces and tabs as ODF elements.
function textXml (t) {
  let out = ''
  let spaces = 0
  const flush = () => { if (spaces) { out += spaces === 1 ? ' ' : ' <text:s text:c="' + (spaces - 1) + '"/>'; spaces = 0 } }
  for (const ch of String(t)) {
    if (ch === ' ') { spaces++; continue }
    flush()
    out += ch === '\t' ? '<text:tab/>' : esc(ch)
  }
  flush()
  return out
}

function createWriter (theme) {
  const auto = new Map()
  const style = (prefix, family, body, parent) => {
    const key = family + '|' + (parent || '') + '|' + body
    if (!auto.has(key)) {
      const name = prefix + (auto.size + 1)
      auto.set(key, [name, '<style:style style:name="' + name + '" style:family="' + family + '"' + (parent ? ' style:parent-style-name="' + parent + '"' : '') + '>' + body + '</style:style>'])
    }
    return auto.get(key)[0]
  }
  const textStyle = (props) => style('T', 'text', '<style:text-properties ' + props + '/>')

  // A box's text: its paragraphs and lists. base: { font, size, color, align }.
  function boxText (json, base) {
    const runs = (nodes) => {
      let out = ''
      for (const n of nodes || []) {
        if (n.type === 'hardBreak') { out += '<text:line-break/>'; continue }
        if (n.type !== 'text') continue
        const p = []
        let href = null
        for (const m of n.marks || []) {
          const a = m.attrs || {}
          if (m.type === 'bold') p.push('fo:font-weight="bold"')
          else if (m.type === 'italic') p.push('fo:font-style="italic"')
          else if (m.type === 'underline') p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
          else if (m.type === 'strike') p.push('style:text-line-through-style="solid" style:text-line-through-type="single"')
          else if (m.type === 'superscript') p.push('style:text-position="super 58%"')
          else if (m.type === 'subscript') p.push('style:text-position="sub 58%"')
          else if (m.type === 'code') p.push('fo:font-family="&apos;Courier New&apos;"')
          else if (m.type === 'highlight') { const h = hexOf(a.color); if (h) p.push('fo:background-color="' + hash(h) + '"') }
          else if (m.type === 'link' && /^(https?:|mailto:)/i.test(String(a.href || ''))) { href = String(a.href); p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"') }
          else if (m.type === 'textStyle') {
            const c = hexOf(a.color)
            if (c) p.push('fo:color="' + hash(c) + '"')
            const size = parseFloat(a.fontSize)
            if (size) p.push('fo:font-size="' + pt(/px$/.test(a.fontSize) ? size * 0.75 : size) + '"')
            if (a.fontFamily) p.push('fo:font-family="' + esc(fontName(a.fontFamily)) + '"')
          }
        }
        // Impress reads a link as a field holding plain text: the look goes
        // around it.
        let run = textXml(n.text)
        if (href) run = '<text:a xlink:type="simple" xlink:href="' + esc(href) + '">' + run + '</text:a>'
        if (p.length) run = '<text:span text:style-name="' + textStyle(p.join(' ')) + '">' + run + '</text:span>'
        out += run
      }
      return out
    }
    const para = (n, ctx = {}) => {
      const a = n.attrs || {}
      const align = { left: 'start', center: 'center', right: 'end', justify: 'justify' }[a.textAlign || base.align] || 'start'
      const props = ['fo:text-align="' + align + '"']
      if (a.lineHeight) props.push('fo:line-height="' + Math.round(Number(a.lineHeight) * 100) + '%"')
      if (a.indent > 0 && !ctx.list) props.push('fo:margin-left="' + (a.indent * 1.27) + 'cm"')
      // The box's own font, size and colour on each paragraph: Impress draws
      // a title or outline placeholder in its own style otherwise.
      const ps = style('P', 'paragraph', '<style:paragraph-properties ' + props.join(' ') + '/><style:text-properties fo:font-family="' + esc(base.font) + '" fo:font-size="' + pt(base.size) + '" fo:color="' + hash(base.color) + '"' + (base.bold ? ' fo:font-weight="bold"' : '') + '/>')
      const box = ctx.task ? (ctx.checked ? '☑ ' : '☐ ') : ''
      return '<text:p text:style-name="' + ps + '">' + esc(box) + runs(n.content) + '</text:p>'
    }
    const blocks = (nodes, ctx = {}) => {
      let out = ''
      for (const n of nodes || []) {
        if (n.type === 'paragraph' || n.type === 'heading') out += para(n, ctx)
        else if (n.type === 'blockquote') out += blocks(n.content, ctx)
        else if (n.type === 'bulletList' || n.type === 'orderedList') {
          const list = n.type === 'orderedList' ? 'PearOfficeNumbers' : 'PearOfficeBullets'
          let items = ''
          ;(n.content || []).forEach((item, i) => {
            const start = i === 0 && n.type === 'orderedList' && n.attrs && n.attrs.start > 1 ? ' text:start-value="' + n.attrs.start + '"' : ''
            items += '<text:list-item' + start + '>' + blocks(item.content, { ...ctx, list: true }) + '</text:list-item>'
          })
          out += '<text:list text:style-name="' + list + '">' + items + '</text:list>'
        } else if (n.type === 'taskList') {
          for (const item of n.content || []) out += blocks(item.content, { ...ctx, task: true, checked: !!(item.attrs && item.attrs.checked) })
        }
      }
      return out
    }
    return blocks(json && json.content)
  }

  return { style, boxText, automatic: () => [...auto.values()].map((x) => x[1]).join('') }
}

// --- saving: shapes ----------------------------------------------------------------

// A frame's position: svg:x/y, or a transform when it is turned.
function placeAttrs (f) {
  const size = 'svg:width="' + cm(f.w) + '" svg:height="' + cm(f.h) + '"'
  if (!f.rot) return size + ' svg:x="' + cm(f.x) + '" svg:y="' + cm(f.y) + '"'
  // Our turn is clockwise about the centre; ODF turns counter-clockwise about
  // the top-left corner, then moves that corner into place.
  const t = f.rot * Math.PI / 180
  const cx = f.x + f.w / 2
  const cy = f.y + f.h / 2
  const x = cx - f.w / 2 * Math.cos(t) + f.h / 2 * Math.sin(t)
  const y = cy - f.w / 2 * Math.sin(t) - f.h / 2 * Math.cos(t)
  return size + ' draw:transform="rotate (' + (-t) + ') translate (' + cm(x) + ' ' + cm(y) + ')"'
}

// A shape's outline in the 1000 x 1000 box, as an enhanced path.
function enhancedPath (st, f) {
  if (st.shape === 'triangle') return 'M 500 0 L 1000 1000 0 1000 Z N'
  if (st.shape === 'arrow') {
    // objects.jsx: the shaft is the middle 40 percent, the head
    // min(half the width, 0.8 of the height) long.
    const head = Math.round(Math.min(f.w * 0.5, f.h * 0.8) / Math.max(1, f.w) * BOX)
    const at = BOX - head
    return 'M 0 300 L ' + at + ' 300 ' + at + ' 0 1000 500 ' + at + ' 1000 ' + at + ' 700 0 700 Z N'
  }
  const segs = parsePath(st.path)
  if (!segs) return null
  const r = (v) => Math.round(v * 100) / 100
  return segs.map((sg) => sg.c === 'Z' ? 'Z' : sg.c === 'M' ? 'M ' + r(sg.x) + ' ' + r(sg.y) : sg.c === 'L' ? 'L ' + r(sg.x) + ' ' + r(sg.y)
    : sg.c === 'C' ? 'C ' + r(sg.x1) + ' ' + r(sg.y1) + ' ' + r(sg.x2) + ' ' + r(sg.y2) + ' ' + r(sg.x) + ' ' + r(sg.y)
      : sg.c === 'Q' ? 'Q ' + r(sg.x1) + ' ' + r(sg.y1) + ' ' + r(sg.x) + ' ' + r(sg.y) : '').filter(Boolean).join(' ') + ' N'
}

// --- saving: charts -----------------------------------------------------------------

// A chart as an embedded chart document with its data in a local table.
function chartDocument ({ chart, data }, theme, size) {
  const cls = CHART_CLASS[chart.type] || 'bar'
  const accents = theme.accents.map((c) => hash(hexOf(c)))
  const ink = hash(slotHex(chart.textColor, theme) || hexOf(theme.text))
  const font = fontName(theme.bodyFont)
  const pie = cls === 'circle' || cls === 'ring'
  const series = pie ? data.series.slice(0, 1) : data.series
  const n = data.categories.length
  const col = (i) => String.fromCharCode(66 + i) // B, C, ...
  const textStyle = '<style:text-properties fo:color="' + ink + '" style:font-name="' + esc(font) + '" fo:font-family="' + esc(font) + '" fo:font-size="12pt"/>'
  const styles = [
    '<style:style style:name="ch" style:family="chart"><style:graphic-properties draw:fill="none" draw:stroke="none"/></style:style>',
    '<style:style style:name="tx" style:family="chart">' + textStyle + '</style:style>',
    '<style:style style:name="ti" style:family="chart"><style:text-properties fo:color="' + ink + '" style:font-name="' + esc(font) + '" fo:font-family="' + esc(font) + '" fo:font-size="14pt"/></style:style>',
    '<style:style style:name="ax" style:family="chart"><style:chart-properties chart:display-label="true"/><style:graphic-properties svg:stroke-color="#b3b3b3"/>' + textStyle + '</style:style>',
    '<style:style style:name="wall" style:family="chart"><style:graphic-properties draw:fill="none" draw:stroke="none"/></style:style>',
    '<style:style style:name="pa" style:family="chart"><style:chart-properties chart:vertical="' + (chart.type === 'bar') + '"' + (chart.stacked ? ' chart:stacked="true"' : '') +
      (chart.dataLabels ? ' chart:data-label-number="value"' : '') + (cls === 'line' && chart.smooth ? ' chart:interpolation="cubic-spline"' : '') +
      (cls === 'scatter' ? ' chart:lines="false" chart:symbol-type="automatic"' : cls === 'line' || cls === 'radar' ? ' chart:symbol-type="none"' : '') + '/></style:style>'
  ]
  const seriesXml = series.map((sr, i) => {
    const color = pie ? accents[0] : hash(hexOf(sr.color) || hexOf(accents[i % accents.length]))
    styles.push('<style:style style:name="s' + i + '" style:family="chart"><style:chart-properties' + (chart.dataLabels ? ' chart:data-label-number="value"' : '') + '/><style:graphic-properties draw:fill-color="' + color + '" svg:stroke-color="' + color + '"' + (cls === 'line' || cls === 'radar' ? ' svg:stroke-width="0.08cm"' : '') + '/>' + textStyle + '</style:style>')
    const points = pie ? data.categories.map((_, k) => {
      styles.push('<style:style style:name="p' + k + '" style:family="chart"><style:graphic-properties draw:fill-color="' + accents[k % accents.length] + '"/></style:style>')
      return '<chart:data-point chart:style-name="p' + k + '"/>'
    }).join('') : ''
    const domain = cls === 'scatter' && i === 0 ? '<chart:domain table:cell-range-address="local-table.$A$2:.$A$' + (n + 1) + '"/>' : ''
    return '<chart:series chart:style-name="s' + i + '" chart:values-cell-range-address="local-table.$' + col(i) + '$2:.$' + col(i) + '$' + (n + 1) + '" chart:label-cell-address="local-table.$' + col(i) + '$1" chart:class="chart:' + (cls === 'ring' ? 'circle' : cls) + '">' + domain + points + '</chart:series>'
  }).join('')
  const legend = chart.legend || (series.length > 1 || pie ? 'bottom' : 'none')
  const cats = cls !== 'scatter' ? '<chart:categories table:cell-range-address="local-table.$A$2:.$A$' + (n + 1) + '"/>' : ''
  const axes = pie ? '<chart:axis chart:dimension="x" chart:name="primary-x">' + cats + '</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y"/>'
    : '<chart:axis chart:dimension="x" chart:name="primary-x" chart:style-name="ax">' + cats + '</chart:axis><chart:axis chart:dimension="y" chart:name="primary-y" chart:style-name="ax"><chart:grid chart:class="major"/></chart:axis>'
  // The local table: categories down column A, a column per series.
  const cell = (v) => (typeof v === 'number' && isFinite(v) ? '<table:table-cell office:value-type="float" office:value="' + v + '"><text:p>' + v + '</text:p></table:table-cell>'
    : v === null || v === undefined || v === '' ? '<table:table-cell/>' : '<table:table-cell office:value-type="string"><text:p>' + esc(v) + '</text:p></table:table-cell>')
  let rows = '<table:table-header-rows><table:table-row><table:table-cell/>' + series.map((sr) => cell(String(sr.name || ''))).join('') + '</table:table-row></table:table-header-rows><table:table-rows>'
  data.categories.forEach((c, k) => { rows += '<table:table-row>' + cell(c) + series.map((sr) => cell(sr.values[k])).join('') + '</table:table-row>' })
  rows += '</table:table-rows>'
  const table = '<table:table table:name="local-table"><table:table-header-columns><table:table-column/></table:table-header-columns><table:table-columns><table:table-column table:number-columns-repeated="' + Math.max(1, series.length) + '"/></table:table-columns>' + rows + '</table:table>'
  return '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ' + NS + ' office:version="1.3"><office:automatic-styles>' + styles.join('') + '</office:automatic-styles>' +
    '<office:body><office:chart><chart:chart svg:width="' + cm(size.w) + '" svg:height="' + cm(size.h) + '" chart:class="chart:' + cls + '" chart:style-name="ch">' +
    (chart.title ? '<chart:title chart:style-name="ti"><text:p>' + esc(chart.title) + '</text:p></chart:title>' : '') +
    (legend === 'none' ? '' : '<chart:legend chart:legend-position="' + (legend === 'right' ? 'end' : 'bottom') + '" style:legend-expansion="' + (legend === 'right' ? 'high' : 'wide') + '" chart:style-name="tx"/>') +
    '<chart:plot-area chart:style-name="pa" table:cell-range-address="local-table.$A$1:.$' + col(Math.max(0, series.length - 1)) + '$' + (n + 1) + '" chart:data-source-has-labels="both">' + axes + seriesXml + '<chart:wall chart:style-name="wall"/></chart:plot-area>' +
    table + '</chart:chart></office:chart></office:body></office:document-content>'
}

// --- saving: the deck -------------------------------------------------------------

const levels = (kind) => Array.from({ length: 10 }, (_, i) => {
  const l = i + 1
  const props = '<style:list-level-properties text:space-before="' + (0.6 * i) + 'cm" text:min-label-width="0.6cm"/><style:text-properties fo:font-size="100%"/>'
  return kind === 'bullet'
    ? '<text:list-level-style-bullet text:level="' + l + '" text:bullet-char="' + ['•', '–', '•'][i % 3] + '" text:bullet-relative-size="100%">' + props + '</text:list-level-style-bullet>'
    : '<text:list-level-style-number text:level="' + l + '" style:num-suffix=". " style:num-format="' + ['1', 'a', 'i'][i % 3] + '">' + props + '</text:list-level-style-number>'
}).join('')

// The deck as .odp bytes. pictures: ref -> { bytes, mime }; a picture missing
// from it is left out.
export function deckToOdp (doc, { title = '', pictures = new Map() } = {}) {
  const [sw, sh] = slidesModel.size(doc)
  const theme = themeFor(slidesModel.theme(doc))
  const w = createWriter(theme)
  const files = {}
  const objects = []
  let pictureNo = 0
  const headFont = fontName(theme.headingFont)
  const bodyFont = fontName(theme.bodyFont)
  const textFrame = (anchor, wrap, extra = '') => w.style('gr', 'graphic', '<style:graphic-properties draw:stroke="none" draw:fill="none" draw:textarea-vertical-align="' + anchor + '" draw:auto-grow-height="false" fo:padding-top="' + pt(PAD_Y) + '" fo:padding-bottom="' + pt(PAD_Y) + '" fo:padding-left="' + pt(PAD_X) + '" fo:padding-right="' + pt(PAD_X) + '" fo:wrap-option="' + (wrap ? 'wrap' : 'no-wrap') + '"' + extra + '/>')
  const charStyle = (font, size, color, bold) => '<style:text-properties fo:font-family="' + esc(font) + '" fo:font-size="' + pt(size) + '" fo:color="' + hash(color) + '"' + (bold ? ' fo:font-weight="bold"' : '') + '/>'

  let pages = ''
  let slideNo = 0
  for (const s of slidesModel.slides(doc)) {
    const titleSlide = s.map.get('layout') === 'title'
    let shapes = ''
    // A picture's or shape's link (proposals/2026-10-26-picture-links.md):
    // what the element wrote goes inside a draw:a, closed when the next
    // element starts.
    let linked = null // { at, link }
    const closeLink = () => {
      if (linked && shapes.length > linked.at) shapes = shapes.slice(0, linked.at) + '<draw:a xlink:type="simple" xlink:href="' + esc(linked.link) + '">' + shapes.slice(linked.at) + '</draw:a>'
      linked = null
    }
    for (const e of slidesModel.elements(doc, s.id)) {
      closeLink()
      const type = e.map.get('type')
      const f = slidesModel.frame(e.map)
      const link = slidesModel.linkOf(e.map)
      if (link) linked = { at: shapes.length, link }
      if (type === 'chart') {
        const value = slidesModel.chartOf(e.map)
        if (!value.data || !value.data.series.length) continue
        const dir = 'Object ' + (objects.length + 1)
        files[dir + '/content.xml'] = fflate.strToU8(chartDocument(value, theme, f))
        files[dir + '/styles.xml'] = fflate.strToU8('<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ' + NS + ' office:version="1.3"><office:styles/></office:document-styles>')
        objects.push(dir)
        shapes += '<draw:frame draw:name="Chart ' + objects.length + '" ' + placeAttrs(f) + '><draw:object xlink:href="./' + dir + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/></draw:frame>'
        continue
      }
      if (type === 'picture') {
        const p = pictures.get(String(e.map.get('ref') || ''))
        if (!p || !EXT[p.mime]) continue
        const name = 'Pictures/' + (++pictureNo) + '.' + EXT[p.mime]
        files[name] = { bytes: p.bytes, mime: p.mime }
        const c = slidesModel.crop(e.map)
        const pw = Number(e.map.get('pw')) || 1
        const ph = Number(e.map.get('ph')) || 1
        // The crop as lengths of the picture at 96 pixels to the inch.
        const len = (frac, px) => (Math.round(frac * px / 96 * 2.54 * 1000) / 1000) + 'cm'
        const clip = c.l || c.t || c.r || c.b ? ' fo:clip="rect(' + len(c.t, ph) + ', ' + len(c.r, pw) + ', ' + len(c.b, ph) + ', ' + len(c.l, pw) + ')"' : ''
        const gs = w.style('gr', 'graphic', '<style:graphic-properties draw:stroke="none" draw:fill="none"' + clip + '/>')
        const alt = String(e.map.get('alt') || '').slice(0, 500)
        shapes += '<draw:frame draw:style-name="' + gs + '" draw:name="Picture ' + pictureNo + '" ' + placeAttrs(f) + '><draw:image xlink:href="' + name + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>' + (alt ? '<svg:title>' + esc(alt) + '</svg:title><svg:desc>' + esc(alt) + '</svg:desc>' : '') + '</draw:frame>'
        continue
      }
      const role = type === 'text' && ROLES.includes(e.map.get('role')) ? e.map.get('role') : null
      const json = fragmentJson(e.map.get('text'))
      const tl = slidesModel.textLayout(e.map)
      const st = type === 'shape' ? slidesModel.style(e.map) : null
      const base = {
        font: role === 'title' ? headFont : bodyFont,
        size: defaultSize(theme, role),
        color: st ? inkOn(st.fill, theme, st.fillOpacity) : hexOf(theme.text),
        align: st || (titleSlide && role) ? 'center' : 'left',
        bold: role === 'title' && Number(theme.titleWeight) >= 600
      }
      const paraBase = w.style('Pb', 'paragraph', charStyle(base.font, base.size, base.color, base.bold))
      const text = isEmpty(json) ? '' : w.boxText(json, base)
      if (type === 'text') {
        if (!text) continue
        const cls = role === 'title' ? ' presentation:class="title" presentation:user-transformed="true"' : role ? ' presentation:class="' + (titleSlide ? 'subtitle' : 'outline') + '" presentation:user-transformed="true"' : ''
        if (!tl.wrap && !role) {
          // Impress's text frames always wrap: text that does not is an
          // invisible rectangle, as Impress makes a .pptx text box.
          shapes += '<draw:custom-shape draw:style-name="' + textFrame(tl.anchor, false) + '" draw:text-style-name="' + paraBase + '" ' + placeAttrs(f) + '>' + text +
            '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="rectangle" draw:enhanced-path="M 0 0 L 21600 0 21600 21600 0 21600 0 0 Z N"/></draw:custom-shape>'
          continue
        }
        shapes += '<draw:frame draw:style-name="' + textFrame(tl.anchor, tl.wrap) + '" draw:text-style-name="' + paraBase + '" ' + placeAttrs(f) + cls + '><draw:text-box>' + text + '</draw:text-box></draw:frame>'
        continue
      }
      // A shape.
      const lineHex = st.lineW > 0 ? slotHex(st.line, theme) : null
      if (st.shape === 'line') {
        if (!lineHex) continue
        const t = f.rot * Math.PI / 180
        const cx = f.x + f.w / 2
        const cy = f.y + f.h / 2
        const dx = f.w / 2 * Math.cos(t)
        const dy = f.w / 2 * Math.sin(t)
        const gs = w.style('gr', 'graphic', '<style:graphic-properties draw:stroke="solid" svg:stroke-color="' + hash(lineHex) + '" svg:stroke-width="' + pt(Math.max(0.25, st.lineW / 2)) + '"' + (st.lineOpacity < 1 ? ' svg:stroke-opacity="' + pct(st.lineOpacity) + '"' : '') +
          (MARKERS[st.head] ? ' draw:marker-start="' + MARKERS[st.head] + '" draw:marker-start-width="' + pt(Math.max(6, st.lineW * 2)) + '"' : '') +
          (MARKERS[st.tail] ? ' draw:marker-end="' + MARKERS[st.tail] + '" draw:marker-end-width="' + pt(Math.max(6, st.lineW * 2)) + '"' : '') + '/>')
        shapes += '<draw:line draw:style-name="' + gs + '" svg:x1="' + cm(cx - dx) + '" svg:y1="' + cm(cy - dy) + '" svg:x2="' + cm(cx + dx) + '" svg:y2="' + cm(cy + dy) + '"/>'
        continue
      }
      const fill = slotHex(st.fill, theme)
      const props = [fill ? 'draw:fill="solid" draw:fill-color="' + hash(fill) + '"' + (st.fillOpacity < 1 ? ' draw:opacity="' + pct(st.fillOpacity) + '"' : '') : 'draw:fill="none"',
        lineHex ? 'draw:stroke="solid" svg:stroke-color="' + hash(lineHex) + '" svg:stroke-width="' + pt(st.lineW / 2) + '"' + (st.lineOpacity < 1 ? ' svg:stroke-opacity="' + pct(st.lineOpacity) + '"' : '') : 'draw:stroke="none"',
        'draw:textarea-vertical-align="' + tl.anchor + '"', 'draw:textarea-horizontal-align="justify"', 'fo:wrap-option="' + (tl.wrap ? 'wrap' : 'no-wrap') + '"',
        'fo:padding-top="' + pt(PAD_Y) + '" fo:padding-bottom="' + pt(PAD_Y) + '" fo:padding-left="' + pt(PAD_X) + '" fo:padding-right="' + pt(PAD_X) + '"']
      const gs = w.style('gr', 'graphic', '<style:graphic-properties ' + props.join(' ') + '/>')
      const common = 'draw:style-name="' + gs + '" draw:text-style-name="' + paraBase + '" ' + placeAttrs(f)
      if (st.shape === 'rect') shapes += '<draw:rect ' + common + '>' + text + '</draw:rect>'
      else if (st.shape === 'roundRect') {
        // Impress's rounded rectangle: the corner as a share of the shorter
        // side, of 21600, which it keeps in what it saves as .pptx.
        const r = Math.round(st.radius * 21600)
        shapes += '<draw:custom-shape ' + common + '>' + text + '<draw:enhanced-geometry svg:viewBox="0 0 21600 21600" draw:type="round-rectangle" draw:modifiers="' + r + '" draw:enhanced-path="M ?f7 0 X 0 ?f8 L 0 ?f9 Y ?f7 21600 L ?f10 21600 X 21600 ?f9 L 21600 ?f8 Y ?f10 0 Z N" draw:text-areas="?f3 ?f4 ?f5 ?f6">' +
          '<draw:equation draw:name="f0" draw:formula="45"/><draw:equation draw:name="f1" draw:formula="$0 *sin(?f0 *(pi/180))"/><draw:equation draw:name="f2" draw:formula="?f1 *3163/7636"/>' +
          '<draw:equation draw:name="f3" draw:formula="left+?f2 "/><draw:equation draw:name="f4" draw:formula="top+?f2 "/><draw:equation draw:name="f5" draw:formula="right-?f2 "/><draw:equation draw:name="f6" draw:formula="bottom-?f2 "/>' +
          '<draw:equation draw:name="f7" draw:formula="left+$0 "/><draw:equation draw:name="f8" draw:formula="top+$0 "/><draw:equation draw:name="f9" draw:formula="bottom-$0 "/><draw:equation draw:name="f10" draw:formula="right-$0 "/>' +
          '<draw:handle draw:handle-position="$0 top" draw:handle-switched="true" draw:handle-range-x-minimum="0" draw:handle-range-x-maximum="10800"/></draw:enhanced-geometry></draw:custom-shape>'
      } else if (st.shape === 'ellipse') shapes += '<draw:ellipse ' + common + '>' + text + '</draw:ellipse>'
      else {
        const path = enhancedPath(st, f)
        if (!path) { shapes += '<draw:rect ' + common + '>' + text + '</draw:rect>'; continue }
        // An arrow is Impress's right arrow with our proportions (the head
        // starts at x, the shaft's top at 30 percent, of 21600), so it stays
        // an arrow in Impress and in what Impress saves.
        const arrowAt = st.shape === 'arrow' ? Math.round((1 - Math.min(f.w * 0.5, f.h * 0.8) / Math.max(1, f.w)) * 21600) : 0
        const preset = st.shape === 'arrow' ? ' draw:type="right-arrow" draw:modifiers="' + arrowAt + ' 6480"' : st.shape === 'triangle' ? ' draw:type="isosceles-triangle" draw:modifiers="10800"' : ''
        shapes += '<draw:custom-shape ' + common + '>' + text + '<draw:enhanced-geometry svg:viewBox="0 0 1000 1000"' + preset + ' draw:enhanced-path="' + esc(path) + '"/></draw:custom-shape>'
      }
    }
    closeLink()
    // Speaker notes.
    const notes = notesParas(s.map.get('notes'))
    // As Impress writes them: the slide's picture, then the notes on the layout layer.
    const notesXml = notes.length ? '<presentation:notes draw:style-name="dp1"><draw:page-thumbnail draw:layer="layout" svg:width="15.239cm" svg:height="8.572cm" svg:x="1.905cm" svg:y="3.175cm" draw:page-number="' + (slideNo + 1) + '" presentation:class="page"/>' +
      '<draw:frame draw:layer="layout" presentation:style-name="PearOffice-notes" presentation:class="notes" svg:width="15.239cm" svg:height="10cm" svg:x="1.905cm" svg:y="12.224cm" presentation:user-transformed="true"><draw:text-box>' +
      notes.map((t) => '<text:p>' + textXml(t) + '</text:p>').join('') + '</draw:text-box></draw:frame></presentation:notes>' : ''
    pages += '<draw:page draw:name="Slide ' + (++slideNo) + '" draw:style-name="dp1" draw:master-page-name="PearOffice">' + shapes + notesXml + '</draw:page>'
  }

  const content = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ' + NS + ' office:version="1.3">' +
    // List styles with the text that uses them: Impress looks for them there.
    '<office:automatic-styles><text:list-style style:name="PearOfficeBullets">' + levels('bullet') + '</text:list-style><text:list-style style:name="PearOfficeNumbers">' + levels('number') + '</text:list-style>' +
    '<style:style style:name="dp1" style:family="drawing-page"><style:drawing-page-properties presentation:background-visible="true" presentation:background-objects-visible="true" draw:fill="solid" draw:fill-color="' + hash(hexOf(theme.background)) + '"/></style:style>' + w.automatic() + '</office:automatic-styles>' +
    '<office:body><office:presentation>' + pages + '</office:presentation></office:body></office:document-content>'
  const marker = (name, display, d, box) => '<draw:marker draw:name="' + name + '" draw:display-name="' + display + '" svg:viewBox="' + box + '" svg:d="' + d + '"/>'
  const styles = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ' + NS + ' office:version="1.3"><office:styles>' +
    marker(MARKERS.arrow, 'msArrowOpenEnd 5 106', 'M175 0l175 275-75 75-50-75v75h-100v-75l-50 75-75-75z', '0 0 350 350') +
    marker(MARKERS.triangle, 'msArrowEnd 5', 'M150 0l150 300h-300z', '0 0 300 300') +
    marker(MARKERS.oval, 'msArrowOvalEnd 5', 'M150 0l75 21 54 54 21 75-21 75-54 54-75 21-75-21-54-54-21-75 21-75 54-54z', '0 0 300 300') +
    '<style:default-style style:family="graphic"><style:graphic-properties draw:fill="none" draw:stroke="none"/><style:paragraph-properties fo:text-align="start"/><style:text-properties fo:font-family="' + esc(bodyFont) + '" fo:font-size="' + pt(defaultSize(theme, null)) + '" fo:color="' + hash(hexOf(theme.text)) + '"/></style:default-style>' +
    // The master's notes style: Impress takes a frame with it as the notes placeholder.
    '<style:style style:name="PearOffice-notes" style:family="presentation"><style:text-properties fo:font-size="12pt"/></style:style>' +
    '</office:styles><office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:margin-top="0cm" fo:margin-bottom="0cm" fo:margin-left="0cm" fo:margin-right="0cm" fo:page-width="' + cm(sw) + '" fo:page-height="' + cm(sh) + '" style:print-orientation="landscape"/></style:page-layout>' +
    '<style:style style:name="Mdp1" style:family="drawing-page"><style:drawing-page-properties draw:fill="solid" draw:fill-color="' + hash(hexOf(theme.background)) + '"/></style:style></office:automatic-styles>' +
    '<office:master-styles><style:master-page style:name="PearOffice" style:page-layout-name="pm1" draw:style-name="Mdp1"/></office:master-styles></office:document-styles>'
  const meta = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ' + NS + ' office:version="1.3"><office:meta><meta:generator>PearOffice</meta:generator>' + (title ? '<dc:title>' + esc(title) + '</dc:title>' : '') + '</office:meta></office:document-meta>'
  const pics = Object.entries(files).filter(([k]) => k.startsWith('Pictures/'))
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="' + ODP + '"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
    pics.map(([name, p]) => '<manifest:file-entry manifest:full-path="' + name + '" manifest:media-type="' + p.mime + '"/>').join('') +
    objects.map((d) => '<manifest:file-entry manifest:full-path="' + d + '/" manifest:media-type="application/vnd.oasis.opendocument.chart"/><manifest:file-entry manifest:full-path="' + d + '/content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="' + d + '/styles.xml" manifest:media-type="text/xml"/>').join('') +
    '</manifest:manifest>'
  const u8 = fflate.strToU8
  const zip = { mimetype: [u8(ODP), { level: 0 }], 'META-INF/manifest.xml': u8(manifest), 'content.xml': u8(content), 'styles.xml': u8(styles), 'meta.xml': u8(meta) }
  for (const [k, v] of Object.entries(files)) zip[k] = k.startsWith('Pictures/') ? [v.bytes, { level: 0 }] : v
  return fflate.zipSync(zip)
}
// The text colour on a shape's fill, as objects.jsx draws it.
function inkOn (fill, theme, opacity = 1) {
  if (fill === 'none' || fill === 'background' || opacity < 0.5) return hexOf(theme.text)
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill)
  if (!m) return hexOf(theme.background)
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '000000' : 'FFFFFF'
}

// Speaker notes as lines of text: one per paragraph, list items marked.
function notesParas (fragment) {
  const lines = []
  const walk = (node, list, depth) => {
    for (const child of node && node.toArray ? node.toArray() : []) {
      const name = child.nodeName
      if (name === 'paragraph' || name === 'heading') {
        const text = slidesModel.plainOf(child)
        lines.push(list ? '  '.repeat(depth) + (list.kind === 'orderedList' ? (list.n++) + '. ' : '- ') + text : text)
      } else if (name === 'bulletList' || name === 'orderedList') {
        const l = { kind: name, n: Number(child.getAttribute && child.getAttribute('start')) || 1 }
        for (const item of child.toArray()) walk(item, l, list ? depth + 1 : 0)
      } else if (child.toArray) walk(child, list, depth)
    }
  }
  walk(fragment, null, 0)
  while (lines.length && !lines[lines.length - 1].trim()) lines.pop()
  return lines.some((l) => l.trim()) ? lines : []
}

// --- opening ------------------------------------------------------------------

const NOT_ODP = 'This is not an OpenDocument presentation PearOffice can read.'
const PICTURE_MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const MAX_SLIDES = 500
const MAX_SHAPES = 5000
const UNIT_CM = { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: 2.54 / 96 }
const toCm = (v) => { const m = /^(-?[\d.]+(?:e-?\d+)?)(cm|mm|in|pt|pc|px)?$/i.exec(String(v || '').trim()); return m ? Number(m[1]) * UNIT_CM[(m[2] || 'cm').toLowerCase()] : 0 }
const normRot = (d) => Math.round((((d % 360) + 360) % 360) * 100) / 100

// Every style, by family and name: parent and the attributes of its properties.
function readStyles (doc, into) {
  for (const el of doc.getElementsByTagName('style:style')) {
    const name = el.getAttribute('style:name')
    const family = el.getAttribute('style:family')
    if (!name || !family) continue
    const props = (tag) => { const p = el.getElementsByTagName(tag)[0]; return p ? Object.fromEntries([...p.attributes].map((a) => [a.name, a.value])) : {} }
    into[family + ':' + name] = { name, parent: el.getAttribute('style:parent-style-name'), graphic: props('style:graphic-properties'), para: props('style:paragraph-properties'), text: props('style:text-properties'), page: props('style:drawing-page-properties') }
  }
  for (const el of doc.getElementsByTagName('style:default-style')) {
    const family = el.getAttribute('style:family')
    const props = (tag) => { const p = el.getElementsByTagName(tag)[0]; return p ? Object.fromEntries([...p.attributes].map((a) => [a.name, a.value])) : {} }
    into['default:' + family] = { name: 'default', parent: null, graphic: props('style:graphic-properties'), para: props('style:paragraph-properties'), text: props('style:text-properties'), page: {} }
  }
  return into
}

// A picture's size in pixels from its first bytes (PNG, JPEG, GIF, BMP,
// WebP), or null.
function pixelSize (b) {
  if (!b || b.length < 30) return null
  const u32 = (i) => ((b[i] << 24) | (b[i + 1] << 16) | (b[i + 2] << 8) | b[i + 3]) >>> 0
  const u16 = (i) => (b[i] << 8) | b[i + 1]
  const le16 = (i) => b[i] | (b[i + 1] << 8)
  const le32 = (i) => (b[i] | (b[i + 1] << 8) | (b[i + 2] << 16) | (b[i + 3] << 24)) >>> 0
  if (b[0] === 0x89 && b[1] === 0x50) return { w: u32(16), h: u32(20) }
  if (b[0] === 0x47 && b[1] === 0x49) return { w: le16(6), h: le16(8) }
  if (b[0] === 0x42 && b[1] === 0x4d) return { w: le32(18), h: Math.abs(le32(22) | 0) }
  if (b[0] === 0x52 && b[8] === 0x57) {
    const kind = String.fromCharCode(b[12], b[13], b[14], b[15])
    if (kind === 'VP8X') return { w: 1 + (b[24] | (b[25] << 8) | (b[26] << 16)), h: 1 + (b[27] | (b[28] << 8) | (b[29] << 16)) }
    if (kind === 'VP8 ') return { w: le16(26) & 0x3fff, h: le16(28) & 0x3fff }
    if (kind === 'VP8L') { const v = le32(21); return { w: (v & 0x3fff) + 1, h: ((v >> 14) & 0x3fff) + 1 } }
    return null
  }
  if (b[0] === 0xff && b[1] === 0xd8) {
    for (let i = 2; i + 9 < b.length;) {
      if (b[i] !== 0xff) return null
      const m = b[i + 1]
      if (m >= 0xc0 && m <= 0xcf && m !== 0xc4 && m !== 0xc8 && m !== 0xcc) return { w: u16(i + 7), h: u16(i + 5) }
      i += 2 + u16(i + 2)
    }
  }
  return null
}

// The plain data the .pptx reader gives (pptxImport.js, readPresentation).
export async function readOdp (bytes) {
  await checkZip(bytes, NOT_ODP)
  let files
  try { files = fflate.unzipSync(bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)) } catch { throw new Error(NOT_ODP) }
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const parse = (s) => new window.DOMParser().parseFromString(s || '<x/>', 'application/xml')
  const content = parse(read('content.xml'))
  const stylesDoc = parse(read('styles.xml'))
  if (!content.getElementsByTagName('office:presentation')[0]) throw new Error(NOT_ODP)
  const styles = readStyles(content, readStyles(stylesDoc, {}))
  const lost = {}
  const lose = (k, n = 1) => { lost[k] = (lost[k] || 0) + n }
  const fonts = {}
  for (const d of [stylesDoc, content]) for (const f of d.getElementsByTagName('style:font-face')) fonts[f.getAttribute('style:name')] = (f.getAttribute('svg:font-family') || '').replace(/^'|'$/g, '')
  const lists = {}
  for (const d of [stylesDoc, content]) {
    for (const ls of d.getElementsByTagName('text:list-style')) {
      const lv = {}
      for (const c of ls.childNodes) if (c.getAttribute) lv[Number(c.getAttribute('text:level'))] = c.nodeName === 'text:list-level-style-number' && !!c.getAttribute('style:num-format')
      lists[ls.getAttribute('style:name')] = lv
    }
  }

  // The page size, from the first master page's layout.
  const master = stylesDoc.getElementsByTagName('style:master-page')[0]
  const layoutName = master && master.getAttribute('style:page-layout-name')
  let pageW = 28
  let pageH = 15.75
  for (const pl of stylesDoc.getElementsByTagName('style:page-layout')) {
    if (layoutName && pl.getAttribute('style:name') !== layoutName) continue
    const p = pl.getElementsByTagName('style:page-layout-properties')[0]
    if (p && toCm(p.getAttribute('fo:page-width')) > 1 && toCm(p.getAttribute('fo:page-height')) > 1) { pageW = toCm(p.getAttribute('fo:page-width')); pageH = toCm(p.getAttribute('fo:page-height')) }
    break
  }
  const size = deckSize(pageW, pageH)
  const k = size[0] / pageW // slide units per cm
  const ptScale = (size[0] / (pageW / 2.54 * 72)) / 2

  // A style property following parents, then the family's default.
  const prop = (family, name, part, key) => {
    const seen = new Set()
    let s = name && styles[family + ':' + name]
    while (s && !seen.has(s.name)) {
      seen.add(s.name)
      if (s[part] && s[part][key] != null) return s[part][key]
      s = s.parent && styles[family + ':' + s.parent]
    }
    const d = styles['default:' + family]
    return d && d[part][key] != null ? d[part][key] : null
  }
  const graphicOf = (el) => {
    const g = el.getAttribute('draw:style-name')
    const p = el.getAttribute('presentation:style-name')
    const fam = g ? 'graphic' : 'presentation'
    const name = g || p
    return (key) => prop(fam, name, 'graphic', key) ?? (fam === 'presentation' ? null : prop('graphic', null, 'graphic', key))
  }
  const colour = (v) => (/^#[0-9a-f]{6}$/i.test(v || '') ? v.toLowerCase() : null)
  const opacity = (v) => { const n = parseFloat(v); return Number.isFinite(n) ? Math.max(0, Math.min(1, n / 100)) : 1 }

  // --- text -------------------------------------------------------------
  const textRun = (styleName, base) => {
    if (!styleName) return base
    const t = (key) => prop('text', styleName, 'text', key)
    const out = { ...base }
    const wgt = t('fo:font-weight')
    if (wgt) out.b = wgt === 'bold' || Number(wgt) >= 600
    const sty = t('fo:font-style')
    if (sty) out.i = sty === 'italic' || sty === 'oblique'
    const u = t('style:text-underline-style')
    if (u) out.u = u !== 'none'
    const s = t('style:text-line-through-style')
    if (s) out.s = s !== 'none'
    const size = t('fo:font-size')
    if (size && /pt$/.test(size)) out.size = parseFloat(size)
    const c = colour(t('fo:color'))
    if (c) out.color = c
    const font = t('fo:font-family') || fonts[t('style:font-name')]
    if (font) out.font = font.replace(/^'|'$/g, '')
    return out
  }
  // Paragraphs of a text box or shape: [{ level, bullet, align, lnSpc, runs }].
  const paragraphs = (el, frameText) => {
    const out = []
    const baseRun = frameText
    const walk = (node, ctx) => {
      for (const c of node.childNodes) {
        if (c.nodeType !== 1) continue
        if (c.nodeName === 'text:p' || c.nodeName === 'text:h') {
          const ps = c.getAttribute('text:style-name')
          const pr = (key) => prop('paragraph', ps, 'para', key)
          const pBase = textRun(ps && styles['paragraph:' + ps] ? ps : null, baseRun)
          // A paragraph style's text properties live on it, under the paragraph family.
          const pt2 = (key) => prop('paragraph', ps, 'text', key)
          const size = pt2('fo:font-size')
          const base2 = { ...pBase }
          if (size && /pt$/.test(size)) base2.size = parseFloat(size)
          const c2 = colour(pt2('fo:color'))
          if (c2) base2.color = c2
          if (pt2('fo:font-weight')) base2.b = pt2('fo:font-weight') === 'bold'
          if (pt2('fo:font-style')) base2.i = pt2('fo:font-style') === 'italic'
          const runs = []
          const inline = (n, rb) => {
            for (const x of n.childNodes) {
              if (x.nodeType === 3) { if (x.nodeValue) runs.push({ text: x.nodeValue, ...rb }); continue }
              if (x.nodeType !== 1) continue
              if (x.nodeName === 'text:s') runs.push({ text: ' '.repeat(Number(x.getAttribute('text:c')) || 1), ...rb })
              else if (x.nodeName === 'text:tab') runs.push({ text: '\t', ...rb })
              else if (x.nodeName === 'text:line-break') runs.push({ br: true })
              else if (x.nodeName === 'text:span') inline(x, textRun(x.getAttribute('text:style-name'), rb))
              else if (x.nodeName === 'text:a') { const href = x.getAttribute('xlink:href') || ''; inline(x, { ...rb, href: /^(https?:|mailto:)/i.test(href) ? href.slice(0, 2000) : null }) } else if (!/^(office:annotation|text:note)/.test(x.nodeName)) inline(x, rb)
            }
          }
          inline(c, base2)
          const align = { center: 'center', end: 'right', right: 'right', justify: 'justify' }[pr('fo:text-align')] || null
          const lh = pr('fo:line-height')
          out.push({ level: Math.max(0, Math.min(8, ctx.level)), bullet: ctx.list ? { type: ctx.ordered ? 'ordered' : 'bullet', start: ctx.start || 1 } : null, align, lnSpc: /%$/.test(lh || '') ? parseFloat(lh) / 100 : null, runs: runs.map((r) => (r.br ? r : { text: r.text, b: !!r.b, i: !!r.i, u: !!r.u, s: !!r.s, size: r.size || null, color: r.color || null, font: r.font || null, href: r.href || null })) })
        } else if (c.nodeName === 'text:list') {
          const name = c.getAttribute('text:style-name') || ctx.listStyle
          const level = ctx.list ? ctx.level + 1 : 0
          const ordered = !!(lists[name] || {})[level + 1]
          for (const item of c.childNodes) {
            if (item.nodeName !== 'text:list-item' && item.nodeName !== 'text:list-header') continue
            walk(item, { list: item.nodeName === 'text:list-item', ordered, level, listStyle: name, start: Number(item.getAttribute('text:start-value')) || 1 })
          }
        } else if (c.nodeName === 'draw:text-box') walk(c, ctx)
      }
    }
    walk(el, { level: 0 })
    return out
  }
  // The text size and colour a frame's style gives its text.
  const frameTextBase = (el) => {
    const base = {}
    const fam = el.getAttribute('draw:style-name') ? 'graphic' : 'presentation'
    const name = el.getAttribute('draw:style-name') || el.getAttribute('presentation:style-name')
    const tp = (key) => prop(fam, name, 'text', key)
    const size = tp('fo:font-size')
    if (size && /pt$/.test(size)) base.size = parseFloat(size)
    const c = colour(tp('fo:color'))
    if (c) base.color = c
    return base
  }

  // --- frames and transforms ---------------------------------------------
  const frameOf = (el) => {
    const w = toCm(el.getAttribute('svg:width'))
    const h = toCm(el.getAttribute('svg:height'))
    let x = toCm(el.getAttribute('svg:x'))
    let y = toCm(el.getAttribute('svg:y'))
    let rot = 0
    const tf = el.getAttribute('draw:transform')
    if (tf) {
      const r = /rotate\s*\(\s*(-?[\d.e-]+)\s*\)/.exec(tf)
      const t = /translate\s*\(\s*(-?[\d.e-]+[a-z]*)\s+(-?[\d.e-]+[a-z]*)\s*\)/.exec(tf)
      const a = r ? -Number(r[1]) : 0 // clockwise, radians
      const tx = t ? toCm(t[1]) : x
      const ty = t ? toCm(t[2]) : y
      // The top-left corner was turned about itself, then moved: find the centre.
      const cx = tx + w / 2 * Math.cos(a) - h / 2 * Math.sin(a)
      const cy = ty + w / 2 * Math.sin(a) + h / 2 * Math.cos(a)
      x = cx - w / 2
      y = cy - h / 2
      rot = a * 180 / Math.PI
    }
    return { x: Math.round(x * k), y: Math.round(y * k), w: Math.max(1, Math.round(w * k)), h: Math.max(1, Math.round(h * k)), rot: normRot(rot) }
  }

  const media = new Map()
  const look = (el) => {
    const g = graphicOf(el)
    const fillKind = g('draw:fill')
    let fill = 'none'
    if (fillKind === 'solid' || (!fillKind && colour(g('draw:fill-color')) && el.nodeName !== 'draw:frame')) fill = colour(g('draw:fill-color')) || '#729fcf'
    else if (fillKind === 'gradient') { lose('gradients'); fill = colour(g('draw:fill-color')) || '#729fcf' } else if (fillKind === 'hatch') { lose('patterns'); fill = colour(g('draw:fill-color')) || '#729fcf' } else if (fillKind === 'bitmap') lose('pictureFills')
    const fillOpacity = fill !== 'none' ? opacity(g('draw:opacity')) : 1
    const strokeKind = g('draw:stroke')
    let line = 'none'
    let lineW = 0
    if (strokeKind && strokeKind !== 'none') {
      line = colour(g('svg:stroke-color')) || '#3465a4'
      lineW = Math.max(1, Math.min(100, Math.round(toCm(g('svg:stroke-width') || '0') * k) || 1))
    }
    const lineOpacity = line !== 'none' ? opacity(g('svg:stroke-opacity')) : 1
    const anchor = { top: 'top', middle: 'middle', bottom: 'bottom' }[g('draw:textarea-vertical-align')] || null
    const wrap = g('fo:wrap-option') === 'no-wrap' ? false : undefined
    // Impress's names: "msArrowOpenEnd" and "Line Arrow" are open, ovals and
    // circles round, the rest filled triangles.
    const end = (name) => { const n = String(name || '').toLowerCase(); return !n ? 'none' : /open|line[ _]arrow|line_20_arrow/.test(n) ? 'arrow' : /circle|oval|round|dot/.test(n) ? 'oval' : 'triangle' }
    return { fill, fillOpacity, line, lineW, lineOpacity, anchor, wrap, head: end(g('draw:marker-start')), tail: end(g('draw:marker-end')) }
  }

  // An enhanced path with no formulas, in a view box, as an SVG path in the
  // 1000 x 1000 box; null when it cannot be drawn so.
  const pathFrom = (geom) => {
    const d = geom.getAttribute('draw:enhanced-path') || ''
    if (!d || /[?$]/.test(d)) return null
    // The path's space: the view box, or (Impress from a .pptx) its sub-view size.
    const vb = (geom.getAttribute('svg:viewBox') || '').trim().split(/[\s,]+/).map(Number)
    const sub = (geom.getAttribute('drawooo:sub-view-size') || '').trim().split(/\s+/).map(Number)
    const [vx, vy, vw, vh] = vb.length === 4 && vb[2] > 0 && vb[3] > 0 ? vb : sub.length === 2 && sub[0] > 0 && sub[1] > 0 ? [0, 0, sub[0], sub[1]] : [0, 0, 21600, 21600]
    const t = d.match(/[A-Za-z]|-?[\d.]+(?:e-?\d+)?/g) || []
    let out = ''
    let cmd = null
    const X = (v) => Math.round((Number(v) - vx) / vw * BOX * 10) / 10
    const Y = (v) => Math.round((Number(v) - vy) / vh * BOX * 10) / 10
    for (let i = 0; i < t.length;) {
      if (/[A-Za-z]/.test(t[i])) { cmd = t[i++]; if (cmd === 'Z') { out += 'Z '; continue } if (cmd === 'N' || cmd === 'F' || cmd === 'S') continue; if (!'MLCQ'.includes(cmd)) return null; continue }
      const n = { M: 2, L: 2, C: 6, Q: 4 }[cmd]
      if (!n || i + n > t.length) return null
      const v = t.slice(i, i + n)
      i += n
      out += cmd + ' ' + v.map((x, j) => (j % 2 ? Y(x) : X(x))).join(' ') + ' '
    }
    return /^M/.test(out) ? out.trim() : null
  }
  const PRESETS = { rectangle: 'rect', 'round-rectangle': 'roundRect', ellipse: 'ellipse', circle: 'ellipse', 'isosceles-triangle': 'triangle', 'right-arrow': 'arrow', 'ooxml-rect': 'rect', 'ooxml-roundRect': 'roundRect', 'ooxml-ellipse': 'ellipse', 'ooxml-triangle': 'triangle', 'ooxml-rightArrow': 'arrow' }
  const TURNED = { 'left-arrow': 180, 'ooxml-leftArrow': 180, 'down-arrow': 90, 'ooxml-downArrow': 90, 'up-arrow': 270, 'ooxml-upArrow': 270 }

  // --- charts --------------------------------------------------------------
  const chartOf = (dir) => {
    const doc = parse(read(dir + '/content.xml'))
    const head = doc.getElementsByTagName('chart:chart')[0]
    if (!head) return null
    const cls = (head.getAttribute('chart:class') || '').replace('chart:', '')
    const plot = doc.getElementsByTagName('chart:plot-area')[0]
    // The local table as a grid of values.
    const grid = []
    const table = [...doc.getElementsByTagName('table:table')].find((t) => t.getAttribute('table:name') === 'local-table') || doc.getElementsByTagName('table:table')[0]
    if (!table) return null
    for (const row of table.getElementsByTagName('table:table-row')) {
      const line = []
      for (const c of row.childNodes) {
        if (c.nodeName !== 'table:table-cell' && c.nodeName !== 'table:covered-table-cell') continue
        const n = Math.min(Number(c.getAttribute('table:number-columns-repeated')) || 1, 100)
        const v = c.getAttribute('office:value-type') === 'float' || c.getAttribute('office:value-type') === 'percentage' ? Number(c.getAttribute('office:value')) : (c.textContent || '').trim() || null
        for (let i = 0; i < n; i++) line.push(v)
      }
      grid.push(line)
    }
    const range = (s) => {
      const m = /\.\$?([A-Z]+)\$?(\d+)(?::[^.]*\.\$?([A-Z]+)\$?(\d+))?/.exec(String(s || ''))
      if (!m) return null
      const col = (c) => c.split('').reduce((n, ch) => n * 26 + ch.charCodeAt(0) - 64, 0) - 1
      return { c1: col(m[1]), r1: Number(m[2]) - 1, c2: col(m[3] || m[1]), r2: Number(m[4] || m[2]) - 1 }
    }
    const cells = (r) => { const out = []; if (!r) return out; for (let i = r.r1; i <= r.r2; i++) for (let j = r.c1; j <= r.c2; j++) out.push((grid[i] || [])[j] ?? null); return out }
    const seriesEls = [...doc.getElementsByTagName('chart:series')]
    if (!seriesEls.length) return null
    const catEl = doc.getElementsByTagName('chart:categories')[0] || doc.getElementsByTagName('chart:domain')[0]
    const categories = cells(range(catEl && catEl.getAttribute('table:cell-range-address')))
    const series = seriesEls.map((s, i) => {
      const values = cells(range(s.getAttribute('chart:values-cell-range-address'))).map((v) => (typeof v === 'number' && isFinite(v) ? v : null))
      const name = cells(range(s.getAttribute('chart:label-cell-address')))[0]
      return { name: name == null ? 'Series ' + (i + 1) : String(name), values }
    })
    const n = Math.max(categories.length, ...series.map((s) => s.values.length))
    const cats = Array.from({ length: n }, (_, i) => (categories[i] == null ? null : categories[i]))
    const lineClasses = seriesEls.map((s) => (s.getAttribute('chart:class') || '').replace('chart:', ''))
    const chartPlot = (key) => {
      const name = plot && plot.getAttribute('chart:style-name')
      const el = name && [...doc.getElementsByTagName('style:style')].find((x) => x.getAttribute('style:name') === name)
      const p = el && el.getElementsByTagName('style:chart-properties')[0]
      return p ? p.getAttribute(key) : null
    }
    let type = { bar: chartPlot('chart:vertical') === 'true' ? 'bar' : 'column', line: 'line', area: 'area', circle: 'pie', ring: 'doughnut', scatter: 'scatter', radar: 'radar', 'filled-radar': 'radar', bubble: 'scatter', stock: 'line' }[cls] || 'column'
    if (cls === 'bar' && lineClasses.includes('line')) { lose('chartTypes'); type = 'column' }
    const titleEl = [...head.childNodes].find((c) => c.nodeName === 'chart:title')
    const legendEl = [...head.childNodes].find((c) => c.nodeName === 'chart:legend')
    const chart = { type }
    if (titleEl && titleEl.textContent.trim()) chart.title = titleEl.textContent.trim().slice(0, 200)
    chart.legend = !legendEl ? 'none' : /^(end|start)$/.test(legendEl.getAttribute('chart:legend-position') || '') ? 'right' : 'bottom'
    if (chartPlot('chart:stacked') === 'true' || chartPlot('chart:percentage') === 'true') chart.stacked = true
    if (/value|percentage/.test(String(chartPlot('chart:data-label-number') || '')) || [...doc.getElementsByTagName('style:chart-properties')].some((p) => /value/.test(p.getAttribute('chart:data-label-number') || ''))) chart.dataLabels = true
    if (/spline/.test(String(chartPlot('chart:interpolation') || ''))) chart.smooth = true
    return { chart, data: { categories: cats, series } }
  }

  // --- the slides ----------------------------------------------------------
  const slides = []
  let walked = 0
  const pagesEl = content.getElementsByTagName('office:presentation')[0]
  const pagesList = [...pagesEl.childNodes].filter((c) => c.nodeName === 'draw:page')
  if (pagesList.length > MAX_SLIDES) throw new Error('This presentation has more than ' + MAX_SLIDES + ' slides, more than PearOffice can import.')
  for (const page of pagesList) {
    const els = []
    let notes = null
    const ps = page.getAttribute('draw:style-name')
    const masterName = page.getAttribute('draw:master-page-name')
    const mp = [...stylesDoc.getElementsByTagName('style:master-page')].find((m) => m.getAttribute('style:name') === masterName) || master
    const bgOf = (name, fam = 'drawing-page') => { const f = prop(fam, name, 'page', 'draw:fill'); return f === 'solid' || (!f && prop(fam, name, 'page', 'draw:fill-color')) ? colour(prop(fam, name, 'page', 'draw:fill-color')) : null }
    const bg = bgOf(ps) || (mp && bgOf(mp.getAttribute('draw:style-name'))) || null
    let hasSubtitle = false
    const visit = (node, depth) => {
      for (const el of node.childNodes) {
        if (el.nodeType !== 1) continue
        if (++walked > MAX_SHAPES * (slides.length + 1)) { lose('elements'); continue }
        const name = el.nodeName
        if (name === 'presentation:notes') {
          const frame = [...el.getElementsByTagName('draw:frame')].find((f) => f.getAttribute('presentation:class') === 'notes')
          if (frame) notes = paragraphs(frame, {})
          continue
        }
        if (name === 'draw:g') { if (depth < 20) visit(el, depth + 1); continue }
        if (name === 'office:forms' || name === 'anim:par' || name === 'anim:seq') { if (name !== 'office:forms') lose('animations'); continue }
        if (name === 'draw:frame') {
          const cls = el.getAttribute('presentation:class')
          if (['date-time', 'footer', 'header', 'page-number', 'page'].includes(cls)) continue
          const frame = frameOf(el)
          const tb = el.getElementsByTagName('draw:text-box')[0]
          const img = el.getElementsByTagName('draw:image')[0]
          const obj = el.getElementsByTagName('draw:object')[0]
          const tbl = el.getElementsByTagName('table:table')[0]
          if (obj) {
            const dir = (obj.getAttribute('xlink:href') || '').replace(/^\.\//, '').replace(/\/$/, '')
            const c = files[dir + '/content.xml'] && chartOf(dir)
            if (c) els.push({ kind: 'chart', frame, chart: c.chart, data: c.data })
            else lose(files[dir + '/content.xml'] ? 'charts' : 'objects')
            continue
          }
          if (tbl) {
            lose('tables')
            const paras = paragraphs(tbl, {})
            if (paras.length) els.push({ kind: 'text', frame, paras })
            continue
          }
          if (img && !tb) {
            const href = (img.getAttribute('xlink:href') || '').replace(/^\.\//, '')
            const ext = (/\.([a-z0-9]+)$/i.exec(href) || [])[1]
            const mime = ext && PICTURE_MIMES[ext.toLowerCase()]
            if (!files[href] || !mime) { lose('pictures'); continue }
            media.set(href, mime)
            const titleEl = el.getElementsByTagName('svg:desc')[0] || el.getElementsByTagName('svg:title')[0]
            const g = graphicOf(el)
            const clip = /rect\(\s*([^,]+),\s*([^,]+),\s*([^,]+),\s*([^)]+)\)/.exec(g('fo:clip') || '')
            let crop = null
            const px = clip && pixelSize(files[href])
            if (clip && px) {
              // Lengths of the whole picture, at 96 pixels to the inch.
              const [t, r, b, l] = clip.slice(1).map(toCm)
              const W = px.w / 96 * 2.54
              const H = px.h / 96 * 2.54
              const c = { l: l / W, t: t / H, r: r / W, b: b / H }
              if ((t || r || b || l) && Object.values(c).every((v) => v >= 0 && v < 1) && c.l + c.r < 1 && c.t + c.b < 1) crop = c
            }
            els.push({ kind: 'picture', frame, media: href, alt: titleEl ? titleEl.textContent.slice(0, 500) : '', crop })
            continue
          }
          if (!tb) continue
          const paras = paragraphs(tb, frameTextBase(el))
          const lk = look(el)
          const ph = cls === 'title' ? 'title' : cls === 'outline' || cls === 'subtitle' || cls === 'text' ? 'body' : null
          if (cls === 'subtitle') hasSubtitle = true
          if (lk.fill !== 'none' || lk.line !== 'none') els.push({ kind: 'shape', shape: 'rect', frame, ...lk, paras, ph: null })
          else els.push({ kind: 'text', frame, paras, ph, phType: cls === 'title' ? 'title' : cls, anchor: lk.anchor, wrap: lk.wrap })
          continue
        }
        if (name === 'draw:line' || name === 'draw:connector') {
          const x1 = toCm(el.getAttribute('svg:x1')) * k
          const y1 = toCm(el.getAttribute('svg:y1')) * k
          const x2 = toCm(el.getAttribute('svg:x2')) * k
          const y2 = toCm(el.getAttribute('svg:y2')) * k
          const lk = look(el)
          if (lk.line === 'none') { lk.line = '#3465a4'; lk.lineW = Math.max(1, lk.lineW) }
          const len = Math.max(1, Math.hypot(x2 - x1, y2 - y1))
          const h = Math.max(20, Math.round(lk.lineW + 8))
          els.push({ kind: 'shape', shape: 'line', frame: { x: Math.round((x1 + x2) / 2 - len / 2), y: Math.round((y1 + y2) / 2 - h / 2), w: Math.round(len), h, rot: normRot(Math.atan2(y2 - y1, x2 - x1) * 180 / Math.PI) }, fill: 'none', line: lk.line, lineW: lk.lineW, fillOpacity: 1, lineOpacity: lk.lineOpacity, head: lk.head, tail: lk.tail, paras: [] })
          continue
        }
        if (name === 'draw:rect' || name === 'draw:ellipse' || name === 'draw:circle' || name === 'draw:custom-shape' || name === 'draw:polygon' || name === 'draw:polyline' || name === 'draw:path') {
          let frame = frameOf(el)
          const lk = look(el)
          const paras = paragraphs(el, frameTextBase(el))
          let shape = { 'draw:rect': 'rect', 'draw:ellipse': 'ellipse', 'draw:circle': 'ellipse' }[name] || 'rect'
          let path = null
          let radius
          if (name === 'draw:rect' && toCm(el.getAttribute('draw:corner-radius')) > 0) {
            shape = 'roundRect'
            radius = Math.min(0.5, toCm(el.getAttribute('draw:corner-radius')) * k / Math.max(1, Math.min(frame.w, frame.h)))
          }
          if (name === 'draw:custom-shape') {
            const geom = el.getElementsByTagName('draw:enhanced-geometry')[0]
            const kind = geom && geom.getAttribute('draw:type')
            if (geom && geom.getAttribute('draw:mirror-horizontal') === 'true') lose('approximated')
            // Our own triangle and arrow (enhancedPath), by their outline.
            const ep = String(geom && geom.getAttribute('draw:enhanced-path') || '').replace(/\s+/g, ' ').trim()
            const vb = String(geom && geom.getAttribute('svg:viewBox') || '').trim()
            const ours = vb === '0 0 1000 1000' && (/^M 500 0 L 1000 1000 0 1000 Z N$/.test(ep) ? 'triangle' : /^M 0 300 L (\d+) 300 \1 0 1000 500 \1 1000 \1 700 0 700 Z N$/.test(ep) ? 'arrow' : null)
            if (ours) shape = ours
            else if (kind && PRESETS[kind]) shape = PRESETS[kind]
            else if (kind && TURNED[kind] != null) {
              shape = 'arrow'
              if (TURNED[kind] === 90 || TURNED[kind] === 270) { const cx = frame.x + frame.w / 2; const cy = frame.y + frame.h / 2; frame = { x: Math.round(cx - frame.h / 2), y: Math.round(cy - frame.w / 2), w: frame.h, h: frame.w, rot: frame.rot } }
              frame = { ...frame, rot: normRot(frame.rot + TURNED[kind]) }
            } else if (geom && (path = pathFrom(geom))) shape = 'custom'
            else lose(kind && kind !== 'non-primitive' ? 'otherShapes' : 'customShapes')
            if (shape === 'roundRect' && radius == null) {
              const mod = Number(String(geom.getAttribute('draw:modifiers') || '').trim().split(/\s+/)[0])
              // Impress's own corner is of 21600; one from a .pptx (ooxml-) of 100000.
              const of = kind === 'round-rectangle' ? 21600 : kind === 'ooxml-roundRect' ? 100000 : 0
              radius = of && Number.isFinite(mod) ? Math.max(0, Math.min(0.5, mod / of)) : 0.16667
            }
          } else if (name === 'draw:polygon' || name === 'draw:polyline' || name === 'draw:path') {
            const vb = (el.getAttribute('svg:viewBox') || '').trim().split(/[\s,]+/).map(Number)
            const pts = name === 'draw:path' ? null : (el.getAttribute('draw:points') || '').trim().split(/\s+/).map((p) => p.split(',').map(Number))
            if (vb.length === 4 && vb[2] > 0 && vb[3] > 0 && pts && pts.length > 1 && pts.every((p) => p.length === 2 && p.every(isFinite))) {
              const X = (v) => Math.round((v - vb[0]) / vb[2] * BOX * 100) / 100
              const Y = (v) => Math.round((v - vb[1]) / vb[3] * BOX * 100) / 100
              path = 'M ' + pts.map((p) => X(p[0]) + ' ' + Y(p[1])).join(' L ') + (name === 'draw:polygon' ? ' Z' : '')
              shape = 'custom'
            } else lose('customShapes')
          }
          // A rectangle with no fill or outline that holds text is a text box
          // (Impress makes .pptx text boxes so).
          if (shape === 'rect' && lk.fill === 'none' && lk.line === 'none' && paras.length && paras.some((pp) => pp.runs.some((r) => r.text && r.text.trim()))) {
            els.push({ kind: 'text', frame, paras, ph: null, anchor: lk.anchor, wrap: lk.wrap })
            continue
          }
          els.push({ kind: 'shape', shape, path, radius, frame, ...lk, paras })
          continue
        }
        // A linked picture or shape (proposals/2026-10-26-picture-links.md).
        if (name === 'draw:a') {
          const before = els.length
          visit(el, depth + 1)
          const link = okLink(el.getAttribute('xlink:href'))
          if (link) for (const made of els.slice(before)) if (made.kind === 'picture' || made.kind === 'shape') made.link = link
          continue
        }
        if (/^(draw|presentation|anim|dr3d):/.test(name) && !/^presentation:(notes)$/.test(name)) lose(name === 'draw:plugin' ? 'media' : 'other')
      }
    }
    visit(page, 0)
    if (page.getElementsByTagName('anim:par').length) lose('animations')
    if (page.getAttribute('presentation:transition-type') || prop('drawing-page', ps, 'page', 'presentation:transition-type') || prop('drawing-page', ps, 'page', 'smil:type')) lose('transitions')
    slides.push({ layoutType: hasSubtitle ? 'title' : null, els, notes, bg: bg ? { colour: bg } : null })
  }
  return { size, ptScale, slides, media, readMedia: async (path) => files[path] || null, lost }
}
