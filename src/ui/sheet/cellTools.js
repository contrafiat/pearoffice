// Small cell helpers for the grid: decimal places, Ctrl+arrow jumps and
// today's date.

// A number format with one more (delta 1) or one fewer (-1) decimal place.
// A cell with no format starts from the decimals it shows now. Formats with
// no digit placeholder (dates, text) are returned unchanged.
export function changeDecimals (code, delta, shown) {
  if (!code) {
    const m = /\.(\d+)/.exec(String(shown || ''))
    const places = Math.max(0, (m ? m[1].length : 0) + delta)
    return places ? '0.' + '0'.repeat(places) : '0'
  }
  // Quoted text cannot hold the placeholder: blank it out, keeping positions.
  const masked = code.replace(/"[^"]*"|\[[^\]]*\]/g, (q) => ' '.repeat(q.length))
  if (/[ymdhs]/i.test(masked)) return code
  const m = /0(\.0*)?/.exec(masked)
  if (!m) return code
  const places = Math.max(0, (m[1] ? m[1].length - 1 : 0) + delta)
  return code.slice(0, m.index) + '0' + (places ? '.' + '0'.repeat(places) : '') + code.slice(m.index + m[0].length)
}

// Where Ctrl+arrow lands, as in Excel: along a run of filled cells, to its
// last one; from a filled cell into a gap, or from an empty cell, to the next
// filled cell; with nothing ahead, to the edge.
export function jumpTarget (filled, rows, cols, from, dr, dc) {
  const inside = (r, c) => r >= 1 && r <= rows && c >= 1 && c <= cols
  let r = from.row
  let c = from.col
  const next = () => [r + dr, c + dc]
  let [nr, nc] = next()
  if (!inside(nr, nc)) return { row: r, col: c }
  if (filled(r, c) && filled(nr, nc)) {
    while (inside(nr, nc) && filled(nr, nc)) { r = nr; c = nc; [nr, nc] = next() }
    return { row: r, col: c }
  }
  while (inside(nr, nc)) {
    r = nr; c = nc
    if (filled(r, c)) return { row: r, col: c }
    ;[nr, nc] = next()
  }
  return { row: r, col: c }
}

// A date serial as YYYY-MM-DD.
export const serialDay = (serial) => new Date(Date.UTC(1899, 11, 30) + Math.round(serial) * 86400000).toISOString().slice(0, 10)

// Today as a spreadsheet date serial (days since 1899-12-30), in this
// device's own calendar.
export function todaySerial () {
  const d = new Date()
  return Math.round((Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) - Date.UTC(1899, 11, 30)) / 86400000)
}
