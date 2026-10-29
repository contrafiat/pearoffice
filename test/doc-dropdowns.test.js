// Dropdowns in documents (proposals/2026-10-29-document-dropdowns.md): the
// lists of choices, merging, exports in the item's colours and the editor's
// view of a renamed item. happy-dom stands in for the page.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fflate = require('fflate')
const { Window } = require('happy-dom')

globalThis.window = new Window()
globalThis.document = window.document
window.pearoffice = { call: async () => ({}), on: () => () => {} }
const load = async () => ({
  Y: await import('yjs'),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'extensions.js'))),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'odt.js'))),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'lists.js')))
})

const shopping = (list, item, text, color) => ({
  type: 'doc',
  content: [{
    type: 'taskList',
    content: [
      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Beans ' }, { type: 'dropdown', attrs: { list, item, text, color } }] }] },
      { type: 'taskItem', attrs: { checked: false }, content: [{ type: 'paragraph', content: [{ type: 'text', text: 'Milk ' }, { type: 'dropdown', attrs: { list, item: '', text: '', color: 'grey' } }] }] }
    ]
  }]
})

test('a new list starts with Yes and No, and items are checked', async () => {
  const f = await load()
  const Y = f.Y
  const doc = new Y.Doc()
  const id = f.newList(doc, '  Shopping  ')
  let [l] = f.readLists(doc)
  assert.equal(l.id, id)
  assert.equal(l.name, 'Shopping')
  assert.deepEqual(l.items.map((it) => [it.text, it.color]), [['Yes', 'green'], ['No', 'red']])
  const nis = f.setItem(doc, id, null, { text: 'Not in store', color: 'orange' })
  assert.equal(f.setItem(doc, id, null, { text: '   ' }), null)
  f.setItem(doc, id, nis, { color: 'purple-ish' })
  l = f.readList(doc, id)
  assert.deepEqual(l.items.map((it) => [it.text, it.color]), [['Yes', 'green'], ['No', 'red'], ['Not in store', 'grey']])
  f.moveItem(doc, id, nis, -1)
  assert.deepEqual(f.readList(doc, id).items.map((it) => it.text), ['Yes', 'Not in store', 'No'])
  f.deleteItem(doc, id, nis)
  f.renameList(doc, id, 'Groceries')
  assert.deepEqual(f.readList(doc, id).items.map((it) => it.text), ['Yes', 'No'])
  assert.equal(f.readList(doc, id).name, 'Groceries')
  f.deleteList(doc, id)
  assert.deepEqual(f.readLists(doc), [])
})

test('two people changing different items both keep theirs', async () => {
  const f = await load()
  const Y = f.Y
  const a = new Y.Doc()
  const id = f.newList(a)
  const b = new Y.Doc()
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  const [yes, no] = f.readList(a, id).items
  f.setItem(a, id, yes.id, { text: 'Got it' })
  f.setItem(b, id, no.id, { color: 'orange' })
  f.setItem(b, id, null, { text: 'Not in store' })
  Y.applyUpdate(a, Y.encodeStateAsUpdate(b))
  Y.applyUpdate(b, Y.encodeStateAsUpdate(a))
  assert.deepEqual(f.readList(a, id), f.readList(b, id))
  assert.deepEqual(f.readList(a, id).items.map((it) => [it.text, it.color]), [['Got it', 'green'], ['No', 'orange'], ['Not in store', f.readList(a, id).items[2].color]])
})

test('a chosen dropdown goes out as its text in its colours, an empty one as nothing', async () => {
  const f = await load()
  const json = shopping('L1', 'i1', 'Yes', 'green')
  assert.equal(f.toText(json).trim(), '- [ ] Beans Yes\n- [ ] Milk')
  assert.equal(f.toMarkdown(json).trim(), '- [ ] Beans Yes\n- [ ] Milk')
  const html = f.toHtml(json, 'T')
  assert.match(html, /<mark [^>]*background-color: ?#d4edbc[^>]*>.*Yes/)
  assert.equal(html.includes('data-dropdown'), false)
  const docx = fflate.strFromU8(fflate.unzipSync(await f.toDocx(json, 'T'))['word/document.xml'])
  assert.match(docx, /<w:shd [^>]*w:fill="D4EDBC"/)
  assert.match(docx, /<w:color w:val="11734B"/)
  assert.equal(docx.includes('>Yes<'), true)
  const odt = fflate.strFromU8(fflate.unzipSync(f.toOdt(json, 'T'))['content.xml']) + fflate.strFromU8(fflate.unzipSync(f.toOdt(json, 'T'))['styles.xml'] || new Uint8Array())
  assert.match(odt, /fo:background-color="#d4edbc"/)
})

test('the export shows the item as it is now, and a deleted one in grey as it was picked', async () => {
  const f = await load()
  const Y = f.Y
  const doc = new Y.Doc()
  const id = f.newList(doc)
  const [yes, no] = f.readList(doc, id).items
  Y.applyUpdate(doc, f.jsonToUpdate(shopping(id, yes.id, 'Yes', 'green')))
  f.setItem(doc, id, yes.id, { text: 'Got it', color: 'blue' })
  let json = f.docToJson(doc)
  let pill = json.content[0].content[0].content[0].content[1]
  assert.deepEqual([pill.attrs.text, pill.attrs.color], ['Got it', 'blue'])
  f.deleteItem(doc, id, yes.id)
  json = f.docToJson(doc)
  pill = json.content[0].content[0].content[0].content[1]
  // Gone: the text from when it was picked, in grey.
  assert.deepEqual([pill.attrs.text, pill.attrs.color], ['Yes', 'grey'])
  assert.ok(no)
})

test('a pasted dropdown keeps its list and choice', async () => {
  const f = await load()
  const r = await f.fileToJson('a.html', new TextEncoder().encode('<p>Beans <span data-dropdown="L1" data-item="i1" data-color="green">Yes</span> <span data-dropdown="bad id!">x</span></p>'))
  const nodes = []
  const walk = (n) => { nodes.push(n); for (const c of n.content || []) walk(c) }
  walk(r.json)
  const pills = nodes.filter((n) => n.type === 'dropdown')
  assert.deepEqual(pills.map((n) => ({ ...n.attrs })), [{ list: 'L1', item: 'i1', text: 'Yes', color: 'green' }])
})
