// Per-device display preferences, kept in the page's storage. Settings and
// the sheet view both read them; `pearoffice:pref` tells open views a value
// changed.

export function readPref (key) {
  try { return window.localStorage.getItem(key) } catch { return null }
}

export function writePref (key, value) {
  try { window.localStorage.setItem(key, value) } catch {}
  window.dispatchEvent(new window.CustomEvent('pearoffice:pref', { detail: { key, value } }))
}
