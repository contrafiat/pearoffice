// Text for the .pptx import (pptxImport.js): paragraphs and runs read from
// DrawingML with their inherited styles, turned into the slide text schema
// (src/ui/doc/extensions.js, slideExtensions) and written into a box's
// Y.XmlFragment.
//
// A paragraph's look comes from, weakest first: the presentation's default
// text style, the master's title or body style, the master placeholder's
// list style, the layout placeholder's, the shape's own and the paragraph's
// and run's properties. Each list style has a level 1 to 9 entry.

import { kid, kids, attr, num, truthy, colourIn } from './importOoxml.js'
import { fontFamily } from '../doc/docFiles.js'

const ALIGN = { ctr: 'center', r: 'right', just: 'justify', dist: 'justify', justLow: 'justify', thaiDist: 'justify' }

// Run properties (rPr or defRPr) merged into `acc`.
function mergeRun (acc, rPr, ctx) {
  if (!rPr) return acc
  const out = { ...acc }
  const sz = num(rPr, 'sz', null)
  if (sz != null && sz >= 100 && sz <= 400000) out.size = sz / 100
  if (rPr.hasAttribute('b')) out.b = truthy(attr(rPr, 'b'))
  if (rPr.hasAttribute('i')) out.i = truthy(attr(rPr, 'i'))
  if (rPr.hasAttribute('u')) out.u = attr(rPr, 'u') !== 'none'
  if (rPr.hasAttribute('strike')) out.s = attr(rPr, 'strike') !== 'noStrike'
  const baseline = num(rPr, 'baseline', null)
  if (baseline != null) out.baseline = baseline
  const fill = kid(rPr, 'solidFill')
  if (fill) out.color = colourIn(fill, ctx)
  else if (kid(rPr, 'gradFill')) {
    const stop = kid(kid(kid(rPr, 'gradFill'), 'gsLst'), 'gs')
    if (stop) out.color = colourIn(stop, ctx)
  }
  const latin = attr(kid(rPr, 'latin'), 'typeface')
  if (latin) out.font = latin === '+mj-lt' ? ctx.theme.fonts.major : latin === '+mn-lt' ? ctx.theme.fonts.minor : latin
  return out
}

// Paragraph properties (pPr or a list style's lvlNpPr) merged into `acc`.
function mergePara (acc, pPr, ctx) {
  if (!pPr) return acc
  const out = { ...acc }
  const algn = attr(pPr, 'algn')
  if (algn) out.align = ALIGN[algn] || null
  const spc = num(kid(kid(pPr, 'lnSpc'), 'spcPct'), 'val', null)
  if (spc != null) out.lnSpc = spc / 100000
  if (kid(pPr, 'buNone')) out.bullet = null
  else if (kid(pPr, 'buAutoNum')) out.bullet = { type: 'ordered', start: num(kid(pPr, 'buAutoNum'), 'startAt', 1) }
  else if (kid(pPr, 'buChar') || kid(pPr, 'buBlip')) out.bullet = { type: 'bullet' }
  const def = kid(pPr, 'defRPr')
  if (def) out.run = mergeRun(out.run || {}, def, ctx)
  return out
}

// A level's resolved paragraph properties from a chain of list styles
// (lstStyle, titleStyle, bodyStyle or defaultTextStyle elements), weakest
// first.
export function levelProps (chain, level, ctx) {
  let acc = { align: null, lnSpc: null, bullet: null, run: {} }
  for (const style of chain) {
    if (!style) continue
    acc = mergePara(acc, kid(style, 'lvl' + level + 'pPr'), ctx)
  }
  return acc
}

// A txBody's paragraphs: [{ level (0-8), bullet, align, lnSpc, runs }], each
// run { text } or { br: true } with b, i, u, s, size (points), color, font,
// href. `base` is run properties weaker than every list style (a shape's
// font colour from its style). `scale` is normAutofit's font scale.
export function readParagraphs (txBody, chain, ctx, { base = {}, scale = 1 } = {}) {
  const out = []
  if (!txBody) return out
  const cache = new Map()
  const props = (level) => {
    if (!cache.has(level)) cache.set(level, levelProps(chain, level + 1, ctx))
    return cache.get(level)
  }
  for (const p of kids(txBody, 'p')) {
    const pPr = kid(p, 'pPr')
    const level = Math.max(0, Math.min(8, num(pPr, 'lvl', 0)))
    const para = mergePara(props(level), pPr, ctx)
    const runBase = { ...base, ...para.run }
    const runs = []
    for (const r of p.children) {
      if (r.localName !== 'r' && r.localName !== 'fld' && r.localName !== 'br') continue
      const rp = mergeRun(runBase, kid(r, 'rPr'), ctx)
      if (r.localName === 'br') { runs.push({ br: true }); continue }
      const text = (kid(r, 't') || { textContent: '' }).textContent.replace(/\v/g, '\n')
      if (!text) continue
      const run = { text, b: !!rp.b, i: !!rp.i, u: !!rp.u, s: !!rp.s, size: rp.size ? rp.size * scale : null, color: rp.color || null, font: rp.font || null, href: null }
      const link = kid(kid(r, 'rPr'), 'hlinkClick')
      const id = link && attr(link, 'r:id')
      const rel = id && ctx.rels && ctx.rels.get(id)
      if (rel && rel.external && /^(https?:|mailto:)/i.test(rel.target)) run.href = rel.target.slice(0, 2000)
      runs.push(run)
    }
    out.push({ level, bullet: para.bullet, align: para.align, lnSpc: para.lnSpc, runs })
  }
  return out
}

export const plainOfParas = (paras) => paras.map((p) => p.runs.map((r) => (r.br ? '\n' : r.text)).join('')).join('\n')
export const isBlank = (paras) => plainOfParas(paras).trim() === ''

// --- to the slide text schema -----------------------------------------------------

function near (a, b) {
  const x = /^#([0-9a-f]{6})$/i.exec(a || '')
  const y = /^#([0-9a-f]{6})$/i.exec(b || '')
  if (!x || !y) return false
  const p = parseInt(x[1], 16)
  const q = parseInt(y[1], 16)
  const d = [16, 8, 0].reduce((s, sh) => s + (((p >> sh) & 255) - ((q >> sh) & 255)) ** 2, 0)
  return Math.sqrt(d) < 64
}

function lineHeight (pct) {
  if (!pct || pct < 1.25) return null
  return pct < 1.75 ? '1.5' : '2'
}

// A run's text nodes. `opts`: { ptScale, defaultSize, ink } (sizes equal to
// the box's default and colours close to the theme's text are left unset,
// so the theme draws them).
function textNodes (run, opts) {
  const parts = run.text.split('\n')
  const marks = []
  if (run.b) marks.push({ type: 'bold' })
  if (run.i) marks.push({ type: 'italic' })
  if (run.u) marks.push({ type: 'underline' })
  if (run.s) marks.push({ type: 'strike' })
  if (run.href) marks.push({ type: 'link', attrs: { href: run.href } })
  const style = {}
  const size = run.size ? Math.max(4, Math.min(400, Math.round(run.size * opts.ptScale))) : null
  if (size && size !== opts.defaultSize) style.fontSize = size + 'pt'
  if (run.color && !(opts.ink && near(run.color, opts.ink))) style.color = run.color
  const fam = run.font ? fontFamily(run.font) : null
  if (fam) style.fontFamily = fam
  if (Object.keys(style).length) marks.push({ type: 'textStyle', attrs: style })
  const out = []
  parts.forEach((t, i) => {
    if (i) out.push({ type: 'hardBreak' })
    if (t) out.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) })
  })
  return out
}

function paragraphJson (p, opts) {
  const content = []
  for (const r of p.runs) {
    if (r.br) content.push({ type: 'hardBreak' })
    else content.push(...textNodes(r, opts))
  }
  const attrs = {}
  if (p.align) attrs.textAlign = p.align
  const lh = lineHeight(p.lnSpc)
  if (lh) attrs.lineHeight = lh
  if (!p.bullet && p.level > 0) attrs.indent = p.level
  return { type: 'paragraph', ...(Object.keys(attrs).length ? { attrs } : {}), ...(content.length ? { content } : {}) }
}

// Paragraphs as the editor's JSON: bulleted and numbered paragraphs become
// lists, nested by level.
export function parasToJson (paras, opts) {
  const out = []
  const stack = [] // { list, level, kind }
  for (const p of paras) {
    const node = paragraphJson(p, opts)
    if (!p.bullet) { stack.length = 0; out.push(node); continue }
    const kind = p.bullet.type
    while (stack.length && (stack[stack.length - 1].level > p.level || (stack[stack.length - 1].level === p.level && stack[stack.length - 1].kind !== kind))) stack.pop()
    let top = stack[stack.length - 1]
    if (!top || top.level < p.level) {
      const list = { type: kind === 'ordered' ? 'orderedList' : 'bulletList', content: [] }
      if (kind === 'ordered' && p.bullet.start > 1) list.attrs = { start: p.bullet.start }
      if (!top) out.push(list)
      else top.list.content[top.list.content.length - 1].content.push(list)
      top = { list, level: p.level, kind }
      stack.push(top)
    }
    top.list.content.push({ type: 'listItem', content: [node] })
  }
  return { type: 'doc', content: out.length ? out : [{ type: 'paragraph' }] }
}

// Speaker notes: paragraphs with bold and italic (notesExtensions).
export function notesJson (paras) {
  const content = paras.map((p) => {
    const nodes = []
    for (const r of p.runs) {
      if (r.br) { nodes.push({ type: 'hardBreak' }); continue }
      const marks = []
      if (r.b) marks.push({ type: 'bold' })
      if (r.i) marks.push({ type: 'italic' })
      r.text.split('\n').forEach((t, i) => {
        if (i) nodes.push({ type: 'hardBreak' })
        if (t) nodes.push({ type: 'text', text: t, ...(marks.length ? { marks } : {}) })
      })
    }
    return { type: 'paragraph', ...(nodes.length ? { content: nodes } : {}) }
  })
  return { type: 'doc', content: content.length ? content : [{ type: 'paragraph' }] }
}

// --- into Yjs -----------------------------------------------------------------------

// The editor's JSON written into an empty fragment the way y-prosemirror
// writes it (an element per node with its attributes, consecutive text as
// one Y.XmlText with marks as attributes). Done here rather than with
// y-tiptap so the Yjs copy that made the deck (`Y`) makes the text too: in
// Node tests the deck model has the CommonJS copy of Yjs. `schema` checks
// the JSON and fills in default attributes.
export function writeFragment (Y, fragment, json, schema) {
  const root = schema.nodeFromJSON(json)
  root.check()
  fragment.insert(0, yChildren(Y, root))
}

function yChildren (Y, node) {
  const out = []
  let texts = []
  const flush = () => {
    if (!texts.length) return
    const t = new Y.XmlText()
    t.applyDelta(texts.map((n) => {
      const attributes = {}
      for (const m of n.marks) attributes[m.type.name] = m.attrs
      return { insert: n.text, attributes }
    }))
    out.push(t)
    texts = []
  }
  node.forEach((child) => {
    if (child.isText) { texts.push(child); return }
    flush()
    const el = new Y.XmlElement(child.type.name)
    for (const [k, v] of Object.entries(child.attrs)) if (v !== null && k !== 'ychange') el.setAttribute(k, v)
    el.insert(0, yChildren(Y, child))
    out.push(el)
  })
  flush()
  return out
}
