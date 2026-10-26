// Version history's IPC methods, for any file
// (proposals/2026-10-26-version-history.md). The list and a version's
// state work the same for documents, sheets and decks; a sheet's old
// version is also given as cells with their values worked out here, since
// formulas are evaluated in the worklet; Restore for sheets and decks is
// here too (documents restore in the editor, DocView's History).

const b4a = require('b4a')
const model = require('../sheet/sheetModel')
const { evaluateSheet } = require('../sheet/formula')
const history = require('../doc/history')
const { capture } = require('../doc/docModel')
const { Y_PREFIX } = require('./sheets')
const { createFileHelpers } = require('./fileMethods')

const MAX_CELLS = 5000 // cells listed for an old sheet

function createHistoryMethods (sheets) {
  const { requireEdit, commit, docFor } = createFileHelpers(sheets)

  // Every edit in the file's view, with who wrote it.
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
  const checkEnd = (end) => {
    if (!end || typeof end.key !== 'string' || !(end.at === null || Number.isFinite(end.at))) throw new Error('Not a version')
  }
  // A file's document at the end of a version, as a scratch Yjs doc.
  async function docAt (ctx, sheetId, end, edits) {
    checkEnd(end)
    const doc = model.createDoc()
    model.applyUpdate(doc, history.stateAt(edits || await editsOf(ctx, sheetId), end))
    return doc
  }

  // An old sheet's tab: its cells as shown, and as they were in the version
  // before (`prevEnd`), so the changed ones can be marked.
  function cellsOf (doc, tabId) {
    const out = new Map()
    if (!doc || !model.tabIds(doc).includes(tabId)) return out
    const t = model.tabMap(doc, tabId)
    const values = evaluateSheet(doc).get(tabId) || new Map()
    const rows = t.get('rows').toArray()
    const cols = t.get('cols').toArray()
    const rowIndex = new Map(rows.map((id, i) => [id, i + 1]))
    const colIndex = new Map(cols.map((id, i) => [id, i + 1]))
    for (const key of t.get('cells').keys()) {
      const [rowId, colId] = key.split(':')
      const row = rowIndex.get(rowId)
      const col = colIndex.get(colId)
      if (row === undefined || col === undefined) continue
      const v = values.get(row + ',' + col)
      const value = v ? (v.error || v.value) : null
      const shown = value === null || value === undefined ? '' : typeof value === 'boolean' ? (value ? 'TRUE' : 'FALSE') : String(value)
      if (shown !== '') out.set(row + ',' + col, { row, col, display: shown, input: model.getInput(doc, tabId, row, col) })
      if (out.size >= MAX_CELLS) break
    }
    return out
  }

  return {
    'file:versions': async ({ sheetId, pauseMs } = {}, ctx) => {
      await docFor(sheetId)
      const opts = Number.isFinite(pauseMs) && pauseMs >= 100 ? { pauseMs } : {}
      return { versions: history.versions(await editsOf(ctx, sheetId), opts) }
    },

    'file:version': async ({ sheetId, end } = {}, ctx) => {
      await docFor(sheetId)
      checkEnd(end)
      return { state: b4a.toString(history.stateAt(await editsOf(ctx, sheetId), end), 'base64') }
    },

    // An old version of a sheet's tab: { tabs, tabId, cells: [{ row, col,
    // display, input, before }] } where `before` is the cell's value in the
    // version before (undefined when it did not change).
    'sheet:versionCells': async ({ sheetId, end, prevEnd, tabId } = {}, ctx) => {
      const { doc: live } = await docFor(sheetId)
      if (model.kind(live) !== 'sheet') throw new Error('Not a sheet')
      const edits = await editsOf(ctx, sheetId)
      const doc = await docAt(ctx, sheetId, end, edits)
      const prev = prevEnd ? await docAt(ctx, sheetId, prevEnd, edits) : null
      try {
        const tabs = model.tabIds(doc).map((id) => ({ id, name: model.tabMap(doc, id).get('name') || '' }))
        const tab = tabs.some((x) => x.id === tabId) ? tabId : (tabs[0] && tabs[0].id) || null
        const now = cellsOf(doc, tab)
        const before = cellsOf(prev, tab)
        const cells = []
        for (const [k, c] of now) {
          const b = before.get(k)
          cells.push({ ...c, before: !prev ? '' : !b ? '' : b.display !== c.display ? b.display : undefined })
        }
        // Cells emptied in this version.
        if (prev) for (const [k, b] of before) if (!now.has(k)) cells.push({ row: b.row, col: b.col, display: '', input: '', before: b.display })
        return { tabs, tabId: tab, cells }
      } finally {
        doc.destroy()
        if (prev) prev.destroy()
      }
    },

    // Restore a sheet or a deck: one edit that makes it match the version.
    'file:restore': async ({ sheetId, end } = {}, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc: live } = await docFor(sheetId)
      const kind = model.kind(live)
      if (kind !== 'sheet' && kind !== 'slides') throw new Error('Documents restore in the editor')
      const old = await docAt(ctx, sheetId, end)
      try {
        const update = capture(live, () => history.restoreInto(live, old, { arrays: kind === 'sheet' ? ['tabs'] : [] }))
        if (update) await commit(ctx, sheetId, update)
        return { ok: true }
      } finally {
        old.destroy()
      }
    }
  }
}

module.exports = { createHistoryMethods }
