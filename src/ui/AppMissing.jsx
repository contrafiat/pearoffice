// "PearCal isn't installed on this device", when a pearcal:// link could not
// open (/home/tim/peerloomllc/proposals/2026-10-26-pearcal-pearoffice-links.md).
// openOutside (pearLinks.js) raises it with a window event, so every editor
// and window shows it the same way.

import React, { useEffect, useState } from 'react'
import { X } from '@phosphor-icons/react'
import { call } from './bridge.js'

export const APP_MISSING = 'pearoffice:appMissing'

export function AppMissing () {
  const [missing, setMissing] = useState(null) // { text, page }
  useEffect(() => {
    const show = (e) => setMissing(e.detail || null)
    window.addEventListener(APP_MISSING, show)
    return () => window.removeEventListener(APP_MISSING, show)
  }, [])
  if (!missing) return null
  const close = () => setMissing(null)
  return (
    <div className='panel-backdrop' onMouseDown={(e) => { if (e.target === e.currentTarget) close() }}>
      <section className='panel app-missing' role='alertdialog' aria-label={missing.text}>
        <header>
          <h2>{missing.text}</h2>
          <button className='close' aria-label='Close' onClick={close}><X size={18} /></button>
        </header>
        <p>Get it from <button className='link-button' onClick={() => call('app:openUrl', { url: missing.page }).catch(() => {})}>{missing.page.replace(/^https:\/\//, '')}</button>, then try the link again.</p>
        <div className='row equal'>
          <button className='primary' onClick={close}>OK</button>
        </div>
      </section>
    </div>
  )
}
