// A1 address helpers. Rows and columns are 1-based, as in Excel.

const MAX_ROWS = 100000
const MAX_COLS = 1000

function colToNum (letters) {
  let n = 0
  for (const ch of letters.toUpperCase()) n = n * 26 + (ch.charCodeAt(0) - 64)
  return n
}

function numToCol (n) {
  let s = ''
  while (n > 0) {
    const m = (n - 1) % 26
    s = String.fromCharCode(65 + m) + s
    n = Math.floor((n - 1) / 26)
  }
  return s
}

function addr (row, col) {
  return numToCol(col) + row
}

module.exports = { MAX_ROWS, MAX_COLS, colToNum, numToCol, addr }
