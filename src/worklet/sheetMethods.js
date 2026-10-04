// IPC methods for the UI. Positions are 1-based row and column numbers in the
// current order; the worklet maps them to ids.
//
// Every edit runs against the live Yjs document, and the resulting update is
// appended to the sheet's Autobase as a `y` op.

const b4a = require('b4a')
const model = require('../shared/sheetModel')
const { displayNumber } = require('../shared/formula')
const SSF = require('../shared/formula/vendor/fast-formula-parser/ssf/ssf')
const m = require('./membership')

const hex = (buf) => b4a.toString(buf, 'hex')
const INVITE_HOURS = 24

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

function createSheetMethods (sheets, { getJoin, getMoves }) {
  async function profileName (ctx) {
    const p = await ctx.localDb.get('profile')
    return (p && p.value && p.value.name) || ''
  }

  async function viewGet (ctx, sheetId, key) {
    const base = ctx.bases.get(sheetId)
    if (!base) throw new Error('unknown sheet: ' + sheetId)
    await base.ready()
    const node = await base.view.get(key)
    return node ? node.value : null
  }

  async function myRole (ctx, sheetId) {
    const me = await viewGet(ctx, sheetId, 'member/' + hex(ctx.identity.publicKey))
    return me ? me.role : null
  }

  // A sheet that moved (or that removed this person) is read-only here.
  async function frozenInfo (ctx, sheetId) {
    const rec = (await ctx.localDb.get('moves:' + sheetId))?.value
    if (rec) return rec.removed ? { removed: true } : { movedTo: rec.to }
    return (await viewGet(ctx, sheetId, 'moved')) ? { moving: true } : null
  }

  async function isFrozen (ctx, sheetId) {
    return !!(await frozenInfo(ctx, sheetId))
  }

  async function requireOwner (ctx, sheetId) {
    if ((await myRole(ctx, sheetId)) !== 'owner') throw new Error('Only the owner can do that')
  }

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
      if (await isFrozen(ctx, args.sheetId)) throw new Error('This copy of the sheet is frozen')
      const role = await myRole(ctx, args.sheetId)
      if (role !== 'owner' && role !== 'editor') throw new Error('You can view this sheet but not edit it')
      const base = ctx.bases.get(args.sheetId)
      if (!base.writable) throw new Error('Still getting edit access to this sheet. Try again in a moment.')
      const { doc } = await docFor(args.sheetId)
      const tabId = firstTab(doc, args.tabId)
      return commit(ctx, args.sheetId, fn(doc, tabId, args))
    }
  }

  return {
    'sheet:create': async ({ title = 'Untitled sheet' } = {}, ctx) => {
      const { groupId } = await ctx.createGroup({ name: title })
      const base = ctx.bases.get(groupId)
      const e = sheets.entryFor(groupId)
      e.loading = Promise.resolve()
      const update = model.initSheet(e.guarded.doc, { title })
      for (const op of m.foundingOps({ sheetId: groupId, identity: ctx.identity, writerKey: hex(base.local.key), name: await profileName(ctx) })) {
        await ctx.append(groupId, op)
      }
      if (getJoin()) getJoin().addSheet(groupId)
      // noteLocal (inside commit) starts undo tracking after the founding
      // layout already exists, so the layout itself cannot be undone.
      await commit(ctx, groupId, update)
      return { sheetId: groupId }
    },

    'sheet:list': async (args, ctx) => {
      const out = []
      const joining = new Map((getJoin() ? getJoin().pending() : []).map((p) => [p.sheetId, p]))
      for await (const { value } of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
        if (!value || !value.groupId) continue
        // A sheet that moved to a fresh key is replaced by its new copy.
        const moved = (await ctx.localDb.get('moves:' + value.groupId))?.value
        if (moved && moved.to) continue
        // Prefer the live title: the stored name is what it was called at join.
        const e = sheets.peek(value.groupId)
        out.push({ sheetId: value.groupId, title: (e && model.title(e.guarded.doc)) || value.name || '', joining: joining.has(value.groupId) || undefined, removed: (moved && moved.removed) || undefined })
        joining.delete(value.groupId)
      }
      // Joins that have not been welcomed yet have no base.
      for (const p of joining.values()) out.push({ sheetId: p.sheetId, title: '', joining: true, waiting: true })
      return out
    },

    // Everything the UI needs to draw one tab.
    'sheet:view': async ({ sheetId, tabId }, ctx) => {
      const { e, doc } = await docFor(sheetId)
      // Just joined: the content has not arrived yet.
      if (!model.tabIds(doc).length) {
        return { sheetId, title: model.title(doc), tabs: [], tabId: null, rows: 0, cols: 0, cells: [], widths: {}, loading: true, myRole: await myRole(ctx, sheetId), canUndo: false, canRedo: false }
      }
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
        myRole: (await isFrozen(ctx, sheetId)) ? 'viewer' : await myRole(ctx, sheetId),
        frozen: await frozenInfo(ctx, sheetId),
        // An editor's device can lag behind its role for a few seconds after
        // joining or a move, until a writer has added it.
        writable: !!(ctx.bases.get(sheetId) && ctx.bases.get(sheetId).writable),
        canUndo: !!(e.undo && e.undo.canUndo()),
        canRedo: !!(e.undo && e.undo.canRedo())
      }
    },

    'sheet:setCell': mutate((doc, tab, a) => model.setCell(doc, tab, a.row, a.col, a.input)),
    'sheet:setFormat': mutate((doc, tab, a) => model.setFormat(doc, tab, a.row, a.col, a.patch || {})),
    'sheet:setCells': mutate((doc, tab, a) => {
      if (!Array.isArray(a.grid) || a.grid.reduce((n, line) => n + (Array.isArray(line) ? line.length : 0), 0) > 100000) throw new Error('Too many cells in one paste')
      return model.setCells(doc, tab, a.row, a.col, a.grid.map((line) => line.map((v) => (v === null || v === undefined ? undefined : String(v)))))
    }),
    'sheet:clearRange': mutate((doc, tab, a) => model.clearRange(doc, tab, a.r1, a.c1, a.r2, a.c2)),
    'sheet:setFormatRange': mutate((doc, tab, a) => model.setFormatRange(doc, tab, a.r1, a.c1, a.r2, a.c2, a.patch || {})),
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

    'sheet:invite': async ({ sheetId, role = 'editor', hours = INVITE_HOURS }, ctx) => {
      await requireOwner(ctx, sheetId)
      const mine = (await ctx.localDb.get('groups:joined:' + sheetId)).value
      const expiresAt = Date.now() + Math.max(1, Math.min(24 * 7, Number(hours) || INVITE_HOURS)) * 3600 * 1000
      const { op, inviteId, seed } = m.inviteOp({ sheetId, owner: ctx.identity, role, expiresAt })
      await ctx.append(sheetId, op)
      const link = m.inviteLink({ sheetId, groupKey: mine.groupKey, inviteId, seed, owner: hex(ctx.identity.publicKey), role })
      return { link, inviteId, role, expiresAt }
    },

    'sheet:cancelInvite': async ({ sheetId, inviteId }, ctx) => {
      await requireOwner(ctx, sheetId)
      await ctx.append(sheetId, m.cancelOp({ sheetId, owner: ctx.identity, inviteId }))
      return { ok: true }
    },

    'sheet:setRole': async ({ sheetId, identity, role }, ctx) => {
      await requireOwner(ctx, sheetId)
      const member = await viewGet(ctx, sheetId, 'member/' + identity)
      if (!member) throw new Error('Not a member of this sheet')
      if (member.role === 'owner') throw new Error('The owner role cannot change')
      if (member.role === role) return { changed: false }
      await ctx.append(sheetId, m.roleOp({ sheetId, owner: ctx.identity, identity, role, v: (member.v || 1) + 1 }))
      return { changed: true }
    },

    'sheet:members': async ({ sheetId }, ctx) => {
      const base = ctx.bases.get(sheetId)
      if (!base) throw new Error('unknown sheet: ' + sheetId)
      await base.ready()
      const me = hex(ctx.identity.publicKey)
      const members = []
      for await (const { value } of base.view.createReadStream({ gt: 'member/', lt: 'member/~' })) {
        members.push({ identity: value.identity, name: value.name, role: value.role, isMe: value.identity === me })
      }
      const order = { owner: 0, editor: 1, viewer: 2 }
      members.sort((a, b) => order[a.role] - order[b.role] || a.name.localeCompare(b.name))
      const invites = []
      for await (const { value } of base.view.createReadStream({ gt: 'invite/', lt: 'invite/~' })) {
        const used = await base.view.get('invite-used/' + value.inviteId)
        if (used) continue
        invites.push({ inviteId: value.inviteId, role: value.role, expiresAt: value.expiresAt, expired: Date.now() > value.expiresAt })
      }
      return { members, invites, myRole: (members.find((x) => x.isMe) || {}).role || null }
    },

    // Remove someone: the sheet moves to fresh keys without them.
    'sheet:removeMember': async ({ sheetId, identity }) => getMoves().removeMember(sheetId, identity),

    'sheet:join': async ({ link }, ctx) => {
      if (!getJoin()) throw new Error('Not ready yet')
      return getJoin().start(link, { name: await profileName(ctx) })
    },

    'app:me': async (args, ctx) => ({ identity: hex(ctx.identity.publicKey), name: await profileName(ctx) }),

    // Saves the name locally and updates it in every sheet this device can
    // write to. Viewers keep the name they joined with.
    'app:setName': async ({ name }, ctx) => {
      const clean = m.cleanName(name)
      await ctx.localDb.put('profile', { name: clean })
      const me = hex(ctx.identity.publicKey)
      for (const [sheetId, base] of ctx.bases) {
        try {
          if (!base.writable) continue
          const member = await viewGet(ctx, sheetId, 'member/' + me)
          if (!member || member.name === clean) continue
          await ctx.append(sheetId, m.nameOp({ sheetId, identity: ctx.identity, name: clean, n: (member.n || 0) + 1 }))
        } catch {}
      }
      return { ok: true }
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
