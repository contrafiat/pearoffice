// Lists of choices for dropdowns in a document
// (proposals/2026-10-29-document-dropdowns.md). The root map `lists` in the
// document's Yjs doc: list id -> Y.Map { name, at, items }, `items` a Y.Map
// item id -> { text, color, pos }. A pill (the `dropdown` node) names a list
// and an item, so a rename or a new colour shows on every pill. Each item is
// one value, so two people changing different items both keep theirs.

import * as Y from 'yjs'
import { CHIP_NAMES, chipColorAt } from '../../sheet/validation.js'

export const LISTS = 'lists'
export const MAX_LISTS = 50
export const MAX_ITEMS = 100
export const MAX_TEXT = 100
export const STARTER = [['Yes', 'green'], ['No', 'red']]

export function newListId () {
  const b = new Uint8Array(8)
  crypto.getRandomValues(b)
  return btoa(String.fromCharCode(...b)).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

const cleanText = (t) => String(t == null ? '' : t).replace(/\s+/g, ' ').trim().slice(0, MAX_TEXT)
const okColor = (c) => (CHIP_NAMES.includes(c) ? c : 'grey')
const listsMap = (ydoc) => ydoc.getMap(LISTS)

function readItems (items) {
  const out = []
  if (!(items instanceof Y.Map)) return out
  for (const [id, v] of items.entries()) {
    if (!v || typeof v !== 'object') continue
    const text = cleanText(v.text)
    if (!text) continue
    out.push({ id, text, color: okColor(v.color), pos: Number(v.pos) || 0 })
  }
  out.sort((a, b) => a.pos - b.pos || (a.id < b.id ? -1 : 1))
  return out.slice(0, MAX_ITEMS).map(({ id, text, color }) => ({ id, text, color }))
}

// Every list, oldest first: [{ id, name, items: [{ id, text, color }] }].
export function readLists (ydoc) {
  const out = []
  for (const [id, m] of listsMap(ydoc).entries()) {
    if (!(m instanceof Y.Map)) continue
    out.push({ id, name: cleanText(m.get('name')) || 'Choices', at: Number(m.get('at')) || 0, items: readItems(m.get('items')) })
  }
  out.sort((a, b) => a.at - b.at || (a.id < b.id ? -1 : 1))
  return out.slice(0, MAX_LISTS).map(({ id, name, items }) => ({ id, name, items }))
}

export function readList (ydoc, id) {
  return readLists(ydoc).find((l) => l.id === id) || null
}

// The item a pill shows: { text, color }, or null when the list or item is
// gone.
export function itemOf (lists, listId, itemId) {
  const l = lists.find((x) => x.id === listId)
  const it = l && itemId ? l.items.find((x) => x.id === itemId) : null
  return it ? { text: it.text, color: it.color } : null
}

// A new list, starting with Yes and No. Returns its id.
export function newList (ydoc, name = 'Choices') {
  if (readLists(ydoc).length >= MAX_LISTS) throw new Error('A document can have up to ' + MAX_LISTS + ' lists.')
  const id = newListId()
  ydoc.transact(() => {
    const m = new Y.Map()
    listsMap(ydoc).set(id, m)
    m.set('name', cleanText(name) || 'Choices')
    m.set('at', Date.now())
    const items = new Y.Map()
    m.set('items', items)
    STARTER.forEach(([text, color], pos) => items.set(newListId(), { text, color, pos }))
  }, 'local')
  return id
}

export function renameList (ydoc, id, name) {
  const m = listsMap(ydoc).get(id)
  const clean = cleanText(name)
  if (!(m instanceof Y.Map) || !clean || m.get('name') === clean) return
  ydoc.transact(() => m.set('name', clean), 'local')
}

// Pills of a deleted list show their last text in grey.
export function deleteList (ydoc, id) {
  if (!listsMap(ydoc).has(id)) return
  ydoc.transact(() => listsMap(ydoc).delete(id), 'local')
}

// Add an item (itemId null) or change one. Returns the item's id, or null
// when there is nothing to save.
export function setItem (ydoc, listId, itemId, { text, color } = {}) {
  const m = listsMap(ydoc).get(listId)
  if (!(m instanceof Y.Map)) return null
  const items = m.get('items')
  if (!(items instanceof Y.Map)) return null
  const now = readItems(items)
  const old = itemId ? items.get(itemId) : null
  if (itemId && !old) return null
  const next = {
    text: text === undefined ? old.text : cleanText(text),
    color: color === undefined ? (old ? old.color : chipColorAt(now.length)) : okColor(color),
    pos: old ? old.pos : now.length ? Math.max(...now.map((it) => Number(items.get(it.id).pos) || 0)) + 1 : 0
  }
  if (!next.text) return null
  if (!old && now.length >= MAX_ITEMS) throw new Error('A list can have up to ' + MAX_ITEMS + ' choices.')
  if (old && old.text === next.text && old.color === next.color) return itemId
  const id = itemId || newListId()
  ydoc.transact(() => items.set(id, next), 'local')
  return id
}

export function deleteItem (ydoc, listId, itemId) {
  const m = listsMap(ydoc).get(listId)
  const items = m instanceof Y.Map ? m.get('items') : null
  if (!(items instanceof Y.Map) || !items.has(itemId)) return
  ydoc.transact(() => items.delete(itemId), 'local')
}

// Move an item up (-1) or down (1) by swapping places with its neighbour.
export function moveItem (ydoc, listId, itemId, dir) {
  const m = listsMap(ydoc).get(listId)
  const items = m instanceof Y.Map ? m.get('items') : null
  if (!(items instanceof Y.Map)) return
  const order = readItems(items)
  const i = order.findIndex((it) => it.id === itemId)
  const j = i + dir
  if (i < 0 || j < 0 || j >= order.length) return
  ydoc.transact(() => {
    // Positions are rewritten in order, so equal ones from merged adds part.
    const ids = order.map((it) => it.id)
    ;[ids[i], ids[j]] = [ids[j], ids[i]]
    ids.forEach((id, pos) => { const v = items.get(id); if (v.pos !== pos) items.set(id, { ...v, pos }) })
  }, 'local')
}
