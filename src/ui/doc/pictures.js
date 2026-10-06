// Pictures in the document editor (proposals/2026-10-06-document-images.md):
// shrinking before upload, a cache of fetched pictures for the open
// document and the node view that draws, loads and resizes a picture.

import { Picture } from './extensions.js'

export const MAX_BYTES = 1024 * 1024 // src/worklet/pictures.js
export const TOO_BIG = 'This picture is too big to add, even after shrinking it. Try a smaller one.'
const LONG_SIDE = 1600
const QUALITY = 0.8
const MIMES = ['image/jpeg', 'image/png', 'image/webp', 'image/gif']
const RETRY_MS = 15000

export function toB64 (bytes) {
  let s = ''
  for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode.apply(null, bytes.subarray(i, i + 0x8000))
  return btoa(s)
}

export function fromB64 (b64) {
  const s = atob(b64)
  const out = new Uint8Array(s.length)
  for (let i = 0; i < s.length; i++) out[i] = s.charCodeAt(i)
  return out
}

// Can this file or MIME type be added as a picture? SVG cannot (it can
// carry scripts).
export function isPicture (type) {
  return /^image\//.test(type || '') && !/svg/.test(type)
}

async function decode (blob) {
  if (typeof window.createImageBitmap === 'function') {
    try { return await window.createImageBitmap(blob) } catch {}
  }
  const url = URL.createObjectURL(blob)
  try {
    return await new Promise((resolve, reject) => {
      const i = new window.Image()
      i.onload = () => resolve(i)
      i.onerror = () => reject(new Error('That file is not a picture PearOffice can read.'))
      i.src = url
    })
  } finally { URL.revokeObjectURL(url) }
}

const encode = (canvas, type, q) => new Promise((resolve) => canvas.toBlob(resolve, type, q))

// A picture from a file, the clipboard or an import, made ready to store: at
// most 1600 pixels on the long side, in the smallest of WebP and JPEG at 0.8
// (WebKit hands back a PNG when asked for WebP: blob.type says so) and PNG
// when the source was PNG. Drawing through a
// canvas applies the EXIF orientation and drops the EXIF, location included.
// GIFs keep their first frame. { bytes, mime, w, h }.
export async function preparePicture (blob, type = blob.type) {
  if (!isPicture(type)) throw new Error('This kind of picture cannot be added.')
  const img = await decode(blob)
  const iw = img.naturalWidth || img.width
  const ih = img.naturalHeight || img.height
  if (!iw || !ih) throw new Error('That file is not a picture PearOffice can read.')
  const scale = Math.min(1, LONG_SIDE / Math.max(iw, ih))
  const w = Math.max(1, Math.round(iw * scale))
  const h = Math.max(1, Math.round(ih * scale))
  const canvas = document.createElement('canvas')
  canvas.width = w
  canvas.height = h
  const g = canvas.getContext('2d')
  g.drawImage(img, 0, 0, w, h)
  if (img.close) img.close()
  const out = []
  const webp = await encode(canvas, 'image/webp', QUALITY)
  if (webp && webp.type === 'image/webp') out.push(webp)
  if (type === 'image/png') {
    const png = await encode(canvas, 'image/png')
    if (png) out.push(png)
  }
  // JPEG has no transparency: put the picture on white.
  const flat = document.createElement('canvas')
  flat.width = w
  flat.height = h
  const fg = flat.getContext('2d')
  fg.fillStyle = '#ffffff'
  fg.fillRect(0, 0, w, h)
  fg.drawImage(canvas, 0, 0)
  const jpeg = await encode(flat, 'image/jpeg', QUALITY)
  if (jpeg) out.push(jpeg)
  if (!out.length) throw new Error('That file is not a picture PearOffice can read.')
  const best = out.reduce((a, b) => (b.size < a.size ? b : a))
  if (best.size > MAX_BYTES) throw new Error(TOO_BIG)
  return { bytes: new Uint8Array(await best.arrayBuffer()), mime: best.type, w, h }
}

// For Word, which cannot show WebP: the picture as JPEG (on white) or PNG.
export async function wordPicture (bytes, mime) {
  if (mime !== 'image/webp') return { bytes, mime }
  const img = await decode(new Blob([bytes], { type: mime }))
  const canvas = document.createElement('canvas')
  canvas.width = img.naturalWidth || img.width
  canvas.height = img.naturalHeight || img.height
  const g = canvas.getContext('2d')
  g.fillStyle = '#ffffff'
  g.fillRect(0, 0, canvas.width, canvas.height)
  g.drawImage(img, 0, 0)
  const jpeg = await encode(canvas, 'image/jpeg', 0.9)
  return { bytes: new Uint8Array(await jpeg.arrayBuffer()), mime: 'image/jpeg' }
}

// Fetched pictures for one open document, as object URLs: ref -> Promise<url>.
// A failed fetch is forgotten, so it can be tried again.
export function pictureCache (fetchBytes) {
  const urls = new Map()
  return {
    get (attrs) {
      if (!urls.has(attrs.ref)) {
        const p = fetchBytes(attrs).then((bytes) => URL.createObjectURL(new Blob([bytes], { type: MIMES.includes(attrs.mime) ? attrs.mime : 'application/octet-stream' })))
        p.catch(() => { if (urls.get(attrs.ref) === p) urls.delete(attrs.ref) })
        urls.set(attrs.ref, p)
      }
      return urls.get(attrs.ref)
    },
    // Bytes this device just stored: no need to fetch them back.
    put (ref, bytes, mime) {
      if (!urls.has(ref)) urls.set(ref, Promise.resolve(URL.createObjectURL(new Blob([bytes], { type: mime }))))
    },
    clear () {
      for (const p of urls.values()) p.then((u) => URL.revokeObjectURL(u), () => {})
      urls.clear()
    }
  }
}

// The picture node with its view: a grey box with "Picture loading" until the
// bytes arrive (fetched when near the screen), "This picture is not available
// yet" if they do not and a corner handle to resize it while editing.
export const PictureView = Picture.extend({
  addOptions () {
    return { cache: null }
  },

  addNodeView () {
    const cache = this.options.cache
    return ({ node, getPos, editor }) => {
      let current = node
      const dom = document.createElement('div')
      dom.className = 'doc-picture-block'
      const frame = document.createElement('div')
      frame.className = 'doc-picture-frame'
      const img = document.createElement('img')
      img.draggable = false
      const wait = document.createElement('div')
      wait.className = 'doc-picture-wait'
      const handle = document.createElement('span')
      handle.className = 'doc-picture-handle'
      handle.setAttribute('aria-hidden', 'true')
      frame.append(wait, img, handle)
      dom.append(frame)

      let shownRef = null
      let retry = null
      let seen = typeof window.IntersectionObserver !== 'function'
      const load = () => {
        const a = current.attrs
        if (!seen || !cache || !a.ref || shownRef === a.ref) return
        const ref = a.ref
        shownRef = ref
        img.hidden = true
        wait.hidden = false
        wait.textContent = 'Picture loading'
        cache.get(a).then((url) => {
          if (current.attrs.ref !== ref) return
          img.src = url
          img.hidden = false
          wait.hidden = true
        }, () => {
          if (current.attrs.ref !== ref) return
          wait.textContent = 'This picture is not available yet'
          shownRef = null
          clearTimeout(retry)
          retry = setTimeout(load, RETRY_MS)
        })
      }
      const io = seen ? null : new window.IntersectionObserver((entries) => { if (entries.some((x) => x.isIntersecting)) { seen = true; io.disconnect(); load() } }, { rootMargin: '800px' })
      if (io) io.observe(dom)

      const draw = () => {
        const a = current.attrs
        dom.dataset.align = a.align || 'center'
        img.alt = a.alt || ''
        frame.title = a.alt || ''
        frame.style.aspectRatio = a.w && a.h ? a.w + ' / ' + a.h : ''
        frame.style.width = a.width ? a.width + '%' : (a.w ? a.w + 'px' : '100%')
        load()
      }
      draw()

      // Drag the corner: the width as a share of the page, the shape kept.
      handle.addEventListener('pointerdown', (e) => {
        if (!editor.isEditable) return
        e.preventDefault()
        e.stopPropagation()
        const page = dom.getBoundingClientRect().width || 1
        const start = frame.getBoundingClientRect().width
        const x0 = e.clientX
        const k = (current.attrs.align === 'center' ? 2 : 1) * (current.attrs.align === 'right' ? -1 : 1)
        let pct = null
        const move = (ev) => {
          pct = Math.round(Math.max(10, Math.min(100, (start + (ev.clientX - x0) * k) / page * 100)))
          frame.style.width = pct + '%'
        }
        const up = () => {
          window.removeEventListener('pointermove', move)
          window.removeEventListener('pointerup', up)
          const pos = getPos()
          if (pct && typeof pos === 'number') editor.view.dispatch(editor.state.tr.setNodeMarkup(pos, undefined, { ...current.attrs, width: pct }))
        }
        window.addEventListener('pointermove', move)
        window.addEventListener('pointerup', up)
      })

      return {
        dom,
        update (next) {
          if (next.type !== current.type) return false
          current = next
          draw()
          return true
        },
        stopEvent: (e) => e.target === handle,
        ignoreMutation: () => true,
        destroy () { clearTimeout(retry); if (io) io.disconnect() }
      }
    }
  }
})
