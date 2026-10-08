import React from 'react'
import { FileText, PresentationChart, Table, X } from '@phosphor-icons/react'
import { MemberAvatar } from './Avatar.jsx'

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

// The start screen: every file on this device, newest first.
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

export function FileHome ({ files, actions, onOpen, onWaiting, onRecover = onOpen }) {
  return (
    <div className='files-home'>
      <h1>Your files</h1>
      <div className='files-actions'>{actions}</div>
      <ul className='file-grid' aria-label='Your files'>
        {[...files].reverse().map((f) => (
          <li key={f.sheetId}>
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
          </li>
        ))}
      </ul>
    </div>
  )
}
