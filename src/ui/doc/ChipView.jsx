// @ chips in the document editor (proposals/2026-10-26-document-chips.md):
// the pill each chip node is drawn as, the @ menu's trigger and what a pick
// inserts. The menu and the pills are the sheet's (src/ui/sheet/chips.jsx).

import React, { createContext, useContext, useRef } from 'react'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { CalendarBlank, ArrowSquareOut } from '@phosphor-icons/react'
import { Chip, chipText, chipHref } from './extensions.js'
import { SmartChip } from '../sheet/chips.jsx'
import { openOutside, dayLink } from '../pearLinks.js'

// What the pills need from the editor around them: { sheetId, members,
// placeOf (pearLinks.js), canEdit }.
export const ChipContext = createContext({ members: [], placeOf: (l) => l, canEdit: false })

function ChipPill ({ node, updateAttributes }) {
  const { sheetId, members, placeOf, canEdit } = useContext(ChipContext)
  const input = useRef(null)
  const a = node.attrs
  let chip
  if (a.kind === 'person') {
    const m = members.find((x) => x.identity === a.id)
    chip = { kind: 'person', text: (m && m.name) || chipText(a), member: m || null }
  } else if (a.kind === 'file' || a.kind === 'folder') {
    const l = placeOf({ [a.kind]: a.id })
    chip = { kind: a.kind, text: l.name || chipText(a), fileKind: l.kind || 'sheet', gone: !!l.missing }
  } else {
    chip = { kind: 'date', text: chipText(a) }
  }
  // The calendar button on a date: the system date picker.
  const pick = (e) => {
    e.preventDefault()
    e.stopPropagation()
    const el = input.current
    el.value = a.date || ''
    try { el.showPicker() } catch { el.click() }
  }
  const picked = (e) => {
    const v = e.target.value
    if (/^\d{4}-\d{2}-\d{2}$/.test(v) && v !== a.date) updateAttributes({ date: v })
  }
  return (
    <NodeViewWrapper as='span' className={'doc-chip-view' + (chip.gone ? ' gone' : '')} data-chip={a.kind} data-href={chipHref(a) || undefined} title={chip.gone ? (a.kind === 'file' ? "You don't have this file." : 'This folder is not one of yours.') : undefined}>
      <SmartChip chip={chip} sheetId={sheetId} />
      {a.kind === 'date' && canEdit && (
        <>
          <button className='chip-calendar' title='Change the date' aria-label='Change the date' contentEditable={false} onMouseDown={(e) => e.preventDefault()} onClick={pick}><CalendarBlank size={14} /></button>
          <input ref={input} type='date' className='chip-date-input' tabIndex={-1} aria-hidden='true' onChange={picked} />
        </>
      )}
      {a.kind === 'date' && /^\d{4}-\d{2}-\d{2}$/.test(a.date || '') && (
        // The day in PearCal (/home/tim/peerloomllc/proposals/2026-10-26-pearcal-pearoffice-links.md).
        <button className='chip-calendar chip-pearcal' title='Open in PearCal' aria-label='Open in PearCal' contentEditable={false} onMouseDown={(e) => e.preventDefault()} onClick={(e) => { e.preventDefault(); e.stopPropagation(); openOutside(dayLink(a.date)) }}><ArrowSquareOut size={14} /></button>
      )}
    </NodeViewWrapper>
  )
}

export const ChipView = Chip.extend({
  addNodeView () {
    return ReactNodeViewRenderer(ChipPill, { as: 'span', className: 'doc-chip-node' })
  }
})

// The @ being typed before the caret, at the start of a line or after a
// space: { from, to, query }, or null.
export function atTrigger (state) {
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock) return null
  const before = $from.parent.textBetween(Math.max(0, $from.parentOffset - 40), $from.parentOffset, null, '￼')
  const m = /(?:^|\s)@([^\s@￼]{0,30})$/.exec(before)
  return m ? { from: $from.pos - m[1].length - 1, to: $from.pos, query: m[1] } : null
}

const isoDay = (days) => {
  const d = new Date()
  d.setDate(d.getDate() + days)
  return d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0') + '-' + String(d.getDate()).padStart(2, '0')
}

// The chip node for an item of the @ menu (atItems).
export function chipFor (it) {
  if (it.kind === 'person') return { kind: 'person', id: it.member.identity, text: it.label }
  if (it.kind === 'file') return { kind: 'file', id: it.file.sheetId, text: it.label }
  if (it.kind === 'folder') return { kind: 'folder', id: it.folder.id, text: it.label }
  return { kind: 'date', date: isoDay(it.days || 0) }
}

// Did this transaction put a chip in (typed, pasted or undone)?
export function addsChip (tr) {
  let found = false
  for (const step of tr.steps) {
    if (found || !step.slice) continue
    step.slice.content.descendants((n) => { if (n.type.name === 'chip') found = true; return !found })
  }
  return found
}
