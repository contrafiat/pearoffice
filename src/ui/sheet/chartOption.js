// A chart's settings and data (proposals/2026-10-04-charts.md) as ECharts
// options. The look follows the app: its palette, ink and line colours, light
// or dark.

import { SSF } from 'xlsx/dist/xlsx.mini.min.js'
import { histogram, waterfall } from '../../sheet/charts.js'

export const UP = '#3c9a5f'
export const DOWN = '#c0392b'
export const PALETTE = ['#5b8c3a', '#2f7d8c', '#d9822b', '#6a4c93', '#a23e48', '#3a5f8c', '#8c7a2f', '#c45a8a']

// The app's colours, read from its CSS variables.
export function themeColors () {
  const css = typeof window !== 'undefined' ? window.getComputedStyle(document.documentElement) : null
  const v = (name, dflt) => (css && css.getPropertyValue(name).trim()) || dflt
  return { ink: v('--ink', '#1f2420'), muted: v('--muted', '#6b716b'), line: v('--line', '#e2e3dd'), lineStrong: v('--line-strong', '#c9cbc2'), panel: v('--panel', '#ffffff') }
}

function formatter (code) {
  if (!code) return (v) => (typeof v === 'number' ? String(Number(v.toPrecision(10))) : v)
  return (v) => { try { return SSF.format(code, v) } catch { return String(v) } }
}

// Least-squares line through (x, y) pairs: { at(x), r2 }.
function trend (points) {
  const ps = points.filter((p) => p[0] !== null && p[1] !== null)
  const n = ps.length
  if (n < 2) return null
  const mx = ps.reduce((a, p) => a + p[0], 0) / n
  const my = ps.reduce((a, p) => a + p[1], 0) / n
  let sxy = 0
  let sxx = 0
  let syy = 0
  for (const [x, y] of ps) { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx); syy += (y - my) * (y - my) }
  if (!sxx) return null
  const b = sxy / sxx
  const a = my - b * mx
  return { at: (x) => a + b * x, r2: syy ? (sxy * sxy) / (sxx * syy) : 1 }
}

export function chartOption (chart, data, theme = themeColors()) {
  const type = chart.type || 'column'
  // The format picked for the chart, else the cells' own (the first series'
  // for the main axis). A histogram's values are counts, so it keeps none.
  const cellFmt = type === 'histogram' ? null : (data.series[0] || {}).format
  const fmt = formatter(chart.yFormat || cellFmt)
  const tipFmt = chart.percent ? (v) => (typeof v === 'number' ? Number(v.toFixed(1)) + '%' : v) : fmt
  const legend = chart.legend || (data.series.length > 1 || type === 'pie' || type === 'doughnut' ? 'bottom' : 'none')
  const text = { color: theme.ink, fontFamily: "'Manrope', system-ui, sans-serif" }
  const option = {
    animation: false,
    backgroundColor: 'transparent',
    color: PALETTE,
    textStyle: text,
    title: chart.title ? { text: chart.title, left: 'center', top: 6, textStyle: { ...text, fontSize: 14, fontWeight: 500 } } : undefined,
    tooltip: { trigger: type === 'pie' || type === 'doughnut' || type === 'scatter' ? 'item' : 'axis', valueFormatter: tipFmt },
    legend: legend === 'none' ? { show: false } : legend === 'right'
      ? { type: 'scroll', orient: 'vertical', right: 8, top: 'middle', textStyle: text }
      : { type: 'scroll', bottom: 4, textStyle: text },
    grid: { left: 12, right: legend === 'right' ? 130 : 16, top: chart.title ? 40 : 16, bottom: legend === 'bottom' ? 36 : 12, containLabel: true }
  }
  const label = chart.dataLabels ? { show: true, formatter: (p) => fmt(Array.isArray(p.value) ? p.value[1] : p.value), color: theme.ink } : undefined

  if (type === 'pie' || type === 'doughnut') {
    const s = data.series[0] || { name: '', values: [] }
    option.series = [{
      type: 'pie',
      name: s.name,
      radius: type === 'doughnut' ? ['45%', '70%'] : '70%',
      center: ['50%', chart.title ? '55%' : '50%'],
      data: data.categories.map((name, i) => ({ name: String(name), value: s.values[i] })).filter((d) => d.value !== null && d.value > 0),
      label: chart.dataLabels ? { show: true, formatter: (p) => p.name + ': ' + fmt(p.value) + ' (' + p.percent + '%)', color: theme.ink } : { color: theme.ink },
      itemStyle: { borderColor: theme.panel, borderWidth: 1 }
    }]
    return option
  }

  // Radar (proposals/2026-10-05-more-chart-types.md): a spoke per category,
  // a closed shape per series.
  if (type === 'radar') {
    const top = Math.max(0, ...data.series.flatMap((s) => s.values.filter((v) => v !== null)))
    option.radar = {
      indicator: data.categories.map((name) => ({ name: String(name), max: top ? top * 1.1 : 1 })),
      center: ['50%', chart.title ? '56%' : '52%'],
      radius: '62%',
      axisName: { color: theme.muted },
      axisLine: { lineStyle: { color: theme.line } },
      splitLine: { lineStyle: { color: theme.line } },
      splitArea: { show: false }
    }
    option.tooltip = { trigger: 'item' }
    option.series = [{ type: 'radar', data: data.series.map((s) => ({ name: s.name, value: s.values.map((v) => (v === null ? 0 : v)), areaStyle: { opacity: 0.15 } })), label }]
    return option
  }

  const axisLine = { lineStyle: { color: theme.lineStrong } }
  const splitLine = { lineStyle: { color: theme.line } }
  const axisName = (name) => (name ? { name, nameLocation: 'middle', nameGap: 32, nameTextStyle: text } : {})
  const valueAxis = (extra = {}) => ({
    type: chart.logScale ? 'log' : 'value',
    min: chart.percent ? 0 : chart.yMin ?? undefined,
    max: chart.percent ? 100 : chart.yMax ?? undefined,
    axisLabel: { color: theme.muted, formatter: chart.percent ? (v) => v + '%' : fmt },
    axisLine,
    splitLine,
    ...axisName(chart.yTitle),
    ...extra
  })

  const categoryAxis = (labels) => ({ type: 'category', data: labels.map(String), axisLabel: { color: theme.muted }, axisLine, ...axisName(chart.xTitle) })
  if (type === 'scatter') {
    option.xAxis = { type: 'value', scale: true, axisLabel: { color: theme.muted, formatter: formatter(data.xFormat) }, axisLine, splitLine, ...axisName(chart.xTitle) }
    option.yAxis = valueAxis({ scale: true })
    option.series = data.series.map((s) => ({ type: 'scatter', name: s.name, data: data.categories.map((x, i) => [x, s.values[i]]).filter((p) => p[0] !== null && p[1] !== null), label }))
  } else if (type === 'bubble') {
    // X in the first column, then Y and size for each series. Circle area
    // follows the size; the largest is 48 pixels across.
    // Room around the edges, so the outer bubbles are not cut off.
    option.xAxis = { type: 'value', scale: true, boundaryGap: ['12%', '12%'], axisLabel: { color: theme.muted, formatter: formatter(data.xFormat) }, axisLine, splitLine, ...axisName(chart.xTitle) }
    option.yAxis = valueAxis({ scale: true, boundaryGap: ['15%', '15%'] })
    option.tooltip = { trigger: 'item' }
    const pairs = []
    for (let i = 0; i + 1 < data.series.length; i += 2) pairs.push([data.series[i], data.series[i + 1]])
    const biggest = Math.max(0, ...pairs.flatMap(([, z]) => z.values.filter((v) => v !== null).map(Math.abs)))
    option.series = pairs.map(([y, z]) => ({
      type: 'scatter',
      name: y.name,
      data: data.categories.map((x, k) => [x, y.values[k], z.values[k]]).filter((p) => p[0] !== null && p[1] !== null && p[2] !== null),
      symbolSize: (p) => (biggest ? 6 + 42 * Math.sqrt(Math.abs(p[2]) / biggest) : 10),
      itemStyle: { opacity: 0.75 },
      label: label && { ...label, formatter: (p) => fmt(p.value[1]) }
    }))
  } else if (type === 'stock') {
    // Open, high, low, close: green when it closed higher than it opened.
    const [o, h, l, c] = data.series
    option.xAxis = categoryAxis(data.categories)
    option.yAxis = valueAxis({ scale: true })
    option.legend = { show: false }
    option.series = o && h && l && c
      ? [{ type: 'candlestick', name: chart.title || 'Price', data: data.categories.map((_, k) => [o.values[k], c.values[k], l.values[k], h.values[k]]), itemStyle: { color: UP, color0: DOWN, borderColor: UP, borderColor0: DOWN } }]
      : []
  } else if (type === 'histogram') {
    let bins = histogram(data.series.flatMap((s) => s.values), chart.binWidth)
    // Bin edges in the cells' format, when they have one.
    const edge = (data.series[0] || {}).format && formatter(data.series[0].format)
    if (edge) bins = bins.map((b, k) => ({ ...b, label: (k ? '(' : '[') + edge(b.from) + ', ' + edge(b.to) + ']' }))
    option.xAxis = { ...categoryAxis(bins.map((b) => b.label)), axisLabel: { color: theme.muted, interval: 0, hideOverlap: true } }
    option.yAxis = valueAxis({ minInterval: 1 })
    option.legend = { show: false }
    option.series = [{ type: 'bar', name: 'Count', data: bins.map((b) => b.count), barCategoryGap: '2%', label: chart.dataLabels ? { show: true, position: 'top', color: theme.ink } : undefined }]
  } else if (type === 'waterfall') {
    // An invisible bar lifts each visible one to where the last ended.
    const s = data.series[0] || { values: [] }
    const bars = waterfall(s.values, chart.totals || [])
    option.xAxis = categoryAxis(data.categories)
    option.yAxis = valueAxis()
    option.legend = { show: false }
    option.tooltip = { trigger: 'axis', formatter: (ps) => { const p = ps.find((x) => x.seriesIndex === 1); if (!p) return ''; const b = bars[p.dataIndex]; return p.name + ': ' + fmt(b.kind === 'total' ? b.end : b.end - b.start) } }
    option.series = [
      { type: 'bar', stack: 'w', silent: true, itemStyle: { color: 'transparent' }, data: bars.map((b) => Math.min(b.start, b.end)) },
      {
        type: 'bar',
        stack: 'w',
        name: s.name,
        data: bars.map((b) => ({ value: Math.abs(b.end - b.start), itemStyle: { color: b.kind === 'total' ? PALETTE[1] : b.kind === 'down' ? DOWN : UP } })),
        label: chart.dataLabels ? { show: true, position: 'top', color: theme.ink, formatter: (p) => { const b = bars[p.dataIndex]; return fmt(b.kind === 'total' ? b.end : b.end - b.start) } } : undefined
      }
    ]
  } else {
    let values = data.series.map((s) => s.values)
    if (chart.percent) {
      const totals = data.categories.map((_, i) => values.reduce((a, v) => a + (v[i] || 0), 0))
      values = values.map((v) => v.map((x, i) => (x === null || !totals[i] ? null : (x / totals[i]) * 100)))
    }
    const lines = new Set(chart.lineSeries || [])
    const second = new Set(chart.secondAxis || [])
    const catAxis = categoryAxis(data.categories)
    const horizontal = type === 'bar'
    // The second axis takes the format of the first series on it.
    const secondFmt = formatter(chart.yFormat || (data.series.find((_, i) => second.has(i)) || {}).format)
    const secondAxis = valueAxis({ name: undefined, splitLine: { show: false } })
    if (!chart.percent) secondAxis.axisLabel = { ...secondAxis.axisLabel, formatter: secondFmt }
    option.xAxis = horizontal ? valueAxis() : catAxis
    option.yAxis = horizontal ? { ...catAxis, inverse: true } : (type === 'combo' && second.size ? [valueAxis(), secondAxis] : valueAxis())
    option.series = data.series.map((s, i) => {
      const asLine = type === 'line' || type === 'area' || (type === 'combo' && lines.has(i))
      // Each series shows its own cells' format in the tooltip and labels.
      const own = chart.percent ? tipFmt : formatter(chart.yFormat || s.format || cellFmt)
      return {
        tooltip: { valueFormatter: own },
        type: asLine ? 'line' : 'bar',
        // One series: each category its own colour, as pie slices are.
        colorBy: !asLine && data.series.length === 1 && type !== 'combo' ? 'data' : 'series',
        name: s.name,
        data: values[i],
        stack: chart.stacked || chart.percent ? 'total' : undefined,
        areaStyle: type === 'area' ? { opacity: chart.stacked || chart.percent ? 0.85 : 0.35 } : undefined,
        yAxisIndex: type === 'combo' && second.has(i) ? 1 : 0,
        connectNulls: asLine,
        symbolSize: 5,
        label: label && { ...label, formatter: (p) => own(p.value), position: horizontal ? 'right' : chart.stacked || chart.percent ? 'inside' : 'top' }
      }
    })
  }

  // Straight-line trends, dashed, with R² in the legend.
  for (const i of ['column', 'bar', 'line', 'area', 'scatter', 'combo'].includes(type) ? chart.trendline || [] : []) {
    const s = data.series[i]
    if (!s) continue
    const xs = type === 'scatter' ? data.categories : data.categories.map((_, k) => k)
    const t = trend(xs.map((x, k) => [x, s.values[k]]))
    if (!t) continue
    const name = 'Trend: ' + s.name + ' (R² ' + t.r2.toFixed(3) + ')'
    option.series.push(type === 'scatter'
      ? { type: 'line', name, data: [Math.min(...xs.filter((x) => x !== null)), Math.max(...xs.filter((x) => x !== null))].map((x) => [x, t.at(x)]), symbol: 'none', lineStyle: { type: 'dashed', width: 1.5 }, color: PALETTE[i % PALETTE.length] }
      : { type: 'line', name, data: xs.map((x) => t.at(x)), symbol: 'none', lineStyle: { type: 'dashed', width: 1.5 }, color: PALETTE[i % PALETTE.length] })
  }
  return option
}
