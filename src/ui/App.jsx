import React, { useCallback, useEffect, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { SheetView } from './SheetView.jsx'
import { JoinPanel, JoinProgress, JoinPill } from './JoinPanel.jsx'
import { SeederPanel } from './SeederPanel.jsx'
import { DevicesPanel } from './DevicesPanel.jsx'
import { importFile, pickAndImport, isMobile } from './xlsx.js'
import { Avatar, MemberAvatar } from './Avatar.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { UpdateBar } from './UpdateBar.jsx'
import { applyTheme } from './theme.js'
import { FileArrowUp, GearSix, LinkSimple, List, Plus } from '@phosphor-icons/react'

applyTheme()

// Import a file (.xlsx, .csv or .json): a file input on desktop, the shell's
// file picker on phones.
function ImportButton ({ className, onImported, onError }) {
  if (isMobile()) {
    return (
      <button
        className={className}
        onClick={async () => {
          try {
            const r = await pickAndImport()
            if (r) await onImported(r.sheetId)
          } catch (err) { onError('Could not import: ' + err.message) }
        }}
      >
        <FileArrowUp size={16} /> Import a file
      </button>
    )
  }
  return (
    <label className={className + ' import'}>
      <FileArrowUp size={16} /> Import a file
      <input
        type='file'
        accept='.xlsx,.csv,.tsv,.json'
        hidden
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0]
          e.target.value = ''
          if (!file) return
          try {
            const { sheetId } = await importFile(file)
            await onImported(sheetId)
          } catch (err) {
            onError('Could not import ' + file.name + ': ' + err.message)
          }
        }}
      />
    </label>
  )
}

export function App () {
  const [sheets, setSheets] = useState(null)
  const [current, setCurrent] = useState(null)
  const [error, setError] = useState(null)
  const [joining, setJoining] = useState(null) // initial link text, or '' for an empty panel
  const [name, setName] = useState(null)
  const [avatar, setAvatar] = useState(null) // { data, mime, hash } or null
  const [myId, setMyId] = useState(null)
  const [settings, setSettings] = useState(false)
  // A short note at the bottom ("Joined ..."), gone after a few seconds.
  const [toast, setToast] = useState(null)
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])
  const [waitingJoin, setWaitingJoin] = useState(null) // sheetId of the join shown in a progress panel
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
      const list = await call('sheet:list')
      setSheets(list)
      call('app:me').then((me) => setNudge(!!me.phraseNudge)).catch(() => {})
      return list
    } catch (err) {
      setError(err.message)
    }
  }, [])

  const loadMe = useCallback(() => call('app:me').then((me) => { setName(me.name); setAvatar(me.avatar || null); setMyId(me.identity); setNudge(!!me.phraseNudge) }).catch(() => {}), [])

  // A sheet that left this device: drop it from the list before anything
  // else, or the "open the most recent sheet" step below picks it again.
  const forget = useCallback((sheetId) => {
    setSheets((list) => (list ? list.filter((x) => x.sheetId !== sheetId) : list))
    setCurrent((c) => (c === sheetId ? null : c))
  }, [])

  const opened = useCallback(async (sheetId) => { await refresh(); setCurrent(sheetId) }, [refresh])

  const soon = useRef(null)
  const refreshSoon = useCallback(() => {
    if (soon.current) return
    soon.current = setTimeout(() => { soon.current = null; refresh() }, 300)
  }, [refresh])

  useEffect(() => {
    refresh()
    loadMe()
    if (desktop) call('app:settings').then((s) => { setKeepOnline(!!s.keepOnline); setStartAtLogin(!!s.startAtLogin) }).catch(() => {})
    const offs = [
      on('worklet:exit', () => setError('The sync engine stopped. Restart PearSheet.')),
      on('join:progress', refresh),
      on('sheet:joined', async ({ sheetId }) => {
        const list = await refresh()
        setCurrent(sheetId)
        setWaitingJoin((w) => (w === sheetId ? null : w))
        const s = list && list.find((x) => x.sheetId === sheetId)
        setToast('Joined ' + (s && s.title ? '"' + s.title + '"' : 'the sheet'))
      }),
      // A sheet moved to fresh keys: follow it if it is the one on screen.
      on('sheet:moved', async ({ from, to }) => { await refresh(); setCurrent((c) => (c === from ? to : c)) }),
      on('sheet:removed', refresh),
      on('sheet:tidied', () => setNotice('PearSheet tidied up a long sheet: devices now keep it as it is, not every change ever made.')),
      // Any edit or membership change anywhere: titles, roles and people in
      // the sidebar stay live. Batched, since edits arrive in bursts.
      on('sheet:changed', refreshSoon),
      on('sheet:members', refreshSoon),
      // Another of this person's devices changed their name or picture.
      on('profile:changed', loadMe),
      // A sheet left this device (removed here, deleted by its owner, or an
      // old copy after a move).
      on('sheet:gone', async ({ sheetId }) => { forget(sheetId); await refresh() }),
      on('join:gaveUp', async () => { setNotice('PearSheet stopped waiting to join a sheet after 7 days. Ask for a new invite.'); await refresh() }),
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

  // Open the most recent sheet on start. Not a join still waiting for its
  // keys: there is nothing to open yet.
  useEffect(() => {
    const ready = (sheets || []).filter((s) => !s.waiting)
    if (ready.length && !current) setCurrent(ready[ready.length - 1].sheetId)
  }, [sheets, current])

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <button className='nav-toggle' aria-label='Your sheets' aria-expanded={navOpen} onClick={() => setNavOpen(true)}><List size={20} aria-hidden='true' /></button>
      {navOpen && <div className='nav-scrim' onClick={() => setNavOpen(false)} />}
      <aside className='sidebar' onClick={(e) => { if (e.target.closest('button')) setNavOpen(false) }}>
        <div className='brand'>
          <span className='brand-mark' aria-hidden='true' />
          PearSheet
        </div>
        <button className='new-sheet' onClick={create}><Plus size={16} /> New sheet</button>
        <button className='join-sheet' onClick={() => setJoining('')}><LinkSimple size={16} /> Join with a link</button>
        <ImportButton className='join-sheet' onImported={opened} onError={setError} />
        <nav className='sheet-list' aria-label='Your sheets'>
          {sheets === null && <p className='muted'>Starting...</p>}
          {sheets && sheets.length === 0 && <p className='muted'>No sheets yet.</p>}
          {sheets && [...sheets].reverse().map((s) => (
            <button
              key={s.sheetId}
              className={'sheet-link' + (s.sheetId === current ? ' active' : '') + (s.joining ? ' joining' : '') + (s.waiting ? ' waiting' : '') + (s.removed ? ' removed' : '')}
              title={s.waiting ? 'Waiting for someone in this sheet to come online' : s.removed ? 'You were removed from this sheet' : undefined}
              onClick={() => (s.waiting ? setWaitingJoin(s.sheetId) : setCurrent(s.sheetId))}
            >
              {s.owner
                ? (
                  <span className='sheet-owner' title={s.owner.isMe ? 'Yours' : 'Owned by ' + (s.owner.name || 'someone')}>
                    <MemberAvatar sheetId={s.sheetId} member={s.owner} size={20} />
                  </span>
                  )
                : <span className='sheet-owner placeholder' aria-hidden='true' />}
              <span className='sheet-title'>{s.waiting ? 'Joining...' : (s.title || 'Untitled sheet')}</span>
              {s.joining && !s.waiting && <span className='badge'>joining</span>}
              {!s.joining && s.people > 1 && (
                <span className='people-count' title={s.people + ' people'} aria-label={s.people + ' people'}>
                  <svg viewBox='0 0 16 16' width='12' height='12' aria-hidden='true'><circle cx='8' cy='5' r='3' fill='currentColor' /><path d='M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z' fill='currentColor' /></svg>
                  {s.people}
                </span>
              )}
            </button>
          ))}
        </nav>
        <button className='me-row' onClick={() => setSettings(true)} aria-label='Settings'>
          <Avatar name={name} src={avatar ? 'data:' + avatar.mime + ';base64,' + avatar.data : null} seed={myId} size={32} />
          <span className='me-name'>{name || 'Set your name'}</span>
          <GearSix className='gear' size={20} aria-hidden='true' />
        </button>
      </aside>
      {joining !== null && (
        <JoinPanel
          initialLink={joining}
          onClose={() => setJoining(null)}
          onError={setError}
          onStarted={async (sheetId) => { setJoining(null); await refresh(); setWaitingJoin(sheetId) }}
        />
      )}
      {settings && (
        <SettingsPanel
          me={{ name, avatar, identity: myId }}
          onMe={loadMe}
          desktop={desktop}
          keepOnline={keepOnline}
          startAtLogin={startAtLogin}
          onSetting={async (patch) => {
            const r = await call('app:setSetting', patch).catch((err) => { setError(err.message); return null })
            if (r) { setKeepOnline(!!r.keepOnline); setStartAtLogin(!!r.startAtLogin) }
          }}
          onDevices={() => { setSettings(false); setDevices({ fromSettings: true }) }}
          onSeeder={() => { setSettings(false); setSeeder('fromSettings') }}
          onClose={() => setSettings(false)}
          onError={setError}
        />
      )}
      {waitingJoin && sheets && sheets.find((x) => x.sheetId === waitingJoin && x.joining) && (
        <JoinProgress
          entry={sheets.find((x) => x.sheetId === waitingJoin)}
          onBackground={() => setWaitingJoin(null)}
          onClose={() => setWaitingJoin(null)}
          onError={setError}
        />
      )}
      {!waitingJoin && joining === null && sheets && <JoinPill entries={sheets.filter((x) => x.joining)} onOpen={setWaitingJoin} />}
      {toast && <div className='toast' role='status'>{toast}</div>}
      {devices && <DevicesPanel initialLink={devices.link || ''} startWith={devices.startWith || null} onBack={devices.fromSettings ? () => { setDevices(null); setSettings(true) } : null} onClose={() => setDevices(null)} onError={setError} />}
      {seeder && <SeederPanel initialLink={typeof seeder === 'string' && seeder !== 'fromSettings' ? seeder : ''} onBack={seeder === 'fromSettings' ? () => { setSeeder(false); setSettings(true) } : null} onClose={() => setSeeder(false)} onError={setError} />}
      <main className='main'>
        {desktop && <UpdateBar />}
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
          ? <SheetView key={current} sheetId={current} onTitleChange={refresh} onError={setError} onGone={async () => { forget(current); await refresh() }} />
          : (
            <div className='empty'>
              <h1>Shared spreadsheets, device to device.</h1>
              <p>No accounts and no servers. Create a sheet, join one with a link or import a file.</p>
              <div className='empty-actions'>
                <button className='new-sheet big' onClick={create}><Plus size={18} /> New sheet</button>
                <button className='join-sheet big' onClick={() => setJoining('')}><LinkSimple size={18} /> Join with a link</button>
                <ImportButton className='join-sheet big' onImported={opened} onError={setError} />
              </div>
            </div>
            )}
      </main>
    </div>
  )
}
