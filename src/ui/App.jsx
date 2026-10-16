import React, { useCallback, useEffect, useRef, useState } from 'react'
import { call, on } from './bridge.js'
import { readPref, writePref } from './prefs.js'
import { SheetView } from './sheet/SheetView.jsx'
import { DocView } from './doc/DocView.jsx'
import { SlidesView } from './slides/SlidesView.jsx'
import { JoinPanel, JoinProgress, JoinPill } from './JoinPanel.jsx'
import { SeederPanel } from './SeederPanel.jsx'
import { DevicesPanel } from './DevicesPanel.jsx'
import { importFile, pickAndImport, isMobile } from './sheet/xlsx.js'
import { Avatar, MemberAvatar } from './Avatar.jsx'
import { SettingsPanel } from './SettingsPanel.jsx'
import { UpdateBar } from './UpdateBar.jsx'
import { applyTheme } from './theme.js'
import { haptic, hapticTaps } from './haptic.js'
import { FileHome, KindIcon, NewPanel, RecoverPanel, dragFile, dropTarget, untitled } from './Files.jsx'
import { DeleteFolderPanel, FolderNamePanel, MoveToFolderPanel, filesIn, useFolders } from './Folders.jsx'
import { DeletePanel } from './DeletePanel.jsx'
import { DonationReminder } from './About.jsx'
import { Onboarding } from './Onboarding.jsx'
import { CaretRight, CircleNotch, FileArrowUp, FolderSimple, GearSix, House, Info, LinkSimple, List, Plus } from '@phosphor-icons/react'
import { PearMark } from './PearMark.jsx'

applyTheme()

// Import a file: .xlsx, .ods, .csv, .tsv or .json make a sheet; .docx, .odt, .md, .txt
// or .html a document; .pptx or .odp a slide deck. A file input on desktop, the
// shell's file picker on phones. onImported gets the new file's id and the
// import's result.
function ImportButton ({ className, onImported, onError }) {
  if (isMobile()) {
    return (
      <button
        className={className}
        onClick={async () => {
          try {
            const r = await pickAndImport()
            if (r) await onImported(r.sheetId, r)
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
        accept='.xlsx,.ods,.csv,.tsv,.json,.docx,.odt,.md,.markdown,.txt,.html,.htm,.pptx,.odp'
        hidden
        onChange={async (e) => {
          const file = e.target.files && e.target.files[0]
          e.target.value = ''
          if (!file) return
          try {
            const r = await importFile(file)
            await onImported(r.sheetId, r)
          } catch (err) {
            onError('Could not import ' + file.name + ': ' + err.message)
          }
        }}
      />
    </label>
  )
}

// Whether this build has an editor for the file's kind. Older builds learn
// about newer kinds through device linking (proposals/2026-10-06-documents.md).
const EDITORS = ['sheet', 'doc', 'slides']
function kindOf (files, sheetId) {
  const f = files && files.find((x) => x.sheetId === sheetId)
  return (f && f.kind) || 'sheet'
}
function opensHere (files, sheetId) {
  return EDITORS.includes(kindOf(files, sheetId))
}

function StartActions ({ onNew, onJoin, onImported, onError }) {
  return (
    <div className='empty-actions'>
      <button className='new-sheet big' onClick={onNew}><Plus size={18} /> New</button>
      <button className='join-sheet big' onClick={onJoin}><LinkSimple size={18} /> Join with a link</button>
      <ImportButton className='join-sheet big' onImported={onImported} onError={onError} />
    </div>
  )
}

// After a restore from the recovery phrase: progress while the files come
// back from the seeders (worklet restoring.js), or how to get them back
// when there was no file list.
function RestoreCard ({ restore, hidden, onHide, onDone }) {
  const state = restore ? restore.state : 'looking'
  const working = state === 'looking' || state === 'opening'
  if (working && hidden) return null
  return (
    <div className='restore-card' role='status'>
      {working && <CircleNotch className='join-spinner' size={36} aria-hidden='true' />}
      <h2>{working ? 'Restoring your files' : 'Welcome back'}</h2>
      <p>
        {state === 'looking'
          ? 'Looking for your files. This can take a minute.'
          : state === 'opening'
            ? 'Bringing back ' + (restore.files === 1 ? '1 file' : restore.files + ' files') + '...'
            : 'No backed-up files were found. Ask the owners of your files to invite you again; you will be back as yourself.'}
      </p>
      <button className={working ? 'link-button' : 'primary'} onClick={working ? onHide : onDone}>{working ? 'Hide' : 'OK'}</button>
    </div>
  )
}

export function App () {
  const [sheets, setSheets] = useState(null)
  const [current, setCurrent] = useState(null)
  const currentRef = useRef(null)
  currentRef.current = current
  const [error, setErrorNow] = useState(null)
  // While the worklet restarts with another identity (a link or a restore),
  // calls in flight fail; those errors would flash in a banner just before
  // the page reloads (src/ui/takeIdentity.js sets the flag).
  const setError = useCallback((m) => { if (m && window.__pearRestarting) return; setErrorNow(m) }, [])
  const [joining, setJoining] = useState(null) // initial link text, or '' for an empty panel
  const [name, setName] = useState(null)
  const [avatar, setAvatar] = useState(null) // { data, mime, hash } or null
  const [myId, setMyId] = useState(null)
  const [settings, setSettings] = useState(false) // true, or { mode, section } to open About at a section
  const [donateNudge, setDonateNudge] = useState(false)
  const [newFile, setNewFile] = useState(false) // the New panel, asking which kind
  // A short note at the bottom ("Joined ..."), gone after a few seconds.
  const [toast, setToast] = useState(null)
  useEffect(() => hapticTaps(), [])
  useEffect(() => { if (!toast) return; const t = setTimeout(() => setToast(null), 4000); return () => clearTimeout(t) }, [toast])
  const [waitingJoin, setWaitingJoin] = useState(null) // sheetId of the join shown in a progress panel
  const [seeder, setSeeder] = useState(false)
  const [navOpen, setNavOpen] = useState(false) // phone layout: the sheet list slides in
  const navRef = useRef(false)
  navRef.current = navOpen
  const [devices, setDevices] = useState(null) // { link } | { startWith } | {} when open
  const [nudge, setNudge] = useState(false)
  const [notice, setNotice] = useState(null)
  const desktop = !!(window.pearoffice && window.pearoffice.platform === 'desktop')
  const [keepOnline, setKeepOnline] = useState(null)
  const [startAtLogin, setStartAtLogin] = useState(false)
  // The first-run welcome and tour: null, or { tourOnly } while it is open.
  const [onboarding, setOnboarding] = useState(null)
  // After a restore from the recovery phrase: the identity is back, the
  // files are not, so a note says how to get them (app:welcomeBack).
  const [welcomeBack, setWelcomeBack] = useState(false)
  const welcomeBackRef = useRef(false)
  welcomeBackRef.current = welcomeBack
  // Files coming back from the seeders after that restore (worklet restoring.js).
  const [restore, setRestore] = useState(null)
  // The restore card is up: the empty start screen waits under it.
  const restoreWorking = welcomeBack && (!restore || restore.state === 'looking' || restore.state === 'opening')
  // The restore finished with files: say so briefly, then the card goes.
  // Files can also come from another of this person's devices (ownDevices.js)
  // when no seeder had a file list: then no "nothing found" card either.
  useEffect(() => {
    if (welcomeBack && restore && restore.state === 'none' && sheets && sheets.length > 0) {
      setWelcomeBack(false)
      call('app:setWelcomeBack', { show: false }).catch(() => {})
      return
    }
    if (!welcomeBack || !restore || restore.state !== 'done' || !(restore.files > 0)) return
    haptic('success')
    setToast(restore.files === 1 ? '1 file came back' : restore.files + ' files came back')
    setWelcomeBack(false)
    call('app:setWelcomeBack', { show: false }).catch(() => {})
  }, [welcomeBack, restore, sheets])
  const [recovering, setRecovering] = useState(null) // a file to offer a copy of
  // Folders (proposals/2026-10-10-folders.md): the one open on the start
  // screen, the panels and the menu on a card.
  const { folders, places } = useFolders()
  const [folder, setFolder] = useState(null)
  const folderRef = useRef(null)
  folderRef.current = folder && folders.some((f) => f.id === folder) ? folder : null
  const [naming, setNaming] = useState(null) // { folder } to rename, {} for a new one
  const [droppingFolder, setDroppingFolder] = useState(null)
  const [moving, setMoving] = useState(null) // a file to move to a folder
  const [cardMenu, setCardMenu] = useState(null) // { x, y, file } or { x, y, folder }
  const [deleting, setDeleting] = useState(null) // { file, kind: 'local' or 'everyone' }
  // Folders open in the side list, per device.
  const [sideOpen, setSideOpen] = useState(() => { try { return JSON.parse(readPref('pearoffice:openFolders') || '[]') } catch { return [] } })
  const toggleSide = (id) => setSideOpen((list) => {
    const next = list.includes(id) ? list.filter((x) => x !== id) : [...list, id]
    writePref('pearoffice:openFolders', JSON.stringify(next))
    return next
  })
  // A new or imported file goes into the folder open on the start screen.
  const fileHere = useCallback(async (sheetId) => {
    const f = folderRef.current
    if (f && sheetId) await call('file:place', { sheetId, folder: f }).catch(() => {})
  }, [])
  const [restoreHidden, setRestoreHidden] = useState(false)

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

  // A sheet that left this device: drop it from the list and, if it was on
  // screen, go back to the file list.
  const forget = useCallback((sheetId) => {
    setSheets((list) => (list ? list.filter((x) => x.sheetId !== sheetId) : list))
    setCurrent((c) => (c === sheetId ? null : c))
  }, [])

  const opened = useCallback(async (sheetId, r) => {
    await fileHere(sheetId)
    await refresh()
    setCurrent(sheetId)
    // A .pptx import says what it changed or left out (pptxImport.js, noticeFor).
    if (r && r.notice) setNotice(r.notice)
    else if (r && r.dropped) setNotice('Some parts of this file, such as pictures, were left out.')
  }, [refresh, fileHere])

  const soon = useRef(null)
  const refreshSoon = useCallback(() => {
    if (soon.current) return
    soon.current = setTimeout(() => { soon.current = null; refresh() }, 300)
  }, [refresh])

  // The open file, so a reload of the page (mobile/App.js: a crashed or
  // ended WebView, the GrapheneOS freeze fix) opens it again. Only then: a
  // fresh start shows the file list.
  // Read before the first write below empties it.
  const reopen = useRef(window.__pearReloaded ? readPref('pearoffice:open') : null)
  useEffect(() => { writePref('pearoffice:open', current || '') }, [current])

  useEffect(() => {
    const id = reopen.current
    refresh().then((list) => { if (id && list && list.some((x) => x.sheetId === id)) setCurrent(id) })
    loadMe()
    call('app:onboarding').then((r) => { if (r && !r.done) setOnboarding({ tourOnly: false }) }).catch(() => {})
    call('app:welcomeBack').then((r) => setWelcomeBack(!!(r && r.show))).catch(() => {})
    call('app:restoreStatus').then((r) => setRestore(r || null)).catch(() => {})
    if (desktop) call('app:settings').then((s) => { setKeepOnline(!!s.keepOnline); setStartAtLogin(!!s.startAtLogin) }).catch(() => {})
    const offs = [
      // Android Back (mobile/App.js): close what is on top, then leave the
      // open file; on the file list, close the app.
      on('app:back', () => {
        const panels = document.querySelectorAll('.panel-backdrop')
        const top = panels[panels.length - 1]
        if (top) {
          const close = top.querySelector('button.close')
          if (close) close.click()
          else top.dispatchEvent(new MouseEvent('mousedown', { bubbles: true }))
          return
        }
        const tourBack = document.querySelector('.ob-backdrop:not(.hidden) .ob-back:not(:disabled)')
        if (tourBack) return tourBack.click()
        if (navRef.current) return setNavOpen(false)
        if (currentRef.current) return setCurrent(null)
        if (folderRef.current) return setFolder(null)
        call('app:exit').catch(() => {})
      }),
      on('restore:changed', (r) => { setRestore(r); refresh() }),
      on('worklet:exit', () => setError('The sync engine stopped. Restart PearOffice.')),
      on('join:progress', refresh),
      on('sheet:joined', async ({ sheetId, fromOtherDevice, title }) => {
        const list = await refresh()
        // Made or joined on another of this person's devices
        // (src/worklet/ownDevices.js): list it, stay where we are.
        if (fromOtherDevice) {
          // During a restore the welcome back note counts them instead.
          if (!welcomeBackRef.current) setToast('A file from your other device: ' + (title || 'Untitled'))
          return
        }
        setCurrent(sheetId)
        setWaitingJoin((w) => (w === sheetId ? null : w))
        const s = list && list.find((x) => x.sheetId === sheetId)
        haptic('success')
        setToast('Joined ' + (s && s.title ? '"' + s.title + '"' : 'the file'))
      }),
      // A sheet moved to fresh keys: follow it if it is the one on screen.
      on('sheet:moved', async ({ from, to }) => { await refresh(); setCurrent((c) => (c === from ? to : c)) }),
      on('sheet:removed', refresh),
      on('sheet:tidied', () => setToast('Tidied up a long file')),
      // Any edit or membership change anywhere: titles, roles and people in
      // the sidebar stay live. Batched, since edits arrive in bursts.
      on('sheet:changed', refreshSoon),
      on('sheet:members', refreshSoon),
      // Another of this person's devices changed their name or picture.
      on('profile:changed', loadMe),
      // A sheet left this device (removed here, deleted by its owner, or an
      // old copy after a move).
      on('sheet:gone', async ({ sheetId }) => { forget(sheetId); await refresh() }),
      on('join:gaveUp', async () => { setNotice('PearOffice stopped waiting to join a file after 7 days. Ask for a new invite.'); await refresh() }),
      on('sheet:deleted', ({ title }) => setNotice('"' + (title || 'A file') + '" was deleted by its owner.')),
      on('app:deeplink', ({ url }) => { call('app:takeLink').catch(() => {}); openLink(url) })
    ]
    // A link that opened the app before this page was listening.
    call('app:takeLink').then((r) => { if (r && r.url) openLink(r.url) }).catch(() => {})
    return () => offs.forEach((off) => off())
  }, [refresh, refreshSoon])

  function openLink (url) {
    if (/^pearoffice:\/\/join\?/.test(url)) setJoining(url)
    else if (/^pearoffice:\/\/seeder\?/.test(url)) setSeeder(url)
    else if (/^pearoffice:\/\/link\?/.test(url)) setDevices({ link: url })
  }

  // The two-week donation nudge: asked once the file list is loaded, shown
  // once ever (marked shown as soon as it appears).
  const askedDonation = useRef(false)
  useEffect(() => {
    if (!sheets || askedDonation.current) return
    askedDonation.current = true
    call('donation:status').then((r) => {
      if (r && r.due) { setDonateNudge(true); call('donation:dismiss').catch(() => {}) }
    }).catch(() => {})
  }, [sheets])

  async function create (kind) {
    setNewFile(false)
    if (!EDITORS.includes(kind)) return
    try {
      const { sheetId } = kind === 'doc'
        ? await call('doc:create', { title: 'Untitled document' })
        : kind === 'slides'
          ? await call('slides:create', { title: 'Untitled slides' })
          : await call('sheet:create', { title: 'Untitled sheet' })
      await fileHere(sheetId)
      await refresh()
      setCurrent(sheetId)
    } catch (err) {
      setError(err.message)
    }
  }

  // A file dropped on a folder, or on All files for no folder.
  const placeFile = (sheetId, folder) => call('file:place', { sheetId, folder }).catch((err) => setError(err.message))

  // A file in the side list; on desktop it can be dragged onto a folder.
  const sideLink = (s) => (
    <button
      key={s.sheetId}
      className={'sheet-link' + (s.sheetId === current ? ' active' : '') + (s.joining ? ' joining' : '') + (s.waiting ? ' waiting' : '') + (s.removed ? ' removed' : '')}
      title={s.waiting ? 'Waiting for someone in this file to come online' : s.removed ? 'You were removed from this file' : undefined}
      onClick={() => (s.waiting ? setWaitingJoin(s.sheetId) : setCurrent(s.sheetId))}
      draggable={desktop && !s.joining}
      onDragStart={(e) => dragFile(e, s.sheetId)}
    >
      <KindIcon kind={s.kind} size={18} />
      {s.owner
        ? (
          <span className='sheet-owner' title={s.owner.isMe ? 'Yours' : 'Owned by ' + (s.owner.name || 'someone')}>
            <MemberAvatar sheetId={s.sheetId} member={s.owner} size={20} />
          </span>
          )
        : <span className='sheet-owner placeholder' aria-hidden='true' />}
      <span className='sheet-title'>{s.waiting ? 'Joining...' : (s.title || untitled(s.kind))}</span>
      {s.joining && !s.waiting && <span className='badge'>joining</span>}
      {!s.joining && s.people > 1 && (
        <span className='people-count' title={s.people + ' people'} aria-label={s.people + ' people'}>
          <svg viewBox='0 0 16 16' width='12' height='12' aria-hidden='true'><circle cx='8' cy='5' r='3' fill='currentColor' /><path d='M2 15c0-3.3 2.7-5.5 6-5.5s6 2.2 6 5.5z' fill='currentColor' /></svg>
          {s.people}
        </span>
      )}
    </button>
  )

  return (
    <div className={'app' + (navOpen ? ' nav-open' : '')}>
      <button className='nav-toggle' aria-label='Your files' aria-expanded={navOpen} onClick={() => setNavOpen(true)}><List size={20} aria-hidden='true' /></button>
      {navOpen && <div className='nav-scrim' onClick={() => setNavOpen(false)} />}
      <aside className='sidebar' onClick={(e) => { if (e.target.closest('button') && !e.target.closest('.folder-link')) setNavOpen(false) }}>
        <div className='brand'>
          <PearMark size={20} />
          PearOffice
        </div>
        <button className='new-sheet' onClick={() => setNewFile(true)}><Plus size={16} /> New</button>
        <button className='join-sheet' onClick={() => setJoining('')}><LinkSimple size={16} /> Join with a link</button>
        <ImportButton className='join-sheet' onImported={opened} onError={setError} />
        <nav className='sheet-list' aria-label='Your files'>
          {sheets === null && <p className='muted'>Starting...</p>}
          {sheets && sheets.length > 0 && (
            <button className={'sheet-link all-files' + (current ? '' : ' active')} {...(desktop ? dropTarget(placeFile, null) : {})} onClick={() => { setCurrent(null); setFolder(null) }}>
              <House size={18} aria-hidden='true' /><span className='sheet-title'>All files</span>
            </button>
          )}
          {sheets && sheets.length === 0 && <p className='muted'>No files yet.</p>}
          {sheets && folders.map((fd) => {
            const inside = filesIn([...sheets].reverse(), places, fd.id)
            const shown = sideOpen.includes(fd.id)
            return (
              <div key={fd.id} className={'side-folder' + (shown ? ' open' : '')}>
                <button className='sheet-link folder-link' aria-expanded={shown} {...(desktop ? dropTarget(placeFile, fd.id) : {})} onClick={() => toggleSide(fd.id)}>
                  <CaretRight className='side-caret' size={14} aria-hidden='true' />
                  <FolderSimple size={18} weight='duotone' aria-hidden='true' />
                  <span className='sheet-title'>{fd.name}</span>
                  <span className='folder-count'>{inside.length}</span>
                </button>
                {/* Always drawn, so opening and closing can slide. */}
                <div className='side-folder-files' inert={!shown}>
                  <div className='side-folder-inner'>{inside.map(sideLink)}</div>
                </div>
              </div>
            )
          })}
          {sheets && filesIn([...sheets].reverse(), places, null).map(sideLink)}
        </nav>
        <div className='me-bar'>
          <button className='me-row' onClick={() => setSettings(true)} aria-label='Settings'>
            <Avatar name={name} src={avatar ? 'data:' + avatar.mime + ';base64,' + avatar.data : null} seed={myId} size={32} />
            <span className='me-name'>{name || 'Set your name'}</span>
            <GearSix className='gear' size={20} aria-hidden='true' />
            {/* The recovery phrase not written down yet: a dot until it is shown (Settings > Devices). */}
            {nudge && <span className='nudge-dot' title='Write down your recovery phrase' aria-label='Write down your recovery phrase' />}
          </button>
          <button className='icon-button about-button' aria-label='About PearOffice' title='About PearOffice' onClick={() => setSettings({ mode: 'about' })}><Info size={20} /></button>
        </div>
      </aside>
      {newFile && <NewPanel onPick={create} onClose={() => setNewFile(false)} />}
      {cardMenu && (
        <>
          <div className='doc-scrim' onPointerDown={() => setCardMenu(null)} />
          <ul className='menu card-menu' role='menu' style={{ ...(cardMenu.pointer ? { left: Math.max(8, Math.min(cardMenu.x, window.innerWidth - 200)) } : { right: Math.max(8, window.innerWidth - cardMenu.x) }), top: Math.min(cardMenu.y + 4, window.innerHeight - 150) }} onClick={() => setCardMenu(null)}>
            {cardMenu.file && <li role='menuitem' onClick={() => setMoving(cardMenu.file)}>Move to folder...</li>}
            {cardMenu.file && <li role='menuitem' onClick={() => setDeleting({ file: cardMenu.file, kind: 'local' })}>Remove from this device</li>}
            {cardMenu.file && cardMenu.file.owner && cardMenu.file.owner.isMe && !cardMenu.file.removed && <li role='menuitem' className='danger' onClick={() => setDeleting({ file: cardMenu.file, kind: 'everyone' })}>Delete for everyone</li>}
            {cardMenu.folder && <li role='menuitem' onClick={() => setNaming({ folder: cardMenu.folder })}>Rename</li>}
            {cardMenu.folder && <li role='menuitem' className='danger' onClick={() => setDroppingFolder(cardMenu.folder)}>Delete folder</li>}
          </ul>
        </>
      )}
      {naming && (
        <FolderNamePanel
          title={naming.folder ? 'Rename folder' : 'New folder'}
          action={naming.folder ? 'Rename' : 'Create'}
          initial={naming.folder ? naming.folder.name : ''}
          onClose={() => setNaming(null)}
          onSave={async (value) => {
            try {
              if (naming.folder) await call('file:renameFolder', { id: naming.folder.id, name: value })
              else await call('file:newFolder', { name: value })
              setNaming(null)
            } catch (err) { setError(err.message) }
          }}
        />
      )}
      {droppingFolder && (
        <DeleteFolderPanel
          folder={droppingFolder}
          count={sheets ? filesIn(sheets, places, droppingFolder.id).length : 0}
          onClose={() => setDroppingFolder(null)}
          onDelete={async () => {
            try {
              await call('file:deleteFolder', { id: droppingFolder.id })
              setDroppingFolder(null)
              setFolder((f) => (f === droppingFolder.id ? null : f))
            } catch (err) { setError(err.message) }
          }}
        />
      )}
      {deleting && (
        <DeletePanel
          sheetId={deleting.file.sheetId}
          title={deleting.file.title || untitled(deleting.file.kind)}
          noun={deleting.file.kind === 'doc' ? 'document' : deleting.file.kind === 'slides' ? 'deck' : 'sheet'}
          kind={deleting.kind}
          onClose={() => setDeleting(null)}
          onError={setError}
          onDone={async () => { forget(deleting.file.sheetId); setDeleting(null); await refresh() }}
        />
      )}
      {moving && <MoveToFolderPanel sheetId={moving.sheetId} title={moving.title || untitled(moving.kind)} onClose={() => setMoving(null)} onError={setError} />}
      {recovering && (
        <RecoverPanel
          file={recovering}
          onClose={() => setRecovering(null)}
          onOpen={() => { setCurrent(recovering.sheetId); setRecovering(null) }}
          onCopy={async () => {
            try {
              const { sheetId } = await call('file:recoverCopy', { sheetId: recovering.sheetId })
              await refresh()
              setRecovering(null)
              setCurrent(sheetId)
              haptic('success')
              setToast('"' + (recovering.title || untitled(recovering.kind)) + '" is yours again')
            } catch (err) { setError(err.message); setRecovering(null) }
          }}
        />
      )}
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
          key={typeof settings === 'object' ? 'start-' + settings.mode + '-' + (settings.section || '') : 'settings'}
          me={{ name, avatar, identity: myId }}
          onMe={loadMe}
          phraseNudge={nudge}
          desktop={desktop}
          keepOnline={keepOnline}
          startAtLogin={startAtLogin}
          onSetting={async (patch) => {
            const r = await call('app:setSetting', patch).catch((err) => { setError(err.message); return null })
            if (r) { setKeepOnline(!!r.keepOnline); setStartAtLogin(!!r.startAtLogin) }
          }}
          onDevices={() => { setSettings(false); setDevices({ fromSettings: true }) }}
          onSeeder={() => { setSettings(false); setSeeder('fromSettings') }}
          onTour={() => { setSettings(false); setOnboarding({ tourOnly: true }) }}
          onClose={() => setSettings(false)}
          onError={setError}
          startIn={typeof settings === 'object' ? settings : null}
        />
      )}
      {donateNudge && <DonationReminder onClose={() => setDonateNudge(false)} onDonate={() => { setDonateNudge(false); setSettings({ mode: 'about', section: 'support' }) }} />}
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
      {devices && <DevicesPanel initialLink={devices.link || ''} startWith={devices.startWith || null} onBack={devices.fromSettings ? () => { setDevices(null); setSettings(true) } : null} onClose={() => { setDevices(null); loadMe() }} onError={setError} />}
      {seeder && <SeederPanel initialLink={typeof seeder === 'string' && seeder !== 'fromSettings' ? seeder : ''} onBack={seeder === 'fromSettings' ? () => { setSeeder(false); setSettings(true) } : null} onClose={() => setSeeder(false)} onError={setError} />}
      {onboarding && (
        <Onboarding
          tourOnly={onboarding.tourOnly}
          hidden={!!devices}
          me={{ name, avatar, identity: myId }}
          onMe={loadMe}
          onPhrase={() => setDevices({ startWith: 'phrase' })}
          onNew={() => setNewFile(true)}
          onJoin={() => setJoining('')}
          importButton={(finish) => <ImportButton className='ob-import' onImported={async (id, r) => { finish(); await opened(id, r) }} onError={setError} />}
          onDone={() => setOnboarding(null)}
          onError={setError}
        />
      )}
      <main className='main'>
        {desktop && <UpdateBar />}
        {notice && <div className='banner info'>{notice} <button className='link-button' onClick={() => setNotice(null)}>OK</button></div>}
        {welcomeBack && !onboarding && !(restore && restore.state === 'done' && restore.files > 0) && !(restore && restore.state === 'none' && sheets && sheets.length > 0) && (
          <RestoreCard
            restore={restore}
            hidden={restoreHidden}
            onHide={() => setRestoreHidden(true)}
            onDone={() => { setWelcomeBack(false); call('app:setWelcomeBack', { show: false }).catch(() => {}) }}
          />
        )}
        {error && <div className='banner' role='alert'>{error} <button className='link-button' onClick={() => setError(null)}>Dismiss</button></div>}
        {current && !opensHere(sheets, current)
          ? (
            <div className='empty'>
              <h1>Update PearOffice to open this file.</h1>
              <p>It was made with a newer version that has file types this one does not know.</p>
              <div className='empty-actions'><button className='join-sheet big' onClick={() => setCurrent(null)}><House size={18} /> All files</button></div>
            </div>
            )
          : current && kindOf(sheets, current) === 'doc'
            ? <DocView key={current} sheetId={current} onTitleChange={refresh} onError={setError} onGone={async () => { forget(current); await refresh() }} />
            : current && kindOf(sheets, current) === 'slides'
              ? <SlidesView key={current} sheetId={current} onTitleChange={refresh} onError={setError} onGone={async () => { forget(current); await refresh() }} />
              : current
              ? <SheetView key={current} sheetId={current} onTitleChange={refresh} onError={setError} onGone={async () => { forget(current); await refresh() }} />
              : sheets && (sheets.length || folders.length)
                ? (
                  <FileHome
                    files={sheets}
                    onOpen={setCurrent}
                    onWaiting={setWaitingJoin}
                    onRecover={setRecovering}
                    folders={folders}
                    places={places}
                    folder={folderRef.current}
                    onFolder={setFolder}
                    onNewFolder={() => setNaming({})}
                    onFolderMenu={(fd, at) => setCardMenu({ ...at, folder: fd })}
                    onFileMenu={(f, at) => setCardMenu({ ...at, file: f })}
                    onDrop={placeFile}
                    desktop={desktop}
                    actions={<StartActions onNew={() => setNewFile(true)} onJoin={() => setJoining('')} onImported={opened} onError={setError} />}
                  />
                  )
                : restoreWorking && !restoreHidden
                  ? null
                  : (
                  <div className='empty'>
                    <h1>Shared files, device to device.</h1>
                    <p>No accounts and no servers. Create a file, join one with a link or import one.</p>
                    <StartActions onNew={() => setNewFile(true)} onJoin={() => setJoining('')} onImported={opened} onError={setError} />
                  </div>
                  )}
      </main>
    </div>
  )
}
