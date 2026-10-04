import { ChartFrame } from './ChartFrame.jsx'
import React, { forwardRef, useEffect, useImperativeHandle, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { colName } from './a1.js'
import { textStyle, borderCss, hasBorder, neededHeight } from './cellStyle.js'

const BASE_ROW_H = 24
const HEAD_H = 26
const ROWHEAD_W = 52
const DEFAULT_W = 100
const OVERSCAN = 6
export const MIN_ZOOM = 0.5
export const MAX_ZOOM = 2.5

// Spreadsheet grid. Only the visible rows and columns are rendered, so large
// sheets stay fast. Headers are drawn outside the scroll area and moved with
// the scroll position.
export const Grid = forwardRef(function Grid (props, ref) {
  const { view, cells, sel, ext = sel, range, spillBox, editing, onSelect, onEdit, onEditChange, onEditKey, onEditBlur, onEditCaret = () => {}, onKeyDown, onHeaderMenu, onCellMenu = () => {}, onFill = null, charts = [], selectedChart = null, chartActions = null, onResize, onRowResize = () => {}, onCopy, onPaste, zoom = 1, onZoom, inputMode } = props
  // Row height and column widths scale with the zoom (pinch on a phone);
  // stored widths stay unzoomed.
  const ROW_H = Math.round(BASE_ROW_H * zoom)
  const bodyRef = useRef(null)
  const [scroll, setScroll] = useState({ top: 0, left: 0, width: 800, height: 600 })
  const [drag, setDrag] = useState(null) // { col, startX, startW, w }
  const [rowDrag, setRowDrag] = useState(null) // { row, h } while a row is resized

  useImperativeHandle(ref, () => ({ focus: () => bodyRef.current && bodyRef.current.focus() }))

  // Drag to select a range.
  const dragging = useRef(false)
  // Drag the fill handle: the cell the pointer is over, while dragging.
  const [fillTo, setFillTo] = useState(null)
  const filling = useRef(false)
  // Which way and how far a fill reaches: the longer stretch past the range.
  const fillPlan = (to) => {
    if (!to) return null
    const down = to.row - range.r2
    const up = range.r1 - to.row
    const right = to.col - range.c2
    const left = range.c1 - to.col
    const best = Math.max(down, up, right, left)
    if (best <= 0) return null
    if (best === down) return { dir: 'down', n: down }
    if (best === up) return { dir: 'up', n: up }
    if (best === right) return { dir: 'right', n: right }
    return { dir: 'left', n: left }
  }
  useEffect(() => {
    const up = () => {
      dragging.current = false
      if (filling.current) {
        filling.current = false
        setFillTo((to) => {
          const plan = fillPlan(to)
          if (plan && onFill) onFill(plan.dir, plan.n)
          return null
        })
      }
    }
    window.addEventListener('mouseup', up)
    return () => window.removeEventListener('mouseup', up)
  })

  // Copy, cut and paste while the grid (not an input) has focus.
  useEffect(() => {
    const mine = () => document.activeElement === bodyRef.current
    const copy = (e) => { if (mine()) onCopy(e, false) }
    const cut = (e) => { if (mine()) onCopy(e, true) }
    const paste = (e) => { if (mine()) onPaste(e) }
    document.addEventListener('copy', copy)
    document.addEventListener('cut', cut)
    document.addEventListener('paste', paste)
    return () => {
      document.removeEventListener('copy', copy)
      document.removeEventListener('cut', cut)
      document.removeEventListener('paste', paste)
    }
  }, [onCopy, onPaste])

  const widths = useMemo(() => {
    const w = new Array(view.cols + 1)
    for (let c = 1; c <= view.cols; c++) w[c] = Math.round((view.widths[c] || DEFAULT_W) * zoom)
    if (drag) w[drag.col] = drag.w
    return w
  }, [view.cols, view.widths, drag, zoom])

  // colX[c] is the left edge of column c; colX[cols + 1] is the total width.
  const colX = useMemo(() => {
    const x = new Array(view.cols + 2)
    x[1] = 0
    for (let c = 1; c <= view.cols; c++) x[c + 1] = x[c] + widths[c]
    return x
  }, [widths, view.cols])

  // Row heights (proposals/2026-10-04-cell-formats.md): a stored height, or
  // tall enough for wrapped or larger text (measured here, never stored), or
  // the default. rowY[r] is the top of row r; rowY[rows + 1] the total.
  const rowH = useMemo(() => {
    const need = new Map()
    for (const cell of cells.values()) {
      const n = neededHeight(cell, view.widths[cell.col] || DEFAULT_W, BASE_ROW_H)
      if (n > (need.get(cell.row) || 0)) need.set(cell.row, n)
    }
    const h = new Array(view.rows + 2)
    for (let r = 1; r <= view.rows; r++) h[r] = Math.round(((view.heights && view.heights[r]) || need.get(r) || BASE_ROW_H) * zoom)
    if (rowDrag) h[rowDrag.row] = rowDrag.h
    return h
  }, [cells, view.rows, view.heights, view.widths, zoom, rowDrag])
  const rowY = useMemo(() => {
    const y = new Array(view.rows + 2)
    y[1] = 0
    for (let r = 1; r <= view.rows; r++) y[r + 1] = y[r] + rowH[r]
    return y
  }, [rowH, view.rows])
  // The row at a vertical position (zoomed pixels).
  const rowAt = (py) => {
    let lo = 1
    let hi = view.rows
    while (lo < hi) { const mid = (lo + hi + 1) >> 1; if (rowY[mid] <= py) lo = mid; else hi = mid - 1 }
    return lo
  }
  const span = (r1, r2) => rowY[Math.min(r2, view.rows) + 1] - rowY[r1]
  // Merged cells: the top-left draws the whole block; the rest draw nothing.
  const merged = useMemo(() => {
    const top = new Map()
    const hidden = new Set()
    for (const m of view.merges || []) {
      top.set(m.r1 + ',' + m.c1, m)
      for (let r = m.r1; r <= m.r2; r++) for (let c = m.c1; c <= m.c2; c++) if (r !== m.r1 || c !== m.c1) hidden.add(r + ',' + c)
    }
    return { top, hidden }
  }, [view.merges])

  const totalW = colX[view.cols + 1]
  const totalH = rowY[view.rows + 1]

  useLayoutEffect(() => {
    const el = bodyRef.current
    const measure = () => setScroll((s) => ({ ...s, width: el.clientWidth, height: el.clientHeight }))
    measure()
    const ro = new ResizeObserver(measure)
    ro.observe(el)
    return () => ro.disconnect()
  }, [])

  // Pinch to zoom, keeping the point between the fingers in place.
  const pinch = useRef(null) // { d0, z0 } while two fingers are down
  const pinched = useRef(false) // a pinch happened since the last touch start
  const anchor = useRef(null) // { x, y, from } to restore after a zoom
  const dist = (t) => Math.hypot(t[0].clientX - t[1].clientX, t[0].clientY - t[1].clientY)
  function onTouchStart (e) {
    if (e.touches.length === 1) pinched.current = false
    if (e.touches.length === 2 && onZoom) { pinch.current = { d0: dist(e.touches), z0: zoom }; pinched.current = true }
  }
  function onTouchMove (e) {
    if (!pinch.current || e.touches.length !== 2) return
    const z = Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, pinch.current.z0 * dist(e.touches) / pinch.current.d0))
    if (Math.abs(z - zoom) < 0.01) return
    const rect = bodyRef.current.getBoundingClientRect()
    anchor.current = {
      x: (e.touches[0].clientX + e.touches[1].clientX) / 2 - rect.left,
      y: (e.touches[0].clientY + e.touches[1].clientY) / 2 - rect.top,
      from: zoom
    }
    onZoom(z)
  }
  function onTouchEnd (e) {
    if (e.touches.length < 2) pinch.current = null
  }
  useLayoutEffect(() => {
    const a = anchor.current
    const el = bodyRef.current
    if (!a || !el) return
    anchor.current = null
    const k = zoom / a.from
    el.scrollLeft = (el.scrollLeft + a.x) * k - a.x
    el.scrollTop = (el.scrollTop + a.y) * k - a.y
  }, [zoom])

  function onScroll () {
    const el = bodyRef.current
    setScroll((s) => ({ ...s, top: el.scrollTop, left: el.scrollLeft }))
  }

  // Keep the moving corner of the selection in view.
  useEffect(() => {
    const el = bodyRef.current
    if (!el) return
    const y = rowY[ext.row]
    const x = colX[ext.col]
    const w = widths[ext.col]
    if (y < el.scrollTop) el.scrollTop = y
    else if (y + rowH[ext.row] > el.scrollTop + el.clientHeight) el.scrollTop = y + rowH[ext.row] - el.clientHeight
    if (x < el.scrollLeft) el.scrollLeft = x
    else if (x + w > el.scrollLeft + el.clientWidth) el.scrollLeft = x + w - el.clientWidth
    // Only when the selection moves: a pinch zoom must not snap back to it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ext.row, ext.col])

  const firstRow = Math.max(1, rowAt(scroll.top) - OVERSCAN)
  const lastRow = Math.min(view.rows, rowAt(scroll.top + scroll.height) + OVERSCAN)
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
      if (w !== startW) onResize(col, Math.round(w / zoom))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  function startRowResize (e, row) {
    e.preventDefault()
    e.stopPropagation()
    const startY = e.clientY
    const startH = rowH[row]
    setRowDrag({ row, h: startH })
    const move = (ev) => setRowDrag({ row, h: Math.max(12, startH + ev.clientY - startY) })
    const up = (ev) => {
      window.removeEventListener('mousemove', move)
      window.removeEventListener('mouseup', up)
      const h = Math.max(12, startH + ev.clientY - startY)
      setRowDrag(null)
      if (h !== startH) onRowResize(row, Math.round(h / zoom))
    }
    window.addEventListener('mousemove', move)
    window.addEventListener('mouseup', up)
  }

  // The formula bar edits too; only draw the in-cell editor for grid edits.
  const isEditingHere = editing && editing.source !== 'bar' && editing.row >= firstRow && editing.row <= lastRow

  return (
    <div className='grid' style={{ '--row-h': ROW_H + 'px', '--head-h': HEAD_H + 'px', '--rowhead-w': ROWHEAD_W + 'px', '--cell-font': Math.round(14 * zoom * 10) / 10 + 'px' }}>
      <div className='corner' />
      <div className='col-heads'>
        <div style={{ transform: `translateX(${-scroll.left}px)`, width: totalW, position: 'relative', height: '100%' }}>
          {cols.map((c) => (
            <div
              key={c}
              className={'col-head' + (c >= range.c1 && c <= range.c2 ? ' on' : '')}
              style={{ left: colX[c], width: widths[c] }}
              onClick={(e) => { if (e.shiftKey) onSelect(view.rows, c, true); else { onSelect(1, c); onSelect(view.rows, c, true) } }}
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
              className={'row-head' + (r >= range.r1 && r <= range.r2 ? ' on' : '')}
              style={{ top: rowY[r], height: rowH[r] }}
              onClick={(e) => { if (e.shiftKey) onSelect(r, view.cols, true); else { onSelect(r, 1); onSelect(r, view.cols, true) } }}
              onContextMenu={(e) => { e.preventDefault(); onHeaderMenu('row', r, e.clientX, e.clientY) }}
            >
              {r}
              <span className='row-resize' title='Drag to resize; double-click to fit' onMouseDown={(e) => startRowResize(e, r)} onDoubleClick={(e) => { e.stopPropagation(); onRowResize(r, null) }} onClick={(e) => e.stopPropagation()} />
            </div>
          ))}
        </div>
      </div>
      <div className='body' ref={bodyRef} tabIndex={0} onScroll={onScroll} onKeyDown={onKeyDown} onTouchStart={onTouchStart} onTouchMove={onTouchMove} onTouchEnd={onTouchEnd} aria-label='Spreadsheet' role='grid'>
        <div className='canvas' style={{ width: totalW, height: totalH }}>
          {[...(view.merges || []).filter((m) => (m.r1 < firstRow || m.c1 < firstCol) && m.r2 >= firstRow && m.c2 >= firstCol && m.r1 <= lastRow && m.c1 <= lastCol).map((m) => [m.r1, m.c1]), ...rows.flatMap((r) => cols.map((c) => [r, c]))].map(([r, c]) => {
            if (merged.hidden.has(r + ',' + c)) return null
            const m = merged.top.get(r + ',' + c)
            const cell = cells.get(r + ',' + c)
            const fmt = (cell && cell.fmt) || {}
            const cls = 'cell' + (cell ? ' k-' + cell.kind : '') + (fmt.b ? ' b' : '') + (fmt.i ? ' i' : '') + (fmt.wrap ? ' wrap' : '') + (fmt.valign ? ' v-' + fmt.valign : '')
            return (
              <div
                key={r + ',' + c}
                className={cls}
                style={{ top: rowY[r], height: m ? span(m.r1, m.r2) : rowH[r], left: colX[c], width: m ? colX[Math.min(m.c2, view.cols) + 1] - colX[c] : widths[c], color: fmt.color, background: fmt.fill }}
                data-r={r}
                data-c={c}
                onMouseDown={(e) => { dragging.current = true; onSelect(r, c, e.shiftKey) }}
                onMouseEnter={() => { if (filling.current) setFillTo({ row: r, col: c }); else if (dragging.current) onSelect(r, c, true) }}
                onDoubleClick={() => onEdit(r, c)}
                onContextMenu={(e) => { e.preventDefault(); onCellMenu(r, c, e.clientX, e.clientY) }}
                // Touch screens: tapping the cell that is already selected edits it.
                onTouchEnd={(e) => { if (!pinched.current && e.touches.length === 0 && sel.row === r && sel.col === c) { e.preventDefault(); onEdit(r, c) } }}
                title={cell && cell.volatile ? 'Changes on each device (time or random)' : cell && cell.blocked ? 'This answer cannot fill in. Select the cell to see why.' : undefined}
              >
                <span className='cell-text' style={textStyle(fmt, zoom)}>{cell ? cell.display : ''}</span>
                {hasBorder(fmt) && <span className='cell-borders' style={{ borderTop: borderCss(fmt.bt), borderRight: borderCss(fmt.br), borderBottom: borderCss(fmt.bb), borderLeft: borderCss(fmt.bl) }} />}
              </div>
            )
          })}
          {(range.r1 !== range.r2 || range.c1 !== range.c2) && (
            <div
              className='range'
              style={{ top: rowY[range.r1], left: colX[range.c1], width: colX[Math.min(range.c2, view.cols) + 1] - colX[range.c1], height: span(range.r1, range.r2) }}
            />
          )}
          {spillBox && (
            <div
              className='spill-outline'
              style={{ top: rowY[spillBox.r1], left: colX[spillBox.c1], width: colX[Math.min(spillBox.c2, view.cols) + 1] - colX[spillBox.c1], height: span(spillBox.r1, spillBox.r2) }}
            />
          )}
          <div
            className='selection'
            style={(() => {
              const m = merged.top.get(sel.row + ',' + sel.col)
              return m
                ? { top: rowY[sel.row], left: colX[sel.col], width: colX[Math.min(m.c2, view.cols) + 1] - colX[sel.col], height: span(m.r1, m.r2), zIndex: 2 }
                : { top: rowY[sel.row], left: colX[sel.col], width: widths[sel.col], height: rowH[sel.row], zIndex: 2 }
            })()}
          />
          {charts.map((ch) => (
            <ChartFrame
              key={ch.id}
              chart={ch}
              zoom={zoom}
              rowY={rowY}
              rowAt={rowAt}
              colX={colX}
              cols={view.cols}
              rows={view.rows}
              selected={selectedChart === ch.id}
              actions={chartActions}
            />
          ))}
          {/* Mouse: drag this square to fill (series or copies). */}
          {onFill && (
            <div
              className='fill-handle'
              title='Drag to fill'
              style={{ top: rowY[Math.min(range.r2, view.rows) + 1] - 4, left: colX[Math.min(range.c2, view.cols) + 1] - 4 }}
              onMouseDown={(e) => { e.preventDefault(); e.stopPropagation(); filling.current = true; setFillTo(null) }}
            />
          )}
          {(() => {
            const plan = fillPlan(fillTo)
            if (!plan) return null
            const box = { ...range }
            if (plan.dir === 'down') box.r2 += plan.n
            if (plan.dir === 'up') box.r1 -= plan.n
            if (plan.dir === 'right') box.c2 += plan.n
            if (plan.dir === 'left') box.c1 -= plan.n
            return (
              <div
                className='fill-preview'
                style={{ top: rowY[Math.max(1, box.r1)], left: colX[Math.max(1, box.c1)], width: colX[Math.min(box.c2, view.cols) + 1] - colX[Math.max(1, box.c1)], height: span(Math.max(1, box.r1), box.r2) }}
              />
            )
          })()}
          {/* Touch screens: drag this handle to grow the selection, since a
              finger dragging across the grid scrolls it. */}
          <div
            className='range-handle'
            style={{ top: rowY[Math.min(range.r2, view.rows) + 1] - 9, left: colX[Math.min(range.c2, view.cols) + 1] - 9 }}
            onTouchStart={(e) => { e.stopPropagation() }}
            // touch-action: none (in the CSS) stops the page scrolling while
            // the handle is dragged.
            onTouchMove={(e) => {
              const t = e.touches[0]
              const el = document.elementFromPoint(t.clientX, t.clientY)
              const cell = el && el.closest && el.closest('.cell')
              if (cell) onSelect(Number(cell.dataset.r), Number(cell.dataset.c), true)
            }}
          />
          {isEditingHere && (
            <input
              className='editor'
              autoFocus
              aria-label='Edit cell'
              inputMode={inputMode}
              style={{ top: rowY[editing.row], left: colX[editing.col], minWidth: widths[editing.col], height: rowH[editing.row], ...textStyle((cells.get(editing.row + ',' + editing.col) || {}).fmt, zoom), textAlign: undefined }}
              value={editing.value}
              onChange={(e) => { onEditChange(e.target.value); onEditCaret(e.target.selectionStart) }}
              onSelect={(e) => onEditCaret(e.target.selectionStart)}
              onKeyDown={onEditKey}
              onBlur={onEditBlur}
            />
          )}
        </div>
      </div>
    </div>
  )
})
