// IPC methods for the UI. Positions are 1-based row and column numbers in the
// current order; the worklet maps them to ids.
//
// Every edit runs against the live Yjs document, and the resulting update is
// appended to the sheet's Autobase as a `y` op.

const b4a = require('b4a')
const model = require('../shared/sheetModel')
const { displayNumber } = require('../shared/formula')
const SSF = require('../shared/formula/vendor/fast-formula-parser/ssf/ssf')

// The text a cell shows, and what kind of value it is (the UI right-aligns
// numbers). Number formats use Excel format codes through SSF.
function present (v, fmt) {
  if (v.error) return { display: v.error, kind: 'error' }
  const value = v.value
  if (value === null || value === undefined) return { display: '', kind: 'empty' }
  if (typeof value === 'number') {
    if (fmt && fmt.num) {
      try { return { display: SSF.format(fmt.num, value), kind: 'number' } } catch {}
    }
    return { display: displayNumber(value), kind: 'number' }
  }
  if (typeof value === 'boolean') return { display: value ? 'TRUE' : 'FALSE', kind: 'bool' }
  return { display: String(value), kind: 'text' }
}

function createSheetMethods (sheets) {
  async function commit (ctx, sheetId, update) {
    if (!update) return { changed: false }
    sheets.noteLocal(sheetId, update)
    await ctx.append(sheetId, { type: 'y', data: b4a.toString(update, 'base64') })
    return { changed: true }
  }

  async function docFor (sheetId) {
    const e = await sheets.load(sheetId)
    return { e, doc: e.guarded.doc }
  }

  function firstTab (doc, tabId) {
    const ids = model.tabIds(doc)
    if (tabId && ids.includes(tabId)) return tabId
    if (!ids.length) throw new Error('sheet has no tabs yet')
    return ids[0]
  }

  function mutate (fn) {
    return async (args, ctx) => {
      const { doc } = await docFor(args.sheetId)
      const tabId = firstTab(doc, args.tabId)
      return commit(ctx, args.sheetId, fn(doc, tabId, args))
    }
  }

  return {
    'sheet:create': async ({ title = 'Untitled sheet' } = {}, ctx) => {
      const { groupId } = await ctx.createGroup({ name: title })
      const e = sheets.entryFor(groupId)
      e.loading = Promise.resolve()
      const update = model.initSheet(e.guarded.doc, { title })
      await ctx.append(groupId, { type: 'sheet', version: 1, owner: b4a.toString(ctx.identity.publicKey, 'hex') })
      // noteLocal (inside commit) starts undo tracking after the founding
      // layout already exists, so the layout itself cannot be undone.
      await commit(ctx, groupId, update)
      return { sheetId: groupId }
    },

    'sheet:list': async (args, ctx) => {
      const out = []
      for await (const { value } of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
        if (!value || !value.groupId) continue
        // Prefer the live title: the stored name is what it was called at join.
        const e = sheets.peek(value.groupId)
        out.push({ sheetId: value.groupId, title: (e && model.title(e.guarded.doc)) || value.name || '' })
      }
      return out
    },

    // Everything the UI needs to draw one tab.
    'sheet:view': async ({ sheetId, tabId }) => {
      const { e, doc } = await docFor(sheetId)
      const tab = firstTab(doc, tabId)
      const t = model.tabMap(doc, tab)
      const values = sheets.values(e).get(tab) || new Map()
      const rows = t.get('rows').toArray()
      const cols = t.get('cols').toArray()
      const rowIndex = new Map(rows.map((id, i) => [id, i + 1]))
      const colIndex = new Map(cols.map((id, i) => [id, i + 1]))
      const cells = []
      for (const key of t.get('cells').keys()) {
        const [rowId, colId] = key.split(':')
        const row = rowIndex.get(rowId)
        const col = colIndex.get(colId)
        if (row === undefined || col === undefined) continue
        const v = values.get(row + ',' + col) || { value: null }
        const fmt = model.getFormat(doc, tab, row, col)
        cells.push({ row, col, input: model.getInput(doc, tab, row, col), ...present(v, fmt), volatile: v.volatile, fmt })
      }
      const widths = {}
      for (const [colId, px] of t.get('widths').entries()) if (colIndex.has(colId)) widths[colIndex.get(colId)] = px
      return {
        sheetId,
        title: model.title(doc),
        tabs: model.tabIds(doc).map((id) => ({ id, name: doc.getMap('tab:' + id).get('name') })),
        tabId: tab,
        rows: rows.length,
        cols: cols.length,
        cells,
        widths,
        canUndo: !!(e.undo && e.undo.canUndo()),
        canRedo: !!(e.undo && e.undo.canRedo())
      }
    },

    'sheet:setCell': mutate((doc, tab, a) => model.setCell(doc, tab, a.row, a.col, a.input)),
    'sheet:setFormat': mutate((doc, tab, a) => model.setFormat(doc, tab, a.row, a.col, a.patch || {})),
    'sheet:insertRows': mutate((doc, tab, a) => model.insertRows(doc, tab, a.at, a.count || 1)),
    'sheet:deleteRows': mutate((doc, tab, a) => model.deleteRows(doc, tab, a.at, a.count || 1)),
    'sheet:insertCols': mutate((doc, tab, a) => model.insertCols(doc, tab, a.at, a.count || 1)),
    'sheet:deleteCols': mutate((doc, tab, a) => model.deleteCols(doc, tab, a.at, a.count || 1)),
    'sheet:renameTab': mutate((doc, tab, a) => model.renameTab(doc, tab, String(a.name))),
    'sheet:setTitle': mutate((doc, tab, a) => model.setTitle(doc, String(a.title))),
    'sheet:setWidth': mutate((doc, tab, a) => model.setWidth(doc, tab, a.col, a.px)),

    'sheet:addTab': async ({ sheetId, name }, ctx) => {
      const { doc } = await docFor(sheetId)
      const { id, update } = model.addTab(doc, String(name || 'Sheet' + (model.tabIds(doc).length + 1)))
      await commit(ctx, sheetId, update)
      return { tabId: id }
    },

    'sheet:undo': async ({ sheetId }, ctx) => undoRedo(sheetId, ctx, 'undo'),
    'sheet:redo': async ({ sheetId }, ctx) => undoRedo(sheetId, ctx, 'redo')
  }

  async function undoRedo (sheetId, ctx, which) {
    const { e, doc } = await docFor(sheetId)
    if (!e.undo) return { changed: false }
    let update = null
    const onUpdate = (u, origin) => { if (origin === e.undo) update = u }
    doc.on('update', onUpdate)
    try {
      if (which === 'undo') e.undo.undo()
      else e.undo.redo()
    } finally {
      doc.off('update', onUpdate)
    }
    return commit(ctx, sheetId, update)
  }
}

module.exports = { createSheetMethods }
