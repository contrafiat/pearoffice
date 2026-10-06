import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react'
import * as Y from 'yjs'
import { useEditor, useEditorState, EditorContent } from '@tiptap/react'
import StarterKit from '@tiptap/starter-kit'
import Collaboration from '@tiptap/extension-collaboration'
import { TextStyle, Color, FontSize, FontFamily } from '@tiptap/extension-text-style'
import Highlight from '@tiptap/extension-highlight'
import { TaskList, TaskItem } from '@tiptap/extension-list'
import { TableKit } from '@tiptap/extension-table'
import TextAlign from '@tiptap/extension-text-align'
import Subscript from '@tiptap/extension-subscript'
import Superscript from '@tiptap/extension-superscript'
import Typography from '@tiptap/extension-typography'
import Placeholder from '@tiptap/extension-placeholder'
import { CharacterCount } from '@tiptap/extensions'
import { call, on } from '../bridge.js'
import { FileBar, useMembers } from '../FileBar.jsx'
import { isMobile } from '../sheet/xlsx.js'
import { ParagraphFormat, FindReplace, findKey, changeCaseCommand, LINE_HEIGHTS } from './extensions.js'
import {
  ArrowCounterClockwise, ArrowClockwise, TextB, TextItalic, TextUnderline, TextStrikethrough, TextAUnderline, Highlighter,
  TextSuperscript, TextSubscript, TextAlignLeft, TextAlignCenter, TextAlignRight, TextAlignJustify, ArrowsDownUp,
  ListBullets, ListNumbers, ListChecks, TextOutdent, TextIndent, LinkSimple, Quotes, CodeBlock, Minus, Table,
  TextAa, Eraser, MagnifyingGlass, CaretUp, CaretDown, X, Check
} from '@phosphor-icons/react'

// The document editor (proposals/2026-10-06-documents.md). It keeps its own
// copy of the document's Yjs doc: loaded whole with doc:state, its own edits
// sent to the worklet with doc:update (a few at a time), everyone else's
// applied from doc:updated. Undo is the editor's own and only undoes this
// person's edits.

const COLOURS = ['#1f2420', '#b3261e', '#c2410c', '#a16207', '#15803d', '#0e7490', '#1d4ed8', '#7e22ce']
const HIGHLIGHTS = ['#fef08a', '#fed7aa', '#fecaca', '#bbf7d0', '#a5f3fc', '#bfdbfe', '#ddd6fe', '#e5e7eb']
const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36]
const DEFAULT_SIZE = '11'
const FONTS = [['', 'Sans'], ['serif', 'Serif'], ['monospace', 'Mono']]
const STYLES = [['normal', 'Normal text'], ['title', 'Title'], ['subtitle', 'Subtitle'], ['h1', 'Heading 1'], ['h2', 'Heading 2'], ['h3', 'Heading 3']]
const ALIGNS = [['left', 'Align left', TextAlignLeft], ['center', 'Centre', TextAlignCenter], ['right', 'Align right', TextAlignRight], ['justify', 'Justify', TextAlignJustify]]
const SEND_MS = 300

function toB64 (bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

function fromB64 (b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

export function DocView ({ sheetId, onTitleChange, onError, onGone }) {
  const ydoc = useMemo(() => new Y.Doc(), [sheetId])
  useEffect(() => () => ydoc.destroy(), [ydoc])
  const [info, setInfo] = useState(null) // doc:state without the state
  const [title, setTitle] = useState('')
  const [arrived, setArrived] = useState(false) // the content is here
  const [finding, setFinding] = useState(false)
  const members = useMembers(sheetId)
  const phone = isMobile()
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
        present={[]}
        onTitleChange={onTitleChange}
        onError={onError}
        onGone={onGone}
        menuItems={() => <li role='menuitem' onClick={() => setFinding(true)}>Find and replace</li>}
      />
      {note && <div className='banner info'>{note}</div>}
      <DocEditor ydoc={ydoc} canEdit={canEdit} phone={phone} finding={finding} setFinding={setFinding} onBlur={() => flushRef.current()} />
    </div>
  )
}

function DocEditor ({ ydoc, canEdit, phone, finding, setFinding, onBlur }) {
  const canEditRef = useRef(canEdit)
  canEditRef.current = canEdit
  const editor = useEditor({
    editable: canEdit,
    extensions: [
      StarterKit.configure({
        undoRedo: false, // Collaboration's undo only undoes this person's edits
        trailingNode: false, // it would add a paragraph on every device at once
        link: { openOnClick: false, autolink: true, defaultProtocol: 'https' }
      }),
      Collaboration.configure({ document: ydoc, field: 'body' }),
      TextStyle,
      Color,
      FontSize,
      FontFamily,
      Highlight.configure({ multicolor: true }),
      TaskList,
      TaskItem.configure({ nested: true }),
      TableKit.configure({ table: { resizable: false } }),
      TextAlign.configure({ types: ['heading', 'paragraph'] }),
      Subscript,
      Superscript,
      Typography,
      Placeholder.configure({ placeholder: () => (canEditRef.current ? 'Type here to start your document.' : 'This document is empty.') }),
      CharacterCount,
      ParagraphFormat,
      FindReplace
    ],
    editorProps: { attributes: { class: 'doc-body', 'aria-label': 'Document', spellcheck: 'true' } },
    onBlur
  }, [ydoc])
  useEffect(() => { if (editor) editor.setEditable(canEdit) }, [editor, canEdit])

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

  // Ctrl+F (Cmd+F) opens find, as in the sheet.
  const onKeyDown = (e) => {
    if ((e.ctrlKey || e.metaKey) && !e.shiftKey && e.key.toLowerCase() === 'f') { e.preventDefault(); setFinding(true) }
    if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'k' && canEdit) { e.preventDefault(); setLinking(s ? s.href : '') }
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
        {btn('Table', Table, s.table, (e) => (s.table ? openMenu('table', e.currentTarget) : editor.chain().focus().insertTable({ rows: 3, cols: 3, withHeaderRow: true }).run()), { 'aria-haspopup': s.table ? 'menu' : undefined, className: 'table-button' + (s.table ? ' on' : '') })}
        <span className='sep' />
        {btn('Change case', TextAa, undefined, (e) => openMenu('case', e.currentTarget), { 'aria-haspopup': 'menu', disabled: s.empty })}
        {btn('Clear formatting', Eraser, undefined, () => editor.chain().focus().unsetAllMarks().unsetTextAlign().run())}
        {btn('Find and replace (Ctrl+F)', MagnifyingGlass, finding, () => setFinding(!finding))}
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
      {linking !== null && canEdit && <LinkBar editor={editor} initial={linking} onClose={() => setLinking(null)} />}
      {finding && <FindBar editor={editor} canEdit={canEdit} onClose={() => { editor.commands.setFind({ query: '' }); setFinding(false) }} />}
      <div className='doc-scroll' onMouseDown={(e) => { if (e.target === e.currentTarget) editor.commands.focus('end') }}>
        <div className='doc-page'>
          <EditorContent editor={editor} />
        </div>
      </div>
      <footer className='doc-footer' aria-live='polite'>
        <span className='word-count'>{s.words === 1 ? '1 word' : s.words + ' words'}</span>
        <span>{s.chars + (s.chars === 1 ? ' character' : ' characters')}</span>
        <span>{s.charsNoSpaces} without spaces</span>
      </footer>
    </div>
  )
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
