// A .pptx custom shape (a:custGeom) as SVG path data in a 1000 x 1000 box
// (proposals/2026-10-06-slides-followups.md), for pptxImport.js. Each
// a:path is scaled from its own w and h (or the shape's size) into the box
// and the paths are joined. Points may name guides, which are worked out
// from the shape's size and the gdLst formulas. Arcs become cubic curves.

import { kid, kids, attr, num } from './importOoxml.js'
import { BOX, ellipseCurves, pathData } from './svgPath.js'

const PATH_MAX = 20000 // slidesModel's limit
const MAX_GUIDES = 500
const DEG = 60000 // DrawingML angles are 60000ths of a degree
const rad = (v) => v / DEG * Math.PI / 180

// The built-in guides for a w x h shape.
function builtins (w, h) {
  const ss = Math.min(w, h)
  const g = { w, h, l: 0, t: 0, r: w, b: h, hc: w / 2, vc: h / 2, ss, ls: Math.max(w, h), cd2: 10800000, cd4: 5400000, cd8: 2700000, '3cd4': 16200000, '3cd8': 8100000, '5cd8': 13500000, '7cd8': 18900000 }
  for (const n of [2, 3, 4, 5, 6, 8, 10, 12, 32]) { g['wd' + n] = w / n; g['hd' + n] = h / n }
  for (const n of [2, 4, 6, 8, 16, 32]) g['ssd' + n] = ss / n
  return g
}

// One guide formula ("*/ w 1 2" and the rest).
function formula (f, val) {
  const [op, ...args] = String(f || '').trim().split(/\s+/)
  const [x, y, z] = args.map(val)
  switch (op) {
    case 'val': return x
    case '*/': return z ? x * y / z : 0
    case '+-': return x + y - z
    case '+/': return z ? (x + y) / z : 0
    case '?:': return x > 0 ? y : z
    case 'abs': return Math.abs(x)
    case 'at2': return Math.atan2(y, x) * 180 / Math.PI * DEG
    case 'cat2': return x * Math.cos(Math.atan2(z, y))
    case 'sat2': return x * Math.sin(Math.atan2(z, y))
    case 'cos': return x * Math.cos(rad(y))
    case 'sin': return x * Math.sin(rad(y))
    case 'tan': return x * Math.tan(rad(y))
    case 'max': return Math.max(x, y)
    case 'min': return Math.min(x, y)
    case 'mod': return Math.sqrt(x * x + y * y + z * z)
    case 'pin': return y < x ? x : y > z ? z : y
    case 'sqrt': return Math.sqrt(Math.max(0, x))
    default: return 0
  }
}

// Guide names -> values: the built-ins, then avLst and gdLst in order.
function guides (geom, w, h) {
  const g = builtins(w, h)
  const val = (v) => {
    if (v == null) return 0
    const n = Number(v)
    if (Number.isFinite(n)) return n
    return Number.isFinite(g[v]) ? g[v] : 0
  }
  let n = 0
  for (const list of [kid(geom, 'avLst'), kid(geom, 'gdLst')]) {
    for (const gd of kids(list, 'gd')) {
      if (++n > MAX_GUIDES) break
      const name = attr(gd, 'name')
      if (!name) continue
      const v = formula(attr(gd, 'fmla'), val)
      g[name] = Number.isFinite(v) ? v : 0
    }
  }
  return val
}

// An arcTo from (x, y): radii wR and hR, start and sweep angles. The angles
// are where on the ellipse, as seen from its centre.
function arc (x, y, wR, hR, st, sw) {
  if (!wR || !hR || !sw) return { segs: [], x, y }
  const param = (a) => Math.atan2(wR * Math.sin(a), hR * Math.cos(a))
  const a0 = rad(st)
  const a1 = rad(st + sw)
  const t0 = param(a0)
  let dt = param(a1) - t0
  if (Math.abs(sw) >= 360 * DEG) dt = Math.sign(sw) * 2 * Math.PI
  else if (sw > 0 && dt < 0) dt += 2 * Math.PI
  else if (sw < 0 && dt > 0) dt -= 2 * Math.PI
  const cx = x - wR * Math.cos(t0)
  const cy = y - hR * Math.sin(t0)
  const segs = ellipseCurves(cx, cy, wR, hR, 0, t0, dt)
  const last = segs[segs.length - 1]
  return { segs, x: last ? last.x : x, y: last ? last.y : y }
}

// { path, noFill, approximated } or null when there is nothing to draw.
// `raw` is the shape's own box in EMU, with its flips.
export function customPath (geom, raw) {
  const paths = kids(kid(geom, 'pathLst'), 'path')
  if (!paths.length || !raw || !raw.w || !raw.h) return null
  const val = guides(geom, raw.w, raw.h)
  const drawn = []
  for (const p of paths) {
    const pw = num(p, 'w', 0) || raw.w
    const ph = num(p, 'h', 0) || raw.h
    const sx = BOX / pw
    const sy = BOX / ph
    const pt = (el) => [val(attr(el, 'x')) * sx, val(attr(el, 'y')) * sy]
    const segs = []
    let x = 0
    let y = 0
    let approximated = false
    for (const c of p.children) {
      const pts = kids(c, 'pt').map(pt)
      if (c.localName === 'moveTo' && pts[0]) {
        ;[x, y] = pts[0]
        segs.push({ c: 'M', x, y })
      } else if (!segs.length) {
        continue // a path starts with a move
      } else if (c.localName === 'lnTo' && pts[0]) {
        ;[x, y] = pts[0]
        segs.push({ c: 'L', x, y })
      } else if (c.localName === 'cubicBezTo' && pts.length >= 3) {
        segs.push({ c: 'C', x1: pts[0][0], y1: pts[0][1], x2: pts[1][0], y2: pts[1][1], x: pts[2][0], y: pts[2][1] })
        ;[x, y] = pts[2]
      } else if (c.localName === 'quadBezTo' && pts.length >= 2) {
        segs.push({ c: 'Q', x1: pts[0][0], y1: pts[0][1], x: pts[1][0], y: pts[1][1] })
        ;[x, y] = pts[1]
      } else if (c.localName === 'arcTo') {
        // Radii are in the path's units, scaled with it.
        const a = arc(x, y, val(attr(c, 'wR')) * sx, val(attr(c, 'hR')) * sy, val(attr(c, 'stAng')), val(attr(c, 'swAng')))
        if (!Number.isFinite(a.x) || !Number.isFinite(a.y)) { approximated = true; continue }
        segs.push(...a.segs)
        ;[x, y] = [a.x, a.y]
      } else if (c.localName === 'close') segs.push({ c: 'Z' })
      else approximated = true
    }
    if (segs.length < 2) continue
    drawn.push({ segs, noFill: attr(p, 'fill') === 'none', approximated })
  }
  if (!drawn.length) return null
  // Paths with no fill are outlines drawn over the shape. One path holds
  // only one fill, so when some paths are filled the unfilled ones go.
  const filled = drawn.filter((d) => !d.noFill)
  const noFill = !filled.length
  const keep = noFill ? drawn : filled
  let approximated = keep.some((d) => d.approximated) || keep.length < drawn.length
  let segs = keep.flatMap((d) => d.segs)
  if (raw.flipH || raw.flipV) {
    segs = segs.map((s) => {
      const f = (px, py) => [raw.flipH ? BOX - px : px, raw.flipV ? BOX - py : py]
      if (s.c === 'Z') return s
      const [nx, ny] = f(s.x, s.y)
      if (s.c === 'C') { const [a, b] = f(s.x1, s.y1); const [c, d] = f(s.x2, s.y2); return { c: 'C', x1: a, y1: b, x2: c, y2: d, x: nx, y: ny } }
      if (s.c === 'Q') { const [a, b] = f(s.x1, s.y1); return { c: 'Q', x1: a, y1: b, x: nx, y: ny } }
      return { c: s.c, x: nx, y: ny }
    })
  }
  if (segs.some((s) => s.c !== 'Z' && ![s.x, s.y, s.x1, s.y1, s.x2, s.y2].every((v) => v === undefined || Number.isFinite(v)))) return null
  let path = pathData(segs)
  if (path.length > PATH_MAX) {
    // Whole numbers take less room.
    path = pathData(segs.map((s) => roundSeg(s)))
    if (path.length > PATH_MAX) return null
    approximated = true
  }
  return { path, noFill, approximated }
}

function roundSeg (s) {
  const o = { c: s.c }
  for (const k of ['x', 'y', 'x1', 'y1', 'x2', 'y2']) if (s[k] !== undefined) o[k] = Math.round(s[k])
  return o
}
