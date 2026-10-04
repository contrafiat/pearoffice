import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { colName } from './a1.js'

const ROW_H = 24
const HEAD_H = 26
const ROWHEAD_W = 52
const DEFAULT_W = 100
const OVERSCAN = 6

// Spreadsheet grid. Only the visible rows and columns are rendered, so large
// sheets stay fast. Headers are drawn outside the scroll area and moved with
// the scroll position.
export const Grid = forwardRef(function Grid (props, ref) {
  const { view, cells, sel, editing, onSelect, onEdit, onEditChange, onEditKey, onEditBlur, onKeyDown, onHeaderMenu, onResize } = props
  const bodyRef = useRef(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0, width: 800, height: 600 })
  const [drag, setDrag] = useState(null) // { col, startX, startW, w }

  useImperativeHandle(ref, () => ({ focus: () => bodyRef.current && bodyRef.current.focus() }))

  const widths = useMemo(() => {
    const w = new Array(view.cols + 1)
    for (let c = 1; c <= view.cols; c++) w[c] = view.widths[c] || DEFAULT_W
    if (drag) w[drag.col] = drag.w
    return w
  }, [view.cols, view.widths, drag])

  // colX[c] is the left edge of column c; colX[cols + 1] is the total width.
  const colX = useMemo(() => {
    const x = new Array(view.cols + 2)
    x[1] = 0
    for (let c = 1; c <= view.cols; c++) x[c + 1] = x[c] + widths[c]
    return x
  }, [widths, view.cols])

  const totalW = colX[view.cols + 1]
  const totalH = view.rows * ROW_H

  useLayoutEffect(() => {
    const el = bodyRef.current
    const measure = () => setScroll((s) => ({ ...s, width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  function onScroll () {
    const el = bodyRef.current
    setScroll((s) => ({ ...s, top: el.scrollTop, left: el.scrollLeft }))
  }

  // Keep the selected cell in view.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const y = (sel.row - 1) * ROW_H
    const x = colX[sel.col]
    const w = widths[sel.col]
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + ROW_H > el.scrollTop + el.clientHeight) el.scrollTop = y + ROW_H - el.clientHeight
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth
  }, [sel.row, sel.col, colX, widths])

  const firstRow = Math.max(1, Math.floor(scroll.top / ROW_H) + 1 - OVERSCAN)
  const lastRow = Math.min(view.rows, Math.ceil((scroll.top + scroll.height) / ROW_H) + OVERSCAN)
  let firstCol = 1
  while (firstCol < view.cols && colX[firstCol + 1] < scroll.left) firstCol++
  let lastCol = firstCol
  while (lastCol < view.cols && colX[lastCol] < scroll.left + scroll.width) lastCol++

  const rows = []
  for (let r = firstRow; r <= lastRow; r++) rows.push(r)
  const cols = []
  for (let c = firstCol; c <= lastCol; c++) cols.push(c)

  function startResize (e, col) {
    e.preventDefault()
    e.stopPropagation()
    const startX = e.clientX
    const startW = widths[col]
    setDrag({ col, startX, startW, w: startW })
    const move = (ev) => setDrag({ col, startX, startW, w: Math.max(24, startW + ev.clientX - startX) })
    const up = (ev) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const w = Math.max(24, startW + ev.clientX - startX)
      setDrag(null)
      if (w !== startW) onResize(col, w)
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // The formula bar edits too; only draw the in-cell editor for grid edits.
  const isEditingHere = editing && editing.source !== 'bar' && editing.row >= firstRow && editing.row <= lastRow

  return (
    <div className='grid' style={{ '--row-h': ROW_H + 'px', '--head-h': HEAD_H + 'px', '--rowhead-w': ROWHEAD_W + 'px' }}>
      <div className='corner' />
      <div className='col-heads'>
        <div style={{ transform: `translateX(${-scroll.left}px)`, width: totalW, position: 'relative', height: '100%' }}>
          {cols.map((c) => (
            <div
              key={c}
              className={'col-head' + (c === sel.col ? ' on' : '')}
              style={{ left: colX[c], width: widths[c] }}
              onClick={() => onSelect(sel.row, c)}
              onContextMenu={(e) => { e.preventDefault(); onHeaderMenu('col', c, e.clientX, e.clientY) }}
            >
              {colName(c)}
              <span className='resize' onMouseDown={(e) => startResize(e, c)} />
            </div>
          ))}
        </div>
      </div>
      <div className='row-heads'>
        <div style={{ transform: `translateY(${-scroll.top}px)`, height: totalH, position: 'relative' }}>
          {rows.map((r) => (
            <div
              key={r}
              className={'row-head' + (r === sel.row ? ' on' : '')}
              style={{ top: (r - 1) * ROW_H }}
              onClick={() => onSelect(r, sel.col)}
              onContextMenu={(e) => { e.preventDefault(); onHeaderMenu('row', r, e.clientX, e.clientY) }}
            >
              {r}
            </div>
          ))}
        </div>
      </div>
      <div className='body' ref={bodyRef} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown} aria-label='Spreadsheet' role='grid'>
        <div className='canvas' style={{ width: totalW, height: totalH }}>
          {rows.map((r) => cols.map((c) => {
            const cell = cells.get(r + ',' + c)
            const fmt = (cell && cell.fmt) || {}
            const cls = 'cell' + (cell ? ' k-' + cell.kind : '') + (fmt.b ? ' b' : '') + (fmt.i ? ' i' : '')
            return (
              <div
                key={r + ',' + c}
                className={cls}
                style={{ top: (r - 1) * ROW_H, left: colX[c], width: widths[c] }}
                onMouseDown={() => onSelect(r, c)}
                onDoubleClick={() => onEdit(r, c)}
                // Touch screens: tapping the cell that is already selected edits it.
                onTouchEnd={(e) => { if (sel.row === r && sel.col === c) { e.preventDefault(); onEdit(r, c) } }}
                title={cell && cell.volatile ? 'Changes on each device (time or random)' : undefined}
              >
                {cell ? cell.display : ''}
              </div>
            )
          }))}
          <div
            className='selection'
            style={{ top: (sel.row - 1) * ROW_H, left: colX[sel.col], width: widths[sel.col], height: ROW_H }}
          />
          {isEditingHere && (
            <input
              className='editor'
              autoFocus
              aria-label='Edit cell'
              style={{ top: (editing.row - 1) * ROW_H, left: colX[editing.col], minWidth: widths[editing.col], height: ROW_H }}
              value={editing.value}
              onChange={(e) => onEditChange(e.target.value)}
              onKeyDown={onEditKey}
              onBlur={onEditBlur}
            />
          )}
        </div>
      </div>
    </div>
  )
})
