// The app's menus: the ⋯ menu, a file's right-click menu and the tab menu.
// Items are { label, onSelect, className, danger, items } or '-' for a
// line; `items` makes a submenu (Save as ▸). A menu is placed where it fits
// in the window: under (or over) its button, or at the pointer, as tall as
// the window allows and scrolling past that. On desktop a submenu opens
// beside its item; on a phone, picking it shows its items in place, with a
// way back.

import React, { useLayoutEffect, useRef, useState } from 'react'
import { CaretLeft, CaretRight } from '@phosphor-icons/react'
import { isMobile } from './save.js'

const GAP = 8 // kept clear of the window's edges

// Where a box of size w x h goes: under `below` (a rect, else at the point
// x, y), flipped above when there is more room there, kept inside the
// window, with the height it may use.
function place ({ w, h }, { anchor, x, y, side }) {
  const vw = window.innerWidth
  const vh = window.innerHeight
  let left
  let top
  if (side) {
    // A submenu: beside its item, on the left when there is no room right.
    left = side.right + w + GAP <= vw ? side.right - 2 : Math.max(GAP, side.left - w + 2)
    top = side.top - 4
  } else if (anchor) {
    left = anchor.right - w // right-aligned under its button
    top = anchor.bottom + 4
    const above = anchor.top - 4
    if (top + h > vh - GAP && above - GAP > vh - top - GAP) top = Math.max(GAP, above - h)
  } else {
    left = x
    top = y + 4
    if (top + h > vh - GAP && y - GAP > vh - y - GAP) top = Math.max(GAP, y - h)
  }
  left = Math.max(GAP, Math.min(left, vw - w - GAP))
  const maxHeight = vh - GAP * 2
  top = Math.max(GAP, Math.min(top, vh - Math.min(h, maxHeight) - GAP))
  return { left, top, maxHeight }
}

function Panel ({ items, where, className, onDone, depth = 0, label, onBack }) {
  const ref = useRef(null)
  const [pos, setPos] = useState(null)
  const [open, setOpen] = useState(null) // { index, rect } of the open submenu
  const [drill, setDrill] = useState(null) // phones: the submenu shown in place
  const phone = isMobile()
  useLayoutEffect(() => {
    const el = ref.current
    if (!el) return
    setPos(place({ w: el.offsetWidth, h: el.scrollHeight }, where))
  }, [where.anchor, where.x, where.y, where.side, items.length, drill]) // eslint-disable-line react-hooks/exhaustive-deps

  const list = drill ? drill.items : items
  const pick = (it, i, e) => {
    if (it.items) {
      e.stopPropagation() // opening a submenu is not a pick: the menu stays
      if (phone) { setDrill(it); return }
      const r = e.currentTarget.getBoundingClientRect()
      setOpen(open && open.index === i ? null : { index: i, rect: r })
      return
    }
    onDone()
    if (it.onSelect) it.onSelect()
  }
  const hover = (it, i, e) => {
    if (phone) return
    if (!it.items) { if (open) setOpen(null); return }
    if (!open || open.index !== i) setOpen({ index: i, rect: e.currentTarget.getBoundingClientRect() })
  }
  return (
    <>
      <ul
        ref={ref}
        className={'menu' + (className ? ' ' + className : '') + (depth ? ' submenu' : '')}
        role='menu'
        aria-label={label}
        style={pos ? { left: pos.left, top: pos.top, maxHeight: pos.maxHeight } : { visibility: 'hidden', left: 0, top: 0 }}
      >
        {(drill || onBack) && (
          <li role='menuitem' className='menu-back' onClick={(e) => { e.stopPropagation(); if (drill) setDrill(null); else onBack() }}><CaretLeft size={14} /> {drill ? drill.label : 'Back'}</li>
        )}
        {list.map((it, i) => (it === '-'
          ? <li key={'sep' + i} role='separator' className='menu-sep' onClick={(e) => e.stopPropagation()} />
          : (
            <li
              key={it.label + i}
              role='menuitem'
              aria-haspopup={it.items ? 'menu' : undefined}
              aria-expanded={it.items ? !!(open && open.index === i) : undefined}
              className={[it.className, it.danger && 'danger', it.items && 'has-sub', open && open.index === i && 'on'].filter(Boolean).join(' ') || undefined}
              onClick={(e) => pick(it, i, e)}
              onMouseEnter={(e) => hover(it, i, e)}
            >
              <span className='menu-label'>{it.label}</span>
              {it.items && <CaretRight size={12} className='menu-caret' aria-hidden='true' />}
            </li>
            )))}
      </ul>
      {open && list[open.index] && list[open.index].items && (
        <Panel items={list[open.index].items} where={{ side: open.rect }} className={className} onDone={onDone} depth={depth + 1} label={list[open.index].label} />
      )}
    </>
  )
}

// `where`: { anchor } (the button's rect) or { x, y } (the pointer).
// `onClose` runs when an item is picked; closing on a press outside or
// Esc is the caller's.
export function Menu ({ items, where, className, onClose, label }) {
  const shown = items.filter((it, i, a) => it && !(it === '-' && (i === 0 || a[i - 1] === '-' || i === a.length - 1)))
  return <Panel items={shown} where={where} className={className} onDone={onClose} label={label} />
}

// Drops empty submenus and false entries, so callers can write
// `canEdit && { ... }`.
export function menuItems (list) {
  return list.filter(Boolean).map((it) => (it === '-' || !it.items ? it : { ...it, items: it.items.filter(Boolean) })).filter((it) => it === '-' || !it.items || it.items.length)
}
