import React, { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call } from './bridge.js'

// "Tidy up this sheet" for the owner (proposals/2026-10-05-shared-compaction.md):
// the sheet moves to a fresh copy that keeps only how it is now. The app then
// switches to the new copy by itself (App.jsx, sheet:moved).
export function TidyPanel ({ sheetId, title, noun = 'file', onDone, onClose, onError }) {
  const [history, setHistory] = useState(null)
  const [busy, setBusy] = useState(false)

  useEffect(() => {
    call('sheet:history', { sheetId }).then(setHistory, (err) => onError(err.message))
  }, [sheetId])

  async function go () {
    setBusy(true)
    try {
      await call('sheet:compact', { sheetId })
      onDone()
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

  const blocked = history && history.openInvites > 0
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label={'Tidy up this ' + noun}>
        <header>
          <h2>Tidy up this {noun}?</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>
          <strong>{title || 'This ' + noun}</strong> keeps every change ever made to it
          {history ? <> ({history.updates.toLocaleString()} so far)</> : null}. Tidying up keeps only the {noun} as it is now, so every device uses less space and new people join faster.
        </p>
        <p className='muted small'>Everyone stays in the {noun} and their devices follow by themselves. Undo history starts again. PearOffice also does this by itself once a {noun} passes 50,000 changes.</p>
        {blocked && <p className='small'>An invite link for this {noun} has not been used yet, and tidying up would stop it working. Cancel it in Share first, or wait until it has been used.</p>}
        <div className='row end'>
          <button onClick={onClose}>Not now</button>
          <button className='primary' disabled={busy || !history || blocked} onClick={go}>{busy ? 'Working...' : 'Tidy up'}</button>
        </div>
      </section>
    </div>
  )
}
