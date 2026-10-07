// IPC methods that work for any kind of file (proposals/2026-10-06-documents.md,
// "Code"): the file list, sharing, roles, removal, tidy up, joining, the
// title, profiles and the donation nudge. Each one is registered as `file:`
// and, for the existing UI, under its old `sheet:` name too.

const b4a = require('b4a')
const model = require('../sheet/sheetModel')
const m = require('./membership')
const { yOps } = require('./yOps')

const DONATE_AFTER_MS = 14 * 24 * 3600 * 1000
const INVITE_HOURS = 24

const hex = (buf) => b4a.toString(buf, 'hex')

// Helpers shared with each file kind's own methods.
function createFileHelpers (sheets) {
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

  // Who owns a file and how many people are in it, for the file list.
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

  // A file that moved (or that removed this person) is read-only here.
  async function frozenInfo (ctx, sheetId) {
    const rec = (await ctx.localDb.get('moves:' + sheetId))?.value
    if (rec) return rec.removed ? { removed: true } : { movedTo: rec.to, tidied: rec.reason === 'compact' }
    const moved = await viewGet(ctx, sheetId, 'moved')
    return moved ? { moving: true, tidied: moved.reason === 'compact' } : null
  }

  async function isFrozen (ctx, sheetId) {
    return !!(await frozenInfo(ctx, sheetId))
  }

  async function requireOwner (ctx, sheetId) {
    if ((await myRole(ctx, sheetId)) !== 'owner') throw new Error('Only the owner can do that')
  }

  async function requireEdit (ctx, sheetId) {
    if (await isFrozen(ctx, sheetId)) throw new Error('This copy of the sheet is frozen')
    const role = await myRole(ctx, sheetId)
    if (role !== 'owner' && role !== 'editor') throw new Error('You can view this file but not edit it')
    const base = ctx.bases.get(sheetId)
    if (!base.writable) throw new Error('Still getting edit access to this sheet. Try again in a moment.')
  }

  async function commit (ctx, sheetId, update) {
    if (!update) return { changed: false }
    sheets.noteLocal(sheetId, update)
    for (const op of yOps(update)) await ctx.append(sheetId, op)
    return { changed: true }
  }

  async function docFor (sheetId) {
    const e = await sheets.load(sheetId)
    return { e, doc: e.guarded.doc }
  }

  // The whole file, for an editor that keeps its own copy (documents and
  // slides). From here on the editor gets doc:updated events for it.
  // withState false: only the role and the rest, when it has the content.
  // `newer`: made by a newer build, so open it read-only rather than drop
  // content this editor does not know.
  async function replicaState (ctx, sheetId, { withState = true, newer = () => false } = {}) {
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
      newer: newer(doc),
      myRole: role,
      frozen: await frozenInfo(ctx, sheetId),
      writable: !!(base && base.writable)
    }
  }

  // An edit from such an editor, as a Yjs update. It goes into the worklet's
  // copy the guarded way (so a bad one changes nothing) and then out to
  // everyone like any other edit.
  async function replicaUpdate (ctx, sheetId, update, kind, label) {
    await requireEdit(ctx, sheetId)
    const { e, doc } = await docFor(sheetId)
    if (model.kind(doc) !== kind) throw new Error('Not ' + label)
    if (typeof update !== 'string' || !update) throw new Error('Nothing to save')
    const bytes = b4a.from(update, 'base64')
    if (!e.guarded.apply(bytes, 'ui')) throw new Error('That edit could not be saved')
    return commit(ctx, sheetId, bytes)
  }

  return { profileName, viewGet, peopleOf, myRole, frozenInfo, isFrozen, requireOwner, requireEdit, commit, docFor, replicaState, replicaUpdate }
}

function createFileMethods (sheets, { getJoin, getMoves, getProfiles }) {
  const { profileName, viewGet, peopleOf, requireOwner, requireEdit, commit, docFor } = createFileHelpers(sheets)
  // The kind each join's invite named, for a just-joined file whose content
  // has not arrived yet (it would otherwise show as a sheet).
  const joinKinds = new Map()

  const files = {
    list: async (args, ctx) => {
      const out = []
      const joining = new Map((getJoin() ? getJoin().pending() : []).map((p) => [p.sheetId, p]))
      for (const p of joining.values()) joinKinds.set(p.sheetId, p.kind)
      for await (const { value } of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~' })) {
        if (!value || !value.groupId) continue
        // A file that moved to a fresh key is replaced by its new copy.
        const moved = (await ctx.localDb.get('moves:' + value.groupId))?.value
        if (moved && moved.to) continue
        // Prefer the live title: the stored name is what it was called at join.
        const e = sheets.peek(value.groupId)
        // Not loaded yet: load it in the background, so its title (and any
        // later change) reaches the list live through sheet:changed.
        if (!e && !(moved && moved.removed)) sheets.load(value.groupId).then(() => sheets.changed(value.groupId)).catch(() => {})
        out.push({ sheetId: value.groupId, title: (e && model.title(e.guarded.doc)) || value.name || '', kind: (e && e.guarded.doc.getMap('meta').get('kind')) || joinKinds.get(value.groupId) || 'sheet', joining: joining.has(value.groupId) || undefined, removed: (moved && moved.removed) || undefined, ...(await peopleOf(ctx, value.groupId)) })
        joining.delete(value.groupId)
      }
      // Joins that have not been welcomed yet have no base.
      for (const p of joining.values()) out.push({ sheetId: p.sheetId, title: '', kind: p.kind, joining: true, waiting: true, role: p.role, reason: p.reason, startedAt: p.startedAt })
      return out
    },

    // The title lives in the document's meta map, so it needs no tab. The
    // update has the 'local' origin, so it can be undone like any edit.
    setTitle: async ({ sheetId, title }, ctx) => {
      await requireEdit(ctx, sheetId)
      const { doc } = await docFor(sheetId)
      return commit(ctx, sheetId, model.setTitle(doc, String(title)))
    },

    invite: async ({ sheetId, role = 'editor', hours = INVITE_HOURS }, ctx) => {
      await requireOwner(ctx, sheetId)
      const mine = (await ctx.localDb.get('groups:joined:' + sheetId)).value
      const expiresAt = Date.now() + Math.max(1, Math.min(24 * 7, Number(hours) || INVITE_HOURS)) * 3600 * 1000
      const { op, inviteId, seed } = m.inviteOp({ sheetId, owner: ctx.identity, role, expiresAt })
      await ctx.append(sheetId, op)
      const link = m.inviteLink({ sheetId, groupKey: mine.groupKey, inviteId, seed, owner: hex(ctx.identity.publicKey), role, kind: model.kind((await docFor(sheetId)).doc) })
      return { link, inviteId, role, expiresAt }
    },

    cancelInvite: async ({ sheetId, inviteId }, ctx) => {
      await requireOwner(ctx, sheetId)
      await ctx.append(sheetId, m.cancelOp({ sheetId, owner: ctx.identity, inviteId }))
      return { ok: true }
    },

    setRole: async ({ sheetId, identity, role }, ctx) => {
      await requireOwner(ctx, sheetId)
      const member = await viewGet(ctx, sheetId, 'member/' + identity)
      if (!member) throw new Error('Not a member of this sheet')
      if (member.role === 'owner') throw new Error('The owner role cannot change')
      if (member.role === role) return { changed: false }
      await ctx.append(sheetId, m.roleOp({ sheetId, owner: ctx.identity, identity, role, v: (member.v || 1) + 1 }))
      return { changed: true }
    },

    members: async ({ sheetId }, ctx) => {
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

    // Remove someone: the file moves to fresh keys without them.
    removeMember: async ({ sheetId, identity }) => getMoves().removeMember(sheetId, identity),

    // Tidy up (proposals/2026-10-05-shared-compaction.md): the same move,
    // keeping everyone. history says how long the history is and whether
    // the owner can tidy it now.
    compact: async ({ sheetId }) => getMoves().compact(sheetId),
    history: async ({ sheetId }) => {
      const base = sheets.getBase(sheetId)
      if (!base) throw new Error('unknown sheet: ' + sheetId)
      return { updates: base.view.core.length, openInvites: await getMoves().openInvites(sheetId) }
    },

    join: async ({ link }, ctx) => {
      if (!getJoin()) throw new Error('Not ready yet')
      return getJoin().start(link, { name: await profileName(ctx) })
    },

    // One member's picture, { data, mime, hash } or null.
    avatar: async ({ sheetId, identity }) => getProfiles().avatarOf(sheetId, identity)
  }

  const methods = {
    'app:me': async (args, ctx) => {
      // One reminder to write down the recovery phrase, once there is a file
      // worth recovering (proposals/2026-10-03-device-linking.md).
      let hasSheet = false
      for await (const row of ctx.localDb.createReadStream({ gt: 'groups:joined:', lt: 'groups:joined:~', limit: 1 })) hasSheet = !!row
      const nudged = !!(await ctx.localDb.get('phraseNudged'))
      const p = await getProfiles().local()
      return { identity: hex(ctx.identity.publicKey), name: p.name, avatar: p.avatar, phraseNudge: hasSheet && !nudged }
    },
    'app:phraseNudged': async (args, ctx) => { await ctx.localDb.put('phraseNudged', { at: Date.now() }); return { ok: true } },

    // A nudge to donate, once, two weeks after first use (as in the other
    // PeerLoom apps). The UI never shows it on iOS before the first release.
    'donation:status': async (args, ctx) => {
      let row = (await ctx.localDb.get('donateReminder'))?.value
      if (!row) { row = { firstUseAt: Date.now(), shown: false }; await ctx.localDb.put('donateReminder', row) }
      return { due: !row.shown && Date.now() - row.firstUseAt >= DONATE_AFTER_MS }
    },
    'donation:dismiss': async (args, ctx) => {
      const row = (await ctx.localDb.get('donateReminder'))?.value || { firstUseAt: Date.now() }
      await ctx.localDb.put('donateReminder', { ...row, shown: true })
      return { ok: true }
    },

    // Saves the name or picture locally and updates it in every file
    // (proposals/2026-10-04-profiles-with-avatars.md).
    'app:setName': async ({ name }) => {
      await getProfiles().setName(name)
      return { ok: true }
    },
    'app:setAvatar': async ({ data, mime }) => {
      await getProfiles().setAvatar({ data: data || '', mime })
      return { ok: true }
    }
  }
  for (const [name, fn] of Object.entries(files)) {
    methods['file:' + name] = fn
    methods['sheet:' + name] = fn
  }
  return methods
}

module.exports = { createFileMethods, createFileHelpers }
