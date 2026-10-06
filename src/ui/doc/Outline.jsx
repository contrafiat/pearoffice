import React from 'react'
import { useEditorState } from '@tiptap/react'
import { X } from '@phosphor-icons/react'

// The document's outline: its Title and headings 1 to 3, read live from the
// editor. A side panel on desktop, a bottom sheet on phones.

// The top-level Title paragraphs (level 0) and headings, with their positions.
export function outlineOf (doc) {
  const out = []
  doc.forEach((node, pos) => {
    const level = node.type.name === 'heading' ? node.attrs.level : node.type.name === 'paragraph' && node.attrs.blockStyle === 'title' ? 0 : -1
    if (level >= 0 && level <= 3) out.push({ pos, level, text: node.textContent.trim() })
  })
  return out
}

export function Outline ({ editor, phone, onClose }) {
  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      const items = outlineOf(ed.state.doc)
      const at = ed.state.selection.from
      let active = -1
      items.forEach((it, i) => { if (it.pos < at) active = i })
      return { items, active }
    }
  })
  function go (it) {
    const c = editor.chain()
    if (!phone) c.focus()
    c.setTextSelection(it.pos + 1).run()
    const dom = editor.view.nodeDOM(it.pos)
    if (dom && dom.scrollIntoView) dom.scrollIntoView({ block: 'start' })
    if (phone) onClose()
  }
  const list = s.items.length
    ? (
      <ul className='outline-list'>
        {s.items.map((it, i) => (
          <li key={i}>
            <button className={'outline-item level-' + it.level + (i === s.active ? ' on' : '')} aria-current={i === s.active ? 'location' : undefined} title={it.text} onClick={() => go(it)}>
              {it.text || <span className='muted'>Empty heading</span>}
            </button>
          </li>
        ))}
      </ul>
      )
    : <p className='muted outline-empty'>Headings you add appear here.</p>
  if (phone) {
    return (
      <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
        <section className='panel outline-panel' role='dialog' aria-label='Outline'>
          <header>
            <h2>Outline</h2>
            <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
          </header>
          {list}
        </section>
      </div>
    )
  }
  return (
    <aside className='doc-outline' aria-label='Outline'>
      <header>
        <h2>Outline</h2>
        <button className='close' aria-label='Close the outline' title='Close' onClick={onClose}><X size={16} /></button>
      </header>
      {list}
    </aside>
  )
}
