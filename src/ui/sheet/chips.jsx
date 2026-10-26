// @ chips (proposals/2026-10-23-multi-select-and-smart-chips.md): the menu
// that typing @ opens in a cell, and the pills cells with a person, a file
// or folder link or a date chip are drawn as.

import React, { useLayoutEffect, useState } from 'react'
import { CalendarBlank, FolderSimple } from '@phosphor-icons/react'
import { MemberAvatar } from '../Avatar.jsx'
import { KindIcon, untitled } from '../Files.jsx'

const PEAR = /^pearoffice:\/\/(file|folder)\/([A-Za-z0-9_-]+)$/

// What the @ menu offers for the text after the @: people in the file, your
// files and folders, then dates. Each is { kind, label, ... }.
export function atItems (query, { members = [], files = [], folders = [] }) {
  const q = String(query || '').trim().toLowerCase()
  const has = (label) => !q || label.toLowerCase().includes(q)
  const out = []
  for (const m of members) if (m.name && has(m.name)) out.push({ kind: 'person', label: m.name, member: m })
  for (const f of files) { const label = f.title || untitled(f.kind); if (has(label)) out.push({ kind: 'file', label, file: f }) }
  for (const d of folders) if (has(d.name)) out.push({ kind: 'folder', label: d.name, folder: d })
  for (const [label, days] of [['Today', 0], ['Tomorrow', 1]]) if (has(label)) out.push({ kind: 'date', label, days })
  if (has('Pick a date')) out.push({ kind: 'date', label: 'Pick a date', pick: true })
  return out
}

export function AtMenu ({ items, selected, sheetId, onPick, anchor }) {
  const [pos, setPos] = useState(null)
  useLayoutEffect(() => {
    // Typing @ can open this before the cell's editor has focus.
    const el = anchor || [...document.querySelectorAll('input.editor')].find((x) => x.offsetParent !== null)
    if (!el) return setPos(null)
    const r = el.getBoundingClientRect()
    const vh = window.visualViewport ? window.visualViewport.height : window.innerHeight
    const below = r.bottom + 4
    setPos(vh - below < 220 ? { left: Math.max(4, r.left), bottom: vh - r.top + 4 } : { left: Math.max(4, r.left), top: below })
  }, [anchor, items.length])
  if (!items.length || !pos) return null
  let group = null
  return (
    <div className='formula-help at-menu' style={pos} role='listbox' aria-label='Insert a chip' onMouseDown={(e) => e.preventDefault()}>
      {items.map((it, i) => {
        const head = { person: 'People', file: 'Files', folder: 'Files', date: 'Dates' }[it.kind]
        const title = head !== group ? (group = head) : null
        return (
          <React.Fragment key={it.kind + ':' + (it.member ? it.member.identity : it.file ? it.file.sheetId : it.folder ? it.folder.id : it.label)}>
            {title && <div className='at-group'>{title}</div>}
            <div role='option' aria-selected={i === selected} className={'fh-item at-item' + (i === selected ? ' on' : '')} onClick={() => onPick(it)}>
              {it.kind === 'person' && <MemberAvatar sheetId={sheetId} member={it.member} size={20} />}
              {it.kind === 'file' && <KindIcon kind={it.file.kind} size={18} />}
              {it.kind === 'folder' && <FolderSimple size={18} weight='duotone' />}
              {it.kind === 'date' && <CalendarBlank size={18} />}
              <span>{it.label}</span>
            </div>
          </React.Fragment>
        )
      })}
    </div>
  )
}

// The pill for a cell with a chip, or null: a person (named from the member
// list, so a rename shows), a link to a file or folder, or a date chip.
export function smartChip (cell, { members = [], files = [] } = {}) {
  const fmt = (cell && cell.fmt) || {}
  if (!cell || cell.display === '' || cell.display === undefined) return null
  if (fmt.person) {
    const m = members.find((x) => x.identity === fmt.person)
    return { kind: 'person', text: (m && m.name) || cell.display, member: m || null }
  }
  const pear = PEAR.exec(fmt.link || '')
  if (pear) {
    const f = pear[1] === 'file' ? files.find((x) => x.sheetId === pear[2]) : null
    return { kind: pear[1], text: cell.display, fileKind: f ? f.kind : 'sheet' }
  }
  if (fmt.datechip && cell.kind === 'number') return { kind: 'date', text: cell.display }
  return null
}

export function SmartChip ({ chip, sheetId }) {
  return (
    <span className={'chip smart-chip' + (chip.kind === 'person' && !chip.member ? ' gone' : '')}>
      {chip.kind === 'person' && (chip.member ? <MemberAvatar sheetId={sheetId} member={chip.member} size={16} /> : null)}
      {chip.kind === 'file' && <KindIcon kind={chip.fileKind} size={14} />}
      {chip.kind === 'folder' && <FolderSimple size={14} weight='duotone' />}
      {chip.kind === 'date' && <CalendarBlank size={14} />}
      <span className='smart-chip-text'>{chip.text}</span>
    </span>
  )
}
