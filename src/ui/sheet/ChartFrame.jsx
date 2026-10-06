// A chart floating over the grid, anchored to a cell
// (proposals/2026-10-04-charts.md). With a mouse: click to select, drag to
// move, drag the corner to resize; the selected chart shows its tools. On a
// touch screen a tap opens it full screen.

import React, { useRef, useState } from 'react'
import { PencilSimple, DownloadSimple, Trash } from '@phosphor-icons/react'
import { ChartView } from './Chart.jsx'

const touch = () => typeof window !== 'undefined' && window.matchMedia && window.matchMedia('(pointer: coarse)').matches

export function ChartFrame ({ chart, zoom, rowY, rowAt, colX, cols, rows, selected, actions }) {
  const [drag, setDrag] = useState(null) // { mode, x0, y0, dx, dy }
  const moved = useRef(false)
  const top = rowY[Math.min(chart.anchor.row, rows)] + chart.anchor.dy * zoom
  const left = colX[Math.min(chart.anchor.col, cols)] + chart.anchor.dx * zoom
  const w = Math.round(chart.size.w * zoom)
  const h = Math.round(chart.size.h * zoom)
  const a = actions || {}

  // Where a drag ends, as an anchor cell and offset in unzoomed pixels.
  function anchorAt (pxTop, pxLeft) {
    const t = Math.max(0, pxTop)
    const l = Math.max(0, pxLeft)
    const row = rowAt(t)
    let col = 1
    while (col < cols && colX[col + 1] <= l) col++
    return { row, col, dx: (l - colX[col]) / zoom, dy: (t - rowY[row]) / zoom }
  }

  function start (mode, e) {
    if (touch() || !a.canEdit) return
    e.preventDefault()
    e.stopPropagation()
    a.select(chart.id)
    moved.current = false
    const d = { mode, x0: e.clientX, y0: e.clientY, dx: 0, dy: 0 }
    setDrag(d)
    const move = (ev) => {
      d.dx = ev.clientX - d.x0
      d.dy = ev.clientY - d.y0
      if (Math.abs(d.dx) + Math.abs(d.dy) > 3) moved.current = true
      setDrag({ ...d })
    }
    const up = () => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      setDrag(null)
      if (!moved.current) return
      if (d.mode === 'move') a.change(chart.id, { anchor: anchorAt(top + d.dy, left + d.dx) })
      else a.change(chart.id, { size: { w: (w + d.dx) / zoom, h: (h + d.dy) / zoom } })
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  const box = {
    top: top + (drag && drag.mode === 'move' ? drag.dy : 0),
    left: left + (drag && drag.mode === 'move' ? drag.dx : 0),
    width: Math.max(80, w + (drag && drag.mode === 'size' ? drag.dx : 0)),
    height: Math.max(60, h + (drag && drag.mode === 'size' ? drag.dy : 0))
  }

  return (
    <div
      className={'chart-frame' + (selected ? ' selected' : '')}
      style={box}
      data-chart={chart.id}
      onMouseDown={(e) => start('move', e)}
      onClick={(e) => { e.stopPropagation(); if (touch()) a.open(chart.id); else a.select(chart.id) }}
      onDoubleClick={() => a.canEdit && a.edit(chart.id)}
      role='img'
      aria-label={'Chart' + (chart.title ? ': ' + chart.title : '')}
    >
      <ChartView chart={chart} width={Math.round(box.width)} height={Math.round(box.height)} />
      {selected && !touch() && (
        <>
          <div className='chart-tools' onMouseDown={(e) => e.stopPropagation()} onClick={(e) => e.stopPropagation()}>
            {a.canEdit && <button title='Edit chart' aria-label='Edit chart' onClick={() => a.edit(chart.id)}><PencilSimple size={16} /></button>}
            <button title='Download as PNG' aria-label='Download as PNG' onClick={() => a.download(chart.id, 'png')}><DownloadSimple size={16} /> PNG</button>
            <button title='Download as SVG' aria-label='Download as SVG' onClick={() => a.download(chart.id, 'svg')}><DownloadSimple size={16} /> SVG</button>
            {a.canEdit && <button title='Delete chart' aria-label='Delete chart' className='danger' onClick={() => a.remove(chart.id)}><Trash size={16} /></button>}
          </div>
          {a.canEdit && <div className='chart-resize' title='Drag to resize' onMouseDown={(e) => start('size', e)} />}
        </>
      )}
    </div>
  )
}
