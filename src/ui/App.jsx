import React, { useCallback, useEffect, useState } from 'react'
import { call, on } from './bridge.js'
import { SheetView } from './SheetView.jsx'
import { JoinPanel } from './JoinPanel.jsx'
import { SeederPanel } from './SeederPanel.jsx'

export function App () {
  const [sheets, setSheets] = useState(null)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(null) // initial link text, or '' for an empty panel
  const [name, setName] = useState(null)
  const [seeder, setSeeder] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // phone layout: the sheet list slides in

  const refresh = useCallback(async () => {
    try {
      setSheets(await call('sheet:list'))
    } catch (err) {
      setError(err.message)
    }
  }, [])

  useEffect(() => {
    refresh()
    call('app:me').then((me) => setName(me.name)).catch(() => {})
    const offs = [
      on('worklet:exit', () => setError('The sync engine stopped. Restart PearSheet.')),
      on('join:progress', refresh),
      on('sheet:joined', async ({ sheetId }) => { await refresh(); setCurrent(sheetId) }),
      // A sheet moved to fresh keys: follow it if it is the one on screen.
      on('sheet:moved', async ({ from, to }) => { await refresh(); setCurrent((c) => (c === from ? to : c)) }),
      on('sheet:removed', refresh),
      on('app:deeplink', ({ url }) => { call('app:takeLink').catch(() => {}); openLink(url) })
    ]
    // A link that opened the app before this page was listening.
    call('app:takeLink').then((r) => { if (r && r.url) openLink(r.url) }).catch(() => {})
    return () => offs.forEach((off) => off())
  }, [refresh])

  function openLink (url) {
    if (/^pearsheet:\/\/join\?/.test(url)) setJoining(url)
    else if (/^pearsheet:\/\/seeder\?/.test(url)) setSeeder(url)
  }

  async function create () {
    try {
      const { sheetId } = await call('sheet:create', { title: 'Untitled sheet' })
      await refresh()
      setCurrent(sheetId)
    } catch (err) {
      setError(err.message)
    }
  }

  // Open the most recent sheet on start.
  useEffect(() => {
    if (sheets && sheets.length && !current) setCurrent(sheets[sheets.length - 1].sheetId)
  }, [sheets, current])

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <button className='nav-toggle' aria-label='Your sheets' onClick={() => setNavOpen(true)}>☰</button>
      {navOpen && <div className='nav-scrim' onClick={() => setNavOpen(false)} />}
      <aside className='sidebar' onClick={(e) => { if (e.target.closest('.sheet-link')) setNavOpen(false) }}>
        <div className='brand'>
          <span className='brand-mark' aria-hidden='true' />
          PearSheet
        </div>
        <button className='new-sheet' onClick={create}>New sheet</button>
        <button className='join-sheet' onClick={() => setJoining('')}>Join with a link</button>
        <nav className='sheet-list' aria-label='Your sheets'>
          {sheets === null && <p className='muted'>Starting...</p>}
          {sheets && sheets.length === 0 && <p className='muted'>No sheets yet.</p>}
          {sheets && [...sheets].reverse().map((s) => (
            <button
              key={s.sheetId}
              className={'sheet-link' + (s.sheetId === current ? ' active' : '') + (s.joining ? ' joining' : '') + (s.removed ? ' removed' : '')}
              disabled={s.waiting}
              title={s.waiting ? 'Waiting for someone in this sheet to come online' : s.removed ? 'You were removed from this sheet' : undefined}
              onClick={() => setCurrent(s.sheetId)}
            >
              {s.waiting ? 'Joining...' : (s.title || 'Untitled sheet')}
              {s.joining && !s.waiting && <span className='badge'>joining</span>}
            </button>
          ))}
        </nav>
        <button className='seeder-button' onClick={() => setSeeder(true)}>Seeder</button>
        <label className='my-name'>
          <span>Your name</span>
          <input
            placeholder='Shown to people you share with'
            defaultValue={name || ''}
            key={name === null ? 'loading' : 'ready'}
            onBlur={async (e) => { const v = e.target.value.trim(); if (v !== (name || '')) { await call('app:setName', { name: v }); setName(v) } }}
            onKeyDown={(e) => { if (e.key === 'Enter') e.target.blur() }}
          />
        </label>
      </aside>
      {joining !== null && (
        <JoinPanel
          initialLink={joining}
          onClose={() => setJoining(null)}
          onError={setError}
          onJoined={async () => { setJoining(null); await refresh() }}
        />
      )}
      {seeder && <SeederPanel initialLink={typeof seeder === 'string' ? seeder : ''} onClose={() => setSeeder(false)} onError={setError} />}
      <main className='main'>
        {error && <div className='banner' role='alert'>{error} <button className='link-button' onClick={() => setError(null)}>Dismiss</button></div>}
        {current
          ? <SheetView key={current} sheetId={current} onTitleChange={refresh} onError={setError} />
          : (
            <div className='empty'>
              <h1>Shared spreadsheets, device to device.</h1>
              <p>No accounts and no servers. Create a sheet to start.</p>
              <button className='new-sheet big' onClick={create}>New sheet</button>
            </div>
            )}
      </main>
    </div>
  )
}
