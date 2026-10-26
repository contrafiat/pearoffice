// Autobase apply rules for PearOffice ops (wire protocol proposal, section 4).
//
// Membership ops live in membership.js. `y` carries one Yjs update and is
// accepted only from a device whose identity is an owner or editor.
//
// Rules: deterministic, replicated state only, no clock reads. Anything
// malformed or unauthorised is skipped, which every device does identically.

const b4a = require('b4a')
const { yKey } = require('./sheets')
const { applyMembershipOp, mayEdit } = require('./membership')

const { PART_CHARS, MAX_PARTS } = require('./yOps')

const MAX_UPDATE_BYTES = 1024 * 1024
const PART_PREFIX = 'ypart/'

// A part of a split update (yOps.js), or null if malformed.
function partOf (op) {
  const p = op.part
  if (!p || typeof p !== 'object') return null
  if (typeof p.id !== 'string' || !/^[0-9a-f]{16}$/.test(p.id)) return null
  if (!Number.isInteger(p.n) || p.n < 2 || p.n > MAX_PARTS) return null
  if (!Number.isInteger(p.i) || p.i < 0 || p.i >= p.n) return null
  if (op.data.length > PART_CHARS || op.data.length === 0) return null
  return p
}

// When an edit was written (yOps.js), kept beside it for version history,
// or undefined. Only the op's own value, so every device keeps the same.
const atOf = (op) => (typeof op.at === 'number' && Number.isFinite(op.at) && op.at > 1.5e12 && op.at < 1e13 ? Math.round(op.at) : undefined)

// The first edit of a moved file says why its history starts there.
const startOf = (op) => (['compact', 'remove', 'recovered'].includes(op.start) ? op.start : undefined)

function createApplyOps ({ onUpdate, onMembership, log }) {
  return async function applySheetOp (op, ctx) {
    const { view, groupId, node } = ctx

    // A moved or deleted sheet is frozen: after the owner's `move` or
    // `delete`, nothing applies.
    if (await view.get('moved') || await view.get('deleted')) return

    if (op.type === 'y' && op.part !== undefined) {
      if (typeof op.data !== 'string') return
      const p = partOf(op)
      if (!p || !(await mayEdit(view, node))) return
      // Parts are kept per writer, so nobody else can add to them.
      const prefix = PART_PREFIX + b4a.toString(node.from.key, 'hex') + '/' + p.id + '/'
      await view.put(prefix + String(p.i).padStart(3, '0'), { data: op.data, n: p.n })
      const parts = []
      for await (const { key, value } of view.createReadStream({ gt: prefix, lt: prefix + '~' })) parts.push({ key, value })
      if (parts.length < p.n || parts.some((x) => x.value.n !== p.n)) return
      for (const x of parts) await view.del(x.key)
      const data = parts.map((x) => x.value.data).join('')
      const update = b4a.from(data, 'base64')
      if (update.byteLength === 0) return
      await view.put(yKey(node), { data, at: atOf(op), start: startOf(op) })
      onUpdate(groupId, update)
      return
    }

    if (op.type === 'y') {
      if (typeof op.data !== 'string' || op.data.length > MAX_UPDATE_BYTES * 4 / 3 + 4) return
      if (!(await mayEdit(view, node))) return
      const update = b4a.from(op.data, 'base64')
      if (update.byteLength === 0) return
      await view.put(yKey(node), { data: op.data, at: atOf(op), start: startOf(op) })
      onUpdate(groupId, update)
      return
    }

    if (await applyMembershipOp(op, { ...ctx, log })) {
      if (onMembership) onMembership(groupId, op.type)
    }
  }
}

module.exports = { createApplyOps, MAX_UPDATE_BYTES }
