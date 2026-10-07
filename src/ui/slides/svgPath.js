// Custom shapes' outlines (proposals/2026-10-06-slides-followups.md): SVG
// path data in a 1000 x 1000 box (slidesModel, shape 'custom'). Read into
// absolute moves, lines, cubic and quadratic curves and closes, so the
// slide can draw them at any size, .pptx export can write them as custGeom
// and .pptx import can make them from custGeom. Runs in the page and under
// Node; imports nothing.

export const BOX = 1000

const CMD = /[MmLlHhVvCcQqAaZz]/
const ARGS = { M: 2, L: 2, H: 1, V: 1, C: 6, Q: 4, A: 7, Z: 0 }

// The path's tokens: commands and numbers. Arc flags may be written with no
// space after them ("a5 5 0 011 1"), so they are read one digit at a time.
function tokens (d) {
  const out = []
  let i = 0
  let cmd = null
  let argIndex = 0
  const num = /[-+]?(?:\d+\.?\d*|\.\d+)(?:[eE][-+]?\d+)?/y
  while (i < d.length) {
    const ch = d[i]
    if (ch === ' ' || ch === ',' || ch === '\n' || ch === '\t' || ch === '\r') { i++; continue }
    if (CMD.test(ch)) { out.push(ch); cmd = ch.toUpperCase(); argIndex = 0; i++; continue }
    const n = ARGS[cmd] || 0
    const slot = n ? argIndex % n : 0
    if (cmd === 'A' && (slot === 3 || slot === 4)) {
      if (ch !== '0' && ch !== '1') return null
      out.push(Number(ch))
      i++
      argIndex++
      continue
    }
    num.lastIndex = i
    const m = num.exec(d)
    if (!m) return null
    out.push(Number(m[0]))
    i = num.lastIndex
    argIndex++
  }
  return out
}

// An arc from (x0, y0) as SVG gives it, as cubic curves (each at most a
// quarter turn).
function arcCurves (x0, y0, rx, ry, angle, large, sweep, x, y) {
  if (x0 === x && y0 === y) return []
  rx = Math.abs(rx)
  ry = Math.abs(ry)
  if (!rx || !ry) return [{ c: 'L', x, y }]
  const phi = angle * Math.PI / 180
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const dx = (x0 - x) / 2
  const dy = (y0 - y) / 2
  const x1 = cos * dx + sin * dy
  const y1 = -sin * dx + cos * dy
  const lam = (x1 * x1) / (rx * rx) + (y1 * y1) / (ry * ry)
  if (lam > 1) { rx *= Math.sqrt(lam); ry *= Math.sqrt(lam) }
  const num = rx * rx * ry * ry - rx * rx * y1 * y1 - ry * ry * x1 * x1
  const den = rx * rx * y1 * y1 + ry * ry * x1 * x1
  let k = Math.sqrt(Math.max(0, num / den))
  if (large === sweep) k = -k
  const cx1 = k * rx * y1 / ry
  const cy1 = -k * ry * x1 / rx
  const cx = cos * cx1 - sin * cy1 + (x0 + x) / 2
  const cy = sin * cx1 + cos * cy1 + (y0 + y) / 2
  const ang = (ux, uy, vx, vy) => Math.atan2(ux * vy - uy * vx, ux * vx + uy * vy)
  const t0 = ang(1, 0, (x1 - cx1) / rx, (y1 - cy1) / ry)
  let dt = ang((x1 - cx1) / rx, (y1 - cy1) / ry, (-x1 - cx1) / rx, (-y1 - cy1) / ry)
  if (!sweep && dt > 0) dt -= 2 * Math.PI
  if (sweep && dt < 0) dt += 2 * Math.PI
  return ellipseCurves(cx, cy, rx, ry, phi, t0, dt)
}

// Cubic curves along an ellipse (centre, radii, tilt phi) from parameter
// t0 through dt radians.
export function ellipseCurves (cx, cy, rx, ry, phi, t0, dt) {
  const n = Math.max(1, Math.ceil(Math.abs(dt) / (Math.PI / 2) - 1e-9))
  const step = dt / n
  const kappa = 4 / 3 * Math.tan(step / 4)
  const cos = Math.cos(phi)
  const sin = Math.sin(phi)
  const at = (t) => {
    const ex = rx * Math.cos(t)
    const ey = ry * Math.sin(t)
    return [cx + cos * ex - sin * ey, cy + sin * ex + cos * ey]
  }
  const tangent = (t) => {
    const ex = -rx * Math.sin(t)
    const ey = ry * Math.cos(t)
    return [cos * ex - sin * ey, sin * ex + cos * ey]
  }
  const out = []
  for (let i = 0; i < n; i++) {
    const a = t0 + i * step
    const b = a + step
    const p0 = at(a)
    const p1 = at(b)
    const d0 = tangent(a)
    const d1 = tangent(b)
    out.push({ c: 'C', x1: p0[0] + kappa * d0[0], y1: p0[1] + kappa * d0[1], x2: p1[0] - kappa * d1[0], y2: p1[1] - kappa * d1[1], x: p1[0], y: p1[1] })
  }
  return out
}

const cache = new Map()

// The path as absolute segments: { c: 'M' | 'L', x, y }, { c: 'C', x1, y1,
// x2, y2, x, y }, { c: 'Q', x1, y1, x, y } and { c: 'Z' }. Arcs become
// cubic curves. Null when the path cannot be read.
export function parsePath (d) {
  if (typeof d !== 'string') return null
  if (cache.has(d)) return cache.get(d)
  const t = tokens(d)
  let out = null
  if (t && typeof t[0] === 'string' && /[Mm]/.test(t[0])) {
    out = []
    let i = 0
    let x = 0
    let y = 0
    let sx = 0
    let sy = 0
    let cmd = null
    while (i < t.length) {
      if (typeof t[i] === 'string') cmd = t[i++]
      else if (!cmd || cmd === 'Z' || cmd === 'z') { out = null; break }
      const up = cmd.toUpperCase()
      const rel = cmd !== up
      const n = ARGS[up]
      if (up === 'Z') { out.push({ c: 'Z' }); x = sx; y = sy; continue }
      const a = t.slice(i, i + n)
      if (a.length < n || a.some((v) => typeof v !== 'number')) { out = null; break }
      i += n
      const ox = rel ? x : 0
      const oy = rel ? y : 0
      if (up === 'M') {
        x = ox + a[0]; y = oy + a[1]; sx = x; sy = y
        out.push({ c: 'M', x, y })
        cmd = rel ? 'l' : 'L' // more pairs after a move are lines
      } else if (up === 'L') {
        x = ox + a[0]; y = oy + a[1]
        out.push({ c: 'L', x, y })
      } else if (up === 'H') {
        x = (rel ? x : 0) + a[0]
        out.push({ c: 'L', x, y })
      } else if (up === 'V') {
        y = (rel ? y : 0) + a[0]
        out.push({ c: 'L', x, y })
      } else if (up === 'C') {
        out.push({ c: 'C', x1: ox + a[0], y1: oy + a[1], x2: ox + a[2], y2: oy + a[3], x: ox + a[4], y: oy + a[5] })
        x = ox + a[4]; y = oy + a[5]
      } else if (up === 'Q') {
        out.push({ c: 'Q', x1: ox + a[0], y1: oy + a[1], x: ox + a[2], y: oy + a[3] })
        x = ox + a[2]; y = oy + a[3]
      } else if (up === 'A') {
        const ex = ox + a[5]
        const ey = oy + a[6]
        out.push(...arcCurves(x, y, a[0], a[1], a[2], a[3], a[4], ex, ey))
        x = ex; y = ey
      }
    }
    if (out && !out.length) out = null
  }
  if (cache.size > 500) cache.clear()
  cache.set(d, out)
  return out
}

const r1 = (v) => Math.round(v * 10) / 10

// Segments written back as SVG path data.
export function pathData (segs) {
  return segs.map((s) => {
    if (s.c === 'Z') return 'Z'
    if (s.c === 'C') return 'C' + [s.x1, s.y1, s.x2, s.y2, s.x, s.y].map(r1).join(' ')
    if (s.c === 'Q') return 'Q' + [s.x1, s.y1, s.x, s.y].map(r1).join(' ')
    return s.c + r1(s.x) + ' ' + r1(s.y)
  }).join('')
}

// Each point of the segments through fn(x, y) -> [x, y].
export function mapSegs (segs, fn) {
  return segs.map((s) => {
    if (s.c === 'Z') return s
    const [x, y] = fn(s.x, s.y)
    if (s.c === 'C') {
      const [x1, y1] = fn(s.x1, s.y1)
      const [x2, y2] = fn(s.x2, s.y2)
      return { c: 'C', x1, y1, x2, y2, x, y }
    }
    if (s.c === 'Q') {
      const [x1, y1] = fn(s.x1, s.y1)
      return { c: 'Q', x1, y1, x, y }
    }
    return { c: s.c, x, y }
  })
}

// A path from the 1000 box drawn in the box from (x0, y0), w by h, as SVG
// path data. Null when the path cannot be read.
export function fitPath (d, x0, y0, w, h) {
  const segs = parsePath(d)
  if (!segs) return null
  return pathData(mapSegs(segs, (x, y) => [x0 + x / BOX * w, y0 + y / BOX * h]))
}
