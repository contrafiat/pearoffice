import React, { useEffect, useState } from 'react'
import { call } from './bridge.js'

export function SeederPanel ({ onClose, onError }) {
  const [link, setLink] = useState('')
  const [busy, setBusy] = useState(false)
  const [seeders, setSeeders] = useState(null)
  const [done, setDone] = useState(false)

  async function load () {
    try { setSeeders(await call('seeder:list')) } catch (err) { onError(err.message) }
  }
  useEffect(() => { load() }, [])

  async function pair (e) {
    e.preventDefault()
    setBusy(true)
    setDone(false)
    try {
      await call('seeder:pair', { link: link.trim() })
      setLink('')
      setDone(true)
      load()
    } catch (err) {
      onError(err.message)
    }
    setBusy(false)
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <form className='panel' role='dialog' aria-label='Seeder' onSubmit={pair}>
        <header>
          <h2>Seeder</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}>×</button>
        </header>
        <p>
          A seeder is an always-on computer that keeps an encrypted copy of your sheets, so people can catch up
          even when nobody else is online. It cannot read your sheets: it never gets their keys.
        </p>
        <p>Start the seeder, then paste the pairing link it shows. Links work for 5 minutes.</p>
        <input
          aria-label='Seeder pairing link'
          placeholder='pearsheet://seeder?...'
          value={link}
          onChange={(e) => setLink(e.target.value)}
        />
        <div className='row end'>
          {done && <span className='muted'>Paired. Your sheets are backing up.</span>}
          <button className='primary' type='submit' disabled={busy || !link.trim()}>{busy ? 'Pairing...' : 'Pair'}</button>
        </div>
        <h3>Paired seeders</h3>
        {seeders && seeders.length === 0 && <p className='muted'>None yet.</p>}
        <ul className='people'>
          {(seeders || []).map((s) => <li key={s.seederKey}><span className='who mono'>{s.seederKey.slice(0, 16)}...</span></li>)}
        </ul>
      </form>
    </div>
  )
}
