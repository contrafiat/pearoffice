import React, { useState } from 'react'
import { call } from './bridge.js'

export function JoinPanel ({ initialLink = '', onJoined, onClose, onError }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)

  async function join (e) {
    e.preventDefault()
    setBusy(true)
    try {
      const { sheetId } = await call('sheet:join', { link: link.trim() })
      onJoined(sheetId)
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className='panel' role='dialog' aria-label='Join a sheet' onSubmit={join}>
        <header>
          <h2>Join a sheet</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}>×</button>
        </header>
        <p>Paste the invite link someone sent you. It connects straight to their device, so one of the people already in the sheet needs to be online.</p>
        <input
          autoFocus
          aria-label='Invite link'
          placeholder='pearsheet://join?...'
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <div className='row end'>
          <button type='button' onClick={onClose}>Cancel</button>
          <button className='primary' type='submit' disabled={busy || !link.trim()}>{busy ? 'Joining...' : 'Join'}</button>
        </div>
      </form>
    </div>
  )
}
