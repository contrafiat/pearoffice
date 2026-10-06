import React, { useEffect, useRef, useState } from 'react'
import { ArrowSquareOut, Camera, CaretLeft, Desktop, Devices, EnvelopeSimple, HardDrives, Moon, Sun, Trash, X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { Avatar, shrinkPicture } from './Avatar.jsx'
import { readPref, writePref } from './prefs.js'
import { themePref, setThemePref } from './theme.js'

/* global __APP_VERSION__ */
const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

// The main open-source parts of PearSheet and their licences.
const CREDITS = [
  ['Yjs', 'MIT', 'merging edits'],
  ['fast-formula-parser', 'MIT', 'formulas'],
  ['Formula.js', 'MIT', 'formula functions'],
  ['jStat', 'MIT', 'statistics functions'],
  ['stdlib', 'Apache-2.0', 'maths functions'],
  ['Chevrotain', 'Apache-2.0', 'formula parsing'],
  ['SheetJS Community Edition', 'Apache-2.0', '.xlsx files'],
  ['Hypercore, Autobase, Hyperbee, Corestore', 'MIT and Apache-2.0', 'storage and sync'],
  ['Hyperswarm and HyperDHT', 'MIT', 'finding other devices'],
  ['Blind Peer', 'Apache-2.0', 'the seeder'],
  ['Bare and BareKit', 'Apache-2.0', 'the sync engine runtime'],
  ['libsodium (sodium-universal)', 'ISC and MIT', 'encryption'],
  ['React', 'MIT', 'the interface'],
  ['Electron', 'MIT', 'the desktop app'],
  ['React Native and Expo', 'MIT', 'the phone app'],
  ['qrcode-generator', 'MIT', 'QR codes'],
  ['Manrope', 'OFL-1.1', 'the font'],
  ['Phosphor Icons', 'MIT', 'icons']
]

function openUrl (url) {
  call('app:openUrl', { url }).catch(() => {})
}

// One place for your profile and this device's settings, plus About.
export function SettingsPanel ({ me, onMe, desktop, keepOnline, startAtLogin, onSetting, onDevices, onSeeder, onClose, onError }) {
  const [mode, setMode] = useState('settings')
  const [numPad, setNumPad] = useState(() => readPref('pearsheet:numpad') === '1')
  const [theme, setTheme] = useState(themePref)
  const [showMe, setShowMe] = useState(() => readPref('pearsheet:presence') !== '0')
  const picRef = useRef(null)
  const { name, avatar, identity } = me
  const [nameDraft, setNameDraft] = useState(name || '')
  const [savingName, setSavingName] = useState(false)
  useEffect(() => { setNameDraft(name || '') }, [name])
  const nameChanged = nameDraft.trim() !== (name || '')
  async function saveName () {
    if (!nameChanged) return
    setSavingName(true)
    try { await call('app:setName', { name: nameDraft.trim() }); onMe() } catch (err) { onError(err.message) }
    setSavingName(false)
  }

  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel settings' role='dialog' aria-label={mode === 'about' ? 'About PearSheet' : 'Settings'}>
        <header>
          {mode === 'about' && <button className='link-button back' onClick={() => setMode('settings')}><CaretLeft size={14} /> Settings</button>}
          <h2>{mode === 'about' ? 'About PearSheet' : 'Settings'}</h2>
          <button className='close' aria-label='Close' onClick={onClose}><X size={18} /></button>
        </header>

        {mode === 'settings' && (
          <>
            <h3>You</h3>
            <div className='me'>
              {/* The picture, with change and remove beneath it. */}
              <div className='me-pic'>
                <button
                  className='me-picture'
                  title={avatar ? 'Change your picture' : 'Add a picture'}
                  aria-label={avatar ? 'Change your picture' : 'Add a picture'}
                  onClick={() => picRef.current && picRef.current.click()}
                >
                  <Avatar name={name} src={avatar ? 'data:' + avatar.mime + ';base64,' + avatar.data : null} seed={identity} size={56} />
                </button>
                <span className='pic-actions'>
                  <button className='pic-button' title={avatar ? 'Change picture' : 'Add a picture'} aria-label={avatar ? 'Change picture' : 'Add a picture'} onClick={() => picRef.current && picRef.current.click()}><Camera size={18} /></button>
                  {avatar && (
                    <button
                      className='pic-button remove-picture'
                      title='Remove picture'
                      aria-label='Remove picture'
                      onClick={async () => { try { await call('app:setAvatar', { data: '' }); onMe() } catch (err) { onError(err.message) } }}
                    ><Trash size={18} />
                    </button>
                  )}
                </span>
              </div>
              <input
                ref={picRef}
                type='file'
                accept='image/*'
                hidden
                onChange={async (e) => {
                  const file = e.target.files && e.target.files[0]
                  e.target.value = ''
                  if (!file) return
                  try {
                    await call('app:setAvatar', await shrinkPicture(file))
                    onMe()
                  } catch (err) { onError(err.message) }
                }}
              />
              {/* The name is saved with Save (or Enter), not on leaving the field. */}
              <form className='my-name' onSubmit={async (e) => { e.preventDefault(); await saveName() }}>
                <label htmlFor='my-name-input'>Your name</label>
                <span className='name-row'>
                  <input
                    id='my-name-input'
                    placeholder='Shown to people you share with'
                    value={nameDraft}
                    onChange={(e) => setNameDraft(e.target.value)}
                  />
                  <button type='submit' className='primary' disabled={!nameChanged || savingName}>{savingName ? 'Saving...' : 'Save'}</button>
                </span>
              </form>
            </div>
            <p className='small'>The people you share sheets with see your name and picture.</p>

            {desktop && keepOnline !== null && (
              <>
                <h3>This computer</h3>
                <label className='check keep-online'>
                  <input type='checkbox' checked={keepOnline} onChange={(e) => onSetting({ keepOnline: e.target.checked })} />
                  <span>Keep sheets online when closed<br /><span className='small muted'>Closing the window hides PearSheet in the tray, so people can sync with you while this computer is on.</span></span>
                </label>
                {keepOnline && (
                  <label className='check start-at-login'>
                    <input type='checkbox' checked={startAtLogin} onChange={(e) => onSetting({ startAtLogin: e.target.checked })} />
                    <span>Start when the computer starts<br /><span className='small muted'>Opens PearSheet hidden in the tray when you log in.</span></span>
                  </label>
                )}
              </>
            )}

            {!desktop && (
              <>
                <h3>Typing</h3>
                <label className='check num-pad'>
                  <input type='checkbox' checked={numPad} onChange={(e) => { setNumPad(e.target.checked); writePref('pearsheet:numpad', e.target.checked ? '1' : '0') }} />
                  <span>Number keypad for cells<br /><span className='small muted'>Also switches with the keypad button in the toolbar.</span></span>
                </label>
              </>
            )}

            <h3>Sharing</h3>
            <label className='check show-me'>
              <input type='checkbox' checked={showMe} onChange={(e) => { setShowMe(e.target.checked); writePref('pearsheet:presence', e.target.checked ? '1' : '0') }} />
              <span>Show others when I have a sheet open<br /><span className='small muted'>They see which cell you are on. When this is off, you do not see them either.</span></span>
            </label>

            <h3>Appearance</h3>
            <div className='row theme-choice' role='group' aria-label='Appearance'>
              {[['system', 'System', Desktop], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([v, label, Icon]) => (
                <button key={v} className={theme === v ? 'on' : ''} aria-pressed={theme === v} onClick={() => { setTheme(v); setThemePref(v) }}><Icon size={16} /> {label}</button>
              ))}
            </div>

            <h3>Devices</h3>
            <p className='small'>Use PearSheet on another device as the same person, and keep your recovery phrase.</p>
            <div className='row'><button className='settings-devices' onClick={onDevices}><Devices size={16} /> Devices and recovery phrase</button></div>

            <h3>Seeder</h3>
            <p className='small'>An always-on computer that keeps an encrypted copy of your sheets online. It cannot read them.</p>
            <div className='row'><button className='settings-seeder' onClick={onSeeder}><HardDrives size={16} /> Seeder</button></div>

            <div className='row about-row'>
              <button className='link-button about-link' onClick={() => setMode('about')}>About PearSheet{VERSION ? ' ' + VERSION : ''}</button>
            </div>
          </>
        )}

        {mode === 'about' && (
          <>
            <p className='about-lead'>Shared spreadsheets, device to device. No accounts and no servers.</p>
            <p className='small'>Version {VERSION || 'unknown'}</p>
            <h3>How it works</h3>
            <p>Your sheets live on your devices. When you share one, it syncs straight between the devices of the people in it, encrypted, with no company server in between. A seeder you run can keep a copy online while everyone is offline, and it cannot read it.</p>
            <div className='row'><button onClick={() => openUrl('https://pears.com/')}><ArrowSquareOut size={16} /> Learn about peer-to-peer</button></div>
            <h3>Contact</h3>
            <div className='row'><button onClick={() => openUrl('mailto:peerloomllc@proton.me?subject=%5BPearSheet%5D%20Feedback')}><EnvelopeSimple size={16} /> Email PeerLoom</button></div>
            <h3>Open-source software</h3>
            <p className='small'>PearSheet is built on these projects, used under their licences.</p>
            <ul className='credits'>
              {CREDITS.map(([what, licence, use]) => (
                <li key={what}><span>{what}</span><span className='muted'>{licence} · {use}</span></li>
              ))}
            </ul>
            <p className='small muted'>© PeerLoom LLC</p>
          </>
        )}
      </section>
    </div>
  )
}
