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
const charts = require('../shared/charts')

const hex = (buf) => b4a.toString(buf, 'hex')
const INVITE_HOURS = 24

// The text a cell shows, and what kind of value it is (the UI right-aligns
// numbers). Number formats use Excel format codes through SSF.
function present (v, fmt) {
  if (v.error) return { display: v.error, kind: 'error' }
  const value = v.value
  if (value === null || value === undefined) return { display: '', kind: 'empty' }
  if (typeof value === 'number') {
    // `num` is the value itself, for the selection totals.
    if (fmt && fmt.num) {
      try { return { display: SSF.format(fmt.num, value), kind: 'number', num: value } } catch {}
    }
    return { display: displayNumber(value), kind: 'number', num: value }
  }
  if (typeof value === 'boolean') return { display: value ? 'TRUE' : 'FALSE', kind: 'bool' }
  return { display: String(value), kind: 'text' }
}

// A chart's data, ready to draw: { categories, series } or { error }.
function resolveChart (doc, tabId, chart, allValues) {
  const range = charts.parseRange(chart.data)
  if (!range) return { error: chart.data && chart.data.includes('#REF!') ? 'The data for this chart was deleted' : 'This chart has no data range' }
  let tab = tabId
  if (range.sheet) {
    tab = model.tabIds(doc).find((id) => String(model.tabMap(doc, id).get('name')).toUpperCase() === range.sheet.toUpperCase())
    if (!tab) return { error: 'The tab "' + range.sheet + '" is gone' }
  }
  const values = allValues.get(tab) || new Map()
  const cellAt = (r, c) => {
    const v = values.get(r + ',' + c)
    if (!v) return null
    const fmt = v.from ? model.getFormat(doc, tab, v.from[0], v.from[1]) : model.getFormat(doc, tab, r, c)
    return { ...v, display: present(v, fmt).display }
  }
  const block = charts.rangeBlock(range, cellAt)
  if (!block) return { error: 'The formula in ' + chart.data.replace(/#$/, '') + ' does not spill' }
  const out = charts.chartData(block, chart)
  if (!out.series.length) return { error: 'There are no numbers to chart in ' + chart.data }
  return out
}

function createSheetMethods (sheets, { getJoin, getMoves, getProfiles }) {
  // The method table refers to itself (sheet:import builds on sheet:create).
  let methods = null
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

  // Who owns a sheet and how many people are in it, for the sheet list.
  async function peopleOf (ctx, sheetId) {
    const base = ctx.bases.get(sheetId)
    if (!base) return {}
    try {
      await base.ready()
      const sheet = (await base.view.get('sheet'))?.value
      let people = 0
      let owner = null
      for await (const { value } of base.view.createReadStream({ gt: 'member/', lt: 'member/~' })) {
        people++
        if (sheet && value.identity === sheet.owner) owner = value
      }
      if (!owner) return { people }
      const me = hex(ctx.identity.publicKey)
      return { people, owner: { identity: owner.identity, name: owner.name || '', avatarHash: owner.avatarHash || null, isMe: owner.identity === me } }
    } catch { return {} }
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

  async function requireEdit (ctx, sheetId) {
    if (await isFrozen(ctx, sheetId)) throw new Error('This copy of the sheet is frozen')
    const role = await myRole(ctx, sheetId)
    if (role !== 'owner' && role !== 'editor') throw new Error('You can view this sheet but not edit it')
    const base = ctx.bases.get(sheetId)
    if (!base.writable) throw new Error('Still getting edit access to this sheet. Try again in a moment.')
  }

  // Find and replace: does `text` match, and what does it become.
  function matcher ({ query, matchCase, wholeCell }) {
    const q = String(query || '')
    if (!q) throw new Error('Type something to find')
    const esc = q.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
    const re = new RegExp(wholeCell ? '^' + esc + '$' : esc, matchCase ? 'g' : 'gi')
    return {
      test: (text) => { re.lastIndex = 0; return re.test(text) },
      replace: (text, by) => { re.lastIndex = 0; return text.replace(re, () => String(by)) }
    }
  }

  // Sorting order for values, as SORT uses: numbers, text without case,
  // booleans, errors; blanks last whichever way.
  function sortCompare (a, b) {
    const blank = (v) => !v || v.error === undefined && (v.value === null || v.value === undefined || v.value === '')
    if (blank(a) || blank(b)) return blank(a) === blank(b) ? 0 : blank(a) ? 1 : -1
    const rank = (v) => (v.error !== undefined ? 3 : typeof v.value === 'number' ? 0 : typeof v.value === 'string' ? 1 : 2)
    const ra = rank(a)
    const rb = rank(b)
    if (ra !== rb) return ra - rb
    if (ra === 3) return 0
    const x = ra === 1 ? a.value.toUpperCase() : a.value
    const y = rb === 1 ? b.value.toUpperCase() : b.value
    return x < y ? -1 : x > y ? 1 : 0
  }

  function mutate (fn) {
    return async (args, ctx) => {
      await requireEdit(ctx, args.sheetId)
      const { doc } = await docFor(args.sheetId)
      const tabId = firstTab(doc, args.tabId)
      return commit(ctx, args.sheetId, fn(doc, tabId, args))
    }
  }

  methods = {
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
      await sheets.attach(groupId)
      return { sheetId: groupId }
    },

    // A new sheet from an imported file (the UI converts the file with SheetJS).
    'sheet:import': async ({ title = 'Imported sheet', tabs } = {}, ctx) => {
      if (!Array.isArray(tabs) || !tabs.length) throw new Error('Nothing to import')
      const { sheetId } = await methods['sheet:create']({ title }, ctx)
      const { doc } = await docFor(sheetId)
      await commit(ctx, sheetId, model.importTabs(doc, { tabs }))
      return { sheetId }
    },

    // Every tab's cells, typed values and formats, for export.
    'sheet:dump': async ({ sheetId }) => {
      const { e, doc } = await docFor(sheetId)
      const values = sheets.values(e)
      const tabs = model.tabIds(doc).map((id) => {
        const t = model.tabMap(doc, id)
        const rows = t.get('rows').toArray()
        const cols = t.get('cols').toArray()
        const rowIndex = new Map(rows.map((x, i) => [x, i + 1]))
        const colIndex = new Map(cols.map((x, i) => [x, i + 1]))
        const v = values.get(id) || new Map()
        const cells = []
        for (const key of t.get('cells').keys()) {
          const [rowId, colId] = key.split(':')
          const row = rowIndex.get(rowId)
          const col = colIndex.get(colId)
          if (row === undefined || col === undefined) continue
          const val = v.get(row + ',' + col) || { value: null }
          cells.push({ row, col, input: model.getInput(doc, id, row, col), value: val.error ? null : val.value, error: val.error, fmt: model.getFormat(doc, id, row, col), spill: val.spill })
        }
        for (const [rc, val] of v) {
          if (!val.from) continue
          const [row, col] = rc.split(',').map(Number)
          cells.push({ row, col, value: val.error ? null : val.value, error: val.error, fmt: model.getFormat(doc, id, row, col), from: val.from })
        }
        const widths = {}
        for (const [colId, px] of t.get('widths').entries()) if (colIndex.has(colId)) widths[colIndex.get(colId)] = px
        return { name: t.get('name'), cells, widths }
      })
      return { title: model.title(doc), tabs }
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
        // Not loaded yet: load it in the background, so its title (and any
        // later change) reaches the list live through sheet:changed.
        if (!e && !(moved && moved.removed)) sheets.load(value.groupId).then(() => sheets.changed(value.groupId)).catch(() => {})
        out.push({ sheetId: value.groupId, title: (e && model.title(e.guarded.doc)) || value.name || '', joining: joining.has(value.groupId) || undefined, removed: (moved && moved.removed) || undefined, ...(await peopleOf(ctx, value.groupId)) })
        joining.delete(value.groupId)
      }
      // Joins that have not been welcomed yet have no base.
      for (const p of joining.values()) out.push({ sheetId: p.sheetId, title: '', joining: true, waiting: true, role: p.role, reason: p.reason, startedAt: p.startedAt })
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
        cells.push({ row, col, input: model.getInput(doc, tab, row, col), ...present(v, fmt), volatile: v.volatile, fmt, spill: v.spill, blocked: v.blocked })
      }
      // Cells a spilling formula fills (proposals/2026-10-04-spilling-formulas.md).
      // They take the anchor's number format unless they have their own.
      for (const [rc, v] of values) {
        if (!v.from) continue
        const [row, col] = rc.split(',').map(Number)
        const own = model.getFormat(doc, tab, row, col)
        const fmt = own.num ? own : { ...own, num: model.getFormat(doc, tab, v.from[0], v.from[1]).num }
        cells.push({ row, col, input: '', ...present(v, fmt), fmt: own, from: v.from })
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
        canRedo: !!(e.undo && e.undo.canRedo()),
        charts: model.getCharts(doc, tab).map((c) => ({ ...c, resolved: resolveChart(doc, tab, c, sheets.values(e)) }))
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

    // Sort the rows of a range by one or more of its columns
    // (keys: [{ col, desc }]); with header, the first row stays put.
    'sheet:sortRange': async ({ sheetId, tabId, r1, c1, r2, c2, keys, header }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { e, doc } = await docFor(sheetId)
      const tab = firstTab(doc, tabId)
      const top = header ? r1 + 1 : r1
      if (!Array.isArray(keys) || !keys.length || keys.some((k) => k.col < c1 || k.col > c2)) throw new Error('Sort by a column inside the range')
      if (top >= r2) return { changed: false }
      const values = sheets.currentValues(e).get(tab) || new Map()
      const rows = []
      for (let r = top; r <= r2; r++) rows.push(r)
      rows.sort((a, b) => {
        for (const k of keys) {
          const va = values.get(a + ',' + k.col)
          const vb = values.get(b + ',' + k.col)
          const blankA = !va || (va.error === undefined && (va.value === null || va.value === ''))
          const blankB = !vb || (vb.error === undefined && (vb.value === null || vb.value === ''))
          if (blankA || blankB) { if (blankA !== blankB) return blankA ? 1 : -1; continue }
          const c = sortCompare(va, vb)
          if (c) return k.desc ? -c : c
        }
        return a - b
      })
      if (rows.every((r, i) => r === top + i)) return { changed: false }
      return commit(ctx, sheetId, model.sortRows(doc, tab, top, c1, r2, c2, rows))
    },

    // Cells matching a search, in reading order: in what cells show
    // (lookIn 'values') or what was typed, formulas included ('formulas').
    'sheet:find': async ({ sheetId, tabId, query, matchCase, wholeCell, lookIn = 'values', allTabs }) => {
      const m = matcher({ query, matchCase, wholeCell })
      const { e, doc } = await docFor(sheetId)
      const tabs = allTabs ? model.tabIds(doc) : [firstTab(doc, tabId)]
      const all = sheets.currentValues(e)
      const out = []
      for (const id of tabs) {
        const values = all.get(id) || new Map()
        const hits = []
        if (lookIn === 'formulas') {
          const t = model.tabMap(doc, id)
          const rows = t.get('rows').toArray()
          const cols = t.get('cols').toArray()
          const rowIndex = new Map(rows.map((x, i) => [x, i + 1]))
          const colIndex = new Map(cols.map((x, i) => [x, i + 1]))
          for (const key of t.get('cells').keys()) {
            const [rowId, colId] = key.split(':')
            const row = rowIndex.get(rowId)
            const col = colIndex.get(colId)
            if (row !== undefined && col !== undefined && m.test(model.getInput(doc, id, row, col))) hits.push([row, col])
          }
        } else {
          for (const [rc, v] of values) {
            const [row, col] = rc.split(',').map(Number)
            const fmt = v.from ? model.getFormat(doc, id, v.from[0], v.from[1]) : model.getFormat(doc, id, row, col)
            if (m.test(present(v, fmt).display)) hits.push([row, col])
          }
        }
        hits.sort((a, b) => a[0] - b[0] || a[1] - b[1])
        for (const [row, col] of hits) out.push({ tabId: id, row, col })
      }
      return { matches: out }
    },

    // Replace in what was typed, formulas included. With `at` ({ tabId, row,
    // col }) only that cell; otherwise every match. Returns how many cells changed.
    'sheet:replace': async ({ sheetId, tabId, query, replacement, matchCase, wholeCell, allTabs, at }, ctx) => {
      await requireEdit(ctx, sheetId)
      const m = matcher({ query, matchCase, wholeCell })
      const { doc } = await docFor(sheetId)
      const tabs = at ? [at.tabId] : allTabs ? model.tabIds(doc) : [firstTab(doc, tabId)]
      let count = 0
      for (const id of tabs) {
        const t = model.tabMap(doc, id)
        const rows = t.get('rows').toArray()
        const cols = t.get('cols').toArray()
        const rowIndex = new Map(rows.map((x, i) => [x, i + 1]))
        const colIndex = new Map(cols.map((x, i) => [x, i + 1]))
        const changes = []
        for (const key of t.get('cells').keys()) {
          const [rowId, colId] = key.split(':')
          const row = rowIndex.get(rowId)
          const col = colIndex.get(colId)
          if (row === undefined || col === undefined) continue
          if (at && (row !== at.row || col !== at.col)) continue
          const input = model.getInput(doc, id, row, col)
          if (!m.test(input)) continue
          const next = m.replace(input, replacement || '')
          if (next !== input) changes.push([row, col, next])
        }
        if (changes.length) {
          count += changes.length
          await commit(ctx, sheetId, model.replaceInputs(doc, id, changes))
        }
      }
      return { count }
    },

    // Fill n cells past a range: dir 'down' | 'up' | 'right' | 'left',
    // mode 'series' (the fill handle) or 'copy' (Ctrl+D, Ctrl+R).
    'sheet:fill': mutate((doc, tab, a) => {
      if (!['down', 'up', 'right', 'left'].includes(a.dir)) throw new Error('bad fill direction')
      const n = Math.min(100000, Math.max(0, Math.trunc(Number(a.n) || 0)))
      return model.fillRange(doc, tab, { r1: a.r1, c1: a.c1, r2: a.r2, c2: a.c2 }, a.dir, n, a.mode === 'copy' ? 'copy' : 'series')
    }),

    // Charts (proposals/2026-10-04-charts.md).
    'sheet:addChart': async ({ sheetId, tabId, spec }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      const { id, update } = model.addChart(doc, firstTab(doc, tabId), spec || {})
      await commit(ctx, sheetId, update)
      return { chartId: id }
    },
    'sheet:setChart': async ({ sheetId, tabId, chartId, patch }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      return commit(ctx, sheetId, model.setChart(doc, firstTab(doc, tabId), chartId, patch || {}))
    },
    'sheet:deleteChart': async ({ sheetId, tabId, chartId }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      return commit(ctx, sheetId, model.deleteChart(doc, firstTab(doc, tabId), chartId))
    },

    'sheet:deleteTab': async ({ sheetId, tabId }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      return commit(ctx, sheetId, model.deleteTab(doc, tabId))
    },
    'sheet:moveTab': async ({ sheetId, tabId, to }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      return commit(ctx, sheetId, model.moveTab(doc, tabId, Number(to)))
    },
    'sheet:duplicateTab': async ({ sheetId, tabId }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      const { id, update } = model.duplicateTab(doc, tabId)
      await commit(ctx, sheetId, update)
      return { tabId: id }
    },

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
        members.push({ identity: value.identity, name: value.name, role: value.role, avatarHash: value.avatarHash || null, isMe: value.identity === me })
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

    'app:me': async (args, ctx) => {
      // One reminder to write down the recovery phrase, once there is a sheet
      // worth recovering (proposals/2026-10-03-device-linking.md).
      let hasSheet = false
      for await (const _ of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~', limit: 1 })) hasSheet = true
      const nudged = !!(await ctx.localDb.get('phraseNudged'))
      const p = await getProfiles().local()
      return { identity: hex(ctx.identity.publicKey), name: p.name, avatar: p.avatar, phraseNudge: hasSheet && !nudged }
    },
    'app:phraseNudged': async (args, ctx) => { await ctx.localDb.put('phraseNudged', { at: Date.now() }); return { ok: true } },

    // Saves the name or picture locally and updates it in every sheet
    // (proposals/2026-10-04-profiles-with-avatars.md).
    'app:setName': async ({ name }) => {
      await getProfiles().setName(name)
      return { ok: true }
    },
    'app:setAvatar': async ({ data, mime }) => {
      await getProfiles().setAvatar({ data: data || '', mime })
      return { ok: true }
    },

    // One member's picture, { data, mime, hash } or null.
    'sheet:avatar': async ({ sheetId, identity }) => getProfiles().avatarOf(sheetId, identity),

    'sheet:undo': async ({ sheetId }, ctx) => undoRedo(sheetId, ctx, 'undo'),
    'sheet:redo': async ({ sheetId }, ctx) => undoRedo(sheetId, ctx, 'redo')
  }
  return methods

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
