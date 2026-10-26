// Pictures in the document editor (proposals/2026-10-06-document-images.md):
// shrinking before upload, a cache of fetched pictures for the open
// document and the node view that draws, loads and resizes a picture.

import { DOMSerializer } from '@tiptap/pm/model'
import { Picture } from './extensions.js'
import { call } from '../bridge.js'

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

// Fetched pictures for one open document, as object URLs: ref -> Promise<url>,
// with the bytes kept as a Blob for copying. A failed fetch is forgotten, so
// it can be tried again.
export function pictureCache (fetchBytes) {
  const blobs = new Map() // ref -> Promise<Blob>
  const urls = new Map() // ref -> Promise<url>
  const blobOf = (bytes, mime) => new Blob([bytes], { type: MIMES.includes(mime) ? mime : 'application/octet-stream' })
  const keep = (ref, b) => {
    const u = b.then((x) => URL.createObjectURL(x))
    blobs.set(ref, b)
    urls.set(ref, u)
    u.catch(() => { if (urls.get(ref) === u) { urls.delete(ref); blobs.delete(ref) } })
  }
  return {
    get (attrs) {
      if (!urls.has(attrs.ref)) keep(attrs.ref, fetchBytes(attrs).then((bytes) => blobOf(bytes, attrs.mime)))
      return urls.get(attrs.ref)
    },
    // The picture's bytes as a Blob, fetched if need be.
    blob (attrs) {
      this.get(attrs)
      return blobs.get(attrs.ref)
    },
    // Bytes this device just stored: no need to fetch them back.
    put (ref, bytes, mime) {
      if (!urls.has(ref)) keep(ref, Promise.resolve(blobOf(bytes, mime)))
    },
    clear () {
      for (const p of urls.values()) p.then((u) => URL.revokeObjectURL(u), () => {})
      urls.clear()
      blobs.clear()
    }
  }
}

// --- copying pictures between documents --------------------------------------

// A picture's reference names a core of its own file, encrypted with that
// file's key, so a picture pasted into another document must be stored
// again there. The clipboard says which file a copied picture came from
// (data-file on its <img>), and the pictures of the last copy or cut are
// kept here for the session: the first document may be closed by the time
// of the paste, or the cut may have taken the picture out of it.
const copied = new Map() // ref -> Promise<Blob | null>

// A copy or cut: remember its pictures' bytes. `cache` is the document's.
export function noteCopied (pictures, cache) {
  if (!pictures.length) return
  copied.clear()
  for (const a of pictures) {
    if (!a.ref) continue
    const b = Promise.resolve(cache.blob(a)).catch(() => null)
    copied.set(a.ref, b)
  }
}

// What the editor writes to the clipboard, with data-file=<sheetId> on each
// picture. `getSchema` gives the editor's schema at copy time.
export function pictureClipboard (getSchema, sheetId) {
  return {
    serializeFragment (fragment, options, target) {
      const base = DOMSerializer.fromSchema(getSchema())
      const image = base.nodes.image
      const nodes = { ...base.nodes }
      if (image) {
        nodes.image = (node) => {
          const spec = image(node)
          if (!Array.isArray(spec) || !spec[1] || typeof spec[1] !== 'object' || Array.isArray(spec[1])) return spec
          return [spec[0], { ...spec[1], 'data-file': sheetId }, ...spec.slice(2)]
        }
      }
      return new DOMSerializer(nodes, base.marks).serializeFragment(fragment, options, target)
    }
  }
}

// The pictures in pasted editor HTML that came from another file:
// [{ ref, hash, mime, w, h, file }], one per reference. A picture with no
// data-file (copied before this was added) is taken to be from this file.
export function foreignPictures (html, sheetId) {
  if (!/data-file=/.test(html || '')) return []
  const page = new window.DOMParser().parseFromString(html, 'text/html')
  const out = new Map()
  for (const el of page.querySelectorAll('img[data-ref][data-file]')) {
    const file = el.getAttribute('data-file')
    const ref = el.getAttribute('data-ref')
    if (!file || file === sheetId || out.has(ref)) continue
    const n = (k) => parseInt(el.getAttribute(k), 10) || 1
    out.set(ref, { ref, hash: el.getAttribute('data-hash') || '', mime: el.getAttribute('data-mime') || '', w: n('data-w'), h: n('data-h'), file })
  }
  return [...out.values()]
}

// Store pictures pasted from another file in this one (doc:addPicture,
// which points any nodes already saved with the old reference at the new
// one). The bytes come from the file they were copied from, if this device
// has it, or from the last copy. Resolves to { done: Map(old ref ->
// { ref, hash, mime, w, h, bytes }), lost }: lost when some could not be found.
export async function adoptPictures (found, { sheetId, call: send = call, clip = copied } = {}) {
  const done = new Map()
  let lost = false
  for (const p of found) {
    let bytes = null
    try { bytes = fromB64((await send('doc:picture', { sheetId: p.file, ref: p.ref, hash: p.hash })).data) } catch {}
    if (!bytes && clip.has(p.ref)) {
      const blob = await clip.get(p.ref)
      if (blob) bytes = new Uint8Array(await blob.arrayBuffer())
    }
    if (!bytes || !MIMES.includes(p.mime)) { lost = true; continue }
    try {
      const a = await send('doc:addPicture', { sheetId, bytes: toB64(bytes), mime: p.mime, width: p.w, height: p.h, replace: p.ref })
      done.set(p.ref, { ref: a.ref, hash: a.hash, mime: a.mime, w: a.w, h: a.h, bytes })
    } catch { lost = true }
  }
  return { done, lost }
}

// The picture node with its view: a grey box with "Picture loading" until the
// bytes arrive (fetched when near the screen), "This picture is not available
// yet" if they do not and a corner handle to resize it while editing.
// Phosphor's LinkSimple.
const LINK_SVG = '<svg viewBox="0 0 256 256" width="14" height="14" fill="currentColor"><path d="M165.66,90.34a8,8,0,0,1,0,11.32l-64,64a8,8,0,0,1-11.32-11.32l64-64A8,8,0,0,1,165.66,90.34ZM215.6,40.4a56,56,0,0,0-79.2,0L106.34,70.45a8,8,0,0,0,11.32,11.32l30.06-30a40,40,0,0,1,56.57,56.56l-30.07,30.06a8,8,0,0,0,11.31,11.32L215.6,119.6a56,56,0,0,0,0-79.2ZM138.34,174.22l-30.06,30.06a40,40,0,1,1-56.56-56.57l30.05-30.05a8,8,0,0,0-11.32-11.32L40.4,136.4a56,56,0,0,0,79.2,79.2l30.06-30.07a8,8,0,0,0-11.32-11.31Z"/></svg>'

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
      // A linked picture's mark, shown on hover and when selected
      // (proposals/2026-10-26-picture-links.md).
      const mark = document.createElement('span')
      mark.className = 'doc-picture-link'
      mark.setAttribute('aria-hidden', 'true')
      mark.innerHTML = LINK_SVG
      frame.append(wait, img, handle, mark)
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
        // DocView's click handler opens it (linkClick).
        if (a.href) frame.dataset.href = a.href
        else delete frame.dataset.href
        mark.hidden = !a.href
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
