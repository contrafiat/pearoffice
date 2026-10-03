// Autobase apply rules for PearSheet ops (wire protocol proposal, section 4).
//
// This first slice handles `sheet` (the founding record) and `y` (one Yjs
// update). Membership, device, invite, role, seeder and move ops arrive with
// the invite flow. Until then any writer may append `y`, and core admits
// writers with its default rules.
//
// Rules: deterministic, replicated state only, no clock reads. Anything
// malformed is skipped, which every device does identically.

const b4a = require('b4a')
const { yKey } = require('./sheets')

const MAX_UPDATE_BYTES = 1024 * 1024

function createApplyOps ({ onUpdate }) {
  return async function applySheetOp (op, { view, groupId, node }) {
    if (op.type === 'sheet') {
      if (await view.get('sheet')) return // first one wins
      if (typeof op.owner !== 'string' || op.version !== 1) return
      await view.put('sheet', { sheetId: groupId, owner: op.owner, version: 1 })
      return
    }

    if (op.type === 'y') {
      if (typeof op.data !== 'string' || op.data.length > MAX_UPDATE_BYTES * 4 / 3 + 4) return
      const update = b4a.from(op.data, 'base64')
      if (update.byteLength === 0) return
      await view.put(yKey(node), { data: op.data })
      onUpdate(groupId, update)
    }
  }
}

module.exports = { createApplyOps, MAX_UPDATE_BYTES }
