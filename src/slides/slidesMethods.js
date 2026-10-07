// The slide deck's IPC methods (proposals/2026-10-06-slides.md), run in the
// worklet. As with documents, the editor keeps its own copy of the Yjs doc:
// it loads the whole state with slides:state, makes every change (slides,
// order, boxes, text) in its copy with slidesModel.js, sends them as Yjs
// updates with slides:update and gets everyone else's as doc:updated events
// (sheets.js). The file-wide methods (title, sharing, roles, tidy up) are
// file:* ones.

const b4a = require('b4a')
const m = require('../worklet/membership')
const { createFileHelpers } = require('../worklet/fileMethods')
const docModel = require('../doc/docModel')
const slidesModel = require('./slidesModel')
const model = require('../sheet/sheetModel')
const { MIMES, TOO_BIG, MAX_BYTES } = require('../worklet/pictures')

const hex = (buf) => b4a.toString(buf, 'hex')

function createSlidesMethods (sheets, { getJoin, getPictures }) {
  const { profileName, commit, replicaState, replicaUpdate, requireEdit, docFor } = createFileHelpers(sheets)

  return {
    'slides:create': async ({ title = 'Untitled slides' } = {}, ctx) => {
      const { groupId } = await ctx.createGroup({ name: title })
      const base = ctx.bases.get(groupId)
      const e = sheets.entryFor(groupId)
      e.loading = Promise.resolve()
      const doc = e.guarded.doc
      const update = docModel.capture(doc, () => slidesModel.initDeck(doc, { title: String(title) }))
      for (const op of m.foundingOps({ sheetId: groupId, identity: ctx.identity, writerKey: hex(base.local.key), name: await profileName(ctx) })) {
        await ctx.append(groupId, op)
      }
      if (getJoin()) getJoin().addSheet(groupId)
      await commit(ctx, groupId, update)
      await sheets.attach(groupId)
      return { sheetId: groupId }
    },

    'slides:state': ({ sheetId, withState = true }, ctx) =>
      replicaState(ctx, sheetId, { withState, newer: (doc) => slidesModel.version(doc) > slidesModel.VERSION }),

    'slides:update': ({ sheetId, update }, ctx) => replicaUpdate(ctx, sheetId, update, 'slides', 'a slide deck'),

    // A picture for the deck, as for documents (doc:addPicture): stored in
    // this device's picture core for the file. Returns the reference; the
    // editor adds the picture element (slidesModel.addPicture).
    'slides:addPicture': async ({ sheetId, bytes, mime, width, height } = {}, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'slides') throw new Error('Not a slide deck')
      if (!MIMES.includes(mime)) throw new Error('This kind of picture cannot be added.')
      if (typeof bytes !== 'string' || !bytes) throw new Error('This picture is empty.')
      if (bytes.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error(TOO_BIG)
      const stored = await getPictures().put(sheetId, b4a.from(bytes, 'base64'))
      return { ref: stored.ref, hash: stored.hash, mime, w: Math.max(1, Math.round(Number(width)) || 1), h: Math.max(1, Math.round(Number(height)) || 1), size: stored.size }
    },

    // A picture's bytes (base64), checked against the hash the deck holds
    // for it (or the one given).
    'slides:picture': async ({ sheetId, ref, hash } = {}, ctx) => {
      const { doc } = await docFor(sheetId)
      if (!hash) {
        const p = slidesModel.pictureRefs(doc).find((x) => x.ref === ref)
        if (!p) throw new Error('This picture is not in the deck')
        hash = p.hash
      }
      const data = await getPictures().get(sheetId, ref, hash)
      return { data: b4a.toString(data, 'base64') }
    }
  }
}

module.exports = { createSlidesMethods }
