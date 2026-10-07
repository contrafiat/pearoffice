// A chart in a .pptx (ppt/charts/chartN.xml) as a PearOffice chart element
// (proposals/2026-10-06-slides-followups.md, "Charts"): its type, title,
// legend, values on the chart and stacking; each series' name, colour
// and the values PowerPoint keeps with the chart (its cache; the workbook
// embedded next to it is not read).
//
// Bar, column, line, area, pie, doughnut, scatter and radar charts are read,
// their 3-D forms as the flat ones. A chart that combines types keeps its
// first; the others are counted. Other kinds (bubble, stock, surface and
// the newer chartex kinds) are not read. The text colour is the one most
// of the chart's text uses (its own and its title's, legend's, axes' and
// labels' text properties); smooth comes from any line series with
// c:smooth on.

import { kid, kids, dig, attr, fillOf } from './importOoxml.js'

const MAX_SERIES = 10
const MAX_POINTS = 1000

// Plot elements and what they become. Bar charts pick column or bar from
// barDir.
const PLOTS = {
  barChart: 'column',
  bar3DChart: 'column',
  lineChart: 'line',
  line3DChart: 'line',
  areaChart: 'area',
  area3DChart: 'area',
  pieChart: 'pie',
  pie3DChart: 'pie',
  ofPieChart: 'pie',
  doughnutChart: 'doughnut',
  scatterChart: 'scatter',
  radarChart: 'radar'
}
// Plot elements PearOffice has no drawing for.
const OTHER_PLOTS = ['bubbleChart', 'stockChart', 'surfaceChart', 'surface3DChart']

const val = (el) => attr(el, 'val')
const on = (el) => !!el && val(el) !== '0' && val(el) !== 'false'

// The text of every a:t (or c:v) below an element, paragraphs joined by a
// space.
function textOf (el) {
  if (!el) return ''
  const paras = [...el.getElementsByTagName('*')].filter((e) => e.localName === 'p')
  if (!paras.length) return [...el.getElementsByTagName('*')].filter((e) => e.localName === 't').map((t) => t.textContent).join('')
  return paras.map((p) => [...p.getElementsByTagName('*')].filter((e) => e.localName === 't').map((t) => t.textContent).join('')).filter(Boolean).join(' ')
}

// The points of a cache or literal (strCache, numCache, strLit, numLit),
// by their idx, as text. Holes are null.
function points (cache) {
  if (!cache) return []
  const count = Math.min(MAX_POINTS, Math.max(0, Number(val(kid(cache, 'ptCount'))) || 0))
  const out = new Array(count).fill(null)
  for (const pt of kids(cache, 'pt')) {
    const i = Number(attr(pt, 'idx'))
    if (!Number.isInteger(i) || i < 0 || i >= MAX_POINTS) continue
    while (out.length <= i) out.push(null)
    const v = kid(pt, 'v')
    out[i] = v ? v.textContent : null
  }
  return out
}

// A data source (c:tx, c:cat, c:val, c:xVal, c:yVal) as text points.
function source (el) {
  if (!el) return []
  for (const c of el.children) {
    switch (c.localName) {
      case 'strRef': return points(kid(c, 'strCache'))
      case 'numRef': return points(kid(c, 'numCache'))
      case 'strLit':
      case 'numLit': return points(c)
      case 'multiLvlStrRef': {
        // Labels on several levels: the innermost.
        const lvl = kid(kid(c, 'multiLvlStrCache'), 'lvl')
        if (!lvl) return []
        const cache = kid(c, 'multiLvlStrCache')
        const fake = { children: [kid(cache, 'ptCount'), ...kids(lvl, 'pt')].filter(Boolean) }
        return points(fake)
      }
      case 'v': return [c.textContent]
    }
  }
  return []
}

const number = (t) => {
  if (t === null || t === undefined || String(t).trim() === '') return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

// A shape property block's colour: its fill, else its line's (lines,
// scatter and radar the other way round).
function colourOfSp (sp, ctx, lineFirst) {
  if (!sp) return null
  const fill = fillOf(sp, ctx)
  const line = fillOf(kid(sp, 'ln'), ctx)
  const pick = (f) => (f && f.colour && f.colour !== 'none' ? f.colour : null)
  return lineFirst ? pick(line) || pick(fill) : pick(fill) || pick(line)
}

// A series' colour. When every one of its points has the same colour of
// its own (c:dPt), that one, as it is what shows.
function seriesColour (ser, ctx, lineFirst, count) {
  const dpts = kids(ser, 'dPt').map((d) => colourOfSp(kid(d, 'spPr'), ctx, lineFirst))
  if (count && dpts.length >= count && dpts.every((c) => c && c === dpts[0])) return dpts[0]
  return colourOfSp(kid(ser, 'spPr'), ctx, lineFirst)
}

// Does the text under el show? Not when it is in data labels that show
// nothing or in a deleted axis.
function shown (el) {
  for (let p = el.parentNode; p && p.localName !== 'chartSpace'; p = p.parentNode) {
    if (p.localName === 'dLbls' || p.localName === 'dLbl') return ['showVal', 'showPercent', 'showCatName', 'showSerName'].some((k) => on(kid(p, k)))
    if (/^(cat|val|date|ser)Ax$/.test(p.localName)) return !on(kid(p, 'delete'))
  }
  return true
}

// The colour most of a chart's text is set in: every text run property
// (a:defRPr, a:rPr) with a solid fill, under the chart's text properties
// (c:txPr) and its title's text, where that text shows. Null when none
// sets one.
function textColour (root, ctx) {
  const counts = new Map()
  const holders = [...root.getElementsByTagName('*')].filter((e) => e.localName === 'txPr' || (e.localName === 'rich' && e.parentNode && e.parentNode.localName === 'tx'))
  for (const h of holders) {
    if (!shown(h)) continue
    for (const r of h.getElementsByTagName('*')) {
      if (r.localName !== 'defRPr' && r.localName !== 'rPr') continue
      const f = fillOf(r, ctx)
      if (!f || !f.colour || f.colour === 'none') continue
      counts.set(f.colour, (counts.get(f.colour) || 0) + 1)
    }
  }
  let best = null
  for (const [c, n] of counts) if (!best || n > counts.get(best)) best = c
  return best
}

// The chart part's root (c:chartSpace) as { chart, data, extra }, where
// extra counts the plot types left out of a combined chart; null when the
// chart has nothing PearOffice can draw. ctx is the slide's colour context
// (importOoxml.js, colourOf).
export function readChart (root, ctx) {
  const chartEl = kid(root, 'chart')
  const plotArea = kid(chartEl, 'plotArea')
  if (!plotArea) return null
  const plots = [...plotArea.children].filter((c) => PLOTS[c.localName] || OTHER_PLOTS.includes(c.localName))
  const plot = plots[0]
  if (!plot || !PLOTS[plot.localName]) return null
  let type = PLOTS[plot.localName]
  if (type === 'column' && val(kid(plot, 'barDir')) === 'bar') type = 'bar'
  const grouping = val(kid(plot, 'grouping'))
  const scatter = type === 'scatter'
  const lineFirst = ['line', 'scatter', 'radar'].includes(type)

  const sers = kids(plot, 'ser').slice(0, MAX_SERIES)
  let categories = []
  const series = sers.map((ser, i) => {
    const name = textOf(kid(ser, 'tx')) || source(kid(ser, 'tx')).filter(Boolean).join(' ') || 'Series ' + (i + 1)
    const xs = source(kid(ser, scatter ? 'xVal' : 'cat'))
    const ys = source(kid(ser, scatter ? 'yVal' : 'val')).map(number)
    if (xs.length > categories.length) categories = xs
    const out = { name: name.slice(0, 200), values: ys }
    const colour = type === 'pie' || type === 'doughnut' ? null : seriesColour(ser, ctx, lineFirst, ys.length)
    if (colour) out.color = colour
    return out
  })
  if (!series.length) return null
  // Every series as long as the longest, holes as null.
  const length = Math.min(MAX_POINTS, Math.max(categories.length, ...series.map((s) => s.values.length)))
  categories = Array.from({ length }, (_, i) => {
    const c = categories[i]
    return scatter ? number(c) : c === null || c === undefined ? String(i + 1) : String(c).slice(0, 200)
  })
  for (const s of series) s.values = Array.from({ length }, (_, i) => (s.values[i] === undefined ? null : s.values[i]))

  const chart = { type }
  // The title: its own text, or PowerPoint's automatic one (the series
  // name of a chart with one series) unless that was deleted.
  const titleEl = kid(chartEl, 'title')
  const deleted = on(kid(chartEl, 'autoTitleDeleted'))
  const own = titleEl ? textOf(dig(titleEl, 'tx', 'rich')) || textOf(kid(titleEl, 'tx')) : ''
  if (own) chart.title = own.slice(0, 200)
  else if (!deleted && series.length === 1) chart.title = series[0].name
  const legend = kid(chartEl, 'legend')
  chart.legend = !legend ? 'none' : val(kid(legend, 'legendPos')) === 'r' ? 'right' : 'bottom'
  const labels = [kid(plot, 'dLbls'), ...sers.map((s) => kid(s, 'dLbls'))].filter(Boolean)
  if (labels.some((d) => on(kid(d, 'showVal')) || ((type === 'pie' || type === 'doughnut') && on(kid(d, 'showPercent'))))) chart.dataLabels = true
  if (['column', 'bar', 'line', 'area'].includes(type) && (grouping === 'stacked' || grouping === 'percentStacked')) chart.stacked = true
  if (type === 'line' && sers.some((s) => on(kid(s, 'smooth')))) chart.smooth = true
  const ink = textColour(root, ctx)
  if (ink) chart.textColor = ink
  return { chart, data: { categories, series }, extra: plots.length - 1 }
}
