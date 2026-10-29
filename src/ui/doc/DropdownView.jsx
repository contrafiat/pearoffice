// Dropdowns in the document editor (proposals/2026-10-29-document-dropdowns.md):
// the pill each dropdown node is drawn as, its choices, the Edit choices
// panel and Enter in a list carrying the dropdown to the next item. The
// lists themselves are in lists.js.

import React, { createContext, useContext, useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { NodeViewWrapper, ReactNodeViewRenderer } from '@tiptap/react'
import { TextSelection } from '@tiptap/pm/state'
import { CaretDown, CaretUp, Check, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import { CHIP_NAMES } from '../../sheet/validation.js'
import { Dropdown, dropdownText } from './extensions.js'
import { LISTS, readLists, itemOf, renameList, deleteList, setItem, deleteItem, moveItem, MAX_TEXT } from './lists.js'

// What the pills need from the editor around them: { ydoc, canEdit, phone,
// onEditList(listId) }. Each pill watches the lists itself.
export const DropdownContext = createContext({ ydoc: null, canEdit: false, phone: false, onEditList: () => {} })

// The document's lists, kept live.
export function useLists (ydoc) {
  const [lists, setLists] = useState(() => (ydoc ? readLists(ydoc) : []))
  useEffect(() => {
    if (!ydoc) return
    const map = ydoc.getMap(LISTS)
    const load = () => setLists(readLists(ydoc))
    load()
    map.observeDeep(load)
    return () => map.unobserveDeep(load)
  }, [ydoc])
  return lists
}

// The item's pill, as in a sheet's dropdown.
export const ChoicePill = ({ text, color }) => <span className={'chip chip-' + (color || 'grey')}>{text}</span>

function DropdownPill ({ node, updateAttributes }) {
  const { ydoc, canEdit, phone, onEditList } = useContext(DropdownContext)
  const lists = useLists(ydoc)
  const [open, setOpen] = useState(null) // { top, left } under the pill
  const a = node.attrs
  const list = lists.find((l) => l.id === a.list) || null
  const now = itemOf(lists, a.list, a.item)
  const shown = now || { text: dropdownText(a), color: 'grey' }
  const gone = !!a.item && !now
  const show = (e) => {
    e.preventDefault()
    e.stopPropagation()
    if (!canEdit) return
    const r = e.currentTarget.getBoundingClientRect()
    setOpen({ top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 220)) })
  }
  const pick = (it) => {
    setOpen(null)
    updateAttributes(it ? { item: it.id, text: it.text, color: it.color } : { item: '', text: '', color: 'grey' })
  }
  const choices = (
    <>
      {!list && <li className='pick-edit' aria-disabled='true'><span className='pick-tick' aria-hidden='true' />This list was deleted.</li>}
      {list && list.items.map((it) => (
        <li key={it.id} role='option' aria-selected={it.id === a.item} onClick={() => pick(it)}>
          <span className='pick-tick' aria-hidden='true'>{it.id === a.item && <Check size={16} weight='bold' />}</span><ChoicePill text={it.text} color={it.color} />
        </li>
      ))}
      {a.item && <li className='pick-edit pick-clear' role='option' aria-selected={false} onClick={() => pick(null)}><span className='pick-tick' aria-hidden='true'><X size={16} /></span>Clear</li>}
      {list && <li className='pick-edit' role='option' aria-selected={false} onClick={() => { setOpen(null); onEditList(list.id) }}><span className='pick-tick' aria-hidden='true'><PencilSimple size={16} /></span>Edit choices...</li>}
    </>
  )
  return (
    <NodeViewWrapper as='span' className={'doc-dropdown-view' + (gone ? ' gone' : '')} data-dropdown={a.list} title={gone ? 'This choice was deleted from the list.' : undefined}>
      <span className={'chip chip-' + shown.color + (a.item ? '' : ' empty') + (canEdit ? ' can-pick' : '')} contentEditable={false} onMouseDown={(e) => { if (canEdit) e.preventDefault() }} onClick={show}>
        {shown.text}{canEdit && <CaretDown className='dropdown-caret' size={12} weight='bold' />}
      </span>
      {open && createPortal(
        phone
          ? (
            <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) setOpen(null) }}>
              <section className='panel' role='dialog' aria-label='Pick a choice'>
                <header>
                  <h2>{list ? list.name : 'Choices'}</h2>
                  <button className='close' aria-label='Close' onClick={() => setOpen(null)}><X size={18} /></button>
                </header>
                <ul className='pick-list doc-choices' role='listbox'>{choices}</ul>
              </section>
            </div>
            )
          : (
            <>
              <div className='doc-scrim' onMouseDown={(e) => { e.preventDefault(); setOpen(null) }} />
              <ul className='menu pick-menu doc-choices' role='listbox' style={{ top: open.top, left: open.left }} onMouseDown={(e) => e.preventDefault()}>{choices}</ul>
            </>
            ),
        document.body
      )}
    </NodeViewWrapper>
  )
}

// Enter at the end of a list item that ends in a dropdown starts the next
// item with an empty dropdown of the same list, the caret before it. On an
// item with nothing but an empty dropdown, Enter leaves the list instead.
export function carryDropdown (editor) {
  const { state } = editor
  const { $from, empty } = state.selection
  if (!empty || !$from.parent.isTextblock || $from.depth < 2) return false
  const para = $from.parent
  const last = para.lastChild
  if (!last || last.type.name !== 'dropdown') return false
  const item = $from.node($from.depth - 1)
  if (item.type.name !== 'listItem' && item.type.name !== 'taskItem') return false
  // Only spaces between the caret and the pill.
  const rest = para.cut($from.parentOffset).content
  for (let i = 0; i < rest.childCount - 1; i++) {
    const n = rest.child(i)
    if (!n.isText || n.text.trim()) return false
  }
  let words = ''
  let others = 0
  para.forEach((n) => { if (n.isText) words += n.text; else others++ })
  const type = item.type.name
  if (!words.trim() && others === 1 && !last.attrs.item) {
    return editor.chain().command(({ tr }) => { tr.delete($from.start(), $from.end()); return true }).liftListItem(type).run()
  }
  return editor.chain().setTextSelection($from.end()).splitListItem(type).command(({ tr }) => {
    const pos = tr.selection.from
    tr.insert(pos, [state.schema.text(' '), state.schema.nodes.dropdown.create({ list: last.attrs.list })])
    tr.setSelection(TextSelection.create(tr.doc, pos))
    return true
  }).run()
}

export const DropdownView = Dropdown.extend({
  // Ahead of the list items' own Enter.
  priority: 200,
  addNodeView () {
    return ReactNodeViewRenderer(DropdownPill, { as: 'span', className: 'doc-dropdown-node' })
  },
  addKeyboardShortcuts () {
    return { Enter: ({ editor }) => carryDropdown(editor) }
  }
})

// A dropdown of the list `listId` at the caret, with a space before it when
// it follows a word.
export function insertDropdown (editor, listId) {
  const { $from } = editor.state.selection
  const before = $from.parent.isTextblock ? $from.parent.textBetween(Math.max(0, $from.parentOffset - 1), $from.parentOffset, null, '￼') : ''
  const content = [{ type: 'dropdown', attrs: { list: listId } }]
  if (before && !/\s/.test(before)) content.unshift({ type: 'text', text: ' ' })
  editor.chain().focus().insertContent(content).run()
}

// Did this transaction put a dropdown in (typed, pasted or undone)?
export function addsDropdown (tr) {
  let found = false
  for (const step of tr.steps) {
    if (found || !step.slice) continue
    step.slice.content.descendants((n) => { if (n.type.name === 'dropdown') found = true; return !found })
  }
  return found
}

// Edit choices: the list's name and its choices, each with a colour, moved
// up or down or deleted, and a new one at the end.
export function ListPanel ({ ydoc, listId, lists, onClose, onError }) {
  const list = lists.find((l) => l.id === listId)
  const [name, setName] = useState(list ? list.name : '')
  const [adding, setAdding] = useState('')
  const [choosing, setChoosing] = useState(null) // the item whose colour is being picked
  const [deleting, setDeleting] = useState(false)
  const addRef = useRef(null)
  useEffect(() => { if (!list) onClose() }, [list]) // eslint-disable-line react-hooks/exhaustive-deps
  if (!list) return null
  const act = (fn) => { try { fn() } catch (err) { onError(err.message) } }
  const add = () => act(() => { if (setItem(ydoc, listId, null, { text: adding })) setAdding('') })
  const saveName = () => act(() => renameList(ydoc, listId, name))
  const chosen = choosing && list.items.find((it) => it.id === choosing)
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) { saveName(); onClose() } }}>
      <section className='panel list-panel' role='dialog' aria-label='Edit choices'>
        <header>
          <h2>Edit choices</h2>
          <button className='close' aria-label='Close' onClick={() => { saveName(); onClose() }}><X size={18} /></button>
        </header>
        <label className='field'>
          <span>List name</span>
          <input className='list-name' value={name} maxLength={MAX_TEXT} onChange={(e) => setName(e.target.value)} onBlur={saveName} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
        </label>
        <ul className='list-items'>
          {list.items.map((it, i) => (
            <li key={it.id}>
              <button className={'chip-dot chip-' + it.color + (choosing === it.id ? ' on' : '')} title='Pick a colour' aria-label={'Colour for ' + it.text} onClick={() => setChoosing(choosing === it.id ? null : it.id)} />
              <ItemText text={it.text} onSave={(text) => act(() => setItem(ydoc, listId, it.id, { text }))} />
              <button className='icon-button' title='Move up' aria-label={'Move ' + it.text + ' up'} disabled={i === 0} onClick={() => moveItem(ydoc, listId, it.id, -1)}><CaretUp size={16} /></button>
              <button className='icon-button' title='Move down' aria-label={'Move ' + it.text + ' down'} disabled={i === list.items.length - 1} onClick={() => moveItem(ydoc, listId, it.id, 1)}><CaretDown size={16} /></button>
              <button className='icon-button danger' title='Delete' aria-label={'Delete ' + it.text} onClick={() => deleteItem(ydoc, listId, it.id)}><Trash size={16} /></button>
            </li>
          ))}
        </ul>
        {chosen && (
          <div className='chip-swatches' role='radiogroup' aria-label={'Colour for ' + chosen.text}>
            {CHIP_NAMES.map((c) => (
              <button key={c} role='radio' aria-checked={chosen.color === c} aria-label={c} title={c} className={'chip-' + c + (chosen.color === c ? ' on' : '')} onClick={() => { act(() => setItem(ydoc, listId, chosen.id, { color: c })); setChoosing(null) }} />
            ))}
          </div>
        )}
        <div className='list-add'>
          <input ref={addRef} className='list-new' placeholder='Add a choice' value={adding} maxLength={MAX_TEXT} onChange={(e) => setAdding(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') add() }} />
          <button className='icon-button' title='Add' aria-label='Add a choice' disabled={!adding.trim()} onClick={() => { add(); addRef.current && addRef.current.focus() }}><Plus size={18} /></button>
        </div>
        {deleting
          ? (
            <>
              <p className='small'>Delete this list? Its dropdowns keep their last choice as grey text.</p>
              <div className='row equal'>
                <button onClick={() => setDeleting(false)}>No</button>
                <button className='danger' onClick={() => { deleteList(ydoc, listId); onClose() }}>Delete</button>
              </div>
            </>
            )
          : (
            <div className='row equal'>
              <button className='danger list-delete' onClick={() => setDeleting(true)}>Delete list</button>
              <button className='primary' onClick={() => { saveName(); onClose() }}>Done</button>
            </div>
            )}
      </section>
    </div>
  )
}

// A choice's text, saved when it loses focus or on Enter.
function ItemText ({ text, onSave }) {
  const [v, setV] = useState(text)
  useEffect(() => setV(text), [text])
  return <input className='list-item' value={v} maxLength={MAX_TEXT} aria-label='Choice' onChange={(e) => setV(e.target.value)} onBlur={() => { if (v.trim() && v !== text) onSave(v); else setV(text) }} onKeyDown={(e) => { if (e.key === 'Enter') e.currentTarget.blur() }} />
}
