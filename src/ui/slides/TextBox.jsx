import React, { useEffect, useMemo, useRef, useState } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { slideExtensions } from '../doc/extensions.js'
import { cursorOf, remoteCursors, RemoteCursors } from '../doc/DocView.jsx'
import { fragmentDom, isEmptyFragment, undoForEditor } from './text.js'
import { TEXT_SCALE } from './geometry.js'

// A text box's text (proposals/2026-10-06-slides.md, Text boxes). Only the
// box being edited has a live TipTap editor bound to its fragment; the rest
// draw the fragment as plain DOM, which keeps a deck of many boxes light.
// Both draw inside .slide-text, which scales the text so that sizes are
// points of a slide (geometry.js, TEXT_SCALE).

export function placeholderFor (role, phone) {
  if (role === 'title') return phone ? 'Tap to add title' : 'Click to add title'
  if (role === 'body' || role === 'body2') return phone ? 'Tap to add text' : 'Click to add text'
  return ''
}

export function TextFrame ({ frame, role, children }) {
  const style = { width: frame.w / TEXT_SCALE, height: frame.h / TEXT_SCALE, transform: 'scale(' + TEXT_SCALE + ')' }
  return <div className={'slide-text' + (role === 'title' ? ' role-title' : '')} style={style}>{children}</div>
}

// The fragment drawn as DOM, redrawn when it changes. `placeholder` shows
// while it is empty.
// markEmpty marks an empty box, so it can be outlined and found.
export function StaticText ({ fragment, placeholder, markEmpty }) {
  const ref = useRef(null)
  const [empty, setEmpty] = useState(() => isEmptyFragment(fragment))
  useEffect(() => {
    if (!fragment) return
    const draw = () => {
      const el = ref.current
      if (!el) return
      const dom = fragmentDom(fragment)
      if (dom) el.replaceChildren(dom)
      else el.replaceChildren()
      setEmpty(isEmptyFragment(fragment))
    }
    draw()
    fragment.observeDeep(draw)
    return () => fragment.unobserveDeep(draw)
  }, [fragment])
  return (
    <>
      <div className='slide-body slide-static' ref={ref} />
      {empty && placeholder && <p className='slide-placeholder'>{placeholder}</p>}
      {empty && markEmpty && <span className='slide-empty-mark' />}
    </>
  )
}

// The live editor for the box being edited. `start` says where the caret
// goes once it opens: { point } (where a double click landed), { text } (a
// key typed on the selected box) or nothing (the end). onEditor gets the
// editor (for the formatting tools) and null when it closes.
export function LiveText ({ fragment, undo, placeholder, canEdit, cursors, onCursor, onEditor, start, label }) {
  const others = useMemo(() => remoteCursors(), [fragment])
  const history = useMemo(() => undoForEditor(undo), [undo, fragment])
  const editor = useEditor({
    editable: canEdit,
    extensions: [
      ...slideExtensions(),
      Collaboration.configure({ fragment, yUndoOptions: { undoManager: history } }),
      Placeholder.configure({ placeholder: () => placeholder || '' }),
      RemoteCursors.configure({ others })
    ],
    editorProps: { attributes: { class: 'slide-body', 'aria-label': label, spellcheck: 'true' } }
  }, [fragment])
  useEffect(() => { if (editor) editor.setEditable(canEdit) }, [editor, canEdit])

  const onEditorRef = useRef(onEditor)
  onEditorRef.current = onEditor
  const startRef = useRef(start)
  useEffect(() => {
    if (!editor) return
    onEditorRef.current(editor)
    const t = setTimeout(() => {
      if (editor.isDestroyed) return
      const s = startRef.current || {}
      const at = s.point && editor.view.posAtCoords({ left: s.point.x, top: s.point.y })
      if (at) editor.chain().focus().setTextSelection(at.pos).run()
      else editor.commands.focus('end')
      if (s.text) editor.commands.insertContent(s.text)
    }, 0)
    return () => { clearTimeout(t); onEditorRef.current(null) }
  }, [editor])

  // The others typing in this box, and this person's caret out.
  const cursorsKey = JSON.stringify(cursors)
  useEffect(() => { others.set(cursors) }, [others, cursorsKey])
  const onCursorRef = useRef(onCursor)
  onCursorRef.current = onCursor
  useEffect(() => {
    if (!editor) return
    let redraw = null
    const report = ({ transaction }) => {
      if (transaction && !transaction.docChanged && !transaction.selectionSet) return
      if (transaction && transaction.docChanged && !redraw) redraw = setTimeout(() => { redraw = null; others.refresh() }, 0)
      const c = cursorOf(editor.state)
      if (c) onCursorRef.current(c)
    }
    report({})
    editor.on('transaction', report)
    return () => { clearTimeout(redraw); editor.off('transaction', report) }
  }, [editor, others])

  if (!editor) return null
  return <EditorContent editor={editor} className='slide-live' />
}

// Where a box sits on the slide, in slide units.
export const boxStyle = (f) => ({ left: f.x, top: f.y, width: f.w, height: f.h, transform: f.rot ? 'rotate(' + f.rot + 'deg)' : undefined })
