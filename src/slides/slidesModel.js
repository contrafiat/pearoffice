// A slide deck inside its Yjs doc (proposals/2026-10-06-slides.md, "Inside
// the Yjs doc"). Runs anywhere: the worklet makes a new deck with it and the
// editor (src/ui/slides/) changes its own copy with it.
//
//   meta    title, kind 'slides', version
//   deck    theme (an id from src/ui/slides/themes.js), size ([1920, 1080])
//   slides  slide id -> Y.Map { pos, layout, gone, goneBy, notes, els }
//           els: element id -> Y.Map { type, frame, z, role, text, ... }
//
// Element types: `text` (a text box), `shape` (shape, fill, line, lineW, and
// text inside) and `picture` (ref, hash, mime, pw, ph, alt, as the document
// image node: the bytes are in the writer's picture core,
// src/worklet/pictures.js). A colour is a theme slot ('accent1') or a hex
// value.
//
// Order is by fractional index keys (`pos` for slides, `z` for elements),
// then id, never by position in a Y.Array: a move sets one key, so two
// people moving the same slide leave one copy (the later write wins) and two
// slides moved into the same gap both stay. A deleted slide keeps its
// content with `gone: true`, so edits made to it at the same time are kept
// and Restore brings it back. Elements are removed for real.
//
// Any member can write any value, so readers clamp what they get
// (cleanFrame, MAX_ELEMENTS) and skip types they do not know.

const Y = require('yjs')
const { LAYOUTS, ROLES, boxesFor } = require('./layouts')

const VERSION = 1
const SIZE = [1920, 1080]
const THEME = 'plain'
const TYPES = ['text', 'shape', 'picture']
const SHAPES = ['rect', 'roundRect', 'ellipse', 'triangle', 'arrow', 'line', 'custom']
const ENDS = ['none', 'arrow', 'triangle', 'oval']
const ANCHORS = ['top', 'middle', 'bottom']
const PATH_MAX = 20000
// SVG path data in a 1000 x 1000 box: only these commands and numbers.
const PATH = /^\s*[Mm][\sMmLlHhVvCcQqAaZz0-9.,+eE-]*$/
const COLOR = /^(#[0-9a-fA-F]{6}|none|text|background|accent[1-6])$/
const MAX_ELEMENTS = 1000
const FRAME_MIN = -10000
const FRAME_MAX = 30000

// --- ids and keys -------------------------------------------------------------

const DIGITS = '0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz'
const BASE = DIGITS.length
const digit = (ch) => DIGITS.indexOf(ch)
const randomDigit = (lo, hi) => DIGITS[lo + Math.floor(Math.random() * (hi - lo))] // lo <= d < hi

function newId () {
  let out = ''
  for (let i = 0; i < 12; i++) out += randomDigit(0, BASE)
  return out
}

// A key that sorts strictly between `a` and `b` (null: no bound). Keys use
// the digits above, which sort the same as their character codes, and never
// end in '0', so there is always room below one. Two random digits on the
// end keep two devices from making the same key for the same gap.
function keyBetween (a, b) {
  a = a || ''
  if (b != null && a >= b) throw new Error('keyBetween: ' + a + ' is not before ' + b)
  let out = ''
  for (let i = 0; ; i++) {
    const da = i < a.length ? digit(a[i]) : 0
    const db = b != null ? (i < b.length ? digit(b[i]) : 0) : BASE
    if (da === db) { out += DIGITS[da]; continue }
    if (db - da > 1) return out + randomDigit(da + 1, db) + randomDigit(0, BASE) + randomDigit(1, BASE)
    // Adjacent digits: keep a's and look for room after it, with no upper bound.
    out += DIGITS[da]
    b = null
  }
}

const byKey = (field) => (x, y) => {
  const kx = String(x.map.get(field) || '')
  const ky = String(y.map.get(field) || '')
  return kx < ky ? -1 : kx > ky ? 1 : x.id < y.id ? -1 : x.id > y.id ? 1 : 0
}

// --- reading ------------------------------------------------------------------

const slidesMap = (doc) => doc.getMap('slides')
const deckMap = (doc) => doc.getMap('deck')

function version (doc) {
  return doc.getMap('meta').get('version') || VERSION
}

function size (doc) {
  const s = deckMap(doc).get('size')
  return Array.isArray(s) && s.length === 2 && s.every((n) => Number.isFinite(n) && n >= 100 && n <= 10000) ? s : SIZE
}

function theme (doc) {
  const t = deckMap(doc).get('theme')
  return typeof t === 'string' && t ? t.slice(0, 64) : THEME
}

// Every slide, in order, as { id, map }. Deleted ones only with { gone: true }.
function slides (doc, { gone = false } = {}) {
  const out = []
  for (const [id, map] of slidesMap(doc)) {
    if (!(map instanceof Y.Map)) continue
    if (!gone && map.get('gone')) continue
    out.push({ id, map })
  }
  return out.sort(byKey('pos'))
}

function slideIds (doc, opts) {
  return slides(doc, opts).map((s) => s.id)
}

function slide (doc, id) {
  const map = slidesMap(doc).get(id)
  return map instanceof Y.Map ? map : null
}

function elsOf (slideMap) {
  const els = slideMap && slideMap.get('els')
  return els instanceof Y.Map ? els : null
}

// A slide's elements, back to front, as { id, map }. Unknown types and any
// past MAX_ELEMENTS are left out.
function elements (doc, slideId) {
  const els = elsOf(slide(doc, slideId))
  if (!els) return []
  const out = []
  for (const [id, map] of els) {
    if (map instanceof Y.Map && TYPES.includes(map.get('type'))) out.push({ id, map })
  }
  return out.sort(byKey('z')).slice(-MAX_ELEMENTS)
}

function element (doc, slideId, elId) {
  const els = elsOf(slide(doc, slideId))
  const map = els && els.get(elId)
  return map instanceof Y.Map ? map : null
}

const clampNum = (v, lo, hi, dflt) => (Number.isFinite(v) ? Math.min(hi, Math.max(lo, v)) : dflt)

// A frame as stored, made safe to draw.
function cleanFrame (f) {
  f = f && typeof f === 'object' ? f : {}
  return {
    x: clampNum(f.x, FRAME_MIN, FRAME_MAX, 0),
    y: clampNum(f.y, FRAME_MIN, FRAME_MAX, 0),
    w: clampNum(f.w, 1, FRAME_MAX, 100),
    h: clampNum(f.h, 1, FRAME_MAX, 100),
    rot: ((clampNum(f.rot, -36000, 36000, 0) % 360) + 360) % 360
  }
}

function frame (map) {
  return cleanFrame(map.get('frame'))
}

// --- writing (call inside doc.transact) ---------------------------------------

function newElement (type, frameValue, z, role) { // text and shape
  const map = new Y.Map()
  map.set('type', type)
  map.set('frame', cleanFrame(frameValue))
  map.set('z', z)
  if (role) map.set('role', role)
  map.set('text', new Y.XmlFragment())
  return map
}

function newSlideMap (doc, pos, layout) {
  const map = new Y.Map()
  map.set('pos', pos)
  map.set('layout', LAYOUTS[layout] ? layout : 'blank')
  map.set('notes', new Y.XmlFragment())
  const els = new Y.Map()
  let z = null
  for (const box of boxesFor(layout, size(doc))) {
    z = keyBetween(z, null)
    els.set(newId(), newElement('text', box.frame, z, box.role))
  }
  map.set('els', els)
  return map
}

// A new deck: meta, deck settings and one title slide. Returns the slide's id.
function initDeck (doc, { title = 'Untitled slides' } = {}) {
  const meta = doc.getMap('meta')
  meta.set('title', title)
  meta.set('kind', 'slides')
  meta.set('version', VERSION)
  deckMap(doc).set('theme', THEME)
  deckMap(doc).set('size', SIZE)
  return addSlide(doc, { layout: 'title' })
}

// The keys either side of index `index` in the visible list (0: first).
function gapAt (list, index, field = 'pos') {
  const before = index > 0 ? list[index - 1] : null
  const after = index < list.length ? list[index] : null
  return [before ? String(before.map.get(field)) : null, after ? String(after.map.get(field)) : null]
}

// Safe key between two neighbours whose keys may be equal or out of order
// (two devices can make the same key; the id then decides the order).
function keyIn (lo, hi) {
  if (lo != null && hi != null && lo >= hi) hi = null
  return keyBetween(lo, hi)
}

// Add a slide after `after` (an id; none: at the end). Returns its id.
function addSlide (doc, { after = null, layout = 'content' } = {}) {
  const list = slides(doc)
  const i = after ? list.findIndex((s) => s.id === after) + 1 : list.length
  const [lo, hi] = gapAt(list, i || list.length)
  const id = newId()
  slidesMap(doc).set(id, newSlideMap(doc, keyIn(lo, hi), layout))
  return id
}

// Move a slide so it sits at `index` in the visible list as it is now.
function moveSlide (doc, id, index) {
  const map = slide(doc, id)
  if (!map) return false
  const list = slides(doc).filter((s) => s.id !== id)
  index = Math.max(0, Math.min(list.length, index))
  const [lo, hi] = gapAt(list, index)
  map.set('pos', keyIn(lo, hi))
  return true
}

// `by`: the identity of who deleted it, for "Ana deleted this slide".
function deleteSlide (doc, id, by = null) {
  const map = slide(doc, id)
  if (!map) return false
  map.set('gone', true)
  if (typeof by === 'string' && by) map.set('goneBy', by.slice(0, 64))
  return true
}

function restoreSlide (doc, id) {
  const map = slide(doc, id)
  if (!map) return false
  map.delete('gone')
  map.delete('goneBy')
  return true
}

// Who deleted a slide (an identity), if known.
function deletedBy (doc, id) {
  const by = slide(doc, id)?.get('goneBy')
  return typeof by === 'string' && by ? by.slice(0, 64) : null
}

// Copy a fragment's content into another one. Both must already be in the
// document: Yjs loses the text of copies nested in maps that are not yet.
function copyFragment (from, to) {
  if (from instanceof Y.XmlFragment && from.length) to.insert(0, from.toArray().map((n) => n.clone()))
}

// A copy of a slide right after it, with new ids. Returns the new id.
function duplicateSlide (doc, id) {
  const from = slide(doc, id)
  if (!from) return null
  const list = slides(doc)
  const i = list.findIndex((s) => s.id === id)
  const [lo, hi] = gapAt(list, i < 0 ? list.length : i + 1)
  const map = new Y.Map()
  map.set('pos', keyIn(lo, hi))
  map.set('layout', from.get('layout') || 'blank')
  map.set('notes', new Y.XmlFragment())
  map.set('els', new Y.Map())
  const newSlide = newId()
  slidesMap(doc).set(newSlide, map)
  copyFragment(from.get('notes'), map.get('notes'))
  const els = map.get('els')
  for (const el of elements(doc, id)) {
    const copy = new Y.Map()
    for (const [k, v] of el.map) if (!(v instanceof Y.AbstractType)) copy.set(k, v)
    copy.set('text', new Y.XmlFragment())
    els.set(newId(), copy)
    copyFragment(el.map.get('text'), copy.get('text'))
  }
  return newSlide
}

function isEmptyText (map) {
  const text = map.get('text')
  return !(text instanceof Y.XmlFragment) || plainOf(text).trim() === ''
}

// Change a slide's layout: boxes with a role the new layout has move to its
// frame; empty boxes with a role it lacks go; others keep their place and
// lose the role; missing roles get new empty boxes.
function setLayout (doc, id, layout) {
  const map = slide(doc, id)
  if (!map || !LAYOUTS[layout]) return false
  const els = elsOf(map)
  const boxes = boxesFor(layout, size(doc))
  const byRole = new Map()
  for (const el of elements(doc, id)) {
    const role = el.map.get('role')
    if (ROLES.includes(role) && !byRole.has(role)) byRole.set(role, el)
  }
  for (const [role, el] of byRole) {
    const box = boxes.find((b) => b.role === role)
    if (box) el.map.set('frame', box.frame)
    else if (isEmptyText(el.map)) els.delete(el.id)
    else el.map.delete('role')
  }
  for (const box of boxes) {
    if (byRole.has(box.role)) continue
    els.set(newId(), newElement('text', box.frame, topZ(doc, id), box.role))
  }
  map.set('layout', layout)
  return true
}

function topZ (doc, slideId) {
  const list = elements(doc, slideId)
  return keyIn(list.length ? String(list[list.length - 1].map.get('z')) : null, null)
}

// A new text box on top. Returns its id.
function addText (doc, slideId, frameValue = { x: 560, y: 440, w: 800, h: 200, rot: 0 }) {
  const els = elsOf(slide(doc, slideId))
  if (!els || elements(doc, slideId).length >= MAX_ELEMENTS) return null
  const id = newId()
  els.set(id, newElement('text', frameValue, topZ(doc, slideId)))
  return id
}

// A new shape on top. Returns its id.
// `path`: for shape 'custom', SVG path data in a 1000 x 1000 box.
function addShape (doc, slideId, shape, frameValue = { x: 760, y: 340, w: 400, h: 400, rot: 0 }, { path } = {}) {
  const els = elsOf(slide(doc, slideId))
  if (!els || !SHAPES.includes(shape) || elements(doc, slideId).length >= MAX_ELEMENTS) return null
  if (shape === 'custom' && !cleanPath(path)) return null
  const id = newId()
  const map = newElement('shape', frameValue, topZ(doc, slideId))
  map.set('shape', shape)
  if (shape === 'custom') map.set('path', cleanPath(path))
  map.set('fill', shape === 'line' ? 'none' : 'accent1')
  map.set('line', shape === 'line' ? 'text' : 'none')
  map.set('lineW', shape === 'line' ? 6 : 0)
  els.set(id, map)
  return id
}

// A new picture on top: `pic` is the reference from slides:addPicture
// ({ ref, hash, mime, w, h }) plus alt. Placed centred, at most half the
// slide, keeping its shape. Returns its id.
function addPicture (doc, slideId, pic, frameValue = null) {
  const els = elsOf(slide(doc, slideId))
  if (!els || !pic || typeof pic.ref !== 'string' || elements(doc, slideId).length >= MAX_ELEMENTS) return null
  const pw = Math.max(1, Math.round(Number(pic.w)) || 1)
  const ph = Math.max(1, Math.round(Number(pic.h)) || 1)
  if (!frameValue) {
    const [sw, sh] = size(doc)
    const k = Math.min(1, (sw / 2) / pw, (sh / 2) / ph)
    const w = Math.round(pw * k)
    const h = Math.round(ph * k)
    frameValue = { x: Math.round((sw - w) / 2), y: Math.round((sh - h) / 2), w, h, rot: 0 }
  }
  const id = newId()
  const map = new Y.Map()
  map.set('type', 'picture')
  map.set('frame', cleanFrame(frameValue))
  map.set('z', topZ(doc, slideId))
  map.set('ref', pic.ref)
  map.set('hash', String(pic.hash || ''))
  map.set('mime', String(pic.mime || ''))
  map.set('pw', pw)
  map.set('ph', ph)
  map.set('alt', String(pic.alt || '').slice(0, 500))
  els.set(id, map)
  return id
}

function cleanPath (v) {
  return typeof v === 'string' && v.length <= PATH_MAX && PATH.test(v) ? v.trim() : null
}

const opacity = (v) => clampNum(v, 0, 1, 1)

// A shape's look, as stored, made safe (proposals/2026-10-06-slides.md and
// 2026-10-06-slides-followups.md). A custom shape whose path is bad draws as
// its box.
function style (map) {
  const col = (v, dflt) => (typeof v === 'string' && COLOR.test(v) ? v : dflt)
  let shape = SHAPES.includes(map.get('shape')) ? map.get('shape') : 'rect'
  const path = shape === 'custom' ? cleanPath(map.get('path')) : null
  if (shape === 'custom' && !path) shape = 'rect'
  return {
    shape,
    path,
    fill: col(map.get('fill'), 'accent1'),
    line: col(map.get('line'), 'none'),
    lineW: clampNum(map.get('lineW'), 0, 100, 0),
    fillOpacity: opacity(map.get('fillOpacity')),
    lineOpacity: opacity(map.get('lineOpacity')),
    head: ENDS.includes(map.get('head')) ? map.get('head') : 'none',
    tail: ENDS.includes(map.get('tail')) ? map.get('tail') : 'none'
  }
}

// Where text sits in a text box or shape and whether it wraps. Titles and
// shapes default to the middle, other text boxes to the top.
function textLayout (map) {
  const anchor = map.get('anchor')
  const middle = map.get('type') === 'shape' || map.get('role') === 'title'
  return {
    anchor: ANCHORS.includes(anchor) ? anchor : middle ? 'middle' : 'top',
    wrap: map.get('wrap') !== false
  }
}

// A picture's crop: fractions cut from each side, each 0 to 0.9, and the
// two from one axis together under 0.95.
function crop (map) {
  const c = map.get('crop')
  const f = (v) => clampNum(v, 0, 0.9, 0)
  if (!c || typeof c !== 'object') return { l: 0, t: 0, r: 0, b: 0 }
  let [l, t, r, b] = [f(c.l), f(c.t), f(c.r), f(c.b)]
  if (l + r > 0.95) { l = 0; r = 0 }
  if (t + b > 0.95) { t = 0; b = 0 }
  return { l, t, r, b }
}

// Change a shape's fill, line or lineW (others are left alone).
function setStyle (doc, slideId, elId, changes = {}) {
  const map = element(doc, slideId, elId)
  if (!map || map.get('type') !== 'shape') return false
  for (const k of ['fill', 'line']) if (typeof changes[k] === 'string' && COLOR.test(changes[k])) map.set(k, changes[k])
  if (Number.isFinite(changes.lineW)) map.set('lineW', clampNum(changes.lineW, 0, 100, 0))
  return true
}

// Fill and outline opacity of a shape, each 0 to 1 (others left alone).
function setOpacity (doc, slideId, elId, { fill, line } = {}) {
  const map = element(doc, slideId, elId)
  if (!map || map.get('type') !== 'shape') return false
  if (Number.isFinite(fill)) map.set('fillOpacity', opacity(fill))
  if (Number.isFinite(line)) map.set('lineOpacity', opacity(line))
  return true
}

function textHolder (doc, slideId, elId) {
  const map = element(doc, slideId, elId)
  return map && (map.get('type') === 'text' || map.get('type') === 'shape') ? map : null
}

function setAnchor (doc, slideId, elId, anchor) {
  const map = textHolder(doc, slideId, elId)
  if (!map || !ANCHORS.includes(anchor)) return false
  map.set('anchor', anchor)
  return true
}

function setWrap (doc, slideId, elId, wrap) {
  const map = textHolder(doc, slideId, elId)
  if (!map) return false
  if (wrap) map.delete('wrap')
  else map.set('wrap', false)
  return true
}

// A picture's crop ({ l, t, r, b }); none or all zero removes it.
function setCrop (doc, slideId, elId, value) {
  const map = element(doc, slideId, elId)
  if (!map || map.get('type') !== 'picture') return false
  map.set('crop', value || {})
  const c = crop(map)
  if (!c.l && !c.t && !c.r && !c.b) map.delete('crop')
  else map.set('crop', c)
  return true
}

// Arrowheads on a line: head is the start, tail the end.
function setArrows (doc, slideId, elId, { head, tail } = {}) {
  const map = element(doc, slideId, elId)
  if (!map || map.get('type') !== 'shape' || map.get('shape') !== 'line') return false
  if (ENDS.includes(head)) map.set('head', head)
  if (ENDS.includes(tail)) map.set('tail', tail)
  return true
}

// A picture's alt text (what it shows, for screen readers and exports).
function setAlt (doc, slideId, elId, text) {
  const map = element(doc, slideId, elId)
  if (!map || map.get('type') !== 'picture') return false
  map.set('alt', String(text || '').slice(0, 500))
  return true
}

// Every picture element in the deck, deleted slides included (Restore
// brings them back), as { ref, hash, alt, map }.
function pictureRefs (doc) {
  const out = []
  for (const s of slides(doc, { gone: true })) {
    const els = elsOf(s.map)
    if (!els) continue
    for (const map of els.values()) {
      if (!(map instanceof Y.Map) || map.get('type') !== 'picture') continue
      const ref = map.get('ref')
      if (typeof ref === 'string') out.push({ ref, hash: String(map.get('hash') || ''), alt: String(map.get('alt') || ''), map })
    }
  }
  return out
}

function setFrame (doc, slideId, elId, frameValue) {
  const map = element(doc, slideId, elId)
  if (!map) return false
  map.set('frame', cleanFrame(frameValue))
  return true
}

function removeElement (doc, slideId, elId) {
  const els = elsOf(slide(doc, slideId))
  if (!els || !els.has(elId)) return false
  els.delete(elId)
  return true
}

// One step forward (+1) or back (-1) past the next element, or to the front
// ('front') or back ('back').
function restack (doc, slideId, elId, step) {
  const list = elements(doc, slideId)
  const i = list.findIndex((e) => e.id === elId)
  if (i < 0) return false
  const rest = list.filter((e) => e.id !== elId)
  const target = step === 'front' ? rest.length : step === 'back' ? 0 : Math.max(0, Math.min(rest.length, i + step))
  const [lo, hi] = gapAt(rest, target, 'z')
  list[i].map.set('z', keyIn(lo, hi))
  return true
}

// The deck's size in slide space: 1920 x 1080 for 16:9, 1440 x 1080 for an
// imported 4:3 deck. Call before adding slides, so layouts fit.
function setSize (doc, [w, h]) {
  if (![w, h].every((n) => Number.isFinite(n) && n >= 100 && n <= 10000)) return false
  deckMap(doc).set('size', [Math.round(w), Math.round(h)])
  return true
}

function setTheme (doc, id) {
  deckMap(doc).set('theme', String(id).slice(0, 64))
}

// --- text ---------------------------------------------------------------------

function plainOf (node) {
  if (node instanceof Y.XmlText) return node.toDelta().map((d) => (typeof d.insert === 'string' ? d.insert : '')).join('')
  const parts = []
  for (const child of node.toArray()) {
    const t = plainOf(child)
    if (child instanceof Y.XmlText) parts.push(t)
    else parts.push(t, '\n')
  }
  return parts.join('').replace(/\n+$/, '')
}

// The deck as plain text, for tests: one block per slide, each box's text
// (back to front) on its own line.
function plainText (doc) {
  const textOf = (map) => (map.get('text') instanceof Y.XmlFragment ? plainOf(map.get('text')) : '')
  return slides(doc).map((s) => elements(doc, s.id).map((e) => textOf(e.map)).join('\n')).join('\n---\n')
}

module.exports = {
  VERSION,
  SIZE,
  THEME,
  TYPES,
  SHAPES,
  ENDS,
  ANCHORS,
  MAX_ELEMENTS,
  newId,
  keyBetween,
  version,
  size,
  theme,
  slides,
  slideIds,
  slide,
  elements,
  element,
  cleanFrame,
  frame,
  initDeck,
  addSlide,
  moveSlide,
  deleteSlide,
  restoreSlide,
  deletedBy,
  duplicateSlide,
  setLayout,
  addText,
  addShape,
  addPicture,
  style,
  textLayout,
  crop,
  setStyle,
  setOpacity,
  setAnchor,
  setWrap,
  setCrop,
  setArrows,
  setAlt,
  pictureRefs,
  setFrame,
  removeElement,
  restack,
  setTheme,
  setSize,
  plainOf,
  plainText
}
