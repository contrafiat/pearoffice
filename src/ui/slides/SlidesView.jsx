import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { ArrowCounterClockwise, ArrowClockwise, Textbox, SelectionForeground, SelectionBackground, Trash, ArrowUUpLeft, Play, Shapes, Crop, Image as ImageIcon, ChartBar } from '@phosphor-icons/react'
import { call, on } from '../bridge.js'
import { FileBar, useMembers } from '../FileBar.jsx'
import { colourFor } from '../Avatar.jsx'
import { readPref } from '../prefs.js'
import { isMobile } from '../save.js'
import { toB64, fromB64, preparePicture, isPicture } from '../doc/pictures.js'
import slidesModel from '../../slides/slidesModel.js'
import { LAYOUTS, LAYOUT_IDS } from '../../slides/layouts.js'
import { defaultSize, THEMES, THEME_IDS } from './themes.js'
import { useDeck, boxesOf } from './deck.js'
import { LOCAL, deckUndo } from './text.js'
import { Stage, restackSelected } from './Stage.jsx'
import { SlideList } from './SlideList.jsx'
import { TextTools } from './TextTools.jsx'
import { Notes } from './Notes.jsx'
import { Show, Presenter } from './Present.jsx'
import { PicturesContext, usePictureCache, hasText } from './objects.jsx'
import { InsertShape, ShapeTools, AnchorButtons } from './ShapeTools.jsx'
import { exportDeck } from './pdfExport.jsx'
import { usePrintKey } from '../printKey.js'
import { ChartTools, ChartDataPanel } from './ChartTools.jsx'
import { sampleChart } from './SlideChart.jsx'

// The slide deck editor (proposals/2026-10-06-slides.md). As with documents
// it keeps its own copy of the deck's Yjs doc: loaded whole with
// slides:state, its own edits sent with slides:update (a few at a time),
// everyone else's applied from doc:updated. Every change goes through
// slidesModel.js inside one transaction with this editor's origin, and one
// undo history (text.js, deckUndo) covers slides, boxes, frames, text and
// notes, so Ctrl+Z undoes a move and typing in the order they were made.
//
// Phones edit text, speaker notes and slide order; moving, resizing,
// rotating, adding boxes, shapes and pictures, styling shapes, layouts and
// themes are for desktop. Every device draws shapes, pictures and charts;
// adding and editing charts is for desktop too.

const SEND_MS = 300
const CURSOR_MS = 150

// phone: a touch screen smaller than 700 px either way. listBelow: a phone,
// or a touch screen narrower than 1000 px. Follows rotation and split view.
function useTouchLayout (touch) {
  const measure = () => {
    const phone = touch && Math.min(window.innerWidth, window.innerHeight) < 700
    return { phone, listBelow: phone || (touch && window.innerWidth < 1000) }
  }
  const [value, setValue] = useState(measure)
  useEffect(() => {
    if (!touch) return
    const onResize = () => setValue((v) => { const n = measure(); return n.phone === v.phone && n.listBelow === v.listBelow ? v : n })
    window.addEventListener('resize', onResize)
    return () => window.removeEventListener('resize', onResize)
  }, [touch])
  return value
}

export function SlidesView ({ sheetId, onTitleChange, onError, onGone }) {
  const ydoc = useMemo(() => new Y.Doc(), [sheetId])
  const undo = useMemo(() => deckUndo(ydoc), [ydoc])
  useEffect(() => () => { undo.destroy(); ydoc.destroy() }, [ydoc, undo])
  const [info, setInfo] = useState(null) // slides:state without the state
  const [title, setTitle] = useState('')
  const [arrived, setArrived] = useState(false)
  const members = useMembers(sheetId)
  const pictures = usePictureCache(sheetId)
  // A touch screen. On a phone the editor is the phone's (text, notes and
  // order); a tablet, at least 700 px both ways, gets the full editor.
  // listBelow: the slide list goes under the slide, as on a phone, which a
  // tablet narrower than 1000 px (an iPad upright) does too.
  const touch = isMobile()
  const { phone, listBelow } = useTouchLayout(touch)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const goneRef = useRef(onGone)
  goneRef.current = onGone

  useEffect(() => {
    const meta = ydoc.getMap('meta')
    const read = () => { setTitle(meta.get('title') || ''); setArrived(meta.has('kind')) }
    read()
    meta.observe(read)
    return () => meta.unobserve(read)
  }, [ydoc])

  const loadInfo = useCallback(async (withState) => {
    try {
      const s = await call('slides:state', { sheetId, withState })
      if (s.state) Y.applyUpdate(ydoc, fromB64(s.state), 'remote')
      delete s.state
      setInfo(s)
    } catch (err) {
      if (/^unknown file/.test(err.message)) { goneRef.current(); return }
      errorRef.current(err.message)
    }
  }, [sheetId, ydoc])

  // Listen before loading, so nothing falls between the two.
  useEffect(() => {
    const off = on('doc:updated', (d) => {
      if (d.sheetId !== sheetId) return
      try { Y.applyUpdate(ydoc, fromB64(d.update), 'remote') } catch {}
    })
    loadInfo(true)
    return off
  }, [sheetId, ydoc, loadInfo])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) loadInfo(false) }), [sheetId, loadInfo])
  useEffect(() => on('sheet:moved', (d) => { if (d.from === sheetId) loadInfo(false) }), [sheetId, loadInfo])

  const hasEditRole = !!info && (info.myRole === 'owner' || info.myRole === 'editor')
  const canEdit = hasEditRole && info.writable && !info.newer && !info.frozen
  const layoutEdit = canEdit && !phone

  useEffect(() => {
    if (!info || (arrived && !(hasEditRole && !info.writable))) return
    const t = setInterval(() => loadInfo(!arrived), 1000)
    return () => clearInterval(t)
  }, [info, arrived, hasEditRole, loadInfo])

  const [onScreen, setOnScreen] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const vis = () => setOnScreen(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])
  useEffect(() => {
    call('file:visible', { sheetId, visible: onScreen }).catch(() => {})
    return () => { call('file:visible', { sheetId, visible: false }).catch(() => {}) }
  }, [sheetId, onScreen])

  // This person's edits go to the worklet a few at a time, and at once when
  // the app is hidden or the deck closes.
  const canEditRef = useRef(false)
  canEditRef.current = canEdit
  const flushRef = useRef(() => {})
  useEffect(() => {
    let pending = []
    let timer = null
    let sending = Promise.resolve()
    const flush = () => {
      clearTimeout(timer)
      timer = null
      if (!pending.length) return
      const update = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending)
      pending = []
      if (!canEditRef.current) return
      sending = sending.then(() => call('slides:update', { sheetId, update: toB64(update) })).catch((err) => errorRef.current(err.message))
    }
    const onUpdate = (update, origin) => {
      if (origin === 'remote') return
      pending.push(update)
      if (!timer) timer = setTimeout(flush, SEND_MS)
    }
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    ydoc.on('update', onUpdate)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('beforeunload', flush)
    flushRef.current = flush
    return () => {
      flush()
      ydoc.off('update', onUpdate)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('beforeunload', flush)
    }
  }, [sheetId, ydoc])

  // One change to the deck: one transaction, one step to undo. merge lets a
  // run of arrow key nudges undo as one.
  const change = useCallback((fn, { merge = false } = {}) => {
    if (!canEditRef.current) return null
    if (!merge) undo.stopCapturing()
    let out = null
    ydoc.transact(() => { out = fn(ydoc) }, LOCAL)
    if (!merge) undo.stopCapturing()
    return out
  }, [ydoc, undo])

  const [, setUndoTick] = useState(0)
  useEffect(() => {
    const tick = () => setUndoTick((n) => n + 1)
    undo.on('stack-item-added', tick)
    undo.on('stack-item-popped', tick)
    undo.on('stack-cleared', tick)
    return () => { undo.off('stack-item-added', tick); undo.off('stack-item-popped', tick); undo.off('stack-cleared', tick) }
  }, [undo])

  // --- the deck as drawn ---------------------------------------------------

  const { deck, version } = useDeck(ydoc)

  // The slide on screen. One deleted by someone else stays, with Restore;
  // one that is gone for good gives way to its neighbour.
  const [current, setCurrent] = useState(null)
  const lastIndex = useRef(0)
  const at = deck.slides.findIndex((s) => s.id === current)
  if (at >= 0) lastIndex.current = at
  const goneMap = at < 0 && current ? slidesModel.slide(ydoc, current) : null
  const deleted = !!(goneMap && goneMap.get('gone'))
  const deletedBy = deleted ? slidesModel.deletedBy(ydoc, current) : null
  useEffect(() => {
    if (at >= 0 || deleted || !deck.slides.length) return
    setCurrent(deck.slides[Math.min(lastIndex.current, deck.slides.length - 1)].id)
  }, [at, deleted, deck])
  const slide = at >= 0 ? deck.slides[at] : null
  const els = useMemo(() => (slide ? slide.els : deleted ? boxesOf(ydoc, current) : []), [slide, deleted, current, version])

  const [sel, setSelRaw] = useState([])
  const [editing, setEditing] = useState(null) // the box with a live editor
  const [editStart, setEditStart] = useState(null)
  const [boxEditor, setBoxEditor] = useState(null)
  const [notesEditor, setNotesEditor] = useState(null)
  const setSel = useCallback((ids) => setSelRaw(ids), [])
  // Boxes that went (deleted, undone) leave the selection.
  const shownSel = sel.filter((id) => els.some((el) => el.id === id))
  useEffect(() => { if (editing && !els.some((el) => el.id === editing)) setEditing(null) }, [els, editing])
  useEffect(() => { setSelRaw([]); setEditing(null) }, [current])

  const rootRef = useRef(null)
  const focusStage = () => { const st = rootRef.current && rootRef.current.querySelector('.slide-stage'); if (st) st.focus({ preventScroll: true }) }
  const startEditing = useCallback((id, start) => {
    setEditStart(start || {})
    setSelRaw([id])
    setEditing(id)
    setNotesEditor(null)
  }, [])
  const stopEditing = (focus = false) => {
    setEditing(null)
    cursorRef.current = null
    if (focus) setTimeout(focusStage, 0)
  }

  // --- presence --------------------------------------------------------------

  const [present, setPresent] = useState([])
  const [sharePresence, setSharePresence] = useState(() => readPref('pearoffice:presence') !== '0')
  useEffect(() => {
    const pref = (e) => { if (e.detail && e.detail.key === 'pearoffice:presence') setSharePresence(e.detail.value !== '0') }
    window.addEventListener('pearoffice:pref', pref)
    return () => window.removeEventListener('pearoffice:pref', pref)
  }, [])
  const cursorRef = useRef(null)
  const sentRef = useRef('')
  useEffect(() => {
    setPresent([])
    call('sheet:present', { sheetId }).then((d) => setPresent(d.people)).catch(() => {})
    const off = on('sheet:presence', (d) => { if (d.sheetId === sheetId) setPresent(d.people) })
    return () => {
      off()
      sentRef.current = ''
      cursorRef.current = null
      call('sheet:presence', { sheetId, open: false }).catch(() => {})
    }
  }, [sheetId])
  const where = useRef({})
  where.current = { slide: current, sel: shownSel.slice(0, 20), box: editing }
  const sendPresence = useCallback(() => {
    const w = where.current
    const msg = sharePresence && onScreen
      ? { open: true, slide: w.slide, sel: w.sel, box: w.box && cursorRef.current ? w.box : null, cursor: w.box ? cursorRef.current : null }
      : { open: false }
    const key = JSON.stringify(msg)
    if (key === sentRef.current) return
    sentRef.current = key
    call('sheet:presence', { sheetId, ...msg }).catch(() => {})
  }, [sheetId, sharePresence, onScreen])
  const selKey = shownSel.join(',')
  useEffect(() => { sendPresence() }, [sendPresence, current, selKey, editing])
  const sendRef = useRef(sendPresence)
  sendRef.current = sendPresence
  const cursorTimer = useRef(null)
  useEffect(() => () => clearTimeout(cursorTimer.current), [])
  const onCursor = useCallback((cursor) => {
    cursorRef.current = cursor
    if (!cursorTimer.current) cursorTimer.current = setTimeout(() => { cursorTimer.current = null; sendRef.current() }, CURSOR_MS)
  }, [])

  const nameOf = (identity) => {
    const m = members.find((x) => x.identity === identity)
    return !m ? 'Someone' : m.isMe ? 'You (other device)' : m.name || 'Unnamed'
  }
  const people = present.map((p) => ({ ...p, key: p.device, name: nameOf(p.identity), color: colourFor(p.identity), member: members.find((x) => x.identity === p.identity) || null }))
  const bySlide = new Map()
  for (const p of people) if (p.slide) bySlide.set(p.slide, [...(bySlide.get(p.slide) || []), p])
  const presentWhere = new Map(people.map((p) => [p.identity, 'here']))

  // --- slide actions -----------------------------------------------------------

  const addSlide = (layout, after = current) => {
    const id = change((doc) => slidesModel.addSlide(doc, { after, layout }))
    if (id) setCurrent(id)
  }
  const duplicate = (id) => {
    const copy = change((doc) => slidesModel.duplicateSlide(doc, id))
    if (copy) setCurrent(copy)
  }
  const remove = (id) => {
    const i = deck.slides.findIndex((s) => s.id === id)
    if (id === current) {
      const next = deck.slides[i + 1] || deck.slides[i - 1]
      if (next) setCurrent(next.id)
    }
    change((doc) => slidesModel.deleteSlide(doc, id, (members.find((x) => x.isMe) || {}).identity))
  }
  const move = (id, index) => change((doc) => slidesModel.moveSlide(doc, id, index))
  const addBox = () => {
    const id = change((doc) => slidesModel.addText(doc, current, { x: Math.round(deck.size[0] / 2 - 400), y: Math.round(deck.size[1] / 2 - 100), w: 800, h: 200, rot: 0 }))
    if (id) startEditing(id, {})
  }

  // A shape in the middle of the slide, selected. A line is a wide, low box.
  const addShape = (shape) => {
    const [sw, sh] = deck.size
    const f = shape === 'line' ? { w: 600, h: 40 } : shape === 'arrow' ? { w: 480, h: 280 } : { w: 400, h: 400 }
    const id = change((doc) => slidesModel.addShape(doc, current, shape, { x: Math.round((sw - f.w) / 2), y: Math.round((sh - f.h) / 2), w: f.w, h: f.h, rot: 0 }))
    if (id) { stopEditing(); setSel([id]); setTimeout(focusStage, 0) }
  }
  const setShapeStyle = (fn) => change((doc) => {
    for (const el of els) if (shownSel.includes(el.id) && el.type === 'shape') slidesModel.setStyle(doc, current, el.id, fn(el))
  })
  const setShapeOpacity = (o) => change((doc) => {
    for (const el of els) if (shownSel.includes(el.id) && el.type === 'shape') slidesModel.setOpacity(doc, current, el.id, o)
  })
  const setShapeArrows = (ends) => change((doc) => {
    for (const el of els) if (shownSel.includes(el.id) && el.type === 'shape') slidesModel.setArrows(doc, current, el.id, ends)
  })
  const [cropping, setCropping] = useState(null) // the picture being cropped

  // A column chart with sample data in the middle of the slide, selected.
  const addChart = () => {
    const [sw, sh] = deck.size
    const w = Math.min(1000, sw - 160)
    const h = Math.min(600, sh - 160)
    const id = change((doc) => slidesModel.addChart(doc, current, sampleChart(), { x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), w, h, rot: 0 }))
    if (id) { stopEditing(); setSel([id]); setTimeout(focusStage, 0) }
  }
  const [dataPanel, setDataPanel] = useState(null) // the chart whose data is open

  // Pictures from the file picker or the clipboard: shrunk and stored as in
  // documents (src/ui/doc/pictures.js), then put on this slide, selected.
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const showToast = (text) => {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), 4000)
  }
  const fileRef = useRef(null)
  const addPictures = async (files) => {
    const list = [...files].filter((f) => isPicture(f.type))
    if (!list.length) { showToast('This kind of picture cannot be added.'); return }
    const slideId = current
    for (const file of list) {
      try {
        const p = await preparePicture(file)
        const a = await call('slides:addPicture', { sheetId, bytes: toB64(p.bytes), mime: p.mime, width: p.w, height: p.h })
        pictures.put(a.ref, p.bytes, p.mime)
        const id = change((doc) => slidesModel.addPicture(doc, slideId, { ref: a.ref, hash: a.hash, mime: a.mime, w: a.w, h: a.h, alt: '' }))
        if (id) { stopEditing(); setSel([id]); setTimeout(focusStage, 0) }
      } catch (err) { showToast(err.message) }
    }
  }

  // --- presenting (Present.jsx) ---------------------------------------------

  // Open to everyone who can see the deck, viewers too. On desktop the main
  // process says whether there is a second display for the audience
  // ('presenter') or the window just goes full screen ('single'); a phone's
  // shell hides the status bar.
  const [presenting, setPresenting] = useState(null) // { start, mode }
  const presentingRef = useRef(null)
  presentingRef.current = presenting
  const startShow = async (fromCurrent) => {
    if (presentingRef.current || !deck.slides.length) return
    const start = fromCurrent && slide ? slide.id : deck.slides[0].id
    setEditing(null)
    setNotesEditor(null)
    presentingRef.current = { start, mode: 'single' }
    let mode = 'single'
    try {
      const r = await call('app:presentStart', { sheetId, slideId: start })
      if (r && r.mode === 'presenter') mode = 'presenter'
    } catch {}
    setPresenting({ start, mode })
  }
  const endShow = (id) => {
    if (!presentingRef.current) return
    presentingRef.current = null
    setPresenting(null)
    if (id) setCurrent(id)
    call('app:presentEnd').catch(() => {})
    setTimeout(focusStage, 0)
  }
  // F5 starts from the first slide and Shift+F5 from this one, as in
  // PowerPoint.
  const startRef = useRef(startShow)
  startRef.current = startShow
  useEffect(() => {
    const down = (e) => {
      if (e.key !== 'F5' || e.ctrlKey || e.metaKey || e.altKey) return
      e.preventDefault()
      startRef.current(e.shiftKey)
    }
    window.addEventListener('keydown', down)
    return () => window.removeEventListener('keydown', down)
  }, [])
  usePrintKey(() => { if (!presentingRef.current) exportDeck(ydoc, title, 'print', sheetId).catch((err) => onError(err.message)) })
  // Leaving the deck mid-show ends it (closes the audience window).
  useEffect(() => () => { if (presentingRef.current) call('app:presentEnd').catch(() => {}) }, [])

  function onKeyDown (e) {
    if (e.defaultPrevented) return
    const mod = e.ctrlKey || e.metaKey
    if (!mod) return
    const k = e.key.toLowerCase()
    const typing = e.target.closest('input, select, textarea, [contenteditable="true"]')
    if (k === 'z' && !typing) { e.preventDefault(); if (e.shiftKey) undo.redo(); else undo.undo() }
    if (k === 'y' && !typing) { e.preventDefault(); undo.redo() }
    if (k === 'm' && canEdit) { e.preventDefault(); addSlide('content') }
  }

  if (!info) return <div className='loading'>Opening slides...</div>
  if (!arrived) return <div className='loading'>Waiting for the slides to arrive from the people in them...</div>

  const note = info.frozen
    ? (info.frozen.removed
        ? 'The owner removed you from these slides. This is a read-only copy of what you had.'
        : info.frozen.tidied ? 'Updating these slides...' : 'These slides moved to new keys. Opening the new copy...')
    : info.newer ? 'These slides were made with a newer version of PearOffice. Update PearOffice to edit them.' : null

  const ICON = phone ? 20 : 18
  const btn = (label, Icon, active, onClick, extra = {}) => (
    <button title={label} aria-label={label} aria-pressed={active === undefined ? undefined : !!active} className={active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={onClick} {...extra}><Icon size={ICON} /></button>
  )
  const toolEditor = boxEditor || notesEditor
  const editingBox = editing && els.find((el) => el.id === editing)
  const others = people.filter((p) => p.slide === current)
  const slideMap = (slide || deleted) && slidesModel.slide(ydoc, current)
  const notes = slideMap && slideMap.get('notes')
  const selShapes = layoutEdit && !editing ? els.filter((el) => el.type === 'shape' && shownSel.includes(el.id)) : []
  const selPicture = layoutEdit && !editing && shownSel.length === 1 ? els.find((el) => el.id === shownSel[0] && el.type === 'picture') : null
  const selChart = layoutEdit && !editing && shownSel.length === 1 ? els.find((el) => el.id === shownSel[0] && el.type === 'chart') : null
  const chartSlide = current
  // The data panel closes when its chart is no longer the one selected.
  if (dataPanel && !(selChart && selChart.id === dataPanel)) setDataPanel(null)
  // Top, middle and bottom act on the box being edited or the selected
  // boxes that hold text.
  const anchorEls = !layoutEdit ? [] : editingBox ? [editingBox] : els.filter((el) => shownSel.includes(el.id) && hasText(el))
  const anchorValue = anchorEls.length && anchorEls.every((el) => el.layout.anchor === anchorEls[0].layout.anchor) ? anchorEls[0].layout.anchor : null
  const anchorTools = layoutEdit && (
    <AnchorButtons btn={btn} value={anchorValue} disabled={!anchorEls.length} onPick={(a) => change((doc) => { for (const el of anchorEls) slidesModel.setAnchor(doc, current, el.id, a) })} />
  )

  return (
    <PicturesContext.Provider value={pictures}>
      <div className={'slides' + (phone ? ' phone' : '')} ref={rootRef} onKeyDown={onKeyDown}>
        <FileBar
          sheetId={sheetId}
          noun='deck'
          title={title}
          myRole={info.myRole}
          frozen={info.frozen}
          canEdit={canEdit}
          badge={!canEdit && <span className='badge view-only'>{hasEditRole && !info.writable && !info.frozen ? 'Getting edit access...' : 'View only'}</span>}
          phone={phone}
          members={members}
          present={presentWhere}
          onTitleChange={onTitleChange}
          onError={onError}
          onGone={onGone}
          menuItems={() => {
            const save = (format) => exportDeck(ydoc, title, format, sheetId).catch((err) => onError(err.message))
            return (
              <>
                <li role='menuitem' onClick={() => save('pptx')}>Save as a PowerPoint file</li>
                <li role='menuitem' onClick={() => save('pdf')}>Save as PDF</li>
                {!touch && <li role='menuitem' onClick={() => save('print')}>Print...</li>}
              </>
            )
          }}
        />
        {note && <div className='banner info'>{note}</div>}
        <div className={'doc-tools slides-tools' + (phone ? ' phone' : '')} role='toolbar' aria-label='Slide tools'>
          {canEdit && btn('Undo (Ctrl+Z)', ArrowCounterClockwise, undefined, () => undo.undo(), { disabled: !undo.undoStack.length, className: 'undo-button' })}
          {canEdit && btn('Redo (Ctrl+Y)', ArrowClockwise, undefined, () => undo.redo(), { disabled: !undo.redoStack.length, className: 'redo-button' })}
          {canEdit && <span className='sep' />}
          {layoutEdit && (
            <>
              <select aria-label='Layout' title='Layout' className='layout-select' disabled={!slide} value={(slide && slide.layout) || 'blank'} onChange={(e) => change((doc) => slidesModel.setLayout(doc, current, e.target.value))}>
                {LAYOUT_IDS.map((id) => <option key={id} value={id}>{LAYOUTS[id].label}</option>)}
              </select>
              <select aria-label='Theme' title='Theme' className='theme-select' value={deck.theme.id} onChange={(e) => change((doc) => slidesModel.setTheme(doc, e.target.value))}>
                {THEME_IDS.map((id) => <option key={id} value={id}>{THEMES[id].label}</option>)}
              </select>
              {btn('Add a text box', Textbox, undefined, addBox, { disabled: !slide, className: 'add-box' })}
              <InsertShape btn={btn} Icon={Shapes} disabled={!slide} onPick={addShape} />
              {btn('Insert a picture', ImageIcon, undefined, () => fileRef.current.click(), { disabled: !slide, className: 'add-picture' })}
              {btn('Insert a chart', ChartBar, undefined, addChart, { disabled: !slide, className: 'add-chart' })}
              <input ref={fileRef} type='file' accept='image/*' multiple hidden className='slide-picture-input' onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addPictures(files) }} />
              {btn('Bring forward', SelectionForeground, undefined, () => restackSelected(change, current, els, shownSel, 1), { disabled: !shownSel.length, className: 'bring-forward' })}
              {btn('Send backward', SelectionBackground, undefined, () => restackSelected(change, current, els, shownSel, -1), { disabled: !shownSel.length, className: 'send-backward' })}
              {btn('Delete', Trash, undefined, () => { change((doc) => { for (const id of shownSel) slidesModel.removeElement(doc, current, id) }); setSel([]) }, { disabled: !shownSel.length, className: 'delete-box' })}
              <span className='sep' />
            </>
          )}
          {selShapes.length
            ? <><ShapeTools shapes={selShapes} theme={deck.theme} phone={phone} setStyle={setShapeStyle} setOpacity={setShapeOpacity} setArrows={setShapeArrows} />{selShapes.some((el) => el.style.shape !== 'line') && <span className='sep' />}{selShapes.some((el) => el.style.shape !== 'line') && anchorTools}</>
            : selPicture
              ? btn(cropping ? 'Finish cropping (Enter)' : 'Crop', Crop, !!cropping, () => (cropping ? setCropping(null) : setCropping(selPicture.id)), { className: 'crop-button' + (cropping ? ' on' : '') })
              : selChart
                ? <ChartTools value={selChart.chart} theme={deck.theme} btn={btn} phone={phone} setChart={(patch) => change((doc) => slidesModel.setChart(doc, chartSlide, selChart.id, { chart: patch }))} onEditData={() => setDataPanel(selChart.id)} />
                : canEdit && <TextTools editor={toolEditor} defaultSize={defaultSize(deck.theme, editingBox ? editingBox.role : 'body')} phone={phone} btn={btn} afterAlign={anchorTools} />}
          {!phone && <button className='present-button' title='Present (F5, or Shift+F5 from this slide)' onMouseDown={(e) => e.preventDefault()} onClick={() => startShow(true)} disabled={!deck.slides.length}><Play size={ICON} weight='fill' /> Present</button>}
        </div>
        <div className='slides-row'>
          {!listBelow && <SlideList slides={deck.slides} current={current} onPick={setCurrent} size={deck.size} theme={deck.theme} canEdit={canEdit} phone={false} people={bySlide} sheetId={sheetId} onAdd={addSlide} onDuplicate={duplicate} onDelete={remove} onMove={move} />}
          <div className='slides-main' onPointerDownCapture={(e) => { if (!e.target.closest('.slide-notes')) setNotesEditor(null) }}>
            {deleted
              ? (
                <div className='slide-stage slide-deleted'>
                  <p>{deletedBy ? (members.find((x) => x.identity === deletedBy && x.isMe) ? 'You' : nameOf(deletedBy)) + ' deleted this slide.' : 'This slide was deleted.'}</p>
                  {canEdit && <button className='restore-slide' onClick={() => change((doc) => slidesModel.restoreSlide(doc, current))}><ArrowUUpLeft size={16} /> Restore</button>}
                </div>
                )
              : slide
                ? <Stage size={deck.size} theme={deck.theme} slideId={current} layout={slide.layout} els={els} sel={shownSel} setSel={setSel} editing={editing} startEditing={startEditing} stopEditing={stopEditing} editStart={editStart} canEdit={canEdit} layoutEdit={layoutEdit} phone={phone} touch={touch} undo={undo} change={change} others={others} onCursor={onCursor} onEditor={setBoxEditor} onPastePictures={addPictures} cropping={cropping} setCropping={setCropping} onEditChart={(id) => { setSel([id]); setDataPanel(id) }} />
                : <div className='slide-stage' />}
            {listBelow && <SlideList slides={deck.slides} current={current} onPick={setCurrent} size={deck.size} theme={deck.theme} canEdit={canEdit} phone people={bySlide} sheetId={sheetId} onAdd={addSlide} onDuplicate={duplicate} onDelete={remove} onMove={move} />}
            {notes instanceof Y.XmlFragment && <Notes key={current} fragment={notes} undo={undo} canEdit={canEdit} phone={touch} onFocus={setNotesEditor} />}
          </div>
        </div>
        {presenting && (presenting.mode === 'presenter'
          ? <Presenter deck={deck} ydoc={ydoc} startId={presenting.start} onEnd={endShow} />
          : <Show deck={deck} ydoc={ydoc} startId={presenting.start} phone={touch} onEnd={endShow} />)}
        {selChart && dataPanel === selChart.id && (
          <ChartDataPanel key={selChart.id} value={selChart.chart} onData={(data) => change((doc) => slidesModel.setChart(doc, chartSlide, selChart.id, { data }))} onClose={() => { setDataPanel(null); setTimeout(focusStage, 0) }} />
        )}
        {toast && <div className='toast' role='status'>{toast}</div>}
        {/* Phones: Present floats at the bottom centre, out of the toolbar's
            way, and steps aside while you type. */}
        {phone && !presenting && !editing && !notesEditor && deck.slides.length > 0 && (
          <button className='present-button present-fab' onClick={() => startShow(true)}><Play size={20} weight='fill' /> Present</button>
        )}
      </div>
    </PicturesContext.Provider>
  )
}
