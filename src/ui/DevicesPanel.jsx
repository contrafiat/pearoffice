import React, { useEffect, useState } from 'react'
import { ArrowCounterClockwise, CaretLeft, DeviceMobile, Key, X } from '@phosphor-icons/react'
import { QrCode, ScanButton } from './Qr.jsx'
import { call, on } from './bridge.js'

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

  useEffect(() => on('link:done', () => setLinked(true)), [])
  // Opened straight at the phrase (the first-run tour's Show my phrase).
  useEffect(() => {
    if (startWith !== 'phrase') return
    call('link:phrase').then((r) => { setPhrase(r.phrase); call('app:phraseNudged').catch(() => {}) }).catch((err) => { onError(err.message); onClose() })
  }, [])

  async function restartAfter (method, args) {
    setBusy(true)
    try {
      const r = await call(method, args)
      if (r && r.restart) await call('app:restart')
    } catch (err) {
      onError(err.message)
      setBusy(false)
    }
  }

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
            <p>Use PearOffice on another phone or computer as the same person, with all your sheets.</p>
            <div className='row'>
              <button className='primary' onClick={async () => { setMode('show'); try { setLink(await call('link:start')) } catch (err) { onError(err.message) } }}><DeviceMobile size={16} /> Link a new device</button>
              <button onClick={() => setMode('use')}>This is the new device</button>
            </div>
            <h3>Recovery phrase</h3>
            <p>24 words that bring back your identity if you lose every device. Anyone with them can act as you.</p>
            <p className='muted'>They do not hold your files. After a restore, the owner of each file invites you back. Files only you own need another linked device to survive.</p>
            <div className='row'>
              <button onClick={async () => { try { setPhrase((await call('link:phrase')).phrase); setMode('phrase'); call('app:phraseNudged').catch(() => {}) } catch (err) { onError(err.message) } }}><Key size={16} /> Show phrase</button>
              <button onClick={() => setMode('restore')}><ArrowCounterClockwise size={16} /> Restore</button>
            </div>
            <p className='muted small'>If you lose a linked device, it still holds your identity. To cut it off, the owner of each sheet removes you and invites you again under a new identity.</p>
          </>
        )}

        {mode === 'show' && (
          <>
            <p>Open this link on your new device within 5 minutes. It gives that device your identity, so only use it on your own device.</p>
            <p className='muted'>Keep PearOffice open on this screen until the new device has joined. If you leave to send the link, come back here.</p>
            {link && (
              <div className='row'>
                <input readOnly value={link.link} aria-label='Device link' onFocus={(e) => e.target.select()} />
                <button className='primary' onClick={async () => { try { await navigator.clipboard.writeText(link.link); setCopied(true) } catch { if (window.pearoffice.platform === 'mobile') { await call('app:setClipboard', { text: link.link }); setCopied(true) } } }}>{copied ? 'Copied' : 'Copy'}</button>
              </div>
            )}
            {link && (
              <div className='pairing'>
                <QrCode value={link.link} label='Device link QR code' />
                <p className='muted small'>Or scan this with PearOffice on the new phone.</p>
              </div>
            )}
            {linked && <p className='ok'>Linked. Your sheets are opening on the new device.</p>}
          </>
        )}

        {mode === 'use' && (
          <form className='stack' onSubmit={(e) => { e.preventDefault(); restartAfter('link:join', { link: input.trim() }) }}>
            <p>Paste the link from your other device. This device must not have any sheets yet; it takes on your identity.</p>
            <input aria-label='Device link' placeholder='pearoffice://link?...' value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
            <ScanButton prefix='pearoffice://link?' what='a PearOffice device link' onError={onError} onLink={(l) => { setInput(l); restartAfter('link:join', { link: l }) }} />
            <div className='row end'>
              <button type='button' onClick={() => setMode('menu')}>Back</button>
              <button className='primary' type='submit' disabled={busy || !input.trim()}>{busy ? 'Linking...' : 'Link'}</button>
            </div>
          </form>
        )}

        {mode === 'phrase' && phrase && (
          <>
            <p className='warn'>Write these down and keep them somewhere safe. Anyone who has them can act as you in every file.</p>
            <ol className='phrase'>{phrase.split(' ').map((w, i) => <li key={i}>{w}</li>)}</ol>
            <div className='row end'><button onClick={() => { setPhrase(null); if (startWith === 'phrase') onClose(); else setMode('menu') }}>Done</button></div>
          </>
        )}

        {mode === 'restore' && (
          <form className='stack' onSubmit={(e) => { e.preventDefault(); restartAfter('app:restorePhrase', { phrase: input }) }}>
            <p>Type your 24 words. This works on a device with no sheets yet. Your sheets come back when you link from another device or are invited again.</p>
            <textarea aria-label='Recovery phrase' rows='4' value={input} onChange={(e) => setInput(e.target.value)} autoFocus />
            <div className='row end'>
              <button type='button' onClick={() => setMode('menu')}>Back</button>
              <button className='primary' type='submit' disabled={busy || input.trim().split(/\s+/).length !== 24}>{busy ? 'Restoring...' : 'Restore'}</button>
            </div>
          </form>
        )}
      </section>
    </div>
  )
}
