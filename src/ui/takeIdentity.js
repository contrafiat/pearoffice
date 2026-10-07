import { call } from './bridge.js'

// Taking on an identity from another device (a device link) or from the
// recovery phrase, then restarting with it. Used by the Devices panel and the
// first-run "I already use PearOffice" steps.

// The phrase as typed: any spaces or new lines, any case.
export function cleanPhrase (text) {
  return String(text || '').toLowerCase().trim().split(/\s+/).filter(Boolean).join(' ')
}

export function phraseWordCount (text) {
  const s = cleanPhrase(text)
  return s ? s.split(' ').length : 0
}

// Runs the join or restore; if it asks for a restart, runs `before` (to save
// anything that must be there after it) and restarts. Throws what went wrong.
async function takeThenRestart (method, args, before) {
  const r = await call(method, args)
  if (r && r.restart) {
    if (before) await before()
    await call('app:restart')
  }
  return r
}

// Waits up to 2 minutes for the other device (src/worklet/linking.js).
// replace: remove this device's own files first (only once the other device
// has answered).
export function linkDevice (link, { before, replace = false } = {}) {
  return takeThenRestart('link:join', { link: String(link || '').trim(), replace }, before)
}

// Stops a linkDevice that is still looking for the other device; it then
// throws CANCELLED.
export const CANCELLED = 'Linking was cancelled'
export function cancelLink () {
  return call('link:cancel').catch(() => {})
}

export function restorePhrase (text, { before, replace = false } = {}) {
  return takeThenRestart('app:restorePhrase', { phrase: cleanPhrase(text), replace }, before)
}

// The device already has files: the caller can show what would be removed
// (link:filesHere) and try again with replace.
export function hasFilesError (err) {
  return /already has files/.test(plainError(err))
}

// An error's message without the desktop bridge's "Error invoking remote
// method ..." prefix, for showing inline.
export function plainError (err) {
  return String((err && err.message) || err || '').replace(/^Error invoking remote method '[^']*': (Error: )?/, '')
}
