// @ chips in documents (proposals/2026-10-26-document-chips.md): the node's
// checks, exports as text and links, and imports making none. happy-dom
// stands in for the page.

const test = require('node:test')
const assert = require('node:assert/strict')
const path = require('node:path')
const fflate = require('fflate')
const { Window } = require('happy-dom')

globalThis.window = new Window()
globalThis.document = window.document
window.pearoffice = { call: async () => ({}), on: () => () => {} }
const load = async () => ({
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'docFiles.js'))),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'extensions.js'))),
  ...(await import(path.join(__dirname, '..', 'src', 'ui', 'doc', 'odt.js')))
})

const PERSON = 'a'.repeat(64)
const json = {
  type: 'doc',
  content: [{
    type: 'paragraph',
    content: [
      { type: 'text', text: 'Ask ' },
      { type: 'chip', attrs: { kind: 'person', id: PERSON, date: null, text: 'Ada' } },
      { type: 'text', text: ' about ' },
      { type: 'chip', attrs: { kind: 'file', id: 'f1', date: null, text: 'Budget' } },
      { type: 'text', text: ' by ' },
      { type: 'chip', attrs: { kind: 'date', id: null, date: '2030-05-17', text: '' } }
    ]
  }]
}

test('chipOk takes a person key, a file or folder id and a date, and nothing else', async () => {
  const { chipOk } = await load()
  assert.equal(chipOk({ kind: 'person', id: PERSON }), true)
  assert.equal(chipOk({ kind: 'person', id: 'abc' }), false)
  assert.equal(chipOk({ kind: 'file', id: 'f1' }), true)
  assert.equal(chipOk({ kind: 'folder', id: 'bad id' }), false)
  assert.equal(chipOk({ kind: 'date', date: '2030-05-17' }), true)
  assert.equal(chipOk({ kind: 'date', date: 'tomorrow' }), false)
  assert.equal(chipOk({ kind: 'link', id: 'x' }), false)
})

test('chips go out as their text, and files as links', async () => {
  const f = await load()
  const date = f.chipDate('2030-05-17')
  assert.equal(f.toText(json).trim(), 'Ask Ada about Budget by ' + date)
  assert.equal(f.toMarkdown(json).trim(), 'Ask Ada about [Budget](pearoffice://file/f1) by ' + date)
  const html = f.toHtml(json, 'T')
  assert.match(html, /<a [^>]*href="pearoffice:\/\/file\/f1"[^>]*>Budget<\/a>/)
  assert.equal(html.includes('data-chip'), false)
  const docx = fflate.strFromU8(fflate.unzipSync(await f.toDocx(json, 'T'))['word/document.xml'])
  assert.equal(docx.includes('>Ada<'), true)
  assert.equal(docx.includes('>Budget<'), true)
  const odt = fflate.strFromU8(fflate.unzipSync(f.toOdt(json, 'T'))['content.xml'])
  assert.match(odt, /<text:a [^>]*xlink:href="pearoffice:\/\/file\/f1"[^>]*>(<text:span [^>]*>)?Budget(<\/text:span>)?<\/text:a>/)
})

test('an imported file makes no chips', async () => {
  const f = await load()
  const html = '<p>Ask <span data-chip="person" data-id="' + PERSON + '">Ada</span> and <a data-chip="file" data-id="f1" href="pearoffice://file/f1">Budget</a></p>'
  const r = await f.fileToJson('a.html', new TextEncoder().encode(html))
  const kinds = []
  const walk = (n) => { kinds.push(n.type); for (const c of n.content || []) walk(c) }
  walk(r.json)
  assert.equal(kinds.includes('chip'), false)
  assert.match(JSON.stringify(r.json), /Ada/)
})
