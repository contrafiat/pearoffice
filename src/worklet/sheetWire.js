// Autobase apply rules for PearSheet ops (wire protocol proposal, section 4).
//
// Membership ops live in membership.js. `y` carries one Yjs update and is
// accepted only from a device whose identity is an owner or editor.
//
// Rules: deterministic, replicated state only, no clock reads. Anything
// malformed or unauthorised is skipped, which every device does identically.

const b4a = require('b4a')
const { yKey } = require('./sheets')
const { applyMembershipOp, mayEdit } = require('./membership')

const MAX_UPDATE_BYTES = 1024 * 1024

function createApplyOps ({ onUpdate, onMembership, log }) {
  return async function applySheetOp (op, ctx) {
    const { view, groupId, node } = ctx

    // A moved sheet is frozen: after the owner's `move`, nothing applies.
    if (await view.get('moved')) return

    if (op.type === 'y') {
      if (typeof op.data !== 'string' || op.data.length > MAX_UPDATE_BYTES * 4 / 3 + 4) return
      if (!(await mayEdit(view, node))) return
      const update = b4a.from(op.data, 'base64')
      if (update.byteLength === 0) return
      await view.put(yKey(node), { data: op.data })
      onUpdate(groupId, update)
      return
    }

    if (await applyMembershipOp(op, { ...ctx, log })) {
      if (onMembership) onMembership(groupId, op.type)
    }
  }
}

module.exports = { createApplyOps, MAX_UPDATE_BYTES }
