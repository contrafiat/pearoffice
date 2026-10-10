// A short buzz on phones (the shell's app:haptic, expo-haptics); nothing on
// desktop. Kinds: 'light' a tap, 'select' a slide changing, 'press' a long
// press opening a menu, 'success' something worked, 'warn' something that
// deletes or removes.
import { call } from './bridge.js'
import { isMobile } from './save.js'

let last = { kind: null, at: 0 }

export function haptic (kind = 'light') {
  if (!isMobile()) return
  // Android's WebView already buzzes for a long press; iOS does not.
  if (kind === 'press') {
    if (window.pearoffice.os === 'android') return
    kind = 'medium'
  }
  // The same kind twice in quick succession buzzes once.
  const now = Date.now()
  if (kind === last.kind && now - last.at < 400) return
  last = { kind, at: now }
  call('app:haptic', { kind }).catch(() => {})
}

// One listener for the whole UI: a tap on anything tappable buzzes, so
// controls need no wiring of their own. `data-haptic` picks a kind; a
// `danger` control buzzes 'warn'. Returns the function that removes the
// listener.
export function hapticTaps () {
  if (!isMobile()) return () => {}
  const TAPPABLE = 'button, a[href], [role="button"], [role="menuitem"], [role="tab"], [role="option"], [role="switch"], label, summary, select, input[type="checkbox"], input[type="radio"]'
  const onClick = (e) => {
    const el = e.target && e.target.closest && e.target.closest(TAPPABLE)
    if (!el || el.disabled || el.getAttribute('aria-disabled') === 'true') return
    haptic(el.dataset.haptic || (el.classList.contains('danger') ? 'warn' : 'light'))
  }
  document.addEventListener('click', onClick, true)
  return () => document.removeEventListener('click', onClick, true)
}
