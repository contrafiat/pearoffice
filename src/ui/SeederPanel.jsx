import React, { useEffect, useState } from 'react'
import { CaretLeft, X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { toSvg } from '../shared/qr.js'
import { ScanButton } from './Qr.jsx'

// "Run a seeder on this computer" (desktop): a separate blind process the
// desktop app starts and stops. Shows its pairing QR and what it holds.
function LocalSeeder ({ onPaired, onError }) {
  const [settings, setSettings] = useState(null)
  const [host, setHost] = useState(null)
  const [pairing, setPairing] = useState(null)
  const [busy, setBusy] = useState(false)

  async function refresh () {
    try {
      setSettings(await call('app:settings'))
      setHost(await call('app:seederHost'))
    } catch (err) { onError(err.message) }
  }
  useEffect(() => { refresh(); const t = setInterval(refresh, 3000); return () => clearInterval(t) }, [])

  if (!settings) return null
  return (
    <>
      <h3>This computer as a seeder</h3>
      <label className='keep-online inline'>
        <input
          type='checkbox'
          checked={settings.runSeeder}
          onChange={async (e) => { setPairing(null); await call('app:setSetting', { runSeeder: e.target.checked }); refresh() }}
        />
        Run a seeder on this computer
      </label>
      {settings.runSeeder && host && !host.running && <p className='muted'>Starting the seeder...</p>}
      {host && host.running && (
        <>
          <p className='muted small'>Holding {host.sheets} sheet{host.sheets === 1 ? '' : 's'} for {host.pairedDevices} paired device{host.pairedDevices === 1 ? '' : 's'}. It runs in the background while PearSheet is open or in the tray.</p>
          <div className='row'>
            <button type='button' onClick={async () => { try { setPairing(await call('app:seederHostPair')) } catch (err) { onError(err.message) } }}>Show pairing code</button>
            <button
              type='button'
              disabled={busy}
              onClick={async () => {
                setBusy(true)
                try {
                  const p = await call('app:seederHostPair')
                  await call('seeder:pair', { link: p.link })
                  onPaired()
                  refresh()
                } catch (err) { onError(err.message) }
                setBusy(false)
              }}
            >
              {busy ? 'Pairing...' : 'Pair this device with it'}
            </button>
          </div>
          <HostDevices onError={onError} />
          {pairing && (
            <div className='pairing'>
              <div className='qr' dangerouslySetInnerHTML={{ __html: toSvg(pairing.link, 200) }} />
              <p className='muted small'>Scan on a phone, or paste this link in another device's Seeder panel. Works for 5 minutes.</p>
              <input readOnly value={pairing.link} onFocus={(e) => e.target.select()} aria-label='Seeder pairing link' />
            </div>
          )}
        </>
      )}
    </>
  )
}

// Devices paired with the seeder on this computer, each with Forget.
function HostDevices ({ onError }) {
  const [devices, setDevices] = useState(null)
  const [confirming, setConfirming] = useState(null)
  async function load () {
    try { setDevices(await call('app:seederHostDevices')) } catch (err) { onError(err.message) }
  }
  useEffect(() => { load() }, [])
  if (!devices || !devices.length) return null
  return (
    <ul className='people host-devices'>
      {devices.map((d) => (
        <li key={d.deviceKey}>
          <span className='who'><span className='mono'>{d.deviceKey.slice(0, 12)}...</span> <span className='muted'>{d.sheets} sheet{d.sheets === 1 ? '' : 's'}</span></span>
          {confirming === d.deviceKey
            ? (
              <span className='confirm'>
                <button
                  type='button'
                  className='danger'
                  onClick={async () => {
                    try { await call('app:seederHostForget', { deviceKey: d.deviceKey }) } catch (err) { onError(err.message) }
                    setConfirming(null)
                    load()
                  }}
                >
                  Forget
                </button>
                <button type='button' onClick={() => setConfirming(null)}>Keep</button>
              </span>
              )
            : <button type='button' className='link-button' onClick={() => setConfirming(d.deviceKey)}>Forget</button>}
        </li>
      ))}
      {confirming && <li className='muted small'>The seeder stops accepting that device. Sheets no other paired device backs up are deleted from it after 7 days.</li>}
    </ul>
  )
}

// "Stop using this seeder" on this device, with what it will change.
function StopUsing ({ seederKey, onDone, onError }) {
  const [preview, setPreview] = useState(null)
  const [busy, setBusy] = useState(false)
  if (!preview) {
    return (
      <button type='button' className='link-button' onClick={async () => { try { setPreview(await call('seeder:stopPreview', { seederKey })) } catch (err) { onError(err.message) } }}>
        Stop using
      </button>
    )
  }
  const names = (list) => list.map((x) => x.title || 'Untitled sheet').join(', ')
  return (
    <div className='stop-using'>
      {preview.stop.length > 0 && <p className='small'>Stops backing up: {names(preview.stop)}. The seeder deletes its copies after 7 days.</p>}
      {preview.keep.length > 0 && <p className='small muted'>Still backed up there by other people: {names(preview.keep)}.</p>}
      {!preview.stop.length && !preview.keep.length && <p className='small muted'>No sheets back up to it.</p>}
      <div className='row'>
        <button
          type='button'
          className='danger'
          disabled={busy}
          onClick={async () => {
            setBusy(true)
            try { await call('seeder:stopUsing', { seederKey }); onDone() } catch (err) { onError(err.message); setBusy(false) }
          }}
        >
          {busy ? 'Stopping...' : 'Stop using this seeder'}
        </button>
        <button type='button' onClick={() => setPreview(null)}>Keep</button>
      </div>
    </div>
  )
}

export function SeederPanel ({ initialLink = '', onBack = null, onClose, onError }) {
  const [link, setLink] = useState(initialLink)
  const [busy, setBusy] = useState(false)
  const [seeders, setSeeders] = useState(null)
  const [done, setDone] = useState(false)

  async function load () {
    try { setSeeders(await call('seeder:list')) } catch (err) { onError(err.message) }
  }
  useEffect(() => { load() }, [])

  async function pair (e, scanned) {
    if (e) e.preventDefault()
    setBusy(true)
    setDone(false)
    try {
      await call('seeder:pair', { link: (scanned || link).trim() })
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
          {onBack && <button type='button' className='link-button back' onClick={onBack}><CaretLeft size={14} /> Settings</button>}
          <h2>Seeder</h2>
          <button type='button' className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
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
        <ScanButton prefix='pearsheet://seeder?' what='a PearSheet seeder code' onError={onError} onLink={(l) => { setLink(l); pair(null, l) }} />
        <div className='row end'>
          {done && <span className='muted'>Paired. Your sheets are backing up.</span>}
          <button className='primary' type='submit' disabled={busy || !link.trim()}>{busy ? 'Pairing...' : 'Pair'}</button>
        </div>
        {window.pearsheet && window.pearsheet.platform === 'desktop' && <LocalSeeder onPaired={() => { setDone(true); load() }} onError={onError} />}
        <h3>Paired seeders</h3>
        {seeders && seeders.length === 0 && <p className='muted'>None yet.</p>}
        <ul className='people'>
          {(seeders || []).map((s) => (
            <li key={s.seederKey} className='seeder-row'>
              <span className='who mono'>{s.seederKey.slice(0, 16)}...</span>
              <StopUsing seederKey={s.seederKey} onDone={load} onError={onError} />
            </li>
          ))}
        </ul>
      </form>
    </div>
  )
}
