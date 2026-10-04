// A chart's settings and data (proposals/2026-10-04-charts.md) as ECharts
// options. The look follows the app: its palette, ink and line colours, light
// or dark.

import { SSF } from 'xlsx/dist/xlsx.mini.min.js'

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
  const fmt = formatter(chart.yFormat)
  const legend = chart.legend || (data.series.length > 1 || type === 'pie' || type === 'doughnut' ? 'bottom' : 'none')
  const text = { color: theme.ink, fontFamily: "'Manrope', system-ui, sans-serif" }
  const option = {
    animation: false,
    backgroundColor: 'transparent',
    color: PALETTE,
    textStyle: text,
    title: chart.title ? { text: chart.title, left: 'center', top: 6, textStyle: { ...text, fontSize: 14, fontWeight: 500 } } : undefined,
    tooltip: { trigger: type === 'pie' || type === 'doughnut' || type === 'scatter' ? 'item' : 'axis', valueFormatter: fmt },
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

  if (type === 'scatter') {
    option.xAxis = { type: 'value', scale: true, axisLabel: { color: theme.muted }, axisLine, splitLine, ...axisName(chart.xTitle) }
    option.yAxis = valueAxis({ scale: true })
    option.series = data.series.map((s) => ({ type: 'scatter', name: s.name, data: data.categories.map((x, i) => [x, s.values[i]]).filter((p) => p[0] !== null && p[1] !== null), label }))
  } else {
    let values = data.series.map((s) => s.values)
    if (chart.percent) {
      const totals = data.categories.map((_, i) => values.reduce((a, v) => a + (v[i] || 0), 0))
      values = values.map((v) => v.map((x, i) => (x === null || !totals[i] ? null : (x / totals[i]) * 100)))
    }
    const lines = new Set(chart.lineSeries || [])
    const second = new Set(chart.secondAxis || [])
    const categoryAxis = { type: 'category', data: data.categories.map(String), axisLabel: { color: theme.muted }, axisLine, ...axisName(chart.xTitle) }
    const horizontal = type === 'bar'
    option.xAxis = horizontal ? valueAxis() : categoryAxis
    option.yAxis = horizontal ? { ...categoryAxis, inverse: true } : (type === 'combo' && second.size ? [valueAxis(), valueAxis({ name: undefined, splitLine: { show: false } })] : valueAxis())
    option.series = data.series.map((s, i) => {
      const asLine = type === 'line' || type === 'area' || (type === 'combo' && lines.has(i))
      return {
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
        label: label && { ...label, position: horizontal ? 'right' : chart.stacked || chart.percent ? 'inside' : 'top' }
      }
    })
  }

  // Straight-line trends, dashed, with R² in the legend.
  for (const i of chart.trendline || []) {
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
