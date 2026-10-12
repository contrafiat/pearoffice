// Documents in and out of other formats (proposals/2026-10-06-documents.md):
// import .docx, .md, .txt and .html; export .docx, .md, .txt and PDF.
// Imports go through HTML into the editor's own schema (documentExtensions),
// so a document made from a file holds only what the editor knows. Exports
// read the editor's ProseMirror JSON.
//
// Pictures (proposals/2026-10-06-document-images.md): an import keeps the
// ones in the file itself (.docx pictures, data: URLs) and never fetches one
// from the web. Each goes in as an image node whose ref is 'pending:<n>'
// until doc:addPicture stores it and points the node at the stored copy.
// Exports take the bytes from a map of ref -> { bytes, mime }.
import * as Y from 'yjs'
import { generateJSON, generateHTML, getSchema } from '@tiptap/core'
import { prosemirrorJSONToYXmlFragment, yXmlFragmentToProseMirrorRootNode } from '@tiptap/y-tiptap'
import mammoth from 'mammoth'
import JSZip from 'jszip'
import { marked } from 'marked'
import { checkZip } from '../slides/importOoxml.js'
import * as D from 'docx'
import { documentExtensions, SIZES, LINE_HEIGHTS, MAX_INDENT } from './extensions.js'
import { call } from '../bridge.js'
import { fileName, saveFile, isMobile } from '../save.js'
import { preparePicture, wordPicture, toB64, fromB64 } from './pictures.js'
import { toOdt, odtToHtml } from './odt.js'
import * as fflate from 'fflate'

const FIELD = 'body' // src/doc/docModel.js
const DOCX = 'application/vnd.openxmlformats-officedocument.wordprocessingml.document'

export const isDocFile = (name) => /\.(docx|odt|md|markdown|txt|html?)$/i.test(String(name || ''))

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')

// --- import -------------------------------------------------------------------

// Word styles to our blocks. Title and Subtitle come out as classes and are
// turned into the paragraph's blockStyle below.
const STYLE_MAP = [
  "p[style-name='Title'] => p.pearoffice-title:fresh",
  "p[style-name='Subtitle'] => p.pearoffice-subtitle:fresh",
  "p[style-name='Quote'] => blockquote > p:fresh",
  "p[style-name='Intense Quote'] => blockquote > p:fresh",
  "p[style-name='Code'] => pre:separator('\\n')",
  'u => u',
  'strike => s'
]

// Content the editor has no place for. Anything found is left out and the
// person is told once. Pictures in the file itself are kept on import.
const UNSUPPORTED = 'img, picture, video, audio, iframe, object, embed, svg, canvas, math'
const DATA_PICTURE = /^data:(image\/(?:png|jpe?g|gif|webp|bmp));base64,([A-Za-z0-9+/=\s]+)$/i

// Tidy the HTML from any source into what the editor's parser reads: Title
// and Subtitle, headings 4 to 6 as 3, task lists (Markdown's checkboxes and
// our own .docx checklist marks), no footnotes or pictures. Clipboard HTML
// from Word, Google Docs, LibreOffice and web pages goes through the same,
// with `paste` set (src/ui/doc/DocView.jsx).
function tidy (html, styles, paste = false) {
  // Word's <![if ...]> markers, which a browser drops and happy-dom keeps.
  html = String(html).replace(/<!\[(end)?if[^\]]*\]>/gi, '')
  const doc = new window.DOMParser().parseFromString('<body>' + html + '</body>', 'text/html')
  const body = doc.body
  let dropped = false
  if (styles) applyStyles(body, styles)
  // Pictures given as data: URLs (and .docx pictures, which mammoth turns
  // into them), on import only. A picture at a web address is never fetched.
  const pictures = []
  const kept = new Set()
  if (!paste) {
    for (const pic of [...body.querySelectorAll('picture')]) {
      for (const source of [...pic.querySelectorAll('source')]) source.remove()
      unwrap(pic)
    }
    for (const img of [...body.querySelectorAll('img')]) {
      const m = DATA_PICTURE.exec(img.getAttribute('src') || '')
      if (!m) continue
      const ref = 'pending:' + pictures.length
      pictures.push({ ref, mime: m[1].toLowerCase().replace('jpg', 'jpeg'), data: m[2].replace(/\s/g, '') })
      const next = doc.createElement('img')
      next.setAttribute('data-ref', ref)
      if (img.getAttribute('alt')) next.setAttribute('alt', img.getAttribute('alt'))
      // A width as a share of the page (.odt import gives one).
      if (/^\d+$/.test(img.getAttribute('data-width') || '')) next.setAttribute('data-width', img.getAttribute('data-width'))
      // The editor's parser puts it on its own line.
      img.replaceWith(next)
      kept.add(next)
    }
  }
  for (const el of [...body.querySelectorAll(UNSUPPORTED)]) { if (kept.has(el)) continue; dropped = true; el.remove() }
  if (foreign(body)) dropped = true
  // Footnotes and endnotes (mammoth's markers and the list at the end).
  for (const a of [...body.querySelectorAll('a[href^="#footnote-"], a[href^="#endnote-"]')]) {
    dropped = true
    const sup = a.closest('sup')
    ;(sup || a).remove()
  }
  for (const li of [...body.querySelectorAll('li[id^="footnote-"], li[id^="endnote-"]')]) {
    const list = li.parentElement
    li.remove()
    if (list && !list.children.length) list.remove()
  }
  // Title and Subtitle: mammoth's classes, Word's MsoTitle, LibreOffice's.
  for (const el of [...body.querySelectorAll('p[class], h1[class], h2[class]')]) {
    const c = el.getAttribute('class')
    const style = /(^|[\s-])(mso)?subtitle(\s|$)/i.test(c) ? 'subtitle' : /(^|[\s-])(mso)?title(\s|$)/i.test(c) ? 'title' : null
    if (!style) continue
    const p = el.tagName === 'P' ? el : renameEl(el, 'p')
    p.setAttribute('data-style', style)
    p.removeAttribute('class')
  }
  for (const el of [...body.querySelectorAll('h4, h5, h6')]) renameEl(el, 'h3')
  cleanStyles(body, paste)
  for (const code of [...body.querySelectorAll('pre > code')]) {
    const last = code.lastChild
    if (last && last.nodeType === 3) last.textContent = last.textContent.replace(/\n$/, '')
  }
  // Markdown task lists: <li><input type=checkbox> text</li>. A list mixing
  // plain items and tasks becomes a bulleted list or a checklist for each run
  // of either kind.
  const box = (li) => li.querySelector(':scope > input[type=checkbox], :scope > p:first-child > input[type=checkbox]')
  const markTasks = (ul, items) => {
    ul.setAttribute('data-type', 'taskList')
    for (const li of items) {
      const input = box(li)
      li.setAttribute('data-type', 'taskItem')
      li.setAttribute('data-checked', input.hasAttribute('checked') ? 'true' : 'false')
      const after = input.nextSibling
      input.remove()
      if (after && after.nodeType === 3) after.textContent = after.textContent.replace(/^\s+/, '')
    }
  }
  for (const ul of [...body.querySelectorAll('ul')]) {
    const items = [...ul.children].filter((x) => x.tagName === 'LI')
    if (!items.length || !items.some(box)) continue
    if (items.every(box)) { markTasks(ul, items); continue }
    const runs = []
    for (const li of items) {
      const task = !!box(li)
      if (!runs.length || runs[runs.length - 1].task !== task) runs.push({ task, items: [] })
      runs[runs.length - 1].items.push(li)
    }
    for (const run of runs) {
      const part = doc.createElement('ul')
      ul.before(part)
      for (const li of run.items) part.appendChild(li)
      if (run.task) markTasks(part, run.items)
    }
    ul.remove()
  }
  // Our .docx checklists: paragraphs starting with ☐, ☒ or ☑ in a row (we
  // write ☒, which LibreOffice draws; older exports wrote ☑).
  let run = null
  for (const p of [...body.querySelectorAll('p')]) {
    const m = /^([☐☑☒])\s?/.exec(p.textContent)
    if (!m || p.closest('li, td, th')) { run = null; continue }
    if (!run || p.previousElementSibling !== run) {
      const ul = doc.createElement('ul')
      ul.setAttribute('data-type', 'taskList')
      p.before(ul)
      run = ul
    }
    stripPrefix(p, m[0].length)
    const li = doc.createElement('li')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', m[1] !== '☐' ? 'true' : 'false')
    li.appendChild(p)
    run.appendChild(li)
  }
  for (const el of [...body.querySelectorAll('input, button, select, textarea')]) el.remove()
  return { html: body.innerHTML, dropped, pictures }
}

// Clipboard HTML tidied for the editor. { html, dropped }.
export function tidyPaste (html) {
  return tidy(html, null, true)
}

function renameEl (el, tag) {
  const next = el.ownerDocument.createElement(tag)
  for (const a of el.attributes) next.setAttribute(a.name, a.value)
  while (el.firstChild) next.appendChild(el.firstChild)
  el.replaceWith(next)
  return next
}

function unwrap (el) {
  while (el.firstChild) el.before(el.firstChild)
  el.remove()
}

// --- other programs' HTML ------------------------------------------------------

const QUIET = 'script, style, noscript, template, meta, link, title, head, xml, br.Apple-interchange-newline'
const BLOCK_TAGS = new Set(['P', 'H1', 'H2', 'H3', 'H4', 'H5', 'H6', 'LI', 'UL', 'OL', 'TD', 'TH', 'TR', 'TABLE', 'TBODY', 'THEAD', 'TFOOT', 'COLGROUP', 'COL', 'DIV', 'BLOCKQUOTE', 'PRE', 'SECTION', 'ARTICLE', 'HEADER', 'FOOTER', 'MAIN', 'ASIDE', 'NAV', 'FIGURE', 'DL', 'DT', 'DD', 'BODY', 'CENTER'])
const FONT_TAG_SIZES = [null, 8, 10, 12, 14, 18, 24, 36]

// Word, Google Docs, LibreOffice and browser quirks, made plain HTML. True
// when something with no place in a document (Word's drawings) was left out.
function foreign (body) {
  const doc = body.ownerDocument
  let dropped = false
  const walker = doc.createTreeWalker(body, 128) // comments
  const comments = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) comments.push(n)
  for (const c of comments) c.remove()
  const libre = !!body.querySelector('meta[name="generator" i][content^="LibreOffice" i]')
  for (const el of [...body.querySelectorAll(QUIET)]) el.remove()
  // Office's own tags: o:p (an empty paragraph's filler), v: drawings, the rest
  // unwrapped.
  for (const el of [...body.querySelectorAll('*')]) {
    const tag = el.tagName.toLowerCase()
    if (!tag.includes(':') || !el.isConnected) continue
    if (tag.startsWith('v:')) { dropped = true; el.remove() } else if (tag === 'o:p') el.remove()
    else unwrap(el)
  }
  // Google Docs wraps a copy in <b style="font-weight:normal" id="docs-internal-guid-...">.
  const google = [...body.querySelectorAll('b[id^="docs-internal-guid"]')]
  for (const b of google) unwrap(b)
  if (google.length) googleDocs(body)
  wordLists(body)
  // A list straight inside a list (Google Docs, some web pages) belongs to the
  // item before it.
  for (const list of [...body.querySelectorAll('ul > ul, ul > ol, ol > ul, ol > ol')]) {
    const prev = list.previousElementSibling
    if (prev && prev.tagName === 'LI') prev.appendChild(list)
    else {
      const li = doc.createElement('li')
      list.before(li)
      li.appendChild(list)
    }
  }
  // LibreOffice's <font>, and align= on blocks.
  for (const f of [...body.querySelectorAll('font')]) {
    const css = []
    if (f.getAttribute('color')) css.push('color:' + f.getAttribute('color'))
    if (f.getAttribute('face')) css.push('font-family:' + f.getAttribute('face'))
    const n = parseInt(f.getAttribute('size'), 10)
    if (n >= 1 && n <= 7) css.push('font-size:' + FONT_TAG_SIZES[n] + 'pt')
    if (f.getAttribute('style')) css.push(f.getAttribute('style'))
    const span = doc.createElement('span')
    if (css.length) span.setAttribute('style', css.join(';'))
    while (f.firstChild) span.appendChild(f.firstChild)
    f.replaceWith(span)
  }
  for (const el of [...body.querySelectorAll('[align]')]) {
    if (/^(P|H[1-6]|DIV|TD|TH)$/.test(el.tagName)) el.setAttribute('style', 'text-align:' + el.getAttribute('align').toLowerCase() + ';' + (el.getAttribute('style') || ''))
    el.removeAttribute('align')
  }
  if (libre) libreOffice(body)
  return dropped
}

// LibreOffice writes Title and Subtitle as centred paragraphs in their
// default sizes, 28pt bold and 18pt, with the style's font.
function libreOffice (body) {
  for (const p of [...body.querySelectorAll('p')]) {
    if (p.closest('li, td, th') || p.hasAttribute('data-style') || p.style.textAlign !== 'center') continue
    const spans = [...p.querySelectorAll('span')].filter((s) => s.textContent.trim() && !s.querySelector('span'))
    const inSpans = spans.map((s) => s.textContent).join('').replace(/\s/g, '')
    if (!spans.length || inSpans !== p.textContent.replace(/\s/g, '')) continue
    const sizes = new Set(spans.map((s) => parseStyle(s.getAttribute('style')).get('font-size')))
    const style = sizes.size !== 1 ? null : sizes.has('28pt') ? 'title' : sizes.has('18pt') ? 'subtitle' : null
    if (!style) continue
    p.setAttribute('data-style', style)
    for (const s of p.querySelectorAll('span')) { s.style.removeProperty('font-size'); s.style.removeProperty('font-family') }
    if (style === 'title') for (const b of [...p.querySelectorAll('b, strong')]) unwrap(b)
  }
}

// Google Docs: empty lines come as <br> between paragraphs, Title and
// Subtitle only as their default sizes, checklists as role=checkbox.
function googleDocs (body) {
  const doc = body.ownerDocument
  for (const br of [...body.children].filter((x) => x.tagName === 'BR')) br.replaceWith(doc.createElement('p'))
  for (const p of [...body.querySelectorAll('p')]) {
    if (p.closest('li, td, th')) continue
    const spans = [...p.querySelectorAll('span')].filter((s) => s.textContent.trim() && !s.querySelector('span'))
    if (!spans.length) continue
    const styles = spans.map((s) => parseStyle(s.getAttribute('style')))
    const all = (fn) => styles.every(fn)
    if (all((st) => st.get('font-size') === '26pt')) p.setAttribute('data-style', 'title')
    else if (all((st) => st.get('font-size') === '15pt' && /^#666(666)?$/i.test(st.get('color') || ''))) {
      p.setAttribute('data-style', 'subtitle')
      for (const s of spans) s.style.removeProperty('color') // the style's grey
    }
  }
  for (const li of [...body.querySelectorAll('li[role="checkbox"]')]) {
    li.parentElement.setAttribute('data-type', 'taskList')
    li.setAttribute('data-type', 'taskItem')
    li.setAttribute('data-checked', li.getAttribute('aria-checked') === 'true' ? 'true' : 'false')
  }
}

// Word's lists are paragraphs with mso-list:l1 level2 in their style and the
// bullet or number typed in a span marked mso-list:Ignore. Paragraphs in a
// row become one list, nested by level.
function wordLists (body) {
  const doc = body.ownerDocument
  const re = /mso-list:\s*l(\d+)\s+level(\d+)/i
  const runs = []
  for (const p of [...body.querySelectorAll('p[style]')]) {
    if (!re.test(p.getAttribute('style'))) continue
    const last = runs[runs.length - 1]
    if (last && last[last.length - 1].nextElementSibling === p) last.push(p)
    else runs.push([p])
  }
  for (const run of runs) {
    const stack = [] // { list, level, ordered }
    let anchor = null // the last list at the top
    for (const p of run) {
      const level = Number(re.exec(p.getAttribute('style'))[2])
      const ignore = [...p.querySelectorAll('span[style]')].filter((s) => /mso-list:\s*ignore/i.test(s.getAttribute('style')))
      const marker = ignore.map((s) => s.textContent).join('').replace(/[\s\u00a0]+/g, '')
      for (const s of ignore) if (s.isConnected) s.remove()
      const ordered = /^\(?([0-9]+|[a-z]{1,3})[.)]$/i.test(marker)
      while (stack.length && stack[stack.length - 1].level > level) stack.pop()
      let top = stack[stack.length - 1]
      if (top && top.level === level && top.ordered !== ordered) { stack.pop(); top = stack[stack.length - 1] }
      if (!top || top.level < level) {
        const list = doc.createElement(ordered ? 'ol' : 'ul')
        const start = /^\(?(\d+)/.exec(marker)
        if (ordered && start && Number(start[1]) > 1) list.setAttribute('start', start[1])
        if (top) top.list.lastElementChild.appendChild(list)
        else {
          if (anchor) anchor.after(list)
          else p.before(list)
          anchor = list
        }
        top = { list, level, ordered }
        stack.push(top)
      }
      const li = doc.createElement('li')
      top.list.appendChild(li)
      p.removeAttribute('class')
      li.appendChild(p)
    }
  }
}

// An inline style as a Map of property to value, read from the attribute so
// properties a browser would drop (mso-*) are kept.
function parseStyle (text) {
  const out = new Map()
  for (const part of String(text || '').split(';')) {
    const i = part.indexOf(':')
    if (i < 0) continue
    out.set(part.slice(0, i).trim().toLowerCase(), part.slice(i + 1).replace(/!important/i, '').trim())
  }
  return out
}

const CSS_NAMES = { black: '#000000', white: '#ffffff', red: '#ff0000', green: '#008000', blue: '#0000ff', yellow: '#ffff00', cyan: '#00ffff', aqua: '#00ffff', magenta: '#ff00ff', fuchsia: '#ff00ff', gray: '#808080', grey: '#808080', silver: '#c0c0c0', lightgray: '#d3d3d3', lightgrey: '#d3d3d3', orange: '#ffa500', purple: '#800080', navy: '#000080', maroon: '#800000', teal: '#008080', olive: '#808000', lime: '#00ff00' }

// A colour as #rrggbb, or null for none (transparent, inherited, unreadable).
function cssHex (v) {
  const s = String(v || '').trim().toLowerCase()
  if (!s || /^(transparent|inherit|initial|unset|none|auto|currentcolor|windowtext)$/.test(s)) return null
  const a = /^rgba\(([^)]*)\)/.exec(s)
  if (a && Number(a[1].split(/[\s,/]+/).filter(Boolean)[3]) === 0) return null
  const hex = hexColour(CSS_NAMES[s] || s)
  return hex ? '#' + hex.toLowerCase() : null
}

const channels = (hex) => [1, 3, 5].map((i) => parseInt(hex.slice(i, i + 2), 16))
// Text colour worth keeping: not black and, from the clipboard, not nearly
// black or nearly white (a web page's body text).
function keepColour (hex, paste) {
  if (!hex || hex === '#000000') return false
  if (!paste) return true
  const c = channels(hex)
  const max = Math.max(...c)
  const min = Math.min(...c)
  return !((max < 80 && max - min < 24) || min > 230)
}

// A background colour as one of the editor's highlights, or null.
function highlightOf (v) {
  const m = /#[0-9a-f]{3,6}\b|rgba?\([^)]*\)|\b[a-z]+\b/i.exec(String(v || ''))
  const hex = m && cssHex(m[0])
  if (!hex || Math.min(...channels(hex)) > 240) return null
  return WORD_HIGHLIGHTS[nearestHighlight(hex)] || null
}

function ptSize (v) {
  const m = /^([\d.]+)(pt|px)$/i.exec(String(v || '').trim())
  if (!m) return null
  return nearestSize(m[2].toLowerCase() === 'px' ? Number(m[1]) * 0.75 : Number(m[1]))
}

function lineHeight (v) {
  const m = /^([\d.]+)(%)?$/.exec(String(v || '').trim())
  if (!m) return null
  const n = Number(m[1]) / (m[2] ? 100 : 1)
  const hit = LINE_HEIGHTS.find((x) => Math.abs(Number(x) - n) < 0.03)
  return hit && hit !== '1.15' ? hit : null
}

// Keep only the inline styles the editor reads, in its terms: alignment,
// spacing and indent on blocks; colour, size, font, bold, italic, underline,
// strike, raised and lowered text and highlight on text. Text from the
// clipboard keeps no size near the body's and no near-black colour.
function cleanStyles (body, paste) {
  const doc = body.ownerDocument
  for (const el of [...body.querySelectorAll('[style]')]) {
    const st = parseStyle(el.getAttribute('style'))
    const out = []
    if (BLOCK_TAGS.has(el.tagName)) {
      const align = { start: 'left', end: 'right' }[st.get('text-align')] || st.get('text-align')
      if (/^(left|center|right|justify)$/.test(align || '')) out.push('text-align:' + align)
      const lh = lineHeight(st.get('line-height'))
      if (lh) out.push('line-height:' + lh)
      const ml = /^([\d.]+)(pt|px|in|cm)$/.exec(st.get('margin-left') || '')
      if (ml && /^(P|H[1-3])$/.test(el.tagName) && !el.closest('li, td, th') && !el.hasAttribute('data-indent')) {
        const pt = Number(ml[1]) * { pt: 1, px: 0.75, in: 72, cm: 28.35 }[ml[2]]
        const steps = Math.min(MAX_INDENT, Math.round(pt / 36))
        if (steps > 0) el.setAttribute('data-indent', String(steps))
      }
    } else {
      const heading = !!el.closest('h1, h2, h3, h4, h5, h6, p[data-style]')
      const link = !!el.closest('a')
      const colour = cssHex(st.get('color'))
      if (!link && keepColour(colour, paste)) out.push('color:' + colour)
      const size = ptSize(st.get('font-size'))
      if (size && !heading && size !== 11 && !(paste && size >= 10 && size <= 12)) out.push('font-size:' + size + 'pt')
      const family = fontFamily(st.get('font-family'))
      if (family) out.push('font-family:' + family)
      if (st.get('font-weight') && !heading) out.push('font-weight:' + st.get('font-weight'))
      if (/^(italic|oblique|normal)$/.test(st.get('font-style') || '')) out.push('font-style:' + st.get('font-style'))
      const deco = (st.get('text-decoration') || st.get('text-decoration-line') || '').split(/\s+/).filter((x) => x === 'line-through' || (x === 'underline' && !link))
      if (deco.length) out.push('text-decoration:' + deco.join(' '))
      if (/^(super|sub)$/.test(st.get('vertical-align') || '')) out.push('vertical-align:' + st.get('vertical-align'))
      const mark = highlightOf(st.get('background-color') || st.get('background') || st.get('mso-highlight'))
      if (mark && !el.closest('mark')) {
        const m = doc.createElement('mark')
        m.setAttribute('data-color', mark)
        while (el.firstChild) m.appendChild(el.firstChild)
        el.appendChild(m)
      }
    }
    if (out.length) el.setAttribute('style', out.join(';'))
    else el.removeAttribute('style')
  }
}

// --- .docx formatting --------------------------------------------------------

// mammoth leaves out colour, size, font, highlight and alignment. They are
// carried through its HTML as markers in the text: \uE000 n \uE001 text \uE002
// for a run with styles[n], \uE003 n \uE001 at a paragraph's start for its
// alignment. tidy turns them into spans, marks and text-align.

// Word's highlight colours to the editor's highlight palette.
const WORD_HIGHLIGHTS = {
  yellow: '#fef08a',
  darkYellow: '#fed7aa',
  red: '#fecaca',
  darkRed: '#fecaca',
  green: '#bbf7d0',
  darkGreen: '#bbf7d0',
  cyan: '#a5f3fc',
  darkCyan: '#a5f3fc',
  blue: '#bfdbfe',
  darkBlue: '#bfdbfe',
  magenta: '#ddd6fe',
  darkMagenta: '#ddd6fe',
  lightGray: '#e5e7eb',
  darkGray: '#e5e7eb'
}
const WORD_ALIGN = { center: 'center', right: 'right', end: 'right', both: 'justify', distribute: 'justify' }

export function fontFamily (name) {
  const f = String(name || '').toLowerCase()
  if (/mono|courier|consolas|menlo|monaco|lucida console|source code/.test(f)) return 'monospace'
  if (/times|georgia|cambria|garamond|palatino|book antiqua|baskerville|bodoni|didot|century|constantia|serif/.test(f) && !/sans/.test(f)) return 'serif'
  return null
}

export function nearestSize (pt) {
  const n = Number(pt)
  if (!n) return null
  return SIZES.reduce((best, x) => (Math.abs(x - n) < Math.abs(best - n) ? x : best))
}

const wordHex = (v) => (/^[0-9a-f]{6}$/i.test(v || '') ? '#' + v.toLowerCase() : null)

// Colour (w:color) and shading (w:shd) of each run, which mammoth does not
// read: per paragraph of word/document.xml, in order, the runs that have text.
// By qualified name: Word, LibreOffice and Google Docs all write the w prefix.
async function runColours (buf) {
  const zip = await JSZip.loadAsync(buf)
  const file = zip.file('word/document.xml')
  if (!file) return []
  const xml = new window.DOMParser().parseFromString(await file.async('string'), 'application/xml')
  const kids = (el, name) => [...el.childNodes].filter((c) => c.nodeName === name)
  const closest = (el, name) => {
    for (let x = el.parentNode; x; x = x.parentNode) if (x.nodeName === name) return x
    return null
  }
  const out = []
  for (const p of [...xml.getElementsByTagName('w:p')]) {
    const runs = []
    for (const r of [...p.getElementsByTagName('w:r')]) {
      if (closest(r, 'w:p') !== p) continue
      const text = kids(r, 'w:t').map((t) => t.textContent).join('')
      if (!text) continue
      const rPr = kids(r, 'w:rPr')[0]
      const color = rPr && kids(rPr, 'w:color')[0]
      const shd = rPr && kids(rPr, 'w:shd')[0]
      runs.push({ text, color: color ? wordHex(color.getAttribute('w:val')) : null, shade: shd ? wordHex(shd.getAttribute('w:fill')) : null })
    }
    out.push(runs)
  }
  return out
}

const runText = (run) => run.children.filter((c) => c.type === 'text').map((c) => c.value).join('')

// mammoth's transformDocument: put the markers in. Colours are matched to a
// paragraph's runs by their text; a paragraph whose runs do not line up keeps
// the rest of its formatting and loses only its colours.
function markFormatting (colours, styles) {
  return (document) => {
    let next = 0
    const paragraphs = []
    const walk = (el) => {
      if (el.type === 'paragraph') paragraphs.push(el)
      else for (const c of el.children || []) walk(c)
    }
    walk(document)
    for (const p of paragraphs) {
      const runs = []
      const collect = (el) => { for (const c of el.children || []) { if (c.type === 'run') { if (runText(c)) runs.push(c) } else if (c.type !== 'paragraph') collect(c) } }
      collect(p)
      let found = null
      if (runs.length) {
        const sig = runs.map(runText).join('\u0001')
        for (let j = next; j < Math.min(colours.length, next + 50); j++) {
          if (colours[j].map((r) => r.text).join('\u0001') === sig) { found = colours[j]; next = j + 1; break }
        }
      }
      runs.forEach((run, i) => {
        const c = found ? found[i] : {}
        const css = []
        if (c.color && c.color !== '#000000') css.push('color:' + c.color)
        if (run.fontSize && nearestSize(run.fontSize) !== 11) css.push('font-size:' + nearestSize(run.fontSize) + 'pt')
        const family = fontFamily(run.font)
        if (family) css.push('font-family:' + family)
        const mark = (run.highlight && WORD_HIGHLIGHTS[run.highlight]) || c.shade
        if (!css.length && !mark) return
        const n = styles.push({ css: css.join(';'), mark }) - 1
        for (const t of run.children) if (t.type === 'text') t.value = '\uE000' + n + '\uE001' + t.value + '\uE002'
      })
      const align = WORD_ALIGN[p.alignment]
      const first = align && firstText(p)
      if (first) first.value = '\uE003' + (styles.push({ align }) - 1) + '\uE001' + first.value
    }
    return document
  }
}

function firstText (el) {
  for (const c of el.children || []) {
    if (c.type === 'text' && c.value) return c
    const t = firstText(c)
    if (t) return t
  }
  return null
}

const MARKER = /\uE003(\d+)\uE001|\uE000(\d+)\uE001([^\uE000-\uE003]*)\uE002|[\uE000-\uE003]/g

function applyStyles (body, styles) {
  const doc = body.ownerDocument
  const walker = doc.createTreeWalker(body, 4)
  const nodes = []
  for (let n = walker.nextNode(); n; n = walker.nextNode()) if (/[\uE000-\uE003]/.test(n.textContent)) nodes.push(n)
  for (const node of nodes) {
    const text = node.textContent
    const frag = doc.createDocumentFragment()
    let at = 0
    let m
    MARKER.lastIndex = 0
    while ((m = MARKER.exec(text))) {
      if (m.index > at) frag.appendChild(doc.createTextNode(text.slice(at, m.index)))
      at = MARKER.lastIndex
      const st = styles[m[1] || m[2]]
      if (m[1] && st && st.align) {
        const block = node.parentElement && node.parentElement.closest('p, h1, h2, h3, h4, h5, h6')
        if (block) block.style.textAlign = st.align
      } else if (m[2] && st) {
        let el = doc.createTextNode(m[3])
        if (st.css) {
          const span = doc.createElement('span')
          span.setAttribute('style', st.css)
          span.appendChild(el)
          el = span
        }
        if (st.mark) {
          const mark = doc.createElement('mark')
          mark.setAttribute('data-color', st.mark)
          mark.appendChild(el)
          el = mark
        }
        frag.appendChild(el)
      } else if (m[2]) frag.appendChild(doc.createTextNode(m[3]))
    }
    if (at < text.length) frag.appendChild(doc.createTextNode(text.slice(at)))
    node.replaceWith(frag)
  }
}

// Remove the first n characters of an element's text, wherever they sit.
function stripPrefix (el, n) {
  const walker = el.ownerDocument.createTreeWalker(el, 4)
  let node
  while (n > 0 && (node = walker.nextNode())) {
    const take = Math.min(n, node.textContent.length)
    node.textContent = node.textContent.slice(take)
    n -= take
  }
}

export function htmlToJson (html) {
  return generateJSON(html, documentExtensions())
}

// Plain text: one paragraph per line; blank lines only separate them.
export function textToJson (text) {
  const lines = String(text).replace(/^\ufeff/, '').split(/\r\n|\r|\n/).filter((l) => l.trim() !== '')
  return {
    type: 'doc',
    content: lines.length ? lines.map((l) => ({ type: 'paragraph', content: [{ type: 'text', text: l }] })) : [{ type: 'paragraph' }]
  }
}

// A file's bytes to the editor's JSON. { json, dropped, pictures }: dropped
// when some of its content had no place in a document; pictures are the ones
// it carried, [{ ref: 'pending:<n>', mime, data (base64) }], each an image
// node in the JSON.
export async function fileToJson (name, bytes) {
  const ext = (/\.([^.]+)$/.exec(String(name || '')) || [])[1].toLowerCase()
  if (ext === 'txt') return { json: textToJson(new TextDecoder().decode(bytes)), dropped: false, pictures: [] }
  let html
  let styles = null
  if (ext === 'docx') {
    await checkZip(bytes, 'This is not a Word file PearOffice can read.')
    const buf = bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength)
    // Colours are a nicety: a file whose XML we cannot read still imports.
    const colours = await runColours(buf).catch(() => [])
    styles = []
    const out = await mammoth.convertToHtml({ arrayBuffer: buf, buffer: buf }, {
      styleMap: STYLE_MAP,
      transformDocument: markFormatting(colours, styles),
      // Pictures as data: URLs, kept by tidy.
      convertImage: mammoth.images.imgElement(async (image) => ({ src: 'data:' + image.contentType + ';base64,' + await image.read('base64') }))
    })
    html = out.value
  } else if (ext === 'odt') {
    // OpenDocument (LibreOffice): turned into HTML here (odt.js), then read
    // like any other.
    await checkZip(bytes, 'This is not an OpenDocument file PearOffice can read.')
    const odt = odtToHtml(fflate.unzipSync(bytes))
    const t = tidy(odt.html, null)
    const json = htmlToJson(t.html)
    eachNode(json, (n) => { if (n.type === 'text') n.text = n.text.replace(/\u00a0/g, ' ') })
    return { json, dropped: t.dropped || odt.dropped, pictures: t.pictures }
  } else if (ext === 'md' || ext === 'markdown') {
    html = marked.parse(new TextDecoder().decode(bytes).replace(/^\ufeff/, ''), { gfm: true, async: false })
  } else {
    html = new TextDecoder().decode(bytes)
  }
  const t = tidy(html, styles)
  return { json: htmlToJson(t.html), dropped: t.dropped, pictures: t.pictures }
}

// Every node in the JSON, depth first.
function eachNode (json, fn) {
  for (const n of json.content || []) { fn(n); eachNode(n, fn) }
}

// The JSON without the nodes `drop` picks.
function without (json, drop) {
  if (!json.content) return json
  return { ...json, content: json.content.filter((n) => !drop(n)).map((n) => without(n, drop)) }
}

// The JSON as the first Yjs update of a document's body.
export function jsonToUpdate (json) {
  const doc = new Y.Doc()
  try {
    prosemirrorJSONToYXmlFragment(getSchema(documentExtensions()), json, doc.getXmlFragment(FIELD))
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

// The document's body as the editor's JSON, every attribute filled in.
export function docToJson (ydoc) {
  return yXmlFragmentToProseMirrorRootNode(ydoc.getXmlFragment(FIELD), getSchema(documentExtensions())).toJSON()
}

// Import a file as a new document. Resolves to { sheetId, dropped }.
// Each picture is shrunk as an inserted one is (`prepare`), then stored once
// the document exists; one that cannot be used is left out.
export async function importDocument (bytes, name, { prepare = (b, mime) => preparePicture(new Blob([b], { type: mime }), mime) } = {}) {
  const { json, dropped, pictures } = await fileToJson(name, bytes)
  const ready = new Map()
  let lost = false
  for (const p of pictures) {
    try { ready.set(p.ref, await prepare(fromB64(p.data), p.mime)) } catch { lost = true }
  }
  const body = without(json, (n) => n.type === 'image' && !ready.has(n.attrs && n.attrs.ref))
  eachNode(body, (n) => {
    if (n.type !== 'image') return
    const p = ready.get(n.attrs.ref)
    n.attrs = { ...n.attrs, mime: p.mime, w: p.w, h: p.h }
  })
  const title = String(name || '').replace(/\.[^.]+$/, '') || 'Imported document'
  const r = await call('doc:import', { title, update: toB64(jsonToUpdate(body)) })
  for (const [ref, p] of ready) {
    try { await call('doc:addPicture', { sheetId: r.sheetId, bytes: toB64(p.bytes), mime: p.mime, width: p.w, height: p.h, replace: ref }) } catch { lost = true }
  }
  return { ...r, dropped: dropped || lost }
}

// --- shared walking -----------------------------------------------------------

const marksOf = (n) => n.marks || []
const hasMark = (n, type) => marksOf(n).some((m) => m.type === type)
const markAttrs = (n, type) => (marksOf(n).find((m) => m.type === type) || {}).attrs || {}

function inlineText (nodes) {
  return (nodes || []).map((n) => (n.type === 'text' ? n.text : n.type === 'hardBreak' ? '\n' : inlineText(n.content))).join('')
}

// --- plain text ---------------------------------------------------------------

// Blank lines between paragraphs; list items one to a line, "- " for bullets.
export function toText (json) {
  return blocksText(json.content, '').join('\n\n').replace(/\n{3,}/g, '\n\n') + '\n'
}

function blocksText (nodes, pad) {
  const out = []
  for (const n of nodes || []) {
    if (n.type === 'paragraph' || n.type === 'heading') out.push(pad + inlineText(n.content).replace(/\n/g, '\n' + pad))
    else if (n.type === 'codeBlock') out.push(inlineText(n.content).split('\n').map((l) => pad + l).join('\n'))
    else if (n.type === 'horizontalRule') out.push(pad + '---')
    else if (n.type === 'image') out.push(pad + '[Picture' + (n.attrs && n.attrs.alt ? ': ' + n.attrs.alt : '') + ']')
    else if (n.type === 'blockquote') out.push(...blocksText(n.content, pad))
    else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
      const start = (n.attrs && n.attrs.start) || 1
      out.push((n.content || []).map((item, i) => {
        const marker = n.type === 'orderedList' ? (start + i) + '. ' : n.type === 'taskList' ? (item.attrs && item.attrs.checked ? '- [x] ' : '- [ ] ') : '- '
        const inner = blocksText(item.content, pad + '  ')
        return pad + marker + (inner[0] || '').slice(pad.length + 2) + (inner.length > 1 ? '\n' + inner.slice(1).join('\n') : '')
      }).join('\n'))
    } else if (n.type === 'table') {
      out.push((n.content || []).map((row) => pad + (row.content || []).map((cell) => blocksText(cell.content, '').join(' ')).join('\t')).join('\n'))
    }
  }
  return out
}

// --- Markdown -----------------------------------------------------------------

// GitHub-flavoured Markdown. Formatting with no Markdown form (colour, size,
// font, underline, alignment and the rest) is left out. Pictures go in the
// file as data: URLs (`pictures`: ref -> { bytes, mime }).
export function toMarkdown (json, pictures = new Map()) {
  return mdBlocks(json.content, pictures).join('\n\n').replace(/\n{3,}/g, '\n\n').trim() + '\n'
}

const dataUrl = (p) => 'data:' + p.mime + ';base64,' + toB64(p.bytes)

const MD_MARKS = [['link'], ['bold', '**'], ['italic', '_'], ['strike', '~~'], ['code', '`']]

function mdEscape (s) {
  return s.replace(/([\\`*_[\]<>~|])/g, '\\$1')
}

function mdInline (nodes, inTable) {
  let out = ''
  const open = [] // marks open now, outermost first: { type, close }
  let trail = ''
  const closeTo = (keep) => {
    while (open.length > keep) out += open.pop().close
  }
  for (const n of nodes || []) {
    if (n.type === 'hardBreak') { closeTo(0); out += trail + (inTable ? '<br>' : '\\\n'); trail = ''; continue }
    if (n.type !== 'text') continue
    const want = MD_MARKS.filter(([t]) => hasMark(n, t)).map(([t, d]) => ({ type: t, d, href: t === 'link' ? markAttrs(n, 'link').href : null }))
    // Keep the open marks that are still wanted, in order.
    let keep = 0
    while (keep < open.length && keep < want.length && open[keep].type === want[keep].type && open[keep].href === want[keep].href) keep++
    closeTo(keep)
    const text = hasMark(n, 'code') ? n.text : mdEscape(n.text)
    const lead = /^\s*/.exec(text)[0]
    const core = text.slice(lead.length).replace(/\s+$/, '')
    out += trail + lead
    trail = text.slice(lead.length + core.length)
    if (!core) { trail = text.slice(lead.length); continue }
    for (const w of want.slice(keep)) {
      if (w.type === 'link') { out += '['; open.push({ type: 'link', href: w.href, close: '](' + String(w.href || '').replace(/[()\s]/g, (c) => '%' + c.charCodeAt(0).toString(16).toUpperCase().padStart(2, '0')) + ')' }) } else { out += w.d; open.push({ type: w.type, href: null, close: w.d }) }
    }
    out += core
  }
  closeTo(0)
  out += trail
  if (inTable) out = out.replace(/\n/g, ' ')
  return out
}

function mdBlocks (nodes, pics = new Map()) {
  const out = []
  for (const n of nodes || []) {
    const a = n.attrs || {}
    if (n.type === 'heading') out.push('#'.repeat(Math.min(6, a.level || 1)) + ' ' + mdInline(n.content))
    else if (n.type === 'paragraph') {
      let text = mdInline(n.content)
      if (a.blockStyle === 'title') text = '# ' + text
      else text = text.replace(/^(#{1,6}\s|[-+]\s)/, '\\$1').replace(/^(\d+)([.)]\s)/, '$1\\$2')
      out.push(text)
    } else if (n.type === 'codeBlock') {
      const code = inlineText(n.content).replace(/\n$/, '')
      const fence = '`'.repeat(Math.max(3, ...[...code.matchAll(/`+/g)].map((x) => x[0].length + 1)))
      out.push(fence + (a.language || '') + '\n' + code + '\n' + fence)
    } else if (n.type === 'horizontalRule') out.push('---')
    else if (n.type === 'image') {
      const p = pics.get(a.ref)
      if (p) out.push('![' + mdEscape(a.alt || '').replace(/\n/g, ' ') + '](' + dataUrl(p) + ')')
    } else if (n.type === 'blockquote') out.push(mdBlocks(n.content, pics).join('\n\n').split('\n').map((l) => (l ? '> ' + l : '>')).join('\n'))
    else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
      const start = a.start || 1
      out.push((n.content || []).map((item, i) => {
        let marker = n.type === 'orderedList' ? (start + i) + '. ' : '- '
        const pad = ' '.repeat(marker.length)
        if (n.type === 'taskList') marker += item.attrs && item.attrs.checked ? '[x] ' : '[ ] '
        // A list right under the item's text stays tight; other blocks get a
        // blank line.
        const kids = (item.content || []).filter((b) => mdBlocks([b], pics).length)
        const inner = mdBlocks(kids, pics)
        const body = inner.map((b, j) => (j === 0 ? b : (/List$/.test(kids[j].type) ? '' : '\n') + b)).join('\n').split('\n').map((l, j) => (j === 0 ? l : l ? pad + l : '')).join('\n')
        return marker + body
      }).join('\n'))
    } else if (n.type === 'table') {
      const rows = (n.content || []).map((row) => (row.content || []).map((cell) => (cell.content || []).map((b) => mdInline(b.content, true).replace(/\|/g, '\\|')).join('<br>')))
      if (!rows.length) continue
      const cols = Math.max(...rows.map((r) => r.length))
      const line = (r) => '| ' + Array.from({ length: cols }, (_, i) => r[i] || '').join(' | ') + ' |'
      out.push([line(rows[0]), '|' + ' --- |'.repeat(cols), ...rows.slice(1).map(line)].join('\n'))
    }
  }
  return out.filter((b) => b !== '')
}

// --- Word ---------------------------------------------------------------------

const FONT = 'Arial'
const MONO = 'Courier New'
const BOX_FONT = 'Segoe UI Symbol'
const FONT_NAMES = { '': FONT, serif: 'Times New Roman', monospace: MONO, 'sans-serif': FONT }
const ALIGN = { left: D.AlignmentType.LEFT, center: D.AlignmentType.CENTER, right: D.AlignmentType.RIGHT, justify: D.AlignmentType.JUSTIFIED }
const HEADINGS = [null, D.HeadingLevel.HEADING_1, D.HeadingLevel.HEADING_2, D.HeadingLevel.HEADING_3, D.HeadingLevel.HEADING_4, D.HeadingLevel.HEADING_5, D.HeadingLevel.HEADING_6]
const INDENT = 440 // twips per indent step: the editor's 2em at 11pt
const LIST_INDENT = 720
const BULLETS = ['•', '◦', '▪']
const NUMBER_FORMATS = [D.LevelFormat.DECIMAL, D.LevelFormat.LOWER_LETTER, D.LevelFormat.LOWER_ROMAN]

function hexColour (c) {
  if (!c) return null
  const s = String(c).trim()
  let m = /^#([0-9a-f]{3})$/i.exec(s)
  if (m) return m[1].split('').map((x) => x + x).join('').toUpperCase()
  m = /^#([0-9a-f]{6})$/i.exec(s)
  if (m) return m[1].toUpperCase()
  m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(s)
  if (m) return [m[1], m[2], m[3]].map((x) => Math.min(255, Number(x)).toString(16).padStart(2, '0')).join('').toUpperCase()
  return null
}

// Word highlights come in a few fixed colours: the nearest by hue, grey for
// colours with little of one.
export function nearestHighlight (c) {
  const hex = hexColour(c)
  if (!hex) return 'yellow'
  const [r, g, b] = [0, 2, 4].map((i) => parseInt(hex.slice(i, i + 2), 16) / 255)
  const max = Math.max(r, g, b)
  const min = Math.min(r, g, b)
  const l = (max + min) / 2
  const sat = max === min ? 0 : (max - min) / (1 - Math.abs(2 * l - 1))
  if (sat < 0.2) return l < 0.5 ? 'darkGray' : 'lightGray'
  let h = max === r ? ((g - b) / (max - min)) % 6 : max === g ? (b - r) / (max - min) + 2 : (r - g) / (max - min) + 4
  h = (h * 60 + 360) % 360
  const hues = [[0, 'red'], [60, 'yellow'], [120, 'green'], [180, 'cyan'], [240, 'blue'], [300, 'magenta'], [360, 'red']]
  return hues.reduce((best, x) => (Math.abs(x[0] - h) < Math.abs(best[0] - h) ? x : best))[1]
}

function fontSize (v) {
  const n = parseFloat(v)
  if (!n) return undefined
  return Math.round((/px$/.test(String(v)) ? n * 0.75 : n) * 2)
}

function fontName (v) {
  if (v == null) return undefined
  const first = String(v).split(',')[0].trim().replace(/^["']|["']$/g, '')
  return FONT_NAMES[first] || first || undefined
}

function textRun (n, base) {
  const o = { ...base, text: n.text }
  for (const m of marksOf(n)) {
    const a = m.attrs || {}
    if (m.type === 'bold') o.bold = true
    else if (m.type === 'italic') o.italics = true
    else if (m.type === 'underline') o.underline = {}
    else if (m.type === 'strike') o.strike = true
    else if (m.type === 'subscript') o.subScript = true
    else if (m.type === 'superscript') o.superScript = true
    else if (m.type === 'code') o.font = MONO
    else if (m.type === 'link') o.style = 'Hyperlink'
    else if (m.type === 'highlight') o.highlight = nearestHighlight(a.color || '#fef08a')
    else if (m.type === 'textStyle') {
      if (hexColour(a.color)) o.color = hexColour(a.color)
      if (fontSize(a.fontSize)) o.size = fontSize(a.fontSize)
      if (fontName(a.fontFamily)) o.font = fontName(a.fontFamily)
    }
  }
  return new D.TextRun(o)
}

// A block's text: runs, with links as Word hyperlinks.
function runs (nodes, base = {}) {
  const out = []
  let link = null
  for (const n of nodes || []) {
    const href = n.type === 'text' && hasMark(n, 'link') ? markAttrs(n, 'link').href : null
    const run = n.type === 'hardBreak' ? new D.TextRun({ ...base, break: 1 }) : n.type === 'text' ? textRun(n, base) : null
    if (!run) continue
    if (href) {
      if (!link || link.href !== href) { link = { href, children: [] }; out.push(link) }
      link.children.push(run)
    } else {
      link = null
      out.push(run)
    }
  }
  return out.map((x) => (x.href ? new D.ExternalHyperlink({ link: x.href, children: x.children }) : x))
}

function paragraph (n, ctx, extra = {}) {
  const a = n.attrs || {}
  const opts = { children: runs(n.content, ctx.run), ...extra }
  if (n.type === 'heading') opts.heading = HEADINGS[Math.max(1, Math.min(6, a.level || 1))]
  else if (a.blockStyle === 'title') opts.heading = D.HeadingLevel.TITLE
  else if (a.blockStyle === 'subtitle') opts.style = 'Subtitle'
  else if (ctx.quote) opts.style = 'Quote'
  if (ALIGN[a.textAlign]) opts.alignment = ALIGN[a.textAlign]
  const left = (a.indent > 0 ? a.indent * INDENT : 0) + (extra.numbering ? 0 : ctx.indent || 0)
  if (left && !extra.numbering) opts.indent = { left }
  const spacing = {}
  if (a.lineHeight) spacing.line = Math.round(240 * Number(a.lineHeight))
  if (a.spaceAfter === 'none' || ctx.tight) spacing.after = 0
  if (Object.keys(spacing).length) opts.spacing = spacing
  return new D.Paragraph(opts)
}

// Word's page is 6.27 inches wide inside the margins: 602 pixels at 96 dpi.
const PAGE_PX = 602
const WORD_TYPES = { 'image/jpeg': 'jpg', 'image/png': 'png', 'image/gif': 'gif', 'image/bmp': 'bmp' }

function picture (n, ctx) {
  const a = n.attrs || {}
  const p = ctx.pictures && ctx.pictures.get(a.ref)
  if (!p || !WORD_TYPES[p.mime] || !a.w || !a.h) return null
  const width = Math.round(a.width ? PAGE_PX * a.width / 100 : Math.min(a.w, PAGE_PX))
  return new D.Paragraph({
    alignment: ALIGN[a.align] || D.AlignmentType.CENTER,
    children: [new D.ImageRun({ type: WORD_TYPES[p.mime], data: p.bytes, transformation: { width, height: Math.round(width * a.h / a.w) }, altText: { name: 'Picture', description: a.alt || '', title: a.alt || '' } })]
  })
}

function docxBlocks (nodes, ctx, out = []) {
  for (const n of nodes || []) {
    if (n.type === 'paragraph' || n.type === 'heading') out.push(paragraph(n, ctx))
    else if (n.type === 'image') out.push(...[picture(n, ctx)].filter(Boolean))
    else if (n.type === 'blockquote') docxBlocks(n.content, { ...ctx, quote: true }, out)
    else if (n.type === 'codeBlock') {
      for (const line of inlineText(n.content).split('\n')) {
        out.push(new D.Paragraph({
          style: 'Code',
          indent: ctx.indent ? { left: ctx.indent } : undefined,
          children: [new D.TextRun({ text: line })]
        }))
      }
    } else if (n.type === 'horizontalRule') {
      out.push(new D.Paragraph({ children: [], border: { bottom: { style: D.BorderStyle.SINGLE, size: 6, color: 'A0A0A0', space: 1 } } }))
    } else if (n.type === 'bulletList' || n.type === 'orderedList' || n.type === 'taskList') {
      const level = (ctx.level === undefined ? -1 : ctx.level) + 1
      const reference = n.type === 'orderedList' ? 'numbers' : 'bullets'
      // Each numbered list counts from 1 (or its start); a list inside one
      // of the same kind carries on its numbering.
      const instance = ctx.list && ctx.list.reference === reference ? ctx.list.instance : ++ctx.counter.n
      for (const item of n.content || []) {
        const inner = { ...ctx, level, list: n.type === 'taskList' ? null : { reference, instance }, indent: LIST_INDENT * (level + 1), tight: true }
        const [first, ...rest] = item.content || []
        if (first && first.type === 'paragraph') {
          if (n.type === 'taskList') {
            // Arial has no box glyphs: Word finds them in Segoe UI Symbol,
            // LibreOffice falls back to a symbol font. ☒, as LibreOffice
            // draws ☑ with an emoji font that leaves a PDF blank.
            const box = { type: 'text', text: item.attrs && item.attrs.checked ? '☒' : '☐', marks: [{ type: 'textStyle', attrs: { fontFamily: BOX_FONT } }] }
            const gap = { type: 'text', text: ' ' }
            out.push(paragraph({ ...first, content: [box, gap, ...(first.content || [])] }, { ...inner, indent: LIST_INDENT * level }))
          } else {
            out.push(paragraph(first, inner, { numbering: { reference, level: Math.min(level, 8), instance } }))
          }
          docxBlocks(rest, inner, out)
        } else docxBlocks(item.content, inner, out)
      }
    } else if (n.type === 'table') {
      const rows = (n.content || []).map((row) => {
        const cells = row.content || []
        return new D.TableRow({
          tableHeader: cells.length > 0 && cells.every((c) => c.type === 'tableHeader'),
          children: cells.map((cell) => {
            const ca = cell.attrs || {}
            const children = docxBlocks(cell.content, { counter: ctx.counter, run: ctx.run, pictures: ctx.pictures, tight: true })
            return new D.TableCell({
              children: children.length ? children : [new D.Paragraph({ children: [] })],
              columnSpan: ca.colspan > 1 ? ca.colspan : undefined,
              rowSpan: ca.rowspan > 1 ? ca.rowspan : undefined,
              shading: cell.type === 'tableHeader' ? { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F1F3F1' } : undefined,
              margins: { top: 60, bottom: 60, left: 100, right: 100 }
            })
          })
        })
      })
      if (rows.length) out.push(new D.Table({ rows, width: { size: 100, type: D.WidthType.PERCENTAGE } }))
      out.push(new D.Paragraph({ children: [], spacing: { after: 0 } }))
    }
  }
  return out
}

function levels (kind) {
  return Array.from({ length: 9 }, (_, l) => ({
    level: l,
    format: kind === 'bullets' ? D.LevelFormat.BULLET : NUMBER_FORMATS[l % 3],
    text: kind === 'bullets' ? BULLETS[l % 3] : '%' + (l + 1) + '.',
    alignment: D.AlignmentType.LEFT,
    style: { paragraph: { indent: { left: LIST_INDENT * (l + 1), hanging: 360 } } }
  }))
}

// The document as .docx bytes. `pictures`: ref -> { bytes, mime }, in a type
// Word reads (wordPicture).
export async function toDocx (json, title = '', pictures = new Map()) {
  const counter = { n: 0 }
  const children = docxBlocks(json.content, { counter, run: {}, pictures })
  const heading = (size, extra = {}) => ({ run: { size, bold: true, font: FONT, color: '1F2420', ...extra }, paragraph: { spacing: { before: 360, after: 120 } } })
  const doc = new D.Document({
    title,
    creator: 'PearOffice',
    styles: {
      default: {
        document: { run: { font: FONT, size: 22 }, paragraph: { spacing: { after: 160, line: 276 } } },
        title: { run: { size: 52, font: FONT, color: '1F2420' }, paragraph: { spacing: { after: 60 } } },
        heading1: heading(40),
        heading2: heading(32),
        heading3: heading(28, { color: '5F6B62' }),
        hyperlink: { run: { color: '3B6E22', underline: { type: D.UnderlineType.SINGLE } } }
      },
      paragraphStyles: [
        { id: 'Subtitle', name: 'Subtitle', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { size: 30, color: '5F6B62' }, paragraph: { spacing: { after: 320 } } },
        { id: 'Quote', name: 'Quote', basedOn: 'Normal', next: 'Normal', quickFormat: true, run: { color: '5F6B62' }, paragraph: { indent: { left: 720 }, border: { left: { style: D.BorderStyle.SINGLE, size: 18, color: 'C9CFC9', space: 8 } } } },
        { id: 'Code', name: 'Code', basedOn: 'Normal', next: 'Normal', run: { font: MONO, size: 20 }, paragraph: { spacing: { after: 0, line: 240 }, shading: { type: D.ShadingType.CLEAR, color: 'auto', fill: 'F4F5F3' } } }
      ]
    },
    numbering: { config: [{ reference: 'bullets', levels: levels('bullets') }, { reference: 'numbers', levels: levels('numbers') }] },
    sections: [{
      properties: { page: { size: { width: 11906, height: 16838 }, margin: { top: 1440, bottom: 1440, left: 1440, right: 1440 } } },
      children: children.length ? children : [new D.Paragraph({ children: [] })]
    }]
  })
  return new Uint8Array(await D.Packer.toArrayBuffer(doc))
}

// --- printable page (PDF) -----------------------------------------------------

const PRINT_CSS = [
  '@page{size:A4;margin:20mm}',
  'body{margin:0;font-family:system-ui,-apple-system,"Segoe UI",Roboto,"Helvetica Neue",Arial,sans-serif;font-size:11pt;line-height:1.15;color:#1f2420;overflow-wrap:break-word}',
  'p{margin:0 0 8pt}[data-space-after=none]{margin-bottom:0}',
  'h1{font-size:20pt;font-weight:600;margin:20pt 0 6pt}h2{font-size:16pt;font-weight:600;margin:18pt 0 6pt}h3{font-size:14pt;font-weight:600;margin:16pt 0 4pt;color:#5f6b62}',
  'h1,h2,h3{break-after:avoid;page-break-after:avoid}body>:first-child{margin-top:0}',
  'p[data-style=title]{font-size:26pt;margin-bottom:3pt}p[data-style=subtitle]{font-size:15pt;color:#5f6b62;margin-bottom:16pt}',
  'ul,ol{padding-left:1.6em;margin:0 0 8pt}li>p{margin:0 0 2pt}',
  'ul[data-type=taskList]{list-style:none;padding-left:.2em}ul[data-type=taskList] li{display:flex;align-items:flex-start;gap:8px}',
  'ul[data-type=taskList] li>label{flex:none;margin-top:2px}ul[data-type=taskList] li>div{flex:1;min-width:0}',
  'blockquote{margin:0 0 8pt;padding-left:14px;border-left:3px solid #c9cfc9;color:#5f6b62}',
  'pre{background:#f4f5f3;border:1px solid #e1e5e1;border-radius:6px;padding:10px 12px;margin:0 0 8pt;font-size:10pt;white-space:pre-wrap}',
  'code{font-family:ui-monospace,"SF Mono",Menlo,Consolas,monospace}:not(pre)>code{background:#f4f5f3;border-radius:3px;padding:1px 3px;font-size:.92em}',
  'hr{border:0;border-top:1px solid #c9cfc9;margin:14pt 0}a{color:#3b6e22}mark{border-radius:2px;padding:0 1px;color:inherit}',
  'table{border-collapse:collapse;width:100%;margin:0 0 8pt;table-layout:fixed}td,th{border:1px solid #c9cfc9;padding:4px 8px;vertical-align:top}',
  'th{background:#f1f3f1;font-weight:600;text-align:left}td>p,th>p{margin:0}tr{break-inside:avoid;page-break-inside:avoid}',
  'img.doc-picture{display:block;max-width:100%;height:auto;margin:0 auto 8pt;break-inside:avoid}img.doc-picture[data-align=left]{margin-left:0}img.doc-picture[data-align=right]{margin-right:0}'
].join('')

// The printable page, each picture in it as a data: URL.
export function toHtml (json, title = '', pictures = new Map()) {
  let body = generateHTML(json, documentExtensions())
  if (/<img/.test(body)) {
    const doc = new window.DOMParser().parseFromString('<body>' + body + '</body>', 'text/html')
    for (const img of [...doc.body.querySelectorAll('img.doc-picture')]) {
      const p = pictures.get(img.getAttribute('data-ref'))
      if (!p) { img.remove(); continue }
      img.setAttribute('src', dataUrl(p))
      const pct = Number(img.getAttribute('data-width'))
      const w = Number(img.getAttribute('data-w'))
      img.setAttribute('style', pct ? 'width:' + pct + '%' : w ? 'width:' + w + 'px' : '')
    }
    body = doc.body.innerHTML
  }
  return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + PRINT_CSS + '</style></head><body>' + body + '</body></html>'
}

// --- saving -------------------------------------------------------------------

// The pictures in the JSON, fetched: ref -> { bytes, mime }. One that cannot
// be fetched is left out of the export.
export async function picturesOf (json, fetchPicture) {
  const out = new Map()
  const nodes = []
  eachNode(json, (n) => { if (n.type === 'image' && n.attrs && n.attrs.ref) nodes.push(n.attrs) })
  for (const a of nodes) {
    if (out.has(a.ref)) continue
    try { out.set(a.ref, { bytes: await fetchPicture(a), mime: a.mime }) } catch {}
  }
  return out
}

// Save the document as 'docx', 'odt', 'md', 'txt', 'pdf' or 'print' (print
// on desktop only, as for sheets).
export async function exportDocument (ydoc, title, format, sheetId) {
  const json = docToJson(ydoc)
  const name = fileName(title || 'Untitled document')
  if (format === 'txt') return saveFile(name + '.txt', 'text/plain', toText(json))
  if (format === 'print' && isMobile()) throw new Error('Printing is not available on phones.')
  const pictures = await picturesOf(json, async (a) => fromB64((await call('doc:picture', { sheetId, ref: a.ref, hash: a.hash })).data))
  if (format === 'docx') {
    for (const [ref, p] of pictures) pictures.set(ref, await wordPicture(p.bytes, p.mime).catch(() => p))
    return saveFile(name + '.docx', DOCX, await toDocx(json, title, pictures))
  }
  if (format === 'odt') return saveFile(name + '.odt', 'application/vnd.oasis.opendocument.text', toOdt(json, title, pictures))
  if (format === 'md') return saveFile(name + '.md', 'text/markdown', toMarkdown(json, pictures))
  return call(format === 'print' ? 'app:print' : 'app:savePdf', { html: toHtml(json, title, pictures), name: name + '.pdf' })
}
