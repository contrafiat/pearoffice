// Comments (proposals/2026-10-04-sheet-tools.md).

const test = require('node:test')
const assert = require('node:assert/strict')
const Y = require('yjs')
const model = require('../src/shared/sheetModel')

function sheet () {
  const doc = model.createDoc()
  model.initSheet(doc)
  return { doc, tab: model.tabIds(doc)[0] }
}

test('a thread: comment, replies, edit, resolve', () => {
  const { doc, tab } = sheet()
  const { id } = model.addComment(doc, tab, { row: 2, col: 3, author: 'ann', text: '  Check this  ', at: 1 })
  model.addComment(doc, tab, { parent: id, author: 'bob', text: 'Done', at: 3 })
  model.addComment(doc, tab, { parent: id, author: 'ann', text: 'Thanks', at: 2 })
  model.editComment(doc, tab, id, 'ann', 'Check this total', 4)
  model.resolveComment(doc, tab, id, true)
  const [t] = model.getComments(doc, tab)
  assert.equal(t.row, 2)
  assert.equal(t.col, 3)
  assert.equal(t.text, 'Check this total')
  assert.equal(t.edited, 4)
  assert.equal(t.resolved, true)
  assert.deepEqual(t.replies.map((r) => r.text), ['Thanks', 'Done'], 'replies oldest first')
  assert.throws(() => model.addComment(doc, tab, { row: 1, col: 1, author: 'ann', text: '   ', at: 5 }), /needs some text/)
})

test('only the author can change or delete a comment', () => {
  const { doc, tab } = sheet()
  const { id } = model.addComment(doc, tab, { row: 1, col: 1, author: 'ann', text: 'Mine', at: 1 })
  assert.throws(() => model.editComment(doc, tab, id, 'bob', 'Changed', 2), /Only the person/)
  assert.throws(() => model.deleteComment(doc, tab, id, 'bob'), /Only the person/)
  model.deleteComment(doc, tab, id, 'ann')
  assert.deepEqual(model.getComments(doc, tab), [])
})

test('deleting the first comment keeps a thread that has replies', () => {
  const { doc, tab } = sheet()
  const { id } = model.addComment(doc, tab, { row: 1, col: 1, author: 'ann', text: 'Q', at: 1 })
  const r = model.addComment(doc, tab, { parent: id, author: 'bob', text: 'A', at: 2 })
  model.deleteComment(doc, tab, id, 'ann')
  const [t] = model.getComments(doc, tab)
  assert.equal(t.deleted, true)
  assert.equal(t.text, '')
  model.deleteComment(doc, tab, r.id, 'bob')
  assert.deepEqual(model.getComments(doc, tab), [], 'gone once its replies are')
})

test('comments follow their cell and go with its row', () => {
  const { doc, tab } = sheet()
  model.addComment(doc, tab, { row: 3, col: 2, author: 'ann', text: 'x', at: 1 })
  model.insertRows(doc, tab, 1, 2)
  assert.equal(model.getComments(doc, tab)[0].row, 5)
  model.deleteRows(doc, tab, 5, 1)
  assert.deepEqual(model.getComments(doc, tab), [])
})

test('two people replying and resolving at once keep everything', () => {
  const { doc, tab } = sheet()
  const { id } = model.addComment(doc, tab, { row: 1, col: 1, author: 'ann', text: 'Q', at: 1 })
  const a = new Y.Doc()
  const b = new Y.Doc()
  Y.applyUpdate(a, Y.encodeStateAsUpdate(doc))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(doc))
  model.addComment(a, tab, { parent: id, author: 'ann', text: 'one', at: 2 })
  model.editComment(a, tab, id, 'ann', 'Q edited', 2)
  model.addComment(b, tab, { parent: id, author: 'bob', text: 'two', at: 2 })
  model.resolveComment(b, tab, id, true)
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  for (const d of [a, b]) {
    const [t] = model.getComments(d, tab)
    assert.equal(t.text, 'Q edited')
    assert.equal(t.resolved, true)
    assert.deepEqual(t.replies.map((r) => r.text).sort(), ['one', 'two'])
  }
  assert.deepEqual(model.getComments(a, tab), model.getComments(b, tab))
})

test('comments go out to .xlsx as notes and come back', () => {
  const XLSX = require('xlsx/dist/xlsx.mini.min.js')
  const fflate = require('fflate')
  const { workbookBytes, workbookToTabs, READ_OPTIONS } = require('../src/shared/xlsxMap')
  const dump = { title: 'T', tabs: [{ name: 'A', cells: [{ row: 1, col: 1, input: 'x', value: 'x', fmt: {} }], widths: {}, comments: [{ row: 1, col: 1, author: 'Ann', text: 'Ann: Check\nBob: Done' }, { row: 4, col: 2, author: 'Bob', text: 'Bob: on a blank cell' }] }] }
  const bytes = workbookBytes(XLSX, fflate, dump)
  const { tabs } = workbookToTabs(XLSX, XLSX.read(bytes, { type: 'array', ...READ_OPTIONS }))
  const { doc, tab } = sheet()
  model.importTabs(doc, { tabs })
  assert.deepEqual(model.getComments(doc, tab).map((t) => [t.row, t.col, t.author, t.text]), [
    [1, 1, 'xlsx:Ann', 'Ann: Check\nBob: Done'],
    [4, 2, 'xlsx:Bob', 'Bob: on a blank cell']
  ])
})
