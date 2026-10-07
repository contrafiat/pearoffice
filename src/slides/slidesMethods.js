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

const hex = (buf) => b4a.toString(buf, 'hex')

function createSlidesMethods (sheets, { getJoin }) {
  const { profileName, commit, replicaState, replicaUpdate } = createFileHelpers(sheets)

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

    'slides:update': ({ sheetId, update }, ctx) => replicaUpdate(ctx, sheetId, update, 'slides', 'a slide deck')
  }
}

module.exports = { createSlidesMethods }
