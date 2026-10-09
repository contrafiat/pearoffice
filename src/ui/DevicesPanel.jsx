import React, { useEffect, useRef, useState } from 'react'
import { ArrowCounterClockwise, CaretLeft, Check, DeviceMobile, Key, Laptop, PencilSimple, X } from '@phosphor-icons/react'
import { QrCode, ScanButton } from './Qr.jsx'
import { call, on } from './bridge.js'
import { PhraseInput } from './PhraseInput.jsx'
import { hasFilesError, linkDevice, phraseWordCount, restorePhrase } from './takeIdentity.js'

// "5 minutes ago", for last seen.
export function ago (ms, now = Date.now()) {
  const s = Math.max(0, Math.round((now - ms) / 1000))
  const unit = (n, word) => n + ' ' + word + (n === 1 ? '' : 's') + ' ago'
  if (s < 60) return 'just now'
  if (s < 3600) return unit(Math.floor(s / 60), 'minute')
  if (s < 86400) return unit(Math.floor(s / 3600), 'hour')
  if (s < 86400 * 30) return unit(Math.floor(s / 86400), 'day')
  return 'on ' + new Date(ms).toLocaleDateString()
}

// Every device that is you, with a name you can change on any of them
// (proposals/2026-10-07-device-names.md).
function LinkedDevices ({ onError }) {
  const [list, setList] = useState(null)
  const [editing, setEditing] = useState(null) // deviceKey
  const [draft, setDraft] = useState('')
  const timer = useRef(null)

  useEffect(() => {
    let live = true
    const load = () => call('app:devices').then((l) => { if (live) setList(l) }).catch(() => {})
    // Presence changes come often: load at most every half second.
    const soon = () => { if (!timer.current) timer.current = setTimeout(() => { timer.current = null; load() }, 500) }
    load()
    const offs = [on('devices:changed', soon), on('sheet:presence', soon), on('sheet:members', soon)]
    return () => { live = false; clearTimeout(timer.current); for (const off of offs) if (typeof off === 'function') off() }
  }, [])

  async function save (d) {
    const name = draft.trim()
    if (!name || name === d.name) { setEditing(null); return }
    try {
      await call('app:renameDevice', { deviceKey: d.deviceKey, name })
      setList((l) => l.map((x) => (x.deviceKey === d.deviceKey ? { ...x, name } : x)))
      setEditing(null)
    } catch (err) { onError(err.message) }
  }

  const status = (d) => d.thisDevice ? 'This device' : d.online ? 'Online now' : d.lastSeen ? 'Last seen ' + ago(d.lastSeen) : ''

  return (
    <div className='linked-devices'>
      <h3>Linked devices</h3>
      <ul className='people devices-list'>
        {(list || []).map((d) => (
          <li key={d.deviceKey} className='device-row' data-device={d.deviceKey}>
            <span className='device-icon' aria-hidden='true'>{d.kind === 'phone' ? <DeviceMobile size={22} /> : <Laptop size={22} />}</span>
            <span className='device-text'>
              {editing === d.deviceKey
                ? <input
                    aria-label='Device name'
                    placeholder='e.g. Work laptop'
                    maxLength={40}
                    value={draft}
                    ref={(el) => { if (el && !el.dataset.picked) { el.dataset.picked = '1'; el.focus(); el.select() } }}
                    onChange={(e) => setDraft(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === 'Enter') { e.preventDefault(); save(d) } else if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setEditing(null) }
                    }}
                  />
                : <span className='device-name'>{d.name}</span>}
              {status(d) && <span className={'device-status' + (d.online ? ' online' : '')}>{status(d)}</span>}
            </span>
            {editing === d.deviceKey
              ? <button className='icon-button' aria-label='Save name' title='Save' onClick={() => save(d)}><Check size={18} /></button>
              : <button className='icon-button' aria-label={'Rename ' + d.name} title='Rename' onClick={() => { setDraft(d.name); setEditing(d.deviceKey) }}><PencilSimple size={18} /></button>}
          </li>
        ))}
      </ul>
      {list && list.length === 1 && <p className='muted small center-text'>Link another device to see it here.</p>}
    </div>
  )
}

// Linking a person's devices and the recovery phrase
// (proposals/2026-10-03-device-linking.md).
export function DevicesPanel ({ initialLink = '', startWith = null, onBack = null, onClose, onError }) {
  const [mode, setMode] = useState(startWith || (initialLink ? 'use' : 'menu'))
  const [link, setLink] = useState(null) // the link this device shows
  const [linked, setLinked] = useState(false)
  const [input, setInput] = useState(initialLink)
  const [phrase, setPhrase] = useState(null)
  const [busy, setBusy] = useState(false)
  const [copied, setCopied] = useState(false)
  const [replacing, setReplacing] = useState(null) // { how: 'link' | 'restore', back, files }
  const [backedUp, setBackedUp] = useState(0) // seeders holding your file list

  useEffect(() => on('link:done', () => setLinked(true)), [])
  useEffect(() => {
    const load = () => call('app:keyring').then((r) => setBackedUp(r.seeders || 0)).catch(() => {})
    load()
    return on('keyring:changed', load)
  }, [])
  // Opened straight at the phrase (the first-run tour's Show my phrase).
  useEffect(() => {
    if (startWith !== 'phrase') return
    call('link:phrase').then((r) => { setPhrase(r.phrase); call('app:phraseNudged').catch(() => {}) }).catch((err) => { onError(err.message); onClose() })
  }, [])

  // `how` and `back` say what to offer if this device already has files.
  async function restartAfter (take, how, back) {
    setBusy(true)
    try {
      await take(false)
    } catch (err) {
      setBusy(false)
      if (how && hasFilesError(err)) {
        try { setReplacing({ how, back, take, files: await call('link:filesHere') }); setMode('replace'); return } catch {}
      }
      onError(err.message)
    }
  }

  const link1 = (l) => (replace) => linkDevice(l, { replace, before: () => call('app:onboarded') })
  // Restoring from here means they already use PearOffice: no first-run welcome after the restart.
  const restore1 = (replace) => restorePhrase(input, { replace, before: async () => { await call('app:onboarded'); await call('app:setWelcomeBack', { show: true }) } })

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel' role='dialog' aria-label='Devices'>
        <header>
          {onBack && <button className='link-button back' onClick={onBack}><CaretLeft size={14} /> Settings</button>}
          <h2>Your devices</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>

        {mode === 'menu' && (
          <>
            <LinkedDevices onError={onError} />
            <h3>Add a device</h3>
            <p>Use PearOffice on another phone or computer as the same person, with all your files.</p>
            <div className='row'>
              <button className='primary' onClick={async () => { setMode('show'); try { setLink(await call('link:start')) } catch (err) { onError(err.message) } }}><DeviceMobile size={16} /> Link a new device</button>
              <button onClick={() => setMode('use')}>This is the new device</button>
            </div>
            <h3>Recovery phrase</h3>
            <p>12 words that bring back your identity if you lose every device. Anyone with them can act as you.</p>
            {backedUp > 0
              ? <p className='muted'>They bring back your files too: your file list is backed up to {backedUp === 1 ? '1 seeder' : backedUp + ' seeders'}.</p>
              : <p className='muted'>With a seeder, they bring back your files too. Without one, the owner of each file invites you back after a restore, and files only you own need another linked device to survive.</p>}
            <div className='row'>
              <button onClick={async () => { try { setPhrase((await call('link:phrase')).phrase); setMode('phrase'); call('app:phraseNudged').catch(() => {}) } catch (err) { onError(err.message) } }}><Key size={16} /> Show phrase</button>
              <button onClick={() => setMode('restore')}><ArrowCounterClockwise size={16} /> Restore</button>
            </div>
            <p className='muted small'>If you lose a linked device, it still holds your identity. To cut it off, the owner of each file removes you and invites you again under a new identity.</p>
          </>
        )}

        {mode === 'show' && (
          <>
            <p>Open this link on your new device within 5 minutes. It gives that device your identity, so only use it on your own device.</p>
            <p className='muted'>Keep PearOffice open on this screen until the new device has joined. If you leave to send the link, come back here.</p>
            {link && (
              <div className='row'>
                <input readOnly value={link.link} aria-label='Device link' onFocus={(e) => e.target.select()} />
                <button className='primary' data-haptic='success' onClick={async () => { try { await navigator.clipboard.writeText(link.link); setCopied(true) } catch { if (window.pearoffice.platform === 'mobile') { await call('app:setClipboard', { text: link.link }); setCopied(true) } } }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            )}
            {link && (
              <div className='pairing'>
                <QrCode value={link.link} label='Device link QR code' />
                <p className='muted small'>Or scan this with PearOffice on the new phone.</p>
              </div>
            )}
            {linked && <p className='ok'>Linked. Your files are opening on the new device.</p>}
          </>
        )}

        {mode === 'use' && (
          <form className='stack' onSubmit={(e) => { e.preventDefault(); restartAfter(link1(input), 'link', 'use') }}>
            <p>Paste the link from your other device. This device takes on your identity and gets your files.</p>
            <input aria-label='Device link' placeholder='pearoffice://link?...' value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
            <ScanButton prefix='pearoffice://link?' what='a PearOffice device link' onError={onError} onLink={(l) => { setInput(l); restartAfter(link1(l), 'link', 'use') }} />
            <div className='row end'>
              <button type='button' onClick={() => setMode('menu')}>Back</button>
              <button className='primary' type='submit' disabled={busy || !input.trim()}>{busy ? 'Linking...' : 'Link'}</button>
            </div>
          </form>
        )}

        {mode === 'replace' && replacing && (
          <div className='stack replace-files'>
            <h3>This device already has files</h3>
            <p>
              {replacing.how === 'link' ? 'Linking makes this device you, as on your other device.' : 'Restoring makes this device the person your phrase belongs to.'}{' '}
              First, {replacing.files.total === 1 ? 'its 1 file is' : 'its ' + replacing.files.total + ' files are'} removed from this device.{replacing.files.onlyHere.length < replacing.files.total ? ' People you shared them with keep them.' : ''}
            </p>
            {replacing.files.onlyHere.length > 0 && (
              <div className='warn'>
                <p>{replacing.files.onlyHere.length === 1 ? 'This file is' : 'These files are'} only on this device and will be gone for good:</p>
                <ul>{replacing.files.onlyHere.map((t, i) => <li key={i}>{t}</li>)}</ul>
                <p>To keep {replacing.files.onlyHere.length === 1 ? 'it' : 'them'}, go back, export {replacing.files.onlyHere.length === 1 ? 'it' : 'them'} or share {replacing.files.onlyHere.length === 1 ? 'it' : 'them'} with your other identity first.</p>
              </div>
            )}
            <div className='row end'>
              <button type='button' onClick={() => { setMode(replacing.back); setReplacing(null) }}>Back</button>
              <button className='danger' disabled={busy} onClick={() => restartAfter(() => replacing.take(true))}>{busy ? 'Working...' : replacing.how === 'link' ? 'Remove files and link' : 'Remove files and restore'}</button>
            </div>
          </div>
        )}

        {mode === 'phrase' && phrase && (
          <>
            <p className='warn'>Write these down and keep them somewhere safe. Anyone who has them can act as you in every file{backedUp > 0 ? ' and read every file your seeders back up' : ''}.</p>
            <ol className='phrase'>{phrase.split(' ').map((w, i) => <li key={i}>{w}</li>)}</ol>
            <div className='row end'><button onClick={() => { setPhrase(null); if (startWith === 'phrase') onClose(); else setMode('menu') }}>Done</button></div>
          </>
        )}

        {mode === 'restore' && (
          <form className='stack' onSubmit={(e) => { e.preventDefault(); restartAfter(restore1, 'restore', 'restore') }}>
            <p>Type your 12 words. This brings back your identity, and your files if you had a seeder.</p>
            <PhraseInput value={input} onChange={setInput} autoFocus oneAtATime={!!(window.pearoffice && window.pearoffice.platform === 'mobile')} disabled={busy} />
            <div className='row end'>
              <button type='button' onClick={() => setMode('menu')}>Back</button>
              <button className='primary' type='submit' disabled={busy || phraseWordCount(input) !== 12}>{busy ? 'Restoring...' : 'Restore'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
