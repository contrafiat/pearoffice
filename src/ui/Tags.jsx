// Tags (proposals/2026-10-28-file-tags.md): yours alone, many per file. The
// records live in the worklet (tags.js); these are the pills and the panel
// that changes them.
import React, { useCallback, useEffect, useState } from 'react'
import { CaretLeft, Check, PencilSimple, Plus, Trash, X } from '@phosphor-icons/react'
import { call, on } from './bridge.js'

// { tags: [{ id, name, color }], files: { sheetId: [tagId] }, loaded }, kept live.
export function useTags () {
  const [state, setState] = useState({ tags: [], files: {}, loaded: false })
  const load = useCallback(() => call('file:tags').then((r) => setState({ ...r, loaded: true })).catch(() => {}), [])
  useEffect(() => {
    load()
    const offs = [on('tags:changed', load), on('sheet:moved', load)]
    return () => offs.forEach((off) => off())
  }, [load])
  return state
}

export const tagsOf = (state, sheetId) => (state.files[sheetId] || []).map((id) => state.tags.find((t) => t.id === id)).filter(Boolean).sort((a, b) => a.name.localeCompare(b.name, undefined, { sensitivity: 'base', numeric: true }))

// The files with every one of `picked` (tag ids). As tags.js withAll.
export function withAll (files, state, picked) {
  if (!picked.length) return files
  return files.filter((f) => picked.every((id) => (state.files[f.sheetId] || []).includes(id)))
}

export function TagPill ({ tag, className = '' }) {
  return <span className={'chip tag-pill chip-' + tag.color + (className ? ' ' + className : '')} title={tag.name}>{tag.name}</span>
}

// A file card's tags: up to three, then how many more.
export function CardTags ({ tags, most = 3 }) {
  if (!tags.length) return null
  const more = tags.length - most
  return (
    <span className='card-tags' aria-label={'Tags: ' + tags.map((t) => t.name).join(', ')}>
      {tags.slice(0, most).map((t) => <TagPill key={t.id} tag={t} />)}
      {more > 0 && <span className='tag-more'>+{more}</span>}
    </span>
  )
}

// Tags...: tick the file's tags, make a new one, or manage them all.
export function TagsPanel ({ sheetId, title, onClose, onError }) {
  const state = useTags()
  const [name, setName] = useState('')
  const [managing, setManaging] = useState(false)
  const mine = state.files[sheetId] || []
  const typed = name.trim()
  const exists = typed && state.tags.find((t) => t.name.localeCompare(typed, undefined, { sensitivity: 'base' }) === 0)

  const flip = async (t) => {
    try { await call('file:tag', { sheetId, id: t.id, on: !mine.includes(t.id) }) } catch (err) { onError(err.message) }
  }
  const add = async () => {
    if (!typed) return
    try {
      const t = await call('file:newTag', { name: typed })
      await call('file:tag', { sheetId, id: t.id, on: true })
      setName('')
    } catch (err) { onError(err.message) }
  }

  if (managing) return <ManageTags state={state} onBack={() => setManaging(false)} onClose={onClose} onError={onError} />
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel tags-panel' role='dialog' aria-label='Tags'>
        <header>
          <h2>Tags</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {title && <p className='muted move-what'>{title}</p>}
        <div className='tag-new'>
          <input
            aria-label='New tag'
            placeholder='New tag'
            value={name}
            maxLength={40}
            onChange={(e) => setName(e.target.value)}
            onKeyDown={(e) => { if (e.key === 'Enter') add() }}
          />
          <button className='primary' disabled={!typed} onClick={add}><Plus size={16} aria-hidden='true' /> {exists ? 'Add' : 'Create'}</button>
        </div>
        <ul className='folder-choices tag-choices' hidden={!state.loaded}>
          {state.tags.map((t) => {
            const has = mine.includes(t.id)
            return (
              <li key={t.id}>
                <button className={'folder-choice' + (has ? ' current' : '')} role='menuitemcheckbox' aria-checked={has} onClick={() => flip(t)}>
                  <TagPill tag={t} />
                  <span className='folder-choice-name' />
                  {has && <Check size={18} aria-hidden='true' />}
                </button>
              </li>
            )
          })}
        </ul>
        {state.loaded && !state.tags.length && <p className='muted template-hint'>Tags help you find files later, such as Bicycle or Budget. Only you see them.</p>}
        {state.tags.length > 0 && (
          <div className='row center'>
            <button className='link-button manage-tags' onClick={() => setManaging(true)}>Manage tags</button>
          </div>
        )}
      </section>
    </div>
  )
}

// Rename and delete, for every file at once.
function ManageTags ({ state, onBack, onClose, onError }) {
  const [editing, setEditing] = useState(null) // { id, name }
  const [dropping, setDropping] = useState(null) // a tag to delete
  const count = (id) => Object.values(state.files).filter((ids) => ids.includes(id)).length
  const save = async () => {
    if (!editing || !editing.name.trim()) return
    try { await call('file:renameTag', { id: editing.id, name: editing.name }); setEditing(null) } catch (err) { onError(err.message) }
  }
  const drop = async () => {
    try { await call('file:deleteTag', { id: dropping.id }); setDropping(null) } catch (err) { onError(err.message) }
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel tags-panel' role='dialog' aria-label='Manage tags'>
        <header>
          <button className='link-button back' aria-label='Back' onClick={onBack}><CaretLeft size={18} /></button>
          <h2>Manage tags</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {dropping
          ? (
            <>
              <p>
                <strong>{dropping.name}</strong> will be deleted from all your devices
                {count(dropping.id) ? (count(dropping.id) === 1 ? ' and taken off 1 file.' : ' and taken off ' + count(dropping.id) + ' files.') : '.'} The files stay.
              </p>
              <div className='row equal'>
                <button onClick={() => setDropping(null)}>Keep it</button>
                <button className='danger' onClick={drop}>Delete</button>
              </div>
            </>
            )
          : (
            <ul className='folder-choices tag-manage'>
              {state.tags.map((t) => (
                <li key={t.id} className='tag-row'>
                  {editing && editing.id === t.id
                    ? (
                      <>
                        <input
                          aria-label='Tag name'
                          value={editing.name}
                          maxLength={40}
                          autoFocus
                          onChange={(e) => setEditing({ ...editing, name: e.target.value })}
                          onKeyDown={(e) => { if (e.key === 'Enter') save(); if (e.key === 'Escape') setEditing(null) }}
                        />
                        <button className='icon-button' aria-label='Save' title='Save' disabled={!editing.name.trim()} onClick={save}><Check size={18} /></button>
                      </>
                      )
                    : (
                      <>
                        <TagPill tag={t} />
                        <span className='muted tag-count'>{count(t.id) === 1 ? '1 file' : count(t.id) + ' files'}</span>
                        <button className='icon-button' aria-label={'Rename ' + t.name} title='Rename' onClick={() => setEditing({ id: t.id, name: t.name })}><PencilSimple size={18} /></button>
                        <button className='icon-button danger' aria-label={'Delete ' + t.name} title='Delete' onClick={() => setDropping(t)}><Trash size={18} /></button>
                      </>
                      )}
                </li>
              ))}
            </ul>
            )}
      </section>
    </div>
  )
}

// After New from a template that you tagged: "Use the same tags as the
// template?" Yes tags the new file with them.
export function TemplateTagsPanel ({ sheetId, tags, onClose, onError }) {
  const yes = async () => {
    onClose()
    try {
      for (const t of tags) await call('file:tag', { sheetId, id: t.id, on: true })
    } catch (err) { onError(err.message) }
  }
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel template-tags' role='alertdialog' aria-label='Use the same tags as the template?'>
        <header>
          <h2>Use the same tags as the template?</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p className='card-tags'>{tags.map((t) => <TagPill key={t.id} tag={t} />)}</p>
        <div className='row equal'>
          <button onClick={onClose}>No</button>
          <button className='primary' onClick={yes}>Yes</button>
        </div>
      </section>
    </div>
  )
}
