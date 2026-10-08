import React, { useEffect, useRef, useState } from 'react'
import { PearMark } from './PearMark.jsx'
import { ArrowCounterClockwise, ArrowLeft, ArrowRight, ArrowsClockwise, Camera, CaretRight, CircleNotch, Devices, GearSix, HardDrives, Key, LinkSimple, Plus, RocketLaunch, ShieldCheck } from '@phosphor-icons/react'
import { call } from './bridge.js'
import { Avatar, shrinkPicture } from './Avatar.jsx'
import { KINDS } from './Files.jsx'
import { PhraseInput } from './PhraseInput.jsx'
import { ScanButton } from './Qr.jsx'
import { CANCELLED, cancelLink, linkDevice, phraseWordCount, plainError, restorePhrase } from './takeIdentity.js'

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
    text: 'Your recovery phrase is 12 words that bring back your identity if you lose every device. With a seeder, it brings back your files too. Without one, the owners of your files invite you back, and files only you own survive if you link a second device.'
  }
]

// "I already use PearOffice": take this person's identity from another of
// their devices or from the recovery phrase. Both skip the name step, since
// the name comes with the identity.
const HAVE = [
  { id: 'link', Icon: Devices, title: 'Link to my other device', text: 'Use the same identity and files as your other device.' },
  { id: 'restore', Icon: ArrowCounterClockwise, title: 'Restore from my recovery phrase', text: 'Lost every device? Get your identity back, and your files if you had a seeder.' }
]

const START = { id: 'start', Icon: RocketLaunch, title: 'You are all set', text: 'Make a new file, bring one in from your computer or join one with a link you were sent.' }

export function Onboarding ({ tourOnly = false, hidden = false, me, onMe, onPhrase, onNew, onJoin, importButton, onDone, onError }) {
  // 'welcome', 'name', then 0..CARDS.length (the last is the start card).
  // From the welcome, 'have' leads to 'link' or 'restore'.
  const [step, setStep] = useState(tourOnly ? 0 : 'welcome')
  const [linkText, setLinkText] = useState('')
  const [phraseText, setPhraseText] = useState('')
  const [waiting, setWaiting] = useState(false) // linking, or restoring
  const [problem, setProblem] = useState(null)
  const [nameDraft, setNameDraft] = useState((me && me.name) || '')
  const [saving, setSaving] = useState(false)
  const picRef = useRef(null)
  const focusRef = useRef(null)
  const tour = typeof step === 'number'
  const card = tour ? (step < CARDS.length ? CARDS[step] : START) : null
  const last = CARDS.length

  // Each step puts the focus on its main button, so Enter moves on.
  useEffect(() => { if (!hidden && focusRef.current) focusRef.current.focus() }, [step, hidden])
  useEffect(() => setProblem(null), [step])

  // Onboarding counts as done before the restart, so the app opens straight
  // into the files (or, after a restore, the welcome back note).
  async function linkNow (link) {
    const text = String(link || '').trim()
    if (!text || waiting) return
    setProblem(null)
    setWaiting(true)
    try {
      await linkDevice(text, { before: () => call('app:onboarded') })
    } catch (err) {
      const msg = plainError(err)
      if (!msg.includes(CANCELLED)) setProblem(msg)
      setWaiting(false)
    }
  }

  async function restoreNow (e) {
    e.preventDefault()
    if (waiting) return
    const words = phraseWordCount(phraseText)
    if (words !== 12) { setProblem('A recovery phrase has 12 words. This has ' + words + '.'); return }
    setProblem(null)
    setWaiting(true)
    try {
      await restorePhrase(phraseText, { before: async () => { await call('app:onboarded'); await call('app:setWelcomeBack', { show: true }) } })
    } catch (err) {
      setProblem(plainError(err))
      setWaiting(false)
    }
  }

  function back (to) {
    if (waiting) return
    setStep(to)
  }

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
  const have = HAVE.find((h) => h.id === step)
  const label = step === 'welcome' ? 'Welcome to PearOffice' : step === 'name' ? 'Your name' : step === 'have' ? 'I already use PearOffice' : have ? have.title : card.title
  const words = phraseWordCount(phraseText)

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
            <PearMark size={58} className='ob-pear-mark' />
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
          <div className='ob-foot one ob-welcome-foot'>
            <button ref={focusRef} className='primary ob-start' onClick={() => setStep('name')}>Get started <ArrowRight size={16} aria-hidden='true' /></button>
            <button className='link-button ob-have' onClick={() => setStep('have')}>I already use PearOffice</button>
          </div>
        )}

        {step === 'have' && (
          <div className='ob-body'>
            <span className='ob-icon' aria-hidden='true'><Devices size={40} weight='duotone' /></span>
            <h2 className='ob-title'>Welcome back</h2>
            <p>Use PearOffice here as the same person you are on your other devices.</p>
            <div className='ob-choices'>
              {HAVE.map((h, i) => (
                <button key={h.id} ref={i === 0 ? focusRef : null} className={'ob-choice ob-choice-' + h.id} onClick={() => setStep(h.id)}>
                  <span className='ob-choice-icon' aria-hidden='true'><h.Icon size={24} weight='duotone' /></span>
                  <span className='ob-choice-text'><b>{h.title}</b><span>{h.text}</span></span>
                  <CaretRight className='ob-choice-go' size={16} aria-hidden='true' />
                </button>
              ))}
            </div>
          </div>
        )}
        {step === 'have' && (
          <div className='ob-foot one'>
            <button className='ob-back' onClick={() => back('welcome')}><ArrowLeft size={16} aria-hidden='true' /> Back</button>
          </div>
        )}

        {step === 'link' && !waiting && (
          <form className='ob-name-form ob-link-form' onSubmit={(e) => { e.preventDefault(); linkNow(linkText) }}>
            <div className='ob-body'>
              <span className='ob-icon' aria-hidden='true'><Devices size={40} weight='duotone' /></span>
              <h2 className='ob-title'>Link to my other device</h2>
              <p>On your other device, open Settings, then Devices, then Link a new device. Keep PearOffice open on that screen.</p>
              <p>Then paste the link it shows here.</p>
              <input
                ref={focusRef}
                className='ob-name ob-link'
                aria-label='Device link'
                placeholder='pearoffice://link?...'
                autoComplete='off'
                spellCheck={false}
                value={linkText}
                onChange={(e) => setLinkText(e.target.value)}
              />
              <ScanButton prefix='pearoffice://link?' what='a PearOffice device link' onError={setProblem} onLink={(l) => { setLinkText(l); linkNow(l) }} />
              {problem && <p className='ob-error' role='alert'>{problem}</p>}
            </div>
            <div className='ob-foot'>
              <button type='button' className='ob-back' onClick={() => back('have')}><ArrowLeft size={16} aria-hidden='true' /> Back</button>
              <button type='submit' className='primary ob-next' disabled={!linkText.trim()}>Link</button>
            </div>
          </form>
        )}
        {step === 'link' && waiting && (
          <div className='ob-body ob-waiting' role='status'>
            <CircleNotch className='join-spinner' size={44} aria-hidden='true' />
            <h2 className='ob-title'>Looking for your other device...</h2>
            <p>This can take up to 2 minutes. Keep PearOffice open on your other device.</p>
          </div>
        )}
        {step === 'link' && waiting && (
          <div className='ob-foot one'>
            <button className='ob-cancel' onClick={() => cancelLink()}>Cancel</button>
          </div>
        )}

        {step === 'restore' && (
          <form className='ob-name-form ob-restore-form' onSubmit={restoreNow}>
            <div className='ob-body'>
              <span className='ob-icon' aria-hidden='true'><Key size={40} weight='duotone' /></span>
              <h2 className='ob-title'>Restore from my recovery phrase</h2>
              <p>Type your 12 words in order. This brings back your identity, and your files if you had a seeder.</p>
              <PhraseInput
                inputRef={focusRef}
                className='ob-phrase'
                oneAtATime={!!(window.pearoffice && window.pearoffice.platform === 'mobile')}
                disabled={waiting}
                value={phraseText}
                onChange={setPhraseText}
              />
              <p className='ob-count'>{words === 1 ? '1 word' : words + ' words'} of 12</p>
              {problem && <p className='ob-error' role='alert'>{problem}</p>}
            </div>
            <div className='ob-foot'>
              <button type='button' className='ob-back' disabled={waiting} onClick={() => back('have')}><ArrowLeft size={16} aria-hidden='true' /> Back</button>
              <button type='submit' className='primary ob-next' disabled={waiting || words === 0}>{waiting ? 'Restoring...' : 'Restore'}</button>
            </div>
          </form>
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
