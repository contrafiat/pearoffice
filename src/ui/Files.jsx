import React, { useEffect, useRef, useState } from 'react'
import { CaretLeft, DotsThree, FileText, FolderPlus, FolderSimple, PresentationChart, Table, X } from '@phosphor-icons/react'
import { MemberAvatar } from './Avatar.jsx'
import { filesIn, countLabel } from './Folders.jsx'
import { haptic } from './haptic.js'

// The kinds of file PearOffice makes (proposals/2026-10-06-rename-to-pearoffice.md,
// 2026-10-06-slides.md). A kind marked `soon` shows in New as coming soon.
export const KINDS = [
  { kind: 'sheet', label: 'Spreadsheet', Icon: Table },
  { kind: 'doc', label: 'Document', Icon: FileText },
  { kind: 'slides', label: 'Slides', Icon: PresentationChart }
]

const byKind = (kind) => KINDS.find((k) => k.kind === kind) || KINDS[0]

// The name shown for a file with no title, as New names them.
export const untitled = (kind) => 'Untitled ' + (kind === 'sheet' || !kind ? 'sheet' : byKind(kind).label.toLowerCase())

export function KindIcon ({ kind, size = 20 }) {
  const { Icon, label } = byKind(kind)
  return <span className={'kind-icon kind-' + byKind(kind).kind} title={label}><Icon size={size} weight='duotone' aria-hidden='true' /></span>
}

// New asks which kind of file.
export function NewPanel ({ onPick, onClose }) {
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel new-file' role='dialog' aria-label='New file'>
        <header>
          <h2>New file</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <div className='kind-choices'>
          {KINDS.map(({ kind, label, Icon, soon }) => (
            <button key={kind} className={'kind-choice kind-' + kind} disabled={soon} onClick={() => onPick(kind)}>
              <Icon size={32} weight='duotone' aria-hidden='true' />
              <span className='kind-label'>{label}</span>
              {soon && <span className='kind-soon'>Coming soon</span>}
            </button>
          ))}
        </div>
      </section>
    </div>
  )
}

// After a restore from the recovery phrase: a file nobody else can let this
// device into comes back as a copy you own (worklet moves.recoverCopy).
export function RecoverPanel ({ file, onCopy, onOpen, onClose }) {
  const [busy, setBusy] = React.useState(false)
  const name = file.title || untitled(file.kind)
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel recover-file' role='dialog' aria-label='Make a copy you own'>
        <header>
          <h2>Make a copy you own</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>Nobody else in "{name}" can let this device back in, so you can read it but not change it.</p>
        <p>A copy you own has everything in it and the same name. Anyone else who had it needs a new invite.</p>
        <div className='row equal'>
          <button onClick={onOpen} disabled={busy}>Just read it</button>
          <button className='primary' disabled={busy} onClick={async () => { setBusy(true); try { await onCopy() } finally { setBusy(false) } }}>{busy ? 'Copying...' : 'Make my copy'}</button>
        </div>
      </section>
    </div>
  )
}

const RECOVERY_TITLES = {
  waiting: 'Waiting for someone in this file to let this device in',
  copy: 'Nobody else can let this device in. Open it to make a copy you own.'
}

// A menu's place: under a menu button's right edge, or at the pointer for a
// right-click or a held card (the menu then opens to the right).
const below = (e) => { const r = e.currentTarget.getBoundingClientRect(); return { x: r.right, y: r.bottom } }
const atPointer = (e) => ({ x: e.clientX, y: e.clientY, pointer: true })

// Right-click opens a card's menu on desktop. Phones hold the card instead
// (useTouchDrag), so the WebView's own long-press menu is kept away.
const contextMenu = (desktop, open) => (e) => {
  e.preventDefault()
  if (desktop) open(atPointer(e))
}

function FileCard ({ f, onOpen, onWaiting, onRecover, onMenu, desktop, onHold }) {
  return (
    <li
      className='file-cell'
      draggable={desktop && !f.joining}
      onDragStart={(e) => dragFile(e, f.sheetId)}
      onTouchStart={onHold ? (e) => onHold(e, f) : undefined}
      onContextMenu={contextMenu(desktop, (at) => { if (!f.joining) onMenu(f, at) })}
    >
      <button
        className={'file-card' + (f.waiting ? ' waiting' : '') + (f.removed ? ' removed' : '')}
        title={f.waiting ? 'Waiting for someone in this file to come online' : f.removed ? 'You were removed from this file' : RECOVERY_TITLES[f.recovery]}
        onClick={() => (f.waiting ? onWaiting(f.sheetId) : f.recovery === 'copy' ? onRecover(f) : onOpen(f.sheetId))}
      >
        <KindIcon kind={f.kind} size={28} />
        <span className='file-title'>{f.waiting ? 'Joining...' : (f.title || untitled(f.kind))}</span>
        <span className='file-meta'>
          {f.owner && (
            <span className='sheet-owner' title={f.owner.isMe ? 'Yours' : 'Owned by ' + (f.owner.name || 'someone')}>
              <MemberAvatar sheetId={f.sheetId} member={f.owner} size={20} />
            </span>
          )}
          {f.joining && !f.waiting && <span className='badge'>joining</span>}
          {f.recovery === 'waiting' && <span className='badge'>waiting to be let in</span>}
          {f.recovery === 'copy' && <span className='badge view-only'>make your copy</span>}
          {!f.joining && f.people > 1 && <span className='people-count'>{f.people} people</span>}
        </span>
      </button>
      {!f.joining && (
        <button className='card-more icon-button' aria-label='File menu' title='File menu' onClick={(e) => onMenu(f, below(e))}><DotsThree size={18} weight='bold' /></button>
      )}
    </li>
  )
}

const FILE_TYPE = 'application/x-pearoffice-file'

// Desktop: a file being dragged, from a card or the side list.
export function dragFile (e, sheetId) {
  e.dataTransfer.setData(FILE_TYPE, sheetId)
  e.dataTransfer.effectAllowed = 'move'
}

// Where a dragged file can go (desktop): a folder card or a folder in the
// side list, or, for no folder, the way back to Your files and All files.
export function dropTarget (onDrop, folder) {
  const has = (e) => [...(e.dataTransfer.types || [])].includes(FILE_TYPE)
  return {
    onDragOver: (e) => { if (has(e)) { e.preventDefault(); e.currentTarget.classList.add('drop-here') } },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop-here'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('drop-here')
      const sheetId = e.dataTransfer.getData(FILE_TYPE)
      if (sheetId) { e.preventDefault(); onDrop(sheetId, folder) }
    }
  }
}

// Phones: hold a file card for a moment, then drag it onto a folder card
// (or the way back to Your files), or let go without moving to open the
// file's menu. A touch that moves first scrolls the list. Drop targets carry
// data-drop-folder: a folder's id, or 'top'.
function useTouchDrag (onDrop, onMenu, canDrag) {
  const [ghost, setGhost] = useState(null) // { x, y, title } while dragging
  const drag = useRef(null) // { sheetId, x, y, on, timer }
  const over = useRef(null)
  const dropRef = useRef(onDrop)
  dropRef.current = onDrop
  const menuRef = useRef(onMenu)
  menuRef.current = onMenu
  const canDragRef = useRef(canDrag)
  canDragRef.current = canDrag
  const mark = (el) => {
    if (over.current === el) return
    if (over.current) over.current.classList.remove('drop-here')
    over.current = el
    if (el) el.classList.add('drop-here')
  }
  useEffect(() => {
    const move = (e) => {
      const d = drag.current
      const t = e.touches[0]
      if (!d || !t) return
      if (!d.on) {
        if (Math.hypot(t.clientX - d.x, t.clientY - d.y) > 8) { clearTimeout(d.timer); drag.current = null }
        return
      }
      e.preventDefault() // no scrolling while a file is held
      if (!canDragRef.current) return
      if (!d.moved && Math.hypot(t.clientX - d.x, t.clientY - d.y) <= 8) return
      if (!d.moved) { d.moved = true; setGhost({ x: d.x, y: d.y, kind: d.file.kind, title: d.file.title || untitled(d.file.kind) }) }
      setGhost((g) => g && { ...g, x: t.clientX, y: t.clientY })
      const el = document.elementFromPoint(t.clientX, t.clientY)
      mark(el && el.closest('[data-drop-folder]'))
    }
    const end = (e) => {
      const d = drag.current
      if (!d) return
      clearTimeout(d.timer)
      drag.current = null
      if (!d.on) return
      if (e.cancelable) e.preventDefault() // the held file does not open
      const el = over.current
      mark(null)
      setGhost(null)
      if (e.type !== 'touchend') return
      if (!d.moved) menuRef.current(d.file, { x: d.x, y: d.y, pointer: true })
      else if (el) {
        const folder = el.dataset.dropFolder
        dropRef.current(d.file.sheetId, folder === 'top' ? null : folder)
      }
    }
    document.addEventListener('touchmove', move, { passive: false })
    document.addEventListener('touchend', end, { passive: false })
    document.addEventListener('touchcancel', end)
    return () => {
      document.removeEventListener('touchmove', move)
      document.removeEventListener('touchend', end)
      document.removeEventListener('touchcancel', end)
    }
  }, [])
  const hold = (e, f) => {
    if (e.touches.length !== 1 || f.joining) return
    const t = e.touches[0]
    const d = { file: f, x: t.clientX, y: t.clientY, on: false, moved: false }
    d.timer = setTimeout(() => {
      d.on = true
      haptic('press')
    }, 400)
    drag.current = d
  }
  return { ghost, hold }
}

// The start screen: folders first, then the files in no folder, newest
// first; or, with a folder open, the files in it
// (proposals/2026-10-10-folders.md).
export function FileHome ({ files, actions, onOpen, onWaiting, onRecover = onOpen, folders = [], places = {}, folder = null, onFolder = () => {}, onNewFolder = () => {}, onFolderMenu = () => {}, onFileMenu = () => {}, onDrop = () => {}, desktop = false }) {
  const open = folder && folders.find((x) => x.id === folder)
  const shown = filesIn([...files].reverse(), places, open ? open.id : null)
  // Phones drag only when there is somewhere to drop.
  const { ghost, hold } = useTouchDrag(onDrop, onFileMenu, !!open || folders.length > 0)
  const card = (f) => <FileCard key={f.sheetId} f={f} onOpen={onOpen} onWaiting={onWaiting} onRecover={onRecover} onMenu={onFileMenu} desktop={desktop} onHold={desktop ? null : hold} />
  const dragGhost = ghost && (
    <div className='drag-ghost' style={{ left: ghost.x, top: ghost.y }} aria-hidden='true'>
      <KindIcon kind={ghost.kind} size={20} /> {ghost.title}
    </div>
  )
  if (open) {
    return (
      <div className='files-home in-folder'>
        <div className='folder-head'>
          <button className='link-button folder-back' data-drop-folder='top' {...(desktop ? dropTarget(onDrop, null) : {})} onClick={() => onFolder(null)}><CaretLeft size={16} aria-hidden='true' /> Your files</button>
          <h1><FolderSimple size={24} weight='duotone' aria-hidden='true' /> {open.name}</h1>
          <button className='icon-button folder-more' aria-label='Folder menu' title='Folder menu' onClick={(e) => onFolderMenu(open, below(e))}><DotsThree size={20} weight='bold' /></button>
        </div>
        <div className='files-actions'>{actions}</div>
        {shown.length === 0 && <p className='muted folder-empty'>{desktop ? 'This folder is empty. Drag a file here, or use Move to folder in a file\'s menu.' : 'This folder is empty. Use Move to folder in a file\'s menu.'}</p>}
        <ul className='file-grid' aria-label={open.name}>{shown.map(card)}</ul>
        {dragGhost}
      </div>
    )
  }
  return (
    <div className='files-home'>
      <h1>Your files</h1>
      <div className='files-actions'>{actions}</div>
      <ul className='file-grid' aria-label='Your files'>
        {folders.map((x) => {
          const n = filesIn(files, places, x.id).length
          return (
            <li key={x.id} className='file-cell' onContextMenu={contextMenu(desktop, (at) => onFolderMenu(x, at))}>
              <button className='file-card folder-card' data-drop-folder={x.id} {...(desktop ? dropTarget(onDrop, x.id) : {})} onClick={() => onFolder(x.id)}>
                <span className='kind-icon kind-folder'><FolderSimple size={28} weight='duotone' aria-hidden='true' /></span>
                <span className='file-title'>{x.name}</span>
                <span className='file-meta'><span className='muted'>{countLabel(n)}</span></span>
              </button>
              <button className='card-more icon-button' aria-label='Folder menu' title='Folder menu' onClick={(e) => onFolderMenu(x, below(e))}><DotsThree size={18} weight='bold' /></button>
            </li>
          )
        })}
        <li className='file-cell'>
          <button className='file-card new-folder-card' onClick={onNewFolder}>
            <FolderPlus size={28} aria-hidden='true' />
            <span className='file-title'>New folder</span>
          </button>
        </li>
        {shown.map(card)}
      </ul>
      {dragGhost}
    </div>
  )
}
