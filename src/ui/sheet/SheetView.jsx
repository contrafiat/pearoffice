import React, { useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState } from 'react'
import { call, on } from '../bridge.js'
import { Grid, MIN_ZOOM, MAX_ZOOM } from './Grid.jsx'
import { colName } from './a1.js'
import { changeDecimals, jumpTarget, todaySerial } from './cellTools.js'
import { SIZES, DEFAULT_SIZE, borderCss, fitWidth } from './cellStyle.js'
import { shiftA1 } from '../../sheet/refs.js'
import { colourFor } from '../Avatar.jsx'
import { FileBar, useMembers } from '../FileBar.jsx'
import { FindPanel } from './FindPanel.jsx'
import { SortPanel } from './SortPanel.jsx'
import { FilterPanel } from './FilterPanel.jsx'
import { CommentPanel, CommentsList } from './CommentPanel.jsx'
import { ValidationPanel } from './ValidationPanel.jsx'
import { CondFormatPanel } from './CondFormatPanel.jsx'
import { NamesPanel } from './NamesPanel.jsx'
import { LinkBar, LinkCard, linkOf, linkLabel, ownLink, fileLink, folderLink } from './links.jsx'
import { untitled } from '../Files.jsx'
import { AtMenu, atItems, smartChip } from './chips.jsx'
import { parseRange } from '../../sheet/charts.js'
import { evaluate as evaluateColours } from '../../sheet/condFormat.js'
import { typed, allows, explain, ruleFor, chipColor, chipsOf, choicesOf, joinChoices } from '../../sheet/validation.js'
import { filterRows, columnValues, isActive } from '../../sheet/filter.js'
import { ChartPanel } from './ChartPanel.jsx'
import { ChartView, downloadChart, chartSvg } from './Chart.jsx'
import { guessChart } from '../../sheet/charts.js'
import { readPref, writePref } from '../prefs.js'
import { Minus, ArrowCounterClockwise, ArrowClockwise, TextB, TextItalic, TextAUnderline, PaintBucket, Copy, Scissors, ClipboardText, Eraser, Numpad, FileXls, Plus, MagnifyingGlass, X, ChartBar, PencilSimple, DownloadSimple, Trash, TextUnderline, TextStrikethrough, TextAlignLeft, TextAlignCenter, TextAlignRight, ArrowUDownLeft, FrameCorners, AlignTop, AlignCenterVertical, AlignBottom, ArrowsOutLineHorizontal, LinkSimple, Check } from '@phosphor-icons/react'
import { FormulaHelp, helpFor, insertFunction, canPoint, refText } from './FormulaHelp.jsx'
import { exportSheet, exportOds, exportCsv, exportJson, printTab, isMobile } from './xlsx.js'
import { usePrintKey } from '../printKey.js'
import { useToolOverflow } from '../toolOverflow.jsx'

const COLOURS = ['#1f2420', '#b3261e', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#7e22ce']
const ZOOM_STEPS = [0.5, 0.67, 0.75, 0.8, 0.9, 1, 1.1, 1.25, 1.5, 1.75, 2, 2.5]
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
  if (b.kind === 'merge') return 'Merged cells at ' + at(b.at) + ' are in the way. Unmerge them to let it fill in.'
  if (b.kind === 'overlap') return 'The answer of the formula in ' + at(b.anchor) + ' already fills some of the cells this answer needs.'
  if (b.kind === 'edge') return 'The answer does not fit on this tab.'
  if (b.kind === 'size') return 'The answer is larger than 100,000 cells.'
  return 'The answer would cover a cell it depends on.'
}

export function SheetView ({ sheetId, files = [], folders = [], onOpenFile, onOpenFolder, onTitleChange, onError, onGone }) {
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
  const [borderLine, setBorderLine] = useState('thin') // style[:#colour] for the next borders
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
  // Formula help: where the caret is in the text being edited, the
  // highlighted suggestion, and whether Escape hid the list.
  const [caret, setCaret] = useState(null)
  const [helpSel, setHelpSel] = useState(0)
  const [helpOff, setHelpOff] = useState(null) // the partial name Escape hid
  const [atSel, setAtSel] = useState(0) // the highlighted item in the @ menu
  const [atOff, setAtOff] = useState(false) // Escape hid the @ menu
  const dateInput = useRef(null) // the hidden date field the calendar button opens
  const nextCaret = useRef(null)
  const pointRef = useRef(null) // { start, end, anchor, to }: see point()
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
  const [zoom, setZoomState] = useState(() => Number(readPref('pearoffice:zoom')) || 1)
  const [numPad, setNumPadState] = useState(() => readPref('pearoffice:numpad') === '1')
  const setZoom = (z) => { setZoomState(z); writePref('pearoffice:zoom', String(Math.round(z * 100) / 100)) }
  const setNumPad = (on) => { setNumPadState(on); writePref('pearoffice:numpad', on ? '1' : '0') }
  // The zoom buttons and Ctrl +, - and 0 step through these.
  const zoomStep = (dir) => {
    const z = dir > 0 ? ZOOM_STEPS.find((x) => x > zoom + 0.001) : [...ZOOM_STEPS].reverse().find((x) => x < zoom - 0.001)
    if (z) setZoom(Math.min(MAX_ZOOM, Math.max(MIN_ZOOM, z)))
  }
  const zoomKeys = useRef(null)
  zoomKeys.current = (e) => {
    if (!(e.ctrlKey || e.metaKey) || e.altKey) return
    if (e.key === '=' || e.key === '+') zoomStep(1)
    else if (e.key === '-' || e.key === '_') zoomStep(-1)
    else if (e.key === '0') setZoom(1)
    else return
    e.preventDefault()
  }
  useEffect(() => {
    const keys = (e) => zoomKeys.current(e)
    window.addEventListener('keydown', keys, true)
    return () => window.removeEventListener('keydown', keys, true)
  }, [])
  // Changed in Settings while this sheet is open.
  useEffect(() => {
    const onPref = (e) => { if (e.detail && e.detail.key === 'pearoffice:numpad') setNumPadState(e.detail.value === '1') }
    window.addEventListener('pearoffice:pref', onPref)
    return () => window.removeEventListener('pearoffice:pref', onPref)
  }, [])
  const [finding, setFinding] = useState(null) // { replace } while Find is open
  const [sorting, setSorting] = useState(null) // what the Sort panel sorts
  const [droppingTab, setDroppingTab] = useState(null) // a tab waiting for "Delete"
  const [confirmMerge, setConfirmMerge] = useState(null) // a range whose merge would clear cells
  const [filtering, setFiltering] = useState(null) // the column whose filter panel is open
  const [commenting, setCommenting] = useState(null) // { row, col } whose thread is open
  const [listingComments, setListingComments] = useState(false)
  const [validating, setValidating] = useState(null) // the range whose rules are being set
  const [badEntry, setBadEntry] = useState(null) // { row, col, value, move, rule } refused or warned
  const [picking, setPicking] = useState(null) // { row, col, x, y } list dropdown open
  const [colouring, setColouring] = useState(false) // the conditional formatting panel
  const [naming, setNaming] = useState(null) // { adding } while the names panel is open
  const [goingTo, setGoingTo] = useState(null) // text typed in the name box
  const [linking, setLinking] = useState(null) // { initial, hasLink } while the link bar is open
  // A menu opened near an edge (a long press on a phone) moves to fit on screen.
  const menuRef = useRef(null)
  // The tab strip scrolls sideways when tabs do not fit; keep the open one in view.
  const tabStrip = useRef(null)
  useEffect(() => {
    const el = tabStrip.current && tabStrip.current.querySelector('.tab.active')
    if (el) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [view && view.tabId, view && view.tabs.length])
  useLayoutEffect(() => {
    const el = menuRef.current
    if (!el) return
    const r = el.getBoundingClientRect()
    const vw = window.innerWidth
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
    if (r.right > vw - 4) el.style.left = Math.max(4, vw - r.width - 4) + 'px'
    if (r.bottom > vh - 4 && !el.style.bottom) el.style.top = Math.max(4, vh - r.height - 4) + 'px'
  }, [menu])
  const [selectedChart, setSelectedChart] = useState(null) // chart id (desktop)
  const [editingChart, setEditingChart] = useState(null) // chart id in the editor
  const [viewingChart, setViewingChart] = useState(null) // chart id full screen (phones)
  const gridRef = useRef(null)

  // Everyone in the sheet, for the pictures next to Share.
  const members = useMembers(sheetId)

  // Who else has this sheet open, and where (proposals/2026-10-05-presence.md).
  // This device says where it is while the sheet is on screen, unless
  // Settings turned that off; then it sees nobody either.
  const [present, setPresent] = useState([])
  const [sharePresence, setSharePresence] = useState(() => readPref('pearoffice:presence') !== '0')
  const [onScreen, setOnScreen] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const vis = () => setOnScreen(document.visibilityState !== 'hidden')
    const pref = (e) => { if (e.detail && e.detail.key === 'pearoffice:presence') setSharePresence(e.detail.value !== '0') }
    document.addEventListener('visibilitychange', vis)
    window.addEventListener('pearoffice:pref', pref)
    return () => { document.removeEventListener('visibilitychange', vis); window.removeEventListener('pearoffice:pref', pref) }
  }, [])
  // On screen: the worklet looks again for the sheet's other devices while
  // nobody is connected (src/worklet/rediscover.js), whatever the presence setting.
  useEffect(() => {
    call('sheet:visible', { sheetId, visible: onScreen }).catch(() => {})
    return () => { call('sheet:visible', { sheetId, visible: false }).catch(() => {}) }
  }, [sheetId, onScreen])
  useEffect(() => {
    setPresent([])
    call('sheet:present', { sheetId }).then((d) => setPresent(d.people)).catch(() => {})
    const off = on('sheet:presence', (d) => { if (d.sheetId === sheetId) setPresent(d.people) })
    return () => { off(); call('sheet:presence', { sheetId, open: false }).catch(() => {}) }
  }, [sheetId])

  const goneRef = useRef(onGone)
  goneRef.current = onGone
  const load = useCallback(async () => {
    try {
      const v = await call('sheet:view', { sheetId, tabId })
      setView(v)
      if (!tabId) setTabId(v.tabId)
    } catch (err) {
      // The sheet left this device (removed, deleted, moved): go back.
      if (/^unknown file/.test(err.message)) { goneRef.current(); return }
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
  const canEdit = hasEditRole && view.writable && !view.newer

  const cells = useMemo(() => {
    const m = new Map()
    if (view) for (const c of view.cells) m.set(c.row + ',' + c.col, c)
    return m
  }, [view])

  // Filters (proposals/2026-10-04-freeze-filter.md) are this device's own,
  // kept in its storage per sheet and tab, never in the sheet.
  const viewTab = view && view.tabId
  const isEditing = !!editing
  useEffect(() => {
    const open = sharePresence && onScreen && !!viewTab
    call('sheet:presence', { sheetId, open, tab: viewTab, row: sel.row, col: sel.col, editing: isEditing }).catch(() => {})
  }, [sheetId, sharePresence, onScreen, viewTab, sel.row, sel.col, isEditing])
  const nameOf = (identity) => {
    const m = members.find((x) => x.identity === identity)
    return !m ? 'Someone' : m.isMe ? 'You (other device)' : m.name || 'Unnamed'
  }
  const others = present
    .filter((p) => p.tab === viewTab && p.row && p.col)
    .map((p) => ({ key: p.device, row: p.row, col: p.col, editing: p.editing, colour: colourFor(p.identity), label: nameOf(p.identity) }))
  // identity -> where they are, for the pictures by Share.
  const presentWhere = new Map()
  for (const p of present) {
    const tab = view && p.tab !== viewTab && view.tabs.find((t) => t.id === p.tab)
    presentWhere.set(p.identity, tab ? 'on ' + tab.name : 'here')
  }
  const filterKey = 'pearoffice:filter:' + sheetId + ':' + viewTab
  const [filter, setFilterState] = useState(null)
  useEffect(() => {
    if (!viewTab) return
    let f = null
    try { f = JSON.parse(readPref(filterKey) || 'null') } catch {}
    setFilterState(f && f.r1 > 0 && f.c1 > 0 && f.c2 >= f.c1 ? f : null)
  }, [filterKey, viewTab])
  const setFilter = (f) => { setFilterState(f); writePref(filterKey, f ? JSON.stringify(f) : '') }
  const filtered = useMemo(() => (filter && view ? filterRows(cells, filter, view.rows) : null), [filter, cells, view])
  // Rows and columns hidden for everyone (proposals/2026-10-04-sheet-tools.md);
  // rows this device's filter hides join them for drawing and moving.
  const manual = useMemo(() => ({ rows: new Set((view && view.hidden && view.hidden.rows) || []), cols: new Set((view && view.hidden && view.hidden.cols) || []) }), [view])
  const hidden = useMemo(() => {
    if (!(filtered && filtered.hidden.size) && !manual.rows.size) return null
    const set = new Set(manual.rows)
    if (filtered) for (const r of filtered.hidden) set.add(r)
    return set
  }, [filtered, manual])
  const hiddenCols = manual.cols.size ? manual.cols : null
  const isHidden = (r) => !!(hidden && hidden.has(r))
  const isHiddenCol = (c) => manual.cols.has(c)
  // Where a mark shows hidden rows or columns again: the next row or column
  // that is showing (rows a filter hides are skipped too) -> the last hidden
  // one before it.
  const unhideMarks = useMemo(() => {
    if (!manual.rows.size && !manual.cols.size) return null
    const marks = (set, gone, max) => {
      const out = new Map()
      for (const n of set) {
        let next = n + 1
        while (next <= max && gone(next)) next++
        if (next <= max && !(out.get(next) > n)) out.set(next, n)
      }
      return out
    }
    return { rows: marks(manual.rows, (r) => !!(hidden && hidden.has(r)), view.rows), cols: marks(manual.cols, (c) => manual.cols.has(c), view.cols) }
  }, [manual, hidden, view])
  const filterHead = useMemo(() => {
    if (!filter) return null
    const active = new Set()
    for (let c = filter.c1; c <= filter.c2; c++) if (isActive(filter, c)) active.add(c)
    return { row: filter.r1, c1: filter.c1, c2: filter.c2, active }
  }, [filter])

  // Comments (proposals/2026-10-04-sheet-tools.md): each cell's thread.
  const threads = (view && view.comments) || []
  const threadAt = useMemo(() => new Map(threads.map((t) => [t.row + ',' + t.col, t])), [threads])
  const openThreads = threads.filter((t) => !t.resolved).length
  const commentAct = (what, args) => run('sheet:' + what, { ...args, ...(what === 'addComment' && commenting ? { row: commenting.row, col: commenting.col } : {}) })

  // Data validation (proposals/2026-10-04-sheet-tools.md).
  const validations = (view && view.validations) || []
  const invalidCells = useMemo(() => (view && view.invalid && view.invalid.length ? new Set(view.invalid.map(([r, c]) => r + ',' + c)) : null), [view])
  const selRule = ruleFor(validations, sel.row, sel.col)
  // Coloured chips (proposals/2026-10-22-dropdown-chips.md): 'row,col' ->
  // [{ text, color }], one pill per choice.
  const chipCells = useMemo(() => {
    if (!validations.some((r) => r.chips)) return null
    const out = new Map()
    for (const [key, cell] of cells) {
      const [row, col] = key.split(',').map(Number)
      const chips = chipsOf(ruleFor(validations, row, col), cell)
      if (chips) out.set(key, chips)
    }
    return out
  }, [validations, cells])
  const smartChips = useMemo(() => {
    const out = new Map()
    for (const [key, cell] of cells) { const c = smartChip(cell, { members, files }); if (c) out.set(key, c) }
    return out.size ? out : null
  }, [cells, members, files])
  // Conditional formatting: worked out here from the merged values.
  const cfStyles = useMemo(() => (view && view.condFormats && view.condFormats.length ? evaluateColours(view.condFormats, cells, todaySerial(), view.cfMatches || {}) : null), [view, cells])

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

  // Links (proposals/2026-10-18-sheet-links.md). A web link opens in the
  // browser; one inside the file selects its cell or block, or the tab's
  // first cell.
  // A link to another file or a folder (proposals/2026-10-22-links-to-files.md)
  // gets its name here, or `missing` when this person does not have it. A
  // file that moved to fresh keys is found through file:follow.
  const [followed, setFollowed] = useState({}) // a file's old id -> its id now, or null
  const usable = files.filter((f) => !f.removed && !f.waiting)
  function placeOf (l, moved = followed) {
    if (!l || !(l.file || l.folder)) return l
    if (l.folder) {
      const d = folders.find((x) => x.id === l.folder)
      return d ? { ...l, name: d.name } : { ...l, missing: 'This folder is not one of yours, or it was deleted.' }
    }
    const f = usable.find((x) => x.sheetId === l.file) || usable.find((x) => x.sheetId === moved[l.file])
    return f ? { ...l, at: f.sheetId, name: f.title || untitled(f.kind) } : { ...l, missing: "You don't have this file. Ask someone who has it to share it with you." }
  }
  async function follow (id) {
    if (id in followed || usable.some((x) => x.sheetId === id)) return followed
    const r = await call('file:follow', { sheetId: id }).catch(() => null)
    const next = { ...followed, [id]: (r && r.sheetId) || null }
    setFollowed(next)
    return next
  }
  const selLink = placeOf(linkOf(selected))
  const selFile = selLink && selLink.file
  useEffect(() => { if (selFile) follow(selFile) }, [selFile]) // eslint-disable-line react-hooks/exhaustive-deps
  async function openLink (row, col) {
    let l = linkOf(cells.get(row + ',' + col))
    if (!l || l.gone) return
    if (l.url) { call('app:openUrl', { url: l.url }).catch(() => {}); return }
    if (l.folder) { if (!placeOf(l).missing && onOpenFolder) onOpenFolder(l.folder); return }
    if (l.file) {
      l = placeOf(l, await follow(l.file))
      if (!l.missing && onOpenFile) onOpenFile(l.at)
      return
    }
    if (l.to.tabId !== view.tabId) setTabId(l.to.tabId)
    setSel({ row: l.to.row || 1, col: l.to.col || 1 })
    setExt({ row: l.to.row2 || l.to.row || 1, col: l.to.col2 || l.to.col || 1 })
  }
  function startLink () {
    if (!canEdit) return
    const own = ownLink(selLink)
    const pear = own && (selLink.file || selLink.folder) && !selLink.missing
    setLinking({ initial: own && !selLink.missing ? linkLabel(selLink) : '', initialPick: pear ? { text: linkLabel(selLink), link: selLink.file ? fileLink(selLink.at) : folderLink(selLink.folder) } : null, hasLink: own })
  }
  async function applyLink (link, text) {
    const box = { ...range }
    setLinking(null)
    afterPanel()
    // On an empty cell the link is also its text.
    if (box.r1 === box.r2 && box.c1 === box.c2 && !(selected && selected.input)) await run('sheet:setCell', { row: box.r1, col: box.c1, input: typeof link === 'string' && !link.startsWith('pearoffice://') ? link : text })
    await run('sheet:setLink', { ...box, link })
  }
  function removeLink () {
    setLinking(null)
    afterPanel()
    run('sheet:setLink', { ...range, link: null })
  }
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
    // A typed value (not a formula) a validation rule does not allow.
    const rule = value[0] !== '=' && ruleFor(validations, row, col)
    if (rule && !allows(rule, typed(value))) { setBadEntry({ row, col, value, move, rule }); return }
    await writeEntry(row, col, value, move)
  }

  async function writeEntry (row, col, value, move) {
    const before = cells.get(row + ',' + col)
    if ((before ? before.input : '') !== value) {
      // Typing over a person or date chip makes it plain text again.
      const f = (before && before.fmt) || {}
      if (f.person || f.datechip) run('sheet:setFormat', { row, col, patch: { person: null, datechip: null } })
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

  // Merged cells (proposals/2026-10-04-cell-formats.md).
  const merges = (view && view.merges) || []
  const mergeAt = (row, col) => merges.find((m) => row >= m.r1 && row <= m.r2 && col >= m.c1 && col <= m.c2)
  // The selection, grown to cover every merge it touches.
  const range = (() => {
    const box = { r1: Math.min(sel.row, ext.row), c1: Math.min(sel.col, ext.col), r2: Math.max(sel.row, ext.row), c2: Math.max(sel.col, ext.col) }
    for (let grew = true; grew;) {
      grew = false
      for (const m of merges) {
        if (m.r1 > box.r2 || m.r2 < box.r1 || m.c1 > box.c2 || m.c2 < box.c1) continue
        if (m.r1 < box.r1) { box.r1 = m.r1; grew = true }
        if (m.c1 < box.c1) { box.c1 = m.c1; grew = true }
        if (m.r2 > box.r2) { box.r2 = m.r2; grew = true }
        if (m.c2 > box.c2) { box.c2 = m.c2; grew = true }
      }
    }
    return box
  })()
  const mergeSelected = merges.find((m) => m.r1 === range.r1 && m.c1 === range.c1 && m.r2 === range.r2 && m.c2 === range.c2)

  // Select a cell; with extend, move the far corner of the range instead.
  function select (row, col, extend = false) {
    // Into a merge: select it from its top-left cell.
    const m = !extend && mergeAt(row, col)
    if (m) { setSel({ row: m.r1, col: m.c1 }); setExt({ row: m.r1, col: m.c1 }); return }
    if (!extend) setSel({ row, col })
    setExt({ row, col })
  }

  function moveBy (dr, dc, extend = false) {
    if (!view) return
    let from = extend ? ext : sel
    // Out of a merge: step from its far edge.
    const m = mergeAt(from.row, from.col)
    if (m) from = { row: dr > 0 ? m.r2 : dr < 0 ? m.r1 : from.row, col: dc > 0 ? m.c2 : dc < 0 ? m.c1 : from.col }
    let row = Math.max(1, Math.min(view.rows, from.row + dr))
    let col = Math.max(1, Math.min(view.cols, from.col + dc))
    while (dc && isHiddenCol(col) && col + Math.sign(dc) >= 1 && col + Math.sign(dc) <= view.cols) col += Math.sign(dc)
    if (isHiddenCol(col)) col = from.col
    // Over rows the filter hides.
    while (dr && isHidden(row) && row + Math.sign(dr) >= 1 && row + Math.sign(dr) <= view.rows) row += Math.sign(dr)
    if (isHidden(row)) row = from.row
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
      if (isHidden(r)) continue // copy takes only the rows a filter shows
      const line = []
      for (let c = range.c1; c <= range.c2; c++) if (!isHiddenCol(c)) line.push(pick(cells.get(r + ',' + c) || null))
      out.push(line)
    }
    return out
  }

  // The selection as clipboard text; remembers the inputs so a paste back
  // into PearOffice keeps formulas.
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
    // From inside PearOffice: paste what was typed, moving relative references
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
    // Rows a filter hides are skipped: line r goes to the r-th shown row.
    const targets = []
    for (let t = range.r1; targets.length < h; t++) if (!isHidden(t)) targets.push(t)
    const at = (r, c, input) => {
      if (!ours || mode === 'values' || typeof input !== 'string' || input[0] !== '=') return input
      // Transposed, the cell at (r, c) came from (c, r).
      const dr = range.r1 - ours.row + (single ? r : 0) + (mode === 'transpose' ? r - c : 0) + (targets[r] - range.r1 - r)
      const dc = range.c1 - ours.col + (single ? c : 0) + (mode === 'transpose' ? c - r : 0)
      return '=' + shiftA1(input.slice(1), dr, dc)
    }
    const grid = source.slice(0, targets.length).map((line, r) => line.map((input, c) => at(r, c, input)))
    if (targets.length === h && targets[h - 1] === range.r1 + h - 1) run('sheet:setCells', { row: range.r1, col: range.c1, grid })
    else grid.forEach((line, r) => run('sheet:setCells', { row: targets[r], col: range.c1, grid: [line] }))
    setSel({ row: range.r1, col: range.c1 })
    setExt({ row: targets[targets.length - 1] || range.r1, col: range.c1 + w - 1 })
  }

  // Fill n cells past the selection (the fill handle), then select it all.
  async function fillFrom (dir, n, src = range, mode = 'series') {
    await run('sheet:fill', { ...src, dir, n, mode, skipRows: hidden && (dir === 'down' || dir === 'up') ? [...hidden] : undefined })
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

  // --- charts (proposals/2026-10-04-charts.md) ---------------------------
  const chartById = (id) => (view.charts || []).find((c) => c.id === id)
  const rangeText = (box) => colName(box.c1) + box.r1 + (box.r1 === box.r2 && box.c1 === box.c2 ? '' : ':' + colName(box.c2) + box.r2)

  // A chart of the selection (or the data around the cell), to the right of it.
  async function insertChart () {
    const box = sortBox()
    const block = []
    for (let r = box.r1; r <= box.r2; r++) {
      const line = []
      for (let c = box.c1; c <= box.c2; c++) { const x = cells.get(r + ',' + c); line.push({ num: x && x.num !== undefined ? x.num : null, text: x ? x.display : '' }) }
      block.push(line)
    }
    const guess = guessChart(block)
    // Desktop: beside the data. Phones: below it, as wide as the screen.
    const place = phone
      ? { anchor: { row: Math.min(view.rows, box.r2 + 2), col: 1 }, size: { w: Math.max(240, Math.min(480, window.innerWidth / zoom - 70)), h: 260 } }
      : { anchor: { row: box.r1, col: Math.min(view.cols, box.c2 + 2) } }
    const r = await run('sheet:addChart', { spec: { ...guess, data: rangeText(box), ...place } })
    if (r) { setSelectedChart(r.chartId); setEditingChart(r.chartId) }
  }

  // The tab's charts as SVG for PDF and print, in light colours on white.
  const PAPER = { ink: '#1f2420', muted: '#6b716b', line: '#e2e3dd', lineStrong: '#c9cbc2', panel: '#ffffff' }
  const printCharts = () => (view.charts || []).map((c) => chartSvg(c, c.size.w, c.size.h, PAPER)).filter(Boolean)
  const toolRow = useToolOverflow(!phone)
  usePrintKey(() => printTab(view, 'print', printCharts()).catch((err) => onError(err.message)))

  // Freeze panes (proposals/2026-10-04-freeze-filter.md), shared by everyone.
  const frozen = (view && view.freeze) || { rows: 0, cols: 0 }
  const freezeItems = (close) => canEdit && (
    <>
      <li role='menuitem' onClick={() => { close(); run('sheet:setFreeze', { rows: 1, cols: frozen.cols }) }}>Freeze top row</li>
      <li role='menuitem' onClick={() => { close(); run('sheet:setFreeze', { rows: frozen.rows, cols: 1 }) }}>Freeze first column</li>
      {(sel.row > 1 || sel.col > 1) && <li role='menuitem' onClick={() => { close(); run('sheet:setFreeze', { rows: sel.row - 1, cols: sel.col - 1 }) }}>Freeze above and left of {colName(sel.col) + sel.row}</li>}
      {(frozen.rows > 0 || frozen.cols > 0) && <li role='menuitem' onClick={() => { close(); run('sheet:setFreeze', { rows: 0, cols: 0 }) }}>Unfreeze</li>}
    </>
  )

  // Filter the table around the selection (its first row is the header),
  // or turn the filter off.
  function startFilter () {
    const box = sortBox()
    setFilter({ r1: box.r1, c1: box.c1, c2: box.c2, cols: {} })
  }
  const filterItems = (close) => (
    filter
      ? <li role='menuitem' onClick={() => { close(); setFilter(null) }}>Turn off filter</li>
      : <li role='menuitem' onClick={() => { close(); startFilter() }}>Filter</li>
  )
  function setColumnRule (col, rule) {
    const cols = { ...filter.cols }
    if (rule) cols[col] = rule
    else delete cols[col]
    setFilter({ ...filter, cols })
  }

  // Go to a named range or a cell or range typed in the name box.
  function goTo (text) {
    const t = String(text || '').trim()
    if (!t) return
    const n = ((view && view.names) || []).find((x) => x.name.toUpperCase() === t.toUpperCase())
    if (n) {
      if (n.range === '#REF!') { onError('The cells of ' + n.name + ' were deleted'); return }
      if (n.tabId !== view.tabId) setTabId(n.tabId)
      setSel({ row: n.r1, col: n.c1 })
      setExt({ row: n.r2, col: n.c2 })
      return
    }
    const box = parseRange(t)
    if (!box || box.spill) { onError('There is no cell or named range called ' + t); return }
    if (box.sheet) {
      const tab = view.tabs.find((x) => x.name.toUpperCase() === box.sheet.toUpperCase())
      if (!tab) { onError('There is no tab called ' + box.sheet); return }
      if (tab.id !== view.tabId) setTabId(tab.id)
    }
    setSel({ row: Math.min(box.r1, view.rows), col: Math.min(box.c1, view.cols) })
    setExt({ row: Math.min(box.r2, view.rows), col: Math.min(box.c2, view.cols) })
  }

  const chartActions = {
    canEdit,
    select: (id) => setSelectedChart(id),
    open: (id) => setViewingChart(id),
    edit: (id) => { setViewingChart(null); setEditingChart(id) },
    change: (id, patch) => run('sheet:setChart', { chartId: id, patch }),
    download: (id, kind) => { const c = chartById(id); if (c) downloadChart(c, kind).catch((err) => onError(err.message)) },
    remove: (id) => { setSelectedChart(null); setEditingChart(null); setViewingChart(null); run('sheet:deleteChart', { chartId: id }) }
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
    if (merges.some((m) => m.r1 <= box.r2 && m.r2 >= box.r1 && m.c1 <= box.c2 && m.c2 >= box.c1)) {
      onError('Sorting cannot move merged cells. Unmerge them first.')
      return
    }
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
    if (selectedChart && chartById(selectedChart)) {
      if (e.key === 'Escape') { e.preventDefault(); setSelectedChart(null); return }
      if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) { e.preventDefault(); chartActions.remove(selectedChart); return }
    }
    if ((e.ctrlKey || e.metaKey) && (e.key === 'f' || e.key === 'F' || e.key === 'h' || e.key === 'H')) {
      e.preventDefault()
      setFinding({ replace: canEdit && (e.key === 'h' || e.key === 'H') })
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.altKey && (e.key === 'm' || e.key === 'M' || e.code === 'KeyM')) {
      e.preventDefault()
      if (canEdit || threadAt.has(sel.row + ',' + sel.col)) setCommenting({ row: sel.row, col: sel.col })
      return
    }
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && (e.key === 'l' || e.key === 'L')) {
      e.preventDefault()
      if (filter) setFilter(null); else startFilter()
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
    if (mod && (k === 'u' || k === 'U')) { e.preventDefault(); toggle('u'); return }
    if (mod && k === '5') { e.preventDefault(); toggle('s'); return }
    if (mod && (k === 'k' || k === 'K')) { e.preventDefault(); startLink(); return }
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
      if (x.row < range.r1 || x.row > range.r2 || x.col < range.c1 || x.col > range.c2 || x.display === '' || isHidden(x.row)) continue
      count++
      if (x.num !== undefined) { sum += x.num; numbers++ }
    }
    return { sum, average: numbers ? sum / numbers : null, count }
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [cells, range.r1, range.r2, range.c1, range.c2, hidden])
  const shortNumber = (n) => String(Number(n.toPrecision(12)))

  const editValue = editing ? editing.value : null
  const caretAt = caret === null || editValue === null ? (editValue || '').length : Math.min(caret, editValue.length)
  const nameHelp = useMemo(() => ((view && view.names) || []).filter((n) => n.range !== '#REF!').map((n) => ({ name: n.name, about: 'Named range, ' + (n.tabId === view.tabId ? '' : n.tab + '!') + n.range })), [view])
  const help = editing && canEdit ? helpFor(editValue, caretAt, nameHelp) : null
  const shownHelp = help && help.list && helpOff === help.partial ? null : help
  useEffect(() => { setHelpSel(0) }, [help && help.partial])
  useEffect(() => { if (!editing) { setCaret(null); setHelpOff(null); setAtOff(false); pointRef.current = null } }, [!!editing])
  // @ chips (proposals/2026-10-23-multi-select-and-smart-chips.md): typing @
  // first in a cell offers people, files, folders and dates.
  const atQuery = editing && canEdit && typeof editValue === 'string' && editValue[0] === '@' && !atOff ? editValue.slice(1) : null
  const atList = useMemo(() => (atQuery === null ? [] : atItems(atQuery, { members, files: usable.filter((f) => f.sheetId !== sheetId), folders })), [atQuery, members, files, folders]) // eslint-disable-line react-hooks/exhaustive-deps
  useEffect(() => { setAtSel(0) }, [atQuery])
  async function pickAt (it) {
    const ed = editingRef.current
    if (!ed) return
    const { row, col } = ed
    setEditing(null)
    const was = (cells.get(row + ',' + col) || {}).fmt || {}
    const plain = { person: null, datechip: null, link: null }
    const text = (t) => (/^[='"@+-]/.test(t) || /^[\d.]+$/.test(t) ? "'" + t : t)
    if (it.kind === 'person') {
      await run('sheet:setCell', { row, col, input: text(it.label) })
      await run('sheet:setFormat', { row, col, patch: { ...plain, person: it.member.identity } })
    } else if (it.kind === 'file' || it.kind === 'folder') {
      await run('sheet:setCell', { row, col, input: text(it.label) })
      await run('sheet:setFormat', { row, col, patch: { ...plain, link: it.kind === 'file' ? fileLink(it.file.sheetId) : folderLink(it.folder.id) } })
    } else {
      const num = was.num && /[dmy]/i.test(was.num) ? was.num : 'd mmm yyyy'
      await run('sheet:setCell', { row, col, input: String(todaySerial() + (it.days || 0)) })
      await run('sheet:setFormat', { row, col, patch: { ...plain, datechip: true, num } })
      if (it.pick) pickDate(row, col)
    }
    focusGrid()
  }
  // The calendar button on a date chip: the system date picker, then the
  // date as a serial, keeping the chip.
  function pickDate (row, col) {
    const el = dateInput.current
    if (!el) return
    const cell = cells.get(row + ',' + col)
    const serial = cell && typeof cell.num === 'number' ? cell.num : todaySerial()
    el.value = new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10)
    el.dataset.at = row + ',' + col
    try { el.showPicker() } catch { el.click() }
  }
  function datePicked (e) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(e.target.value || '')
    const [row, col] = String(e.target.dataset.at || '').split(',').map(Number)
    if (!m || !row) return
    const serial = Math.round((Date.UTC(+m[1], +m[2] - 1, +m[3]) - Date.UTC(1899, 11, 30)) / 86400000)
    run('sheet:setCell', { row, col, input: String(serial) })
  }
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
    const item = help.list.find((f) => f.name === name)
    const r = insertFunction(editValue, caretAt, help.partial, name, !!(item && item.isName))
    nextCaret.current = r.caret
    setEditing((ed) => ({ ...ed, value: r.value }))
  }

  // Pointing, as in Excel: while a formula is typed, a clicked, dragged or
  // tapped cell puts its address in at the caret. pointRef is the address
  // put in last (where it sits in the text and the cells it names), so a
  // drag, another click or an arrow key replaces it.
  function pointCaret () {
    const el = document.activeElement
    return el && el.tagName === 'INPUT' && typeof el.selectionStart === 'number' ? el.selectionStart : caretAt
  }
  // True if the cell went into the formula; false leaves the click to select.
  function point (row, col, extend = false) {
    const ed = editingRef.current
    if (!ed || !canEdit) return false
    const at = pointCaret()
    const p = pointRef.current && pointRef.current.end === at ? pointRef.current : null
    if (!p && !canPoint(ed.value, at)) return false
    const start = p ? p.start : at
    const end = p ? p.end : at
    const anchor = p && extend ? p.anchor : { row, col }
    const text = refText(anchor, { row, col })
    pointRef.current = { start, end: start + text.length, anchor, to: { row, col } }
    nextCaret.current = start + text.length
    setEditing({ ...ed, value: ed.value.slice(0, start) + text + ed.value.slice(end) })
    return true
  }
  const pointBox = editing && pointRef.current
    ? (({ anchor: a, to: b }) => ({ r1: Math.min(a.row, b.row), c1: Math.min(a.col, b.col), r2: Math.max(a.row, b.row), c2: Math.max(a.col, b.col) }))(pointRef.current)
    : null

  function onEditKey (e) {
    if (atList.length) {
      const n = atList.length
      if (e.key === 'ArrowDown') { e.preventDefault(); setAtSel((i) => (i + 1) % n); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setAtSel((i) => (i - 1 + n) % n); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickAt(atList[Math.min(atSel, n - 1)]); return }
      if (e.key === 'Escape') { e.preventDefault(); setAtOff(true); return }
    }
    if (shownHelp && shownHelp.list) {
      const n = shownHelp.list.length
      if (e.key === 'ArrowDown') { e.preventDefault(); setHelpSel((i) => (i + 1) % n); return }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHelpSel((i) => (i - 1 + n) % n); return }
      if (e.key === 'Tab' || e.key === 'Enter') { e.preventDefault(); pickFunction(shownHelp.list[Math.min(helpSel, n - 1)].name); return }
      if (e.key === 'Escape') { e.preventDefault(); setHelpOff(shownHelp.partial); return }
    }
    // Arrow keys point when the edit began by typing in the cell (Excel's
    // Enter mode); after F2, a double-click or in the bar they move the caret.
    const arrow = { ArrowUp: [-1, 0], ArrowDown: [1, 0], ArrowLeft: [0, -1], ArrowRight: [0, 1] }[e.key]
    const ed = editingRef.current
    if (arrow && view && ed && ed.source === 'grid' && !e.ctrlKey && !e.metaKey && !e.altKey) {
      const from = pointRef.current && pointRef.current.end === pointCaret() ? pointRef.current.to : ed
      const row = Math.max(1, Math.min(view.rows, from.row + arrow[0]))
      const col = Math.max(1, Math.min(view.cols, from.col + arrow[1]))
      if (point(row, col, e.shiftKey)) { e.preventDefault(); return }
    }
    if (e.key === 'Enter') { e.preventDefault(); commit([e.shiftKey ? -1 : 1, 0]) }
    else if (e.key === 'Tab') { e.preventDefault(); commit([0, e.shiftKey ? -1 : 1]) }
    else if (e.key === 'Escape') { e.preventDefault(); setEditing(null); focusGrid() }
  }

  // The rows or columns a header menu acts on: the selection when the
  // clicked header is in it, else that one.
  function headerSpan (kind, index) {
    const [a, b] = kind === 'row' ? [range.r1, range.r2] : [range.c1, range.c2]
    return index >= a && index <= b ? [a, b] : [index, index]
  }
  function setLinesHidden (kind, hide) {
    const [from, to] = headerSpan(kind, menu.index)
    setMenu(null)
    run('sheet:setHidden', { kind, from, to, hidden: hide })
    focusGrid()
  }
  function unhideRun (kind, last) {
    const set = kind === 'row' ? manual.rows : manual.cols
    // Back over every hidden row (or column) in the gap, filtered ones too.
    let first = last
    while (first > 1 && (set.has(first - 1) || (kind === 'row' && hidden && hidden.has(first - 1)))) first--
    run('sheet:setHidden', { kind, from: first, to: last, hidden: false })
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
    : view.frozen.tidied
      ? 'Updating this sheet...'
      : 'This sheet moved to new keys. Opening the new copy...')
  const note = frozenNote || (view.newer ? 'This sheet was made with a newer version of PearOffice. Update PearOffice to edit it.' : null)

  const fmt = (selected && selected.fmt) || {}
  const barValue = editing && editing.row === sel.row && editing.col === sel.col ? editing.value : spilled ? (anchor ? anchor.input : '') : (selected ? selected.input : '')

  return (
    <div className='sheet' onClick={() => { if (menu) setMenu(null); if (picking && !phone) setPicking(null) }}>
      <FileBar
        sheetId={sheetId}
        noun='sheet'
        title={view.title}
        myRole={view.myRole}
        frozen={view.frozen}
        canEdit={canEdit}
        badge={!canEdit && <span className='badge view-only'>{hasEditRole && !view.newer ? 'Getting edit access...' : 'View only'}</span>}
        phone={phone}
        members={members}
        present={presentWhere}
        onTitleChange={onTitleChange}
        onError={onError}
        onGone={onGone}
        menuItems={(close) => (
          <>
            <li role='menuitem' onClick={() => setFinding({ replace: canEdit })}>Find and replace</li>
            {window.pearoffice && <li role='menuitem' onClick={() => exportSheet(sheetId).catch((err) => onError(err.message))}>Save as an Excel file</li>}
            {window.pearoffice && <li role='menuitem' onClick={() => exportOds(sheetId).catch((err) => onError(err.message))}>Save as an OpenDocument file (.ods)</li>}
            <li role='menuitem' onClick={() => exportCsv(view).catch((err) => onError(err.message))}>Download this tab as CSV</li>
            <li role='menuitem' onClick={() => exportJson(sheetId).catch((err) => onError(err.message))}>Save as JSON</li>
            <li role='menuitem' onClick={() => printTab(view, 'pdf', printCharts()).catch((err) => onError(err.message))}>Save this tab as PDF</li>
            {!phone && <li role='menuitem' onClick={() => printTab(view, 'print', printCharts()).catch((err) => onError(err.message))}>Print this tab...</li>}
            {canEdit && <li role='menuitem' onClick={openSort}>Sort...</li>}
            {freezeItems(close)}
            {filterItems(close)}
            {canEdit && <li role='menuitem' onClick={() => setValidating({ ...range, dropdown: true })}>Dropdown...</li>}
            {canEdit && <li role='menuitem' onClick={() => setValidating({ ...range })}>Validation...</li>}
            {(canEdit || (view.condFormats || []).length > 0) && <li role='menuitem' onClick={() => setColouring(true)}>Conditional formatting...</li>}
            {(canEdit || (view.names || []).length > 0) && <li role='menuitem' onClick={() => setNaming({ adding: false })}>Named ranges...</li>}
            {threads.length > 0 && <li role='menuitem' onClick={() => setListingComments(true)}>Comments{openThreads ? ' (' + openThreads + ' open)' : ''}</li>}
            {canEdit && phone && <li role='menuitem' onClick={() => fillSelection('down')}>Fill down</li>}
            {canEdit && phone && <li role='menuitem' onClick={() => fillSelection('right')}>Fill right</li>}
          </>
        )}
      >
        <div ref={toolRow.ref} className={'tools' + (phone ? ' phone-row' : '')} role='toolbar' aria-label='Formatting' hidden={!canEdit}>
          <button title='Undo (Ctrl+Z)' aria-label='Undo' disabled={!view.canUndo} onClick={() => run('sheet:undo')}><ArrowCounterClockwise size={ICON} /></button>
          <button title='Redo (Ctrl+Y)' aria-label='Redo' disabled={!view.canRedo} onClick={() => run('sheet:redo')}><ArrowClockwise size={ICON} /></button>
          <span className='sep' />
          <button title='Bold (Ctrl+B)' aria-label='Bold' className={'fmt-b' + (fmt.b ? ' on' : '')} onClick={() => toggle('b')}><TextB size={ICON} weight='bold' /></button>
          <button title='Italic (Ctrl+I)' aria-label='Italic' className={'fmt-i' + (fmt.i ? ' on' : '')} onClick={() => toggle('i')}><TextItalic size={ICON} /></button>
          <button title='Underline (Ctrl+U)' aria-label='Underline' className={fmt.u ? 'on' : ''} onClick={() => toggle('u')}><TextUnderline size={ICON} /></button>
          <button title='Strikethrough (Ctrl+5)' aria-label='Strikethrough' className={fmt.s ? 'on' : ''} onClick={() => toggle('s')}><TextStrikethrough size={ICON} /></button>
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
          <select title='Font size' aria-label='Font size' className='size-select' value={fmt.size && fmt.size !== DEFAULT_SIZE ? fmt.size : ''} onChange={(e) => formatRange({ size: e.target.value ? Number(e.target.value) : null })}>
            {/* The default size has no value: picking it clears the cell's size. */}
            {SIZES.map((n) => <option key={n} value={n === DEFAULT_SIZE ? '' : n}>{n}</option>)}
          </select>
          <select title='Font' aria-label='Font' value={fmt.font || ''} onChange={(e) => formatRange({ font: e.target.value || null })}>
            <option value=''>Sans</option>
            <option value='serif'>Serif</option>
            <option value='mono'>Mono</option>
          </select>
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
          <span className='sep' />
          <span className='picker'>
            <button title='Alignment and wrap' aria-label='Alignment' className={fmt.align || fmt.valign || fmt.wrap ? 'on' : ''} onClick={(e) => openPalette('align', e.currentTarget)}>
              {fmt.align === 'center' ? <TextAlignCenter size={ICON} /> : fmt.align === 'right' ? <TextAlignRight size={ICON} /> : <TextAlignLeft size={ICON} />}
            </button>
            {palette === 'align' && (
              <span className='palette align-menu' role='menu' style={paletteAt || undefined}>
                {[['left', TextAlignLeft, 'Align left'], ['center', TextAlignCenter, 'Centre'], ['right', TextAlignRight, 'Align right']].map(([v, Icon, label]) => (
                  <button key={v} title={label} aria-label={label} className={fmt.align === v ? 'on' : ''} onClick={() => formatRange({ align: fmt.align === v ? null : v })}><Icon size={18} /></button>
                ))}
                {[['top', AlignTop, 'Top'], ['middle', AlignCenterVertical, 'Middle'], ['bottom', AlignBottom, 'Bottom']].map(([v, Icon, label]) => (
                  <button key={v} title={label} aria-label={'Align ' + label.toLowerCase()} className={(fmt.valign || 'bottom') === v ? 'on' : ''} onClick={() => formatRange({ valign: v === 'bottom' ? null : v })}><Icon size={18} /></button>
                ))}
                <button className={'wrap-toggle' + (fmt.wrap ? ' on' : '')} aria-label='Wrap text' onClick={() => toggle('wrap')}><ArrowUDownLeft size={18} /> Wrap text</button>
              </span>
            )}
          </span>
          <span className='picker'>
            <button title='Borders' aria-label='Borders' onClick={(e) => openPalette('borders', e.currentTarget)}><FrameCorners size={ICON} /></button>
            {palette === 'borders' && (
              <span className='palette borders-menu' role='menu' style={paletteAt || undefined}>
                {[['all', 'All'], ['outside', 'Outside'], ['inside', 'Inside'], ['top', 'Top'], ['bottom', 'Bottom'], ['left', 'Left'], ['right', 'Right'], ['none', 'None']].map(([preset, label]) => (
                  <button key={preset} className='border-preset' onClick={() => { run('sheet:setBorders', { ...range, preset, line: borderLine }); setPalette(null) }}>{label}</button>
                ))}
                <select aria-label='Border line' value={borderLine.split(':')[0]} onChange={(e) => setBorderLine(e.target.value + (borderLine.includes(':') ? ':' + borderLine.split(':')[1] : ''))}>
                  {['thin', 'medium', 'thick', 'dashed', 'double'].map((k) => <option key={k} value={k}>{k[0].toUpperCase() + k.slice(1)}</option>)}
                </select>
                <span className='border-colours'>
                  {['', '#1f2420', '#b3261e', '#5b8c3a', '#2f7d8c', '#6b716b'].map((c) => (
                    <button key={c || 'auto'} className={'swatch' + ((borderLine.split(':')[1] || '') === c ? ' on' : '')} title={c || 'Text colour'} aria-label={'Border colour ' + (c || 'automatic')} style={{ background: c || 'transparent', borderTop: borderCss('thin') }} onClick={() => setBorderLine(borderLine.split(':')[0] + (c ? ':' + c : ''))} />
                  ))}
                </span>
              </span>
            )}
          </span>
          <button
            title={mergeSelected ? 'Unmerge cells' : 'Merge cells'}
            aria-label={mergeSelected ? 'Unmerge cells' : 'Merge cells'}
            className={mergeSelected ? 'on' : ''}
            disabled={!mergeSelected && range.r1 === range.r2 && range.c1 === range.c2}
            onClick={() => {
              if (mergeSelected) { run('sheet:unmerge', range); return }
              const lost = view.cells.some((x) => x.input && !(x.row === range.r1 && x.col === range.c1) && x.row >= range.r1 && x.row <= range.r2 && x.col >= range.c1 && x.col <= range.c2)
              if (lost) setConfirmMerge({ ...range })
              else run('sheet:merge', range)
            }}
          ><ArrowsOutLineHorizontal size={ICON} />
          </button>
          <button title='Insert a chart of the selection' aria-label='Insert chart' className='insert-chart' onClick={() => insertChart().catch((err) => onError(err.message))}><ChartBar size={ICON} /></button>
          <button title='Link (Ctrl+K)' aria-label='Link' className={ownLink(selLink) ? 'on' : ''} onClick={startLink}><LinkSimple size={ICON} /></button>
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
          {toolRow.moreButton}
        </div>
        {/* Export is in More, as in every editor. Phones keep the title
            readable: Find moves into More too, and the people (or a share
            icon when alone) open Share. */}
        {!phone && <button className='find-button icon-button title-action' title='Find and replace (Ctrl+F)' aria-label='Find' onClick={() => setFinding({ replace: false })}><MagnifyingGlass size={ICON} /></button>}
      </FileBar>

      {note && <div className='banner info'>{note}</div>}
      <div className='formula-bar'>
        {goingTo === null
          ? <span className='address' role='button' tabIndex={-1} title='Go to a cell or named range' onClick={() => setGoingTo('')}>{colName(sel.col) + sel.row}</span>
          : <input className='address' aria-label='Go to' autoFocus value={goingTo} placeholder={colName(sel.col) + sel.row} onChange={(e) => setGoingTo(e.target.value)} onBlur={() => setGoingTo(null)} onKeyDown={(e) => { if (e.key === 'Enter') { goTo(goingTo); setGoingTo(null); focusGrid() } if (e.key === 'Escape') { setGoingTo(null); focusGrid() } }} />}
        <span className='fx' aria-hidden='true'>fx</span>
        <input
          aria-label='Cell contents'
          inputMode={numPad ? 'decimal' : undefined}
          className={spilled && !editing ? 'spilled' : undefined}
          title={spilled && !editing ? 'This value comes from the formula in ' + colName(anchor.col) + anchor.row : undefined}
          readOnly={!canEdit || (spilled && !editing)}
          value={barValue}
          onFocus={() => { if (canEdit && !editing && !spilled) setEditing({ ...sel, value: selected ? selected.input : '', source: 'bar' }) }}
          onChange={(e) => { pointRef.current = null; setEditing({ ...sel, value: e.target.value, source: 'bar' }); setCaret(e.target.selectionStart) }}
          onSelect={(e) => setCaret(e.target.selectionStart)}
          onKeyDown={onEditKey}
          onBlur={() => { if (editing) commit(null) }}
        />
      </div>
      {linking && (
        <LinkBar
          key={sel.row + ',' + sel.col}
          initial={linking.initial}
          hasLink={linking.hasLink}
          initialPick={linking.initialPick}
          tabs={view.tabs}
          tabId={view.tabId}
          names={view.names || []}
          files={usable.filter((f) => f.sheetId !== sheetId)}
          folders={folders}
          onApply={applyLink}
          onRemove={removeLink}
          onClose={() => { setLinking(null); afterPanel() }}
          onError={onError}
        />
      )}
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
        others={others}
        cells={cells}
        sel={sel}
        editing={editing}
        zoom={zoom}
        onZoom={setZoom}
        inputMode={numPad ? 'decimal' : undefined}
        range={range}
        spillBox={spillBox}
        ext={ext}
        onSelect={(row, col, extend) => { if (editing) commit(null); setSelectedChart(null); select(row, col, extend) }}
        onCopy={onCopy}
        onPaste={onPaste}
        onEdit={(row, col) => { select(row, col); if (canEdit) setEditing({ row, col, value: (cells.get(row + ',' + col) || {}).input || '' }) }}
        onEditChange={(value) => { pointRef.current = null; setEditing((ed) => ({ ...ed, value })) }}
        onPoint={point}
        pointBox={pointBox}
        onEditCaret={setCaret}
        onEditKey={onEditKey}
        onEditBlur={() => commit(null)}
        onKeyDown={onKeyDown}
        onHeaderMenu={(kind, index, x, y) => { if (canEdit) setMenu({ kind, index, x, y }) }}
        onFill={canEdit && !phone ? fillFrom : null}
        charts={view.charts || []}
        selectedChart={selectedChart}
        chartActions={chartActions}
        onCellMenu={(row, col, x, y) => {
          if (row < range.r1 || row > range.r2 || col < range.c1 || col > range.c2) select(row, col)
          setMenu({ kind: 'cell', x, y })
        }}
        onResize={(col, px) => { if (canEdit) run('sheet:setWidth', { col, px }) }}
        onRowResize={(row, px) => { if (canEdit) run('sheet:setHeight', { row, px }) }}
        hiddenRows={hidden}
        commentMarks={threadAt.size ? threadAt : null}
        invalidCells={invalidCells}
        chipCells={chipCells}
        smartChips={smartChips}
        sheetId={sheetId}
        dateAt={canEdit && selected && selected.fmt && selected.fmt.datechip && range.r1 === range.r2 && range.c1 === range.c2 ? sel : null}
        onDatePick={() => pickDate(sel.row, sel.col)}
        cfStyles={cfStyles}
        dropdownAt={canEdit && selRule && selRule.kind === 'list' && selRule.dropdown !== false && (selRule.items || []).length ? sel : null}
        onDropdown={(x, y) => setPicking({ row: sel.row, col: sel.col, x, y })}
        onComment={(row, col) => setCommenting({ row, col })}
        hiddenCols={hiddenCols}
        unhideMarks={canEdit ? unhideMarks : null}
        onUnhide={unhideRun}
        onAutoFit={(col) => { const px = fitWidth(view.cells, col); if (px && canEdit) run('sheet:setWidth', { col, px }) }}
        filterHead={filterHead}
        onFilterMenu={(col) => setFiltering(col)}
        onOpenLink={openLink}
      />
      {selLink && !editing && !linking && !menu && range.r1 === range.r2 && range.c1 === range.c2 && (
        <LinkCard
          row={sel.row}
          col={sel.col}
          link={selLink}
          canEdit={canEdit}
          onOpen={() => openLink(sel.row, sel.col)}
          onEdit={startLink}
          onRemove={removeLink}
        />
      )}

      {confirmMerge && (
        <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setConfirmMerge(null) }}>
          <section className='panel' role='dialog' aria-label='Merge cells'>
            <header>
              <h2>Merge cells?</h2>
              <button className='close' aria-label='Close' onClick={() => setConfirmMerge(null)}><X size={18} /></button>
            </header>
            <p>Merging keeps only the top-left cell's contents. The other cells in {colName(confirmMerge.c1) + confirmMerge.r1}:{colName(confirmMerge.c2) + confirmMerge.r2} will be cleared. Undo brings them back.</p>
            <div className='row end'>
              <button onClick={() => setConfirmMerge(null)}>Cancel</button>
              <button className='primary' onClick={() => { const r = confirmMerge; setConfirmMerge(null); run('sheet:merge', r) }}>Merge</button>
            </div>
          </section>
        </div>
      )}
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
      {editingChart && chartById(editingChart) && (
        <ChartPanel
          key={editingChart}
          chart={chartById(editingChart)}
          selection={rangeText(range)}
          onChange={(patch) => chartActions.change(editingChart, patch)}
          onDelete={() => chartActions.remove(editingChart)}
          onClose={() => { setEditingChart(null); afterPanel() }}
        />
      )}
      {viewingChart && chartById(viewingChart) && (() => {
        const c = chartById(viewingChart)
        const w = Math.min(window.innerWidth - 24, 900)
        const h = Math.min(Math.round(w * 0.75), window.innerHeight - 220)
        return (
          <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setViewingChart(null) }}>
            <section className='panel chart-full' role='dialog' aria-label='Chart'>
              <header>
                <h2>{c.title || 'Chart'}</h2>
                <button className='close' aria-label='Close' onClick={() => setViewingChart(null)}><X size={18} /></button>
              </header>
              <ChartView chart={{ ...c, title: undefined }} width={w - 36} height={h} />
              <div className='row'>
                {canEdit && <button onClick={() => chartActions.edit(c.id)}><PencilSimple size={16} /> Edit</button>}
                <button onClick={() => chartActions.download(c.id, 'png')}><DownloadSimple size={16} /> PNG</button>
                <button onClick={() => chartActions.download(c.id, 'svg')}><DownloadSimple size={16} /> SVG</button>
                {canEdit && <button className='danger' onClick={() => chartActions.remove(c.id)}><Trash size={16} /></button>}
              </div>
            </section>
          </div>
        )
      })()}
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
      {naming && (
        <NamesPanel
          names={view.names || []}
          tabId={view.tabId}
          selection={colName(range.c1) + range.r1 + (range.r1 === range.r2 && range.c1 === range.c2 ? '' : ':' + colName(range.c2) + range.r2)}
          startAdding={naming.adding}
          canEdit={canEdit}
          act={async (what, args) => { try { return await call('sheet:' + what, { sheetId, tabId, ...args }) } catch (err) { return { error: err.message } } }}
          onGo={(n) => { setNaming(null); goTo(n.name); afterPanel() }}
          onClose={() => { setNaming(null); afterPanel() }}
        />
      )}
      {colouring && (
        <CondFormatPanel
          rules={view.condFormats || []}
          matches={view.cfMatches || {}}
          selection={colName(range.c1) + range.r1 + (range.r1 === range.r2 && range.c1 === range.c2 ? '' : ':' + colName(range.c2) + range.r2)}
          canEdit={canEdit}
          act={async (what, args) => { try { return await call('sheet:' + what, { sheetId, tabId, ...args }) } catch (err) { return { error: err.message } } }}
          onClose={() => { setColouring(false); afterPanel() }}
        />
      )}
      {validating && (() => {
        const text = colName(validating.c1) + validating.r1 + (validating.r1 === validating.r2 && validating.c1 === validating.c2 ? '' : ':' + colName(validating.c2) + validating.r2)
        const rule = ruleFor(validations, validating.r1, validating.c1)
        const close = () => { setValidating(null); afterPanel() }
        // Dropdown... offers the values already in the range as the items.
        const seen = new Set()
        const initialItems = []
        if (validating.dropdown && !rule) {
          for (let r = validating.r1; r <= Math.min(validating.r2, view.rows); r++) {
            for (let c = validating.c1; c <= Math.min(validating.c2, view.cols); c++) {
              const d = cells.get(r + ',' + c)
              const t = d && d.display !== undefined ? String(d.display).trim() : ''
              if (t && !seen.has(t.toLowerCase()) && initialItems.length < 500) { seen.add(t.toLowerCase()); initialItems.push(t) }
            }
          }
        }
        return (
          <ValidationPanel
            range={text}
            rule={rule}
            initialItems={initialItems}
            onSave={async (r) => { if (await run('sheet:setValidation', { range: text, rule: r }) !== undefined) close() }}
            onRemove={() => { run('sheet:setValidation', { range: text, rule: null }); close() }}
            onClose={close}
          />
        )
      })()}
      {badEntry && (
        <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setBadEntry(null) }}>
          <section className='panel' role='alertdialog' aria-label='Not allowed'>
            <header>
              <h2>{badEntry.rule.onBad === 'warn' ? 'Keep this value?' : 'That value is not allowed'}</h2>
              <button className='close' aria-label='Close' onClick={() => { setBadEntry(null); focusGrid() }}><X size={18} /></button>
            </header>
            <p>{explain(badEntry.rule)}</p>
            <div className='row end'>
              {badEntry.rule.onBad === 'warn'
                ? <button onClick={() => { const b = badEntry; setBadEntry(null); writeEntry(b.row, b.col, b.value, b.move) }}>Keep it</button>
                : <button onClick={() => { setBadEntry(null); focusGrid() }}>Cancel</button>}
              <button className='primary' onClick={() => { const b = badEntry; setBadEntry(null); setEditing({ row: b.row, col: b.col, value: b.value, source: 'grid' }) }}>Change it</button>
            </div>
          </section>
        </div>
      )}
      {picking && selRule && (() => {
        // An item that looks like a formula is entered as text.
        const pick = (item) => { setPicking(null); writeEntry(picking.row, picking.col, /^[='"]/.test(item) ? "'" + item : item, null) }
        const items = (selRule.items || []).filter((it) => !selRule.multi || !String(it).includes(','))
        const choice = (it) => (selRule.chips ? <span className={'chip chip-' + chipColor(selRule, { kind: 'text', display: it })}>{it}</span> : it)
        // As in Google Sheets: a tick on the current value and a way to the
        // list's settings (proposals/2026-10-22-dropdown-chips.md).
        // A multi-select list (proposals/2026-10-23-multi-select-and-smart-chips.md)
        // stays open: each tap adds or removes that item.
        const multi = !!selRule.multi
        const now = selected && selected.display !== undefined && selected.display !== '' ? (multi ? choicesOf(selected.display) : [String(selected.display)]) : []
        const isOn = (it) => now.some((x) => x.toLowerCase() === String(it).toLowerCase())
        const toggle = (it) => {
          const next = isOn(it) ? now.filter((x) => x.toLowerCase() !== String(it).toLowerCase()) : [...now, it]
          writeEntry(picking.row, picking.col, joinChoices(items, next), null)
        }
        const option = (it) => <li key={it} role='option' aria-selected={isOn(it)} onClick={(e) => { if (!multi) { pick(it); return } e.stopPropagation(); toggle(it) }}><span className={'pick-tick' + (multi ? ' box' : '')} aria-hidden='true'>{isOn(it) && <Check size={16} weight='bold' />}</span>{choice(it)}</li>
        const editChoices = <li className='pick-edit' role='option' aria-selected={false} onClick={() => { setPicking(null); setValidating({ r1: selRule.r1, c1: selRule.c1, r2: selRule.r2, c2: selRule.c2 }) }}><span className='pick-tick' aria-hidden='true'><PencilSimple size={16} /></span>Edit choices...</li>
        return phone
          ? (
            <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setPicking(null) }}>
              <section className='panel' role='dialog' aria-label='Pick a value'>
                <header>
                  <h2>{colName(picking.col) + picking.row}</h2>
                  <button className='close' aria-label='Close' onClick={() => setPicking(null)}><X size={18} /></button>
                </header>
                <ul className='pick-list' role='listbox'>
                  {items.map(option)}
                  {editChoices}
                </ul>
                {multi && <div className='row equal'><button className='primary' onClick={() => setPicking(null)}>Done</button></div>}
              </section>
            </div>
            )
          : (
            <ul className='menu pick-menu' role='listbox' style={{ left: Math.max(8, picking.x - 200), top: picking.y + 2 }}>
              {items.map(option)}
              {editChoices}
              {multi && <li className='pick-edit' role='option' aria-selected={false} onClick={() => setPicking(null)}><span className='pick-tick' aria-hidden='true' />Done</li>}
            </ul>
            )
      })()}
      {commenting && (
        <CommentPanel
          sheetId={sheetId}
          address={colName(commenting.col) + commenting.row}
          thread={threadAt.get(commenting.row + ',' + commenting.col) || null}
          members={members}
          canEdit={canEdit}
          act={commentAct}
          onClose={() => { setCommenting(null); afterPanel() }}
        />
      )}
      {listingComments && (
        <CommentsList
          sheetId={sheetId}
          threads={threads}
          members={members}
          addressOf={(t) => colName(t.col) + t.row}
          onOpen={(t) => { setListingComments(false); setSel({ row: t.row, col: t.col }); setExt({ row: t.row, col: t.col }); setCommenting({ row: t.row, col: t.col }) }}
          onClose={() => { setListingComments(false); afterPanel() }}
        />
      )}
      {filtering && filter && (
        <FilterPanel
          key={filtering}
          title={(cells.get(filter.r1 + ',' + filtering) || {}).display || 'column ' + colName(filtering)}
          values={columnValues(cells, filter, filtering, view.rows)}
          rule={filter.cols[filtering]}
          canSort={canEdit}
          onSort={(desc) => { setFiltering(null); sortBy({ r1: filter.r1, c1: filter.c1, r2: filtered.r2, c2: filter.c2 }, [{ col: filtering, desc }], true); afterPanel() }}
          onApply={(rule) => { setColumnRule(filtering, rule); setFiltering(null); afterPanel() }}
          onClose={() => { setFiltering(null); afterPanel() }}
        />
      )}
      {atList.length > 0 && <AtMenu items={atList} selected={atSel} sheetId={sheetId} onPick={pickAt} anchor={document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : null} />}
      <input ref={dateInput} type='date' className='hidden-date' tabIndex={-1} aria-hidden='true' onChange={datePicked} />
      {shownHelp && <FormulaHelp help={shownHelp} selected={helpSel} onPick={pickFunction} anchor={document.activeElement && document.activeElement.tagName === 'INPUT' ? document.activeElement : null} />}

      {menu && (
        <ul className='menu' ref={menuRef} style={menu.kind === 'tab' ? { left: menu.x, bottom: window.innerHeight - menu.y } : { left: menu.x, top: menu.y }} role='menu'>
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
              {freezeItems(() => setMenu(null))}
              {filterItems(() => setMenu(null))}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); setValidating({ ...range, dropdown: true }) }}>Dropdown...</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); setValidating({ ...range }) }}>Validation...</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); setColouring(true) }}>Conditional formatting...</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); setNaming({ adding: true }) }}>Name this range...</li>}
              {selLink && !selLink.gone && !selLink.missing && <li role='menuitem' onClick={() => { setMenu(null); openLink(sel.row, sel.col) }}>Open link</li>}
              {canEdit && <li role='menuitem' onClick={() => { setMenu(null); startLink() }}>{ownLink(selLink) ? 'Edit link...' : 'Insert link...'}</li>}
              {canEdit && ownLink(selLink) && <li role='menuitem' onClick={() => { setMenu(null); removeLink() }}>Remove link</li>}
              {(canEdit || threadAt.has(sel.row + ',' + sel.col)) && <li role='menuitem' onClick={() => { setMenu(null); setCommenting({ row: sel.row, col: sel.col }) }}>{threadAt.has(sel.row + ',' + sel.col) ? 'Show comments' : 'Comment'}</li>}
              {canEdit && <li role='menuitem' className='danger' onClick={() => { setMenu(null); run('sheet:clearRange', range) }}>Clear contents</li>}
            </>
          )}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' onClick={() => lineAction('before')}>Insert {menu.kind === 'row' ? 'row above' : 'column left'}</li>}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' onClick={() => lineAction('after')}>Insert {menu.kind === 'row' ? 'row below' : 'column right'}</li>}
          {(menu.kind === 'row' || menu.kind === 'col') && (() => {
            const [from, to] = headerSpan(menu.kind, menu.index)
            const noun = menu.kind === 'row' ? (from === to ? 'row ' + from : 'rows ' + from + ' to ' + to) : (from === to ? 'column ' + colName(from) : 'columns ' + colName(from) + ' to ' + colName(to))
            const set = menu.kind === 'row' ? manual.rows : manual.cols
            let anyHidden = false
            for (let n = from; n <= to; n++) if (set.has(n)) anyHidden = true
            return (
              <>
                <li role='menuitem' onClick={() => setLinesHidden(menu.kind, true)}>Hide {noun}</li>
                {anyHidden && <li role='menuitem' onClick={() => setLinesHidden(menu.kind, false)}>Show hidden {menu.kind === 'row' ? 'rows' : 'columns'}</li>}
              </>
            )
          })()}
          {(menu.kind === 'row' || menu.kind === 'col') && <li role='menuitem' className='danger' onClick={() => lineAction('delete')}>Delete {menu.kind === 'row' ? 'row ' + menu.index : 'column ' + colName(menu.index)}</li>}
        </ul>
      )}

      <footer className='tabbar'>
        <div className='tab-strip' ref={tabStrip} onWheel={(e) => { if (Math.abs(e.deltaY) > Math.abs(e.deltaX)) e.currentTarget.scrollLeft += e.deltaY }}>
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
        </div>
        {filtered && <span className='filter-status' aria-live='polite'>Showing {filtered.showing} of {filtered.total} rows</span>}
              {totals && (
          <span className='totals' aria-live='polite'>
            {totals.average !== null && <span>Sum <b>{shortNumber(totals.sum)}</b></span>}
            {totals.average !== null && <span className='wide'>Average <b>{shortNumber(totals.average)}</b></span>}
            <span>Count <b>{totals.count}</b></span>
          </span>
        )}
        <span className='zoom' role='group' aria-label='Zoom'>
          <button aria-label='Zoom out' title='Zoom out (Ctrl -)' disabled={zoom <= MIN_ZOOM + 0.001} onClick={() => zoomStep(-1)}><Minus size={14} /></button>
          <button className='zoom-level' title='Back to 100% (Ctrl 0)' onClick={() => setZoom(1)}>{Math.round(zoom * 100)}%</button>
          <button aria-label='Zoom in' title='Zoom in (Ctrl +)' disabled={zoom >= MAX_ZOOM - 0.001} onClick={() => zoomStep(1)}><Plus size={14} /></button>
        </span>
      </footer>
    </div>
  )
}
