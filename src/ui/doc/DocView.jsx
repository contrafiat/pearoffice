import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import Collaboration from '@tiptap/extension-collaboration'
import Typography from '@tiptap/extension-typography'
import Placeholder from '@tiptap/extension-placeholder'
import { CharacterCount } from '@tiptap/extensions'
import { Extension } from '@tiptap/core'
import { NodeSelection } from '@tiptap/pm/state'
import { yCursorPlugin, ySyncPluginKey, absolutePositionToRelativePosition } from '@tiptap/y-tiptap'
import { call, on } from '../bridge.js'
import { FileBar, useMembers } from '../FileBar.jsx'
import { colourFor } from '../Avatar.jsx'
import { readPref, writePref } from '../prefs.js'
import { isMobile } from '../sheet/xlsx.js'
import { exportDocument, tidyPaste } from './docFiles.js'
import { Outline } from './Outline.jsx'
import { documentExtensions, FindReplace, findKey, changeCaseCommand, LINE_HEIGHTS, SIZES } from './extensions.js'
import { PictureView, pictureCache, preparePicture, isPicture, toB64, fromB64 } from './pictures.js'
import {
  ArrowCounterClockwise, ArrowClockwise, TextB, TextItalic, TextUnderline, TextStrikethrough, TextAUnderline, Highlighter,
  TextSuperscript, TextSubscript, TextAlignLeft, TextAlignCenter, TextAlignRight, TextAlignJustify, ArrowsDownUp,
  ListBullets, ListNumbers, ListChecks, TextOutdent, TextIndent, LinkSimple, Quotes, CodeBlock, Minus, Table,
  TextAa, Eraser, MagnifyingGlass, CaretUp, CaretDown, X, Check, TreeView, Image as ImageIcon, Trash
} from '@phosphor-icons/react'

// The document editor (proposals/2026-10-06-documents.md). It keeps its own
// copy of the document's Yjs doc: loaded whole with doc:state, its own edits
// sent to the worklet with doc:update (a few at a time), everyone else's
// applied from doc:updated. Undo is the editor's own and only undoes this
// person's edits.

const COLOURS = ['#1f2420', '#b3261e', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#7e22ce']
const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#e5e7eb']
const DEFAULT_SIZE = '11'
const FONTS = [['', 'Sans'], ['serif', 'Serif'], ['monospace', 'Mono']]
const STYLES = [['normal', 'Normal text'], ['title', 'Title'], ['subtitle', 'Subtitle'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']]
const ALIGNS = [['left', 'Align left', TextAlignLeft], ['center', 'Centre', TextAlignCenter], ['right', 'Align right', TextAlignRight], ['justify', 'Justify', TextAlignJustify]]
const SEND_MS = 300
const CURSOR_MS = 150
const TOAST_MS = 5000
const OUTLINE_PREF = 'pearoffice:docOutline'

export function DocView ({ sheetId, onTitleChange, onError, onGone }) {
  const ydoc = useMemo(() => new Y.Doc(), [sheetId])
  useEffect(() => () => ydoc.destroy(), [ydoc])
  // Pictures fetched for this document, kept while it is open.
  const pictures = useMemo(() => pictureCache(async (a) => fromB64((await call('doc:picture', { sheetId, ref: a.ref, hash: a.hash })).data)), [sheetId])
  useEffect(() => () => pictures.clear(), [pictures])
  const [info, setInfo] = useState(null) // doc:state without the state
  const [title, setTitle] = useState('')
  const [arrived, setArrived] = useState(false) // the content is here
  const [finding, setFinding] = useState(false)
  const members = useMembers(sheetId)
  const phone = isMobile()
  // The outline is remembered on desktop; on a phone it is a sheet opened
  // when wanted.
  const [outline, setOutline] = useState(() => !phone && readPref(OUTLINE_PREF) === '1')
  const toggleOutline = () => {
    if (!phone) writePref(OUTLINE_PREF, outline ? '0' : '1')
    setOutline(!outline)
  }
  const editorRef = useRef(null)
  const errorRef = useRef(onError)
  errorRef.current = onError
  const goneRef = useRef(onGone)
  goneRef.current = onGone

  // Title and "has it arrived" come from the copy itself.
  useEffect(() => {
    const meta = ydoc.getMap('meta')
    const read = () => { setTitle(meta.get('title') || ''); setArrived(meta.has('kind')) }
    read()
    meta.observe(read)
    return () => meta.unobserve(read)
  }, [ydoc])

  const loadInfo = useCallback(async (withState) => {
    try {
      const s = await call('doc:state', { sheetId, withState })
      if (s.state) Y.applyUpdate(ydoc, fromB64(s.state), 'remote')
      delete s.state
      setInfo(s)
    } catch (err) {
      // The document left this device (removed, deleted, moved): go back.
      if (/^unknown sheet/.test(err.message)) { goneRef.current(); return }
      errorRef.current(err.message)
    }
  }, [sheetId, ydoc])

  // Listen before loading, so nothing falls between the two.
  useEffect(() => {
    const off = on('doc:updated', (d) => {
      if (d.sheetId !== sheetId) return
      try { Y.applyUpdate(ydoc, fromB64(d.update), 'remote') } catch {}
    })
    loadInfo(true)
    return off
  }, [sheetId, ydoc, loadInfo])
  useEffect(() => on('sheet:members', (d) => { if (d.sheetId === sheetId) loadInfo(false) }), [sheetId, loadInfo])
  useEffect(() => on('sheet:moved', (d) => { if (d.from === sheetId) loadInfo(false) }), [sheetId, loadInfo])

  const hasEditRole = !!info && (info.myRole === 'owner' || info.myRole === 'editor')
  const canEdit = hasEditRole && info.writable && !info.newer && !info.frozen

  // Content for a just-joined document arrives over the network, and edit
  // access can trail the role by a few seconds; check until both are in.
  useEffect(() => {
    if (!info || (arrived && !(hasEditRole && !info.writable))) return
    const t = setInterval(() => loadInfo(!arrived), 1000)
    return () => clearInterval(t)
  }, [info, arrived, hasEditRole, loadInfo])

  // On screen: the worklet looks again for the document's other devices
  // while nobody is connected (src/worklet/rediscover.js).
  const [onScreen, setOnScreen] = useState(() => document.visibilityState !== 'hidden')
  useEffect(() => {
    const vis = () => setOnScreen(document.visibilityState !== 'hidden')
    document.addEventListener('visibilitychange', vis)
    return () => document.removeEventListener('visibilitychange', vis)
  }, [])
  useEffect(() => {
    call('file:visible', { sheetId, visible: onScreen }).catch(() => {})
    return () => { call('file:visible', { sheetId, visible: false }).catch(() => {}) }
  }, [sheetId, onScreen])

  // Who else has this document open, and their text cursor
  // (proposals/2026-10-06-documents.md, Presence). As in a sheet, Settings can
  // turn this off; then this device sends nothing and sees nobody.
  const [present, setPresent] = useState([])
  const [sharePresence, setSharePresence] = useState(() => readPref('pearoffice:presence') !== '0')
  useEffect(() => {
    const pref = (e) => { if (e.detail && e.detail.key === 'pearoffice:presence') setSharePresence(e.detail.value !== '0') }
    window.addEventListener('pearoffice:pref', pref)
    return () => window.removeEventListener('pearoffice:pref', pref)
  }, [])
  const cursorRef = useRef(null)
  const sentRef = useRef('')
  useEffect(() => {
    setPresent([])
    call('sheet:present', { sheetId }).then((d) => setPresent(d.people)).catch(() => {})
    const off = on('sheet:presence', (d) => { if (d.sheetId === sheetId) setPresent(d.people) })
    return () => {
      off()
      sentRef.current = ''
      cursorRef.current = null
      call('sheet:presence', { sheetId, open: false }).catch(() => {})
    }
  }, [sheetId])
  // Sent when it differs from the last one sent; the worklet sends at most
  // four a second.
  const sendPresence = useCallback(() => {
    const msg = sharePresence && onScreen ? { open: true, cursor: cursorRef.current } : { open: false }
    const key = JSON.stringify(msg)
    if (key === sentRef.current) return
    sentRef.current = key
    call('sheet:presence', { sheetId, ...msg }).catch(() => {})
  }, [sheetId, sharePresence, onScreen])
  useEffect(() => { sendPresence() }, [sendPresence])
  const sendRef = useRef(sendPresence)
  sendRef.current = sendPresence
  const cursorTimer = useRef(null)
  useEffect(() => () => clearTimeout(cursorTimer.current), [])
  const onCursor = useCallback((cursor) => {
    cursorRef.current = cursor
    if (!cursorTimer.current) cursorTimer.current = setTimeout(() => { cursorTimer.current = null; sendRef.current() }, CURSOR_MS)
  }, [])

  // This person's edits go to the worklet a few at a time, and at once when
  // the editor loses focus, the app is hidden or the document closes.
  const canEditRef = useRef(false)
  canEditRef.current = canEdit
  const flushRef = useRef(() => {})
  useEffect(() => {
    let pending = []
    let timer = null
    let sending = Promise.resolve()
    const flush = () => {
      clearTimeout(timer)
      timer = null
      if (!pending.length) return
      const update = pending.length === 1 ? pending[0] : Y.mergeUpdates(pending)
      pending = []
      if (!canEditRef.current) return
      sending = sending.then(() => call('doc:update', { sheetId, update: toB64(update) })).catch((err) => errorRef.current(err.message))
    }
    const onUpdate = (update, origin) => {
      if (origin === 'remote') return
      pending.push(update)
      if (!timer) timer = setTimeout(flush, SEND_MS)
    }
    const hidden = () => { if (document.visibilityState === 'hidden') flush() }
    ydoc.on('update', onUpdate)
    document.addEventListener('visibilitychange', hidden)
    window.addEventListener('beforeunload', flush)
    flushRef.current = flush
    return () => {
      flush()
      ydoc.off('update', onUpdate)
      document.removeEventListener('visibilitychange', hidden)
      window.removeEventListener('beforeunload', flush)
    }
  }, [sheetId, ydoc])

  const nameOf = (identity) => {
    const m = members.find((x) => x.identity === identity)
    return !m ? 'Someone' : m.isMe ? 'You (other device)' : m.name || 'Unnamed'
  }
  const presentWhere = new Map(present.map((p) => [p.identity, 'here']))
  const cursors = present.filter((p) => p.cursor).map((p) => ({ key: p.device, name: nameOf(p.identity), color: colourFor(p.identity), cursor: p.cursor }))

  if (!info) return <div className='loading'>Opening document...</div>
  if (!arrived) return <div className='loading'>Waiting for the document to arrive from the people in it...</div>

  const note = info.frozen
    ? (info.frozen.removed
        ? 'The owner removed you from this document. This is a read-only copy of what you had.'
        : info.frozen.tidied ? 'Updating this document...' : 'This document moved to new keys. Opening the new copy...')
    : info.newer ? 'This document was made with a newer version of PearOffice. Update PearOffice to edit it.' : null

  return (
    <div className='doc'>
      <FileBar
        sheetId={sheetId}
        noun='document'
        title={title}
        myRole={info.myRole}
        frozen={info.frozen}
        canEdit={canEdit}
        badge={!canEdit && <span className='badge view-only'>{hasEditRole && !info.writable && !info.frozen ? 'Getting edit access...' : 'View only'}</span>}
        phone={phone}
        members={members}
        present={presentWhere}
        onTitleChange={onTitleChange}
        onError={onError}
        onGone={onGone}
        menuItems={() => {
          const save = (format) => exportDocument(ydoc, title, format, sheetId).catch((err) => onError(err.message))
          return (
            <>
              <li role='menuitem' onClick={() => setFinding(true)}>Find and replace</li>
              <li role='menuitem' onClick={toggleOutline}>{outline ? 'Hide the outline' : 'Show the outline'}</li>
              {canEdit && <li role='menuitem' onClick={() => editorRef.current && pastePlain(editorRef.current).catch((err) => onError(err.message))}>Paste as plain text</li>}
              <li role='menuitem' onClick={() => save('docx')}>Save as a Word file</li>
              <li role='menuitem' onClick={() => save('md')}>Save as Markdown</li>
              <li role='menuitem' onClick={() => save('txt')}>Save as plain text</li>
              <li role='menuitem' onClick={() => save('pdf')}>Save as PDF</li>
              {!phone && <li role='menuitem' onClick={() => save('print')}>Print...</li>}
            </>
          )
        }}
      />
      {note && <div className='banner info'>{note}</div>}
      <DocEditor sheetId={sheetId} pictures={pictures} ydoc={ydoc} canEdit={canEdit} phone={phone} finding={finding} setFinding={setFinding} outline={outline} toggleOutline={toggleOutline} editorRef={editorRef} onBlur={() => flushRef.current()} cursors={cursors} onCursor={onCursor} />
    </div>
  )
}

function DocEditor ({ sheetId, pictures, ydoc, canEdit, phone, finding, setFinding, outline, toggleOutline, editorRef, onBlur, cursors, onCursor }) {
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  // A short note when a paste left something out.
  const [toast, setToast] = useState(null)
  const toastTimer = useRef(null)
  useEffect(() => () => clearTimeout(toastTimer.current), [])
  const showToast = useRef(null)
  showToast.current = (text) => {
    clearTimeout(toastTimer.current)
    setToast(text)
    toastTimer.current = setTimeout(() => setToast(null), TOAST_MS)
  }
  const others = useMemo(() => remoteCursors(), [ydoc])
  // Pictures from a file, the clipboard or a drop: shrunk, stored, then put
  // in at `at` (or the cursor).
  const addRef = useRef(null)
  addRef.current = async (files, at = null) => {
    const list = [...files].filter((f) => isPicture(f.type))
    if (!list.length) { showToast.current('This kind of picture cannot be added.'); return }
    for (const file of list) {
      try {
        const p = await preparePicture(file)
        const a = await call('doc:addPicture', { sheetId, bytes: toB64(p.bytes), mime: p.mime, width: p.w, height: p.h })
        pictures.put(a.ref, p.bytes, p.mime)
        const node = { type: 'image', attrs: { ref: a.ref, hash: a.hash, mime: a.mime, w: a.w, h: a.h } }
        const c = editorRef.current.chain().focus()
        ;(at === null ? c.insertContent(node) : c.insertContentAt(at, node)).run()
      } catch (err) { showToast.current(err.message) }
    }
  }
  const editor = useEditor({
    editable: canEdit,
    extensions: [
      ...documentExtensions().filter((x) => x.name !== 'image'),
      PictureView.configure({ cache: pictures }),
      Collaboration.configure({ document: ydoc, field: 'body' }),
      Typography,
      Placeholder.configure({ placeholder: () => (canEditRef.current ? 'Type here to start your document.' : 'This document is empty.') }),
      CharacterCount,
      FindReplace,
      RemoteCursors.configure({ others })
    ],
    editorProps: {
      attributes: { class: 'doc-body', 'aria-label': 'Document', spellcheck: 'true' },
      // Word, Google Docs, LibreOffice and web pages, tidied as an import is.
      // A copy from a document here is already in the editor's terms.
      transformPastedHTML: (html) => {
        if (/data-pm-slice/.test(html)) return html
        const t = tidyPaste(html)
        if (t.dropped) showToast.current('Some parts of what you pasted, such as pictures, were left out.')
        return t.html
      },
      // A copied picture (a screenshot, say) or a picture file.
      handlePaste: (view, event) => {
        const files = [...((event.clipboardData && event.clipboardData.files) || [])].filter((f) => /^image\//.test(f.type))
        if (!files.length || /data-pm-slice/.test(event.clipboardData.getData('text/html'))) return false
        if (!canEditRef.current) return true
        event.preventDefault()
        addRef.current(files)
        return true
      },
      handleDrop: (view, event, slice, moved) => {
        const files = [...((event.dataTransfer && event.dataTransfer.files) || [])]
        if (moved || !files.length) return false
        event.preventDefault()
        if (!canEditRef.current) return true
        const at = view.posAtCoords({ left: event.clientX, top: event.clientY })
        addRef.current(files, at ? at.pos : null)
        return true
      }
    },
    onBlur
  }, [ydoc])
  useEffect(() => { if (editor) editor.setEditable(canEdit) }, [editor, canEdit])
  useEffect(() => { editorRef.current = editor }, [editor, editorRef])

  // The others' cursors in, this person's cursor out.
  const cursorsKey = JSON.stringify(cursors)
  useEffect(() => { others.set(cursors) }, [others, cursorsKey])
  const onCursorRef = useRef(onCursor)
  onCursorRef.current = onCursor
  useEffect(() => {
    if (!editor) return
    let redraw = null
    const report = ({ transaction }) => {
      if (transaction && !transaction.docChanged && !transaction.selectionSet) return
      // The cursor plugin hides the others' cursors after this person adds or
      // removes a paragraph, until the mapping catches up: draw them again.
      if (transaction && transaction.docChanged && !redraw) redraw = setTimeout(() => { redraw = null; others.refresh() }, 0)
      const c = cursorOf(editor.state)
      if (c) onCursorRef.current(c)
    }
    report({})
    editor.on('transaction', report)
    return () => { clearTimeout(redraw); editor.off('transaction', report) }
  }, [editor, others])

  const s = useEditorState({
    editor,
    selector: ({ editor: ed }) => {
      if (!ed) return null
      const para = ed.state.selection.$from.parent
      const ts = ed.getAttributes('textStyle')
      const heading = ed.isActive('heading') ? 'h' + ed.getAttributes('heading').level : null
      const text = ed.state.doc.textBetween(0, ed.state.doc.content.size, ' ', ' ')
      return {
        canUndo: ed.can().undo(),
        canRedo: ed.can().redo(),
        style: heading || para.attrs.blockStyle || 'normal',
        font: ts.fontFamily || '',
        size: ts.fontSize ? String(parseFloat(ts.fontSize)) : DEFAULT_SIZE,
        color: ts.color || null,
        highlight: ed.getAttributes('highlight').color || null,
        bold: ed.isActive('bold'),
        italic: ed.isActive('italic'),
        underline: ed.isActive('underline'),
        strike: ed.isActive('strike'),
        sup: ed.isActive('superscript'),
        sub: ed.isActive('subscript'),
        align: para.attrs.textAlign || 'left',
        lineHeight: para.attrs.lineHeight || '1.15',
        spaceAfter: para.attrs.spaceAfter !== 'none',
        bullet: ed.isActive('bulletList'),
        ordered: ed.isActive('orderedList'),
        task: ed.isActive('taskList'),
        link: ed.isActive('link'),
        href: ed.getAttributes('link').href || '',
        quote: ed.isActive('blockquote'),
        code: ed.isActive('codeBlock'),
        table: ed.isActive('table'),
        picture: ed.state.selection instanceof NodeSelection && ed.state.selection.node.type.name === 'image' ? { pos: ed.state.selection.from, align: ed.state.selection.node.attrs.align || 'center', alt: ed.state.selection.node.attrs.alt || '' } : null,
        empty: ed.state.selection.empty,
        words: ed.storage.characterCount.words(),
        chars: ed.storage.characterCount.characters(),
        charsNoSpaces: text.replace(/\s/g, '').length
      }
    }
  })

  // One menu or palette at a time, placed under its button on the screen
  // (a row that scrolls sideways would clip it).
  const [menu, setMenu] = useState(null) // { kind, top, left }
  const [linking, setLinking] = useState(null) // the link being typed, or null
  function openMenu (kind, button) {
    if (menu && menu.kind === kind) { setMenu(null); return }
    const r = button.getBoundingClientRect()
    setMenu({ kind, top: r.bottom + 4, left: Math.max(4, Math.min(r.left, window.innerWidth - 200)) })
  }
  const run = (fn) => { setMenu(null); fn(editor.chain().focus()).run() }

  // Insert a picture: the file picker here, the shell's on a phone.
  const fileRef = useRef(null)
  async function pickPicture () {
    if (!phone) { fileRef.current.click(); return }
    try {
      const picked = await call('app:pickFile', { images: true })
      if (!picked || picked.canceled) return
      const type = picked.mime || ({ png: 'image/png', gif: 'image/gif', webp: 'image/webp', heic: 'image/heic' }[(/\.([^.]+)$/.exec(picked.name || '') || [])[1]?.toLowerCase()] || 'image/jpeg')
      await addRef.current([new File([fromB64(picked.base64)], picked.name || 'picture', { type })])
    } catch (err) { showToast.current(err.message) }
  }
  // The selected picture's bubble follows it when the page scrolls.
  const [, rescrolled] = useState(0)

  // Ctrl+F (Cmd+F) opens find, as in the sheet.
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setFinding(true) }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && canEdit) { e.preventDefault(); setLinking(s ? s.href : '') }
    // Ctrl+Shift+V (Cmd+Shift+V): paste as plain text.
    if ((e.ctrlKey || e.metaKey) && e.shiftKey && e.key.toLowerCase() === 'v' && canEdit) { e.preventDefault(); pastePlain(editor).catch(() => {}) }
  }

  if (!editor || !s) return <div className='loading'>Opening document...</div>
  const ICON = phone ? 20 : 18
  const btn = (label, Icon, active, onClick, extra = {}) => (
    <button title={label} aria-label={label} aria-pressed={active === undefined ? undefined : !!active} className={active ? 'on' : ''} onMouseDown={(e) => e.preventDefault()} onClick={onClick} {...extra}><Icon size={ICON} /></button>
  )
  const AlignIcon = (ALIGNS.find((a) => a[0] === s.align) || ALIGNS[0])[2]

  return (
    <div className='doc-main' onKeyDown={onKeyDown}>
      <div className={'doc-tools' + (phone ? ' phone' : '')} role='toolbar' aria-label='Formatting' hidden={!canEdit}>
        {btn('Undo (Ctrl+Z)', ArrowCounterClockwise, undefined, () => editor.chain().focus().undo().run(), { disabled: !s.canUndo })}
        {btn('Redo (Ctrl+Y)', ArrowClockwise, undefined, () => editor.chain().focus().redo().run(), { disabled: !s.canRedo })}
        <span className='sep' />
        <select aria-label='Paragraph style' title='Paragraph style' className='style-select' value={s.style} onChange={(e) => run((c) => c.setBlockStyle(e.target.value))}>
          {STYLES.map(([v, label]) => <option key={v} value={v}>{label}</option>)}
        </select>
        <select aria-label='Font' title='Font' className='font-select' value={s.font} onChange={(e) => run((c) => (e.target.value ? c.setFontFamily(e.target.value) : c.unsetFontFamily()))}>
          {FONTS.map(([v, label]) => <option key={label} value={v}>{label}</option>)}
        </select>
        <select aria-label='Font size' title='Font size' className='size-select' value={s.size} onChange={(e) => run((c) => (e.target.value === DEFAULT_SIZE ? c.unsetFontSize() : c.setFontSize(e.target.value + 'pt')))}>
          {(SIZES.includes(Number(s.size)) ? SIZES : [...SIZES, Number(s.size)].sort((a, b) => a - b)).map((n) => <option key={n} value={String(n)}>{n}</option>)}
        </select>
        <span className='sep' />
        {btn('Bold (Ctrl+B)', TextB, s.bold, () => editor.chain().focus().toggleBold().run(), { className: 'fmt-b' + (s.bold ? ' on' : '') })}
        {btn('Italic (Ctrl+I)', TextItalic, s.italic, () => editor.chain().focus().toggleItalic().run())}
        {btn('Underline (Ctrl+U)', TextUnderline, s.underline, () => editor.chain().focus().toggleUnderline().run())}
        {btn('Strikethrough', TextStrikethrough, s.strike, () => editor.chain().focus().toggleStrike().run())}
        <button title='Text colour' aria-label='Text colour' className='swatch-button' onMouseDown={(e) => e.preventDefault()} onClick={(e) => openMenu('color', e.currentTarget)}>
          <span className='icon-swatch'><TextAUnderline size={ICON} /><span className='swatch-bar' style={{ background: s.color || 'currentColor' }} /></span>
        </button>
        <button title='Highlight' aria-label='Highlight' className='swatch-button' onMouseDown={(e) => e.preventDefault()} onClick={(e) => openMenu('highlight', e.currentTarget)}>
          <span className='icon-swatch'><Highlighter size={ICON} /><span className='swatch-bar' style={{ background: s.highlight || 'transparent' }} /></span>
        </button>
        {btn('Superscript', TextSuperscript, s.sup, () => editor.chain().focus().toggleSuperscript().run())}
        {btn('Subscript', TextSubscript, s.sub, () => editor.chain().focus().toggleSubscript().run())}
        <span className='sep' />
        {btn('Alignment', AlignIcon, undefined, (e) => openMenu('align', e.currentTarget), { 'aria-haspopup': 'menu', className: 'align-button' })}
        {btn('Line spacing', ArrowsDownUp, undefined, (e) => openMenu('spacing', e.currentTarget), { 'aria-haspopup': 'menu' })}
        {btn('Bulleted list', ListBullets, s.bullet, () => editor.chain().focus().toggleBulletList().run())}
        {btn('Numbered list', ListNumbers, s.ordered, () => editor.chain().focus().toggleOrderedList().run())}
        {btn('Checklist', ListChecks, s.task, () => editor.chain().focus().toggleTaskList().run())}
        {btn('Decrease indent (Shift+Tab)', TextOutdent, undefined, () => outdent(editor))}
        {btn('Increase indent (Tab)', TextIndent, undefined, () => indent(editor))}
        <span className='sep' />
        {btn('Link (Ctrl+K)', LinkSimple, s.link, () => setLinking(linking === null ? s.href : null))}
        {btn('Quote', Quotes, s.quote, () => editor.chain().focus().toggleBlockquote().run())}
        {btn('Code block', CodeBlock, s.code, () => editor.chain().focus().toggleCodeBlock().run())}
        {btn('Horizontal line', Minus, undefined, () => editor.chain().focus().setHorizontalRule().run())}
        {btn('Insert a picture', ImageIcon, undefined, pickPicture, { className: 'picture-button' })}
        <input ref={fileRef} type='file' accept='image/*' multiple hidden className='picture-input' onChange={(e) => { const files = [...e.target.files]; e.target.value = ''; if (files.length) addRef.current(files) }} />
        {btn('Table', Table, s.table, (e) => (s.table ? openMenu('table', e.currentTarget) : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), { 'aria-haspopup': s.table ? 'menu' : undefined, className: 'table-button' + (s.table ? ' on' : '') })}
        <span className='sep' />
        {btn('Change case', TextAa, undefined, (e) => openMenu('case', e.currentTarget), { 'aria-haspopup': 'menu', disabled: s.empty })}
        {btn('Clear formatting', Eraser, undefined, () => editor.chain().focus().unsetAllMarks().unsetTextAlign().run())}
        {btn('Find and replace (Ctrl+F)', MagnifyingGlass, finding, () => setFinding(!finding))}
        {btn('Outline', TreeView, outline, toggleOutline, { className: 'outline-button' + (outline ? ' on' : '') })}
      </div>
      {menu && <div className='doc-scrim' onMouseDown={() => setMenu(null)} />}
      {menu && (menu.kind === 'color' || menu.kind === 'highlight') && (
        <span className='palette doc-pop' role='menu' style={{ position: 'fixed', top: menu.top, left: menu.left }}>
          {(menu.kind === 'color' ? COLOURS : HIGHLIGHTS).map((c) => (
            <button key={c} className='swatch' style={{ background: c }} title={c} aria-label={c} onClick={() => run((ch) => (menu.kind === 'color' ? ch.setColor(c) : ch.setHighlight({ color: c })))} />
          ))}
          <button className='swatch none' title='None' aria-label='None' onClick={() => run((ch) => (menu.kind === 'color' ? ch.unsetColor() : ch.unsetHighlight()))}>×</button>
        </span>
      )}
      {menu && menu.kind === 'align' && (
        <ul className='menu doc-pop' role='menu' style={{ top: menu.top, left: menu.left }}>
          {ALIGNS.map(([v, label, Icon]) => (
            <li key={v} role='menuitemradio' aria-checked={s.align === v} className={'align-' + v + (s.align === v ? ' on' : '')} onClick={() => run((c) => c.setTextAlign(v))}><Icon size={16} /> {label}</li>
          ))}
        </ul>
      )}
      {menu && menu.kind === 'spacing' && (
        <ul className='menu doc-pop' role='menu' style={{ top: menu.top, left: menu.left }}>
          {LINE_HEIGHTS.map((v) => (
            <li key={v} role='menuitemradio' aria-checked={s.lineHeight === v} className={s.lineHeight === v ? 'on' : ''} onClick={() => run((c) => c.setLineHeight(v))}>{s.lineHeight === v ? <Check size={14} /> : <span className='menu-gap' />} {v === '1' ? 'Single' : v === '2' ? 'Double' : v}</li>
          ))}
          <li role='menuitemcheckbox' aria-checked={s.spaceAfter} onClick={() => run((c) => c.toggleSpaceAfter())}>{s.spaceAfter ? <Check size={14} /> : <span className='menu-gap' />} Space after paragraphs</li>
        </ul>
      )}
      {menu && menu.kind === 'table' && (
        <ul className='menu doc-pop' role='menu' style={{ top: menu.top, left: menu.left }}>
          <li role='menuitem' onClick={() => run((c) => c.addRowBefore())}>Add a row above</li>
          <li role='menuitem' onClick={() => run((c) => c.addRowAfter())}>Add a row below</li>
          <li role='menuitem' onClick={() => run((c) => c.addColumnBefore())}>Add a column to the left</li>
          <li role='menuitem' onClick={() => run((c) => c.addColumnAfter())}>Add a column to the right</li>
          <li role='menuitem' onClick={() => run((c) => c.deleteRow())}>Delete this row</li>
          <li role='menuitem' onClick={() => run((c) => c.deleteColumn())}>Delete this column</li>
          <li role='menuitem' className='danger' onClick={() => run((c) => c.deleteTable())}>Delete the table</li>
        </ul>
      )}
      {menu && menu.kind === 'case' && (
        <ul className='menu doc-pop' role='menu' style={{ top: menu.top, left: menu.left }}>
          <li role='menuitem' onClick={() => run((c) => c.command(changeCaseCommand('upper')))}>UPPERCASE</li>
          <li role='menuitem' onClick={() => run((c) => c.command(changeCaseCommand('lower')))}>lowercase</li>
          <li role='menuitem' onClick={() => run((c) => c.command(changeCaseCommand('sentence')))}>Sentence case</li>
          <li role='menuitem' onClick={() => run((c) => c.command(changeCaseCommand('title')))}>Title Case</li>
        </ul>
      )}
      {s.picture && canEdit && !menu && <PictureBubble editor={editor} picture={s.picture} />}
      {linking !== null && canEdit && <LinkBar editor={editor} initial={linking} onClose={() => setLinking(null)} />}
      {finding && <FindBar editor={editor} canEdit={canEdit} onClose={() => { editor.commands.setFind({ query: '' }); setFinding(false) }} />}
      <div className='doc-row'>
        {outline && <Outline editor={editor} phone={phone} onClose={toggleOutline} />}
        <div className='doc-scroll' onScroll={() => { if (s.picture) rescrolled((n) => n + 1) }} onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end') }}>
          <div className='doc-page'>
            <EditorContent editor={editor} />
          </div>
        </div>
      </div>
      {toast && <div className='doc-toast' role='status'>{toast}</div>}
      <footer className='doc-footer' aria-live='polite'>
        <span className='word-count'>{s.words === 1 ? '1 word' : s.words + ' words'}</span>
        <span>{s.chars + (s.chars === 1 ? ' character' : ' characters')}</span>
        <span>{s.charsNoSpaces} without spaces</span>
      </footer>
    </div>
  )
}

// This person's selection as Yjs relative positions (base64), which stay put
// while others edit. Null until the editor is bound to the document.
function cursorOf (state) {
  const y = ySyncPluginKey.getState(state)
  if (!y || !y.binding || !y.binding.mapping.size) return null
  const { anchor, head } = state.selection
  const enc = (p) => toB64(Y.encodeRelativePosition(absolutePositionToRelativePosition(p, y.type, y.binding.mapping)))
  try { return { anchor: enc(anchor), head: enc(head) } } catch { return null }
}

// The others' cursors, in the shape y-tiptap's cursor plugin reads from a Yjs
// Awareness: a numeric id per device, { user, cursor } with JSON relative
// positions, and a 'change' event. Presence carries the states instead of an
// awareness channel, so this holds no local state of its own.
function remoteCursors () {
  const states = new Map()
  const ids = new Map() // device -> id
  const listeners = new Set()
  let local = {}
  const decode = (b64) => Y.relativePositionToJSON(Y.decodeRelativePosition(fromB64(b64)))
  return {
    getStates: () => states,
    getLocalState: () => local,
    setLocalStateField: (k, v) => { local = { ...local, [k]: v } },
    on: (e, fn) => { if (e === 'change') listeners.add(fn) },
    off: (e, fn) => { listeners.delete(fn) },
    refresh () { for (const fn of listeners) fn() },
    set (list) {
      states.clear()
      for (const p of list) {
        if (!ids.has(p.key)) ids.set(p.key, -1 - ids.size) // never a Yjs client id
        try {
          states.set(ids.get(p.key), { user: { name: p.name, color: p.color }, cursor: { anchor: decode(p.cursor.anchor), head: decode(p.cursor.head) } })
        } catch {}
      }
      this.refresh()
    }
  }
}

function caret (user) {
  const el = document.createElement('span')
  el.className = 'doc-caret'
  el.style.setProperty('--who', user.color)
  const tag = document.createElement('span')
  tag.className = 'presence-tag'
  tag.textContent = user.name
  el.append('\u2060', tag, '\u2060')
  return el
}

const RemoteCursors = Extension.create({
  name: 'remoteCursors',
  addOptions: () => ({ others: null }),
  addProseMirrorPlugins () {
    return [yCursorPlugin(this.options.others, {
      cursorBuilder: caret,
      selectionBuilder: (user) => ({ class: 'doc-remote-selection', style: 'background-color: ' + user.color + '40' })
    })]
  }
})

// Alignment, alt text and delete for the selected picture, just above it.
function PictureBubble ({ editor, picture }) {
  const [alt, setAlt] = useState(picture.alt)
  useEffect(() => setAlt(picture.alt), [picture.pos, picture.alt])
  const dom = editor.view.nodeDOM(picture.pos)
  if (!dom || !dom.getBoundingClientRect) return null
  const frame = dom.querySelector('.doc-picture-frame') || dom
  const r = frame.getBoundingClientRect()
  const top = r.top > 120 ? r.top - 48 : Math.min(r.bottom + 8, window.innerHeight - 48)
  const set = (attrs) => editor.chain().setNodeSelection(picture.pos).updateAttributes('image', attrs).setNodeSelection(picture.pos).run()
  const saveAlt = () => { if (alt !== picture.alt) set({ alt: alt.trim() }) }
  const keep = (e) => e.preventDefault()
  return (
    <div className='picture-bubble' role='toolbar' aria-label='Picture' style={{ top, left: r.left + r.width / 2 }}>
      {[['left', 'Align left', TextAlignLeft], ['center', 'Centre', TextAlignCenter], ['right', 'Align right', TextAlignRight]].map(([v, label, Icon]) => (
        <button key={v} title={label} aria-label={label} aria-pressed={picture.align === v} className={'picture-align-' + v + (picture.align === v ? ' on' : '')} onMouseDown={keep} onClick={() => set({ align: v })}><Icon size={18} /></button>
      ))}
      <input
        aria-label='Alt text'
        placeholder='Describe the picture.'
        value={alt}
        onChange={(e) => setAlt(e.target.value)}
        onBlur={saveAlt}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); saveAlt() } if (e.key === 'Escape') { e.preventDefault(); setAlt(picture.alt); editor.commands.focus() } }}
      />
      <button title='Delete the picture' aria-label='Delete the picture' onMouseDown={keep} onClick={() => editor.chain().focus().setNodeSelection(picture.pos).deleteSelection().run()}><Trash size={18} /></button>
    </div>
  )
}

// The clipboard's text, pasted without its formatting. Read through the app
// (desktop/main.js, mobile/App.js), which needs no permission prompt.
async function pastePlain (editor) {
  const { text } = await call('app:getClipboard')
  if (!text) return
  editor.view.focus()
  editor.view.pasteText(text)
}

// Tab and Shift+Tab, as buttons: deeper in a list, or the paragraph's indent.
function indent (editor) {
  const c = editor.chain().focus()
  if (editor.isActive('taskItem')) c.sinkListItem('taskItem').run()
  else if (editor.isActive('listItem')) c.sinkListItem('listItem').run()
  else c.indent(1).run()
}

function outdent (editor) {
  const c = editor.chain().focus()
  if (editor.isActive('taskItem')) c.liftListItem('taskItem').run()
  else if (editor.isActive('listItem')) c.liftListItem('listItem').run()
  else c.indent(-1).run()
}

// A link for the selection (or the link under the caret), typed inline.
function LinkBar ({ editor, initial, onClose }) {
  const [href, setHref] = useState(initial || '')
  function apply () {
    const url = href.trim()
    const c = editor.chain().focus().extendMarkRange('link')
    if (!url) c.unsetLink().run()
    else {
      const full = /^[a-z][a-z0-9+.-]*:/i.test(url) ? url : 'https://' + url
      if (editor.state.selection.empty && !editor.isActive('link')) c.insertContent({ type: 'text', text: url, marks: [{ type: 'link', attrs: { href: full } }] }).run()
      else c.setLink({ href: full }).run()
    }
    onClose()
  }
  return (
    <div className='doc-bar link-bar'>
      <LinkSimple size={18} aria-hidden='true' />
      <input
        autoFocus
        aria-label='Link address'
        placeholder='Paste or type a link.'
        value={href}
        onChange={(e) => setHref(e.target.value)}
        onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); apply() } if (e.key === 'Escape') { e.preventDefault(); onClose(); editor.commands.focus() } }}
      />
      <div className='doc-bar-buttons'>
        <button className='primary' onClick={apply}>Apply</button>
        {editor.isActive('link') && <button onClick={() => { editor.chain().focus().extendMarkRange('link').unsetLink().run(); onClose() }}>Remove</button>}
      </div>
      <button className='icon-button close' aria-label='Close' title='Close' onClick={onClose}><X size={16} /></button>
    </div>
  )
}

function FindBar ({ editor, canEdit, onClose }) {
  const [query, setQuery] = useState('')
  const [by, setBy] = useState('')
  const [matchCase, setMatchCase] = useState(false)
  const [, redraw] = useState(0)
  useEffect(() => {
    const again = () => redraw((n) => n + 1)
    editor.on('transaction', again)
    return () => editor.off('transaction', again)
  }, [editor])
  useEffect(() => { editor.commands.setFind({ query, matchCase }) }, [editor, query, matchCase])
  const { matches, index } = findKey.getState(editor.state) || { matches: [], index: -1 }
  const keys = (e) => {
    if (e.key === 'Enter') { e.preventDefault(); editor.commands.findStep(e.shiftKey ? -1 : 1) }
    if (e.key === 'Escape') { e.preventDefault(); onClose() }
  }
  return (
    <div className='doc-bar find-bar'>
      <div className='find-row'>
        <input autoFocus aria-label='Find' placeholder='Find' value={query} onChange={(e) => setQuery(e.target.value)} onKeyDown={keys} />
        <span className='find-count muted'>{query ? (matches.length ? (index + 1) + ' of ' + matches.length : 'No matches') : ''}</span>
        <button className='icon-button' aria-label='Previous match' title='Previous match' disabled={!matches.length} onClick={() => editor.commands.findStep(-1)}><CaretUp size={16} /></button>
        <button className='icon-button' aria-label='Next match' title='Next match' disabled={!matches.length} onClick={() => editor.commands.findStep(1)}><CaretDown size={16} /></button>
        <label className='check'><input type='checkbox' checked={matchCase} onChange={(e) => setMatchCase(e.target.checked)} /> Match case</label>
        <button className='icon-button close' aria-label='Close' title='Close' onClick={onClose}><X size={16} /></button>
      </div>
      {canEdit && (
        <div className='find-row'>
          <input aria-label='Replace with' placeholder='Replace with' value={by} onChange={(e) => setBy(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') { e.preventDefault(); editor.commands.replaceMatch(by) } }} />
          <div className='doc-bar-buttons'>
            <button disabled={index < 0} onClick={() => editor.commands.replaceMatch(by)}>Replace</button>
            <button disabled={!matches.length} onClick={() => editor.commands.replaceAll(by)}>Replace all</button>
          </div>
        </div>
      )}
    </div>
  )
}
