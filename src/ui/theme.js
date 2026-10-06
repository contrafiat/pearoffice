// Light, dark or the system's (a per-device preference). The colours are
// CSS variables on :root (app.css); data-theme picks a side, and without it
// the system decides. Charts read the variables when drawn, so they redraw
// when the theme changes.

import { useEffect, useState } from 'react'
import { readPref, writePref } from './prefs.js'

const KEY = 'pearoffice:theme'

export function themePref () {
  const v = readPref(KEY)
  return v === 'light' || v === 'dark' ? v : 'system'
}

export function applyTheme (pref = themePref()) {
  const root = document.documentElement
  if (pref === 'light' || pref === 'dark') root.dataset.theme = pref
  else delete root.dataset.theme
}

export function setThemePref (pref) {
  writePref(KEY, pref)
  applyTheme(pref)
  window.dispatchEvent(new window.CustomEvent('pearoffice:theme'))
}

// A number that changes whenever the colours do: a new choice here, or the
// system switching while it decides.
export function useThemeVersion () {
  const [version, setVersion] = useState(0)
  useEffect(() => {
    const bump = () => setVersion((v) => v + 1)
    const media = window.matchMedia ? window.matchMedia('(prefers-color-scheme: dark)') : null
    window.addEventListener('pearoffice:theme', bump)
    if (media) media.addEventListener('change', bump)
    return () => {
      window.removeEventListener('pearoffice:theme', bump)
      if (media) media.removeEventListener('change', bump)
    }
  }, [])
  return version
}
