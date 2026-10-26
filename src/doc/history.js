// Version history (proposals/2026-10-26-version-history.md), for any file:
// documents, sheets and decks. Every edit
// stays in the file's view under y/<writer>/<seq>, with `at` (when it was
// written, from builds that say) and `start` (the first edit of a moved
// file). Runs anywhere; the worklet reads the view and calls these.

const Y = require('yjs')
const b4a = require('b4a')

const PAUSE_MS = 5 * 60 * 1000 // a version ends when nobody edits for this long
const LONGEST_MS = 60 * 60 * 1000 // or after an hour of editing

// Edits in the order history uses: those with no time first (older builds;
// their order between writers is unknown, and Yjs merges them in any order),
// then by time, then by key.
function order (a, b) {
  const ta = a.at === null ? -1 : a.at
  const tb = b.at === null ? -1 : b.at
  return ta - tb || (a.key < b.key ? -1 : a.key > b.key ? 1 : 0)
}

// Is edit `e` at or before the end of a version ({ at, key })?
const upTo = (e, end) => order(e, end) <= 0

// The versions, newest first: { end: { at, key }, from, to, people, edits,
// start }. `from` and `to` are times (null for the untimed "Earlier" run);
// `people` are identity keys (or null for a writer not known); `start` is
// set on the first edit of a moved file ('compact', 'remove', 'recovered').
function versions (edits, { pauseMs = PAUSE_MS, longestMs = LONGEST_MS } = {}) {
  const list = [...edits].sort(order)
  const out = []
  let cur = null
  const close = () => { if (cur) { out.push(cur); cur = null } }
  for (const e of list) {
    const fresh = !cur ||
      e.start ||
      (cur.from === null) !== (e.at === null) ||
      (e.at !== null && (e.at - cur.to > pauseMs || e.at - cur.from > longestMs)) ||
      cur.start
    if (fresh) {
      close()
      cur = { from: e.at, to: e.at, people: [], edits: 0, start: e.start || null, end: null }
    }
    cur.to = e.at
    cur.edits++
    if (!cur.people.includes(e.identity)) cur.people.push(e.identity)
    cur.end = { at: e.at, key: e.key }
  }
  close()
  return out.reverse()
}

// The document as it was at the end of a version: every edit up to it,
// replayed into a fresh Yjs document. Returns the state as an update.
function stateAt (edits, end) {
  const doc = new Y.Doc()
  try {
    for (const e of [...edits].sort(order)) {
      if (!upTo(e, end)) break
      try { Y.applyUpdate(doc, b4a.from(e.data, 'base64')) } catch {}
    }
    return Y.encodeStateAsUpdate(doc)
  } finally {
    doc.destroy()
  }
}

// Make `target` match `source` (the same kind of file at another version),
// as one set of changes others can merge with: a sheet's or deck's Restore.
// `meta` (title, schema version, template mark) is left as it is. `arrays`
// names the top-level Y.Arrays (a sheet's `tabs`); every other top-level
// type is a Y.Map.
function restoreInto (target, source, { arrays = [] } = {}) {
  const json = (v) => (v instanceof Y.AbstractType ? JSON.stringify(v.toJSON()) : JSON.stringify(v))
  const copy = (v) => (v instanceof Y.AbstractType ? v.clone() : v)
  function syncMap (t, s) {
    for (const k of [...t.keys()]) if (!s.has(k)) t.delete(k)
    for (const [k, v] of s.entries()) {
      const cur = t.get(k)
      if (v instanceof Y.Map && cur instanceof Y.Map) syncMap(cur, v)
      else if (v instanceof Y.Array && cur instanceof Y.Array) syncArray(cur, v)
      else if (cur === undefined || json(cur) !== json(v) || (v instanceof Y.AbstractType) !== (cur instanceof Y.AbstractType)) t.set(k, copy(v))
    }
  }
  function syncArray (t, s) {
    if (json(t) === json(s)) return
    t.delete(0, t.length)
    t.insert(0, s.toArray().map(copy))
  }
  const names = new Set([...source.share.keys(), ...target.share.keys()])
  target.transact(() => {
    for (const name of names) {
      if (name === 'meta') continue
      if (arrays.includes(name)) syncArray(target.getArray(name), source.getArray(name))
      else syncMap(target.getMap(name), source.getMap(name))
    }
  })
}

module.exports = { versions, stateAt, restoreInto, order, PAUSE_MS, LONGEST_MS }
