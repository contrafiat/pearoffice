import React, { useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call } from './bridge.js'

// Confirmations for the two kinds of deleting
// (proposals/2026-10-04-deleting-sheets.md).
export function DeletePanel ({ sheetId, title, kind, onDone, onClose, onError }) {
  const [busy, setBusy] = useState(false)
  const everyone = kind === 'everyone'

  async function go () {
    setBusy(true)
    try {
      await call(everyone ? 'sheet:deleteForEveryone' : 'sheet:removeLocal', { sheetId })
      onDone()
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label={everyone ? 'Delete for everyone' : 'Remove from this device'}>
        <header>
          <h2>{everyone ? 'Delete for everyone?' : 'Remove from this device?'}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        {everyone
          ? (
            <>
              <p><strong>{title || 'This sheet'}</strong> will be deleted from every device in it, and from the seeder a week from now. This cannot be undone.</p>
              <p className='muted small'>Deletion relies on the other devices taking part: someone running a modified app could keep their copy. People who stay offline for more than a week keep a frozen copy that cannot sync.</p>
            </>
            )
          : <p><strong>{title || 'This sheet'}</strong> will be removed from this device and its storage freed. Everyone else keeps their copy, and you stay a member: the owner can invite you back.</p>}
        <div className='row end'>
          <button onClick={onClose}>Keep it</button>
          <button className={everyone ? 'danger' : 'primary'} disabled={busy} onClick={go}>
            {busy ? 'Working...' : everyone ? 'Delete' : 'Remove'}
          </button>
        </div>
      </section>
    </div>
  )
}
