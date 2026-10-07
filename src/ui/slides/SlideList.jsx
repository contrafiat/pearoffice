import React, { useEffect, useRef, useState } from 'react'
import { DotsThree, Plus, CaretDown } from '@phosphor-icons/react'
import { LAYOUTS, LAYOUT_IDS } from '../../slides/layouts.js'
import { Avatar, MemberAvatar } from '../Avatar.jsx'
import { StaticSlide } from './StaticSlide.jsx'

// The slide list: a column of thumbnails on desktop, a row under the slide
// on phones. Thumbnails are the slide's own DOM scaled down, with no live
// editors, drawn once they first scroll into view. Click picks a slide;
// drag (mouse) or Ctrl+Up and Ctrl+Down (as in Google Slides and PowerPoint)
// reorder it; each slide's menu has the same moves for phones, plus
// duplicate and delete. Faces show who else is on each slide.

const THUMB = { desktop: 176, phone: 112 } // thumbnail width, in pixels

export function SlideList ({ slides, current, onPick, size, theme, canEdit, phone, people, sheetId, onAdd, onDuplicate, onDelete, onMove }) {
  const listRef = useRef(null)
  const [menu, setMenu] = useState(null) // { id, top, left } or { add: true, top, left }
  const [drag, setDrag] = useState(null) // { id, to } while dragging
  const width = phone ? THUMB.phone : THUMB.desktop
  const index = slides.findIndex((s) => s.id === current)

  // The current slide stays in view.
  useEffect(() => {
    const el = listRef.current && listRef.current.querySelector('.slide-thumb.current')
    if (el && el.scrollIntoView) el.scrollIntoView({ block: 'nearest', inline: 'nearest' })
  }, [current])

  function openMenu (e, what) {
    e.preventDefault()
    e.stopPropagation()
    const r = e.currentTarget.getBoundingClientRect ? e.currentTarget.getBoundingClientRect() : { left: e.clientX, bottom: e.clientY }
    const left = e.type === 'contextmenu' ? e.clientX : r.left
    const top = e.type === 'contextmenu' ? e.clientY : r.bottom + 4
    setMenu({ ...what, top: Math.min(top, window.innerHeight - 240), left: Math.max(4, Math.min(left, window.innerWidth - 220)) })
  }

  function onKeyDown (e) {
    const mod = e.ctrlKey || e.metaKey
    if (index < 0) return
    if (mod && (e.key === 'ArrowUp' || e.key === 'ArrowDown')) {
      e.preventDefault()
      if (!canEdit) return
      const up = e.key === 'ArrowUp'
      onMove(current, e.shiftKey ? (up ? 0 : slides.length - 1) : Math.max(0, Math.min(slides.length - 1, index + (up ? -1 : 1))))
      return
    }
    if (mod && e.key.toLowerCase() === 'd' && canEdit) { e.preventDefault(); onDuplicate(current); return }
    if (mod || e.altKey) return
    const go = { ArrowUp: index - 1, ArrowLeft: index - 1, ArrowDown: index + 1, ArrowRight: index + 1, Home: 0, End: slides.length - 1 }[e.key]
    if (go !== undefined) { e.preventDefault(); if (slides[go]) onPick(slides[go].id) }
    if ((e.key === 'Delete' || e.key === 'Backspace') && canEdit) { e.preventDefault(); onDelete(current) }
  }

  // Reorder by dragging with a mouse or pen; touch scrolls the list, and the
  // slide's menu moves it.
  function onPointerDown (e, id) {
    if (e.button !== 0 || e.pointerType === 'touch' || !canEdit) return
    const start = { x: e.clientX, y: e.clientY }
    let to = null
    const onMoveEv = (ev) => {
      if (to === null && Math.hypot(ev.clientX - start.x, ev.clientY - start.y) < 6) return
      // The gap nearest the pointer, 0 (before the first) to slides.length.
      const items = [...listRef.current.querySelectorAll('.slide-thumb')]
      to = items.length
      for (let i = 0; i < items.length; i++) {
        const r = items[i].getBoundingClientRect()
        if (phone ? ev.clientX < r.left + r.width / 2 : ev.clientY < r.top + r.height / 2) { to = i; break }
      }
      setDrag({ id, to })
    }
    const onUp = () => {
      window.removeEventListener('pointermove', onMoveEv)
      window.removeEventListener('pointerup', onUp)
      setDrag(null)
      if (to === null) return
      const from = slides.findIndex((s) => s.id === id)
      const at = to > from ? to - 1 : to // its place once it is out of the list
      if (at !== from) onMove(id, at)
    }
    window.addEventListener('pointermove', onMoveEv)
    window.addEventListener('pointerup', onUp)
  }

  const scale = width / size[0]
  const thumbH = Math.round(size[1] * scale)
  const m = menu && menu.id ? slides.findIndex((s) => s.id === menu.id) : -1

  return (
    <nav className={'slide-list' + (phone ? ' phone' : '')} aria-label='Slides'>
      {canEdit && !phone && (
        <div className='slide-add'>
          <button className='add-slide' onClick={() => onAdd('content')}><Plus size={16} /> New slide</button>
          <button className='add-layout' aria-label='New slide with a layout' title='New slide with a layout' onClick={(e) => openMenu(e, { add: true })}><CaretDown size={14} /></button>
        </div>
      )}
      <ol className='slide-thumbs' ref={listRef} tabIndex={0} onKeyDown={onKeyDown} aria-label='Slides'>
        {slides.map((s, i) => (
          <li
            key={s.id}
            className={'slide-thumb' + (s.id === current ? ' current' : '') + (drag && drag.id === s.id ? ' dragging' : '') + (drag && drag.to === i ? ' drop-before' : '') + (drag && drag.to === slides.length && i === slides.length - 1 ? ' drop-after' : '')}
            data-id={s.id}
            aria-current={s.id === current ? 'true' : undefined}
            onClick={() => onPick(s.id)}
            onPointerDown={(e) => onPointerDown(e, s.id)}
            onContextMenu={(e) => openMenu(e, { id: s.id })}
          >
            <span className='slide-number'>{i + 1}</span>
            <div className='thumb-frame' style={{ width, height: thumbH }}>
              <Thumb slide={s} size={size} theme={theme} scale={scale} root={listRef} />
              {(people.get(s.id) || []).length > 0 && (
                <span className='thumb-people'>
                  {people.get(s.id).slice(0, 3).map((p) => (
                    <span key={p.key} className='thumb-person' title={p.name} style={{ '--who': p.color }}>
                      {p.member ? <MemberAvatar sheetId={sheetId} member={p.member} size={18} /> : <Avatar name={p.name} seed={p.identity} size={18} />}
                    </span>
                  ))}
                </span>
              )}
            </div>
            <button className='thumb-more icon-button' aria-label='Slide menu' title='Slide menu' onPointerDown={(e) => e.stopPropagation()} onClick={(e) => openMenu(e, { id: s.id })}><DotsThree size={16} weight='bold' /></button>
          </li>
        ))}
        {canEdit && phone && (
          <li className='slide-thumb add'>
            <button className='add-slide' aria-label='New slide' title='New slide' style={{ width, height: thumbH }} onClick={(e) => openMenu(e, { add: true })}><Plus size={22} /></button>
          </li>
        )}
      </ol>
      {menu && <div className='doc-scrim' onPointerDown={() => setMenu(null)} />}
      {menu && menu.add && (
        <ul className='menu doc-pop layout-menu' role='menu' style={{ top: menu.top, left: menu.left }}>
          {LAYOUT_IDS.map((id) => <li key={id} role='menuitem' className={'layout-' + id} onClick={() => { setMenu(null); onAdd(id) }}>{LAYOUTS[id].label}</li>)}
        </ul>
      )}
      {menu && m >= 0 && (
        <ul className='menu doc-pop slide-menu' role='menu' style={{ top: menu.top, left: menu.left }} onClick={() => setMenu(null)}>
          {canEdit && <li role='menuitem' className='slide-new' onClick={() => { onPick(menu.id); onAdd('content', menu.id) }}>New slide after this</li>}
          {canEdit && <li role='menuitem' className='slide-duplicate' onClick={() => onDuplicate(menu.id)}>Duplicate</li>}
          {canEdit && m > 0 && <li role='menuitem' className='slide-up' onClick={() => onMove(menu.id, m - 1)}>Move up</li>}
          {canEdit && m < slides.length - 1 && <li role='menuitem' className='slide-down' onClick={() => onMove(menu.id, m + 1)}>Move down</li>}
          {canEdit && <li role='menuitem' className='slide-delete danger' onClick={() => onDelete(menu.id)}>Delete</li>}
          {!canEdit && <li role='menuitem' onClick={() => onPick(menu.id)}>Show this slide</li>}
        </ul>
      )}
    </nav>
  )
}

// A slide drawn small, once it has come into view.
function Thumb ({ slide, size, theme, scale, root }) {
  const ref = useRef(null)
  const [seen, setSeen] = useState(false)
  useEffect(() => {
    if (seen || !ref.current) return
    if (!window.IntersectionObserver) { setSeen(true); return }
    const io = new window.IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) setSeen(true) }, { root: root.current, rootMargin: '200px' })
    io.observe(ref.current)
    return () => io.disconnect()
  }, [seen])
  return (
    <div className='thumb' ref={ref}>
      {seen && <StaticSlide slide={slide} size={size} theme={theme} scale={scale} />}
    </div>
  )
}
