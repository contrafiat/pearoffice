// How a cell's formats look (proposals/2026-10-04-cell-formats.md): fonts,
// sizes, alignment, borders, and how tall a row must be for its text. Shared
// by the grid and the printable page.

// The size of text with no size set, in points (as in Excel and Word), and
// in pixels.
export const DEFAULT_SIZE = 11
export const BASE_FONT_PX = Math.round(DEFAULT_SIZE * 4 / 3 * 10) / 10
export const FONTS = {
  sans: "system-ui, -apple-system, 'Segoe UI', Roboto, 'Helvetica Neue', Arial, sans-serif",
  serif: "Georgia, 'Times New Roman', serif",
  mono: "ui-monospace, 'SF Mono', Menlo, Consolas, monospace"
}
export const SIZES = [8, 9, 10, 11, 12, 14, 16, 18, 20, 24, 28, 32, 36]
const WIDTHS = { thin: 1, medium: 2, thick: 3, dashed: 1, double: 3 }

// Font size in pixels at 100% (sizes are points).
export const fontPx = (fmt) => (fmt && fmt.size ? Math.round(fmt.size * 4 / 3 * 10) / 10 : BASE_FONT_PX)

// 'medium:#cc0000' -> CSS for one side, or undefined. With no colour the
// border takes the text colour.
export function borderCss (value) {
  if (!value) return undefined
  const [kind, color] = String(value).split(':')
  const w = WIDTHS[kind] || 1
  const style = kind === 'dashed' ? 'dashed' : kind === 'double' ? 'double' : 'solid'
  return w + 'px ' + style + ' ' + (color || 'currentColor')
}

export const hasBorder = (fmt) => !!(fmt && (fmt.bt || fmt.br || fmt.bb || fmt.bl))

// Text styles for a cell's formats.
export function textStyle (fmt, zoom = 1) {
  const f = fmt || {}
  const deco = [f.u && 'underline', f.s && 'line-through'].filter(Boolean).join(' ')
  return {
    fontFamily: f.font ? FONTS[f.font] : undefined,
    fontSize: f.size ? fontPx(f) * zoom + 'px' : undefined,
    textDecoration: deco || undefined,
    textAlign: f.align || undefined
  }
}

let ctx = null
function measure (text, font) {
  if (!ctx) ctx = document.createElement('canvas').getContext('2d')
  ctx.font = font
  return ctx.measureText(text).width
}

// How many lines `text` takes in `width` pixels, wrapping at spaces.
function lines (text, width, font) {
  let n = 0
  for (const para of String(text).split('\n')) {
    const words = para.split(/\s+/).filter(Boolean)
    if (!words.length) { n++; continue }
    let line = ''
    n++
    for (const w of words) {
      const next = line ? line + ' ' + w : w
      if (line && measure(next, font) > width) { n++; line = w } else line = next
    }
  }
  return n
}

// The height (pixels at 100%) a cell needs for its text, or 0 when the
// default row height is enough.
export function neededHeight (cell, colWidth, baseRowH) {
  const f = (cell && cell.fmt) || {}
  if (!f.wrap && !f.size && !f.font) return 0
  const px = fontPx(f)
  const lineH = Math.ceil(px * 1.3)
  const font = (f.b ? 'bold ' : '') + (f.i ? 'italic ' : '') + px + 'px ' + (FONTS[f.font] || FONTS.sans)
  const n = f.wrap && cell.display ? lines(cell.display, Math.max(10, colWidth - 12), font) : 1
  const h = n * lineH + 6
  return h > baseRowH ? h : 0
}

// The width (pixels at 100%) that fits the widest text in a column, for
// double-clicking a column edge. cells: the view's cells.
export function fitWidth (cells, col) {
  let w = 0
  for (const cell of cells) {
    if (cell.col !== col || !cell.display) continue
    const f = cell.fmt || {}
    const font = (f.b ? 'bold ' : '') + (f.i ? 'italic ' : '') + fontPx(f) + 'px ' + (FONTS[f.font] || FONTS.sans)
    for (const line of String(cell.display).split('\n')) w = Math.max(w, measure(line, font))
  }
  return w ? Math.max(24, Math.min(1000, Math.ceil(w + 14))) : null
}

// Text on a filled cell with no colour of its own: dark on a light fill and
// white on a dark one, so a pale fill stays readable in dark mode.
export function inkOn (fill) {
  const m = /^#([0-9a-f]{6})$/i.exec(String(fill || ''))
  if (!m) return undefined
  const n = parseInt(m[1], 16)
  const lum = (0.299 * (n >> 16) + 0.587 * ((n >> 8) & 255) + 0.114 * (n & 255)) / 255
  return lum > 0.6 ? '#1f2420' : lum < 0.35 ? '#ffffff' : undefined
}
