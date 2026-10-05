// Drawing a chart with ECharts (proposals/2026-10-04-charts.md): only the
// chart types and parts PearSheet uses, drawn as SVG.

import React, { useEffect, useRef } from 'react'
import * as echarts from 'echarts/core'
import { BarChart, LineChart, PieChart, ScatterChart, RadarChart, CandlestickChart } from 'echarts/charts'
import { TitleComponent, TooltipComponent, LegendComponent, GridComponent, RadarComponent } from 'echarts/components'
import { SVGRenderer } from 'echarts/renderers'
import { chartOption, themeColors } from './chartOption.js'
import { call } from './bridge.js'
import { isMobile } from './xlsx.js'

echarts.use([BarChart, LineChart, PieChart, ScatterChart, RadarChart, CandlestickChart, TitleComponent, TooltipComponent, LegendComponent, GridComponent, RadarComponent, SVGRenderer])

// A chart in a box of the given size. With no data, the reason instead.
export function ChartView ({ chart, width, height }) {
  const el = useRef(null)
  const inst = useRef(null)
  const ok = chart.resolved && !chart.resolved.error
  useEffect(() => {
    if (!ok || !el.current) return
    if (!inst.current) inst.current = echarts.init(el.current, null, { renderer: 'svg', width, height })
    inst.current.setOption(chartOption(chart, chart.resolved), true)
  })
  useEffect(() => { if (inst.current) inst.current.resize({ width, height }) }, [width, height])
  useEffect(() => () => { if (inst.current) { inst.current.dispose(); inst.current = null } }, [ok])
  if (!ok) return <div className='chart-empty' style={{ width, height }}>{(chart.resolved && chart.resolved.error) || 'Loading chart...'}</div>
  return <div ref={el} className='chart-view' style={{ width, height }} />
}

// The chart as SVG text, drawn off screen.
export function chartSvg (chart, width = chart.size.w, height = chart.size.h, theme = themeColors()) {
  if (!chart.resolved || chart.resolved.error) return null
  const inst = echarts.init(null, null, { renderer: 'svg', ssr: true, width, height })
  inst.setOption(chartOption(chart, chart.resolved, theme))
  const svg = inst.renderToSVGString()
  inst.dispose()
  return svg
}

// The chart as a PNG (base64), at twice its size for sharp text.
export function chartPng (chart, width = chart.size.w, height = chart.size.h) {
  const svg = chartSvg(chart, width, height)
  return new Promise((resolve, reject) => {
    const img = new window.Image()
    img.onload = () => {
      const canvas = document.createElement('canvas')
      canvas.width = width * 2
      canvas.height = height * 2
      const g = canvas.getContext('2d')
      g.fillStyle = themeColors().panel
      g.fillRect(0, 0, canvas.width, canvas.height)
      g.drawImage(img, 0, 0, canvas.width, canvas.height)
      resolve(canvas.toDataURL('image/png').split(',')[1])
    }
    img.onerror = () => reject(new Error('Could not draw the chart'))
    img.src = 'data:image/svg+xml;base64,' + window.btoa(unescape(encodeURIComponent(svg)))
  })
}

const fileName = (chart) => String(chart.title || 'Chart').replace(/[\\/:*?"<>|]/g, ' ')

export async function downloadChart (chart, kind) {
  const name = fileName(chart) + '.' + kind
  const mime = kind === 'png' ? 'image/png' : 'image/svg+xml'
  const base64 = kind === 'png' ? await chartPng(chart) : window.btoa(unescape(encodeURIComponent(chartSvg(chart))))
  if (isMobile()) return call('app:shareFile', { name, mime, base64 })
  const a = document.createElement('a')
  a.href = 'data:' + mime + ';base64,' + base64
  a.download = name
  document.body.appendChild(a)
  a.click()
  a.remove()
}
