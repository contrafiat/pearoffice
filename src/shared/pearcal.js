// Links to PearCal (/home/tim/peerloomllc/proposals/2026-10-26-pearcal-pearoffice-links.md):
// an event in a shared calendar or a day. Checked with exact patterns, as
// file and folder links are. desktop/open-url.js keeps its own copy of these
// patterns (the desktop package ships only its own folder);
// test/pearcal-links.test.js checks the two agree.

// The same patterns as PearCal's own (pearcal-native PR #388). A calendar
// id is up to 64 of A-Z, a-z, 0-9, _ and - (real ones are 'g' and six base-36
// characters). An event id is up to 256 characters, percent-encoded with
// encodeURIComponent, since an event imported from an .ics file keeps its
// own id, which can hold @ or a dot ('e1730000000000_r2' for one made in
// PearCal). No query string and no trailing slash.
const CALENDAR = '[A-Za-z0-9_-]{1,64}'
const EVENT = '[A-Za-z0-9._~%-]{1,256}'
const DAY = '[0-9]{4}-(?:0[1-9]|1[0-2])-(?:0[1-9]|[12][0-9]|3[01])'
const EVENT_LINK = new RegExp('^pearcal://event/(' + CALENDAR + ')/(' + EVENT + ')$')
const DAY_LINK = new RegExp('^pearcal://day/(' + DAY + ')$')
const PEARCAL_PAGE = 'https://peerloomllc.com/pearcal'
const NOT_INSTALLED = "PearCal isn't installed on this device"

// { event, calendar } or { day } for a PearCal link, else null.
function pearcalLink (v) {
  const s = typeof v === 'string' ? v : ''
  const e = EVENT_LINK.exec(s)
  if (e) return { calendar: e[1], event: e[2] }
  const d = DAY_LINK.exec(s)
  return d && realDay(d[1]) ? { day: d[1] } : null
}

// 2026-02-30 fits the pattern but is not a day.
function realDay (s) {
  const [y, m, d] = s.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  return t.getUTCFullYear() === y && t.getUTCMonth() === m - 1 && t.getUTCDate() === d
}

const isPearcalLink = (v) => !!pearcalLink(v)
const dayLink = (date) => 'pearcal://day/' + date

// What a link card shows: "PearCal event", or the day as 27 Oct 2026 in the
// device's language.
function pearcalLabel (v) {
  const l = pearcalLink(v)
  if (!l) return null
  if (l.event) return 'PearCal event'
  const d = new Date(l.day + 'T00:00:00')
  return isNaN(d) ? l.day : d.toLocaleDateString(undefined, { day: 'numeric', month: 'short', year: 'numeric' })
}

module.exports = { pearcalLink, isPearcalLink, pearcalLabel, dayLink, EVENT_LINK, DAY_LINK, PEARCAL_PAGE, NOT_INSTALLED }
