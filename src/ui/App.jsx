import React, { useCallback, useEffect, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { SheetView } from './SheetView.jsx'
import { JoinPanel } from './JoinPanel.jsx'
import { SeederPanel } from './SeederPanel.jsx'
import { DevicesPanel } from './DevicesPanel.jsx'
import { importFile, pickAndImport, isMobile } from './xlsx.js'

export function App () {
  const [sheets, setSheets] = useState(null)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(null) // initial link text, or '' for an empty panel
  const [name, setName] = useState(null)
  const [seeder, setSeeder] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // phone layout: the sheet list slides in
  const [devices, setDevices] = useState(null) // { link } | { startWith } | {} when open
  const [nudge, setNudge] = useState(false)
  const [notice, setNotice] = useState(null)
  const desktop = !!(window.pearsheet && window.pearsheet.platform === 'desktop')
  const [keepOnline, setKeepOnline] = useState(null)
  const [startAtLogin, setStartAtLogin] = useState(false)

  const refresh = useCallback(async () => {
    try {
      setSheets(await call('sheet:list'))
      call('app:me').then((me) => setNudge(!!me.phraseNudge)).catch(() => {})
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const soon = useRef(null)
  const refreshSoon = useCallback(() => {
    if (soon.current) return
    soon.current = setTimeout(() => { soon.current = null; refresh() }, 300)
  }, [refresh])

  useEffect(() => {
    refresh()
    call('app:me').then((me) => { setName(me.name); setNudge(!!me.phraseNudge) }).catch(() => {})
    if (desktop) call('app:settings').then((s) => { setKeepOnline(!!s.keepOnline); setStartAtLogin(!!s.startAtLogin) }).catch(() => {})
    const offs = [
      on('worklet:exit', () => setError('The sync engine stopped. Restart PearSheet.')),
      on('join:progress', refresh),
      on('sheet:joined', async ({ sheetId }) => { await refresh(); setCurrent(sheetId) }),
      // A sheet moved to fresh keys: follow it if it is the one on screen.
      on('sheet:moved', async ({ from, to }) => { await refresh(); setCurrent((c) => (c === from ? to : c)) }),
      on('sheet:removed', refresh),
      // Any edit or membership change anywhere: titles, roles and people in
      // the sidebar stay live. Batched, since edits arrive in bursts.
      on('sheet:changed', refreshSoon),
      on('sheet:members', refreshSoon),
      // A sheet left this device (removed here, deleted by its owner, or an
      // old copy after a move).
      on('sheet:gone', async ({ sheetId }) => { setCurrent((c) => (c === sheetId ? null : c)); await refresh() }),
      on('sheet:deleted', ({ title }) => setNotice('"' + (title || 'A sheet') + '" was deleted by its owner.')),
      on('app:deeplink', ({ url }) => { call('app:takeLink').catch(() => {}); openLink(url) })
    ]
    // A link that opened the app before this page was listening.
    call('app:takeLink').then((r) => { if (r && r.url) openLink(r.url) }).catch(() => {})
    return () => offs.forEach((off) => off())
  }, [refresh, refreshSoon])

  function openLink (url) {
    if (/^pearsheet:\/\/join\?/.test(url)) setJoining(url)
    else if (/^pearsheet:\/\/seeder\?/.test(url)) setSeeder(url)
    else if (/^pearsheet:\/\/link\?/.test(url)) setDevices({ link: url })
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
      <button className='nav-toggle' aria-label='Your sheets' aria-expanded={navOpen} onClick={() => setNavOpen(true)}><span aria-hidden='true'>☰</span></button>
      {navOpen && <div className='nav-scrim' onClick={() => setNavOpen(false)} />}
      <aside className='sidebar' onClick={(e) => { if (e.target.closest('button')) setNavOpen(false) }}>
        <div className='brand'>
          <span className='brand-mark' aria-hidden='true' />
          PearSheet
        </div>
        <button className='new-sheet' onClick={create}>New sheet</button>
        <button className='join-sheet' onClick={() => setJoining('')}>Join with a link</button>
        {isMobile() && (
          <button
            className='join-sheet'
            onClick={async () => {
              try {
                const r = await pickAndImport()
                if (r) { await refresh(); setCurrent(r.sheetId) }
              } catch (err) { setError('Could not import: ' + err.message) }
            }}
          >
            Import .xlsx
          </button>
        )}
        <label className='join-sheet import' hidden={isMobile()}>
          Import .xlsx
          <input
            type='file'
            accept='.xlsx,.csv'
            hidden
            onChange={async (e) => {
              const file = e.target.files && e.target.files[0]
              e.target.value = ''
              if (!file) return
              try {
                const { sheetId } = await importFile(file)
                await refresh()
                setCurrent(sheetId)
              } catch (err) {
                setError('Could not import ' + file.name + ': ' + err.message)
              }
            }}
          />
        </label>
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
        {desktop && keepOnline !== null && (
          <label className='keep-online' title='Closing the window hides PearSheet in the tray, so people can sync with you while this computer is on'>
            <input
              type='checkbox'
              checked={keepOnline}
              onChange={async (e) => {
                const r = await call('app:setSetting', { keepOnline: e.target.checked }).catch((err) => { setError(err.message); return null })
                if (r) { setKeepOnline(!!r.keepOnline); setStartAtLogin(!!r.startAtLogin) }
              }}
            />
            Keep sheets online when closed
          </label>
        )}
        {desktop && keepOnline && (
          <label className='keep-online start-at-login' title='Opens PearSheet hidden in the tray when you log in, so your sheets stay reachable after a restart'>
            <input
              type='checkbox'
              checked={startAtLogin}
              onChange={async (e) => {
                const r = await call('app:setSetting', { startAtLogin: e.target.checked }).catch((err) => { setError(err.message); return null })
                if (r) setStartAtLogin(!!r.startAtLogin)
              }}
            />
            Start when the computer starts
          </label>
        )}
        <button className={'seeder-button' + (desktop ? ' second' : '')} onClick={() => setDevices({})}>Devices</button>
        <button className='seeder-button second' onClick={() => setSeeder(true)}>Seeder</button>
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
      {devices && <DevicesPanel initialLink={devices.link || ''} startWith={devices.startWith || null} onClose={() => setDevices(null)} onError={setError} />}
      {seeder && <SeederPanel initialLink={typeof seeder === 'string' ? seeder : ''} onClose={() => setSeeder(false)} onError={setError} />}
      <main className='main'>
        {notice && <div className='banner info'>{notice} <button className='link-button' onClick={() => setNotice(null)}>OK</button></div>}
        {nudge && (
          <div className='banner info'>
            Write down your recovery phrase so you can get your identity back if you lose this device.{' '}
            <button className='link-button' onClick={() => { setNudge(false); setDevices({ startWith: 'menu' }) }}>Show it</button>
            <button className='link-button' onClick={() => { setNudge(false); call('app:phraseNudged').catch(() => {}) }}>Later</button>
          </div>
        )}
        {error && <div className='banner' role='alert'>{error} <button className='link-button' onClick={() => setError(null)}>Dismiss</button></div>}
        {current
          ? <SheetView key={current} sheetId={current} onTitleChange={refresh} onError={setError} onGone={async () => { setCurrent(null); await refresh() }} />
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
