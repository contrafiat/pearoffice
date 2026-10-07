import React from 'react'
import { chartOption } from '../sheet/chartOption.js'
import { optionSvg } from '../sheet/Chart.jsx'
import { chartData } from './pptxExport.js'

// Charts on slides (proposals/2026-10-06-slides-followups.md, "Charts"):
// drawn with the sheet's chart code (chartOption.js, ECharts as SVG) from
// the settings and data kept in the element (slidesModel.chartOf). Series
// take their own colour, else the slide theme's accents in order; text is in
// the chart's text colour (else the theme's) and body font, on no
// background. Horizontal bars run from the bottom up as in PowerPoint, and
// a small pie keeps its labels off the legend (compactPie).
//
// A chart is drawn once as SVG text and kept, so the stage, the slide list,
// the show and the PDF reuse the same drawing until the data, the theme or
// the frame's size changes.
//
// ECharts lays out in pixels with 12 pixel labels. A chart is laid out at
// half its frame's size in slide units and drawn at full size, so its labels
// are about 12 points on the slide, as in PowerPoint.

const SCALE = 2
const KEEP = 300 // drawings kept

const cache = new Map()

function mix (a, b, t) {
  const rgb = (h) => [1, 3, 5].map((i) => parseInt(h.slice(i, i + 2), 16))
  const x = rgb(a)
  const y = rgb(b)
  return '#' + x.map((v, i) => Math.round(v + (y[i] - v) * t).toString(16).padStart(2, '0')).join('')
}

// A stored colour (a theme slot or #rrggbb) as the theme shows it.
function slotColour (theme, c) {
  if (c === 'text') return theme.text
  if (c === 'background') return theme.background
  const m = /^accent([1-6])$/.exec(c || '')
  if (m) return theme.accents[Number(m[1]) - 1]
  return /^#[0-9a-fA-F]{6}$/.test(c || '') ? c : null
}

// A slide theme (themes.js) as the colours chartOption takes. A chart's
// own text colour is used for every label, the axes' included.
export function chartTheme (theme, textColor) {
  const own = textColor ? slotColour(theme, textColor) : null
  return {
    ink: own || theme.text,
    muted: own || mix(theme.text, theme.background, 0.3),
    line: mix(theme.text, theme.background, 0.85),
    lineStrong: mix(theme.text, theme.background, 0.6),
    panel: theme.background,
    palette: theme.accents,
    font: theme.bodyFont
  }
}

// Should a pie or doughnut keep its values inside the slices? Always when it
// has a legend, which names the slices (labels outside reached the legend
// and were cut off at the chart's edge); without one, when it is too small
// (in slide units) or has too many slices for labels outside.
const PIE_MIN_W = 640
const PIE_MIN_H = 420
const PIE_MAX_SLICES = 8
export function compactPie (value, w, h) {
  const t = value.chart.type
  if (t !== 'pie' && t !== 'doughnut') return false
  if (value.chart.legend !== 'none') return true
  const slices = ((value.data.series[0] || {}).values || []).filter((v) => typeof v === 'number' && v > 0).length
  return w < PIE_MIN_W || h < PIE_MIN_H || slices > PIE_MAX_SLICES
}

// The chart as SVG text that fills its frame. `value` is { chart, data }.
export function slideChartSvg (value, theme, w, h) {
  const width = Math.max(20, Math.round(w / SCALE))
  const height = Math.max(20, Math.round(h / SCALE))
  const key = JSON.stringify([value.chart, value.data, theme.id, width, height])
  if (cache.has(key)) {
    const svg = cache.get(key)
    cache.delete(key)
    cache.set(key, svg) // most recently used last
    return svg
  }
  let svg = ''
  try {
    const opts = { barsBottomUp: true, compactPie: compactPie(value, width * SCALE, height * SCALE) }
    svg = optionSvg(chartOption(value.chart, chartData(value), chartTheme(theme, value.chart.textColor), opts), width, height)
      .replace(/<style[\s\S]*?<\/style>/g, '') // hover styles
      .replace(/^<svg width="[^"]*" height="[^"]*"/, '<svg width="100%" height="100%"')
  } catch {
    svg = ''
  }
  cache.set(key, svg)
  if (cache.size > KEEP) cache.delete(cache.keys().next().value)
  return svg
}

// A chart element drawn to fill its frame.
export function SlideChart ({ value, theme, w, h }) {
  const svg = slideChartSvg(value, theme, w, h)
  const title = value.chart.title
  return <div className='slide-chart' data-chart-type={value.chart.type} role='img' aria-label={'Chart' + (title ? ': ' + title : '')} dangerouslySetInnerHTML={{ __html: svg }} />
}

// What Insert chart adds: a column chart with three categories and two
// series.
export function sampleChart () {
  return {
    chart: { type: 'column' },
    data: {
      categories: ['First', 'Second', 'Third'],
      series: [
        { name: 'Series 1', values: [4, 7, 5] },
        { name: 'Series 2', values: [3, 5, 8] }
      ]
    }
  }
}
