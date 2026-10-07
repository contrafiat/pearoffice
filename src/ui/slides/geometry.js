// Moving, resizing, rotating and snapping boxes on a slide. Everything is in
// slide space (slidesModel.size, 1920 x 1080 by default); frames are
// { x, y, w, h, rot } with rot in degrees, clockwise, about the centre.

// Text inside a box is drawn 1.5 times larger than CSS sizes it, so one
// point is two slide units: a 1920 unit slide is 960 points wide, as a
// 13.333 inch PowerPoint or Google Slides slide is.
export const TEXT_SCALE = 1.5
export const MIN_SIZE = 20 // the smallest a box can be resized to
export const SNAP_PX = 7 // snapping distance, in screen pixels

const rad = (deg) => (deg * Math.PI) / 180

function turn (x, y, deg) {
  const c = Math.cos(rad(deg))
  const s = Math.sin(rad(deg))
  return { x: x * c - y * s, y: x * s + y * c }
}

export const centreOf = (f) => ({ x: f.x + f.w / 2, y: f.y + f.h / 2 })

// The upright rectangle a rotated frame covers.
export function boundsOf (f) {
  if (!f.rot) return { x: f.x, y: f.y, w: f.w, h: f.h }
  const c = centreOf(f)
  const pts = [[-1, -1], [1, -1], [1, 1], [-1, 1]].map(([sx, sy]) => turn(sx * f.w / 2, sy * f.h / 2, f.rot))
  const xs = pts.map((p) => p.x + c.x)
  const ys = pts.map((p) => p.y + c.y)
  const x = Math.min(...xs)
  const y = Math.min(...ys)
  return { x, y, w: Math.max(...xs) - x, h: Math.max(...ys) - y }
}

export function unionOf (frames) {
  const b = frames.map(boundsOf)
  const x = Math.min(...b.map((r) => r.x))
  const y = Math.min(...b.map((r) => r.y))
  return { x, y, w: Math.max(...b.map((r) => r.x + r.w)) - x, h: Math.max(...b.map((r) => r.y + r.h)) - y }
}

// Lines things snap to: the slide's edges and centre lines and the edges
// and centres of the other boxes.
export function snapTargets (size, others) {
  const xs = [0, size[0] / 2, size[0]]
  const ys = [0, size[1] / 2, size[1]]
  for (const f of others) {
    const b = boundsOf(f)
    xs.push(b.x, b.x + b.w / 2, b.x + b.w)
    ys.push(b.y, b.y + b.h / 2, b.y + b.h)
  }
  return { xs, ys }
}

// The closest target to any of `values` within `limit`: { delta, at } or null.
function nearest (values, targets, limit) {
  let best = null
  for (const v of values) {
    for (const t of targets) {
      const d = t - v
      if (Math.abs(d) <= limit && (!best || Math.abs(d) < Math.abs(best.delta))) best = { delta: d, at: t }
    }
  }
  return best
}

// Snap a moving rectangle (its bounds): returns how far to shift it and the
// guide lines to draw ({ xs, ys }).
export function snapMove (rect, targets, limit) {
  const sx = nearest([rect.x, rect.x + rect.w / 2, rect.x + rect.w], targets.xs, limit)
  const sy = nearest([rect.y, rect.y + rect.h / 2, rect.y + rect.h], targets.ys, limit)
  return {
    dx: sx ? sx.delta : 0,
    dy: sy ? sy.delta : 0,
    guides: { xs: sx ? [sx.at] : [], ys: sy ? [sy.at] : [] }
  }
}

// The frames after moving by (dx, dy).
export const moved = (f, dx, dy) => ({ ...f, x: Math.round(f.x + dx), y: Math.round(f.y + dy) })

// Resize from a handle: dir is { x, y }, each -1, 0 or 1 (the handle's side).
// `p` is the pointer in slide space. The opposite side stays put, in the
// box's own rotated frame. keepRatio (Shift on a corner) keeps the shape.
// Upright boxes snap their moving edges to `targets` when given.
export function resized (f, dir, p, { keepRatio = false, targets = null, limit = 0 } = {}) {
  const c = centreOf(f)
  const local = turn(p.x - c.x, p.y - c.y, -f.rot)
  const ax = -dir.x * f.w / 2
  const ay = -dir.y * f.h / 2
  let w = dir.x ? Math.max(MIN_SIZE, (local.x - ax) * dir.x) : f.w
  let h = dir.y ? Math.max(MIN_SIZE, (local.y - ay) * dir.y) : f.h
  const guides = { xs: [], ys: [] }
  if (targets && !f.rot && !keepRatio) {
    // The moving edge, where it would be, nudged onto a line nearby.
    if (dir.x) {
      const edge = c.x + ax + dir.x * w
      const s = nearest([edge], targets.xs, limit)
      if (s && Math.abs(w + dir.x * s.delta) >= MIN_SIZE) { w += dir.x * s.delta; guides.xs.push(s.at) }
    }
    if (dir.y) {
      const edge = c.y + ay + dir.y * h
      const s = nearest([edge], targets.ys, limit)
      if (s && Math.abs(h + dir.y * s.delta) >= MIN_SIZE) { h += dir.y * s.delta; guides.ys.push(s.at) }
    }
  }
  if (keepRatio && dir.x && dir.y) {
    const k = Math.max(w / f.w, h / f.h)
    w = Math.max(MIN_SIZE, f.w * k)
    h = Math.max(MIN_SIZE, f.h * k)
  }
  // The new centre, back in slide space.
  const lc = { x: dir.x ? ax + dir.x * w / 2 : 0, y: dir.y ? ay + dir.y * h / 2 : 0 }
  const off = turn(lc.x, lc.y, f.rot)
  const nc = { x: c.x + off.x, y: c.y + off.y }
  return {
    frame: { x: Math.round(nc.x - w / 2), y: Math.round(nc.y - h / 2), w: Math.round(w), h: Math.round(h), rot: f.rot },
    guides
  }
}

// The angle from the box's centre to the pointer, with the top as 0. Steps
// of 15 degrees with Shift; otherwise it settles on a right angle when close.
export function rotated (f, p, { step = false } = {}) {
  const c = centreOf(f)
  let deg = (Math.atan2(p.y - c.y, p.x - c.x) * 180) / Math.PI + 90
  deg = ((deg % 360) + 360) % 360
  if (step) deg = Math.round(deg / 15) * 15
  else {
    const right = Math.round(deg / 90) * 90
    if (Math.abs(deg - right) < 3) deg = right
  }
  return { ...f, rot: Math.round(deg) % 360 }
}
