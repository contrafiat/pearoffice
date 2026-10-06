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

const hex = (buf) => b4a.toString(buf, 'hex')

function createDocMethods (sheets, { getJoin, getPictures }) {
  const { profileName, myRole, frozenInfo, isFrozen, requireEdit, commit, docFor } = createFileHelpers(sheets)

  const methods = {
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

    // The whole document, for the editor's copy. From here on the editor
    // gets doc:updated events for it. withState false: only the role and
    // the rest, when the editor already has the content.
    'doc:state': async ({ sheetId, withState = true }, ctx) => {
      const { e, doc } = await docFor(sheetId)
      e.docOpen = true
      const role = (await isFrozen(ctx, sheetId)) ? 'viewer' : await myRole(ctx, sheetId)
      const base = ctx.bases.get(sheetId)
      return {
        sheetId,
        state: withState ? b4a.toString(model.encodeState(doc), 'base64') : undefined,
        title: model.title(doc),
        // Just joined: the content has not arrived yet.
        loading: !doc.getMap('meta').has('kind'),
        // Made by a newer build: open it read-only rather than drop content
        // this editor does not know.
        newer: docModel.version(doc) > docModel.VERSION,
        myRole: role,
        frozen: await frozenInfo(ctx, sheetId),
        writable: !!(base && base.writable)
      }
    },

    // An edit from the editor, as a Yjs update. It goes into the worklet's
    // copy the guarded way (so a bad one changes nothing) and then out to
    // everyone like any other edit.
    'doc:update': async ({ sheetId, update }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { e, doc } = await docFor(sheetId)
      if (model.kind(doc) !== 'doc') throw new Error('Not a document')
      if (typeof update !== 'string' || !update) throw new Error('Nothing to save')
      const bytes = b4a.from(update, 'base64')
      if (!e.guarded.apply(bytes, 'ui')) throw new Error('That edit could not be saved')
      return commit(ctx, sheetId, bytes)
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
