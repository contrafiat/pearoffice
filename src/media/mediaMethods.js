// PDFs and pictures as files (proposals/2026-10-29-pdf-and-picture-files.md):
// the IPC methods, run in the worklet. The bytes cross the bridge in parts of
// at most PART bytes, so a 25 MB file never travels as one 33 MB string:
// media:begin, media:part (each in turn), media:end makes the file. The
// viewer reads them back with media:read, a part at a time.

const b4a = require('b4a')
const sodium = require('sodium-universal')
const mediaModel = require('./mediaModel')
const m = require('../worklet/membership')
const { createFileHelpers } = require('../worklet/fileMethods')

const PART = 1024 * 1024
const UPLOAD_MS = 10 * 60 * 1000 // an upload not finished by then is dropped
const CACHE_MS = 60 * 1000 // bytes kept for the viewer's next part
const READ_TIMEOUT_MS = 60000
const TOO_BIG = 'This file is bigger than 25 MB, the most PearOffice keeps.'
const NOT_KEPT = 'PearOffice keeps PDFs and pictures (JPEG, PNG, WebP or GIF) only.'

const hex = (buf) => b4a.toString(buf, 'hex')

// Do the first bytes match the type? A file renamed .pdf is not a PDF.
function looksLike (bytes, mime) {
  const at = (i, s) => b4a.toString(bytes.subarray(i, i + s.length), 'latin1') === s
  if (mime === 'application/pdf') return at(0, '%PDF-')
  if (mime === 'image/jpeg') return bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff
  if (mime === 'image/png') return at(0, '\x89PNG\r\n\x1a\n')
  if (mime === 'image/gif') return at(0, 'GIF87a') || at(0, 'GIF89a')
  if (mime === 'image/webp') return at(0, 'RIFF') && at(8, 'WEBP')
  return false
}

function createMediaMethods (sheets, { getJoin, getPictures }) {
  const { profileName, docFor, commit, myRole } = createFileHelpers(sheets)
  const uploads = new Map() // id -> { mime, name, size, parts, got, timer }
  const cache = new Map() // sheetId -> { bytes, timer }

  function drop (id) {
    const u = uploads.get(id)
    if (u) clearTimeout(u.timer)
    uploads.delete(id)
  }

  async function bytesOf (sheetId) {
    const kept = cache.get(sheetId)
    if (kept) {
      kept.timer.refresh()
      return kept.bytes
    }
    const { doc } = await docFor(sheetId)
    const media = mediaModel.mediaOf(doc)
    if (!media) throw new Error('This file has nothing to show')
    const bytes = await getPictures().get(sheetId, media.ref, media.hash, { timeout: READ_TIMEOUT_MS, doc })
    const timer = setTimeout(() => cache.delete(sheetId), CACHE_MS)
    if (timer.unref) timer.unref()
    cache.set(sheetId, { bytes, timer })
    return bytes
  }

  const methods = {
    'media:begin': async ({ mime, name, size } = {}) => {
      if (!mediaModel.kindOfMime(mime)) throw new Error(NOT_KEPT)
      if (!Number.isSafeInteger(size) || size < 1) throw new Error('This file is empty.')
      if (size > mediaModel.MAX_BYTES) throw new Error(TOO_BIG)
      const id = hex(randomBytes(16))
      const timer = setTimeout(() => drop(id), UPLOAD_MS)
      if (timer.unref) timer.unref()
      uploads.set(id, { mime, name: String(name || '').slice(0, 200), size, parts: [], got: 0, timer })
      return { id, part: PART }
    },

    'media:part': async ({ id, data } = {}) => {
      const u = uploads.get(id)
      if (!u) throw new Error('This upload has stopped. Try again.')
      if (typeof data !== 'string' || data.length > Math.ceil(PART / 3) * 4 + 4) throw new Error('This part is too big.')
      const bytes = b4a.from(data, 'base64')
      if (u.got + bytes.byteLength > u.size) { drop(id); throw new Error('This file is bigger than it said.') }
      u.parts.push(bytes)
      u.got += bytes.byteLength
      return { got: u.got }
    },

    // The parts as a new file. `w` and `h` for a picture, `pages` for a PDF,
    // as the UI measured them.
    'media:end': async ({ id, title, w, h, pages } = {}, ctx) => {
      const u = uploads.get(id)
      if (!u) throw new Error('This upload has stopped. Try again.')
      drop(id)
      if (u.got !== u.size) throw new Error('Part of this file did not arrive. Try again.')
      const bytes = b4a.concat(u.parts)
      if (!looksLike(bytes, u.mime)) throw new Error(u.mime === 'application/pdf' ? 'This file is not a PDF PearOffice can read.' : 'This file is not a picture PearOffice can read.')
      const kind = mediaModel.kindOfMime(u.mime)
      const name = String(title || u.name.replace(/\.[^.]+$/, '') || (kind === 'pdf' ? 'PDF' : 'Picture'))
      const { groupId } = await ctx.createGroup({ name })
      const base = ctx.bases.get(groupId)
      const e = sheets.entryFor(groupId)
      e.loading = Promise.resolve()
      for (const op of m.foundingOps({ sheetId: groupId, identity: ctx.identity, writerKey: hex(base.local.key), name: await profileName(ctx) })) {
        await ctx.append(groupId, op)
      }
      const stored = await getPictures().put(groupId, bytes, { max: mediaModel.MAX_BYTES })
      const whole = (v) => (Number.isSafeInteger(v) && v >= 1 ? v : null)
      const update = mediaModel.initMedia(e.guarded.doc, {
        title: name,
        media: { ref: stored.ref, hash: stored.hash, mime: u.mime, size: bytes.byteLength, name: u.name, w: kind === 'picture' ? whole(w) : null, h: kind === 'picture' ? whole(h) : null, pages: kind === 'pdf' ? whole(pages) : null }
      })
      if (getJoin()) getJoin().addSheet(groupId)
      await commit(ctx, groupId, update)
      await sheets.attach(groupId)
      return { sheetId: groupId }
    },

    // What the viewer needs before the bytes.
    'media:info': async ({ sheetId } = {}, ctx) => {
      const { doc } = await docFor(sheetId)
      const media = mediaModel.isMedia(doc) ? mediaModel.mediaOf(doc) : null
      return { sheetId, kind: doc.getMap('meta').get('kind') || null, title: doc.getMap('meta').get('title') || '', media, myRole: await myRole(ctx, sheetId), part: PART }
    },

    // A part of the bytes: { data (base64), size }.
    'media:read': async ({ sheetId, offset = 0 } = {}) => {
      const bytes = await bytesOf(sheetId)
      const start = Math.max(0, Math.floor(Number(offset) || 0))
      return { data: b4a.toString(bytes.subarray(start, start + PART), 'base64'), size: bytes.byteLength }
    }
  }
  return methods
}

function randomBytes (n) {
  const buf = b4a.alloc(n)
  sodium.randombytes_buf(buf)
  return buf
}

module.exports = { createMediaMethods, looksLike, PART }
