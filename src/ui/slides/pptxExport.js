// A deck as a PowerPoint file (proposals/2026-10-06-slides.md, "Import and
// export"), written with pptxgenjs. Runs in the page and under Node (with
// happy-dom), so it imports nothing that draws.
//
// Slide space is 144 units to the inch (1920 x 1080 is 13.333 x 7.5 in) and
// text sizes are already PowerPoint points (geometry.js, TEXT_SCALE). Theme
// slots are written out as the theme's colours and fonts, with no master.
// Deleted slides are left out.
//
// pptxgenjs writes a paragraph property block for every run of a paragraph,
// which PowerPoint calls damaged, and has no option for an arrow's head or
// shaft or a picture's crop, so the slides it writes are tidied up after
// (tidySlide). Opacity, where text sits, wrapping, line ends and custom
// shapes (custGeom from the path, svgPath.js) it writes itself.
//
// Charts are written as PowerPoint charts (pptxChart) with their values,
// series names and colours, so PowerPoint and LibreOffice can edit them.
// pptxgenjs cannot stack a line chart and writes empty points for missing
// values; tidyChart puts those right.

import PptxGenJS from 'pptxgenjs'
import JSZip from 'jszip'
import { yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import slidesModel from '../../slides/slidesModel.js'
import { ROLES } from '../../slides/layouts.js'
import { themeFor, defaultSize } from './themes.js'
import { slideSchema } from './text.js'
import { parsePath, BOX } from './svgPath.js'

export const PPTX = 'application/vnd.openxmlformats-officedocument.presentationml.presentation'

const PER_IN = 144 // slide units to the inch
const inch = (v) => v / PER_IN
// .slide-body's padding (6px 10px) at TEXT_SCALE, in points.
const PAD_X = 7.5
const PAD_Y = 4.5
const PRESET = { rect: 'rect', roundRect: 'roundRect', ellipse: 'ellipse', triangle: 'triangle', arrow: 'rightArrow', line: 'line', custom: 'custGeom' }
const VALIGN = { top: 'top', middle: 'middle', bottom: 'bottom' }
// Percent see-through, as pptxgenjs takes it; undefined when opaque.
const transparency = (opacity) => (opacity < 1 ? Math.round((1 - opacity) * 100) : undefined)

// A custom shape's path as pptxgenjs custGeom points, in inches from the
// corner of a w x h (slide units) box. Null when the path cannot be read.
export function customPoints (d, w, h) {
  const segs = parsePath(d)
  if (!segs) return null
  const X = (v) => Math.round(inch(v / BOX * w) * 10000) / 10000
  const Y = (v) => Math.round(inch(v / BOX * h) * 10000) / 10000
  const out = []
  for (const sg of segs) {
    if (sg.c === 'Z') out.push({ close: true })
    else if (sg.c === 'M') out.push({ x: X(sg.x), y: Y(sg.y), moveTo: true })
    else if (sg.c === 'L') out.push({ x: X(sg.x), y: Y(sg.y) })
    else if (sg.c === 'C') out.push({ x: X(sg.x), y: Y(sg.y), curve: { type: 'cubic', x1: X(sg.x1), y1: Y(sg.y1), x2: X(sg.x2), y2: Y(sg.y2) } })
    else if (sg.c === 'Q') out.push({ x: X(sg.x), y: Y(sg.y), curve: { type: 'quadratic', x1: X(sg.x1), y1: Y(sg.y1) } })
  }
  return out
}

// --- charts --------------------------------------------------------------------

const CHART_KINDS = { column: 'bar', bar: 'bar', line: 'line', area: 'area', pie: 'pie', doughnut: 'doughnut', scatter: 'scatter', radar: 'radar' }

// A chart's data as it is drawn: a scatter chart whose X values are all
// missing (text, from another type) puts its points at 1, 2, 3 and on, as
// PowerPoint does.
export function chartData ({ chart, data }) {
  if (chart.type !== 'scatter' || !data.categories.length || data.categories.some((x) => x !== null)) return data
  return { ...data, categories: data.categories.map((_, i) => i + 1) }
}

// A chart element ({ chart, data }, slidesModel.chartOf) as pptxgenjs
// addChart's arguments: { type, data, options }. Colours and text follow
// the slide theme as the chart is drawn (SlideChart.jsx), text in the
// chart's own text colour when it has one; sizes are its ECharts sizes in
// points. Horizontal bars keep PowerPoint's order (first category at the
// bottom), which is how slides draw them.
export function pptxChart (value, theme) {
  const chart = value.chart
  const data = chartData(value)
  const type = CHART_KINDS[chart.type] || 'bar'
  const pie = type === 'pie' || type === 'doughnut'
  const accents = theme.accents.map(hexOf)
  const font = fontName(theme.bodyFont)
  const ink = slotHex(chart.textColor, theme) || hexOf(theme.text)
  const labels = data.categories.map((c) => (c === null || c === undefined ? '' : String(c)))
  let rows
  if (type === 'scatter') {
    // pptxgenjs takes the X values first, then each series' Y values.
    rows = [{ name: 'X', values: data.categories.map((x) => (typeof x === 'number' ? x : null)) }, ...data.series.map((sr) => ({ name: sr.name, values: sr.values }))]
  } else {
    rows = (pie ? data.series.slice(0, 1) : data.series).map((sr) => ({ name: sr.name, labels, values: sr.values }))
  }
  const legend = chart.legend || (data.series.length > 1 || pie ? 'bottom' : 'none')
  const colours = pie
    ? labels.map((_, i) => accents[i % accents.length])
    : data.series.map((sr, i) => hexOf(sr.color) || accents[i % accents.length])
  const options = {
    chartColors: colours.length ? colours : accents,
    showLegend: legend !== 'none',
    legendPos: legend === 'right' ? 'r' : 'b',
    legendColor: ink,
    legendFontFace: font,
    legendFontSize: 12,
    showTitle: !!chart.title,
    title: chart.title || undefined,
    titleColor: ink,
    titleFontFace: font,
    titleFontSize: 14,
    showValue: !!chart.dataLabels,
    dataLabelColor: ink,
    dataLabelFontFace: font,
    dataLabelFontSize: 12,
    catAxisLabelColor: ink,
    catAxisLabelFontFace: font,
    catAxisLabelFontSize: 12,
    valAxisLabelColor: ink,
    valAxisLabelFontFace: font,
    valAxisLabelFontSize: 12
  }
  if (type === 'bar') {
    options.barDir = chart.type === 'bar' ? 'bar' : 'col'
    options.barGrouping = chart.stacked ? 'stacked' : 'clustered'
  }
  if (type === 'area' && chart.stacked) options.barGrouping = 'stacked'
  if (type === 'doughnut') options.holeSize = 60
  // Pie labels as PearOffice draws them (SlideChart.jsx compactPie): with a
  // legend, the percentage inside each slice; without one, name, value and
  // percentage.
  if (pie && chart.dataLabels) {
    const withLegend = legend !== 'none'
    options.showValue = !withLegend
    options.showPercent = true
    options.showLabel = !withLegend
    if (withLegend) options.dataLabelPosition = 'ctr'
  }
  if (type === 'line' && chart.smooth) options.lineSmooth = true
  if (type === 'scatter') options.lineSize = 0
  if (type === 'radar') options.radarStyle = 'marker'
  return { type, data: rows, options }
}

// A chart part from pptxgenjs, tidied: a stacked line chart gets its
// grouping and points with no value go.
export function tidyChart (xml, { stackedLine = false } = {}) {
  xml = xml.replace(/<c:pt idx="\d+"><c:v><\/c:v><\/c:pt>/g, '')
  if (stackedLine) xml = xml.replace(/<c:lineChart>(?!<c:grouping)/g, '<c:lineChart><c:grouping val="stacked"/>')
  return xml
}

// --- colours and fonts ----------------------------------------------------------

// A CSS colour as RRGGBB, or null.
export function hexOf (c) {
  const s = String(c || '').trim()
  let m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^#([0-9a-f])([0-9a-f])([0-9a-f])$/i.exec(s)
  if (m) return (m[1] + m[1] + m[2] + m[2] + m[3] + m[3]).toUpperCase()
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s)
  if (m) return m.slice(1, 4).map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

// A stored colour (a theme slot or a hex value) as RRGGBB; null for none.
export function slotHex (c, theme) {
  if (!c || c === 'none') return null
  if (c === 'text') return hexOf(theme.text)
  if (c === 'background') return hexOf(theme.background)
  const m = /^accent([1-6])$/.exec(c)
  if (m) return hexOf(theme.accents[Number(m[1]) - 1])
  return hexOf(c)
}

// The text colour on a shape's fill, as objects.jsx draws it (inkOn).
function inkOn (fill, theme, opacity = 1) {
  if (fill === 'none' || fill === 'background' || opacity < 0.5) return hexOf(theme.text)
  const m = /^#([0-9a-f]{2})([0-9a-f]{2})([0-9a-f]{2})$/i.exec(fill)
  if (!m) return hexOf(theme.background)
  const [r, g, b] = m.slice(1).map((x) => parseInt(x, 16))
  return 0.299 * r + 0.587 * g + 0.114 * b > 160 ? '000000' : 'FFFFFF'
}

const GENERIC = { 'sans-serif': 'Arial', serif: 'Times New Roman', monospace: 'Courier New', 'system-ui': 'Arial' }

// The first font of a CSS font list, as a font name PowerPoint can use.
export function fontName (css) {
  const first = String(css || '').split(',')[0].trim().replace(/^['"]|['"]$/g, '')
  return GENERIC[first] || first || 'Arial'
}

// A font size mark ('24pt', '18px', '24') in points.
function pointsOf (v) {
  const n = parseFloat(v)
  if (!Number.isFinite(n) || n <= 0) return null
  return /px$/.test(String(v)) ? n * 0.75 : n
}

// --- text -----------------------------------------------------------------------

// A Yjs text fragment as ProseMirror JSON in the slide schema, or null.
function fragmentJson (fragment) {
  if (!fragment || typeof fragment.toArray !== 'function' || fragment.length === 0) return null
  try { return yXmlFragmentToProseMirrorRootNode(fragment, slideSchema()).toJSON() } catch { return null }
}

const NUMBERING = { a: 'alphaLcPeriod', A: 'alphaUcPeriod', i: 'romanLcPeriod', I: 'romanUcPeriod' }

// The box's paragraphs as pptxgenjs text runs. `base` holds the box's own
// font, size, colour and alignment; each paragraph's last run ends the line.
export function textRuns (json, base, theme) {
  const paras = [] // [{ runs, align, size, lineHeight, list }]
  const walk = (nodes, ctx) => {
    for (const n of nodes || []) {
      if (n.type === 'paragraph' || n.type === 'heading') {
        paras.push({ node: n, ctx })
        ctx = { ...ctx, first: false }
      } else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
        const start = (n.attrs && Number(n.attrs.start)) || 1
        ;(n.content || []).forEach((item, i) => {
          const list = { kind: n.type, level: ctx.list ? ctx.list.level + 1 : 0, start, type: n.attrs && n.attrs.type, checked: !!(item.attrs && item.attrs.checked) }
          // Only an item's first paragraph has the bullet.
          let first = true
          for (const child of item.content || []) {
            if (child.type === 'paragraph') {
              paras.push({ node: child, ctx: { ...ctx, list, bullet: first, index: i } })
              first = false
            } else walk([child], { ...ctx, list })
          }
        })
      } else if (n.type === 'blockquote') walk(n.content, { ...ctx, quote: (ctx.quote || 0) + 1 })
    }
  }
  walk(json && json.content, {})

  const out = []
  paras.forEach(({ node, ctx }, pi) => {
    const a = node.attrs || {}
    const align = ['left', 'center', 'right', 'justify'].includes(a.textAlign) ? a.textAlign : base.align
    const runs = []
    const prefix = ctx.list && ctx.list.kind === 'taskList' && ctx.bullet ? (ctx.list.checked ? '☑ ' : '☐ ') : ''
    if (prefix) runs.push({ text: prefix, options: {} })
    let breakNext = false
    for (const t of node.content || []) {
      if (t.type === 'hardBreak') { breakNext = true; continue }
      if (t.type !== 'text') continue
      const o = {}
      let link = null
      for (const m of t.marks || []) {
        const ma = m.attrs || {}
        if (m.type === 'bold') o.bold = true
        else if (m.type === 'italic') o.italic = true
        else if (m.type === 'underline') o.underline = { style: 'sng' }
        else if (m.type === 'strike') o.strike = 'sngStrike'
        else if (m.type === 'subscript') o.subscript = true
        else if (m.type === 'superscript') o.superscript = true
        else if (m.type === 'code') o.fontFace = 'Courier New'
        else if (m.type === 'link' && /^(https?:|mailto:)/i.test(String(ma.href || ''))) link = String(ma.href)
        else if (m.type === 'highlight') { const h = hexOf(ma.color); if (h) o.highlight = h }
        else if (m.type === 'textStyle') {
          const c = hexOf(ma.color)
          if (c) o.color = c
          const s = pointsOf(ma.fontSize)
          if (s) o.fontSize = s
          if (ma.fontFamily) o.fontFace = fontName(ma.fontFamily)
        }
      }
      if (link) {
        o.hyperlink = { url: link }
        o.underline = { style: 'sng' }
        if (!o.color) o.color = hexOf(theme.accents[0])
      }
      if (breakNext) { o.softBreakBefore = true; breakNext = false }
      runs.push({ text: t.text, options: o })
    }
    if (breakNext) runs.push({ text: '', options: { softBreakBefore: true } })
    if (!runs.length) runs.push({ text: '', options: {} })

    const size = Math.max(...runs.map((r) => r.options.fontSize || base.fontSize))
    const lh = Number(a.lineHeight) || base.lineHeight
    const para = { align, lineSpacing: Math.round(size * lh * 10) / 10 }
    if (ctx.list) {
      const indent = Math.round(1.3 * base.fontSize * 10) / 10
      para.indentLevel = ctx.list.level
      para.paraSpaceAfter = Math.round(0.25 * size * 10) / 10
      if (ctx.list.kind === 'taskList') {
        para.indentLevel = 0
      } else if (!ctx.bullet) {
        para.bullet = { indent, characterCode: '200B' } // a later paragraph in an item: indented, no mark
      } else if (ctx.list.kind === 'orderedList') {
        para.bullet = { type: 'number', style: NUMBERING[ctx.list.type] || 'arabicPeriod', startAt: ctx.list.start + ctx.index, indent }
      } else {
        para.bullet = { indent }
      }
    }
    runs.forEach((r, i) => {
      Object.assign(r.options, para)
      if (i === runs.length - 1 && pi < paras.length - 1) r.options.breakLine = true
    })
    out.push(...runs)
  })
  return out
}

function isEmpty (json) {
  if (!json) return true
  let text = ''
  const walk = (n) => { if (n.text) text += n.text; (n.content || []).forEach(walk) }
  walk(json)
  return text.trim() === ''
}

// Speaker notes as plain text: one line per paragraph, list items marked.
export function notesText (fragment) {
  const lines = []
  const walk = (node, list, depth) => {
    for (const child of node.toArray ? node.toArray() : []) {
      const name = child.nodeName
      if (name === 'paragraph' || name === 'heading') {
        const text = slidesModel.plainOf(child)
        if (list) {
          const mark = list.kind === 'orderedList' ? (list.n++) + '. ' : '- '
          lines.push('  '.repeat(depth) + mark + text)
        } else lines.push(text)
      } else if (name === 'bulletList' || name === 'orderedList') {
        const l = { kind: name, n: Number(child.getAttribute && child.getAttribute('start')) || 1 }
        for (const item of child.toArray()) walk(item, l, list ? depth + 1 : 0)
      } else if (child.toArray) walk(child, list, depth)
    }
  }
  if (fragment && fragment.toArray) walk(fragment, null, 0)
  return lines.join('\n').replace(/\n{3,}/g, '\n\n').trim()
}

// --- the deck -------------------------------------------------------------------

// The pictures on the deck's slides (deleted ones left out): [{ ref, hash, mime }].
export function deckPictures (doc) {
  const out = []
  const seen = new Set()
  for (const s of slidesModel.slides(doc)) {
    for (const e of slidesModel.elements(doc, s.id)) {
      if (e.map.get('type') !== 'picture') continue
      const ref = String(e.map.get('ref') || '')
      if (!ref || seen.has(ref)) continue
      seen.add(ref)
      out.push({ ref, hash: String(e.map.get('hash') || ''), mime: String(e.map.get('mime') || '') })
    }
  }
  return out
}

function b64 (bytes) {
  if (typeof Buffer !== 'undefined') return Buffer.from(bytes).toString('base64')
  let bin = ''
  for (let i = 0; i < bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(bin)
}

const PICTURE_TYPES = ['image/png', 'image/jpeg', 'image/gif', 'image/bmp', 'image/svg+xml']

// The deck as .pptx bytes. `pictures`: ref -> { bytes, mime }, in a type
// PowerPoint reads (png, jpeg, gif); a picture missing from it is left out.
export async function deckToPptx (doc, { title = '', pictures = new Map() } = {}) {
  const [sw, sh] = slidesModel.size(doc)
  const theme = themeFor(slidesModel.theme(doc))
  const pptx = new PptxGenJS()
  pptx.defineLayout({ name: 'PEAROFFICE', width: inch(sw), height: inch(sh) })
  pptx.layout = 'PEAROFFICE'
  pptx.title = title
  pptx.company = 'PearOffice'
  pptx.theme = { headFontFace: fontName(theme.headingFont), bodyFontFace: fontName(theme.bodyFont) }
  const arrows = new Map() // object name -> its avLst
  const crops = new Map() // object name -> its srcRect
  const charts = new Map() // chart part name -> tidyChart's options

  for (const s of slidesModel.slides(doc)) {
    const slide = pptx.addSlide()
    slide.background = { color: hexOf(theme.background) }
    const titleSlide = s.map.get('layout') === 'title'
    for (const e of slidesModel.elements(doc, s.id)) {
      const type = e.map.get('type')
      const f = slidesModel.frame(e.map)
      const box = { x: inch(f.x), y: inch(f.y), w: inch(f.w), h: inch(f.h), rotate: f.rot || undefined, objectName: type + ' ' + e.id }
      if (type === 'chart') {
        const value = slidesModel.chartOf(e.map)
        const c = pptxChart(value, theme)
        slide.addChart(pptx.ChartType[c.type], c.data, { ...box, ...c.options })
        const made = slide._relsChart && slide._relsChart[slide._relsChart.length - 1]
        if (made) charts.set('ppt/charts/' + made.fileName, { stackedLine: c.type === 'line' && !!value.chart.stacked })
        continue
      }
      if (type === 'picture') {
        const p = pictures.get(String(e.map.get('ref') || ''))
        if (!p || !PICTURE_TYPES.includes(p.mime)) continue
        slide.addImage({ ...box, data: p.mime + ';base64,' + b64(p.bytes), altText: String(e.map.get('alt') || '').slice(0, 500) })
        const c = slidesModel.crop(e.map)
        if (c.l || c.t || c.r || c.b) crops.set(box.objectName, '<a:srcRect' + ['l', 't', 'r', 'b'].map((k) => c[k] ? ' ' + k + '="' + Math.round(c[k] * 100000) + '"' : '').join('') + '/>')
        continue
      }
      const role = type === 'text' && ROLES.includes(e.map.get('role')) ? e.map.get('role') : null
      const json = fragmentJson(e.map.get('text'))
      const st = type === 'shape' ? slidesModel.style(e.map) : null
      const tl = slidesModel.textLayout(e.map)
      const base = {
        fontFace: fontName(role === 'title' ? theme.headingFont : theme.bodyFont),
        fontSize: defaultSize(theme, role),
        color: st ? inkOn(st.fill, theme, st.fillOpacity) : hexOf(theme.text),
        align: st || (titleSlide && role) ? 'center' : 'left',
        lineHeight: role === 'title' ? 1.1 : 1.2
      }
      const textOpts = {
        fontFace: base.fontFace,
        fontSize: base.fontSize,
        color: base.color,
        align: base.align,
        valign: VALIGN[tl.anchor],
        margin: [PAD_X, PAD_X, PAD_Y, PAD_Y], // left, right, bottom, top
        wrap: tl.wrap
      }
      if (type === 'text') {
        if (isEmpty(json)) continue // an empty box draws nothing
        slide.addText(textRuns(json, base, theme), { ...box, ...textOpts, isTextBox: true })
        continue
      }
      // A shape. Its outline is drawn inside the frame (objects.jsx,
      // shapePath), so the shape is inset by half the outline's width.
      const lineHex = st.lineW > 0 ? slotHex(st.line, theme) : null
      const lw = lineHex ? st.lineW : 0
      const shape = { ...box, shape: PRESET[st.shape] }
      const END = { arrow: 'arrow', triangle: 'triangle', oval: 'oval' }
      if (st.shape === 'line') {
        Object.assign(shape, { y: inch(f.y + f.h / 2), h: 0, line: { color: lineHex || hexOf(theme.text), width: Math.max(0.25, lw / 2), transparency: transparency(st.lineOpacity), beginArrowType: END[st.head], endArrowType: END[st.tail] } })
        if (!lineHex) delete shape.line
        if (lineHex) slide.addShape(shape.shape, shape)
        continue
      }
      Object.assign(shape, { x: inch(f.x + lw / 2), y: inch(f.y + lw / 2), w: inch(Math.max(1, f.w - lw)), h: inch(Math.max(1, f.h - lw)) })
      const fill = slotHex(st.fill, theme)
      if (fill) shape.fill = { color: fill, transparency: transparency(st.fillOpacity) }
      if (lineHex) shape.line = { color: lineHex, width: lw / 2, transparency: transparency(st.lineOpacity) }
      const iw = Math.max(1, f.w - lw)
      const ih = Math.max(1, f.h - lw)
      if (st.shape === 'custom') {
        const points = customPoints(st.path, iw, ih)
        if (points) shape.points = points
        else shape.shape = 'rect'
      }
      // pptxgenjs writes the corner as adj, a fraction of the shorter side;
      // a square corner still needs a value or PowerPoint uses its own.
      if (st.shape === 'roundRect') shape.rectRadius = inch(Math.min(iw, ih) * st.radius) || 1e-7
      if (st.shape === 'arrow') {
        // objects.jsx: the shaft is the middle 40 percent, the head
        // min(half the width, 0.8 of the height) long.
        const head = Math.min(iw * 0.5, ih * 0.8)
        arrows.set(shape.objectName, '<a:gd name="adj1" fmla="val 40000"/><a:gd name="adj2" fmla="val ' + Math.round(head / Math.min(iw, ih) * 100000) + '"/>')
      }
      if (isEmpty(json)) slide.addShape(shape.shape, shape)
      else slide.addText(textRuns(json, base, theme), { ...shape, ...textOpts })
    }
    const notes = notesText(s.map.get('notes'))
    if (notes) slide.addNotes(notes)
  }

  const raw = await pptx.write({ outputType: 'uint8array', compression: true })
  const zip = await JSZip.loadAsync(raw)
  for (const name of Object.keys(zip.files)) {
    if (/^ppt\/charts\/chart\d+\.xml$/.test(name)) zip.file(name, tidyChart(await zip.file(name).async('string'), charts.get(name)))
    if (!/^ppt\/slides\/slide\d+\.xml$/.test(name)) continue
    zip.file(name, tidySlide(await zip.file(name).async('string'), arrows, crops))
  }
  return zip.generateAsync({ type: 'uint8array', compression: 'DEFLATE', mimeType: PPTX })
}

const PPR = /<a:pPr\b[^>]*?(?:\/>|>[\s\S]*?<\/a:pPr>)/g

// One paragraph property block per paragraph, first in it, each arrow's
// head and shaft and each picture's crop. Each numbered item carries its
// own number (textRuns), as LibreOffice starts counting again at every
// startAt; startAt="1" is the default and goes.
export function tidySlide (xml, arrows = new Map(), crops = new Map()) {
  xml = xml.replace(/(<a:buAutoNum type="[A-Za-z]+") startAt="1"/g, '$1')
  xml = xml.replace(/<a:p>([\s\S]*?)<\/a:p>/g, (all, inner) => {
    const blocks = inner.match(PPR)
    if (!blocks || blocks.length < 2) return all
    return '<a:p>' + blocks[0] + inner.replace(PPR, '') + '</a:p>'
  })
  for (const [name, gd] of arrows) {
    const at = xml.indexOf('name="' + name + '"')
    if (at < 0) continue
    const geom = '<a:prstGeom prst="rightArrow"><a:avLst>'
    const g = xml.indexOf(geom, at)
    if (g < 0) continue
    xml = xml.slice(0, g + geom.length) + gd + xml.slice(g + geom.length)
  }
  for (const [name, rect] of crops) {
    const at = xml.indexOf('name="' + name + '"')
    if (at < 0) continue
    const stretch = '<a:stretch><a:fillRect/></a:stretch>'
    const g = xml.indexOf(stretch, at)
    if (g < 0) continue
    xml = xml.slice(0, g) + rect + xml.slice(g)
  }
  return xml
}
