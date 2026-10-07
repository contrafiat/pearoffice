// The package side of the .pptx import (pptxImport.js): the zip with its
// size limits, XML parts with their relationships and the theme's colours,
// fonts and line widths. Runs in the page and in Node tests (happy-dom
// provides window.DOMParser there).

import JSZip from 'jszip'

export const MAX_FILE = 100 * 1024 * 1024 // the file as picked
const MAX_PART = 40 * 1024 * 1024 // one XML part, unpacked
export const MAX_MEDIA = 60 * 1024 * 1024 // one picture, unpacked
const MAX_TOTAL = 800 * 1024 * 1024 // the whole package, unpacked
const MAX_ENTRIES = 20000

export const NOT_PPTX = 'This is not a PowerPoint file PearOffice can read.'

// The zip, refused when it is too big or unpacks to too much. The sizes a
// zip declares can lie, so readBytes also stops at the limit as it unpacks.
export async function openPackage (bytes) {
  if (!bytes || bytes.length > MAX_FILE) throw new Error('This file is too big to import. The limit is 100 MB.')
  let zip
  try { zip = await JSZip.loadAsync(bytes) } catch { throw new Error(NOT_PPTX) }
  const files = Object.values(zip.files)
  if (files.length > MAX_ENTRIES) throw new Error('This file has too many parts to import.')
  let total = 0
  for (const f of files) total += declaredSize(f)
  if (total > MAX_TOTAL) throw new Error('This file unpacks to more than PearOffice can import.')
  return zip
}

const declaredSize = (f) => (f && f._data && Number.isFinite(f._data.uncompressedSize) ? f._data.uncompressedSize : 0)

// A part's bytes, or null when it is missing or bigger than `limit`.
export function readBytes (zip, name, limit = MAX_PART) {
  const f = zip.file(name)
  if (!f || f.dir || declaredSize(f) > limit) return Promise.resolve(null)
  return new Promise((resolve) => {
    const chunks = []
    let size = 0
    let done = false
    const stream = f.internalStream('uint8array')
    stream.on('data', (chunk) => {
      if (done) return
      size += chunk.length
      if (size > limit) { done = true; stream.pause(); resolve(null); return }
      chunks.push(chunk)
    })
    stream.on('error', () => { if (!done) { done = true; resolve(null) } })
    stream.on('end', () => {
      if (done) return
      done = true
      const out = new Uint8Array(size)
      let at = 0
      for (const c of chunks) { out.set(c, at); at += c.length }
      resolve(out)
    })
    stream.resume()
  })
}

// A part as an XML document, or null.
export async function readXml (zip, name) {
  const bytes = await readBytes(zip, name)
  if (!bytes) return null
  // Relationship attributes (r:id, r:embed) are renamed r_id and so on:
  // happy-dom, which stands in for the page in tests, drops r:id next to id.
  const text = new TextDecoder().decode(bytes).replace(/(\s)r:([A-Za-z]+)=/g, '$1r_$2=')
  const doc = new window.DOMParser().parseFromString(text, 'application/xml')
  const root = doc && doc.documentElement
  if (!root || root.localName === 'parsererror' || root.getElementsByTagName('parsererror').length) return null
  return root
}

// --- elements -------------------------------------------------------------------

// By local name, so any prefix the writer chose works.
export const kids = (el, name) => (el ? [...el.children].filter((c) => c.localName === name) : [])
export const kid = (el, name) => (el ? [...el.children].find((c) => c.localName === name) || null : null)
export const dig = (el, ...names) => names.reduce((e, n) => kid(e, n), el)
export const attr = (el, name) => (el ? el.getAttribute(name.replace(/^r:/, 'r_')) : null)
export function num (el, name, dflt = null) {
  const v = attr(el, name)
  const n = v == null || v === '' ? NaN : Number(v)
  return Number.isFinite(n) ? n : dflt
}
export const truthy = (v) => v === '1' || v === 'true' || v === 'on'

// --- relationships ----------------------------------------------------------------

function dirOf (name) {
  const i = name.lastIndexOf('/')
  return i < 0 ? '' : name.slice(0, i)
}

function joinPath (dir, target) {
  if (target.startsWith('/')) return target.slice(1)
  const parts = (dir ? dir.split('/') : []).concat(target.split('/'))
  const out = []
  for (const p of parts) {
    if (p === '..') out.pop()
    else if (p !== '.' && p !== '') out.push(p)
  }
  return out.join('/')
}

// A part's relationships: id -> { type (the last part of the type URI),
// target (a part name, or the address when external), external }.
export async function readRels (zip, name) {
  const dir = dirOf(name)
  const base = name.slice(dir.length ? dir.length + 1 : 0)
  const root = await readXml(zip, (dir ? dir + '/' : '') + '_rels/' + base + '.rels')
  const out = new Map()
  for (const r of kids(root, 'Relationship')) {
    const target = attr(r, 'Target') || ''
    const external = attr(r, 'TargetMode') === 'External'
    out.set(attr(r, 'Id'), {
      type: String(attr(r, 'Type') || '').replace(/^.*\//, ''),
      target: external ? target : joinPath(dir, decodeURI(target)),
      external
    })
  }
  return out
}

export function relOfType (rels, type) {
  for (const r of rels.values()) if (r.type === type && !r.external) return r.target
  return null
}

// --- colours ------------------------------------------------------------------------

const OFFICE = {
  dk1: '#000000', lt1: '#ffffff', dk2: '#44546a', lt2: '#e7e6e6', accent1: '#4472c4', accent2: '#ed7d31', accent3: '#a5a5a5', accent4: '#ffc000', accent5: '#5b9bd5', accent6: '#70ad47', hlink: '#0563c1', folHlink: '#954f72'
}
export const DEFAULT_MAP = { bg1: 'lt1', tx1: 'dk1', bg2: 'lt2', tx2: 'dk2' }
const PRESET = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', lime: '#00ff00', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', magenta: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', orange: '#ffa500', purple: '#800080', navy: '#000080', darkGray: '#a9a9a9', lightGray: '#d3d3d3', darkBlue: '#00008b', darkRed: '#8b0000', darkGreen: '#006400' }
const COLOUR_TAGS = ['srgbClr', 'schemeClr', 'sysClr', 'prstClr', 'scrgbClr', 'hslClr']

const hex2 = (n) => Math.max(0, Math.min(255, Math.round(n))).toString(16).padStart(2, '0')
export const rgbHex = ([r, g, b]) => '#' + hex2(r) + hex2(g) + hex2(b)
export function hexRgb (hex) {
  const m = /^#?([0-9a-f]{6})$/i.exec(hex || '')
  if (!m) return null
  const v = parseInt(m[1], 16)
  return [(v >> 16) & 255, (v >> 8) & 255, v & 255]
}

function toHsl ([r, g, b]) {
  r /= 255; g /= 255; b /= 255
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  if (max === min) return [0, 0, l]
  const d = max - min
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min)
  let h
  if (max === r) h = (g - b) / d + (g < b ? 6 : 0)
  else if (max === g) h = (b - r) / d + 2
  else h = (r - g) / d + 4
  return [h / 6, s, l]
}

function fromHsl ([h, s, l]) {
  if (s === 0) return [l * 255, l * 255, l * 255]
  const q = l < 0.5 ? l * (1 + s) : l + s - l * s
  const p = 2 * l - q
  const f = (t) => {
    if (t < 0) t += 1
    if (t > 1) t -= 1
    if (t < 1 / 6) return p + (q - p) * 6 * t
    if (t < 1 / 2) return q
    if (t < 2 / 3) return p + (q - p) * (2 / 3 - t) * 6
    return p
  }
  return [f(h + 1 / 3) * 255, f(h) * 255, f(h - 1 / 3) * 255]
}

// lumMod, lumOff, tint, shade and satMod, as PowerPoint applies them.
function applyMods (rgb, el) {
  let c = rgb
  for (const m of el.children) {
    const v = num(m, 'val', null)
    if (v == null) continue
    const k = v / 100000
    if (m.localName === 'lumMod' || m.localName === 'lumOff' || m.localName === 'satMod') {
      const hsl = toHsl(c)
      if (m.localName === 'lumMod') hsl[2] = Math.min(1, hsl[2] * k)
      else if (m.localName === 'lumOff') hsl[2] = Math.max(0, Math.min(1, hsl[2] + k))
      else hsl[1] = Math.max(0, Math.min(1, hsl[1] * k))
      c = fromHsl(hsl)
    } else if (m.localName === 'tint') c = c.map((x) => 255 - (255 - x) * k)
    else if (m.localName === 'shade') c = c.map((x) => x * k)
  }
  return c
}

// A colour element (srgbClr, schemeClr and the rest) as '#rrggbb', or null.
// ctx: { theme, clrMap, phClr }.
export function colourOf (el, ctx) {
  if (!el) return null
  let hex = null
  switch (el.localName) {
    case 'srgbClr': hex = /^[0-9a-f]{6}$/i.test(attr(el, 'val') || '') ? '#' + attr(el, 'val').toLowerCase() : null; break
    case 'sysClr': hex = /^[0-9a-f]{6}$/i.test(attr(el, 'lastClr') || '') ? '#' + attr(el, 'lastClr').toLowerCase() : (attr(el, 'val') === 'window' ? '#ffffff' : '#000000'); break
    case 'prstClr': hex = PRESET[attr(el, 'val')] || null; break
    case 'scrgbClr': hex = rgbHex(['r', 'g', 'b'].map((k) => num(el, k, 0) / 100000 * 255)); break
    case 'hslClr': hex = rgbHex(fromHsl([num(el, 'hue', 0) / 21600000, num(el, 'sat', 0) / 100000, num(el, 'lum', 0) / 100000])); break
    case 'schemeClr': {
      const val = attr(el, 'val')
      if (val === 'phClr') { hex = ctx.phClr || null; break }
      const map = ctx.clrMap || DEFAULT_MAP
      const slot = map[val] || DEFAULT_MAP[val] || val
      hex = (ctx.theme && ctx.theme.colors[slot]) || OFFICE[slot] || null
      break
    }
    default: return null
  }
  const rgb = hexRgb(hex)
  return rgb ? rgbHex(applyMods(rgb, el)) : null
}

// The colour element inside `el` (a solidFill, a gradient stop and so on).
export function colourIn (el, ctx) {
  for (const t of COLOUR_TAGS) {
    const c = kid(el, t)
    if (c) return colourOf(c, ctx)
  }
  return null
}

// How opaque the colour inside `el` is, 0 to 1.
function alphaIn (el) {
  for (const t of COLOUR_TAGS) {
    const a = kid(kid(el, t), 'alpha')
    if (a) return Math.max(0, Math.min(1, num(a, 'val', 100000) / 100000))
  }
  return 1
}

// The fill among `el`'s children: { colour } ('#rrggbb' or 'none') and for
// a solid fill `alpha`, with
// `lost` naming what was approximated ('gradients', 'patterns' or
// 'pictureFills'), `picture` (a relationship id) for a picture fill, or
// null when `el` gives no fill.
export function fillOf (el, ctx) {
  if (!el) return null
  for (const c of el.children) {
    switch (c.localName) {
      case 'noFill': return { colour: 'none' }
      case 'solidFill': return { colour: colourIn(c, ctx) || 'none', alpha: alphaIn(c) }
      case 'gradFill': {
        const stop = kid(kid(c, 'gsLst'), 'gs')
        return { colour: (stop && colourIn(stop, ctx)) || 'none', lost: 'gradients' }
      }
      case 'pattFill': return { colour: colourIn(kid(c, 'fgClr'), ctx) || 'none', lost: 'patterns' }
      case 'blipFill': return { colour: 'none', picture: attr(kid(c, 'blip'), 'r:embed'), lost: 'pictureFills' }
      case 'grpFill': return { colour: 'none', group: true }
    }
  }
  return null
}

// --- theme --------------------------------------------------------------------------

// { colors: slot -> '#rrggbb', fonts: { major, minor }, lineWidths: [EMU] }.
export function readTheme (root) {
  const colors = { ...OFFICE }
  const fonts = { major: '', minor: '' }
  const lineWidths = [9525, 25400, 38100]
  const els = dig(root, 'themeElements')
  const scheme = kid(els, 'clrScheme')
  for (const c of scheme ? [...scheme.children] : []) {
    const v = c.children[0] ? colourOf(c.children[0], { theme: null, clrMap: {} }) : null
    if (v) colors[c.localName] = v
  }
  fonts.major = attr(dig(els, 'fontScheme', 'majorFont', 'latin'), 'typeface') || ''
  fonts.minor = attr(dig(els, 'fontScheme', 'minorFont', 'latin'), 'typeface') || ''
  const lns = kids(dig(els, 'fmtScheme', 'lnStyleLst'), 'ln')
  lns.forEach((ln, i) => { lineWidths[i] = num(ln, 'w', lineWidths[i] || 9525) })
  return { colors, fonts, lineWidths }
}

// A clrMap element (or a clrMapOvr's overrideClrMapping) as an object.
export function readClrMap (el, base = DEFAULT_MAP) {
  if (!el) return base
  const out = { ...base }
  for (const a of el.attributes) out[a.name] = a.value
  return out
}
