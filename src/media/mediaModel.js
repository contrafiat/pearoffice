// PDFs and pictures as files (proposals/2026-10-29-pdf-and-picture-files.md).
// The file's Yjs doc holds `meta` (title, kind 'pdf' or 'picture', version)
// and `media`, which points at the bytes in this file's picture cores
// (src/worklet/pictures.js); the bytes are never in the doc. Builds from
// 0.1.0 on that do not know these kinds say "Update PearOffice to open this
// file" (src/ui/App.jsx, opensHere).

const model = require('../sheet/sheetModel')
const { capture } = require('../doc/docModel')

const KINDS = ['pdf', 'picture']
const VERSION = 1
const MAX_BYTES = 25 * 1024 * 1024
const MIMES = { pdf: ['application/pdf'], picture: ['image/jpeg', 'image/png', 'image/webp', 'image/gif'] }
const MAX_NAME = 200
const MAX_SIDE = 100000
const MAX_PAGES = 100000

const isMedia = (doc) => KINDS.includes(model.kind(doc))
const kindOfMime = (mime) => KINDS.find((k) => MIMES[k].includes(mime)) || null
const count = (v, max) => (Number.isSafeInteger(v) && v >= 1 && v <= max ? v : null)

// The `media` record, checked: { ref, hash, mime, size, name, w, h, pages },
// or null when it is missing or does not fit the file's kind.
function mediaOf (doc) {
  const m = doc.getMap('media')
  const kind = model.kind(doc)
  const mime = m.get('mime')
  if (!KINDS.includes(kind) || !MIMES[kind].includes(mime)) return null
  const ref = m.get('ref')
  const hash = m.get('hash')
  const size = count(m.get('size'), MAX_BYTES)
  if (typeof ref !== 'string' || typeof hash !== 'string' || !/^[0-9a-f]{64}$/.test(hash) || !size) return null
  const name = typeof m.get('name') === 'string' ? m.get('name').slice(0, MAX_NAME) : ''
  return { ref, hash, mime, size, name, w: count(m.get('w'), MAX_SIDE), h: count(m.get('h'), MAX_SIDE), pages: count(m.get('pages'), MAX_PAGES) }
}

// A new PDF or picture file. `media`: { ref, hash, mime, size, name, w, h, pages }.
function initMedia (doc, { title, media }) {
  const kind = kindOfMime(media.mime)
  if (!kind) throw new Error('PearOffice keeps PDFs and pictures (JPEG, PNG, WebP or GIF) only.')
  return capture(doc, () => {
    const meta = doc.getMap('meta')
    meta.set('title', String(title || media.name || (kind === 'pdf' ? 'PDF' : 'Picture')).slice(0, MAX_NAME))
    meta.set('kind', kind)
    meta.set('version', VERSION)
    const m = doc.getMap('media')
    for (const k of ['ref', 'hash', 'mime', 'size', 'name', 'w', 'h', 'pages']) if (media[k] !== undefined && media[k] !== null) m.set(k, media[k])
  })
}

// Point the record at another copy of the bytes (a move to fresh keys).
function pointMedia (doc, ref) {
  doc.getMap('media').set('ref', ref)
}

module.exports = { KINDS, VERSION, MAX_BYTES, MIMES, isMedia, kindOfMime, mediaOf, initMedia, pointMedia }
