import React from 'react'
import { createRoot } from 'react-dom/client'
import { flushSync } from 'react-dom'
import { call } from '../bridge.js'
import { fileName, saveFile, isMobile } from '../save.js'
import { fromB64, wordPicture } from '../doc/pictures.js'
import { FONT_CSS } from '../fonts.js'
import slidesModel from '../../slides/slidesModel.js'
import { boxesOf } from './deck.js'
import { themeFor } from './themes.js'
import { StaticSlide } from './StaticSlide.jsx'
import { PicturesContext } from './objects.jsx'
import { deckToPptx, deckPictures, PPTX } from './pptxExport.js'

// Saving a deck (proposals/2026-10-06-slides.md, "Import and export"): as
// PowerPoint (pptxExport.js), as a PDF with one page per slide or on paper.
// The PDF and print pages are the slides drawn by StaticSlide, as in the
// slide list and the show, with pictures as data: URLs, charts as inline
// SVG and the theme's colours and fonts inline. Text stays text. Deleted slides are left out.

const PER_IN = 144 // slide units to the inch (pptxExport.js)
const CSS_PX = 96 // CSS pixels to the inch

// The slide rules from app.css (.slide and below) the static slide needs.
// Keep in step with app.css.
const SLIDE_CSS = [
  '.slide{position:absolute;left:0;top:0;transform-origin:0 0;overflow:hidden;background:var(--slide-bg);color:var(--slide-ink);font-family:var(--slide-body)}',
  '.slide-el{position:absolute;transform-origin:50% 50%}',
  '.slide-shape{position:absolute;inset:0;display:block;overflow:visible}',
  ".slide-el[data-type='shape'] .slide-body{text-align:center}",
  '.shape-ink{display:contents}',
  '.slide-picture{position:absolute;inset:0;width:100%;height:100%;object-fit:fill;display:block}',
  '.slide-picture-crop{position:absolute;inset:0;overflow:hidden}',
  '.slide-chart{position:absolute;inset:0}',
  '.slide-chart svg{display:block;width:100%;height:100%;overflow:visible}',
  '.slide-picture-wait{position:absolute;inset:0;display:flex;align-items:center;justify-content:center;padding:16px;box-sizing:border-box;overflow:hidden;background:#c8cbd0;color:#464b52;font-size:28px;text-align:center}',
  '.slide-text{position:absolute;left:0;top:0;transform-origin:0 0;font-size:var(--slide-body-size);line-height:1.2;overflow-wrap:break-word}',
  '.slide-text.role-title{font-family:var(--slide-heading);font-size:var(--slide-title-size);font-weight:var(--slide-title-weight);line-height:1.1}',
  '.slide-text strong,.slide-text b{font-weight:600}',
  '.slide-text .slide-body{height:100%}',
  '.slide-body{white-space:pre-wrap;padding:6px 10px;box-sizing:border-box}',
  ".slide-text[data-anchor='middle'] .slide-body,.slide-text[data-anchor='bottom'] .slide-body{display:flex;flex-direction:column;justify-content:center}",
  ".slide-text[data-anchor='bottom'] .slide-body{justify-content:flex-end}",
  ".slide-text[data-wrap='false']{overflow-wrap:normal}",
  ".slide-text[data-wrap='false'] .slide-body{white-space:pre}",
  '.slide-body p{margin:0;min-height:1.2em}',
  '.slide-body ul,.slide-body ol{margin:0;padding-left:1.3em}',
  '.slide-body li>p{margin:0 0 .25em}',
  ".slide-body ul[data-type='taskList']{list-style:none;padding-left:.2em}",
  ".slide-body ul[data-type='taskList'] li{display:flex;align-items:flex-start;gap:.4em}",
  '.slide-body blockquote{margin:0;padding-left:.6em;border-left:.15em solid currentColor;opacity:.8}',
  '.slide-body hr{border:0;border-top:.06em solid currentColor;margin:.4em 0}',
  '.slide-body a{color:var(--accent1);text-decoration:underline}',
  '.slide-body mark{color:inherit;border-radius:.1em}',
  ".slide-body code{font-family:ui-monospace,'SF Mono',Menlo,Consolas,monospace;font-size:.9em}",
  ".slide[data-layout='title'] .slide-el[data-role] .slide-text{text-align:center}"
].join('')

const esc = (s) => String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')

function dataUrl (p) {
  let bin = ''
  for (let i = 0; i < p.bytes.length; i += 0x8000) bin += String.fromCharCode.apply(null, p.bytes.subarray(i, i + 0x8000))
  return 'data:' + p.mime + ';base64,' + btoa(bin)
}

// The deck's pictures, fetched: ref -> { bytes, mime }. One that cannot be
// fetched is left out (the PDF shows its alt text in a grey box).
async function fetchPictures (ydoc, sheetId) {
  const out = new Map()
  for (const a of deckPictures(ydoc)) {
    try { out.set(a.ref, { bytes: fromB64((await call('slides:picture', { sheetId, ref: a.ref, hash: a.hash })).data), mime: a.mime }) } catch {}
  }
  return out
}

// The page size, in inches, for a deck.
export function pageSize (ydoc) {
  const [w, h] = slidesModel.size(ydoc)
  return { width: Math.round(w / PER_IN * 1000) / 1000, height: Math.round(h / PER_IN * 1000) / 1000 }
}

// The printable page: one page per slide, the deck's own size.
export async function deckHtml (ydoc, title, pictures) {
  const size = slidesModel.size(ydoc)
  const theme = themeFor(slidesModel.theme(ydoc))
  const slides = slidesModel.slides(ydoc).map((s) => ({ id: s.id, layout: s.map.get('layout'), els: boxesOf(ydoc, s.id) }))
  const urls = new Map([...pictures].map(([ref, p]) => [ref, dataUrl(p)]))
  // StaticSlide's pictures come from this in place of the picture cache.
  const cache = { get: (pic) => (urls.has(pic.ref) ? Promise.resolve(urls.get(pic.ref)) : Promise.reject(new Error('missing'))) }
  const scale = CSS_PX / PER_IN
  const pw = size[0] * scale
  const ph = size[1] * scale

  const host = document.createElement('div')
  const root = createRoot(host)
  try {
    flushSync(() => root.render(
      <PicturesContext.Provider value={cache}>
        {slides.map((s) => <div key={s.id} className='page'><StaticSlide slide={s} size={size} theme={theme} scale={scale} /></div>)}
      </PicturesContext.Provider>
    ))
    // Text is drawn in an effect and pictures once their promise settles.
    const want = slides.reduce((n, s) => n + s.els.filter((e) => e.type === 'picture' && urls.has(e.pic.ref)).length, 0)
    for (let i = 0; i < 100 && host.querySelectorAll('img.slide-picture').length < want; i++) await new Promise((resolve) => setTimeout(resolve, 10))
    await new Promise((resolve) => setTimeout(resolve, 0))
    const body = host.innerHTML
    const css = '@page{size:' + pw / CSS_PX + 'in ' + ph / CSS_PX + 'in;margin:0}' +
      'html,body{margin:0;padding:0}' +
      '.page{position:relative;width:' + pw + 'px;height:' + ph + 'px;overflow:hidden;break-after:page;page-break-after:always}' +
      '.page:last-child{break-after:auto;page-break-after:auto}' +
      FONT_CSS + SLIDE_CSS
    return '<!doctype html><html><head><meta charset="utf-8"><title>' + esc(title) + '</title><style>' + css + '</style></head><body>' + body + '</body></html>'
  } finally {
    root.unmount()
  }
}

// Save the deck as 'pptx', 'pdf' or 'print' (print on desktop only, as for
// documents).
export async function exportDeck (ydoc, title, format, sheetId) {
  const name = fileName(title || 'Untitled slides')
  if (format === 'print' && isMobile()) throw new Error('Printing is not available on phones.')
  const pictures = await fetchPictures(ydoc, sheetId)
  if (format === 'pptx') {
    // PowerPoint does not read WebP: those go as JPEG, as for Word.
    for (const [ref, p] of pictures) pictures.set(ref, await wordPicture(p.bytes, p.mime).catch(() => p))
    return saveFile(name + '.pptx', PPTX, await deckToPptx(ydoc, { title, pictures }))
  }
  return call(format === 'print' ? 'app:print' : 'app:savePdf', { html: await deckHtml(ydoc, title, pictures), name: name + '.pdf', pageSize: pageSize(ydoc) })
}
