// What app:openUrl opens: web, email and Lightning addresses, and PearCal
// event and day links
// (/home/tim/peerloomllc/proposals/2026-10-26-pearcal-pearoffice-links.md).
// The PearCal patterns are a copy of src/shared/pearcal.js, since this
// package ships only its own folder; test/pearcal-links.test.js checks the
// two agree.

const WEB = /^(https?:|mailto:|lightning:)/
const CALENDAR = '[A-Za-z0-9_-]{1,64}'
const EVENT = '[A-Za-z0-9._~%-]{1,256}'
const DAY = '[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
const EVENT_LINK = new RegExp('^pearcal://event/' + CALENDAR + '/' + EVENT + '$')
const DAY_LINK = new RegExp('^pearcal://day/(' + DAY + ')$')

function realDay (s) {
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

// 'web', 'pearcal' or null (not opened).
function urlKind (url) {
  const s = String(url || '')
  if (WEB.test(s)) return 'web'
  if (EVENT_LINK.test(s)) return 'pearcal'
  const d = DAY_LINK.exec(s)
  return d && realDay(d[1]) ? 'pearcal' : null
}

// Opens the address with `open` (shell.openExternal). A PearCal link that
// does not open, or that `hasApp` says nothing handles, gives
// { ok: false, notInstalled: true } so the UI can say PearCal isn't
// installed. Other addresses fail as before.
async function openUrl (url, { open, hasApp = () => true }) {
  const kind = urlKind(url)
  if (kind === 'web') { await open(url); return { ok: true } }
  if (kind !== 'pearcal') return { ok: true }
  try {
    if (!hasApp(url)) return { ok: false, notInstalled: true }
    await open(url)
    return { ok: true }
  } catch {
    return { ok: false, notInstalled: true }
  }
}

module.exports = { urlKind, openUrl }
