// Documents in OpenDocument text (.odt), for LibreOffice and OpenOffice.
//
// Saving writes the file straight from the editor's JSON, as toDocx does:
// headings, Title and Subtitle, quotes, code, lists, checklists (as ☐ and ☒
// paragraphs, as in .docx), tables, pictures, links and every mark the editor
// has. Opening turns the file into HTML that tidy (docFiles.js) reads like
// any other, so the same rules decide what is kept.

import * as fflate from 'fflate'
import { okLink } from '../../shared/links.js'

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;')
const FONT = 'Arial'
const MONO = 'Courier New'
const SERIF = 'Times New Roman'
const BOX_FONT = 'Segoe UI Symbol'
const PAGE_CM = 17 // A4 inside 2cm margins
const PX_CM = 2.54 / 96
const cm = (n) => (Math.round(n * 1000) / 1000) + 'cm'
const EXT = { 'image/png': 'png', 'image/jpeg': 'jpg', 'image/gif': 'gif', 'image/webp': 'webp', 'image/bmp': 'bmp', 'image/svg+xml': 'svg' }

const NS = 'xmlns:office="urn:oasis:names:tc:opendocument:xmlns:office:1.0" xmlns:style="urn:oasis:names:tc:opendocument:xmlns:style:1.0" xmlns:text="urn:oasis:names:tc:opendocument:xmlns:text:1.0" xmlns:table="urn:oasis:names:tc:opendocument:xmlns:table:1.0" xmlns:draw="urn:oasis:names:tc:opendocument:xmlns:drawing:1.0" xmlns:fo="urn:oasis:names:tc:opendocument:xmlns:xsl-fo-compatible:1.0" xmlns:xlink="http://www.w3.org/1999/xlink" xmlns:dc="http://purl.org/dc/elements/1.1/" xmlns:meta="urn:oasis:names:tc:opendocument:xmlns:meta:1.0" xmlns:svg="urn:oasis:names:tc:opendocument:xmlns:svg-compatible:1.0" xmlns:loext="urn:org:documentfoundation:names:experimental:office:xmlns:loext:1.0"'

// --- saving -------------------------------------------------------------------

const marksOf = (n) => n.marks || []

function fontOf (v) {
  const f = String(v || '').split(',')[0].trim().replace(/^["']|["']$/g, '')
  if (!f) return null
  return { serif: SERIF, monospace: MONO, 'sans-serif': FONT }[f] || f
}

// A text node's marks -> text-properties attributes, and its link.
function runProps (n) {
  const p = []
  let href = null
  for (const m of marksOf(n)) {
    const a = m.attrs || {}
    if (m.type === 'bold') p.push('fo:font-weight="bold" style:font-weight-asian="bold" style:font-weight-complex="bold"')
    else if (m.type === 'italic') p.push('fo:font-style="italic" style:font-style-asian="italic" style:font-style-complex="italic"')
    else if (m.type === 'underline') p.push('style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"')
    else if (m.type === 'strike') p.push('style:text-line-through-style="solid" style:text-line-through-type="single"')
    else if (m.type === 'superscript') p.push('style:text-position="super 58%"')
    else if (m.type === 'subscript') p.push('style:text-position="sub 58%"')
    else if (m.type === 'code') p.push('style:font-name="' + MONO + '" fo:background-color="#f4f5f3"')
    else if (m.type === 'highlight') p.push('fo:background-color="' + esc(a.color || '#fef08a') + '"')
    else if (m.type === 'link') { href = a.href; p.push('fo:color="#3b6e22" style:text-underline-style="solid" style:text-underline-width="auto" style:text-underline-color="font-color"') }
    else if (m.type === 'textStyle') {
      if (/^#[0-9a-f]{6}$/i.test(a.color || '')) p.push('fo:color="' + a.color.toLowerCase() + '"')
      const size = parseFloat(a.fontSize)
      if (size) p.push('fo:font-size="' + (/px$/.test(a.fontSize) ? size * 0.75 : size) + 'pt"')
      const font = fontOf(a.fontFamily)
      if (font) p.push('style:font-name="' + esc(font) + '"')
    }
  }
  return { props: p.join(' '), href }
}

// Text with runs of spaces and tabs as ODF elements.
function textXml (t) {
  let out = ''
  let spaces = 0
  const flush = () => { if (spaces) { out += spaces === 1 ? ' ' : ' <text:s text:c="' + (spaces - 1) + '"/>'; spaces = 0 } }
  for (const ch of String(t)) {
    if (ch === ' ') { spaces++; continue }
    flush()
    out += ch === '\t' ? '<text:tab/>' : esc(ch)
  }
  flush()
  return out
}

function createWriter (pictures) {
  const auto = new Map() // key -> [name, xml]
  const files = {}
  let pictureNo = 0
  const style = (prefix, family, body, parent) => {
    const key = family + '|' + (parent || '') + '|' + body
    if (!auto.has(key)) {
      const name = prefix + (auto.size + 1)
      auto.set(key, [name, '<style:style style:name="' + name + '" style:family="' + family + '"' + (parent ? ' style:parent-style-name="' + parent + '"' : '') + '>' + body + '</style:style>'])
    }
    return auto.get(key)[0]
  }
  const textStyle = (props) => style('T', 'text', '<style:text-properties ' + props + '/>')

  function inline (nodes, extraProps = '') {
    let out = ''
    for (const n of nodes || []) {
      if (n.type === 'hardBreak') { out += '<text:line-break/>'; continue }
      if (n.type !== 'text') continue
      const { props, href } = runProps(n)
      const all = [extraProps, props].filter(Boolean).join(' ')
      let run = textXml(n.text)
      if (all) run = '<text:span text:style-name="' + textStyle(all) + '">' + run + '</text:span>'
      if (href) run = '<text:a xlink:type="simple" xlink:href="' + esc(href) + '">' + run + '</text:a>'
      out += run
    }
    return out
  }

  function paraStyle (n, parent, ctx) {
    const a = n.attrs || {}
    const p = []
    const align = { left: 'start', center: 'center', right: 'end', justify: 'justify' }[a.textAlign]
    if (align) p.push('fo:text-align="' + align + '"')
    if (a.lineHeight) p.push('fo:line-height="' + Math.round(Number(a.lineHeight) * 100) + '%"')
    // Half an inch a step, as Word and LibreOffice indent and as tidy reads it.
    const indent = (a.indent > 0 ? a.indent * 1.27 : 0) + (ctx.indent || 0)
    if (indent) p.push('fo:margin-left="' + cm(indent) + '"')
    if (a.spaceAfter === 'none' || ctx.tight) p.push('fo:margin-bottom="0cm"')
    return p.length ? style('P', 'paragraph', '<style:paragraph-properties ' + p.join(' ') + '/>', parent) : parent
  }

  function picture (n) {
    const a = n.attrs || {}
    const p = pictures.get(a.ref)
    if (!p || !EXT[p.mime] || !a.w || !a.h) return ''
    const name = 'Pictures/' + (++pictureNo) + '.' + EXT[p.mime]
    files[name] = { bytes: p.bytes, mime: p.mime }
    const w = a.width ? PAGE_CM * a.width / 100 : Math.min(a.w * PX_CM, PAGE_CM)
    const h = w * a.h / a.w
    const align = { left: 'start', right: 'end' }[a.align] || 'center'
    const ps = style('P', 'paragraph', '<style:paragraph-properties fo:text-align="' + align + '"/>', 'Standard')
    const frame = '<draw:frame draw:name="Picture ' + pictureNo + '" text:anchor-type="as-char" svg:width="' + cm(w) + '" svg:height="' + cm(h) + '" draw:z-index="0">' +
      '<draw:image xlink:href="' + name + '" xlink:type="simple" xlink:show="embed" xlink:actuate="onLoad"/>' +
      (a.alt ? '<svg:title>' + esc(a.alt) + '</svg:title>' : '') + '</draw:frame>'
    // A link on the picture (proposals/2026-10-26-picture-links.md).
    const href = okLink(a.href)
    return '<text:p text:style-name="' + ps + '">' + (href ? '<draw:a xlink:type="simple" xlink:href="' + esc(href) + '">' + frame + '</draw:a>' : frame) + '</text:p>'
  }

  function blocks (nodes, ctx = {}) {
    let out = ''
    for (const n of nodes || []) {
      const a = n.attrs || {}
      if (n.type === 'paragraph') {
        const parent = a.blockStyle === 'title' ? 'Title' : a.blockStyle === 'subtitle' ? 'Subtitle' : ctx.quote ? 'Quotations' : 'Standard'
        out += '<text:p text:style-name="' + paraStyle(n, parent, ctx) + '">' + inline(n.content) + '</text:p>'
      } else if (n.type === 'heading') {
        const level = Math.max(1, Math.min(6, a.level || 1))
        out += '<text:h text:style-name="' + paraStyle(n, 'Heading_20_' + level, ctx) + '" text:outline-level="' + level + '">' + inline(n.content) + '</text:h>'
      } else if (n.type === 'image') out += picture(n)
      else if (n.type === 'blockquote') out += blocks(n.content, { ...ctx, quote: true })
      else if (n.type === 'codeBlock') {
        const text = (n.content || []).map((c) => c.text || '').join('')
        for (const line of text.split('\n')) out += '<text:p text:style-name="' + paraStyle({}, 'Preformatted_20_Text', ctx) + '">' + textXml(line) + '</text:p>'
      } else if (n.type === 'horizontalRule') out += '<text:p text:style-name="Horizontal_20_Line"/>'
      else if (n.type === 'bulletList' || n.type === 'orderedList') {
        const list = n.type === 'orderedList' ? 'PearOfficeNumbers' : 'PearOfficeBullets'
        let items = ''
        ;(n.content || []).forEach((item, i) => {
          const start = i === 0 && n.type === 'orderedList' && a.start > 1 ? ' text:start-value="' + a.start + '"' : ''
          items += '<text:list-item' + start + '>' + blocks(item.content, { ...ctx, tight: true, inList: true }) + '</text:list-item>'
        })
        out += '<text:list text:style-name="' + list + '">' + items + '</text:list>'
      } else if (n.type === 'taskList') {
        for (const item of n.content || []) {
          const [first, ...rest] = item.content || []
          const box = '<text:span text:style-name="' + textStyle('style:font-name="' + BOX_FONT + '"') + '">' + ((item.attrs && item.attrs.checked) ? '☒' : '☐') + '</text:span> '
          if (first && first.type === 'paragraph') out += '<text:p text:style-name="' + paraStyle(first, 'Standard', { ...ctx, tight: true }) + '">' + box + inline(first.content) + '</text:p>'
          out += blocks(rest, { ...ctx, tight: true, indent: (ctx.indent || 0) + 0.635 })
        }
      } else if (n.type === 'table') out += table(n, ctx)
    }
    return out
  }

  function table (n, ctx) {
    const rows = n.content || []
    // The grid: which columns each row's cells take, rowspans included.
    const taken = new Set()
    let width = 0
    const placed = rows.map((row, r) => {
      let c = 0
      return (row.content || []).map((cell) => {
        while (taken.has(r + ',' + c)) c++
        const a = cell.attrs || {}
        const cs = Math.max(1, a.colspan || 1)
        const rs = Math.max(1, a.rowspan || 1)
        for (let i = 0; i < rs; i++) for (let j = 0; j < cs; j++) if (i || j) taken.add((r + i) + ',' + (c + j))
        const at = c
        c += cs
        width = Math.max(width, c)
        return { cell, at, cs, rs }
      })
    })
    if (!width) return ''
    const ts = style('Table', 'table', '<style:table-properties style:width="' + cm(PAGE_CM) + '" table:align="margins"/>')
    const cellStyle = (head) => style('Cell', 'table-cell', '<style:table-cell-properties fo:padding="0.1cm" fo:border="0.5pt solid #c9cfc9"' + (head ? ' fo:background-color="#f1f3f1"' : '') + '/>')
    let xml = '<table:table table:name="Table' + (++tableNo) + '" table:style-name="' + ts + '"><table:table-column table:number-columns-repeated="' + width + '"/>'
    placed.forEach((cells, r) => {
      const head = cells.length && cells.every((x) => x.cell.type === 'tableHeader')
      let row = ''
      let c = 0
      const byAt = new Map(cells.map((x) => [x.at, x]))
      while (c < width) {
        const x = byAt.get(c)
        if (!x) { row += '<table:covered-table-cell/>'; c++; continue }
        const inner = blocks(x.cell.content, { tight: true }) || '<text:p text:style-name="Standard"/>'
        row += '<table:table-cell table:style-name="' + cellStyle(x.cell.type === 'tableHeader') + '" office:value-type="string"' +
          (x.cs > 1 ? ' table:number-columns-spanned="' + x.cs + '"' : '') + (x.rs > 1 ? ' table:number-rows-spanned="' + x.rs + '"' : '') + '>' + inner + '</table:table-cell>'
        for (let j = 1; j < x.cs; j++) row += '<table:covered-table-cell/>'
        c += x.cs
      }
      xml += head && r === 0 ? '<table:table-header-rows><table:table-row>' + row + '</table:table-row></table:table-header-rows>' : '<table:table-row>' + row + '</table:table-row>'
    })
    return xml + '</table:table>'
  }
  let tableNo = 0

  return { blocks, files, automaticStyles: () => [...auto.values()].map((x) => x[1]).join('') }
}

const levels = (kind) => Array.from({ length: 10 }, (_, i) => {
  const l = i + 1
  const props = '<style:list-level-properties text:list-level-position-and-space-mode="label-alignment"><style:list-level-label-alignment text:label-followed-by="listtab" text:list-tab-stop-position="' + cm(0.635 * (l + 1)) + '" fo:text-indent="-0.635cm" fo:margin-left="' + cm(0.635 * (l + 1)) + '"/></style:list-level-properties>'
  return kind === 'bullet'
    ? '<text:list-level-style-bullet text:level="' + l + '" text:bullet-char="' + ['•', '◦', '▪'][i % 3] + '">' + props + '</text:list-level-style-bullet>'
    : '<text:list-level-style-number text:level="' + l + '" style:num-suffix="." style:num-format="' + ['1', 'a', 'i'][i % 3] + '">' + props + '</text:list-level-style-number>'
}).join('')

const STYLES = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-styles ' + NS + ' office:version="1.3">' +
  '<office:font-face-decls><style:font-face style:name="' + FONT + '" svg:font-family="' + FONT + '" style:font-family-generic="swiss"/>' +
  '<style:font-face style:name="' + SERIF + '" svg:font-family="&apos;' + SERIF + '&apos;" style:font-family-generic="roman"/>' +
  '<style:font-face style:name="' + MONO + '" svg:font-family="&apos;' + MONO + '&apos;" style:font-family-generic="modern" style:font-pitch="fixed"/>' +
  '<style:font-face style:name="' + BOX_FONT + '" svg:font-family="&apos;' + BOX_FONT + '&apos;"/></office:font-face-decls>' +
  '<office:styles>' +
  '<style:default-style style:family="paragraph"><style:paragraph-properties fo:margin-bottom="0.282cm" fo:line-height="115%"/><style:text-properties style:font-name="' + FONT + '" fo:font-size="11pt" fo:color="#1f2420"/></style:default-style>' +
  '<style:style style:name="Standard" style:family="paragraph" style:class="text"/>' +
  '<style:style style:name="Heading" style:family="paragraph" style:parent-style-name="Standard" style:next-style-name="Standard" style:class="text"><style:paragraph-properties fo:margin-top="0.6cm" fo:margin-bottom="0.212cm" fo:keep-with-next="always"/><style:text-properties fo:font-weight="bold"/></style:style>' +
  [[1, '20pt'], [2, '16pt'], [3, '14pt'], [4, '12pt'], [5, '11pt'], [6, '11pt']].map(([l, size]) =>
    '<style:style style:name="Heading_20_' + l + '" style:display-name="Heading ' + l + '" style:family="paragraph" style:parent-style-name="Heading" style:default-outline-level="' + l + '" style:class="text"><style:text-properties fo:font-size="' + size + '"' + (l >= 3 ? ' fo:color="#5f6b62"' : '') + '/></style:style>').join('') +
  '<style:style style:name="Title" style:family="paragraph" style:parent-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-bottom="0.106cm"/><style:text-properties fo:font-size="26pt"/></style:style>' +
  '<style:style style:name="Subtitle" style:family="paragraph" style:parent-style-name="Standard" style:class="chapter"><style:paragraph-properties fo:margin-bottom="0.564cm"/><style:text-properties fo:font-size="15pt" fo:color="#5f6b62"/></style:style>' +
  '<style:style style:name="Quotations" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-left="0.5cm" fo:padding-left="0.25cm" fo:border-left="1.5pt solid #c9cfc9" fo:border-right="none" fo:border-top="none" fo:border-bottom="none"/><style:text-properties fo:color="#5f6b62"/></style:style>' +
  '<style:style style:name="Preformatted_20_Text" style:display-name="Preformatted Text" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-bottom="0cm" fo:line-height="100%" fo:background-color="#f4f5f3"/><style:text-properties style:font-name="' + MONO + '" fo:font-size="10pt"/></style:style>' +
  '<style:style style:name="Horizontal_20_Line" style:display-name="Horizontal Line" style:family="paragraph" style:parent-style-name="Standard" style:class="html"><style:paragraph-properties fo:margin-top="0.25cm" fo:margin-bottom="0.25cm" fo:border-bottom="0.75pt solid #c9cfc9" fo:padding="0cm" fo:border-top="none" fo:border-left="none" fo:border-right="none"/><style:text-properties fo:font-size="6pt"/></style:style>' +
  '<text:list-style style:name="PearOfficeBullets">' + levels('bullet') + '</text:list-style>' +
  '<text:list-style style:name="PearOfficeNumbers">' + levels('number') + '</text:list-style>' +
  '</office:styles>' +
  '<office:automatic-styles><style:page-layout style:name="pm1"><style:page-layout-properties fo:page-width="21cm" fo:page-height="29.7cm" fo:margin-top="2cm" fo:margin-bottom="2cm" fo:margin-left="2cm" fo:margin-right="2cm"/></style:page-layout></office:automatic-styles>' +
  '<office:master-styles><style:master-page style:name="Standard" style:page-layout-name="pm1"/></office:master-styles></office:document-styles>'

// The document as .odt bytes. pictures: ref -> { bytes, mime }.
export function toOdt (json, title = '', pictures = new Map()) {
  const w = createWriter(pictures)
  const body = w.blocks(json.content) || '<text:p text:style-name="Standard"/>'
  const content = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-content ' + NS + ' office:version="1.3">' +
    '<office:automatic-styles>' + w.automaticStyles() + '</office:automatic-styles>' +
    '<office:body><office:text>' + body + '</office:text></office:body></office:document-content>'
  const meta = '<?xml version="1.0" encoding="UTF-8"?>\n<office:document-meta ' + NS + ' office:version="1.3"><office:meta><meta:generator>PearOffice</meta:generator>' +
    (title ? '<dc:title>' + esc(title) + '</dc:title>' : '') + '</office:meta></office:document-meta>'
  const pics = Object.entries(w.files)
  const manifest = '<?xml version="1.0" encoding="UTF-8"?>\n<manifest:manifest xmlns:manifest="urn:oasis:names:tc:opendocument:xmlns:manifest:1.0" manifest:version="1.3">' +
    '<manifest:file-entry manifest:full-path="/" manifest:version="1.3" manifest:media-type="application/vnd.oasis.opendocument.text"/>' +
    '<manifest:file-entry manifest:full-path="content.xml" manifest:media-type="text/xml"/><manifest:file-entry manifest:full-path="styles.xml" manifest:media-type="text/xml"/>' +
    '<manifest:file-entry manifest:full-path="meta.xml" manifest:media-type="text/xml"/>' +
    pics.map(([name, p]) => '<manifest:file-entry manifest:full-path="' + name + '" manifest:media-type="' + p.mime + '"/>').join('') + '</manifest:manifest>'
  const u8 = fflate.strToU8
  const zip = { mimetype: [u8('application/vnd.oasis.opendocument.text'), { level: 0 }], 'META-INF/manifest.xml': u8(manifest), 'content.xml': u8(content), 'styles.xml': u8(STYLES), 'meta.xml': u8(meta) }
  for (const [name, p] of pics) zip[name] = [p.bytes, { level: 0 }]
  return fflate.zipSync(zip)
}

// --- opening ------------------------------------------------------------------

const XML_MIME = { png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg', gif: 'image/gif', webp: 'image/webp', bmp: 'image/bmp' }
const toB64 = (bytes) => { let s = ''; for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000)); return btoa(s) }
const len = (v) => { const m = /^(-?[\d.]+)(cm|mm|in|pt|pc|px)?$/.exec(String(v || '').trim()); return m ? Number(m[1]) * { cm: 1, mm: 0.1, in: 2.54, pt: 2.54 / 72, pc: 2.54 / 6, px: PX_CM }[m[2] || 'cm'] : 0 }

// Every style in a document, by family and name, with its parent and the
// attributes of its properties.
function readStyles (doc, into) {
  for (const el of doc.getElementsByTagName('style:style')) {
    const name = el.getAttribute('style:name')
    const family = el.getAttribute('style:family')
    if (!name || !family) continue
    const props = (tag) => { const p = el.getElementsByTagName(tag)[0]; return p ? Object.fromEntries([...p.attributes].map((a) => [a.name, a.value])) : {} }
    into[family + ':' + name] = {
      name,
      display: el.getAttribute('style:display-name') || name,
      parent: el.getAttribute('style:parent-style-name'),
      listStyle: el.getAttribute('style:list-style-name'),
      auto: el.parentNode && el.parentNode.nodeName === 'office:automatic-styles',
      text: props('style:text-properties'),
      para: props('style:paragraph-properties')
    }
  }
  return into
}

// text-properties -> the tags for bold, italic, underline, strike, super-
// and subscript (as mammoth gives them), and CSS for the rest (only what
// tidy reads): 'tag,tag|css'.
function textCss (t, fonts) {
  const tags = []
  const css = []
  if (t['fo:font-weight'] === 'bold' || Number(t['fo:font-weight']) >= 600) tags.push('strong')
  if (t['fo:font-style'] === 'italic' || t['fo:font-style'] === 'oblique') tags.push('em')
  if (t['style:text-underline-style'] && t['style:text-underline-style'] !== 'none') tags.push('u')
  if (t['style:text-line-through-style'] && t['style:text-line-through-style'] !== 'none') tags.push('s')
  if (/^#[0-9a-f]{6}$/i.test(t['fo:color'] || '')) css.push('color:' + t['fo:color'])
  if (t['fo:font-size'] && /pt$/.test(t['fo:font-size'])) css.push('font-size:' + t['fo:font-size'])
  const font = t['fo:font-family'] || fonts[t['style:font-name']] || t['style:font-name']
  if (font) css.push('font-family:' + font.replace(/^'|'$/g, ''))
  if (/^#[0-9a-f]{6}$/i.test(t['fo:background-color'] || '')) css.push('background-color:' + t['fo:background-color'])
  const pos = String(t['style:text-position'] || '')
  if (/^super|^[1-9]/.test(pos)) tags.push('sup')
  else if (/^sub|^-/.test(pos)) tags.push('sub')
  return tags.join(',') + '|' + css.join(';')
}
const joinLooks = (looks) => {
  const tags = new Set()
  const css = []
  for (const l of looks) {
    if (!l) continue
    const [t, c] = l.split('|')
    for (const x of t.split(',')) if (x) tags.add(x)
    if (c) css.push(c)
  }
  return [...tags].join(',') + '|' + css.join(';')
}
// Content wrapped in a look's tags and span.
const wrap = (look, inner) => {
  const [t, css] = (look || '|').split('|')
  let out = css ? '<span style="' + esc(css) + '">' + inner + '</span>' : inner
  for (const tag of t.split(',').filter(Boolean).reverse()) out = '<' + tag + '>' + out + '</' + tag + '>'
  return out
}

// A .odt file (its unzipped parts) -> { html } for tidy, pictures inline as
// data: URLs.
export function odtToHtml (files) {
  const read = (p) => (files[p] ? fflate.strFromU8(files[p]) : '')
  const parse = (s) => new window.DOMParser().parseFromString(s || '<x/>', 'application/xml')
  const content = parse(read('content.xml'))
  const stylesDoc = parse(read('styles.xml'))
  const styles = readStyles(content, readStyles(stylesDoc, {}))
  const fonts = {}
  for (const d of [stylesDoc, content]) for (const f of d.getElementsByTagName('style:font-face')) fonts[f.getAttribute('style:name')] = (f.getAttribute('svg:font-family') || '').replace(/^'|'$/g, '')
  // List styles: name -> level -> ordered?
  const lists = {}
  for (const d of [stylesDoc, content]) {
    for (const ls of d.getElementsByTagName('text:list-style')) {
      const levels = {}
      for (const lv of ls.childNodes) {
        if (!lv.getAttribute) continue
        const l = Number(lv.getAttribute('text:level'))
        if (lv.nodeName === 'text:list-level-style-number') levels[l] = !!lv.getAttribute('style:num-format')
        else if (lv.nodeName === 'text:list-level-style-bullet' || lv.nodeName === 'text:list-level-style-image') levels[l] = false
      }
      lists[ls.getAttribute('style:name')] = levels
    }
  }
  const chain = (family, name) => { const out = []; const seen = new Set(); let s = styles[family + ':' + name]; while (s && !seen.has(s.name)) { seen.add(s.name); out.push(s); s = s.parent && styles[family + ':' + s.parent] } return out }
  // What kind of paragraph a style makes: its first named ancestor decides.
  const kindOf = (name) => {
    for (const s of chain('paragraph', name)) {
      const d = s.display.toLowerCase()
      if (d === 'title') return 'title'
      if (d === 'subtitle') return 'subtitle'
      if (d === 'quotations' || d === 'quote') return 'quote'
      if (d === 'preformatted text') return 'pre'
    }
    return null
  }
  // A paragraph style's own look (automatic styles only; a named style's
  // look is the style itself, as Heading's size).
  const paraCss = (name) => {
    const s = styles['paragraph:' + name]
    if (!s) return { block: '', text: '|' }
    const css = []
    const p = s.auto ? s.para : {}
    const align = { start: 'left', left: 'left', center: 'center', end: 'right', right: 'right', justify: 'justify' }[p['fo:text-align']]
    if (align && align !== 'left') css.push('text-align:' + align)
    if (/%$/.test(p['fo:line-height'] || '')) css.push('line-height:' + (parseFloat(p['fo:line-height']) / 100))
    const ml = len(p['fo:margin-left'])
    if (ml > 0.1) css.push('margin-left:' + ml + 'cm')
    return { block: css.join(';'), text: s.auto ? textCss(s.text, fonts) : '|' }
  }
  const textStyleCss = (name) => {
    const parts = []
    for (const s of chain('text', name).reverse()) {
      const display = s.display.toLowerCase()
      if (!s.auto && /strong/.test(display)) parts.push('strong|')
      else if (!s.auto && /^emphasis$/.test(display)) parts.push('em|')
      else if (!s.auto && /source text/.test(display)) parts.push('|font-family:monospace')
      parts.push(textCss(s.text, fonts))
    }
    return joinLooks(parts)
  }

  let dropped = false
  const picture = (frame, link) => {
    const img = frame.getElementsByTagName('draw:image')[0]
    const href = img && (img.getAttribute('xlink:href') || '').replace(/^\.\//, '')
    const bytes = href && files[href]
    const ext = (/\.([a-z0-9]+)$/i.exec(href || '') || [])[1]
    const mime = ext && XML_MIME[ext.toLowerCase()]
    if (!bytes || !mime) { dropped = true; return '' }
    const titleEl = frame.getElementsByTagName('svg:title')[0] || frame.getElementsByTagName('svg:desc')[0]
    const alt = titleEl ? titleEl.textContent : ''
    const w = len(frame.getAttribute('svg:width'))
    const pct = w ? Math.max(10, Math.min(100, Math.round(w / PAGE_CM * 100))) : null
    const tag = '<img src="data:' + mime + ';base64,' + toB64(bytes) + '"' + (alt ? ' alt="' + esc(alt) + '"' : '') + (pct && pct < 100 ? ' data-width="' + pct + '"' : '') + '>'
    return link ? '<a href="' + esc(link) + '">' + tag + '</a>' : tag
  }

  // Inline content -> HTML; pictures found are returned apart (block level).
  function inline (el, pics) {
    let out = ''
    for (const c of el.childNodes) {
      if (c.nodeType === 3) { out += esc(c.nodeValue); continue }
      if (c.nodeType !== 1) continue
      switch (c.nodeName) {
        // Kept as no-break spaces through the HTML, then made spaces again
        // (docFiles.js).
        case 'text:s': out += '&nbsp;'.repeat(Number(c.getAttribute('text:c')) || 1); break
        case 'text:tab': out += '&emsp;'; break
        case 'text:line-break': out += '<br>'; break
        case 'text:span': out += wrap(textStyleCss(c.getAttribute('text:style-name')), inline(c, pics)); break
        case 'text:a': out += '<a href="' + esc(c.getAttribute('xlink:href') || '') + '">' + inline(c, pics) + '</a>'; break
        case 'draw:frame': pics.push(picture(c)); break
        // A linked picture: the link goes on the picture (docFiles.js).
        case 'draw:a': {
          const f = [...c.childNodes].find((x) => x.nodeName === 'draw:frame')
          if (f) pics.push(picture(f, okLink(c.getAttribute('xlink:href'))))
          else out += inline(c, pics)
          break
        }
        case 'text:note': case 'office:annotation': case 'office:annotation-end': dropped = dropped || c.nodeName === 'text:note'; break
        case 'text:bookmark': case 'text:bookmark-start': case 'text:bookmark-end': case 'text:soft-page-break': break
        default: out += inline(c, pics)
      }
    }
    return out
  }

  function paragraph (el, ctx) {
    const name = el.getAttribute('text:style-name')
    const kind = kindOf(name)
    const { block, text } = paraCss(name)
    const pics = []
    const inner = wrap(text, inline(el, pics))
    const style = block ? ' style="' + esc(block) + '"' : ''
    let out
    if (el.nodeName === 'text:h') {
      const level = Math.max(1, Math.min(6, Number(el.getAttribute('text:outline-level')) || 1))
      out = '<h' + level + style + '>' + inner + '</h' + level + '>'
    } else if (kind === 'title' || kind === 'subtitle') out = '<p class="' + kind + '"' + style + '>' + inner + '</p>'
    else if (kind === 'pre' && !ctx.inList) out = '\u0000pre' + inner.replace(/<br>/g, '\n') + '\u0000'
    else if (kind === 'quote' && !ctx.inList) out = '\u0001quote<p' + style + '>' + inner + '</p>\u0001'
    else out = '<p' + style + '>' + inner + '</p>'
    return out + pics.join('')
  }

  function list (el, ctx) {
    const styleName = el.getAttribute('text:style-name') || ctx.listStyle
    const level = (ctx.level || 0) + 1
    const levels = lists[styleName] || {}
    const ordered = !!levels[level]
    let out = ''
    for (const item of el.childNodes) {
      if (item.nodeName !== 'text:list-item' && item.nodeName !== 'text:list-header') continue
      out += '<li>' + blocks(item, { ...ctx, inList: true, level, listStyle: styleName }) + '</li>'
    }
    return '<' + (ordered ? 'ol' : 'ul') + '>' + out + '</' + (ordered ? 'ol' : 'ul') + '>'
  }

  function table (el) {
    let out = ''
    const rows = (parent, head) => {
      for (const c of parent.childNodes) {
        if (c.nodeName === 'table:table-header-rows') rows(c, true)
        else if (c.nodeName === 'table:table-rows' || c.nodeName === 'table:table-row-group') rows(c, head)
        else if (c.nodeName === 'table:table-row') {
          const repeat = Math.min(Number(c.getAttribute('table:number-rows-repeated')) || 1, 1000)
          let row = ''
          for (const cell of c.childNodes) {
            if (cell.nodeName !== 'table:table-cell') continue
            const cs = Number(cell.getAttribute('table:number-columns-spanned')) || 1
            const rs = Number(cell.getAttribute('table:number-rows-spanned')) || 1
            const tag = head ? 'th' : 'td'
            const n = Math.min(Number(cell.getAttribute('table:number-columns-repeated')) || 1, 100)
            for (let i = 0; i < n; i++) row += '<' + tag + (cs > 1 ? ' colspan="' + cs + '"' : '') + (rs > 1 ? ' rowspan="' + rs + '"' : '') + '>' + (blocks(cell, { inList: false }) || '<p></p>') + '</' + tag + '>'
          }
          for (let i = 0; i < repeat; i++) out += '<tr>' + row + '</tr>'
        }
      }
    }
    rows(el, false)
    return '<table><tbody>' + out + '</tbody></table>'
  }

  function blocks (el, ctx = {}) {
    let out = ''
    for (const c of el.childNodes) {
      if (c.nodeType !== 1) continue
      switch (c.nodeName) {
        case 'text:p': case 'text:h': out += paragraph(c, ctx); break
        case 'text:list': out += list(c, ctx); break
        case 'table:table': out += table(c); break
        case 'text:section': case 'text:index-body': case 'text:table-of-content': case 'text:alphabetical-index': case 'text:illustration-index': case 'text:user-index': out += blocks(c, ctx); break
        case 'draw:frame': out += picture(c); break
        case 'text:sequence-decls': case 'office:forms': case 'text:variable-decls': case 'text:user-field-decls': case 'text:index-title': case 'text:table-of-content-source': break
        default: if (c.nodeName.startsWith('text:') || c.nodeName.startsWith('table:')) out += blocks(c, ctx)
      }
    }
    return out
  }

  const text = content.getElementsByTagName('office:text')[0]
  let html = text ? blocks(text) : ''
  // Runs of code and quote paragraphs become one <pre> and one <blockquote>.
  html = html.replace(/(?:\u0000pre([\s\S]*?)\u0000)+/g, (run) => '<pre><code>' + run.split('\u0000').filter((s) => s.startsWith('pre')).map((s) => s.slice(3)).join('\n') + '</code></pre>')
  html = html.replace(/(?:\u0001quote([\s\S]*?)\u0001)+/g, (run) => '<blockquote>' + run.split('\u0001').filter((s) => s.startsWith('quote')).map((s) => s.slice(5)).join('') + '</blockquote>')
  return { html, dropped }
}
