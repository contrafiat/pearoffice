// Tabs in the main window (desktop, proposals/2026-10-26-tabs.md). Every
// open tab keeps its editor loaded; only the one on screen counts as open
// for presence and takes the window-wide keys (Ctrl+P, zoom, F5).

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { KindIcon, untitled } from './Files.jsx'

export const MAX_TABS = 20
export const TabContext = createContext({ active: true })

// Is this file on screen: the page is visible and its tab is the one shown.
export function useOnScreen () {
  const { active } = useContext(TabContext)
  const [visible, setVisible] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const vis = () => setVisible(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])
  return visible && active
}

// Whether this editor's tab is shown, as a ref for window-wide key handlers.
export function useActiveRef () {
  const { active } = useContext(TabContext)
  const ref = useRef(active)
  ref.current = active
  return ref
}

// The tab list with `id` in it: added at the end, and past MAX_TABS the one
// used longest ago (`used`: id -> a count) closed.
export function withTab (tabs, id, used = {}) {
  if (tabs.includes(id)) return tabs
  const next = [...tabs, id]
  while (next.length > MAX_TABS) {
    const old = next.filter((x) => x !== id).sort((a, b) => (used[a] || 0) - (used[b] || 0))[0]
    next.splice(next.indexOf(old), 1)
  }
  return next
}

// Closing `id`: the tabs left and the one to show (the tab to its right,
// else its left, else none) when it was the one on screen.
export function withoutTab (tabs, id, current) {
  const i = tabs.indexOf(id)
  const next = tabs.filter((x) => x !== id)
  if (current !== id) return { tabs: next, current }
  return { tabs: next, current: next[Math.min(i, next.length - 1)] || null }
}

// The row of tabs. Shown from two tabs up.
export function TabBar ({ tabs, current, files, onPick, onClose, onMenu, onMove, onDragOut }) {
  const [dragging, setDragging] = useState(null)
  if (tabs.length < 2) return null
  const fileOf = (id) => (files || []).find((f) => f.sheetId === id)
  return (
    <div className='file-tabs' role='tablist' aria-label='Open files'>
      {tabs.map((id) => {
        const f = fileOf(id)
        const title = f ? f.title || untitled(f.kind) : 'Opening...'
        return (
          <div
            key={id}
            role='tab'
            aria-selected={id === current}
            className={'file-tab' + (id === current ? ' on' : '') + (dragging === id ? ' dragging' : '')}
            data-id={id}
            title={title}
            draggable
            onClick={() => onPick(id)}
            onAuxClick={(e) => { if (e.button === 1) { e.preventDefault(); onClose(id) } }}
            onMouseDown={(e) => { if (e.button === 1) e.preventDefault() }}
            onContextMenu={(e) => { e.preventDefault(); onMenu(id, { x: e.clientX, y: e.clientY }) }}
            onDragStart={(e) => { setDragging(id); e.dataTransfer.effectAllowed = 'move'; e.dataTransfer.setData('application/x-pearoffice-tab', id) }}
            onDragOver={(e) => { if (dragging && dragging !== id) { e.preventDefault(); e.dataTransfer.dropEffect = 'move' } }}
            onDrop={(e) => { e.preventDefault(); if (dragging && dragging !== id) onMove(dragging, id) }}
            onDragEnd={(e) => {
              setDragging(null)
              // Let go outside the window: the file gets its own window.
              const out = e.screenX < window.screenX || e.screenX > window.screenX + window.outerWidth || e.screenY < window.screenY || e.screenY > window.screenY + window.outerHeight
              if (out && e.dataTransfer.dropEffect === 'none') onDragOut(id)
            }}
          >
            <KindIcon kind={f ? f.kind : 'sheet'} size={16} />
            <span className='file-tab-title'>{title}</span>
            <button className='file-tab-close icon-button' aria-label={'Close ' + title} title='Close (Ctrl+W)' onClick={(e) => { e.stopPropagation(); onClose(id) }}><X size={14} /></button>
          </div>
        )
      })}
    </div>
  )
}
