import { call } from './bridge.js'
import { isMobile } from './save.js'

// Pictures in a paste. The page sees a copied picture as a file only
// sometimes: a picture copied in a browser or photo viewer often arrives as
// HTML holding just an <img> with a link, and a picture file copied in a file
// manager as its path. Then the desktop app reads the system clipboard
// itself (app:clipboardPicture in desktop/main.js).

// The picture files the paste carries.
export function pastedPictures (data) {
  if (!data) return []
  const out = [...(data.files || [])].filter((f) => /^image\//.test(f.type))
  if (out.length) return out
  for (const item of data.items || []) {
    if (item.kind === 'file' && /^image\//.test(item.type)) { const f = item.getAsFile(); if (f) out.push(f) }
  }
  return out
}

// Whether a paste with no picture file still looks like a copied picture:
// HTML that is only pictures, a picture file's path or nothing readable.
export function looksLikePicture (data) {
  if (!data) return false
  const html = data.getData('text/html') || ''
  const text = (data.getData('text/plain') || '').trim()
  const uris = data.getData('text/uri-list') || ''
  if (/^file:\/\/.*\.(png|jpe?g|gif|webp|bmp)\s*$/im.test(uris)) return true
  if (/<img\b/i.test(html) && !html.replace(/<[^>]*>/g, '').replace(/&nbsp;/g, ' ').trim()) return true
  return !html && !text
}

// The picture on the system clipboard as a File, or null. Desktop only.
export async function clipboardPictureFile () {
  if (isMobile()) return null
  let r = null
  try { r = await call('app:clipboardPicture') } catch { return null }
  if (!r || !r.data) return null
  const bytes = Uint8Array.from(atob(r.data), (ch) => ch.charCodeAt(0))
  return new File([bytes], r.name || 'Pasted picture', { type: r.mime })
}
