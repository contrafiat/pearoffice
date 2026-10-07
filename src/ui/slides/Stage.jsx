import React, { useEffect, useLayoutEffect, useRef, useState } from 'react'
import { clipboardPictureFile, looksLikePicture, pastedPictures } from '../clipboardPicture.js'
import slidesModel from '../../slides/slidesModel.js'
import { themeStyle } from './themes.js'
import { LiveText, StaticText, TextFrame, boxStyle, placeholderFor } from './TextBox.jsx'
import { SNAP_PX, moved, resized, rotated, snapMove, snapTargets, unionOf, cropped, uncropped } from './geometry.js'
import { ElementBody, SlidePicture, hasText } from './objects.jsx'

// The slide being edited (proposals/2026-10-06-slides.md, Rendering): a div
// of the deck's size scaled to fit with a CSS transform, each box placed
// and rotated with CSS. Selection, handles and guides are drawn over it in
// screen pixels, so they keep their size at any zoom.
//
// A drag shows where the boxes go while it lasts and writes their frames
// once, on release, so others see a box jump rather than a stream of
// frames. Snapping to the slide's edges and centre lines and to the other
// boxes is on unless Alt is held.
//
// Shapes and pictures move, resize and rotate as text boxes do. A picture
// keeps its shape when resized by a corner (Shift frees it); other elements
// keep theirs only with Shift. A shape other than a line takes text inside
// on a double click. A line has handles only at its ends.
//
// Cropping a picture (the toolbar's Crop, the box menu's Crop or a double
// click) shows the whole picture faintly with crop handles on the frame.
// Dragging a handle cuts or uncovers that side; the picture keeps its size
// on the slide. Enter or a click outside writes the crop and frame once,
// Escape leaves them as they were.
//
// A double click on a chart opens its data (ChartTools.jsx).

const NUDGE = 5 // slide units per arrow key, ten times with Shift
const HANDLES = [
  { name: 'nw', x: -1, y: -1, angle: 315 },
  { name: 'n', x: 0, y: -1, angle: 0 },
  { name: 'ne', x: 1, y: -1, angle: 45 },
  { name: 'e', x: 1, y: 0, angle: 90 },
  { name: 'se', x: 1, y: 1, angle: 135 },
  { name: 's', x: 0, y: 1, angle: 180 },
  { name: 'sw', x: -1, y: 1, angle: 225 },
  { name: 'w', x: -1, y: 0, angle: 270 }
]
const CURSORS = ['ns-resize', 'nesw-resize', 'ew-resize', 'nwse-resize']
const cursorFor = (angle, rot) => CURSORS[Math.round((angle + rot) / 45) % 4]

export function Stage ({ size, theme, slideId, layout, els, sel, setSel, editing, startEditing, stopEditing, editStart, canEdit, layoutEdit, phone, undo, change, others, onCursor, onEditor, onPastePictures, cropping, setCropping, onEditChart }) {
  const viewRef = useRef(null)
  const slideRef = useRef(null)
  const [scale, setScale] = useState(0)
  const [drafts, setDrafts] = useState(null) // id -> frame while a drag lasts
  const [guides, setGuides] = useState(null) // { xs, ys } in slide units
  const [menu, setMenu] = useState(null) // { x, y, alt } for the box menu; alt while its alt text is edited
  const dragRef = useRef(null)
  const [cropDraft, setCropDraft] = useState(null) // { id, frame, crop } while cropping

  // Fit the slide to the space, with a margin.
  useLayoutEffect(() => {
    const el = viewRef.current
    if (!el) return
    const fit = () => {
      const pad = phone ? 12 : 32
      const k = Math.min((el.clientWidth - pad * 2) / size[0], (el.clientHeight - pad * 2) / size[1])
      setScale(Math.max(0.05, k))
    }
    fit()
    const ro = new window.ResizeObserver(fit)
    ro.observe(el)
    return () => ro.disconnect()
  }, [size[0], size[1], phone])

  // A drag ends if the slide changes under it.
  useEffect(() => () => { if (dragRef.current) dragRef.current.end() }, [slideId])

  // Cropping starts from the picture as stored and stops if it goes. When
  // it stops (Enter, a click outside, the toolbar's button, another slide)
  // the crop and frame are written once, unless Escape cancelled it.
  const cropEl = cropping && layoutEdit ? els.find((el) => el.id === cropping && el.type === 'picture') : null
  const draftRef = useRef(null)
  draftRef.current = cropDraft
  const cancelRef = useRef(false)
  useEffect(() => {
    if (!cropping) return
    if (!cropEl) { setCropping(null); return }
    cancelRef.current = false
    setCropDraft((d) => (d && d.id === cropEl.id ? d : { id: cropEl.id, slideId, frame: cropEl.frame, crop: cropEl.crop, frame0: cropEl.frame, crop0: cropEl.crop }))
    if (viewRef.current) viewRef.current.focus({ preventScroll: true }) // for Enter and Escape
  }, [cropping, !!cropEl])
  useEffect(() => {
    if (cropping) return
    const d = draftRef.current
    if (!d) return
    setCropDraft(null)
    if (cancelRef.current) return
    const same = ['x', 'y', 'w', 'h'].every((k) => d.frame0[k] === d.frame[k]) && ['l', 't', 'r', 'b'].every((k) => d.crop0[k] === d.crop[k])
    if (!same) change((doc) => { slidesModel.setFrame(doc, d.slideId, d.id, d.frame); slidesModel.setCrop(doc, d.slideId, d.id, d.crop) })
  }, [cropping])
  useEffect(() => { if (cropping) setCropping(null) }, [slideId])
  function finishCrop (keep) {
    cancelRef.current = !keep
    setCropping(null)
  }

  const frameOf = (el) => (cropDraft && cropDraft.id === el.id ? cropDraft.frame : (drafts && drafts[el.id]) || el.frame)
  const toSlide = (e) => {
    const r = slideRef.current.getBoundingClientRect()
    return { x: (e.clientX - r.left) / scale, y: (e.clientY - r.top) / scale }
  }

  // A crop handle dragged: the draft changes, nothing is written yet.
  function startCropDrag (e, dir) {
    if (e.button !== 0 || !cropDraft) return
    e.preventDefault()
    e.stopPropagation()
    const d0 = cropDraft
    const onMove = (ev) => setCropDraft({ ...d0, ...cropped(d0.frame, d0.crop, dir, toSlide(ev)) })
    const end = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', end)
      window.removeEventListener('pointercancel', end)
      dragRef.current = null
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', end)
    window.addEventListener('pointercancel', end)
    dragRef.current = { end }
  }

  // A move, resize or rotate with the pointer. The frames are written once,
  // when the pointer comes up.
  function startDrag (e, kind, ids, dir = null) {
    if (e.button !== 0) return
    e.preventDefault()
    e.stopPropagation()
    const frames0 = {}
    for (const el of els) if (ids.includes(el.id)) frames0[el.id] = el.frame
    const targets = snapTargets(size, els.filter((el) => !ids.includes(el.id)).map((el) => el.frame))
    const p0 = toSlide(e)
    const limit = SNAP_PX / scale
    let out = null
    const drag = {}
    const onMove = (ev) => {
      const p = toSlide(ev)
      const snap = !ev.altKey
      let lines = null
      if (kind === 'move') {
        let dx = p.x - p0.x
        let dy = p.y - p0.y
        if (!out && Math.hypot(dx, dy) * scale < 3) return
        if (snap) {
          const s = snapMove(moved(unionOf(Object.values(frames0)), dx, dy), targets, limit)
          dx += s.dx
          dy += s.dy
          lines = s.guides
        }
        out = {}
        for (const id of ids) out[id] = moved(frames0[id], dx, dy)
      } else if (kind === 'resize') {
        const pic = els.find((el) => el.id === ids[0] && el.type === 'picture')
        const r = resized(frames0[ids[0]], dir, p, { keepRatio: pic ? !ev.shiftKey : ev.shiftKey, targets: snap ? targets : null, limit })
        out = { [ids[0]]: r.frame }
        lines = r.guides
      } else {
        out = { [ids[0]]: rotated(frames0[ids[0]], p, { step: ev.shiftKey }) }
      }
      setDrafts(out)
      setGuides(lines && (lines.xs.length || lines.ys.length) ? lines : null)
    }
    const onUp = () => {
      drag.end()
      if (out) {
        const done = out
        change((doc) => { for (const id of Object.keys(done)) slidesModel.setFrame(doc, slideId, id, done[id]) })
      }
    }
    drag.end = () => {
      window.removeEventListener('pointermove', onMove)
      window.removeEventListener('pointerup', onUp)
      window.removeEventListener('pointercancel', drag.end)
      dragRef.current = null
      setDrafts(null)
      setGuides(null)
    }
    window.addEventListener('pointermove', onMove)
    window.addEventListener('pointerup', onUp)
    window.addEventListener('pointercancel', drag.end)
    dragRef.current = drag
  }

  function onBoxDown (e, el) {
    if (editing === el.id || e.button !== 0) return
    if (cropping) {
      e.stopPropagation()
      if (el.id !== cropping) finishCrop(true)
      return
    }
    e.stopPropagation()
    viewRef.current.focus({ preventScroll: true }) // for Delete, arrows and typing
    if (!layoutEdit) {
      // Phones and viewers: a tap edits the text (when allowed) or selects.
      setSel([el.id])
      if (canEdit && phone && hasText(el)) startEditing(el.id, { point: { x: e.clientX, y: e.clientY } })
      return
    }
    if (e.shiftKey) {
      setSel(sel.includes(el.id) ? sel.filter((id) => id !== el.id) : [...sel, el.id])
      return
    }
    const ids = sel.includes(el.id) ? sel : [el.id]
    setSel(ids)
    if (editing) stopEditing()
    startDrag(e, 'move', ids)
  }

  function onKeyDown (e) {
    if (cropping) {
      if (e.key === 'Enter' || e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); finishCrop(e.key === 'Enter') }
      return
    }
    if (e.target.closest('[contenteditable="true"]')) {
      if (e.key === 'Escape') { e.preventDefault(); stopEditing(true) }
      return
    }
    if (e.ctrlKey || e.metaKey || e.altKey) return
    const one = sel.length === 1 ? sel[0] : null
    if (e.key === 'Escape' && sel.length) { e.preventDefault(); setSel([]); return }
    if (!canEdit || !sel.length) return
    if (e.key === 'Delete' || e.key === 'Backspace') {
      e.preventDefault()
      change((doc) => { for (const id of sel) slidesModel.removeElement(doc, slideId, id) })
      setSel([])
      return
    }
    const step = { ArrowLeft: [-1, 0], ArrowRight: [1, 0], ArrowUp: [0, -1], ArrowDown: [0, 1] }[e.key]
    if (step && layoutEdit) {
      e.preventDefault()
      const k = e.shiftKey ? NUDGE * 10 : NUDGE
      change((doc) => {
        for (const el of els) if (sel.includes(el.id)) slidesModel.setFrame(doc, slideId, el.id, moved(el.frame, step[0] * k, step[1] * k))
      }, { merge: true })
      return
    }
    const typable = one && hasText(els.find((el) => el.id === one))
    if (typable && (e.key === 'Enter' || e.key === 'F2')) { e.preventDefault(); startEditing(one, {}) }
    else if (typable && e.key.length === 1) { e.preventDefault(); startEditing(one, { text: e.key }) }
  }

  const restack = (step) => { setMenu(null); restackSelected(change, slideId, els, sel, step) }

  const single = sel.length === 1 && els.find((el) => el.id === sel[0])
  const saveAlt = (text) => {
    if (single && single.type === 'picture' && text !== single.pic.alt) {
      change((doc) => slidesModel.setAlt(doc, slideId, single.id, text))
    }
    setMenu(null)
    viewRef.current.focus({ preventScroll: true })
  }
  // Wrap text in the box menu: on when every selected box with text wraps.
  const wrapTargets = els.filter((el) => sel.includes(el.id) && hasText(el))
  const wrapOn = wrapTargets.every((el) => el.layout.wrap)
  const holder = { width: size[0] * scale, height: size[1] * scale }
  const px = (f) => ({ left: f.x * scale, top: f.y * scale, width: f.w * scale, height: f.h * scale, transform: f.rot ? 'rotate(' + f.rot + 'deg)' : undefined })

  return (
    <div
      className={'slide-stage' + (phone ? ' phone' : '') + (layoutEdit ? ' layout' : '')}
      ref={viewRef}
      tabIndex={-1}
      onKeyDown={onKeyDown}
      onPaste={(e) => {
        // A picture pasted onto the slide (not into a box being edited).
        if (!layoutEdit || !onPastePictures || e.target.closest('[contenteditable="true"], input')) return
        const files = pastedPictures(e.clipboardData)
        if (files.length) { e.preventDefault(); onPastePictures(files); return }
        // No picture file in the paste: the desktop app reads the clipboard.
        if (!looksLikePicture(e.clipboardData)) return
        e.preventDefault()
        clipboardPictureFile().then((file) => { if (file) onPastePictures([file]) }).catch(() => {})
      }}
      onPointerDown={(e) => {
        if (e.target.closest('.slide-el, .handle, .rotate-handle, .menu, .alt-edit')) return
        if (cropping) { finishCrop(true); return }
        setSel([])
        if (editing) stopEditing()
        viewRef.current.focus({ preventScroll: true })
      }}
    >
      {scale > 0 && (
        <div className='slide-holder' style={holder}>
          <div className='slide' data-layout={layout} ref={slideRef} style={{ width: size[0], height: size[1], transform: 'scale(' + scale + ')', ...themeStyle(theme) }}>
            {els.map((el) => {
              const f = frameOf(el)
              const live = editing === el.id
              return (
                <div
                  key={el.id}
                  className={'slide-el' + (live ? ' editing' : '')}
                  data-id={el.id}
                  data-type={el.type}
                  data-role={el.role || undefined}
                  style={boxStyle(f)}
                  onPointerDown={(e) => onBoxDown(e, el)}
                  onDoubleClick={(e) => {
                    if (canEdit && !live && hasText(el)) startEditing(el.id, { point: { x: e.clientX, y: e.clientY } })
                    else if (layoutEdit && el.type === 'picture' && !cropping) { setSel([el.id]); setCropping(el.id) }
                    else if (layoutEdit && el.type === 'chart' && onEditChart) onEditChart(el.id)
                  }}
                  onContextMenu={(e) => {
                    if (!layoutEdit || live || cropping) return
                    e.preventDefault()
                    if (!sel.includes(el.id)) setSel([el.id])
                    setMenu({ x: e.clientX, y: e.clientY, alt: null })
                  }}
                >
                  <ElementBody
                    el={cropDraft && cropDraft.id === el.id ? { ...el, crop: cropDraft.crop } : el}
                    frame={f}
                    theme={theme}
                    text={
                      <TextFrame frame={f} role={el.role} layout={el.layout}>
                        {live
                          ? <LiveText fragment={el.text} undo={undo} placeholder={placeholderFor(el.role, phone)} canEdit={canEdit} cursors={others.filter((p) => p.box === el.id && p.cursor)} onCursor={onCursor} onEditor={onEditor} start={editStart} label={el.role === 'title' ? 'Slide title' : el.type === 'shape' ? 'Text in the shape' : 'Text box'} />
                          : <StaticText fragment={el.text} placeholder={canEdit ? placeholderFor(el.role, phone) : ''} markEmpty={canEdit && el.type === 'text' && !el.role} />}
                      </TextFrame>
                    }
                  />
                </div>
              )
            })}
            {cropDraft && cropEl && (
              <div className='crop-ghost' style={boxStyle(uncropped(cropDraft.frame, cropDraft.crop))}>
                <SlidePicture pic={cropEl.pic} />
              </div>
            )}
          </div>
          <div className='slide-overlay'>
            {others.flatMap((p) => els.filter((el) => (p.sel || []).includes(el.id) || p.box === el.id).map((el, i) => (
              <div key={p.key + el.id} className={'remote-sel' + (p.box === el.id ? ' typing' : '')} style={{ ...px(frameOf(el)), '--who': p.color }}>
                {i === 0 && <span className='presence-tag'>{p.name}</span>}
              </div>
            )))}
            {cropDraft && cropEl && (
              <div className='sel-frame cropping' style={px(cropDraft.frame)}>
                {HANDLES.map((h) => (
                  <span key={h.name} className={'handle crop-handle h-' + h.name} style={{ cursor: cursorFor(h.angle, cropDraft.frame.rot) }} onPointerDown={(e) => startCropDrag(e, h)} />
                ))}
              </div>
            )}
            {els.filter((el) => sel.includes(el.id) && !(cropDraft && cropDraft.id === el.id)).map((el) => {
              const f = frameOf(el)
              const handles = layoutEdit && single && single.id === el.id
              return (
                <div key={el.id} className={'sel-frame' + (editing === el.id ? ' editing' : '')} style={px(f)}>
                  {handles && HANDLES.filter((h) => !(el.type === 'shape' && el.style.shape === 'line') || !h.y).map((h) => (
                    <span key={h.name} className={'handle h-' + h.name} style={{ cursor: cursorFor(h.angle, f.rot) }} onPointerDown={(e) => startDrag(e, 'resize', [el.id], h)} />
                  ))}
                  {handles && <span className='rotate-handle' title='Rotate (Shift: steps of 15 degrees)' onPointerDown={(e) => startDrag(e, 'rotate', [el.id])} />}
                </div>
              )
            })}
            {guides && guides.xs.map((x) => <div key={'x' + x} className='guide v' style={{ left: x * scale }} />)}
            {guides && guides.ys.map((y) => <div key={'y' + y} className='guide h' style={{ top: y * scale }} />)}
          </div>
        </div>
      )}
      {menu && <div className='doc-scrim' onPointerDown={(e) => { e.stopPropagation(); if (menu.alt !== null) saveAlt(menu.alt.trim()); else setMenu(null) }} />}
      {menu && menu.alt !== null && single && single.type === 'picture' && (
        <div className='doc-pop box-menu alt-edit' style={{ top: Math.min(menu.y, window.innerHeight - 120), left: Math.min(menu.x, window.innerWidth - 300) }}>
          <label htmlFor='slide-alt'>Alt text</label>
          <input
            id='slide-alt'
            autoFocus
            placeholder='Describe the picture.'
            value={menu.alt}
            maxLength={500}
            onChange={(e) => setMenu({ ...menu, alt: e.target.value })}
            onKeyDown={(e) => {
              e.stopPropagation()
              if (e.key === 'Enter') { e.preventDefault(); saveAlt(menu.alt.trim()) }
              if (e.key === 'Escape') { e.preventDefault(); setMenu(null); viewRef.current.focus({ preventScroll: true }) }
            }}
          />
          <button className='alt-save' onClick={() => saveAlt(menu.alt.trim())}>Save</button>
        </div>
      )}
      {menu && menu.alt === null && (
        <ul className='menu doc-pop box-menu' role='menu' style={{ top: Math.min(menu.y, window.innerHeight - 240), left: Math.min(menu.x, window.innerWidth - 200) }}>
          {single && single.type === 'picture' && <li role='menuitem' className='alt-text' onClick={() => setMenu({ ...menu, alt: single.pic.alt })}>Alt text</li>}
          {single && single.type === 'picture' && <li role='menuitem' className='crop-picture' onClick={() => { setMenu(null); setCropping(single.id) }}>Crop</li>}
          {wrapTargets.length > 0 && (
            <li role='menuitemcheckbox' aria-checked={wrapOn} className={'wrap-text' + (wrapOn ? ' on' : '')} onClick={() => { setMenu(null); change((doc) => { for (const el of wrapTargets) slidesModel.setWrap(doc, slideId, el.id, !wrapOn) }) }}>
              <span className='check'>{wrapOn ? '✓' : ''}</span> Wrap text
            </li>
          )}
          <li role='menuitem' onClick={() => restack('front')}>Bring to front</li>
          <li role='menuitem' onClick={() => restack(1)}>Bring forward</li>
          <li role='menuitem' onClick={() => restack(-1)}>Send backward</li>
          <li role='menuitem' onClick={() => restack('back')}>Send to back</li>
          <li role='menuitem' className='danger' onClick={() => { setMenu(null); change((doc) => { for (const id of sel) slidesModel.removeElement(doc, slideId, id) }); setSel([]) }}>Delete</li>
        </ul>
      )}
    </div>
  )
}

// Bring forward or send back every selected box (step: 1, -1, 'front' or
// 'back'), keeping their order among themselves.
export function restackSelected (change, slideId, els, sel, step) {
  const order = els.filter((el) => sel.includes(el.id)).map((el) => el.id) // back to front
  const first = step === 'front' || step === -1 ? order : order.reverse()
  change((doc) => { for (const id of first) slidesModel.restack(doc, slideId, id, step) })
}
