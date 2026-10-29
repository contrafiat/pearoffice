// PDFs and pictures as files (proposals/2026-10-29-pdf-and-picture-files.md):
// what Import does with one, and reading one back for the viewer. The bytes
// cross to the worklet in parts (media:begin, media:part, media:end).
import { call } from '../bridge.js'
import { toB64, fromB64 } from '../doc/pictures.js'

export const MAX_BYTES = 25 * 1024 * 1024
const MAX_SIDE = 6000
const TYPES = { pdf: 'application/pdf', jpg: 'image/jpeg', jpeg: 'image/jpeg', png: 'image/png', webp: 'image/webp', gif: 'image/gif', heic: 'image/heic', heif: 'image/heic' }
export const MEDIA_ACCEPT = Object.keys(TYPES).map((x) => '.' + x).join(',')

const extOf = (name) => (/\.([a-z0-9]+)$/i.exec(String(name || '')) || [])[1]?.toLowerCase()
export const isMediaFile = (name) => !!TYPES[extOf(name)]
const TOO_BIG = 'This file is bigger than 25 MB, the most PearOffice keeps.'

async function decode (blob) {
  try { return await createImageBitmap(blob, { imageOrientation: 'from-image' }) } catch { return null }
}

// A JPEG drawn again at up to MAX_SIDE a side: its rotation applied and its
// EXIF data (location included) gone, as profile pictures are.
async function redraw (bitmap) {
  const scale = Math.min(1, MAX_SIDE / Math.max(bitmap.width, bitmap.height))
  const canvas = document.createElement('canvas')
  canvas.width = Math.max(1, Math.round(bitmap.width * scale))
  canvas.height = Math.max(1, Math.round(bitmap.height * scale))
  canvas.getContext('2d').drawImage(bitmap, 0, 0, canvas.width, canvas.height)
  const blob = await new Promise((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.92))
  if (!blob) throw new Error('This picture could not be saved.')
  return { bytes: new Uint8Array(await blob.arrayBuffer()), w: canvas.width, h: canvas.height }
}

// What goes in: { bytes, mime, name, w, h, pages }.
export async function prepareMedia (bytes, name) {
  let mime = TYPES[extOf(name)]
  if (!mime) throw new Error('PearOffice keeps PDFs and pictures (JPEG, PNG, WebP or GIF) only.')
  if (mime === 'application/pdf') {
    if (bytes.byteLength > MAX_BYTES) throw new Error(TOO_BIG)
    const { openPdf } = await import('./pdf.js')
    let pages = null
    try { const pdf = await openPdf(bytes); pages = pdf.numPages; await pdf.close() } catch { throw new Error('This file is not a PDF PearOffice can read.') }
    return { bytes, mime, name, pages }
  }
  const bitmap = await decode(new Blob([bytes], { type: mime }))
  if (!bitmap) throw new Error(mime === 'image/heic' ? 'This device cannot read HEIC pictures. Save it as a JPEG and try again.' : 'This file is not a picture PearOffice can read.')
  try {
    if (mime === 'image/jpeg' || mime === 'image/heic') {
      const out = await redraw(bitmap)
      if (out.bytes.byteLength > MAX_BYTES) throw new Error(TOO_BIG)
      if (mime === 'image/heic') name = String(name).replace(/\.[^.]+$/, '') + '.jpg'
      return { ...out, mime: 'image/jpeg', name }
    }
    if (bytes.byteLength > MAX_BYTES) throw new Error(TOO_BIG)
    return { bytes, mime, name, w: bitmap.width, h: bitmap.height }
  } finally {
    bitmap.close()
  }
}

// Import a PDF or picture as a new file. Resolves to { sheetId }.
export async function importMedia (bytes, name) {
  const m = await prepareMedia(bytes, name)
  const { id, part } = await call('media:begin', { mime: m.mime, name: m.name, size: m.bytes.byteLength })
  for (let i = 0; i < m.bytes.byteLength; i += part) await call('media:part', { id, data: toB64(m.bytes.subarray(i, i + part)) })
  return call('media:end', { id, w: m.w, h: m.h, pages: m.pages })
}

// The file's bytes, read a part at a time. onProgress(fraction).
const kept = new Map() // sheetId -> Uint8Array, the last two opened
export async function readMedia (sheetId, onProgress = () => {}) {
  if (kept.has(sheetId)) return kept.get(sheetId)
  const parts = []
  let size = Infinity
  let got = 0
  while (got < size) {
    const r = await call('media:read', { sheetId, offset: got })
    const bytes = fromB64(r.data)
    if (!bytes.byteLength) break
    size = r.size
    parts.push(bytes)
    got += bytes.byteLength
    onProgress(got / size)
  }
  const out = new Uint8Array(got)
  let at = 0
  for (const p of parts) { out.set(p, at); at += p.byteLength }
  kept.set(sheetId, out)
  if (kept.size > 2) kept.delete(kept.keys().next().value)
  return out
}
