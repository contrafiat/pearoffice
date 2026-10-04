// Editing a chart (proposals/2026-10-04-charts.md). Every change is saved at
// once, so the chart redraws behind the panel as you go.

import React, { useState } from 'react'
import { X, ChartBar, ChartBarHorizontal, ChartLine, ChartLineUp, ChartPie, ChartDonut, ChartScatter, ChartPolar } from '@phosphor-icons/react'

const TYPES = [
  ['column', 'Column', ChartBar],
  ['bar', 'Bar', ChartBarHorizontal],
  ['line', 'Line', ChartLine],
  ['area', 'Area', ChartLineUp],
  ['pie', 'Pie', ChartPie],
  ['doughnut', 'Doughnut', ChartDonut],
  ['scatter', 'Scatter', ChartScatter],
  ['combo', 'Column and line', ChartPolar]
]
const FORMATS = [['', 'Automatic'], ['#,##0', '1,234'], ['#,##0.00', '1,234.50'], ['$#,##0', '$1,234'], ['0%', '12%'], ['0.0%', '12.3%']]

// A text setting saved when the field is left.
function TextSetting ({ label, value, onSave }) {
  const [v, setV] = useState(value || '')
  return (
    <label className='chart-field'>
      <span>{label}</span>
      <input value={v} onChange={(e) => setV(e.target.value)} onBlur={() => { if (v !== (value || '')) onSave(v || null) }} onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }} />
    </label>
  )
}

const toggleIn = (list, i) => { const s = new Set(list || []); if (s.has(i)) s.delete(i); else s.add(i); return [...s].sort((a, b) => a - b) }

export function ChartPanel ({ chart, selection, onChange, onDelete, onClose }) {
  const set = (patch) => onChange(patch)
  const series = (chart.resolved && chart.resolved.series) || []
  const axes = !['pie', 'doughnut'].includes(chart.type || 'column')
  const labels = chart.labels || {}
  return (
    <div className='panel-backdrop chart-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel chart-panel' role='dialog' aria-label='Edit chart'>
        <header>
          <h2>Chart</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>

        <h3>Type</h3>
        <div className='chart-types' role='radiogroup' aria-label='Chart type'>
          {TYPES.map(([id, name, Icon]) => (
            <button key={id} role='radio' aria-checked={(chart.type || 'column') === id} className={(chart.type || 'column') === id ? 'on' : ''} onClick={() => set({ type: id })} title={name}>
              <Icon size={22} /><span>{name}</span>
            </button>
          ))}
        </div>

        <h3>Data</h3>
        <TextSetting key={'data' + chart.data} label='Range' value={chart.data} onSave={(v) => set({ data: v || '' })} />
        {selection && selection !== chart.data && <div className='row'><button onClick={() => set({ data: selection })}>Use the selection ({selection})</button></div>}
        <div className='chart-checks'>
          <label className='check'><input type='checkbox' checked={chart.seriesIn === 'rows'} onChange={(e) => set({ seriesIn: e.target.checked ? 'rows' : 'columns' })} /> Series in rows</label>
          <label className='check'><input type='checkbox' checked={!!labels.row} onChange={(e) => set({ labels: { ...labels, row: e.target.checked } })} /> First row has names</label>
          <label className='check'><input type='checkbox' checked={!!labels.col} onChange={(e) => set({ labels: { ...labels, col: e.target.checked } })} /> First column has names</label>
        </div>

        <h3>Labels</h3>
        <TextSetting key={'t' + chart.title} label='Title' value={chart.title} onSave={(v) => set({ title: v })} />
        {axes && <TextSetting key={'x' + chart.xTitle} label='Across axis title' value={chart.xTitle} onSave={(v) => set({ xTitle: v })} />}
        {axes && <TextSetting key={'y' + chart.yTitle} label='Up axis title' value={chart.yTitle} onSave={(v) => set({ yTitle: v })} />}
        <label className='chart-field'>
          <span>Legend</span>
          <select value={chart.legend || ''} onChange={(e) => set({ legend: e.target.value || null })}>
            <option value=''>Automatic</option>
            <option value='bottom'>Below</option>
            <option value='right'>Right</option>
            <option value='none'>None</option>
          </select>
        </label>
        <div className='chart-checks'>
          <label className='check'><input type='checkbox' checked={!!chart.dataLabels} onChange={(e) => set({ dataLabels: e.target.checked || null })} /> Show values</label>
          {['column', 'bar', 'area', 'combo'].includes(chart.type || 'column') && <label className='check'><input type='checkbox' checked={!!chart.stacked} onChange={(e) => set({ stacked: e.target.checked || null })} /> Stacked</label>}
          {['column', 'bar', 'area'].includes(chart.type || 'column') && <label className='check'><input type='checkbox' checked={!!chart.percent} onChange={(e) => set({ percent: e.target.checked || null })} /> 100%</label>}
        </div>

        {axes && (
          <>
            <h3>Value axis</h3>
            <div className='row chart-axis'>
              <TextSetting key={'min' + chart.yMin} label='Minimum' value={chart.yMin === undefined ? '' : String(chart.yMin)} onSave={(v) => set({ yMin: v === null || isNaN(Number(v)) ? null : Number(v) })} />
              <TextSetting key={'max' + chart.yMax} label='Maximum' value={chart.yMax === undefined ? '' : String(chart.yMax)} onSave={(v) => set({ yMax: v === null || isNaN(Number(v)) ? null : Number(v) })} />
            </div>
            <label className='chart-field'>
              <span>Number format</span>
              <select value={chart.yFormat || ''} onChange={(e) => set({ yFormat: e.target.value || null })}>
                {FORMATS.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
              </select>
            </label>
            <label className='check'><input type='checkbox' checked={!!chart.logScale} onChange={(e) => set({ logScale: e.target.checked || null })} /> Log scale</label>
          </>
        )}

        {series.length > 0 && axes && (
          <>
            <h3>Series</h3>
            <ul className='chart-series'>
              {series.map((s, i) => (
                <li key={i}>
                  <span>{s.name}</span>
                  {chart.type === 'combo' && <label className='check'><input type='checkbox' checked={(chart.lineSeries || []).includes(i)} onChange={() => set({ lineSeries: toggleIn(chart.lineSeries, i) })} /> Line</label>}
                  {chart.type === 'combo' && <label className='check'><input type='checkbox' checked={(chart.secondAxis || []).includes(i)} onChange={() => set({ secondAxis: toggleIn(chart.secondAxis, i) })} /> Right axis</label>}
                  <label className='check'><input type='checkbox' checked={(chart.trendline || []).includes(i)} onChange={() => set({ trendline: toggleIn(chart.trendline, i) })} /> Trend line</label>
                </li>
              ))}
            </ul>
          </>
        )}

        <div className='row'>
          <button className='danger' onClick={onDelete}>Delete chart</button>
        </div>
      </section>
    </div>
  )
}
