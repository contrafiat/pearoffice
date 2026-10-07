import React, { useEffect, useRef, useState } from 'react'
import { ArrowLeft, ArrowRight, ArrowsClockwise, Camera, Devices, GearSix, HardDrives, Key, LinkSimple, Plus, RocketLaunch, ShieldCheck } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { Avatar, shrinkPicture } from './Avatar.jsx'
import { KINDS } from './Files.jsx'

// The first-run welcome, your name and a short tour of what is different
// from cloud office apps. Shown once per device (app:onboarding), and the
// tour cards again from Settings or About (tourOnly).

// How long an invite link works (src/worklet/fileMethods.js, INVITE_HOURS).
const INVITE_HOURS = 24

const ROLES = [
  ['Owner', 'Made the file and invites people.'],
  ['Editor', 'Can make changes.'],
  ['Viewer', 'Can read but not change.']
]

export const CARDS = [
  {
    id: 'account',
    Icon: ShieldCheck,
    title: 'No account needed',
    text: 'There is nothing to sign up for. Your files live on your own devices, not on a server, and nobody else can read them, including us.'
  },
  {
    id: 'sharing',
    Icon: LinkSimple,
    title: 'Share with a link',
    text: 'To invite someone, send them a link. Each link works once and expires after ' + INVITE_HOURS + ' hours.',
    extra: () => (
      <ul className='ob-roles'>
        {ROLES.map(([role, what]) => <li key={role}><b>{role}</b><span>{what}</span></li>)}
      </ul>
    )
  },
  {
    id: 'sync',
    Icon: ArrowsClockwise,
    title: 'Changes go device to device',
    text: 'There is no cloud in between. Your changes reach the others when someone else in the file is online at the same time as you, or through a seeder.'
  },
  {
    id: 'seeder',
    Icon: HardDrives,
    title: 'Seeders keep files moving',
    text: 'A seeder is a device that stays on. It keeps an encrypted backup of your files and passes changes on while you are offline. It cannot read them.',
    hint: 'Run one on a computer or a home server such as Umbrel. Set it up in Settings, under Seeder.'
  },
  {
    id: 'devices',
    Icon: Devices,
    title: 'Use all your devices',
    text: 'Link your phone and your computer so they share the same files, as the same person.',
    hint: 'Link them in Settings, under Devices.'
  },
  {
    id: 'phrase',
    Icon: Key,
    title: 'Keep your recovery phrase',
    text: 'Your recovery phrase is 24 words. If you lose every device, it is the only way back in. There is no password reset, so write it down and keep it safe.'
  }
]

const START = { id: 'start', Icon: RocketLaunch, title: 'You are all set', text: 'Make a new file, bring one in from your computer or join one with a link you were sent.' }

export function Onboarding ({ tourOnly = false, hidden = false, me, onMe, onPhrase, onNew, onJoin, importButton, onDone, onError }) {
  // 'welcome', 'name', then 0..CARDS.length (the last is the start card).
  const [step, setStep] = useState(tourOnly ? 0 : 'welcome')
  const [nameDraft, setNameDraft] = useState((me && me.name) || '')
  const [saving, setSaving] = useState(false)
  const picRef = useRef(null)
  const focusRef = useRef(null)
  const tour = typeof step === 'number'
  const card = tour ? (step < CARDS.length ? CARDS[step] : START) : null
  const last = CARDS.length

  // Each step puts the focus on its main button, so Enter moves on.
  useEffect(() => { if (!hidden && focusRef.current) focusRef.current.focus() }, [step, hidden])

  function finish () {
    call('app:onboarded').catch(() => {})
    onDone()
  }

  useEffect(() => {
    if (!tour || hidden) return
    function onKey (e) {
      if (e.target && /^(INPUT|TEXTAREA)$/.test(e.target.tagName)) return
      if (e.key === 'Escape') { e.preventDefault(); finish() } else if (e.key === 'ArrowRight' && step < last) setStep(step + 1)
      else if (e.key === 'ArrowLeft' && step > 0) setStep(step - 1)
    }
    window.addEventListener('keydown', onKey)
    return () => window.removeEventListener('keydown', onKey)
  }, [tour, step, hidden])

  async function saveName (e) {
    e.preventDefault()
    const name = nameDraft.trim()
    if (name && name !== ((me && me.name) || '')) {
      setSaving(true)
      try { await call('app:setName', { name }); onMe() } catch (err) { onError(err.message) }
      setSaving(false)
    }
    setStep(0)
  }

  const avatar = me && me.avatar
  const label = step === 'welcome' ? 'Welcome to PearOffice' : step === 'name' ? 'Your name' : card.title

  return (
    <div className={'ob-backdrop' + (hidden ? ' hidden' : '')}>
      <section className={'ob-card ob-step-' + (tour ? card.id : step)} role='dialog' aria-modal='true' aria-label={label}>
        {tour && (
          <div className='ob-top'>
            <ol className='ob-dots' aria-label={'Step ' + (step + 1) + ' of ' + (last + 1)}>
              {[...CARDS, START].map((c, i) => <li key={c.id} className={i === step ? 'on' : i < step ? 'done' : ''} />)}
            </ol>
            {step < last && <button className='link-button ob-skip' onClick={finish}>Skip</button>}
          </div>
        )}

        {step === 'welcome' && (
          <div className='ob-body'>
            <span className='ob-pear' aria-hidden='true' />
            <h2 className='ob-title'>Welcome to PearOffice</h2>
            <p>Spreadsheets, documents and slides that you share straight from your devices. No account and no servers.</p>
            <ul className='ob-kinds' aria-label='What you can make'>
              {KINDS.map(({ kind, label, Icon }) => (
                <li key={kind}><span className={'kind-icon kind-' + kind}><Icon size={30} weight='duotone' aria-hidden='true' /></span>{label}</li>
              ))}
            </ul>
          </div>
        )}
        {step === 'welcome' && (
          <div className='ob-foot one'>
            <button ref={focusRef} className='primary ob-start' onClick={() => setStep('name')}>Get started <ArrowRight size={16} aria-hidden='true' /></button>
          </div>
        )}

        {step === 'name' && (
          <form className='ob-name-form' onSubmit={saveName}>
            <div className='ob-body'>
              <button
                type='button'
                className='ob-picture'
                title={avatar ? 'Change your picture' : 'Add a picture'}
                aria-label={avatar ? 'Change your picture' : 'Add a picture'}
                onClick={() => picRef.current && picRef.current.click()}
              >
                <Avatar name={nameDraft || (me && me.name)} src={avatar ? 'data:' + avatar.mime + ';base64,' + avatar.data : null} seed={me && me.identity} size={84} />
                <span className='ob-camera' aria-hidden='true'><Camera size={16} weight='bold' /></span>
              </button>
              <input
                ref={picRef}
                type='file'
                accept='image/*'
                hidden
                onChange={async (e) => {
                  const file = e.target.files && e.target.files[0]
                  e.target.value = ''
                  if (!file) return
                  try { await call('app:setAvatar', await shrinkPicture(file)); onMe() } catch (err) { onError(err.message) }
                }}
              />
              <h2 className='ob-title'>What should we call you?</h2>
              <p>Your name shows next to your edits, so others know who is editing. A picture is up to you.</p>
              <input
                ref={focusRef}
                className='ob-name'
                aria-label='Your name'
                placeholder='Your name'
                autoComplete='name'
                maxLength={60}
                value={nameDraft}
                onChange={(e) => setNameDraft(e.target.value)}
              />
            </div>
            <div className='ob-foot'>
              <button type='button' className='ob-later' onClick={() => setStep(0)}>Skip for now</button>
              <button type='submit' className='primary ob-next' disabled={saving || !nameDraft.trim()}>{saving ? 'Saving...' : 'Continue'}</button>
            </div>
          </form>
        )}

        {tour && (
          <div className='ob-body' key={card.id}>
            <span className='ob-icon' aria-hidden='true'><card.Icon size={40} weight='duotone' /></span>
            <h2 className='ob-title'>{card.title}</h2>
            <p>{card.text}</p>
            {card.extra && card.extra()}
            {card.hint && <p className='ob-hint'><GearSix size={16} aria-hidden='true' /><span>{card.hint}</span></p>}
            {card.id === 'phrase' && (
              <button className='ob-show-phrase' onClick={() => { setStep(last); onPhrase() }}><Key size={16} aria-hidden='true' /> Show my phrase</button>
            )}
            {card.id === 'start' && (
              <div className='ob-actions'>
                <button ref={focusRef} className='primary ob-new' onClick={() => { finish(); onNew() }}><Plus size={18} aria-hidden='true' /> New file</button>
                {importButton(finish)}
                <button className='ob-join' onClick={() => { finish(); onJoin() }}><LinkSimple size={18} aria-hidden='true' /> Join with a link</button>
              </div>
            )}
          </div>
        )}
        {tour && (
          <div className='ob-foot'>
            <button className='ob-back' disabled={step === 0 && tourOnly} onClick={() => setStep(step > 0 ? step - 1 : 'name')}><ArrowLeft size={16} aria-hidden='true' /> Back</button>
            {step < last
              ? <button ref={card.id === 'start' ? null : focusRef} className={'ob-next' + (card.id === 'phrase' ? '' : ' primary')} onClick={() => setStep(step + 1)}>{card.id === 'phrase' ? 'Later' : 'Next'}{card.id === 'phrase' ? null : <ArrowRight size={16} aria-hidden='true' />}</button>
              : <button className='ob-done' onClick={finish}>Done</button>}
          </div>
        )}
      </section>
    </div>
  )
}
