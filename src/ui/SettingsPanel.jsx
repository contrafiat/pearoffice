import React, { useEffect, useRef, useState } from 'react'
import { Camera, CaretLeft, Compass, Desktop, Devices, HardDrives, Moon, Sun, Trash, X } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { Avatar, shrinkPicture } from './Avatar.jsx'
import { readPref, writePref } from './prefs.js'
import { themePref, setThemePref } from './theme.js'

import { AboutContent, BitcoinContent } from './About.jsx'

const TITLES = { settings: 'Settings', about: 'About PearOffice', bitcoin: 'Bitcoin Lightning' }

// One place for your profile and this device's settings, plus About.
export function SettingsPanel ({ me, onMe, desktop, keepOnline, startAtLogin, onSetting, onDevices, onSeeder, onTour, onClose, onError, startIn = null }) {
  const [mode, setMode] = useState(startIn ? startIn.mode : 'settings') // settings | about | bitcoin
  const [wallet, setWallet] = useState(false) // a Lightning wallet is installed
  const [numPad, setNumPad] = useState(() => readPref('pearoffice:numpad') === '1')
  const [theme, setTheme] = useState(themePref)
  const [showMe, setShowMe] = useState(() => readPref('pearoffice:presence') !== '0')
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
      <section className='panel settings' role='dialog' aria-label={TITLES[mode]}>
        <header>
          {mode === 'about' && <button className='link-button back' onClick={() => setMode('settings')}><CaretLeft size={14} /> Settings</button>}
          {mode === 'bitcoin' && <button className='link-button back' onClick={() => setMode('about')}><CaretLeft size={14} /> About</button>}
          <h2>{TITLES[mode]}</h2>
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
                  <span>Keep sheets online when closed<br /><span className='small muted'>Closing the window hides PearOffice in the tray, so people can sync with you while this computer is on.</span></span>
                </label>
                {keepOnline && (
                  <label className='check start-at-login'>
                    <input type='checkbox' checked={startAtLogin} onChange={(e) => onSetting({ startAtLogin: e.target.checked })} />
                    <span>Start when the computer starts<br /><span className='small muted'>Opens PearOffice hidden in the tray when you log in.</span></span>
                  </label>
                )}
              </>
            )}

            {!desktop && (
              <>
                <h3>Typing</h3>
                <label className='check num-pad'>
                  <input type='checkbox' checked={numPad} onChange={(e) => { setNumPad(e.target.checked); writePref('pearoffice:numpad', e.target.checked ? '1' : '0') }} />
                  <span>Number keypad for cells<br /><span className='small muted'>Also switches with the keypad button in the toolbar.</span></span>
                </label>
              </>
            )}

            <h3>Sharing</h3>
            <label className='check show-me'>
              <input type='checkbox' checked={showMe} onChange={(e) => { setShowMe(e.target.checked); writePref('pearoffice:presence', e.target.checked ? '1' : '0') }} />
              <span>Show others when I have a sheet open<br /><span className='small muted'>They see which cell you are on. When this is off, you do not see them either.</span></span>
            </label>

            <h3>Appearance</h3>
            <div className='row theme-choice' role='group' aria-label='Appearance'>
              {[['system', 'System', Desktop], ['light', 'Light', Sun], ['dark', 'Dark', Moon]].map(([v, label, Icon]) => (
                <button key={v} className={theme === v ? 'on' : ''} aria-pressed={theme === v} onClick={() => { setTheme(v); setThemePref(v) }}><Icon size={16} /> {label}</button>
              ))}
            </div>

            <h3>Devices</h3>
            <p className='small'>Use PearOffice on another device as the same person, and keep your recovery phrase.</p>
            <div className='row'><button className='settings-devices' onClick={onDevices}><Devices size={16} /> Devices and recovery phrase</button></div>

            <h3>Seeder</h3>
            <p className='small'>An always-on computer that keeps an encrypted copy of your sheets online. It cannot read them.</p>
            <div className='row'><button className='settings-seeder' onClick={onSeeder}><HardDrives size={16} /> Seeder</button></div>

            <h3>Help</h3>
            <p className='small'>A short tour of how PearOffice works and what is different from cloud apps.</p>
            <div className='row'><button className='settings-tour' onClick={onTour}><Compass size={16} /> Take the tour</button></div>


          </>
        )}

        {mode === 'about' && <AboutContent startSection={startIn && startIn.section} onTour={onTour} onBitcoin={(detected) => { setWallet(detected); setMode('bitcoin') }} />}
        {mode === 'bitcoin' && <BitcoinContent detected={wallet} />}
      </section>
    </div>
  )
}
