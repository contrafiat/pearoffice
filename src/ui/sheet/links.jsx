// Links in cells (proposals/2026-10-18-sheet-links.md): the bar that adds or
// changes one and the card under a selected linked cell.

import React, { useLayoutEffect, useState } from 'react'
import { LinkSimple, ArrowSquareOut, PencilSimple, Trash, X } from '@phosphor-icons/react'
import { colName } from './a1.js'
import { parseRange } from '../../sheet/charts.js'
import { untitled } from '../Files.jsx'

import { pearLink, fileLink, folderLink, pearcalLabel } from '../pearLinks.js'

const WEB = /^https?:\/\/\S+$/i
export { fileLink, folderLink }

// 'Costs'!B4, or the tab's name alone.
const quoted = (name) => /^[A-Za-z_][A-Za-z0-9_]*$/.test(name) ? name : "'" + name.replace(/'/g, "''") + "'"

// What a cell's link is: { url } for a web or email link (also a cell whose
// whole text is a web address), { to } for a place in the file, { gone } when
// its tab was deleted, { file } or { folder } with the id for another file or
// a folder, or null. `formula` marks one from HYPERLINK.
export function linkOf (cell) {
  if (!cell) return null
  const l = cell.fmt && cell.fmt.link
  if (l && l[0] === '#') return cell.linkTo && !cell.linkTo.gone ? { to: cell.linkTo } : { gone: true }
  const pear = pearLink(l)
  if (pear) return { ...pear, stored: true }
  if (l) return { url: l, stored: true }
  // From a HYPERLINK formula: opened from here, changed in the formula.
  if (cell.formulaLink) return cell.formulaLink === '#' ? (cell.linkTo ? { to: cell.linkTo, formula: true } : null) : { url: cell.formulaLink, formula: true }
  if (cell.kind === 'text' && typeof cell.display === 'string' && WEB.test(cell.display.trim())) return { url: cell.display.trim() }
  return null
}

// A link the cell itself holds, which the link bar can change or remove.
export const ownLink = (l) => !!(l && !l.formula && (l.stored || l.to || l.gone))

export function linkLabel (link) {
  if (!link) return ''
  if (link.dayChip) return 'Open in PearCal'
  if (link.url) return pearcalLabel(link.url) || link.url
  if (link.file || link.folder) return link.missing || link.name || (link.file ? 'A PearOffice file' : 'A folder')
  if (link.gone) return 'A deleted tab'
  const { name, row, col, row2, col2, rangeName } = link.to
  if (rangeName) return rangeName
  return row ? quoted(name) + '!' + colName(col) + row + (row2 ? ':' + colName(col2) + row2 : '') : name
}

// What a person typed into the link bar, as sheet:setLink takes it: a web or
// email address (https:// added when there is no scheme), { tabId, row, col,
// row2, col2 } for B4, Costs!B4, B4:D9 or a tab's name, or { name } for a
// named range.
export function parseLinkText (text, tabs, tabId, names = []) {
  const t = String(text || '').trim()
  if (!t) return null
  // B4:D9 looks like a scheme ("B4:"), so cells and ranges come first.
  const unq = t.replace(/^'(.*)'$/, '$1').replace(/''/g, "'")
  const tab = tabs.find((x) => x.name.toLowerCase() === unq.toLowerCase())
  if (tab) return { tabId: tab.id }
  const named = names.find((n) => n.name.toLowerCase() === t.toLowerCase())
  if (named) return { name: named.name }
  const box = parseRange(t)
  if (box && !box.spill) {
    const to = box.sheet ? tabs.find((x) => x.name.toLowerCase() === box.sheet.toLowerCase()) : { id: tabId }
    if (!to) throw new Error('There is no tab called ' + box.sheet)
    const one = box.r1 === box.r2 && box.c1 === box.c2
    return { tabId: to.id, row: box.r1, col: box.c1, ...(one ? {} : { row2: box.r2, col2: box.c2 }) }
  }
  if (/^[a-z][a-z0-9+.-]*:/i.test(t)) return t
  if (/\s/.test(t)) throw new Error('That is not a link or a cell')
  return 'https://' + t
}

// `pick` is a file or folder link in the bar: { text, link }, kept while
// the box still shows its name.
export function LinkBar ({ initial, initialPick, hasLink, tabs, tabId, names = [], files = [], folders = [], onApply, onRemove, onClose, onError }) {
  const [text, setText] = useState(initial || '')
  const [pick, setPick] = useState(initialPick || null)
  function choose (v) {
    const t = tabs.find((x) => 'tab:' + x.id === v)
    const f = files.find((x) => 'file:' + x.sheetId === v)
    const d = folders.find((x) => 'folder:' + x.id === v)
    if (t) setText(quoted(t.name) + '!A1')
    else if (v.startsWith('name:')) setText(v.slice(5))
    else if (f || d) {
      const name = f ? f.title || untitled(f.kind) : d.name
      setText(name)
      setPick({ text: name, link: f ? fileLink(f.sheetId) : folderLink(d.id) })
    }
  }
  function apply () {
    if (pick && text.trim() === pick.text) { onApply(pick.link, pick.text); return }
    let link
    try { link = parseLinkText(text, tabs, tabId, names) } catch (err) { onError(err.message); return }
    if (!link) { if (hasLink) onRemove(); else onClose(); return }
    onApply(link, text.trim())
  }
  return (
    <div className='doc-bar link-bar sheet-link-bar'>
      <LinkSimple size={18} aria-hidden='true' />
      <input
        autoFocus
        aria-label='Link address'
        placeholder='Paste a link, or type a cell like B4 or a range.'
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } if (e.key === 'Escape') { e.preventDefault(); onClose() } }}
      />
      {(tabs.length > 1 || names.length > 0 || files.length > 0 || folders.length > 0) && (
        <select aria-label='Link to a tab, named range, file or folder' value='' onChange={(e) => choose(e.target.value)}>
          <option value=''>Go to...</option>
          {tabs.length > 1 && <optgroup label='Tabs'>{tabs.map((t) => <option key={t.id} value={'tab:' + t.id}>{t.name}</option>)}</optgroup>}
          {names.length > 0 && <optgroup label='Named ranges'>{names.map((n) => <option key={n.name} value={'name:' + n.name}>{n.name}</option>)}</optgroup>}
          {files.length > 0 && <optgroup label='Files'>{files.map((f) => <option key={f.sheetId} value={'file:' + f.sheetId}>{f.title || untitled(f.kind)}</option>)}</optgroup>}
          {folders.length > 0 && <optgroup label='Folders'>{folders.map((d) => <option key={d.id} value={'folder:' + d.id}>{d.name}</option>)}</optgroup>}
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
      // The shown grid's cell: other tabs keep theirs hidden (tabs.jsx).
      const el = [...document.querySelectorAll('.grid .cell[data-r="' + row + '"][data-c="' + col + '"]')].find((x) => x.offsetParent !== null)
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
      {link.dayChip
        ? <button className='link-button link-card-address' onClick={onOpen}>{label}</button>
        : <span className='link-card-address' title={label}>{label}</span>}
      {!link.gone && !link.missing && <button className='icon-button' title='Open link' aria-label='Open link' onClick={onOpen}><ArrowSquareOut size={16} /></button>}
      {canEdit && ownLink(link) && <button className='icon-button' title='Edit link' aria-label='Edit link' onClick={onEdit}><PencilSimple size={16} /></button>}
      {canEdit && ownLink(link) && <button className='icon-button' title='Remove link' aria-label='Remove link' onClick={onRemove}><Trash size={16} /></button>}
    </div>
  )
}
