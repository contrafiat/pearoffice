// .pptx import (proposals/2026-10-06-slides.md, "Import and export"): our
// own reader, with jszip and DOMParser. It reads slide order and size;
// shapes, pictures, groups (flattened) and connectors with their position,
// size and rotation; text with its formatting, bullets and levels;
// placeholders, which take their position and style from the slide's layout
// and master; shapes drawn on the layout and master; backgrounds and
// speaker notes; see-through fills and outlines, where text sits and
// whether it wraps, rounded corners, picture crops, arrowheads, custom shapes (their paths
// scaled into a 1000 x 1000 box, customGeom.js) and SmartArt (from the
// drawing PowerPoint saves with it) and charts (with the values PowerPoint
// keeps with them, importChart.js). What has no place in a PearOffice deck
// is counted for the notice: animations, transitions, charts it cannot
// read, media, gradients (their first colour) and the rest. Tables keep their text, as
// does SmartArt saved with no drawing.
//
// readPresentation turns the file into plain data, buildDeck turns that into
// one Yjs update for slides:import (made with slidesModel on an empty doc)
// and importPresentation does the whole import: pictures are shrunk as
// inserted ones are, stored once the deck exists and then pointed at.

import * as Y from 'yjs'
import { getSchema } from '@tiptap/core'
import slidesModel from '../../slides/slidesModel.js'
import { slideExtensions, notesExtensions } from '../doc/extensions.js'
import { THEMES, defaultSize } from './themes.js'
import { call as bridgeCall } from '../bridge.js'
import { preparePicture, toB64, fromB64 } from '../doc/pictures.js'
import {
  openPackage, readXml, readRels, relOfType, readBytes, kid, kids, dig, attr, num, truthy,
  fillOf, colourIn, readTheme, readClrMap, hexRgb, MAX_MEDIA, NOT_PPTX
} from './importOoxml.js'
import { readParagraphs, isBlank, parasToJson, notesJson, writeFragment } from './importText.js'
import { customPath } from './customGeom.js'
import { readChart } from './importChart.js'

export const isPptxFile = (name) => /\.pptx$/i.test(String(name || ''))

export const MAX_SLIDES = 500
const MAX_DEPTH = 20 // groups inside groups
const MAX_WALK = 5000 // shapes looked at on one slide, groups and master shapes included
const EMU_PT = 12700
const PICTURE_MIMES = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', jpe: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }

// PowerPoint's preset shapes that PearOffice draws. `turn` rotates our
// right-pointing arrow; `swap` means the box turns with it.
const PRESETS = {
  rect: { shape: 'rect' },
  flowChartProcess: { shape: 'rect' },
  roundRect: { shape: 'roundRect' },
  flowChartAlternateProcess: { shape: 'roundRect' },
  ellipse: { shape: 'ellipse' },
  flowChartConnector: { shape: 'ellipse' },
  triangle: { shape: 'triangle' },
  rightArrow: { shape: 'arrow', turn: 0 },
  leftArrow: { shape: 'arrow', turn: 180 },
  downArrow: { shape: 'arrow', turn: 90, swap: true },
  upArrow: { shape: 'arrow', turn: 270, swap: true }
}
const isLinePreset = (p) => p === 'line' || /Connector[0-9]*$/.test(p)
// Line ends PowerPoint has, as the ones PearOffice draws.
const ENDS = { arrow: 'arrow', stealth: 'arrow', triangle: 'triangle', diamond: 'triangle', oval: 'oval' }
const ANCHORS = { t: 'top', ctr: 'middle', b: 'bottom' }

const TITLE_TYPES = ['title', 'ctrTitle']
const BODY_TYPES = ['body', 'subTitle', 'obj']
const SKIP_TYPES = ['dt', 'sldNum', 'hdr']
const phClass = (t) => (TITLE_TYPES.includes(t) ? 'title' : BODY_TYPES.includes(t) ? 'body' : t)

// --- reading ------------------------------------------------------------------------

// The deck's size in slide units: 1920 x 1080 for 16:9, 1440 x 1080 for 4:3,
// and 1080 high with the file's shape otherwise.
export function deckSize (cx, cy) {
  const aspect = cx / cy
  if (Math.abs(aspect - 16 / 9) < 0.02) return [1920, 1080]
  if (Math.abs(aspect - 4 / 3) < 0.02) return [1440, 1080]
  return [Math.max(100, Math.min(10000, Math.round(1080 * aspect))), 1080]
}

const emu = (v, dflt) => (Number.isFinite(v) && v >= 100000 && v <= 51206400 * 4 ? v : dflt)

// The file as plain data: { size, slides, media (path -> MIME type),
// readMedia(path), lost (kind -> count) }. Each slide is { layoutType,
// els, notes, bg }; an element is { kind: 'text' | 'shape' | 'picture' |
// 'chart', frame (slide units), ph ('title' | 'body' | ...), phType, paras,
// shape, fill, line, lineW, media, alt, chart, data }.
export async function readPresentation (bytes) {
  const zip = await openPackage(bytes)
  const rootRels = await readRels(zip, '')
  const presPath = relOfType(rootRels, 'officeDocument') || 'ppt/presentation.xml'
  const pres = await readXml(zip, presPath)
  if (!pres || pres.localName !== 'presentation') throw new Error(NOT_PPTX)
  const presRels = await readRels(zip, presPath)
  const sz = kid(pres, 'sldSz')
  const cx = emu(num(sz, 'cx', null), 12192000)
  const cy = emu(num(sz, 'cy', null), 6858000)
  const size = deckSize(cx, cy)
  const st = {
    zip,
    size,
    kx: size[0] / cx,
    ky: size[1] / cy,
    // Stored sizes are points of a slide 960 points wide (1920 units).
    ptScale: (size[0] / (cx / EMU_PT)) / 2,
    lost: {},
    seen: new Set(),
    parts: new Map(),
    themes: new Map(),
    media: new Map(),
    defaultText: kid(pres, 'defaultTextStyle')
  }
  const fonts = kids(kid(pres, 'embeddedFontLst'), 'embeddedFont').length
  if (fonts) st.lost.fonts = fonts
  const ids = kids(kid(pres, 'sldIdLst'), 'sldId')
  if (ids.length > MAX_SLIDES) throw new Error('This presentation has more than ' + MAX_SLIDES + ' slides, more than PearOffice can import.')
  const slides = []
  for (const s of ids) {
    const rel = presRels.get(attr(s, 'r:id'))
      if (!rel || rel.external) continue
    const slide = await readSlide(st, rel.target)
    if (slide) slides.push(slide)
  }
  return { size, ptScale: st.ptScale, slides, media: st.media, readMedia: (path) => readBytes(zip, path, MAX_MEDIA), lost: st.lost }
}

function lose (st, kind, key = null, n = 1) {
  if (key) {
    if (st.seen.has(kind + ':' + key)) return
    st.seen.add(kind + ':' + key)
  }
  st.lost[kind] = (st.lost[kind] || 0) + n
}

function loadPart (st, name) {
  if (!name) return Promise.resolve(null)
  if (!st.parts.has(name)) {
    st.parts.set(name, (async () => {
      const root = await readXml(st.zip, name)
      return root ? { name, root, rels: await readRels(st.zip, name) } : null
    })())
  }
  return st.parts.get(name)
}

const spTree = (part) => dig(part.root, 'cSld', 'spTree')
const nvOf = (el) => [...el.children].find((c) => /^nv/.test(c.localName)) || null
const cNvPr = (el) => kid(nvOf(el), 'cNvPr')

function phOf (el) {
  const ph = dig(nvOf(el), 'nvPr', 'ph')
  return ph ? { type: attr(ph, 'type') || 'obj', idx: attr(ph, 'idx') } : null
}

// A part's placeholders: [{ ph, el }].
function placeholders (part) {
  if (!part.phs) {
    part.phs = []
    for (const el of shapesIn(spTree(part))) {
      const ph = phOf(el)
      if (ph) part.phs.push({ ph, el })
    }
  }
  return part.phs
}

// The layout placeholder a slide placeholder takes after: same index, else
// same type.
function layoutPh (layout, ph) {
  if (!layout) return null
  const list = placeholders(layout)
  return (ph.idx != null && list.find((p) => p.ph.idx === ph.idx)) ||
    list.find((p) => p.ph.type === ph.type) ||
    (phClass(ph.type) === 'title' && list.find((p) => phClass(p.ph.type) === 'title')) ||
    null
}

// The master placeholder: title for titles, body for the rest of the body
// kinds, else the same type.
function masterPh (master, ph) {
  if (!master) return null
  const cls = phClass(ph.type)
  const want = cls === 'title' ? 'title' : cls === 'body' ? 'body' : ph.type
  return placeholders(master).find((p) => p.ph.type === want) || null
}

// A tree's children, with markup-compatibility wrappers opened (the
// fallback is the one every reader understands).
function * shapesIn (tree) {
  for (const c of tree ? tree.children : []) {
    if (c.localName === 'AlternateContent') {
      const pick = kid(c, 'Fallback') || kid(c, 'Choice')
      if (pick) yield * shapesIn(pick)
    } else yield c
  }
}

function themeOf (st, part) {
  if (!part) return readTheme(null)
  if (!st.themes.has(part.name)) st.themes.set(part.name, readTheme(part.root))
  return st.themes.get(part.name)
}

function overrideMap (part, map) {
  const ovr = part && kid(part.root, 'clrMapOvr')
  const el = ovr && kid(ovr, 'overrideClrMapping')
  return el ? readClrMap(el, map) : map
}

async function readSlide (st, name) {
  const slide = await loadPart(st, name)
  if (!slide || slide.root.localName !== 'sld') return null
  const layout = await loadPart(st, relOfType(slide.rels, 'slideLayout'))
  const master = layout ? await loadPart(st, relOfType(layout.rels, 'slideMaster')) : null
  const theme = themeOf(st, master ? await loadPart(st, relOfType(master.rels, 'theme')) : null)
  let clrMap = readClrMap(master && kid(master.root, 'clrMap'))
  clrMap = overrideMap(slide, overrideMap(layout, clrMap))
  const sc = { st, theme, clrMap, slide, layout, master, els: [], walked: 0 }
  const bg = backgroundOf(sc)
  // "Hide background graphics" hides the master's and the layout's shapes.
  if (attr(slide.root, 'showMasterSp') !== '0') {
    if (master && layout && attr(layout.root, 'showMasterSp') !== '0') await walk(sc, master, spTree(master), (r) => r, 0, 'master')
    if (layout) await walk(sc, layout, spTree(layout), (r) => r, 0, 'layout')
  }
  await walk(sc, slide, spTree(slide), (r) => r, 0, 'slide')

  const all = [...slide.root.getElementsByTagName('*')]
  // A transition element with no effect inside is only a speed: no transition.
  if (all.some((e) => e.localName === 'transition' && [...e.children].some((c) => c.localName !== 'extLst'))) lose(st, 'transitions')
  const effects = all.filter((e) => e.localName === 'cTn' && e.hasAttribute('presetClass')).length
  if (effects) lose(st, 'animations', null, effects)
  else if (all.some((e) => /^anim/.test(e.localName))) lose(st, 'animations')

  let notes = []
  const notesPart = await loadPart(st, relOfType(slide.rels, 'notesSlide'))
  if (notesPart) {
    const body = [...shapesIn(spTree(notesPart))].find((el) => el.localName === 'sp' && (phOf(el) || {}).type === 'body')
    if (body) notes = readParagraphs(kid(body, 'txBody'), [], ctxFor(sc, notesPart))
  }
  return { layoutType: layout ? attr(layout.root, 'type') : null, els: sc.els, notes, bg }
}

const ctxFor = (sc, part) => ({ theme: sc.theme, clrMap: sc.clrMap, rels: part.rels })

function backgroundOf (sc) {
  for (const part of [sc.slide, sc.layout, sc.master]) {
    const bg = part && dig(part.root, 'cSld', 'bg')
    if (!bg) continue
    const ctx = ctxFor(sc, part)
    const bgPr = kid(bg, 'bgPr')
    if (bgPr) {
      const f = fillOf(bgPr, ctx)
      if (f && f.picture) {
        const media = mediaOf(sc, part, f.picture, part.name + '#bg')
        return media ? { picture: media } : { colour: null }
      }
      if (f) {
        if (f.lost) lose(sc.st, f.lost, part.name + '#bg')
        return { colour: f.colour === 'none' ? null : f.colour }
      }
    }
    const ref = kid(bg, 'bgRef')
    if (ref) return { colour: colourIn(ref, ctx) }
  }
  // None anywhere: PowerPoint draws the theme's first background colour.
  return { colour: sc.theme.colors[sc.clrMap.bg1 || 'lt1'] || '#ffffff' }
}

// A picture part from a relationship: its path, or null (counted as lost).
function mediaOf (sc, part, id, key) {
  const rel = id ? part.rels.get(id) : null
  if (!rel || rel.external) { lose(sc.st, 'pictures', key); return null }
  const mime = PICTURE_MIMES[String(rel.target.split('.').pop()).toLowerCase()]
  if (!mime || !sc.st.zip.file(rel.target)) { lose(sc.st, 'pictures', key); return null }
  sc.st.media.set(rel.target, mime)
  return rel.target
}

// --- geometry -----------------------------------------------------------------------

function rawXfrm (el) {
  const pr = kid(el, 'spPr') || kid(el, 'grpSpPr')
  const x = pr ? kid(pr, 'xfrm') : kid(el, 'xfrm')
  const off = kid(x, 'off')
  const ext = kid(x, 'ext')
  if (!off || !ext) return null
  const out = {
    x: num(off, 'x', 0),
    y: num(off, 'y', 0),
    w: Math.max(0, num(ext, 'cx', 0)),
    h: Math.max(0, num(ext, 'cy', 0)),
    rot: num(x, 'rot', 0) / 60000,
    flipH: truthy(attr(x, 'flipH')),
    flipV: truthy(attr(x, 'flipV'))
  }
  const chOff = kid(x, 'chOff')
  const chExt = kid(x, 'chExt')
  if (chOff && chExt) Object.assign(out, { chX: num(chOff, 'x', 0), chY: num(chOff, 'y', 0), chW: num(chExt, 'cx', 0), chH: num(chExt, 'cy', 0) })
  return out
}

// A group's mapping from its children's space to its parent's.
function groupXf (g, parent) {
  const sx = g.chW ? g.w / g.chW : 1
  const sy = g.chH ? g.h / g.chH : 1
  const chX = g.chX || 0
  const chY = g.chY || 0
  const gcx = g.x + g.w / 2
  const gcy = g.y + g.h / 2
  const rad = g.rot * Math.PI / 180
  const cos = Math.cos(rad)
  const sin = Math.sin(rad)
  return (r) => {
    let cx = g.x + (r.x + r.w / 2 - chX) * sx
    let cy = g.y + (r.y + r.h / 2 - chY) * sy
    if (g.rot) {
      const dx = cx - gcx
      const dy = cy - gcy
      cx = gcx + dx * cos - dy * sin
      cy = gcy + dx * sin + dy * cos
    }
    const w = r.w * sx
    const h = r.h * sy
    return parent({ ...r, x: cx - w / 2, y: cy - h / 2, w, h, rot: r.rot + g.rot })
  }
}

const normRot = (d) => Math.round((((d % 360) + 360) % 360) * 100) / 100

function toFrame (st, r) {
  return {
    x: Math.round(r.x * st.kx),
    y: Math.round(r.y * st.ky),
    w: Math.max(1, Math.round(r.w * st.kx)),
    h: Math.max(1, Math.round(r.h * st.ky)),
    rot: normRot(r.rot)
  }
}

// A line from one corner of its box to the other (flips pick the corners),
// as our line: across the middle of a frame, turned to the line's angle.
function lineFrame (st, r, lineW) {
  const rad = r.rot * Math.PI / 180
  let dx = r.w / 2 * (r.flipH ? -1 : 1)
  let dy = r.h / 2 * (r.flipV ? -1 : 1)
  ;[dx, dy] = [dx * Math.cos(rad) - dy * Math.sin(rad), dx * Math.sin(rad) + dy * Math.cos(rad)]
  const ux = dx * st.kx
  const uy = dy * st.ky
  const len = Math.max(1, 2 * Math.hypot(ux, uy))
  const h = Math.max(20, Math.round(lineW + 8))
  const cx = (r.x + r.w / 2) * st.kx
  const cy = (r.y + r.h / 2) * st.ky
  return { x: Math.round(cx - len / 2), y: Math.round(cy - h / 2), w: Math.round(len), h, rot: normRot(Math.atan2(uy, ux) * 180 / Math.PI) }
}

const POWERPOINT_RADIUS = 0.16667

// A rounded rectangle's corner as a fraction of the shorter side: its adj
// guide ("val N", N in 1/100000), else PowerPoint's default of a sixth.
function cornerOf (geom) {
  const gd = kids(kid(geom, 'avLst'), 'gd').find((g) => attr(g, 'name') === 'adj')
  const m = gd && /^val\s+(-?\d+)$/.exec(String(attr(gd, 'fmla') || '').trim())
  if (!m) return POWERPOINT_RADIUS
  return Math.min(0.5, Math.max(0, Number(m[1]) / 100000))
}

// A preset arrow pointing another way, as our right arrow turned.
function turnedFrame (frame, preset) {
  let f = { ...frame }
  if (preset.swap) {
    const cx = f.x + f.w / 2
    const cy = f.y + f.h / 2
    f = { x: Math.round(cx - f.h / 2), y: Math.round(cy - f.w / 2), w: f.h, h: f.w, rot: f.rot }
  }
  f.rot = normRot(f.rot + (preset.turn || 0))
  return f
}

// --- shapes -------------------------------------------------------------------------

async function walk (sc, part, tree, xf, depth, source) {
  if (!tree || depth > MAX_DEPTH) return
  for (const el of shapesIn(tree)) {
    if (++sc.walked > MAX_WALK) return
    if (truthy(attr(cNvPr(el), 'hidden'))) continue
    // A layout's or master's placeholders show only through the slide's own.
    if (source !== 'slide' && phOf(el)) continue
    const key = source === 'slide' ? null : part.name + '#' + attr(cNvPr(el), 'id')
    switch (el.localName) {
      case 'sp': shapeEl(sc, part, el, xf, source, key); break
      case 'cxnSp': shapeEl(sc, part, el, xf, source, key); break
      case 'pic': picEl(sc, part, el, xf, key); break
      case 'grpSp': {
        const g = rawXfrm(el)
        await walk(sc, part, el, g ? groupXf(g, xf) : xf, depth + 1, source)
        break
      }
      case 'graphicFrame': await frameEl(sc, part, el, xf, key, depth, source); break
      case 'contentPart': lose(sc.st, 'other', key); break
    }
  }
}

// Position, with a placeholder's taken from its layout or master when the
// slide does not give one. { raw, ph, lph, mph }.
function placeOf (sc, el) {
  const ph = phOf(el)
  let lph = null
  let mph = null
  if (ph) {
    lph = layoutPh(sc.layout, ph)
    mph = masterPh(sc.master, lph ? lph.ph : ph)
  }
  const raw = rawXfrm(el) || (lph && rawXfrm(lph.el)) || (mph && rawXfrm(mph.el))
  return { raw, ph, lph, mph }
}

function textChain (sc, el, ph, lph, mph) {
  const chain = [sc.st.defaultText]
  if (ph) {
    const tx = sc.master && kid(sc.master.root, 'txStyles')
    const cls = phClass(ph.type)
    chain.push(kid(tx, cls === 'title' ? 'titleStyle' : cls === 'body' ? 'bodyStyle' : 'otherStyle'))
    if (mph) chain.push(dig(mph.el, 'txBody', 'lstStyle'))
    if (lph) chain.push(dig(lph.el, 'txBody', 'lstStyle'))
  }
  chain.push(dig(el, 'txBody', 'lstStyle'))
  return chain
}

function shapeEl (sc, part, el, xf, source, key) {
  const st = sc.st
  const { raw, ph, lph, mph } = placeOf(sc, el)
  if (ph && SKIP_TYPES.includes(ph.type)) return
  if (!raw) return
  const r = xf(raw)
  const ctx = ctxFor(sc, part)
  const spPr = kid(el, 'spPr')
  const style = kid(el, 'style')
  const geom = kid(spPr, 'prstGeom')
  const prst = geom ? attr(geom, 'prst') || 'rect' : kid(spPr, 'custGeom') ? 'custom' : (el.localName === 'cxnSp' ? 'line' : 'rect')

  let fill = fillOf(spPr, ctx)
  const fillRef = kid(style, 'fillRef')
  if (!fill && num(fillRef, 'idx', 0) > 0) fill = { colour: colourIn(fillRef, ctx) || 'none' }
  let fillC = fill && !fill.group ? fill.colour : 'none'
  // A see-through fill keeps its opacity; one that cannot be seen is none.
  let fillOpacity = fillC !== 'none' && fill.alpha != null ? fill.alpha : 1
  if (fillOpacity < 0.005) { fillC = 'none'; fillOpacity = 1 }
  const ln = kid(spPr, 'ln')
  const lnRef = kid(style, 'lnRef')
  const lnFill = ln ? fillOf(ln, ctx) : null
  let line = 'none'
  let lineEmu = 0
  let lineOpacity = 1
  if (lnFill) {
    line = lnFill.colour
    lineEmu = num(ln, 'w', 9525)
    if (lnFill.alpha != null) lineOpacity = lnFill.alpha
  } else if (num(lnRef, 'idx', 0) > 0) {
    line = colourIn(lnRef, ctx) || 'none'
    lineEmu = num(ln, 'w', sc.theme.lineWidths[num(lnRef, 'idx', 1) - 1] || 9525)
  }
  if (lineOpacity < 0.005) { line = 'none'; lineOpacity = 1 }
  let lineW = line === 'none' ? 0 : Math.min(100, Math.max(1, Math.round(lineEmu * st.kx)))
  if (line !== 'none' && !lineW) lineW = 1
  const look = { fill: fillC, line, lineW, fillOpacity, lineOpacity: line === 'none' ? 1 : lineOpacity }

  if (isLinePreset(prst)) {
    if (line === 'none') return
    const end = (name) => ENDS[attr(kid(ln, name), 'type')] || 'none'
    sc.els.push({ kind: 'shape', shape: 'line', frame: lineFrame(st, r, lineW), ...look, fill: 'none', fillOpacity: 1, head: end('headEnd'), tail: end('tailEnd'), paras: [] })
    return
  }

  // A custom shape that is only a rectangle (at any angle) or our triangle,
  // as LibreOffice often writes them, becomes that shape; any other is
  // drawn from its paths.
  let preset = PRESETS[prst]
  let shapeFrame = null
  let path = null
  if (prst === 'custom') {
    const geom = kid(spPr, 'custGeom')
    const simple = simpleOutline(geom, r)
    if (simple) {
      preset = PRESETS[simple.shape]
      shapeFrame = toFrame(st, simple.r)
    } else {
      const custom = customPath(geom, raw)
      if (custom) {
        preset = { shape: 'custom' }
        path = custom.path
        if (custom.noFill) { look.fill = 'none'; look.fillOpacity = 1 }
        if (custom.approximated) lose(st, 'approximated', key)
      }
    }
  }

  const fontRef = kid(style, 'fontRef')
  const base = {}
  if (fontRef) {
    const c = colourIn(fontRef, ctx)
    if (c) base.color = c
    const idx = attr(fontRef, 'idx')
    if (idx === 'major' || idx === 'minor') base.font = sc.theme.fonts[idx]
  }
  const scale = num(dig(el, 'txBody', 'bodyPr', 'normAutofit'), 'fontScale', 100000) / 100000
  const paras = readParagraphs(kid(el, 'txBody'), textChain(sc, el, ph, lph, mph), ctx, { base, scale: scale > 0 && scale <= 1 ? scale : 1 })
  const blank = isBlank(paras)
  const frame = toFrame(st, r)
  const cls = ph ? phClass(ph.type) : null
  const visible = look.fill !== 'none' || look.lineW > 0
  // Where the text sits and whether it wraps: the shape's own, else its
  // layout's or master's placeholder.
  const bodies = [el, lph && lph.el, mph && mph.el].map((x) => x && dig(x, 'txBody', 'bodyPr'))
  const fromBody = (name) => { for (const b of bodies) { const v = attr(b, name); if (v) return v } return null }
  const text = { anchor: ANCHORS[fromBody('anchor')] || null, wrap: fromBody('wrap') !== 'none' }

  if (!visible) {
    // A box with no fill or outline is a text box. Empty title and body
    // placeholders stay, as empty layout boxes do.
    if (!blank || cls === 'title' || cls === 'body') {
      sc.els.push({ kind: 'text', frame, ph: cls, phType: ph ? ph.type : null, paras, ...text })
    }
    return
  }
  if (!preset) {
    // Shapes on a layout or master are decoration: one we cannot draw is
    // left out rather than drawn as a box on every slide.
    if (source !== 'slide') { lose(st, 'designShapes', key); return }
    lose(st, prst === 'custom' ? 'customShapes' : 'otherShapes', key)
    preset = PRESETS.rect
  }
  if (fill && fill.lost) lose(st, fill.lost, key)
  const out = { kind: 'shape', shape: preset.shape, path, frame: turnedFrame(shapeFrame || frame, preset), ...look, paras, ...text }
  if (preset.shape === 'roundRect') out.radius = cornerOf(prst === 'roundRect' ? geom : null)
  sc.els.push(out)
}

// A custom outline's corners in the shape's box (EMU, flips applied), when
// it is one path of straight lines; points on a straight edge are dropped.
function outlinePoints (geom, r) {
  const paths = kids(kid(geom, 'pathLst'), 'path')
  if (paths.length !== 1) return null
  const path = paths[0]
  const pw = num(path, 'w', 0) || r.w
  const ph = num(path, 'h', 0) || r.h
  if (!pw || !ph) return null
  const pts = []
  for (const c of path.children) {
    if (c.localName === 'close') continue
    if (c.localName !== 'moveTo' && c.localName !== 'lnTo') return null
    if (c.localName === 'moveTo' && pts.length) return null
    const pt = kid(c, 'pt')
    let x = num(pt, 'x', 0) / pw * r.w
    let y = num(pt, 'y', 0) / ph * r.h
    if (r.flipH) x = r.w - x
    if (r.flipV) y = r.h - y
    pts.push([x, y])
  }
  const tol = Math.max(r.w, r.h) * 0.01
  const same = (a, b) => Math.abs(a[0] - b[0]) <= tol && Math.abs(a[1] - b[1]) <= tol
  const out = pts.filter((p, i) => i === 0 || !same(p, pts[i - 1]))
  while (out.length > 1 && same(out[0], out[out.length - 1])) out.pop()
  // Drop points that sit on the line between their neighbours.
  for (let i = 0; i < out.length && out.length > 3;) {
    const a = out[(i + out.length - 1) % out.length]
    const b = out[i]
    const c = out[(i + 1) % out.length]
    const cross = (b[0] - a[0]) * (c[1] - a[1]) - (b[1] - a[1]) * (c[0] - a[0])
    if (Math.abs(cross) <= tol * Math.hypot(c[0] - a[0], c[1] - a[1])) out.splice(i, 1)
    else i++
  }
  return out
}

// { shape, r } for an outline that is a rectangle at any angle or an
// upright isosceles triangle filling its box, else null.
function simpleOutline (geom, r) {
  const pts = outlinePoints(geom, r)
  if (!pts) return null
  const tol = Math.max(r.w, r.h) * 0.02
  if (pts.length === 4) {
    const [a, b, c, d] = pts
    const len = (p, q) => Math.hypot(q[0] - p[0], q[1] - p[1])
    const dot = (p, q, s) => (q[0] - p[0]) * (s[0] - q[0]) + (q[1] - p[1]) * (s[1] - q[1])
    const w = len(a, b)
    const h = len(b, c)
    if (w < 1 || h < 1 || Math.abs(len(c, d) - w) > tol || Math.abs(len(d, a) - h) > tol) return null
    if (Math.abs(dot(a, b, c)) > tol * Math.max(w, h) || Math.abs(dot(b, c, d)) > tol * Math.max(w, h)) return null
    // Its centre, turned with the box about the box's centre.
    let cx = (a[0] + b[0] + c[0] + d[0]) / 4 - r.w / 2
    let cy = (a[1] + b[1] + c[1] + d[1]) / 4 - r.h / 2
    const rad = r.rot * Math.PI / 180
    ;[cx, cy] = [cx * Math.cos(rad) - cy * Math.sin(rad), cx * Math.sin(rad) + cy * Math.cos(rad)]
    cx += r.x + r.w / 2
    cy += r.y + r.h / 2
    let angle = Math.atan2(b[1] - a[1], b[0] - a[0]) * 180 / Math.PI
    let rw = w
    let rh = h
    // The nearest upright way round, so a plain rectangle stays unturned.
    angle = ((angle % 180) + 180) % 180
    if (angle > 135) angle -= 180
    else if (angle > 45) { angle -= 90; [rw, rh] = [h, w] }
    return { shape: 'rect', r: { x: cx - rw / 2, y: cy - rh / 2, w: rw, h: rh, rot: r.rot + angle } }
  }
  if (pts.length === 3) {
    const want = [[r.w / 2, 0], [r.w, r.h], [0, r.h]]
    const flipped = [[r.w / 2, r.h], [0, 0], [r.w, 0]]
    const match = (set) => set.every((q) => pts.some((p) => Math.abs(p[0] - q[0]) <= tol && Math.abs(p[1] - q[1]) <= tol))
    if (match(want)) return { shape: 'triangle', r: { ...r } }
    if (match(flipped)) return { shape: 'triangle', r: { ...r, rot: r.rot + 180 } }
  }
  return null
}

function picEl (sc, part, el, xf, key) {
  const { raw } = placeOf(sc, el)
  if (!raw) return
  const nvPr = kid(nvOf(el), 'nvPr')
  if (nvPr && [...nvPr.getElementsByTagName('*')].some((e) => /^(videoFile|audioFile|quickTimeFile|wavAudioFile|media)$/.test(e.localName))) lose(sc.st, 'media', key)
  const blip = dig(el, 'blipFill', 'blip')
  const media = mediaOf(sc, part, attr(blip, 'r:embed'), key)
  if (!media) return
  // A crop: srcRect gives what is cut from each side in 1000ths of a
  // percent (negative values add space, which is left out).
  const src = dig(el, 'blipFill', 'srcRect')
  const side = (k) => Math.max(0, Math.min(0.9, num(src, k, 0) / 100000))
  const crop = src ? { l: side('l'), t: side('t'), r: side('r'), b: side('b') } : null
  sc.els.push({ kind: 'picture', frame: toFrame(sc.st, xf(raw)), media, alt: String(attr(cNvPr(el), 'descr') || '').slice(0, 500), crop })
}

// The drawing PowerPoint saves with a SmartArt graphic (ppt/diagrams/
// drawingN.xml): named from the diagram's data part (dataModelExt relId),
// a relationship of the slide's.
async function diagramDrawing (sc, part, data) {
  const ext = data ? [...data.getElementsByTagName('*')].find((e) => e.localName === 'dataModelExt') : null
  const rel = ext && part.rels.get(attr(ext, 'relId'))
  if (!rel || rel.external || rel.type !== 'diagramDrawing') return null
  const drawing = await loadPart(sc.st, rel.target)
  return drawing && kid(drawing.root, 'spTree') ? drawing : null
}

// Tables keep their text as a text box, as does SmartArt saved with no
// drawing; SmartArt with its drawing becomes its shapes and text; charts
// become chart elements; charts that cannot be read, embedded objects and
// the rest are counted.
async function frameEl (sc, part, el, xf, key, depth, source) {
  const raw = rawXfrm(el)
  const gd = dig(el, 'graphic', 'graphicData')
  const uri = attr(gd, 'uri') || ''
  const ctx = ctxFor(sc, part)
  if (!raw) return
  const frame = toFrame(sc.st, xf(raw))
  if (/\/table$/.test(uri)) {
    lose(sc.st, 'tables', key)
    const rows = kids(kid(gd, 'tbl'), 'tr').map((tr) => {
      const runs = []
      kids(tr, 'tc').forEach((tc, i) => {
        if (i) runs.push({ text: '\t' })
        const paras = readParagraphs(kid(tc, 'txBody'), [sc.st.defaultText], ctx, { base: { size: 18 } })
        paras.forEach((p, j) => {
          if (j) runs.push({ text: ' ' })
          runs.push(...p.runs.filter((x) => !x.br))
        })
      })
      return { level: 0, bullet: null, align: null, lnSpc: null, runs: runs.map((x) => ({ b: false, i: false, u: false, s: false, size: 18, color: null, font: null, href: null, ...x })) }
    })
    if (!isBlank(rows)) sc.els.push({ kind: 'text', frame, ph: null, paras: rows })
  } else if (/\/chart$/.test(uri)) {
    const id = attr(kid(gd, 'chart'), 'r:id')
    const rel = id && part.rels.get(id)
    const root = rel && !rel.external ? await readXml(sc.st.zip, rel.target) : null
    const got = root && readChart(root, ctx)
    if (!got) { lose(sc.st, 'charts', key); return }
    if (got.extra) lose(sc.st, 'chartTypes', key, got.extra)
    sc.els.push({ kind: 'chart', frame, chart: got.chart, data: got.data })
  } else if (/chartex$/.test(uri)) {
    lose(sc.st, 'charts', key)
  } else if (/\/diagram$/.test(uri)) {
    const dm = attr(kid(gd, 'relIds'), 'r:dm')
    const rel = dm && part.rels.get(dm)
    const data = rel && !rel.external ? await readXml(sc.st.zip, rel.target) : null
    const drawing = await diagramDrawing(sc, part, data)
    if (drawing) {
      // Its shapes are placed from the graphic frame's corner.
      const at = (r) => xf({ ...r, x: r.x + raw.x, y: r.y + raw.y })
      await walk(sc, drawing, kid(drawing.root, 'spTree'), at, depth + 1, source)
      return
    }
    lose(sc.st, 'smartArt', key)
    const paras = []
    for (const t of data ? [...data.getElementsByTagName('*')].filter((e) => e.localName === 't' && e.parentNode && e.parentNode.localName === 'pt') : []) {
      for (const p of readParagraphs(t, [sc.st.defaultText], ctx)) if (!isBlank([p])) paras.push({ ...p, bullet: null, level: 0 })
    }
    if (paras.length) sc.els.push({ kind: 'text', frame, ph: null, paras })
  } else if (/\/ole$/.test(uri)) {
    lose(sc.st, 'objects', key)
    // The picture PowerPoint shows for the object, when there is one.
    const pic = [...gd.getElementsByTagName('*')].find((e) => e.localName === 'pic')
    const media = pic && mediaOf(sc, part, attr(dig(pic, 'blipFill', 'blip'), 'r:embed'), key)
    if (media) sc.els.push({ kind: 'picture', frame, media, alt: '' })
  } else {
    lose(sc.st, 'other', key)
  }
}

// --- the deck -----------------------------------------------------------------------

let slideSchema = null
let notesSchema = null
const schemas = () => {
  if (!slideSchema) { slideSchema = getSchema(slideExtensions()); notesSchema = getSchema(notesExtensions()) }
  return { slideSchema, notesSchema }
}

function distance (a, b) {
  const x = hexRgb(a)
  const y = hexRgb(b)
  if (!x || !y) return Infinity
  return Math.hypot(x[0] - y[0], x[1] - y[1], x[2] - y[2])
}

// The theme whose background is closest to the first slide's.
export function pickTheme (slides) {
  const bg = (slides.find((s) => s.bg && s.bg.colour) || { bg: { colour: '#ffffff' } }).bg.colour
  let best = 'plain'
  for (const id of Object.keys(THEMES)) if (distance(bg, THEMES[id].background) < distance(bg, THEMES[best].background)) best = id
  return best
}

// The colour text on a filled shape is drawn in (objects.jsx, inkOn).
function inkOn (fill, theme, opacity = 1) {
  if (!fill || fill === 'none' || opacity < 0.5) return theme.text
  const rgb = hexRgb(fill)
  if (!rgb) return theme.background
  return 0.299 * rgb[0] + 0.587 * rgb[1] + 0.114 * rgb[2] > 160 ? '#000000' : '#ffffff'
}

// The layout a slide gets from its placeholders, with roles set on the
// elements that become the layout's boxes.
function chooseLayout (s) {
  const texts = s.els.filter((e) => e.kind === 'text')
  const title = texts.find((e) => e.ph === 'title')
  const bodies = title ? texts.filter((e) => e.ph === 'body').slice(0, 2) : []
  for (const e of s.els) delete e.role
  if (!title) return 'blank'
  title.role = 'title'
  if (bodies[0]) bodies[0].role = 'body'
  if (bodies[1]) bodies[1].role = 'body2'
  if (bodies.length === 2) return 'twoColumns'
  if (bodies.length === 1) {
    if (s.layoutType === 'title' || title.phType === 'ctrTitle') return 'title'
    if (s.layoutType === 'secHead') return 'section'
    return 'content'
  }
  return 'titleOnly'
}

// The deck as one Yjs update made on an empty doc, for slides:import.
// `pictures` holds the ones ready to store (media path -> { mime, w, h });
// picture elements point at 'import:<n>' until they are stored (`refs`:
// 'import:<n>' -> media path). `Y` is the Yjs copy slidesModel uses.
export function buildDeck (parsed, { Y: Yx = Y, title = 'Imported slides', pictures = new Map() } = {}) {
  const { slideSchema, notesSchema } = schemas()
  const doc = new Yx.Doc()
  const refs = new Map()
  const refOf = new Map()
  const lost = { ...parsed.lost }
  const themeId = pickTheme(parsed.slides)
  const theme = THEMES[themeId]
  const [sw, sh] = parsed.size
  const refFor = (media) => {
    if (!refOf.has(media)) { const r = 'import:' + refOf.size; refOf.set(media, r); refs.set(r, media) }
    return refOf.get(media)
  }
  const fill = (map, paras, opts) => {
    if (!paras || !paras.length || isBlank(paras)) return
    writeFragment(Yx, map.get('text'), parasToJson(paras, { ptScale: parsed.ptScale || 1, ...opts }), slideSchema)
  }
  try {
    doc.transact(() => {
      const first = slidesModel.initDeck(doc, { title })
      slidesModel.setSize(doc, parsed.size)
      slidesModel.setTheme(doc, themeId)
      if (!parsed.slides.length) slidesModel.setLayout(doc, first, 'title')
      let prev = null
      parsed.slides.forEach((s, i) => {
        const layout = chooseLayout(s)
        let id
        if (i === 0) { id = first; slidesModel.setLayout(doc, id, layout) } else id = slidesModel.addSlide(doc, { after: prev, layout })
        prev = id
        const order = []
        let roles = false
        const add = (made) => { if (made) order.push(made); else lose({ lost }, 'elements') }
        if (s.bg && s.bg.picture && pictures.has(s.bg.picture)) {
          const p = pictures.get(s.bg.picture)
          add(slidesModel.addPicture(doc, id, { ref: refFor(s.bg.picture), hash: '', mime: p.mime, w: p.w, h: p.h, alt: '' }, { x: 0, y: 0, w: sw, h: sh, rot: 0 }))
        } else if (s.bg && s.bg.colour && distance(s.bg.colour, theme.background) > 12) {
          const rect = slidesModel.addShape(doc, id, 'rect', { x: 0, y: 0, w: sw, h: sh, rot: 0 })
          if (rect) slidesModel.setStyle(doc, id, rect, { fill: s.bg.colour, line: 'none', lineW: 0 })
          add(rect)
        }
        for (const el of s.els) {
          let made = null
          if (el.role) {
            const box = slidesModel.elements(doc, id).find((e) => e.map.get('role') === el.role)
            if (box) { made = box.id; slidesModel.setFrame(doc, id, made, el.frame); roles = true }
          } else if (el.kind === 'text') {
            if (isBlank(el.paras)) continue
            made = slidesModel.addText(doc, id, el.frame)
          } else if (el.kind === 'shape') {
            made = slidesModel.addShape(doc, id, el.shape, el.frame, { path: el.path })
            if (made) {
              slidesModel.setStyle(doc, id, made, { fill: el.fill, line: el.line, lineW: el.lineW, radius: el.radius })
              if (el.fillOpacity < 1 || el.lineOpacity < 1) slidesModel.setOpacity(doc, id, made, { fill: el.fillOpacity, line: el.lineOpacity })
              if (el.shape === 'line' && (el.head !== 'none' || el.tail !== 'none')) slidesModel.setArrows(doc, id, made, { head: el.head, tail: el.tail })
            }
          } else if (el.kind === 'picture') {
            const p = pictures.get(el.media)
            if (!p) continue // could not be read; counted already
            made = slidesModel.addPicture(doc, id, { ref: refFor(el.media), hash: '', mime: p.mime, w: p.w, h: p.h, alt: el.alt }, el.frame)
            if (made && el.crop) slidesModel.setCrop(doc, id, made, el.crop)
          } else if (el.kind === 'chart') {
            // A text colour close to the theme's is left to follow it, as for
            // text (importText.js, near).
            const chart = { ...el.chart }
            if (chart.textColor && distance(chart.textColor, theme.text) < 64) delete chart.textColor
            made = slidesModel.addChart(doc, id, { chart, data: el.data }, el.frame)
          }
          add(made)
          if (!made || el.kind === 'picture' || el.kind === 'chart') continue
          if (el.anchor) slidesModel.setAnchor(doc, id, made, el.anchor)
          if (el.wrap === false) slidesModel.setWrap(doc, id, made, false)
          const map = slidesModel.element(doc, id, made)
          const role = el.role || null
          fill(map, el.paras, {
            defaultSize: role === 'title' ? defaultSize(theme, 'title') : defaultSize(theme, 'body'),
            ink: el.kind === 'shape' ? inkOn(el.fill, theme, el.fillOpacity) : theme.text,
            align: el.kind === 'shape' ? 'left' : undefined
          })
        }
        // Layout boxes were made first: put everything back in file order.
        if (roles) for (const e of order) slidesModel.restack(doc, id, e, 'front')
        if (s.notes && !isBlank(s.notes)) writeFragment(Yx, slidesModel.slide(doc, id).get('notes'), notesJson(s.notes), notesSchema)
      })
    })
    return { update: Yx.encodeStateAsUpdate(doc), refs, theme: themeId, lost }
  } finally {
    doc.destroy()
  }
}

// --- the notice -----------------------------------------------------------------------

const LEFT_OUT = {
  animations: ['animation', 'animations'],
  transitions: ['slide transition', 'slide transitions'],
  charts: ['chart PearOffice cannot read', 'charts PearOffice cannot read'],
  chartTypes: ['extra chart type in a combined chart', 'extra chart types in combined charts'],
  media: ['video or sound', 'videos and sounds'],
  objects: ['embedded object', 'embedded objects'],
  pictures: ['picture in a format PearOffice cannot show', 'pictures in formats PearOffice cannot show'],
  pictureFills: ['picture fill', 'picture fills'],
  designShapes: ['drawn shape from the slide design', 'drawn shapes from the slide design'],
  fonts: ['embedded font', 'embedded fonts'],
  elements: ['object past the limit of 1000 on a slide', 'objects past the limit of 1000 on a slide'],
  other: ['other object', 'other objects']
}
const AS_TEXT = { tables: ['table', 'tables'], smartArt: ['SmartArt graphic', 'SmartArt graphics'] }
const AS_BOX = { customShapes: ['custom shape PearOffice cannot read', 'custom shapes PearOffice cannot read'], otherShapes: ['shape PearOffice does not have', 'shapes PearOffice does not have'] }
const FIRST_COLOUR = { gradients: ['gradient', 'gradients'], patterns: ['pattern', 'patterns'] }
const CLOSE = { approximated: ['custom shape', 'custom shapes'] }

function listOf (lost, labels) {
  const parts = Object.keys(labels).filter((k) => lost[k] > 0).map((k) => lost[k] + ' ' + labels[k][lost[k] === 1 ? 0 : 1])
  return parts.length < 2 ? parts.join('') : parts.slice(0, -1).join(', ') + ' and ' + parts[parts.length - 1]
}

// What the import changed or left out, for the banner after it opens.
export function noticeFor (lost) {
  const out = []
  const left = listOf(lost, LEFT_OUT)
  const text = listOf(lost, AS_TEXT)
  const box = listOf(lost, AS_BOX)
  const first = listOf(lost, FIRST_COLOUR)
  const close = listOf(lost, CLOSE)
  if (left) out.push('Left out: ' + left + '.')
  if (text) out.push('Kept as text only: ' + text + '.')
  if (box) out.push('Drawn as boxes: ' + box + '.')
  if (first) out.push('Filled with their first colour: ' + first + '.')
  if (close) out.push('Drawn close to the original: ' + close + '.')
  out.push('Fonts and the theme are the closest PearOffice has.')
  return out.join(' ')
}

// --- the import -----------------------------------------------------------------------

const defaultPrepare = (bytes, mime) => preparePicture(new Blob([bytes], { type: mime }), mime)

// Import a .pptx as a new deck. Resolves to { sheetId, dropped, notice,
// lost }. `read` turns the file into plain data (readPresentation; odp.js
// readOdp for .odp). Options are also for tests: `prepare` shrinks a picture
// ({ bytes, mime, w, h }), `call` reaches the worklet and `Y` is the Yjs copy
// slidesModel uses.
export async function importPresentation (bytes, name, { prepare = defaultPrepare, call = bridgeCall, Y: Yx = Y, read = readPresentation } = {}) {
  const parsed = await read(bytes)
  const lost = parsed.lost
  const ready = new Map()
  for (const [path, mime] of parsed.media) {
    try {
      const data = await parsed.readMedia(path)
      if (!data) throw new Error('too big')
      ready.set(path, await prepare(data, mime))
    } catch { lost.pictures = (lost.pictures || 0) + 1 }
  }
  const title = String(name || '').replace(/\.[^.]+$/, '').slice(0, 200) || 'Imported slides'
  const built = buildDeck(parsed, { Y: Yx, title, pictures: ready })
  const r = await call('slides:import', { title, update: toB64(built.update) })

  // Store each picture, then point its elements at it (or drop them).
  const stored = new Map()
  for (const [ref, path] of built.refs) {
    const p = ready.get(path)
    try {
      const up = await call('slides:addPicture', { sheetId: r.sheetId, bytes: toB64(p.bytes), mime: p.mime, width: p.w, height: p.h })
      stored.set(ref, up)
    } catch { built.lost.pictures = (built.lost.pictures || 0) + 1 }
  }
  if (built.refs.size) {
    const s = await call('slides:state', { sheetId: r.sheetId })
    const doc = new Yx.Doc()
    try {
      Yx.applyUpdate(doc, fromB64(s.state))
      const before = Yx.encodeStateVector(doc)
      doc.transact(() => {
        for (const sl of slidesModel.slides(doc, { gone: true })) {
          for (const e of slidesModel.elements(doc, sl.id)) {
            const ref = e.map.get('ref')
            if (e.map.get('type') !== 'picture' || typeof ref !== 'string' || !built.refs.has(ref)) continue
            const up = stored.get(ref)
            if (up) { e.map.set('ref', up.ref); e.map.set('hash', up.hash) } else slidesModel.removeElement(doc, sl.id, e.id)
          }
        }
      })
      await call('slides:update', { sheetId: r.sheetId, update: toB64(Yx.encodeStateAsUpdate(doc, before)) })
    } finally { doc.destroy() }
  }
  const dropped = Object.values(built.lost).some((n) => n > 0)
  return { sheetId: r.sheetId, dropped, notice: noticeFor(built.lost), lost: built.lost, slides: parsed.slides.length }
}
