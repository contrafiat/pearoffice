// Turning text from an imported file into cell input, shared by the JSON and
// CSV imports (src/sheet/jsonImport.js, csvImport.js).

const NUMBERISH = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const DATE_ONLY = /^(\d{4})-(\d{2})-(\d{2})$/
const DATE_TIME = /^(\d{4})-(\d{2})-(\d{2})[T ](\d{2}):(\d{2})(?::(\d{2})(\.\d+)?)?(Z|[+-]\d{2}:?\d{2})?$/
const DAY_MS = 86400000
const EPOCH_SERIAL = 25569 // 1970-01-01 as a spreadsheet date

// Text that would read as a number, a boolean or a formula keeps a leading
// apostrophe, as in an .xlsx import.
function textInput (s) {
  if (s === '') return s
  if (s[0] === '=' || s[0] === "'" || NUMBERISH.test(s.trim()) || /^(true|false)$/i.test(s.trim())) return "'" + s
  return s
}

const serial = (ms) => String(Math.round((ms / DAY_MS + EPOCH_SERIAL) * 1e8) / 1e8)

// A calendar date as a date cell, or null if it is not a real date.
function dateCell (y, m, d, h = 0, min = 0, sec = 0) {
  const ms = Date.UTC(y, m - 1, d, h, min, sec)
  const t = new Date(ms)
  if (t.getUTCFullYear() !== y || t.getUTCMonth() !== m - 1 || t.getUTCDate() !== d || h > 23 || min > 59 || sec > 59) return null
  return [serial(ms), h || min || sec ? 'yyyy-mm-dd hh:mm' : 'yyyy-mm-dd']
}

// ISO dates and date-times as date cells, or null. A time with a zone (Z,
// +02:00) is shown as this device's clock showed it; one without is kept as
// written.
function isoDateCell (s) {
  const d = DATE_ONLY.exec(s)
  if (d) return dateCell(Number(d[1]), Number(d[2]), Number(d[3]))
  const t = DATE_TIME.exec(s)
  if (!t) return null
  if (t[8]) {
    const at = new Date(s.replace(' ', 'T'))
    if (Number.isNaN(at.getTime())) return null
    return [serial(at.getTime() - at.getTimezoneOffset() * 60000), 'yyyy-mm-dd hh:mm']
  }
  const cell = dateCell(Number(t[1]), Number(t[2]), Number(t[3]), Number(t[4]), Number(t[5]), Number(t[6] || 0))
  return cell && [cell[0], 'yyyy-mm-dd hh:mm']
}

// A column width in pixels from the texts in it.
function widthFor (texts) {
  const longest = texts.reduce((n, t) => Math.max(n, String(t).length), 0)
  return Math.max(60, Math.min(320, longest * 7 + 16))
}

module.exports = { textInput, dateCell, isoDateCell, widthFor, NUMBERISH }
