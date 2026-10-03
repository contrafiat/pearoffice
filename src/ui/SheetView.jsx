import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { Grid } from './Grid.jsx'
import { colName } from './a1.js'
import { SharePanel } from './SharePanel.jsx'

const NUMBER_FORMATS = [
  ['', 'Automatic'],
  ['0.00', '1234.50'],
  ['#,##0.00', '1,234.50'],
  ['$#,##0.00', '$1,234.50'],
  ['0%', '12%'],
  ['0.00%', '12.34%'],
  ['yyyy-mm-dd', '2024-02-29'],
  ['d mmm yyyy', '29 Feb 2024']
]

export function SheetView ({ sheetId, onTitleChange, onError }) {
  const [view, setView] = useState(null)
  const [tabId, setTabId] = useState(null)
  const [sel, setSel] = useState({ row: 1, col: 1 })
  const [editing, setEditing] = useState(null) // { row, col, value } | null
  const [menu, setMenu] = useState(null) // { kind, index, x, y } | null
  const [renaming, setRenaming] = useState(null) // { id, value } | null
  const [sharing, setSharing] = useState(false)
  const gridRef = useRef(null)

  const load = useCallback(async () => {
    try {
      const v = await call('sheet:view', { sheetId, tabId })
      setView(v)
      if (!tabId) setTabId(v.tabId)
    } catch (err) {
      onError(err.message)
    }
  }, [sheetId, tabId, onError])

  useEffect(() => { load() }, [load])
  useEffect(() => on('sheet:changed', (d) => { if (d.sheetId === sheetId) load() }), [sheetId, load])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) load() }), [sheetId, load])
  // Content for a just-joined sheet arrives over the network; poll until it does.
  useEffect(() => {
    if (!view || !view.loading) return
    const t = setInterval(load, 1000)
    return () => clearInterval(t)
  }, [view, load])

  const canEdit = !!view && (view.myRole === 'owner' || view.myRole === 'editor')

  const cells = useMemo(() => {
    const m = new Map()
    if (view) for (const c of view.cells) m.set(c.row + ',' + c.col, c)
    return m
  }, [view])

  const selected = cells.get(sel.row + ',' + sel.col)

  const run = useCallback(async (method, args = {}) => {
    try {
      return await call(method, { sheetId, tabId, ...args })
    } catch (err) {
      onError(err.message)
    }
  }, [sheetId, tabId, onError])

  const focusGrid = () => gridRef.current && gridRef.current.focus()

  async function commit (move) {
    if (!editing) return
    const { row, col, value } = editing
    setEditing(null)
    const before = cells.get(row + ',' + col)
    if ((before ? before.input : '') !== value) {
      // Show what was typed until the worklet sends the computed value.
      setView((v) => v && {
        ...v,
        cells: [...v.cells.filter((c) => c.row !== row || c.col !== col), { row, col, input: value, display: value, kind: 'text', fmt: before ? before.fmt : {} }]
      })
      await run('sheet:setCell', { row, col, input: value })
    }
    if (move) moveBy(move[0], move[1])
    focusGrid()
  }

  function moveBy (dr, dc) {
    if (!view) return
    setSel((s) => ({
      row: Math.max(1, Math.min(view.rows, s.row + dr)),
      col: Math.max(1, Math.min(view.cols, s.col + dc))
    }))
  }

  function toggle (attr) {
    const fmt = (selected && selected.fmt) || {}
    run('sheet:setFormat', { row: sel.row, col: sel.col, patch: { [attr]: fmt[attr] ? null : true } })
  }

  function onKeyDown (e) {
    if (editing) return
    if (!canEdit) {
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
      if (moves[e.key]) { e.preventDefault(); moveBy(...moves[e.key]) }
      return
    }
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (mod && (k === 'z' || k === 'Z')) { e.preventDefault(); run(e.shiftKey ? 'sheet:redo' : 'sheet:undo'); return }
    if (mod && (k === 'y' || k === 'Y')) { e.preventDefault(); run('sheet:redo'); return }
    if (mod && (k === 'b' || k === 'B')) { e.preventDefault(); toggle('b'); return }
    if (mod && (k === 'i' || k === 'I')) { e.preventDefault(); toggle('i'); return }
    if (mod) return
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
    if (moves[k]) { e.preventDefault(); moveBy(...moves[k]); return }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); setEditing({ ...sel, value: selected ? selected.input : '' }); return }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); if (selected) run('sheet:setCell', { row: sel.row, col: sel.col, input: '' }); return }
    if (k.length === 1) { e.preventDefault(); setEditing({ ...sel, value: k }) }
  }

  function onEditKey (e) {
    if (e.key === 'Enter') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]) }
    else if (e.key === 'Tab') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]) }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); focusGrid() }
  }

  async function lineAction (action) {
    const { kind, index } = menu
    setMenu(null)
    const noun = kind === 'row' ? 'Rows' : 'Cols'
    if (action === 'before') await run('sheet:insert' + noun, { at: index })
    if (action === 'after') await run('sheet:insert' + noun, { at: index + 1 })
    if (action === 'delete') await run('sheet:delete' + noun, { at: index })
    focusGrid()
  }

  if (!view) return <div className='loading'>Opening sheet...</div>
  if (view.loading) return <div className='loading'>Waiting for the sheet to arrive from the people in it...</div>

  const fmt = (selected && selected.fmt) || {}
  const barValue = editing && editing.row === sel.row && editing.col === sel.col ? editing.value : (selected ? selected.input : '')

  return (
    <div className='sheet' onClick={() => menu && setMenu(null)}>
      <header className='toolbar'>
        <input
          className='title'
          aria-label='Sheet title'
          defaultValue={view.title}
          key={view.title}
          readOnly={!canEdit}
          onBlur={async (e) => { if (e.target.value !== view.title) { await run('sheet:setTitle', { title: e.target.value }); onTitleChange() } }}
          onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
        />
        {!canEdit && <span className='badge view-only'>View only</span>}
        <div className='tools' role='toolbar' aria-label='Formatting' hidden={!canEdit}>
          <button title='Undo (Ctrl+Z)' disabled={!view.canUndo} onClick={() => run('sheet:undo')}>Undo</button>
          <button title='Redo (Ctrl+Y)' disabled={!view.canRedo} onClick={() => run('sheet:redo')}>Redo</button>
          <span className='sep' />
          <button title='Bold (Ctrl+B)' className={'fmt-b' + (fmt.b ? ' on' : '')} onClick={() => toggle('b')}>B</button>
          <button title='Italic (Ctrl+I)' className={'fmt-i' + (fmt.i ? ' on' : '')} onClick={() => toggle('i')}>I</button>
          <select
            title='Number format'
            value={fmt.num || ''}
            onChange={(e) => run('sheet:setFormat', { row: sel.row, col: sel.col, patch: { num: e.target.value || null } })}
          >
            {NUMBER_FORMATS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        <button className='share' onClick={() => setSharing(true)}>Share</button>
      </header>

      <div className='formula-bar'>
        <span className='address'>{colName(sel.col) + sel.row}</span>
        <span className='fx' aria-hidden='true'>fx</span>
        <input
          aria-label='Cell contents'
          readOnly={!canEdit}
          value={barValue}
          onFocus={() => { if (canEdit && !editing) setEditing({ ...sel, value: selected ? selected.input : '', source: 'bar' }) }}
          onChange={(e) => setEditing({ ...sel, value: e.target.value, source: 'bar' })}
          onKeyDown={onEditKey}
          onBlur={() => { if (editing) commit(null) }}
        />
      </div>

      <Grid
        ref={gridRef}
        view={view}
        cells={cells}
        sel={sel}
        editing={editing}
        onSelect={(row, col) => { if (editing) commit(null); setSel({ row, col }) }}
        onEdit={(row, col) => { setSel({ row, col }); if (canEdit) setEditing({ row, col, value: (cells.get(row + ',' + col) || {}).input || '' }) }}
        onEditChange={(value) => setEditing((ed) => ({ ...ed, value }))}
        onEditKey={onEditKey}
        onEditBlur={() => commit(null)}
        onKeyDown={onKeyDown}
        onHeaderMenu={(kind, index, x, y) => { if (canEdit) setMenu({ kind, index, x, y }) }}
        onResize={(col, px) => { if (canEdit) run('sheet:setWidth', { col, px }) }}
      />

      {sharing && <SharePanel sheetId={sheetId} onClose={() => setSharing(false)} onError={onError} />}

      {menu && (
        <ul className='menu' style={{ left: menu.x, top: menu.y }} role='menu'>
          <li role='menuitem' onClick={() => lineAction('before')}>Insert {menu.kind === 'row' ? 'row above' : 'column left'}</li>
          <li role='menuitem' onClick={() => lineAction('after')}>Insert {menu.kind === 'row' ? 'row below' : 'column right'}</li>
          <li role='menuitem' className='danger' onClick={() => lineAction('delete')}>Delete {menu.kind === 'row' ? 'row ' + menu.index : 'column ' + colName(menu.index)}</li>
        </ul>
      )}

      <footer className='tabbar'>
        {view.tabs.map((t) => renaming && renaming.id === t.id
          ? (
            <input
              key={t.id}
              className='tab rename'
              aria-label='Tab name'
              autoFocus
              value={renaming.value}
              onChange={(e) => setRenaming({ id: t.id, value: e.target.value })}
              onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur(); if (e.key === 'Escape') setRenaming(null) }}
              onBlur={async () => {
                const name = renaming.value.trim()
                setRenaming(null)
                if (name && name !== t.name) await run('sheet:renameTab', { tabId: t.id, name })
              }}
            />
            )
          : (
            <button
              key={t.id}
              className={'tab' + (t.id === view.tabId ? ' active' : '')}
              title='Double-click to rename'
              onClick={() => { setTabId(t.id); setSel({ row: 1, col: 1 }) }}
              onDoubleClick={() => { if (canEdit) setRenaming({ id: t.id, value: t.name }) }}
            >
              {t.name}
            </button>
            ))}
        {canEdit && <button className='tab add' title='Add tab' onClick={async () => { const r = await run('sheet:addTab', {}); if (r) setTabId(r.tabId) }}>+</button>}
      </footer>
    </div>
  )
}
