// Filling: what the fill handle, Fill down and Fill right put in each new
// cell (notes/2026-10-04-calc-parity.md). Works on one line at a time (a
// column when filling down or up, a row when filling right or left): given
// the k source cells, say what each of the n new cells gets.
//
// Series, as in Excel and LibreOffice:
// - two or more plain numbers continue their straight-line trend (least
//   squares, so 1, 2, 3 gives 4, 5 and 2, 4, 8 a best fit);
// - one plain number is copied, unless it is a date, which counts up a day;
// - weekday and month names continue (Mon, Tue; January, February), in the
//   case they are written;
// - text ending in a number counts on ("Item 1", "Item 2");
// - anything else, formulas included, repeats; formulas then shift their
//   references to the new cell.
// `mode: 'copy'` always repeats (Ctrl+D, Ctrl+R).

const NUMBER = /^[+-]?(\d+\.?\d*|\.\d+)(e[+-]?\d+)?$/i
const LISTS = [
  ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'],
  ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
  ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'],
  ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December']
]
const TRAILING = /^(.*?)(\d+)$/

const plainNumber = (input) => typeof input === 'string' && NUMBER.test(input.trim())
// A number format that shows a date (d, m or y outside quotes and brackets).
const isDateFormat = (code) => !!code && /[dmy]/i.test(String(code).replace(/"[^"]*"|\[[^\]]*\]/g, ''))
const tidy = (n) => String(Number(n.toPrecision(15)))

function caseLike (word, sample) {
  if (sample === sample.toUpperCase()) return word.toUpperCase()
  if (sample === sample.toLowerCase()) return word.toLowerCase()
  return word
}

// items: [{ input, num }] (num: the cell's number format). Returns n
// entries, nearest the source first: { from: i } to copy item i (shifting a
// formula), or { input } for a new value.
function fillLine (items, n, { backward = false, mode = 'series' } = {}) {
  const k = items.length
  const out = []
  const copy = () => {
    for (let t = 0; t < n; t++) out.push({ from: backward ? k - 1 - (t % k) : t % k })
    return out
  }
  if (!k || mode === 'copy') return copy()
  const inputs = items.map((x) => (x.input === undefined || x.input === null ? '' : String(x.input)))
  if (inputs.some((s) => s[0] === '=' || s === '')) return copy()
  // x for the t-th new cell: after the last source cell, or before the first.
  const xAt = (t) => (backward ? -1 - t : k + t)

  if (inputs.every(plainNumber)) {
    const ys = inputs.map(Number)
    if (k === 1) {
      if (!isDateFormat(items[0].num)) return copy()
      for (let t = 0; t < n; t++) out.push({ input: tidy(ys[0] + (backward ? -1 - t : 1 + t)), like: 0 })
      return out
    }
    const mx = (k - 1) / 2
    const my = ys.reduce((a, b) => a + b, 0) / k
    let sxy = 0
    let sxx = 0
    ys.forEach((y, x) => { sxy += (x - mx) * (y - my); sxx += (x - mx) * (x - mx) })
    const slope = sxy / sxx
    for (let t = 0; t < n; t++) out.push({ input: tidy(my + slope * (xAt(t) - mx)), like: backward ? 0 : k - 1 })
    return out
  }

  for (const list of LISTS) {
    const idx = inputs.map((s) => list.findIndex((w) => w.toUpperCase() === s.trim().toUpperCase()))
    if (idx.some((i) => i === -1)) continue
    const len = list.length
    const step = k === 1 ? 1 : (((idx[1] - idx[0]) % len) + len) % len || 1
    const at = (x) => list[(((idx[0] + step * x) % len) + len) % len]
    for (let t = 0; t < n; t++) out.push({ input: caseLike(at(xAt(t)), inputs[0].trim()), like: backward ? 0 : k - 1 })
    return out
  }

  const parts = inputs.map((s) => TRAILING.exec(s))
  if (parts.every((p) => p && p[1] === parts[0][1] && !plainNumber(p[0]))) {
    const ns = parts.map((p) => Number(p[2]))
    const step = k === 1 ? 1 : Math.round((ns[k - 1] - ns[0]) / (k - 1)) || 1
    const width = parts[0][2].length
    for (let t = 0; t < n; t++) {
      const v = ns[0] + step * xAt(t)
      if (v < 0) { out.push({ from: backward ? k - 1 - (t % k) : t % k }); continue }
      const digits = parts[0][2][0] === '0' ? String(v).padStart(width, '0') : String(v)
      out.push({ input: parts[0][1] + digits, like: backward ? 0 : k - 1 })
    }
    return out
  }

  return copy()
}

module.exports = { fillLine, isDateFormat }
