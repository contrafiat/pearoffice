// Two CRDT adapters with the same interface, so the spike runs both through
// identical Autobase plumbing.
//
// Sheet model used by both: rows and cols are ordered lists of stable ids, and
// cells are keyed by `${rowId}:${colId}`. Inserting a row inserts an id, so it
// never renumbers existing cells.

const Y = require('yjs')

const yjs = {
  name: 'yjs',
  create () {
    const doc = new Y.Doc()
    return doc
  },
  // Each mutation returns the delta update produced by that transaction.
  _capture (doc, fn) {
    let out = null
    const on = (u) => { out = u }
    doc.on('update', on)
    doc.transact(fn)
    doc.off('update', on)
    return out
  },
  setCell (doc, rowId, colId, value) {
    return yjs._capture(doc, () => doc.getMap('cells').set(rowId + ':' + colId, value))
  },
  insertRow (doc, index, rowId) {
    return yjs._capture(doc, () => doc.getArray('rows').insert(index, [rowId]))
  },
  insertCol (doc, index, colId) {
    return yjs._capture(doc, () => doc.getArray('cols').insert(index, [colId]))
  },
  apply (doc, update) {
    Y.applyUpdate(doc, update)
  },
  save (doc) {
    return Y.encodeStateAsUpdate(doc)
  },
  snapshot (doc) {
    const cells = doc.getMap('cells').toJSON()
    const sorted = {}
    for (const k of Object.keys(cells).sort()) sorted[k] = cells[k]
    return { rows: doc.getArray('rows').toArray(), cols: doc.getArray('cols').toArray(), cells: sorted }
  }
}

let A = null
function am () {
  if (A === null) A = require('@automerge/automerge')
  return A
}

// Automerge docs are immutable values, so wrap one in a box the caller can hold.
const automerge = {
  name: 'automerge',
  create () {
    return { doc: am().init() }
  },
  _change (box, fn) {
    const before = box.doc
    box.doc = am().change(box.doc, fn)
    const changes = am().getChanges(before, box.doc)
    // Concatenate into one blob with length prefixes so the log entry is one block.
    return packChanges(changes)
  },
  setCell (box, rowId, colId, value) {
    return automerge._change(box, (d) => {
      if (!d.cells) d.cells = {}
      d.cells[rowId + ':' + colId] = value
    })
  },
  insertRow (box, index, rowId) {
    return automerge._change(box, (d) => {
      if (!d.rows) d.rows = []
      d.rows.insertAt(index, rowId)
    })
  },
  insertCol (box, index, colId) {
    return automerge._change(box, (d) => {
      if (!d.cols) d.cols = []
      d.cols.insertAt(index, colId)
    })
  },
  apply (box, update) {
    const [next] = am().applyChanges(box.doc, unpackChanges(update))
    box.doc = next
  },
  save (box) {
    return am().save(box.doc)
  },
  snapshot (box) {
    const d = box.doc
    const cells = {}
    if (d.cells) for (const k of Object.keys(d.cells).sort()) cells[k] = d.cells[k]
    return { rows: d.rows ? [...d.rows] : [], cols: d.cols ? [...d.cols] : [], cells }
  }
}

function packChanges (changes) {
  let len = 0
  for (const c of changes) len += 4 + c.byteLength
  const out = new Uint8Array(len)
  const view = new DataView(out.buffer)
  let o = 0
  for (const c of changes) {
    view.setUint32(o, c.byteLength)
    out.set(c, o + 4)
    o += 4 + c.byteLength
  }
  return out
}

function unpackChanges (buf) {
  const u8 = new Uint8Array(buf.buffer, buf.byteOffset, buf.byteLength)
  const view = new DataView(u8.buffer, u8.byteOffset, u8.byteLength)
  const out = []
  let o = 0
  while (o < u8.byteLength) {
    const n = view.getUint32(o)
    out.push(u8.slice(o + 4, o + 4 + n))
    o += 4 + n
  }
  return out
}

module.exports = { yjs, automerge }
