// Folders (proposals/2026-10-10-folders.md): yours alone, one level, a file in
// one folder or none. The records live in the worklet (folders.js); these are
// the panels that change them.
import React, { useCallback, useEffect, useState } from 'react'
import { Check, FolderPlus, FolderSimple, X } from '@phosphor-icons/react'
import { call, on } from './bridge.js'

// { folders: [{ id, name }], places: { sheetId: folderId }, loaded }, kept live.
export function useFolders () {
  const [state, setState] = useState({ folders: [], places: {}, loaded: false })
  const load = useCallback(() => call('file:folders').then((r) => setState({ ...r, loaded: true })).catch(() => {}), [])
  useEffect(() => {
    load()
    const offs = [on('folders:changed', load), on('sheet:moved', load)]
    return () => offs.forEach((off) => off())
  }, [load])
  return state
}

// The files at the top level (folder null) or in a folder. A file whose
// folder is gone has no entry in places, so it is at the top level.
export function filesIn (files, places, folder) {
  return files.filter((f) => (places[f.sheetId] || null) === folder)
}

export const countLabel = (n) => (n === 0 ? 'Empty' : n === 1 ? '1 file' : n + ' files')

// New folder and Rename: one name.
export function FolderNamePanel ({ title, initial = '', action, onSave, onClose }) {
  const [name, setName] = useState(initial)
  const [busy, setBusy] = useState(false)
  const ok = name.trim().length > 0
  async function save () {
    if (!ok || busy) return
    setBusy(true)
    try { await onSave(name) } finally { setBusy(false) }
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel folder-name' role='dialog' aria-label={title}>
        <header>
          <h2>{title}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <input
          aria-label='Folder name'
          placeholder='Folder name'
          value={name}
          maxLength={100}
          autoFocus
          onChange={(e) => setName(e.target.value)}
          onKeyDown={(e) => { if (e.key === 'Enter') save() }}
        />
        <div className='row equal'>
          <button onClick={onClose}>Cancel</button>
          <button className='primary' disabled={!ok || busy} onClick={save}>{action}</button>
        </div>
      </section>
    </div>
  )
}

// Delete folder: its files stay, at the top level.
export function DeleteFolderPanel ({ folder, count, onDelete, onClose }) {
  const [busy, setBusy] = useState(false)
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Delete folder'>
        <header>
          <h2>Delete this folder?</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>
          <strong>{folder.name}</strong> will be deleted from all your devices.
          {count > 0 ? (count === 1 ? ' The file in it moves back to Your files.' : ' The ' + count + ' files in it move back to Your files.') : ''}
        </p>
        <div className='row equal'>
          <button onClick={onClose}>Keep it</button>
          <button className='danger' disabled={busy} onClick={async () => { setBusy(true); try { await onDelete() } finally { setBusy(false) } }}>Delete</button>
        </div>
      </section>
    </div>
  )
}

// Move to folder: the folders, No folder, or a new one.
export function MoveToFolderPanel ({ sheetId, title, onClose, onError }) {
  const { folders, places, loaded } = useFolders()
  const [naming, setNaming] = useState(false)
  const here = places[sheetId] || null

  async function move (folder) {
    try {
      await call('file:place', { sheetId, folder })
      onClose()
    } catch (err) { onError(err.message) }
  }

  if (naming) {
    return (
      <FolderNamePanel
        title='New folder'
        action='Create'
        onClose={() => setNaming(false)}
        onSave={async (name) => {
          try {
            const f = await call('file:newFolder', { name })
            await move(f.id)
          } catch (err) { onError(err.message) }
        }}
      />
    )
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel move-folder' role='dialog' aria-label='Move to folder'>
        <header>
          <h2>Move to folder</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {title && <p className='muted move-what'>{title}</p>}
        <ul className='folder-choices' hidden={!loaded}>
          <li>
            <button className={'folder-choice' + (here === null ? ' current' : '')} onClick={() => move(null)}>
              <span className='folder-choice-icon' aria-hidden='true' />
              <span className='folder-choice-name'>No folder</span>
              {here === null && <Check size={18} aria-label='Here now' />}
            </button>
          </li>
          {folders.map((f) => (
            <li key={f.id}>
              <button className={'folder-choice' + (here === f.id ? ' current' : '')} onClick={() => move(f.id)}>
                <FolderSimple className='folder-choice-icon' size={20} weight='duotone' aria-hidden='true' />
                <span className='folder-choice-name'>{f.name}</span>
                {here === f.id && <Check size={18} aria-label='Here now' />}
              </button>
            </li>
          ))}
        </ul>
        <div className='row center'>
          <button onClick={() => setNaming(true)}><FolderPlus size={18} aria-hidden='true' /> New folder</button>
        </div>
      </section>
    </div>
  )
}
