import React from 'react'
import { CaretLeft, DotsThree, FileText, FolderPlus, FolderSimple, PresentationChart, Table, X } from '@phosphor-icons/react'
import { MemberAvatar } from './Avatar.jsx'
import { filesIn, countLabel } from './Folders.jsx'

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

function FileCard ({ f, onOpen, onWaiting, onRecover, onMenu, draggable }) {
  return (
    <li
      className='file-cell'
      draggable={draggable && !f.joining}
      onDragStart={(e) => { e.dataTransfer.setData('application/x-pearoffice-file', f.sheetId); e.dataTransfer.effectAllowed = 'move' }}
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
        <button className='card-more icon-button' aria-label='File menu' title='File menu' onClick={(e) => onMenu(e, f)}><DotsThree size={18} weight='bold' /></button>
      )}
    </li>
  )
}

// Where a dragged file can go (desktop): a folder card, or the way back to
// Your files from inside a folder.
function dropTarget (onDrop, folder) {
  const has = (e) => [...(e.dataTransfer.types || [])].includes('application/x-pearoffice-file')
  return {
    onDragOver: (e) => { if (has(e)) { e.preventDefault(); e.currentTarget.classList.add('drop-here') } },
    onDragLeave: (e) => e.currentTarget.classList.remove('drop-here'),
    onDrop: (e) => {
      e.currentTarget.classList.remove('drop-here')
      const sheetId = e.dataTransfer.getData('application/x-pearoffice-file')
      if (sheetId) { e.preventDefault(); onDrop(sheetId, folder) }
    }
  }
}

// The start screen: folders first, then the files in no folder, newest
// first; or, with a folder open, the files in it
// (proposals/2026-10-10-folders.md).
export function FileHome ({ files, actions, onOpen, onWaiting, onRecover = onOpen, folders = [], places = {}, folder = null, onFolder = () => {}, onNewFolder = () => {}, onFolderMenu = () => {}, onFileMenu = () => {}, onDrop = () => {}, desktop = false }) {
  const open = folder && folders.find((x) => x.id === folder)
  const shown = filesIn([...files].reverse(), places, open ? open.id : null)
  const card = (f) => <FileCard key={f.sheetId} f={f} onOpen={onOpen} onWaiting={onWaiting} onRecover={onRecover} onMenu={onFileMenu} draggable={desktop} />
  if (open) {
    return (
      <div className='files-home in-folder'>
        <div className='folder-head'>
          <button className='link-button folder-back' {...(desktop ? dropTarget(onDrop, null) : {})} onClick={() => onFolder(null)}><CaretLeft size={16} aria-hidden='true' /> Your files</button>
          <h1><FolderSimple size={24} weight='duotone' aria-hidden='true' /> {open.name}</h1>
          <button className='icon-button folder-more' aria-label='Folder menu' title='Folder menu' onClick={(e) => onFolderMenu(e, open)}><DotsThree size={20} weight='bold' /></button>
        </div>
        <div className='files-actions'>{actions}</div>
        {shown.length === 0 && <p className='muted folder-empty'>{desktop ? 'This folder is empty. Drag a file here, or use Move to folder in a file\'s menu.' : 'This folder is empty. Use Move to folder in a file\'s menu.'}</p>}
        <ul className='file-grid' aria-label={open.name}>{shown.map(card)}</ul>
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
            <li key={x.id} className='file-cell'>
              <button className='file-card folder-card' {...(desktop ? dropTarget(onDrop, x.id) : {})} onClick={() => onFolder(x.id)}>
                <span className='kind-icon kind-folder'><FolderSimple size={28} weight='duotone' aria-hidden='true' /></span>
                <span className='file-title'>{x.name}</span>
                <span className='file-meta'><span className='muted'>{countLabel(n)}</span></span>
              </button>
              <button className='card-more icon-button' aria-label='Folder menu' title='Folder menu' onClick={(e) => onFolderMenu(e, x)}><DotsThree size={18} weight='bold' /></button>
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
    </div>
  )
}
