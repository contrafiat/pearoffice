import React, { useState } from 'react'
import { ArrowSquareOut, CaretDown, CheckCircle, Compass, EnvelopeSimple, Lightning, ShareNetwork, Scroll } from '@phosphor-icons/react'
import { call } from './bridge.js'

/* global __APP_VERSION__ */
export const VERSION = typeof __APP_VERSION__ === 'string' ? __APP_VERSION__ : ''

// Suite donation config, the same in every PeerLoom app (PearList's
// src/ui/App.jsx).
const LIGHTNING_ADDRESS = 'peerloomllc@strike.me'
const STRIKE_TIP_URL = 'https://strike.me/peerloomllc/'
const BTC_ONCHAIN_ADDRESS = 'bc1q0kksenz3j4u9ppe6f4krclvzwxk7sjy00cc9cf'
const BUYMEACOFFEE_URL = 'https://buymeacoffee.com/peerloomllc'
const LIGHTNING_WALLETS = [
  { name: 'Strike', url: 'https://strike.me', desc: 'Simple Lightning payments' },
  { name: 'Cash App', url: 'https://cash.app', desc: 'Send Bitcoin via Lightning' },
  { name: 'Wallet of Satoshi', url: 'https://walletofsatoshi.com', desc: 'Beginner-friendly Lightning wallet' },
  { name: 'Phoenix', url: 'https://phoenix.acinq.co', desc: 'Self-custodial Lightning wallet' }
]
const SHARE_TEXT = 'Check out PearOffice - private, peer-to-peer spreadsheets, documents and slides with no servers or accounts.\n\nhttps://peerloomllc.com/'

// The main open-source parts of PearOffice and their licences.
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

export function openUrl (url) {
  call('app:openUrl', { url }).catch(() => {})
}

const mobile = () => !!(window.pearoffice && window.pearoffice.platform === 'mobile')

function Section ({ id, title, open, onToggle, children }) {
  return (
    <div className={'about-section' + (open ? ' open' : '')}>
      <button className='about-toggle' aria-expanded={open} onClick={() => onToggle(id)}>
        <span>{title}</span><CaretDown size={14} aria-hidden='true' />
      </button>
      {open && <div className='about-body'>{children}</div>}
    </div>
  )
}

function CopyButton ({ text, label, done = 'Copied' }) {
  const [copied, setCopied] = useState(false)
  async function copy () {
    try {
      await call('app:setClipboard', { text })
      setCopied(true)
      setTimeout(() => setCopied(false), 1600)
    } catch {}
  }
  return <button onClick={copy}>{copied ? <><CheckCircle size={16} weight='fill' /> {done}</> : label}</button>
}

// About, one section open at a time, as in the other PeerLoom apps.
export function AboutContent ({ startSection = null, onBitcoin, onTour }) {
  const [open, setOpen] = useState(startSection)
  const toggle = (id) => setOpen((s) => (s === id ? null : id))
  // Every licence text, from the app's own copy (app:licenses).
  const [licences, setLicences] = useState(null)
  const showLicences = () => call('app:licenses').then((r) => setLicences((r && r.text) || 'The full licence list comes with the installed app.'), (err) => setLicences(err.message))

  async function bitcoin () {
    let detected = false
    if (mobile()) {
      try { detected = !!(await call('app:canOpenUrl', { url: 'lightning:test' })).can } catch {}
    }
    onBitcoin(detected)
  }

  return (
    <>
      <div className='about-head'>
        <p className='about-lead'>Private. Peer-to-peer. No servers.</p>
        <p className='small'>Version {VERSION || 'unknown'}</p>
      </div>
      <Section id='how' title='How it works' open={open === 'how'} onToggle={toggle}>
        <p>Your files live on your devices. When you share one, it syncs straight between the devices of the people in it, encrypted, with no company server in between. A seeder you run can keep a copy online while everyone is offline, and it cannot read it. No accounts, no subscriptions and no data collection.</p>
        <div className='row equal'>
          {onTour && <button className='about-tour' onClick={onTour}><Compass size={16} /> Take the tour</button>}
          <button onClick={() => openUrl('https://pears.com/')}><ArrowSquareOut size={16} /> Learn more</button>
        </div>
      </Section>
      <Section id='support' title='Support development' open={open === 'support'} onToggle={toggle}>
        <p>PearOffice is free, with no ads, accounts or subscriptions. If you get value from it, please consider returning value.</p>
        <div className='row equal'>
          <button className='primary donate-btc' onClick={bitcoin}><Lightning size={16} weight='fill' /> BTC</button>
          <button className='donate-usd' onClick={() => openUrl(BUYMEACOFFEE_URL)}>$ USD</button>
        </div>
      </Section>
      <Section id='bitcoin' title='Learn about Bitcoin' open={open === 'bitcoin'} onToggle={toggle}>
        <p>New to Bitcoin? The Satoshi Nakamoto Institute has a free, short crash course on how Bitcoin works and why it matters.</p>
        <div className='row center'><button onClick={() => openUrl('https://nakamotoinstitute.org/crash-course/')}><ArrowSquareOut size={16} /> Bitcoin crash course</button></div>
      </Section>
      <Section id='share' title='Share the app' open={open === 'share'} onToggle={toggle}>
        <p>Know someone who would want private spreadsheets, documents and slides they can share without a server? Tell them about PearOffice.</p>
        <div className='row center'>
          {mobile()
            ? <button onClick={() => call('app:share', { text: SHARE_TEXT }).catch(() => {})}><ShareNetwork size={16} /> Share PearOffice</button>
            : <CopyButton text={SHARE_TEXT} label={<><ShareNetwork size={16} /> Copy a message to share</>} />}
        </div>
      </Section>
      <Section id='contact' title='Contact' open={open === 'contact'} onToggle={toggle}>
        <p>Questions, ideas or something not working? Write to us.</p>
        <div className='row center'><button onClick={() => openUrl('mailto:peerloomllc@proton.me?subject=%5BPearOffice%5D%20Feedback')}><EnvelopeSimple size={16} /> Email PeerLoom</button></div>
      </Section>
      <Section id='credits' title='Open-source software' open={open === 'credits'} onToggle={toggle}>
        <p className='small'>PearOffice is built on these projects, used under their licences.</p>
        <ul className='credits'>
          {CREDITS.map(([what, licence, use]) => (
            <li key={what}><span>{what}</span><span className='muted'>{licence} · {use}</span></li>
          ))}
        </ul>
        {licences === null
          ? <div className='row center'><button className='about-licences' onClick={showLicences}><Scroll size={16} /> All licence texts</button></div>
          : <pre className='licence-text'>{licences}</pre>}
      </Section>
      <p className='small muted about-foot'>© PeerLoom LLC</p>
    </>
  )
}

// The Bitcoin donation sheet: hand off to a Lightning wallet when one is
// installed, otherwise the address to copy, a page with a QR code and
// wallets to try.
export function BitcoinContent ({ detected }) {
  return (
    <div className='bitcoin'>
      <p className='center-text'>Support PearOffice with Bitcoin over Lightning (fast and low-fee) or on-chain.</p>
      {detected && (
        <>
          <button className='primary wide' onClick={() => openUrl('lightning:' + LIGHTNING_ADDRESS)}><Lightning size={16} weight='fill' /> Open in your Lightning wallet</button>
          <p className='center-text'>Or use another method:</p>
        </>
      )}
      <h3>Lightning address</h3>
      <div className='copy-field'><code>{LIGHTNING_ADDRESS}</code><CopyButton text={LIGHTNING_ADDRESS} label='Copy' /></div>
      <p className='small center-text'>Paste it into any Lightning, ecash or web wallet.</p>
      <button className='primary wide' onClick={() => openUrl(STRIKE_TIP_URL)}><Lightning size={16} weight='fill' /> Show a QR code or pay in a browser</button>
      <p className='small center-text'>Scan it from another device.</p>
      <h3>On-chain Bitcoin</h3>
      <div className='copy-field'><code>{BTC_ONCHAIN_ADDRESS}</code><CopyButton text={BTC_ONCHAIN_ADDRESS} label='Copy' /></div>
      <p className='small center-text'>Fees are higher on-chain, so Lightning is cheaper for small amounts.</p>
      {!detected && (
        <>
          <h3>No Lightning wallet yet?</h3>
          <div className='wallets'>
            {LIGHTNING_WALLETS.map((w) => (
              <button key={w.name} className='wallet' onClick={() => openUrl(w.url)}>
                <span><strong>{w.name}</strong><span className='small muted'>{w.desc}</span></span>
                <ArrowSquareOut size={14} aria-hidden='true' />
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  )
}

// The two-week nudge, shown once.
export function DonationReminder ({ onDonate, onClose }) {
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) onClose() }}>
      <section className='panel donate-reminder' role='dialog' aria-label='Enjoying PearOffice?'>
        <header><h2>Enjoying PearOffice?</h2></header>
        <p className='center-text'>PearOffice is free, with no ads, accounts or subscriptions. If you get value from it, please consider returning value to support development.</p>
        <div className='row equal'>
          <button onClick={onClose}>Maybe later</button>
          <button className='primary' onClick={onDonate}>Donate</button>
        </div>
        <button className='link-button already' onClick={onClose}>I already donated</button>
      </section>
    </div>
  )
}
