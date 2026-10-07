import React, { useEffect, useMemo, useRef } from 'react'
import { useEditor, EditorContent } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import Placeholder from '@tiptap/extension-placeholder'
import { notesExtensions } from '../doc/extensions.js'
import { undoForEditor } from './text.js'

// Speaker notes under the slide: an editor bound to the slide's `notes`
// fragment, sharing the deck's undo history. Remounted for each slide.
// onFocus hands the editor to the formatting tools.
export function Notes ({ fragment, undo, canEdit, phone, onFocus }) {
  const history = useMemo(() => undoForEditor(undo), [undo, fragment])
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const onFocusRef = useRef(onFocus)
  onFocusRef.current = onFocus
  const editor = useEditor({
    editable: canEdit,
    extensions: [
      ...notesExtensions(),
      Collaboration.configure({ fragment, yUndoOptions: { undoManager: history } }),
      Placeholder.configure({ showOnlyWhenEditable: false, placeholder: () => (canEditRef.current ? (phone ? 'Tap to add speaker notes' : 'Click to add speaker notes') : 'No speaker notes.') })
    ],
    editorProps: { attributes: { class: 'notes-body', 'aria-label': 'Speaker notes', spellcheck: 'true' } },
    onFocus: ({ editor: ed }) => onFocusRef.current(ed)
  }, [fragment])
  useEffect(() => { if (editor) editor.setEditable(canEdit) }, [editor, canEdit])
  useEffect(() => () => onFocusRef.current(null), [editor])
  return (
    <section className='slide-notes' onMouseDown={(e) => { if (e.target === e.currentTarget && editor && canEdit) { e.preventDefault(); editor.commands.focus('end') } }}>
      {editor && <EditorContent editor={editor} />}
    </section>
  )
}
