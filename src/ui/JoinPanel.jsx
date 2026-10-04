import React, { useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { ScanButton } from './Qr.jsx'

export function JoinPanel ({ initialLink = '', onJoined, onClose, onError }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)

  async function join (e, scanned) {
    if (e) e.preventDefault()
    setBusy(true)
    try {
      const { sheetId } = await call('sheet:join', { link: (scanned || link).trim() })
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
          <button type='button' className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>Paste the invite link someone sent you. It connects straight to their device, so one of the people already in the sheet needs to be online.</p>
        <input
          autoFocus
          aria-label='Invite link'
          placeholder='pearsheet://join?...'
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <ScanButton prefix='pearsheet://join?' what='a PearSheet invite' onError={onError} onLink={(l) => { setLink(l); join(null, l) }} />
        <div className='row end'>
          <button type='button' onClick={onClose}>Cancel</button>
          <button className='primary' type='submit' disabled={busy || !link.trim()}>{busy ? 'Joining...' : 'Join'}</button>
        </div>
      </form>
    </div>
  )
}

// A join still waiting for someone in the sheet to let it in.
export function WaitingJoinPanel ({ entry, onClose, onError }) {
  const [busy, setBusy] = useState(false)
  const since = entry.startedAt ? Math.max(0, Math.floor((Date.now() - entry.startedAt) / 86400000)) : null
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Waiting to join'>
        <header>
          <h2>Waiting to join</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>
          The invite link connects straight to the devices of the people already in the sheet, so one of them
          needs to be online with PearSheet open.{since ? ' Waiting for ' + since + (since === 1 ? ' day.' : ' days.') : ''}
        </p>
        {entry.reason && <p className='warn'>Last reply: {entry.reason}</p>}
        <p className='small'>If the invite has expired or was used, ask for a new one. PearSheet stops waiting by itself after 7 days.</p>
        <div className='row end'>
          <button onClick={onClose}>Keep waiting</button>
          <button
            className='danger'
            disabled={busy}
            onClick={async () => {
              setBusy(true)
              try { await call('sheet:cancelJoin', { sheetId: entry.sheetId }); onClose() } catch (err) { onError(err.message); setBusy(false) }
            }}
          >{busy ? 'Stopping...' : 'Stop joining'}
          </button>
        </div>
      </section>
    </div>
  )
}
