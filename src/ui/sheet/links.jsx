// Links in cells (proposals/2026-10-18-sheet-links.md): the bar that adds or
// changes one and the card under a selected linked cell.

import React, { useLayoutEffect, useState } from 'react'
import { LinkSimple, ArrowSquareOut, PencilSimple, Trash, X } from '@phosphor-icons/react'
import { colName } from './a1.js'
import { parseRange } from '../../sheet/charts.js'

const WEB = /^https?:\/\/\S+$/i

// 'Costs'!B4, or the tab's name alone.
const quoted = (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"

// What a cell's link is: { url } for a web or email link (also a cell whose
// whole text is a web address), { to } for a place in the file, { gone } when
// its tab was deleted, or null.
export function linkOf (cell) {
  if (!cell) return null
  const l = cell.fmt && cell.fmt.link
  if (l && l[0] === '#') return cell.linkTo && !cell.linkTo.gone ? { to: cell.linkTo } : { gone: true }
  if (l) return { url: l, stored: true }
  if (cell.kind === 'text' && typeof cell.display === 'string' && WEB.test(cell.display.trim())) return { url: cell.display.trim() }
  return null
}

export function linkLabel (link) {
  if (!link) return ''
  if (link.url) return link.url
  if (link.gone) return 'A deleted tab'
  const { name, row, col } = link.to
  return row ? quoted(name) + '!' + colName(col) + row : name
}

// What a person typed into the link bar, as sheet:setLink takes it: a web or
// email address (https:// added when there is no scheme), or { tabId, row,
// col } for B4, Costs!B4 or a tab's name.
export function parseLinkText (text, tabs, tabId) {
  const t = String(text || '').trim()
  if (!t) return null
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t
  const unq = t.replace(/^'(.*)'$/, '$1').replace(/''/g, "'")
  const tab = tabs.find((x) => x.name.toLowerCase() === unq.toLowerCase())
  if (tab) return { tabId: tab.id }
  const box = parseRange(t)
  if (box && !box.spill) {
    const to = box.sheet ? tabs.find((x) => x.name.toLowerCase() === box.sheet.toLowerCase()) : { id: tabId }
    if (!to) throw new Error('There is no tab called ' + box.sheet)
    return { tabId: to.id, row: box.r1, col: box.c1 }
  }
  if (/\s/.test(t)) throw new Error('That is not a link or a cell')
  return 'https://' + t
}

export function LinkBar ({ initial, hasLink, tabs, tabId, onApply, onRemove, onClose, onError }) {
  const [text, setText] = useState(initial || '')
  function apply () {
    let link
    try { link = parseLinkText(text, tabs, tabId) } catch (err) { onError(err.message); return }
    if (!link) { if (hasLink) onRemove(); else onClose(); return }
    onApply(link, text.trim())
  }
  return (
    <div className='doc-bar link-bar sheet-link-bar'>
      <LinkSimple size={18} aria-hidden='true' />
      <input
        autoFocus
        aria-label='Link address'
        placeholder='Paste a link, or type a cell like B4.'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      />
      {tabs.length > 1 && (
        <select aria-label='Link to a tab' value='' onChange={(e) => { const t = tabs.find((x) => x.id === e.target.value); if (t) setText(quoted(t.name) + '!A1') }}>
          <option value=''>Go to a tab...</option>
          {tabs.map((t) => <option key={t.id} value={t.id}>{t.name}</option>)}
        </select>
      )}
      <div className='doc-bar-buttons'>
        <button className='primary' onClick={apply}>Apply</button>
        {hasLink && <button onClick={onRemove}>Remove</button>}
      </div>
      <button className='icon-button close' aria-label='Close' title='Close' onClick={onClose}><X size={16} /></button>
    </div>
  )
}

// The card under a selected linked cell. It follows the cell as the grid
// scrolls, and hides while the cell is out of view.
export function LinkCard ({ row, col, link, canEdit, onOpen, onEdit, onRemove }) {
  const [at, setAt] = useState(null)
  useLayoutEffect(() => {
    function place () {
      const el = document.querySelector('.grid .cell[data-r="' + row + '"][data-c="' + col + '"]')
      const box = el && el.closest('.grid .body').getBoundingClientRect()
      const r = el && el.getBoundingClientRect()
      const next = !r || r.bottom < box.top || r.top > box.bottom - 20 || r.right < box.left || r.left > box.right
        ? null
        : { top: Math.round(Math.min(r.bottom + 4, window.innerHeight - 60)), left: Math.round(Math.max(8, Math.min(r.left, window.innerWidth - 320))) }
      setAt((was) => (was && next && was.top === next.top && was.left === next.left) || was === next ? was : next)
    }
    place()
    window.addEventListener('scroll', place, true)
    window.addEventListener('resize', place)
    return () => { window.removeEventListener('scroll', place, true); window.removeEventListener('resize', place) }
  })
  if (!at) return null
  const label = linkLabel(link)
  return (
    <div className='link-card' role='group' aria-label='Link' style={at} onMouseDown={(e) => e.stopPropagation()}>
      <span className='link-card-address' title={label}>{label}</span>
      {!link.gone && <button className='icon-button' title='Open link' aria-label='Open link' onClick={onOpen}><ArrowSquareOut size={16} /></button>}
      {canEdit && (link.stored || link.to || link.gone) && <button className='icon-button' title='Edit link' aria-label='Edit link' onClick={onEdit}><PencilSimple size={16} /></button>}
      {canEdit && (link.stored || link.to || link.gone) && <button className='icon-button' title='Remove link' aria-label='Remove link' onClick={onRemove}><Trash size={16} /></button>}
    </div>
  )
}
