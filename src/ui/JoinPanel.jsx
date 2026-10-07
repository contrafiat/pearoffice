import React, { useEffect, useState } from 'react'
import { X, CircleNotch, CheckCircle, Circle } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { ScanButton } from './Qr.jsx'

export function JoinPanel ({ initialLink = '', onStarted, onClose, onError }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)

  async function join (e, scanned) {
    if (e) e.preventDefault()
    setBusy(true)
    try {
      const { sheetId } = await call('sheet:join', { link: (scanned || link).trim() })
      onStarted(sheetId)
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className='panel' role='dialog' aria-label='Join a file' onSubmit={join}>
        <header>
          <h2>Join a file</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>
        <p>Paste the invite link someone sent you. It connects straight to their device, so one of the people already in the file needs to be online.</p>
        <input
          autoFocus
          aria-label='Invite link'
          placeholder='pearoffice://join?...'
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <ScanButton prefix='pearoffice://join?' what='a PearOffice invite' onError={onError} onLink={(l) => { setLink(l); join(null, l) }} />
        <div className='row end'>
          <button type='button' onClick={onClose}>Cancel</button>
          <button className='primary' type='submit' disabled={busy || !link.trim()}>{busy ? 'Joining...' : 'Join'}</button>
        </div>
      </form>
    </div>
  )
}

// A join in progress: a spinner and its steps. After a few seconds it can
// be sent to the background, where a pill at the bottom of the screen
// (JoinPill) brings it back. entry: the sheet list's entry for the join.
const BACKGROUND_AFTER_MS = 10000

export function JoinProgress ({ entry, onBackground, onClose, onError }) {
  const [busy, setBusy] = useState(false)
  const [now, setNow] = useState(Date.now())
  useEffect(() => { const t = setInterval(() => setNow(Date.now()), 1000); return () => clearInterval(t) }, [])
  const started = entry.startedAt || now
  const waited = Math.max(0, now - started)
  const days = Math.floor(waited / 86400000)
  // Two steps the app can tell apart: someone let us in, then the content.
  const letIn = !entry.waiting
  const steps = [
    ['Reaching someone in the file', letIn ? 'done' : 'now'],
    ['Getting the file', letIn ? 'now' : 'next']
  ]
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onBackground() }}>
      <section className='panel join-progress' role='dialog' aria-label='Joining a sheet'>
        <header>
          <h2>Joining {entry.title ? '"' + entry.title + '"' : 'a sheet'}</h2>
          <button className='close' aria-label='Keep going in the background' onClick={onBackground}><X size={18} /></button>
        </header>
        <CircleNotch className='join-spinner' size={40} aria-hidden='true' />
        <ul className='join-steps'>
          {steps.map(([label, state]) => (
            <li key={label} className={state}>
              {state === 'done' ? <CheckCircle size={18} weight='fill' /> : state === 'now' ? <CircleNotch size={18} className='spin' /> : <Circle size={18} />}
              {label}
            </li>
          ))}
        </ul>
        {!letIn && waited > BACKGROUND_AFTER_MS && (
          <p className='small'>
            The invite connects straight to the people already in the file, so one of them needs to be online with PearOffice open.
            {days ? ' Waiting for ' + days + (days === 1 ? ' day.' : ' days.') : ''} PearOffice stops waiting by itself after 7 days.
          </p>
        )}
        {entry.reason && <p className='warn'>Last reply: {entry.reason}</p>}
        <div className='row end'>
          <button
            className='danger'
            disabled={busy || letIn}
            onClick={async () => {
              setBusy(true)
              try { await call('sheet:cancelJoin', { sheetId: entry.sheetId }); onClose() } catch (err) { onError(err.message); setBusy(false) }
            }}
          >{busy ? 'Stopping...' : 'Stop joining'}
          </button>
          {waited > BACKGROUND_AFTER_MS && <button onClick={onBackground}>Keep going in the background</button>}
        </div>
      </section>
    </div>
  )
}

// Joins running in the background: a pill at the bottom of the screen.
export function JoinPill ({ entries, onOpen }) {
  if (!entries.length) return null
  const first = entries[0]
  return (
    <button className='join-pill' onClick={() => onOpen(first.sheetId)}>
      <CircleNotch size={16} className='spin' aria-hidden='true' />
      {entries.length > 1 ? 'Joining ' + entries.length + ' sheets...' : first.title ? 'Joining "' + first.title + '"...' : 'Joining a sheet...'}
    </button>
  )
}
