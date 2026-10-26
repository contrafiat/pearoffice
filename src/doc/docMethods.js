// The document's IPC methods (proposals/2026-10-06-documents.md), run in the
// worklet. The editor in the UI keeps its own copy of the Yjs doc: it loads
// the whole state with doc:state, sends its edits as Yjs updates with
// doc:update and gets everyone else's as doc:updated events (sheets.js).
// The file-wide methods (title, sharing, roles, tidy up) are file:* ones.

const b4a = require('b4a')
const Y = require('yjs')
const model = require('../sheet/sheetModel')
const docModel = require('./docModel')
const m = require('../worklet/membership')
const { createFileHelpers } = require('../worklet/fileMethods')
const { MIMES, TOO_BIG, MAX_BYTES } = require('../worklet/pictures')
const history = require('./history')
const { Y_PREFIX } = require('../worklet/sheets')

const hex = (buf) => b4a.toString(buf, 'hex')

function createDocMethods (sheets, { getJoin, getPictures }) {
  const { profileName, requireEdit, commit, docFor, replicaState, replicaUpdate } = createFileHelpers(sheets)

  // Every edit in the file's view, with who wrote it (version history,
  // proposals/2026-10-26-version-history.md).
  async function editsOf (ctx, sheetId) {
    const base = ctx.bases.get(sheetId)
    if (!base) throw new Error('unknown file: ' + sheetId)
    await base.ready()
    const view = base.view
    const writers = new Map()
    for await (const { value } of view.createReadStream({ gt: 'device/', lt: 'device/~' })) {
      if (value && typeof value.writerKey === 'string') writers.set(value.writerKey, value.identity || null)
    }
    const edits = []
    for await (const { key, value } of view.createReadStream({ gt: Y_PREFIX, lt: Y_PREFIX + '~' })) {
      if (!value || typeof value.data !== 'string') continue
      const writer = key.slice(Y_PREFIX.length).split('/')[0]
      edits.push({ key, data: value.data, at: typeof value.at === 'number' ? value.at : null, start: value.start || null, identity: writers.get(writer) || null })
    }
    return edits
  }

  const methods = {
    // The document's versions, newest first (history.js). Anyone in the file.
    'doc:versions': async ({ sheetId, pauseMs } = {}, ctx) => {
      const { doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'doc') throw new Error('Not a document')
      const opts = Number.isFinite(pauseMs) && pauseMs >= 100 ? { pauseMs } : {}
      return { versions: history.versions(await editsOf(ctx, sheetId), opts) }
    },

    // The document as it was at the end of a version: a Yjs update.
    'doc:version': async ({ sheetId, end } = {}, ctx) => {
      const { doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'doc') throw new Error('Not a document')
      if (!end || typeof end.key !== 'string' || !(end.at === null || Number.isFinite(end.at))) throw new Error('Not a version')
      return { state: b4a.toString(history.stateAt(await editsOf(ctx, sheetId), end), 'base64') }
    },

    'doc:create': async ({ title = 'Untitled document' } = {}, ctx) => {
      const { groupId } = await ctx.createGroup({ name: title })
      const base = ctx.bases.get(groupId)
      const e = sheets.entryFor(groupId)
      e.loading = Promise.resolve()
      const update = docModel.initDoc(e.guarded.doc, { title })
      for (const op of m.foundingOps({ sheetId: groupId, identity: ctx.identity, writerKey: hex(base.local.key), name: await profileName(ctx) })) {
        await ctx.append(groupId, op)
      }
      if (getJoin()) getJoin().addSheet(groupId)
      await commit(ctx, groupId, update)
      await sheets.attach(groupId)
      return { sheetId: groupId }
    },

    // The whole document, for the editor's copy (replicaState).
    'doc:state': ({ sheetId, withState = true }, ctx) =>
      replicaState(ctx, sheetId, { withState, newer: (doc) => docModel.version(doc) > docModel.VERSION }),

    // An edit from the editor, as a Yjs update (replicaUpdate).
    'doc:update': ({ sheetId, update }, ctx) => replicaUpdate(ctx, sheetId, update, 'doc', 'a document'),

    // The editor put an @ chip in the document
    // (proposals/2026-10-26-document-chips.md): it moves to the schema
    // version with chips, so older builds open it read-only.
    'doc:useChips': async ({ sheetId } = {}, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'doc') throw new Error('Not a document')
      if (docModel.version(doc) >= docModel.CHIPS_VERSION) return { version: docModel.version(doc) }
      await commit(ctx, sheetId, docModel.capture(doc, () => docModel.raiseVersion(doc, docModel.CHIPS_VERSION)))
      return { version: docModel.CHIPS_VERSION }
    },

    // A picture for the document (proposals/2026-10-06-document-images.md):
    // stored in this device's picture core for the file, and the document
    // moves to the schema version with pictures. Returns the image node's
    // reference attributes; the editor inserts the node. `replace`: point
    // image nodes with that ref here instead (an import's placeholders).
    'doc:addPicture': async ({ sheetId, bytes, mime, width, height, replace } = {}, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'doc') throw new Error('Not a document')
      if (!MIMES.includes(mime)) throw new Error('This kind of picture cannot be added.')
      if (typeof bytes !== 'string' || !bytes) throw new Error('This picture is empty.')
      if (bytes.length > Math.ceil(MAX_BYTES / 3) * 4 + 4) throw new Error(TOO_BIG)
      const data = b4a.from(bytes, 'base64')
      const stored = await getPictures().put(sheetId, data)
      const attrs = { ref: stored.ref, hash: stored.hash, mime, w: Math.max(1, Math.round(Number(width)) || 1), h: Math.max(1, Math.round(Number(height)) || 1) }
      const update = docModel.capture(doc, () => {
        docModel.raiseVersion(doc, docModel.PICTURES_VERSION)
        if (!replace) return
        for (const node of docModel.images(doc)) {
          if (node.getAttribute('ref') !== String(replace)) continue
          for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v)
        }
      })
      await commit(ctx, sheetId, update)
      return { ...attrs, size: stored.size }
    },

    // A picture's bytes (base64), checked against the hash the document
    // holds for it (or the one given).
    'doc:picture': async ({ sheetId, ref, hash } = {}, ctx) => {
      const { doc } = await docFor(sheetId)
      if (!hash) {
        const node = docModel.images(doc).find((n) => n.getAttribute('ref') === ref)
        if (!node) throw new Error('This picture is not in the document')
        hash = node.getAttribute('hash')
      }
      const bytes = await getPictures().get(sheetId, ref, hash)
      return { data: b4a.toString(bytes, 'base64') }
    },

    // A new document made from a file. The UI turns the file into the
    // document's body as one Yjs update; it goes in the guarded way like any
    // edit, and commit splits it into edits under the size limit.
    'doc:import': async ({ title = 'Imported document', update } = {}, ctx) => {
      if (typeof update !== 'string' || !update) throw new Error('Nothing to import')
      const bytes = b4a.from(update, 'base64')
      // Checked before the document is made, so a bad file leaves nothing.
      const scratch = new Y.Doc()
      try { Y.applyUpdate(scratch, bytes) } catch { throw new Error('This file could not be read') } finally { scratch.destroy() }
      const { sheetId } = await methods['doc:create']({ title: String(title) }, ctx)
      const { e } = await docFor(sheetId)
      if (!e.guarded.apply(bytes, 'ui')) throw new Error('This file could not be read')
      await commit(ctx, sheetId, bytes)
      return { sheetId }
    }
  }
  return methods
}

module.exports = { createDocMethods }
