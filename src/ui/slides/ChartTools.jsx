import React, { useEffect, useRef, useState } from 'react'
import { X, Plus, Minus, ChartBar, ChartBarHorizontal, ChartLine, ChartLineUp, ChartPie, ChartDonut, ChartScatter, Pentagon, Table, Stack, Tag, TextAa, WaveSine } from '@phosphor-icons/react'
import { ColourPalette, SwatchButton, colourOf, popBelow } from './ShapeTools.jsx'

// The tools for a selected chart on a slide (proposals/2026-10-06-slides-
// followups.md, "Charts"): its type, title, legend, values on the chart,
// stacking, smooth lines and text colour, plus Edit data: a small panel with the chart's numbers in a grid.
// Desktop only: phones and viewers only draw charts.

export const CHART_TYPES = [
  ['column', 'Column', ChartBar],
  ['bar', 'Bar', ChartBarHorizontal],
  ['line', 'Line', ChartLine],
  ['area', 'Area', ChartLineUp],
  ['pie', 'Pie', ChartPie],
  ['doughnut', 'Doughnut', ChartDonut],
  ['scatter', 'Scatter', ChartScatter],
  ['radar', 'Radar', Pentagon]
]
const STACKS = ['column', 'bar', 'line', 'area']
const SMOOTH = ['line', 'area']
const SEND_MS = 400
const MAX_SERIES = 10
const MAX_ROWS = 1000

const pop = (button) => {
  const r = button.getBoundingClientRect()
  return { top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 220)) }
}

// A title saved when the field is left or on Enter (each once: a page
// without focus, as in the smoke test, gets no blur event).
function TitleField ({ value, onSave }) {
  const [v, setV] = useState(value || '')
  const saved = useRef(value || '')
  useEffect(() => { setV(value || ''); saved.current = value || '' }, [value])
  const save = () => {
    const t = v.trim()
    if (t === saved.current) return
    saved.current = t
    onSave(t)
  }
  return (
    <input
      className='chart-title-input'
      aria-label='Chart title'
      title='Chart title'
      placeholder='Chart title'
      maxLength={200}
      value={v}
      onChange={(e) => setV(e.target.value)}
      onBlur={save}
      onKeyDown={(e) => {
        e.stopPropagation()
        if (e.key === 'Enter') { e.preventDefault(); save(); e.target.blur() }
        if (e.key === 'Escape') { e.preventDefault(); setV(value || ''); setTimeout(() => e.target.blur(), 0) }
      }}
    />
  )
}

// value: the chart's { chart, data }; theme: the slide theme, for the
// text colour. setChart(patch) merges settings; onEditData opens the data
// panel.
export function ChartTools ({ value, theme, btn, phone, setChart, onEditData }) {
  const [menu, setMenu] = useState(null)
  const [colours, setColours] = useState(null)
  const c = value.chart
  const type = CHART_TYPES.find((t) => t[0] === c.type) || CHART_TYPES[0]
  const ICON = phone ? 20 : 18
  return (
    <>
      {btn('Chart type: ' + type[1], type[2], undefined, (e) => setMenu(menu ? null : pop(e.currentTarget)), { className: 'chart-type', 'aria-haspopup': 'menu' })}
      {menu && <div className='doc-scrim' onMouseDown={() => setMenu(null)} />}
      {menu && (
        <span className='shape-menu chart-type-menu doc-pop' role='menu' style={{ position: 'fixed', top: menu.top, left: menu.left }}>
          {CHART_TYPES.map(([id, label, Icon]) => (
            <button key={id} role='menuitemradio' aria-checked={id === c.type} className={'chart-type-' + id + (id === c.type ? ' on' : '')} title={label} aria-label={label} onMouseDown={(e) => e.preventDefault()} onClick={() => { setMenu(null); setChart({ type: id }) }}>
              <Icon size={22} />
            </button>
          ))}
        </span>
      )}
      <TitleField value={c.title} onSave={(title) => setChart({ title: title || undefined })} />
      <select aria-label='Legend' title='Legend' className='chart-legend' value={c.legend || ''} onChange={(e) => setChart({ legend: e.target.value || undefined })}>
        <option value=''>Auto legend</option>
        <option value='bottom'>Legend below</option>
        <option value='right'>Legend right</option>
        <option value='none'>No legend</option>
      </select>
      {btn('Show values', Tag, !!c.dataLabels, () => setChart({ dataLabels: !c.dataLabels || undefined }), { className: 'chart-labels' + (c.dataLabels ? ' on' : '') })}
      {SMOOTH.includes(c.type) && btn('Smooth lines', WaveSine, !!c.smooth, () => setChart({ smooth: !c.smooth || undefined }), { className: 'chart-smooth' + (c.smooth ? ' on' : '') })}
      <SwatchButton kind='chart-text' label='Text colour' Icon={TextAa} colour={colourOf(theme, c.textColor || 'text')} size={ICON} onOpen={(b) => setColours(colours ? null : popBelow(b))} />
      {colours && <ColourPalette theme={theme} kind='chart-text' at={colours} noneLabel='Automatic' onClose={() => setColours(null)} onPick={(col) => { setColours(null); setChart({ textColor: col === 'none' ? undefined : col }) }} />}
      {STACKS.includes(c.type) && btn('Stacked', Stack, !!c.stacked, () => setChart({ stacked: !c.stacked || undefined }), { className: 'chart-stacked' + (c.stacked ? ' on' : '') })}
      <button className='chart-edit-data' title='Edit data' onMouseDown={(e) => e.preventDefault()} onClick={onEditData}><Table size={ICON} /> Edit data</button>
    </>
  )
}

// A number from what was typed: spaces, thousands commas, currency signs
// and percent signs are ignored; a lone comma before one or two digits is
// a decimal point. Anything else is no value.
export function looseNumber (text) {
  let t = String(text || '').trim().replace(/[\s$€£¥%]/g, '')
  if (/^[-+]?\d+,\d{1,2}$/.test(t)) t = t.replace(',', '.')
  else t = t.replace(/,/g, '')
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(t)) return null
  const n = Number(t)
  return Number.isFinite(n) ? n : null
}

const show = (v) => (v === null || v === undefined ? '' : String(v))

// The grid as typed, from a chart's data.
function gridOf (data) {
  const rows = Math.max(data.categories.length, ...data.series.map((s) => s.values.length), 1)
  return {
    cats: Array.from({ length: rows }, (_, i) => show(data.categories[i])),
    series: (data.series.length ? data.series : [{ name: 'Series 1', values: [] }]).map((s) => ({ name: s.name, color: s.color, cells: Array.from({ length: rows }, (_, i) => show(s.values[i])) }))
  }
}

// The grid as a chart's data. A scatter chart's first column is numbers.
function dataOf (grid, type) {
  return {
    categories: grid.cats.map((x) => (type === 'scatter' ? looseNumber(x) : x)),
    series: grid.series.map((s, i) => {
      const out = { name: s.name.trim() || 'Series ' + (i + 1), values: s.cells.map(looseNumber) }
      if (s.color) out.color = s.color
      return out
    })
  }
}

// The chart's numbers: categories down the first column, one column per
// series with its name on top. Each change is written once typing pauses
// (and when the panel closes), so it undoes in sensible steps.
export function ChartDataPanel ({ value, onData, onClose }) {
  const [grid, setGrid] = useState(() => gridOf(value.data))
  const sent = useRef(JSON.stringify(value.data))
  const pending = useRef(null)
  const timer = useRef(null)
  const onDataRef = useRef(onData)
  onDataRef.current = onData

  const flush = () => {
    clearTimeout(timer.current)
    timer.current = null
    if (!pending.current) return
    const data = pending.current
    pending.current = null
    sent.current = null // the next data the chart has is this, made safe
    onDataRef.current(data)
  }
  useEffect(() => () => flush(), [])
  // Undo, redo or someone else's edit: show the chart's data again.
  const now = JSON.stringify(value.data)
  useEffect(() => {
    if (pending.current || now === sent.current) return
    const ours = sent.current === null
    sent.current = now
    if (!ours) setGrid(gridOf(value.data))
  }, [now])

  const update = (next) => {
    setGrid(next)
    pending.current = dataOf(next, value.chart.type)
    clearTimeout(timer.current)
    timer.current = setTimeout(flush, SEND_MS)
  }
  const setCat = (r, v) => update({ ...grid, cats: grid.cats.map((x, i) => (i === r ? v : x)) })
  const setCell = (k, r, v) => update({ ...grid, series: grid.series.map((s, i) => (i === k ? { ...s, cells: s.cells.map((x, j) => (j === r ? v : x)) } : s)) })
  const setName = (k, v) => update({ ...grid, series: grid.series.map((s, i) => (i === k ? { ...s, name: v } : s)) })
  const addRow = () => grid.cats.length < MAX_ROWS && update({ cats: [...grid.cats, ''], series: grid.series.map((s) => ({ ...s, cells: [...s.cells, ''] })) })
  const removeRow = (r) => grid.cats.length > 1 && update({ cats: grid.cats.filter((_, i) => i !== r), series: grid.series.map((s) => ({ ...s, cells: s.cells.filter((_, i) => i !== r) })) })
  const addSeries = () => grid.series.length < MAX_SERIES && update({ ...grid, series: [...grid.series, { name: 'Series ' + (grid.series.length + 1), cells: grid.cats.map(() => '') }] })
  const removeSeries = (k) => grid.series.length > 1 && update({ ...grid, series: grid.series.filter((_, i) => i !== k) })
  const close = () => { flush(); onClose() }
  const scatter = value.chart.type === 'scatter'
  const keys = (e) => { e.stopPropagation(); if (e.key === 'Escape') { e.preventDefault(); close() } }

  return (
    <div className='panel-backdrop chart-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <section className='panel chart-panel chart-data-panel' role='dialog' aria-label='Chart data' onKeyDown={keys}>
        <header>
          <h2>Chart data</h2>
          <button className='close' aria-label='Close' onClick={close}><X size={18} /></button>
        </header>
        {(value.chart.type === 'pie' || value.chart.type === 'doughnut') && <p className='small'>A pie shows the first series.</p>}
        <div className='chart-data-scroll'>
          <table className='chart-data'>
            <thead>
              <tr>
                <th className='cat-head'>{scatter ? 'X' : 'Category'}</th>
                {grid.series.map((s, k) => (
                  <th key={k}>
                    <span className='series-head'>
                      <input className='series-name' data-series={k} aria-label={'Series ' + (k + 1) + ' name'} value={s.name} maxLength={200} onChange={(e) => setName(k, e.target.value)} />
                      <button className='remove-series' title='Remove this series' aria-label={'Remove ' + (s.name || 'this series')} disabled={grid.series.length < 2} onClick={() => removeSeries(k)}><X size={14} /></button>
                    </span>
                  </th>
                ))}
                <th className='row-tools' />
              </tr>
            </thead>
            <tbody>
              {grid.cats.map((cat, r) => (
                <tr key={r}>
                  <td><input className='cat' data-row={r} aria-label={(scatter ? 'X ' : 'Category ') + (r + 1)} value={cat} maxLength={200} onChange={(e) => setCat(r, e.target.value)} /></td>
                  {grid.series.map((s, k) => (
                    <td key={k}><input className={'value' + (s.cells[r].trim() && looseNumber(s.cells[r]) === null ? ' bad' : '')} data-row={r} data-series={k} inputMode='decimal' aria-label={s.name + ', row ' + (r + 1)} value={s.cells[r]} onChange={(e) => setCell(k, r, e.target.value)} /></td>
                  ))}
                  <td className='row-tools'><button className='remove-row' title='Remove this row' aria-label={'Remove row ' + (r + 1)} disabled={grid.cats.length < 2} onClick={() => removeRow(r)}><Minus size={14} /></button></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <div className='row center equal'>
          <button className='add-row' onClick={addRow} disabled={grid.cats.length >= MAX_ROWS}><Plus size={16} /> Add row</button>
          <button className='add-series' onClick={addSeries} disabled={grid.series.length >= MAX_SERIES}><Plus size={16} /> Add series</button>
        </div>
      </section>
    </div>
  )
}
