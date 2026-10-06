// A Yjs update as autobase ops (proposals/2026-10-06-documents.md, step 1).
// Devices skip any op over MAX_UPDATE_BYTES (sheetWire.js), so a bigger
// update (a big paste or import, or a whole file moved to fresh keys) goes
// as parts: `{ type: 'y', data, part: { id, i, n } }`, each with a slice of
// the base64. The apply step keeps the parts until all n have arrived, then
// applies the joined update as one.

const b4a = require('b4a')
const sodium = require('sodium-universal')

const PART_CHARS = 512 * 1024 // base64 characters per part, ~384 KB of update
const MAX_PARTS = 64 // ~24 MB per update

function yOps (update) {
  const data = b4a.toString(update, 'base64')
  if (data.length <= PART_CHARS) return [{ type: 'y', data }]
  const n = Math.ceil(data.length / PART_CHARS)
  if (n > MAX_PARTS) throw new Error('That change is too big to share (over ' + Math.round(MAX_PARTS * PART_CHARS * 3 / 4 / 1e6) + ' MB)')
  const idBuf = b4a.alloc(8)
  sodium.randombytes_buf(idBuf)
  const id = b4a.toString(idBuf, 'hex')
  const ops = []
  for (let i = 0; i < n; i++) ops.push({ type: 'y', data: data.slice(i * PART_CHARS, (i + 1) * PART_CHARS), part: { id, i, n } })
  return ops
}

module.exports = { yOps, PART_CHARS, MAX_PARTS }
