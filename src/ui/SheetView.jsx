import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { Grid } from './Grid.jsx'
import { colName } from './a1.js'
import { shiftA1 } from '../shared/refs.js'
import { SharePanel } from './SharePanel.jsx'
import { DeletePanel } from './DeletePanel.jsx'
import { exportSheet, isMobile } from './xlsx.js'

const COLOURS = ['#1f2420', '#b3261e', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#7e22ce']
const FILLS = ['#fee2e2', '#ffedd5', '#fef3c7', '#dcfce7', '#cffafe', '#dbeafe', '#ede9fe', '#e5e7eb']

// The clipboard as text: rows split by newlines, cells by tabs.
function toTsv (grid) {
  return grid.map((line) => line.map((v) => (/[\t\n"]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v)).join('\t')).join('\n')
}

function fromTsv (text) {
  const rows = []
  let row = []
  let cell = ''
  let quoted = false
  for (let i = 0; i < text.length; i++) {
    const ch = text[i]
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++ } else if (ch === '"') quoted = false
      else cell += ch
    } else if (ch === '"' && cell === '') quoted = true
    else if (ch === '\t') { row.push(cell); cell = '' } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++
      row.push(cell); rows.push(row); row = []; cell = ''
    } else cell += ch
  }
  if (cell !== '' || row.length) { row.push(cell); rows.push(row) }
  return rows
}

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

function readPref (key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}
function writePref (key, value) {
  try { window.localStorage.setItem(key, value) } catch {}
}

export function SheetView ({ sheetId, onTitleChange, onError, onGone }) {
  const [view, setView] = useState(null)
  const [tabId, setTabId] = useState(null)
  const [sel, setSel] = useState({ row: 1, col: 1 }) // the active cell
  // The far corner of the selected range. As in Excel, Shift+arrows and
  // dragging move this corner while the active cell stays where it was.
  const [ext, setExt] = useState({ row: 1, col: 1 })
  const clip = useRef(null) // what we last copied: { text, row, col, inputs }
  const [palette, setPalette] = useState(null) // 'color' | 'fill' | null
  const [editing, setEditingState] = useState(null) // { row, col, value, source } | null
  // Keys can arrive before React has drawn the cell editor (slow machines,
  // fast typists). A ref holds the latest edit so those keys add to it
  // instead of replacing each other, and commit never reads a stale copy.
  const editingRef = useRef(null)
  const setEditing = useCallback((next) => {
    const value = typeof next === 'function' ? next(editingRef.current) : next
    editingRef.current = value
    setEditingState(value)
  }, [])
  const [menu, setMenu] = useState(null) // { kind, index, x, y } | null
  const [renaming, setRenaming] = useState(null) // { id, value } | null
  const [sharing, setSharing] = useState(false)
  const [more, setMore] = useState(false) // the ⋯ menu
  // Refresh the sidebar when the title changes from anywhere: a rename on
  // another device, or the name arriving after this device joined.
  const title = view ? view.title : null
  const shownTitle = useRef(null)
  useEffect(() => {
    if (title === null) return
    if (shownTitle.current !== title) onTitleChange()
    shownTitle.current = title
  }, [title])
  // Phone settings, remembered on this device only.
  const [zoom, setZoomState] = useState(() => Number(readPref('pearsheet:zoom')) || 1)
  const [numPad, setNumPadState] = useState(() => readPref('pearsheet:numpad') === '1')
  const setZoom = (z) => { setZoomState(z); writePref('pearsheet:zoom', String(Math.round(z * 100) / 100)) }
  const setNumPad = (on) => { setNumPadState(on); writePref('pearsheet:numpad', on ? '1' : '0') }
  const [deleting, setDeleting] = useState(null) // 'local' | 'everyone' | null
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
  // Content for a just-joined sheet arrives over the network, and edit access
  // can trail the role by a few seconds; poll until both are in.
  useEffect(() => {
    if (!view || !(view.loading || (view.myRole === 'editor' && !view.writable))) return
    const t = setInterval(load, 1000)
    return () => clearInterval(t)
  }, [view, load])

  const hasEditRole = !!view && (view.myRole === 'owner' || view.myRole === 'editor')
  const canEdit = hasEditRole && view.writable

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
    const current = editingRef.current
    if (!current) return
    const { row, col, value } = current
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

  const range = {
    r1: Math.min(sel.row, ext.row),
    c1: Math.min(sel.col, ext.col),
    r2: Math.max(sel.row, ext.row),
    c2: Math.max(sel.col, ext.col)
  }

  // Select a cell; with extend, move the far corner of the range instead.
  function select (row, col, extend = false) {
    if (!extend) setSel({ row, col })
    setExt({ row, col })
  }

  function moveBy (dr, dc, extend = false) {
    if (!view) return
    const from = extend ? ext : sel
    const row = Math.max(1, Math.min(view.rows, from.row + dr))
    const col = Math.max(1, Math.min(view.cols, from.col + dc))
    select(row, col, extend)
  }

  function formatRange (patch) {
    return run('sheet:setFormatRange', { ...range, patch })
  }

  function toggle (attr) {
    const fmt = (selected && selected.fmt) || {}
    formatRange({ [attr]: fmt[attr] ? null : true })
  }

  // --- copy, cut, paste ------------------------------------------------------

  function rangeGrid (pick) {
    const out = []
    for (let r = range.r1; r <= range.r2; r++) {
      const line = []
      for (let c = range.c1; c <= range.c2; c++) line.push(pick(cells.get(r + ',' + c) || null))
      out.push(line)
    }
    return out
  }

  // The selection as clipboard text; remembers the inputs so a paste back
  // into PearSheet keeps formulas.
  function copyText (cut) {
    const text = toTsv(rangeGrid((cell) => (cell ? cell.display : '')))
    clip.current = { text, row: range.r1, col: range.c1, inputs: rangeGrid((cell) => (cell ? cell.input : '')) }
    if (cut && canEdit) run('sheet:clearRange', range)
    return text
  }

  function onCopy (e, cut) {
    e.clipboardData.setData('text/plain', copyText(cut))
    e.preventDefault()
  }

  function onPaste (e) {
    if (!canEdit) return
    const text = e.clipboardData.getData('text/plain')
    if (!text) return
    e.preventDefault()
    pasteText(text)
  }

  // Phones: the shell's clipboard, from the toolbar buttons.
  async function phoneCopy (cut) { await call('app:setClipboard', { text: copyText(cut) }) }
  async function phonePaste () {
    if (!canEdit) return
    const { text } = await call('app:getClipboard')
    if (text) pasteText(text)
  }

  function pasteText (text) {
    const ours = clip.current && clip.current.text === text ? clip.current : null
    // From inside PearSheet: paste what was typed, moving relative references
    // as Excel does. From elsewhere: paste the text.
    let source = ours ? ours.inputs : fromTsv(text)
    // One copied cell fills a larger selection.
    const single = source.length === 1 && source[0].length === 1
    const h = single ? range.r2 - range.r1 + 1 : source.length
    const w = single ? range.c2 - range.c1 + 1 : Math.max(...source.map((l) => l.length))
    if (single) source = Array.from({ length: h }, () => Array.from({ length: w }, () => source[0][0]))
    // A pasted block moves as a whole; a single cell tiled over a range moves
    // to each target cell in turn.
    const at = (r, c, input) => {
      if (!ours || typeof input !== 'string' || input[0] !== '=') return input
      const dr = range.r1 - ours.row + (single ? r : 0)
      const dc = range.c1 - ours.col + (single ? c : 0)
      return '=' + shiftA1(input.slice(1), dr, dc)
    }
    const grid = source.map((line, r) => line.map((input, c) => at(r, c, input)))
    run('sheet:setCells', { row: range.r1, col: range.c1, grid })
    setSel({ row: range.r1, col: range.c1 })
    setExt({ row: range.r1 + h - 1, col: range.c1 + w - 1 })
  }

  function onKeyDown (e) {
    // The cell editor lives inside the grid, so its keys bubble up here. It
    // handles its own; only keys aimed at the grid itself count.
    if (e.target !== e.currentTarget) return
    // An edit has started but its input is not focused yet: keep typing into it.
    if (editingRef.current) {
      if (e.key === 'Enter' || e.key === 'Tab' || e.key === 'Escape') { onEditKey(e); return }
      if (e.key.length === 1 && !e.ctrlKey && !e.metaKey) {
        e.preventDefault()
        const ch = e.key
        setEditing((ed) => ({ ...ed, value: ed.value + ch }))
      }
      return
    }
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
    const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    if (moves[k]) { e.preventDefault(); moveBy(...moves[k], e.shiftKey); return }
    if (k === 'Tab') { e.preventDefault(); moveBy(0, e.shiftKey ? -1 : 1); return }
    if (k === 'Enter' || k === 'F2') { e.preventDefault(); setEditing({ ...sel, value: selected ? selected.input : '' }); return }
    if (k === 'Delete' || k === 'Backspace') { e.preventDefault(); run('sheet:clearRange', range); return }
    if (k.length === 1) { e.preventDefault(); setEditing({ ...sel, value: k, source: 'grid' }) }
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
  const frozenNote = view.frozen && (view.frozen.removed
    ? 'The owner removed you from this sheet. This is a read-only copy of what you had.'
    : 'This sheet moved to new keys. Opening the new copy...')

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
        {!canEdit && <span className='badge view-only'>{hasEditRole ? 'Getting edit access...' : 'View only'}</span>}
        <div className='tools' role='toolbar' aria-label='Formatting' hidden={!canEdit}>
          <button title='Undo (Ctrl+Z)' disabled={!view.canUndo} onClick={() => run('sheet:undo')}>Undo</button>
          <button title='Redo (Ctrl+Y)' disabled={!view.canRedo} onClick={() => run('sheet:redo')}>Redo</button>
          <span className='sep' />
          <button title='Bold (Ctrl+B)' className={'fmt-b' + (fmt.b ? ' on' : '')} onClick={() => toggle('b')}>B</button>
          <button title='Italic (Ctrl+I)' className={'fmt-i' + (fmt.i ? ' on' : '')} onClick={() => toggle('i')}>I</button>
          <span className='picker'>
            <button title='Text colour' className='swatch-button' onClick={() => setPalette(palette === 'color' ? null : 'color')}>
              <span className='letter' style={{ borderBottomColor: fmt.color || 'currentColor' }}>A</span>
            </button>
            <button title='Fill colour' className='swatch-button' onClick={() => setPalette(palette === 'fill' ? null : 'fill')}>
              <span className='fill-chip' style={{ background: fmt.fill || 'transparent' }} />
            </button>
            {palette && (
              <span className='palette' role='menu'>
                {(palette === 'color' ? COLOURS : FILLS).map((c) => (
                  <button key={c} className='swatch' style={{ background: c }} title={c} onClick={() => { formatRange({ [palette]: c }); setPalette(null) }} />
                ))}
                <button className='swatch none' title='None' onClick={() => { formatRange({ [palette]: null }); setPalette(null) }}>×</button>
              </span>
            )}
          </span>
          <select
            title='Number format'
            value={fmt.num || ''}
            onChange={(e) => formatRange({ num: e.target.value || null })}
          >
            {NUMBER_FORMATS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
        </div>
        {isMobile() && canEdit && (
          <div className='tools phone-tools' role='toolbar' aria-label='Clipboard'>
            <button onClick={() => phoneCopy(false).catch((err) => onError(err.message))}>Copy</button>
            <button onClick={() => phoneCopy(true).catch((err) => onError(err.message))}>Cut</button>
            <button onClick={() => phonePaste().catch((err) => onError(err.message))}>Paste</button>
            <button onClick={() => run('sheet:clearRange', range)}>Clear</button>
            <button
              className={numPad ? 'on' : ''}
              aria-pressed={numPad}
              // Android WebView does not report aria-pressed, so the name
              // carries the state.
              aria-label={'Number keypad, ' + (numPad ? 'on' : 'off')}
              title='Type with the number keypad'
              // Keep the cell editor focused, so the keyboard switches now.
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => setNumPad(!numPad)}
            >
              123
            </button>
          </div>
        )}
        {window.pearsheet && (
          <button className='export' title='Save a copy as an Excel file' onClick={() => exportSheet(sheetId).catch((err) => onError(err.message))}>Export</button>
        )}
        <button className='share' onClick={() => setSharing(true)}>Share</button>
        <span className='more'>
          <button className='more-button' aria-label='More' title='More' onClick={() => setMore(!more)}>⋯</button>
          {more && (
            <ul className='menu more-menu' role='menu' onClick={() => setMore(false)}>
              <li role='menuitem' onClick={() => setDeleting('local')}>Remove from this device</li>
              {view.myRole === 'owner' && <li role='menuitem' className='danger' onClick={() => setDeleting('everyone')}>Delete for everyone</li>}
            </ul>
          )}
        </span>
      </header>

      {frozenNote && <div className='banner info'>{frozenNote}</div>}
      <div className='formula-bar'>
        <span className='address'>{colName(sel.col) + sel.row}</span>
        <span className='fx' aria-hidden='true'>fx</span>
        <input
          aria-label='Cell contents'
          inputMode={numPad ? 'decimal' : undefined}
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
        zoom={zoom}
        onZoom={isMobile() ? setZoom : null}
        inputMode={numPad ? 'decimal' : undefined}
        range={range}
        ext={ext}
        onSelect={(row, col, extend) => { if (editing) commit(null); select(row, col, extend) }}
        onCopy={onCopy}
        onPaste={onPaste}
        onEdit={(row, col) => { select(row, col); if (canEdit) setEditing({ row, col, value: (cells.get(row + ',' + col) || {}).input || '' }) }}
        onEditChange={(value) => setEditing((ed) => ({ ...ed, value }))}
        onEditKey={onEditKey}
        onEditBlur={() => commit(null)}
        onKeyDown={onKeyDown}
        onHeaderMenu={(kind, index, x, y) => { if (canEdit) setMenu({ kind, index, x, y }) }}
        onResize={(col, px) => { if (canEdit) run('sheet:setWidth', { col, px }) }}
      />

      {sharing && <SharePanel sheetId={sheetId} onClose={() => setSharing(false)} onError={onError} />}
      {deleting && <DeletePanel sheetId={sheetId} title={view.title} kind={deleting} onClose={() => setDeleting(null)} onError={onError} onDone={() => { setDeleting(null); onGone() }} />}

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
              onClick={() => { setTabId(t.id); select(1, 1) }}
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
