import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { Grid } from './Grid.jsx'
import { colName } from './a1.js'
import { changeDecimals, jumpTarget, todaySerial } from './cellTools.js'
import { shiftA1 } from '../shared/refs.js'
import { SharePanel } from './SharePanel.jsx'
import { PeopleStack } from './Avatar.jsx'
import { FindPanel } from './FindPanel.jsx'
import { SortPanel } from './SortPanel.jsx'
import { readPref, writePref } from './prefs.js'
import { ArrowCounterClockwise, ArrowClockwise, TextB, TextItalic, TextAUnderline, PaintBucket, Copy, Scissors, ClipboardText, Eraser, Numpad, FileXls, DotsThree, Plus, MagnifyingGlass, X } from '@phosphor-icons/react'
import { DeletePanel } from './DeletePanel.jsx'
import { FormulaHelp, helpFor, insertFunction } from './FormulaHelp.jsx'
import { exportSheet, exportCsv, printTab, isMobile } from './xlsx.js'

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

// Why a formula shows #SPILL!, in words.
function spillReason (b) {
  const at = (rc) => colName(rc[1]) + rc[0]
  if (b.kind === 'cells') return 'This answer needs cells that are not empty: ' + b.cells.map(at).join(', ') + (b.more ? ' and ' + b.more + ' more' : '') + '. Clear them to let it fill in.'
  if (b.kind === 'overlap') return 'The answer of the formula in ' + at(b.anchor) + ' already fills some of the cells this answer needs.'
  if (b.kind === 'edge') return 'The answer does not fit on this tab.'
  if (b.kind === 'size') return 'The answer is larger than 100,000 cells.'
  return 'The answer would cover a cell it depends on.'
}

export function SheetView ({ sheetId, onTitleChange, onError, onGone }) {
  const [view, setView] = useState(null)
  const [tabId, setTabId] = useState(null)
  const [sel, setSel] = useState({ row: 1, col: 1 }) // the active cell
  // The far corner of the selected range. As in Excel, Shift+arrows and
  // dragging move this corner while the active cell stays where it was.
  const [ext, setExt] = useState({ row: 1, col: 1 })
  const clip = useRef(null) // what we last copied: { text, row, col, inputs }
  const pasteMode = useRef(null) // 'values' for the next paste (Ctrl+Shift+V)
  const [palette, setPalette] = useState(null) // 'color' | 'fill' | null
  // On phones the tools row scrolls sideways, which would clip a palette
  // placed inside it, so the palette is placed on the screen instead.
  const [paletteAt, setPaletteAt] = useState(null)
  const phone = isMobile()
  const ICON = phone ? 20 : 18 // toolbar icon size
  function openPalette (kind, button) {
    if (palette === kind) { setPalette(null); return }
    if (phone) {
      const r = button.getBoundingClientRect()
      setPaletteAt({ position: 'fixed', top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 130)) })
    } else setPaletteAt(null)
    setPalette(kind)
  }
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
  // Formula help: where the caret is in the text being edited, the
  // highlighted suggestion, and whether Escape hid the list.
  const [caret, setCaret] = useState(null)
  const [helpSel, setHelpSel] = useState(0)
  const [helpOff, setHelpOff] = useState(null) // the partial name Escape hid
  const nextCaret = useRef(null)
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
  // Changed in Settings while this sheet is open.
  useEffect(() => {
    const onPref = (e) => { if (e.detail && e.detail.key === 'pearsheet:numpad') setNumPadState(e.detail.value === '1') }
    window.addEventListener('pearsheet:pref', onPref)
    return () => window.removeEventListener('pearsheet:pref', onPref)
  }, [])
  const [deleting, setDeleting] = useState(null) // 'local' | 'everyone' | null
  const [finding, setFinding] = useState(null) // { replace } while Find is open
  const [sorting, setSorting] = useState(null) // what the Sort panel sorts
  const [droppingTab, setDroppingTab] = useState(null) // a tab waiting for "Delete"
  const gridRef = useRef(null)

  // Everyone in the sheet, for the pictures next to Share.
  const [members, setMembers] = useState([])
  const loadMembers = useCallback(() => {
    call('sheet:members', { sheetId }).then((d) => setMembers(d.members)).catch(() => {})
  }, [sheetId])
  useEffect(() => { loadMembers() }, [loadMembers])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) loadMembers() }), [sheetId, loadMembers])

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
  // Spilling (proposals/2026-10-04-spilling-formulas.md): the formula a
  // selected cell's value comes from, and the block it fills.
  const anchor = selected && selected.from ? cells.get(selected.from[0] + ',' + selected.from[1]) : selected
  const spillBox = anchor && anchor.spill
    ? { r1: anchor.row, c1: anchor.col, r2: anchor.row + anchor.spill.rows - 1, c2: anchor.col + anchor.spill.cols - 1 }
    : null
  const spilled = !!(selected && selected.from)

  const run = useCallback(async (method, args = {}) => {
    try {
      return await call(method, { sheetId, tabId, ...args })
    } catch (err) {
      onError(err.message)
    }
  }, [sheetId, tabId, onError])

  const focusGrid = () => gridRef.current && gridRef.current.focus()
  // After a panel closes: back to the grid on desktop; on phones drop focus
  // instead, so the keyboard the panel opened goes away.
  const afterPanel = () => {
    if (!phone) { focusGrid(); return }
    if (document.activeElement && document.activeElement.blur) document.activeElement.blur()
  }

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
    clip.current = {
      text,
      row: range.r1,
      col: range.c1,
      inputs: rangeGrid((cell) => (cell ? cell.input : '')),
      // What the cells show, for "paste values": numbers exactly, the rest as shown.
      values: rangeGrid((cell) => (!cell ? '' : cell.num !== undefined ? String(cell.num) : cell.kind === 'error' ? '' : cell.display))
    }
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
    pasteText(text, pasteMode.current)
    pasteMode.current = null
  }

  // The cell menu's clipboard: the system clipboard through the shell.
  async function menuCopy (cut) { await call('app:setClipboard', { text: copyText(cut) }) }
  async function menuPaste (mode) {
    if (!canEdit) return
    const { text } = await call('app:getClipboard')
    if (text) pasteText(text, mode)
  }

  // Phones: the shell's clipboard, from the toolbar buttons.
  async function phoneCopy (cut) { await call('app:setClipboard', { text: copyText(cut) }) }
  async function phonePaste () {
    if (!canEdit) return
    const { text } = await call('app:getClipboard')
    if (text) pasteText(text)
  }

  // mode: 'values' pastes what cells show (no formulas); 'transpose' turns
  // rows into columns.
  function pasteText (text, mode = null) {
    const ours = clip.current && clip.current.text === text ? clip.current : null
    // From inside PearSheet: paste what was typed, moving relative references
    // as Excel does. From elsewhere: paste the text.
    let source = ours ? (mode === 'values' ? ours.values : ours.inputs) : fromTsv(text)
    if (mode === 'values') source = source.map((line) => line.map((v) => (typeof v === 'string' && /^[='"]/.test(v) ? "'" + v : v)))
    if (mode === 'transpose') source = source[0].map((_, c) => source.map((line) => line[c]))
    // One copied cell fills a larger selection.
    const single = source.length === 1 && source[0].length === 1
    const h = single ? range.r2 - range.r1 + 1 : source.length
    const w = single ? range.c2 - range.c1 + 1 : Math.max(...source.map((l) => l.length))
    if (single) source = Array.from({ length: h }, () => Array.from({ length: w }, () => source[0][0]))
    // A pasted block moves as a whole; a single cell tiled over a range moves
    // to each target cell in turn.
    const at = (r, c, input) => {
      if (!ours || mode === 'values' || typeof input !== 'string' || input[0] !== '=') return input
      // Transposed, the cell at (r, c) came from (c, r).
      const dr = range.r1 - ours.row + (single ? r : 0) + (mode === 'transpose' ? r - c : 0)
      const dc = range.c1 - ours.col + (single ? c : 0) + (mode === 'transpose' ? c - r : 0)
      return '=' + shiftA1(input.slice(1), dr, dc)
    }
    const grid = source.map((line, r) => line.map((input, c) => at(r, c, input)))
    run('sheet:setCells', { row: range.r1, col: range.c1, grid })
    setSel({ row: range.r1, col: range.c1 })
    setExt({ row: range.r1 + h - 1, col: range.c1 + w - 1 })
  }

  // Fill n cells past the selection (the fill handle), then select it all.
  async function fillFrom (dir, n, src = range, mode = 'series') {
    await run('sheet:fill', { ...src, dir, n, mode })
    const box = { ...src }
    if (dir === 'down') box.r2 += n
    if (dir === 'up') box.r1 -= n
    if (dir === 'right') box.c2 += n
    if (dir === 'left') box.c1 -= n
    setSel({ row: box.r1, col: box.c1 })
    setExt({ row: box.r2, col: box.c2 })
  }

  // Phones (More menu): continue what is at the top (or left) of the
  // selection into the empty rest of it.
  function fillSelection (dir) {
    const has = (r, c) => { const x = cells.get(r + ',' + c); return !!(x && x.input) }
    if (dir === 'down') {
      let end = range.r1
      while (end < range.r2 && [...Array(range.c2 - range.c1 + 1)].some((_, i) => has(end + 1, range.c1 + i))) end++
      if (end < range.r2) fillFrom('down', range.r2 - end, { r1: range.r1, c1: range.c1, r2: end, c2: range.c2 })
    } else {
      let end = range.c1
      while (end < range.c2 && [...Array(range.r2 - range.r1 + 1)].some((_, i) => has(range.r1 + i, end + 1))) end++
      if (end < range.c2) fillFrom('right', range.c2 - end, { r1: range.r1, c1: range.c1, r2: range.r2, c2: end })
    }
  }

  // The block of data around a cell, as Excel's current region: grows while
  // a neighbouring row or column has something in it.
  function dataRegion (r) {
    const filled = (row, col) => { const x = cells.get(row + ',' + col); return !!(x && x.display !== '') }
    const box = { ...r }
    for (let grew = true; grew;) {
      grew = false
      const any = (r1, c1, r2, c2) => { for (let a = r1; a <= r2; a++) for (let b = c1; b <= c2; b++) if (filled(a, b)) return true; return false }
      if (box.r1 > 1 && any(box.r1 - 1, Math.max(1, box.c1 - 1), box.r1 - 1, Math.min(view.cols, box.c2 + 1))) { box.r1--; grew = true }
      if (box.r2 < view.rows && any(box.r2 + 1, Math.max(1, box.c1 - 1), box.r2 + 1, Math.min(view.cols, box.c2 + 1))) { box.r2++; grew = true }
      if (box.c1 > 1 && any(box.r1, box.c1 - 1, box.r2, box.c1 - 1)) { box.c1--; grew = true }
      if (box.c2 < view.cols && any(box.r1, box.c2 + 1, box.r2, box.c2 + 1)) { box.c2++; grew = true }
    }
    return box
  }

  // A first row that is all text above a column that is not is a header.
  function headerGuess (box) {
    const top = []
    for (let c = box.c1; c <= box.c2; c++) top.push(cells.get(box.r1 + ',' + c))
    if (!top.every((x) => x && x.kind === 'text')) return false
    for (let r = box.r1 + 1; r <= box.r2; r++) for (let c = box.c1; c <= box.c2; c++) { const x = cells.get(r + ',' + c); if (x && x.kind !== 'text' && x.display !== '') return true }
    return top.some((x) => x.fmt && x.fmt.b)
  }

  // What a sort works on: the selection, or the data around a single cell.
  function sortBox () {
    return range.r1 === range.r2 && range.c1 === range.c2 ? dataRegion(range) : { ...range }
  }

  async function sortBy (box, keys, header) {
    await run('sheet:sortRange', { ...box, keys, header })
    setSel({ row: box.r1, col: box.c1 })
    setExt({ row: box.r2, col: box.c2 })
  }

  function quickSort (desc) {
    const box = sortBox()
    sortBy(box, [{ col: Math.min(Math.max(sel.col, box.c1), box.c2), desc }], headerGuess(box))
  }

  function openSort () {
    const box = sortBox()
    const names = {}
    for (let c = box.c1; c <= box.c2; c++) { const x = cells.get(box.r1 + ',' + c); if (x) names[c] = x.display }
    setSorting({ box, header: headerGuess(box), names, firstKey: Math.min(Math.max(sel.col, box.c1), box.c2) })
  }

  // Keys that move or select without editing, for every role: Ctrl+arrows
  // to the edge of the data, Ctrl+Home/End, Ctrl+A, Shift+Space (row) and
  // Ctrl+Space (column). True if it handled the key.
  function navKey (e) {
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    const arrows = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }
    const filled = (r, c) => { const x = cells.get(r + ',' + c); return !!(x && x.display !== '') }
    let to = null
    let extend = e.shiftKey
    if (mod && arrows[k]) to = jumpTarget(filled, view.rows, view.cols, extend ? ext : sel, ...arrows[k])
    else if (mod && k === 'Home') to = { row: 1, col: 1 }
    else if (mod && k === 'End') {
      let row = 1
      let col = 1
      for (const x of view.cells) if (x.display !== '') { row = Math.max(row, x.row); col = Math.max(col, x.col) }
      to = { row, col }
    } else if (mod && (k === 'a' || k === 'A') && !e.shiftKey) {
      e.preventDefault(); setSel({ row: 1, col: 1 }); setExt({ row: view.rows, col: view.cols }); return true
    } else if (k === ' ' && e.shiftKey && !mod) {
      e.preventDefault(); setSel({ row: sel.row, col: 1 }); setExt({ row: ext.row, col: view.cols }); return true
    } else if (k === ' ' && mod) {
      e.preventDefault(); setSel({ row: 1, col: sel.col }); setExt({ row: view.rows, col: ext.col }); return true
    } else return false
    e.preventDefault()
    if (k === 'Home' || k === 'End') extend = e.shiftKey
    select(to.row, to.col, extend)
    return true
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
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H')) {
      e.preventDefault()
      setFinding({ replace: canEdit && (e.key === 'h' || e.key === 'H') })
      return
    }
    if (!canEdit) {
      if (navKey(e)) return
      const moves = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1], Tab: [0, e.shiftKey ? -1 : 1] }
      if (moves[e.key]) { e.preventDefault(); moveBy(...moves[e.key]) }
      return
    }
    const mod = e.ctrlKey || e.metaKey
    const k = e.key
    if (navKey(e)) return
    // Ctrl+Shift+V: the next paste is values only.
    if (mod && e.shiftKey && (k === 'v' || k === 'V')) { pasteMode.current = 'values'; return }
    if (mod && k === ';') {
      e.preventDefault()
      run('sheet:setCell', { row: sel.row, col: sel.col, input: String(todaySerial()) })
      if (!(selected && selected.fmt && selected.fmt.num)) run('sheet:setFormat', { row: sel.row, col: sel.col, patch: { num: 'yyyy-mm-dd' } })
      return
    }
    // Ctrl+D / Ctrl+R: copy the top row down / the left column right.
    if (mod && (k === 'd' || k === 'D') && range.r2 > range.r1) { e.preventDefault(); fillFrom('down', range.r2 - range.r1, { ...range, r2: range.r1 }, 'copy'); return }
    if (mod && (k === 'r' || k === 'R') && range.c2 > range.c1) { e.preventDefault(); fillFrom('right', range.c2 - range.c1, { ...range, c2: range.c1 }, 'copy'); return }
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

  // Sum, average and count of the selection, as Calc and Excel show them.
  const totals = useMemo(() => {
    if (range.r1 === range.r2 && range.c1 === range.c2) return null
    let sum = 0
    let numbers = 0
    let count = 0
    for (const x of cells.values()) {
      if (x.row < range.r1 || x.row > range.r2 || x.col < range.c1 || x.col > range.c2 || x.display === '') continue
      count++
      if (x.num !== undefined) { sum += x.num; numbers++ }
    }
    return { sum, average: numbers ? sum / numbers : null, count }
  }, [cells, range.r1, range.r2, range.c1, range.c2])
  const shortNumber = (n) => String(Number(n.toPrecision(12)))

  const editValue = editing ? editing.value : null
  const caretAt = caret === null || editValue === null ? (editValue || '').length : Math.min(caret, editValue.length)
  const help = editing && canEdit ? helpFor(editValue, caretAt) : null
  const shownHelp = help && help.list && helpOff === help.partial ? null : help
  useEffect(() => { setHelpSel(0) }, [help && help.partial])
  useEffect(() => { if (!editing) { setCaret(null); setHelpOff(null) } }, [!!editing])
  // Put the caret where an inserted function name ended.
  useLayoutEffect(() => {
    if (nextCaret.current === null) return
    const el = document.activeElement
    if (el && el.tagName === 'INPUT') el.setSelectionRange(nextCaret.current, nextCaret.current)
    setCaret(nextCaret.current)
    nextCaret.current = null
  })

  function pickFunction (name) {
    if (!help || !help.list) return
    const r = insertFunction(editValue, caretAt, help.partial, name)
    nextCaret.current = r.caret
    setEditing((ed) => ({ ...ed, value: r.value }))
  }

  function onEditKey (e) {
    if (shownHelp && shownHelp.list) {
      const n = shownHelp.list.length
      if (e.key === 'ArrowDown') { e.preventDefault(); setHelpSel((i) => (i + 1) % n); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHelpSel((i) => (i - 1 + n) % n); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickFunction(shownHelp.list[Math.min(helpSel, n - 1)].name); return }
      if (e.key === 'Escape') { e.preventDefault(); setHelpOff(shownHelp.partial); return }
    }
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
  const barValue = editing && editing.row === sel.row && editing.col === sel.col ? editing.value : spilled ? (anchor ? anchor.input : '') : (selected ? selected.input : '')

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
        <div className={'tools' + (phone ? ' phone-row' : '')} role='toolbar' aria-label='Formatting' hidden={!canEdit}>
          <button title='Undo (Ctrl+Z)' aria-label='Undo' disabled={!view.canUndo} onClick={() => run('sheet:undo')}><ArrowCounterClockwise size={ICON} /></button>
          <button title='Redo (Ctrl+Y)' aria-label='Redo' disabled={!view.canRedo} onClick={() => run('sheet:redo')}><ArrowClockwise size={ICON} /></button>
          <span className='sep' />
          <button title='Bold (Ctrl+B)' aria-label='Bold' className={'fmt-b' + (fmt.b ? ' on' : '')} onClick={() => toggle('b')}><TextB size={ICON} weight='bold' /></button>
          <button title='Italic (Ctrl+I)' aria-label='Italic' className={'fmt-i' + (fmt.i ? ' on' : '')} onClick={() => toggle('i')}><TextItalic size={ICON} /></button>
          <span className='picker'>
            <button title='Text colour' aria-label='Text colour' className='swatch-button' onClick={(e) => openPalette('color', e.currentTarget)}>
              <span className='icon-swatch'><TextAUnderline size={ICON} /><span className='swatch-bar' style={{ background: fmt.color || 'currentColor' }} /></span>
            </button>
            <button title='Fill colour' aria-label='Fill colour' className='swatch-button' onClick={(e) => openPalette('fill', e.currentTarget)}>
              <span className='icon-swatch'><PaintBucket size={ICON} /><span className='swatch-bar' style={{ background: fmt.fill || 'transparent' }} /></span>
            </button>
            {palette && (
              <span className='palette' role='menu' style={paletteAt || undefined}>
                {(palette === 'color' ? COLOURS : FILLS).map((c) => (
                  <button key={c} className='swatch' style={{ background: c }} title={c} onClick={() => { formatRange({ [palette]: c }); setPalette(null) }} />
                ))}
                <button className='swatch none' title='None' onClick={() => { formatRange({ [palette]: null }); setPalette(null) }}>×</button>
              </span>
            )}
          </span>
          <select
            title='Number format'
            aria-label='Number format'
            value={fmt.num || ''}
            onChange={(e) => formatRange({ num: e.target.value || null })}
          >
            {NUMBER_FORMATS.map(([code, label]) => <option key={code} value={code}>{label}</option>)}
          </select>
          <button
            className='decimals'
            title='Fewer decimal places'
            aria-label='Fewer decimal places'
            onClick={() => formatRange({ num: changeDecimals(fmt.num, -1, selected && selected.display) })}
          >.0<span aria-hidden='true'>←</span>
          </button>
          <button
            className='decimals'
            title='More decimal places'
            aria-label='More decimal places'
            onClick={() => formatRange({ num: changeDecimals(fmt.num, 1, selected && selected.display) })}
          >.00<span aria-hidden='true'>→</span>
          </button>
          {phone && (
            <>
              <span className='sep' />
              <button aria-label='Copy' onClick={() => phoneCopy(false).catch((err) => onError(err.message))}><Copy size={ICON} /></button>
              <button aria-label='Cut' onClick={() => phoneCopy(true).catch((err) => onError(err.message))}><Scissors size={ICON} /></button>
              <button aria-label='Paste' onClick={() => phonePaste().catch((err) => onError(err.message))}><ClipboardText size={ICON} /></button>
              <button aria-label='Clear' onClick={() => run('sheet:clearRange', range)}><Eraser size={ICON} /></button>
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
                <Numpad size={ICON} />
              </button>
            </>
          )}
        </div>
        {window.pearsheet && (
          <button className='export icon-button' title='Save a copy as an Excel file' aria-label='Export' onClick={() => exportSheet(sheetId).catch((err) => onError(err.message))}><FileXls size={ICON} /></button>
        )}
        <button className='find-button icon-button' title='Find and replace (Ctrl+F)' aria-label='Find' onClick={() => setFinding({ replace: false })}><MagnifyingGlass size={ICON} /></button>
        {members.length > 1 && <PeopleStack sheetId={sheetId} members={members} max={phone ? 2 : 3} size={phone ? 24 : 26} onClick={() => setSharing(true)} />}
        <button className='share' onClick={() => setSharing(true)}>Share</button>
        <span className='more'>
          <button className='more-button icon-button' aria-label='More' title='More' onClick={() => setMore(!more)}><DotsThree size={ICON} weight='bold' /></button>
          {more && (
            <ul className='menu more-menu' role='menu' onClick={() => setMore(false)}>
              <li role='menuitem' onClick={() => setFinding({ replace: canEdit })}>Find and replace</li>
              <li role='menuitem' onClick={() => exportCsv(view).catch((err) => onError(err.message))}>Download this tab as CSV</li>
              {!phone && <li role='menuitem' onClick={() => printTab(view, 'pdf').catch((err) => onError(err.message))}>Save this tab as PDF</li>}
              {!phone && <li role='menuitem' onClick={() => printTab(view, 'print').catch((err) => onError(err.message))}>Print this tab...</li>}
              {canEdit && <li role='menuitem' onClick={openSort}>Sort...</li>}
              {canEdit && phone && <li role='menuitem' onClick={() => fillSelection('down')}>Fill down</li>}
              {canEdit && phone && <li role='menuitem' onClick={() => fillSelection('right')}>Fill right</li>}
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
          className={spilled && !editing ? 'spilled' : undefined}
          title={spilled && !editing ? 'This value comes from the formula in ' + colName(anchor.col) + anchor.row : undefined}
          readOnly={!canEdit || (spilled && !editing)}
          value={barValue}
          onFocus={() => { if (canEdit && !editing && !spilled) setEditing({ ...sel, value: selected ? selected.input : '', source: 'bar' }) }}
          onChange={(e) => { setEditing({ ...sel, value: e.target.value, source: 'bar' }); setCaret(e.target.selectionStart) }}
          onSelect={(e) => setCaret(e.target.selectionStart)}
          onKeyDown={onEditKey}
          onBlur={() => { if (editing) commit(null) }}
        />
      </div>
      {selected && selected.blocked && (
        <div className='spill-note' role='status'>
          {spillReason(selected.blocked)}
          {selected.blocked.kind === 'edge' && canEdit && (
            <button
              className='link-button'
              onClick={async () => {
                const b = selected.blocked
                if (b.rows) await run('sheet:insertRows', { at: view.rows + 1, count: b.rows })
                if (b.cols) await run('sheet:insertCols', { at: view.cols + 1, count: b.cols })
              }}
            >
              Add {selected.blocked.rows ? selected.blocked.rows + (selected.blocked.rows === 1 ? ' row' : ' rows') : ''}{selected.blocked.rows && selected.blocked.cols ? ' and ' : ''}{selected.blocked.cols ? selected.blocked.cols + (selected.blocked.cols === 1 ? ' column' : ' columns') : ''}
            </button>
          )}
        </div>
      )}

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
        spillBox={spillBox}
        ext={ext}
        onSelect={(row, col, extend) => { if (editing) commit(null); select(row, col, extend) }}
        onCopy={onCopy}
        onPaste={onPaste}
        onEdit={(row, col) => { select(row, col); if (canEdit) setEditing({ row, col, value: (cells.get(row + ',' + col) || {}).input || '' }) }}
        onEditChange={(value) => setEditing((ed) => ({ ...ed, value }))}
        onEditCaret={setCaret}
        onEditKey={onEditKey}
        onEditBlur={() => commit(null)}
        onKeyDown={onKeyDown}
        onHeaderMenu={(kind, index, x, y) => { if (canEdit) setMenu({ kind, index, x, y }) }}
        onFill={canEdit && !phone ? fillFrom : null}
        onCellMenu={(row, col, x, y) => {
          if (row < range.r1 || row > range.r2 || col < range.c1 || col > range.c2) select(row, col)
          setMenu({ kind: 'cell', x, y })
        }}
        onResize={(col, px) => { if (canEdit) run('sheet:setWidth', { col, px }) }}
      />

      {droppingTab && (
        <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setDroppingTab(null) }}>
          <section className='panel' role='dialog' aria-label='Delete tab'>
            <header>
              <h2>Delete "{droppingTab.name}"?</h2>
              <button className='close' aria-label='Close' onClick={() => setDroppingTab(null)}><X size={18} /></button>
            </header>
            <p>The tab and its cells go for everyone in this sheet. Formulas on other tabs that use it will show #REF!. Undo brings it back.</p>
            <div className='row end'>
              <button onClick={() => setDroppingTab(null)}>Keep it</button>
              <button
                className='danger'
                onClick={async () => {
                  const t = droppingTab
                  setDroppingTab(null)
                  const r = await run('sheet:deleteTab', { tabId: t.id })
                  if (r && t.id === view.tabId) { setTabId(null); select(1, 1) }
                }}
              >Delete tab
              </button>
            </div>
          </section>
        </div>
      )}
      {finding && (
        <FindPanel
          sheetId={sheetId}
          tabId={view.tabId}
          tabs={view.tabs}
          canEdit={canEdit}
          startWithReplace={finding.replace}
          onGo={(m) => { if (m.tabId !== view.tabId) setTabId(m.tabId); setSel({ row: m.row, col: m.col }); setExt({ row: m.row, col: m.col }) }}
          onClose={() => { setFinding(null); afterPanel() }}
          onError={onError}
        />
      )}
      {sorting && (
        <SortPanel
          range={sorting.box}
          headerGuess={sorting.header}
          headerNames={sorting.names}
          firstKey={sorting.firstKey}
          onSort={({ keys, header }) => { setSorting(null); sortBy(sorting.box, keys, header); afterPanel() }}
          onClose={() => { setSorting(null); afterPanel() }}
        />
      )}
      {sharing && <SharePanel sheetId={sheetId} onClose={() => setSharing(false)} onError={onError} />}
      {shownHelp && <FormulaHelp help={shownHelp} selected={helpSel} onPick={pickFunction} anchor={document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : null} />}
      {deleting && <DeletePanel sheetId={sheetId} title={view.title} kind={deleting} onClose={() => setDeleting(null)} onError={onError} onDone={() => { setDeleting(null); onGone() }} />}

      {menu && (
        <ul className='menu' style={menu.kind === 'tab' ? { left: menu.x, bottom: window.innerHeight - menu.y } : { left: menu.x, top: menu.y }} role='menu'>
          {menu.kind === 'tab' && (() => {
            const i = view.tabs.findIndex((x) => x.id === menu.tabId)
            const tab = view.tabs[i]
            if (!tab) return null
            const act = (fn) => () => { setMenu(null); fn() }
            return (
              <>
                <li role='menuitem' onClick={act(() => setRenaming({ id: tab.id, value: tab.name }))}>Rename</li>
                <li role='menuitem' onClick={act(async () => { const r = await run('sheet:duplicateTab', { tabId: tab.id }); if (r) { setTabId(r.tabId); select(1, 1) } })}>Duplicate</li>
                {i > 0 && <li role='menuitem' onClick={act(() => run('sheet:moveTab', { tabId: tab.id, to: i - 1 }))}>Move left</li>}
                {i < view.tabs.length - 1 && <li role='menuitem' onClick={act(() => run('sheet:moveTab', { tabId: tab.id, to: i + 1 }))}>Move right</li>}
                {view.tabs.length > 1 && <li role='menuitem' className='danger' onClick={act(() => setDroppingTab(tab))}>Delete tab</li>}
              </>
            )
          })()}
          {menu.kind === 'cell' && (
            <>
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); menuCopy(true).catch((err) => onError(err.message)) }}>Cut</li>}
              <li role='menuitem' onClick={() => { setMenu(null); menuCopy(false).catch((err) => onError(err.message)) }}>Copy</li>
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); menuPaste(null).catch((err) => onError(err.message)) }}>Paste</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); menuPaste('values').catch((err) => onError(err.message)) }}>Paste values only</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); menuPaste('transpose').catch((err) => onError(err.message)) }}>Paste transposed</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); quickSort(false) }}>Sort A to Z</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); quickSort(true) }}>Sort Z to A</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); openSort() }}>Sort...</li>}
              {canEdit && <li role='menuitem' className='danger' onClick={() => { setMenu(null); run('sheet:clearRange', range) }}>Clear contents</li>}
            </>
          )}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' onClick={() => lineAction('before')}>Insert {menu.kind === 'row' ? 'row above' : 'column left'}</li>}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' onClick={() => lineAction('after')}>Insert {menu.kind === 'row' ? 'row below' : 'column right'}</li>}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' className='danger' onClick={() => lineAction('delete')}>Delete {menu.kind === 'row' ? 'row ' + menu.index : 'column ' + colName(menu.index)}</li>}
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
              onContextMenu={(e) => { e.preventDefault(); if (canEdit) setMenu({ kind: 'tab', tabId: t.id, x: e.clientX, y: e.clientY }) }}
            >
              {t.name}
            </button>
            ))}
        {canEdit && <button className='tab add' title='Add tab' aria-label='Add tab' onClick={async () => { const r = await run('sheet:addTab', {}); if (r) setTabId(r.tabId) }}><Plus size={16} /></button>}
              {totals && (
          <span className='totals' aria-live='polite'>
            {totals.average !== null && <span>Sum <b>{shortNumber(totals.sum)}</b></span>}
            {totals.average !== null && <span className='wide'>Average <b>{shortNumber(totals.average)}</b></span>}
            <span>Count <b>{totals.count}</b></span>
          </span>
        )}
      </footer>
    </div>
  )
}
