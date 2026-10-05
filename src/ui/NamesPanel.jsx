// Named ranges (proposals/2026-10-04-sheet-tools.md): list, add, rename,
// change and delete the sheet's names, and jump to one.

import React, { useState } from 'react'
import { X, PencilSimple, Trash, Plus } from '@phosphor-icons/react'

// "Tab!A1:B5" when the name is on another tab, else "A1:B5".
const where = (n, tabId) => (n.range === '#REF!' ? '#REF!' : n.tabId === tabId ? n.range : (/^[A-Za-z_][\w.]*$/.test(n.tab) ? n.tab : "'" + String(n.tab).replace(/'/g, "''") + "'") + '!' + n.range)

function NameForm ({ start, onSave, onCancel }) {
  const [name, setName] = useState(start.name || '')
  const [range, setRange] = useState(start.range || '')
  return (
    <>
      <input aria-label='Name' placeholder='Name, for example Sales' value={name} onChange={(e) => setName(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSave(name, range) }} autoFocus={!('ontouchstart' in window)} />
      <input aria-label='Range' placeholder='Range, for example B2:B20' value={range} onChange={(e) => setRange(e.target.value)} onKeyDown={(e) => { if (e.key === 'Enter') onSave(name, range) }} />
      <div className='row end'>
        <button onClick={onCancel}>Cancel</button>
        <button className='primary' disabled={!name.trim() || !range.trim()} onClick={() => onSave(name, range)}>Save</button>
      </div>
    </>
  )
}

export function NamesPanel ({ names, tabId, selection, startAdding, canEdit, act, onGo, onClose }) {
  const [editing, setEditing] = useState(startAdding ? { range: selection } : null)
  const [error, setError] = useState('')

  async function save (name, range) {
    setError('')
    let r
    if (editing.old && editing.old.toUpperCase() !== name.trim().toUpperCase()) {
      r = await act('renameName', { from: editing.old, to: name })
      if (r && r.error) { setError(r.error); return }
    } else if (!editing.old && names.some((n) => n.name.toUpperCase() === name.trim().toUpperCase())) {
      setError('There is already a range called ' + name.trim())
      return
    }
    r = await act('setName', { name, range })
    if (r && r.error) setError(r.error)
    else setEditing(null)
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel names-panel' role='dialog' aria-label='Named ranges'>
        <header>
          <h2>{editing ? (editing.old ? 'Change ' + editing.old : 'Name a range') : 'Named ranges'}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {editing
          ? <NameForm start={editing} onSave={save} onCancel={() => { setError(''); if (startAdding && !names.length) onClose(); else setEditing(null) }} />
          : (
            <>
              {!names.length && <p className='muted'>No named ranges yet. Name a range to use it in formulas, as in =SUM(Sales).</p>}
              <ul className='cf-list'>
                {names.map((n) => (
                  <li key={n.name}>
                    <button className='link-button name-go' disabled={n.range === '#REF!'} onClick={() => onGo(n)}>
                      <b>{n.name}</b> <span className='muted'>{where(n, tabId)}</span>
                    </button>
                    {canEdit && (
                      <span className='cf-tools'>
                        <button className='icon-button' aria-label={'Change ' + n.name} title='Change' onClick={() => setEditing({ old: n.name, name: n.name, range: where(n, tabId) === '#REF!' ? '' : where(n, tabId) })}><PencilSimple size={16} /></button>
                        <button className='icon-button' aria-label={'Delete ' + n.name} title='Delete' onClick={() => act('deleteName', { name: n.name })}><Trash size={16} /></button>
                      </span>
                    )}
                  </li>
                ))}
              </ul>
              {canEdit && <div className='row'><button onClick={() => setEditing({ range: selection })}><Plus size={16} /> Name a range</button></div>}
            </>
            )}
        {error && <p className='error'>{error}</p>}
      </section>
    </div>
  )
}
